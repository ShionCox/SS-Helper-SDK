import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapSSHelper,
  connectSSHelper,
  CORE_DISCOVERY_SYMBOL,
  CORE_LIFECYCLE_EVENT,
} from '../packages/sdk/dist/index.js';
import { installCoreRuntime } from '../apps/core-extension/dist/index.js';
import { coreIdentity, errorCode, pluginDescriptor, TestRealm } from './helpers/runtime-fixture.mjs';

test('Core installation is atomic, frozen, idempotent, and rejects an active different artifact', () => {
  const realm = new TestRealm();
  const kinds = [];
  realm.addEventListener(CORE_LIFECYCLE_EVENT, (event) => kinds.push(event.detail.kind));
  const runtime = installCoreRuntime(coreIdentity(), realm);
  const snapshot = realm[CORE_DISCOVERY_SYMBOL];
  assert.equal(snapshot.descriptor.generation, 1);
  assert.equal(snapshot.descriptor.state, 'ready');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.descriptor), true);
  assert.equal(Object.isFrozen(snapshot.descriptor.artifact), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(realm, CORE_DISCOVERY_SYMBOL), {
    value: snapshot, writable: false, enumerable: false, configurable: true,
  });
  assert.equal(installCoreRuntime(coreIdentity(), realm), runtime);
  assert.throws(() => installCoreRuntime(coreIdentity({ buildId: 'other' }), realm), errorCode('CORE_ALREADY_ACTIVE'));
  assert.deepEqual(kinds, ['ready']);
});

test('dispose preserves a disposed generation and replacement advances exactly once', async () => {
  const realm = new TestRealm();
  const details = [];
  realm.addEventListener(CORE_LIFECYCLE_EVENT, (event) => details.push(event.detail));
  const first = installCoreRuntime(coreIdentity(), realm);
  const session = first.connect(pluginDescriptor('example.alpha'));
  first.dispose();
  assert.equal(realm[CORE_DISCOVERY_SYMBOL].descriptor.state, 'disposed');
  assert.deepEqual(await session.closed, { reason: 'core_disposed', generation: 1 });
  assert.throws(() => session.events.subscribe({ kind: 'event', provider: 'x.y', name: 'z', version: 0 }, () => {}), errorCode('STALE_SESSION'));
  const second = installCoreRuntime(coreIdentity({ buildId: 'replacement' }), realm);
  assert.equal(second.generation, 2);
  assert.deepEqual(details.map((detail) => [detail.kind, detail.generation]), [['ready', 1], ['disposed', 1], ['replaced', 2]]);
  assert.equal(realm[CORE_DISCOVERY_SYMBOL].descriptor.generation, 2);
});

test('invalid discovery values fail closed without overwriting the slot', () => {
  const realm = new TestRealm();
  Object.defineProperty(realm, CORE_DISCOVERY_SYMBOL, { value: { bad: true }, configurable: true });
  assert.throws(() => installCoreRuntime(coreIdentity(), realm), errorCode('BRIDGE_CORRUPTED'));
  assert.deepEqual(realm[CORE_DISCOVERY_SYMBOL], { bad: true });
});

test('malformed discovery snapshots fail closed without publishing a replacement', () => {
  const valid = new TestRealm();
  const runtime = installCoreRuntime(coreIdentity(), valid);
  runtime.dispose();
  const snapshot = valid[CORE_DISCOVERY_SYMBOL];
  const malformed = [
    { ...snapshot, descriptor: { ...snapshot.descriptor, state: 'corrupt', generation: 7 } },
    { ...snapshot, descriptor: { ...snapshot.descriptor, artifact: { ...snapshot.descriptor.artifact, buildId: '' } } },
    { ...snapshot, descriptor: { ...snapshot.descriptor, generation: Number.NaN } },
    { ...snapshot, port: { ...snapshot.port, connect: undefined } },
  ];

  for (const value of malformed) {
    const realm = new TestRealm();
    Object.defineProperty(realm, CORE_DISCOVERY_SYMBOL, { value, configurable: true });
    assert.throws(() => installCoreRuntime(coreIdentity(), realm), errorCode('BRIDGE_CORRUPTED'));
    assert.equal(realm[CORE_DISCOVERY_SYMBOL], value);
  }
});

test('connectSSHelper waits for late Core and closes the snapshot-subscribe race', async () => {
  const realm = new TestRealm();
  const pending = connectSSHelper(pluginDescriptor('example.late'), { target: realm, timeoutMs: 500 });
  setTimeout(() => installCoreRuntime(coreIdentity(), realm), 10);
  assert.equal((await pending).generation, 1);

  const raceRealm = new TestRealm();
  const originalAdd = raceRealm.addEventListener.bind(raceRealm);
  let injected = false;
  raceRealm.addEventListener = (type, listener, options) => {
    if (!injected && type === CORE_LIFECYCLE_EVENT) {
      injected = true;
      installCoreRuntime(coreIdentity({ buildId: 'race' }), raceRealm);
    }
    return originalAdd(type, listener, options);
  };
  const raced = await connectSSHelper(pluginDescriptor('example.race'), { target: raceRealm, timeoutMs: 100 });
  assert.equal(raced.generation, 1);
});

test('connectSSHelper reports missing, incompatible, and corrupted bridges with public codes', async () => {
  await assert.rejects(connectSSHelper(pluginDescriptor('example.missing'), { target: new TestRealm(), timeoutMs: 1 }), errorCode('CORE_MISSING'));
  const incompatible = new TestRealm();
  installCoreRuntime(coreIdentity({ apiVersion: '0.0.0' }), incompatible);
  await assert.rejects(connectSSHelper(pluginDescriptor('example.incompatible'), { target: incompatible, timeoutMs: 10 }), errorCode('API_INCOMPATIBLE'));
  const corrupt = new TestRealm();
  Object.defineProperty(corrupt, CORE_DISCOVERY_SYMBOL, { value: 42, configurable: true });
  await assert.rejects(connectSSHelper(pluginDescriptor('example.corrupt'), { target: corrupt, timeoutMs: 10 }), errorCode('BRIDGE_CORRUPTED'));
});

test('bootstrap reconnect is generation-safe, single-flight, bounded, and disposable', async () => {
  const realm = new TestRealm();
  const first = installCoreRuntime(coreIdentity(), realm);
  const generations = [];
  const bootstrap = await bootstrapSSHelper(pluginDescriptor('example.bootstrap'), (session) => generations.push(session.generation), {
    target: realm,
    timeoutMs: 100,
    reconnect: { maxAttempts: 3, totalDeadlineMs: 500, backoffMs: [1, 1, 1] },
  });
  first.dispose();
  installCoreRuntime(coreIdentity({ buildId: 'next' }), realm);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(generations, [1, 2]);
  assert.equal(bootstrap.current.generation, 2);
  bootstrap.dispose();
  assert.equal((await bootstrap.closed).reason, 'consumer_dispose');

  const exhaustedRealm = new TestRealm();
  const exhaustedCore = installCoreRuntime(coreIdentity({ buildId: 'exhaust' }), exhaustedRealm);
  const exhausted = await bootstrapSSHelper(pluginDescriptor('example.exhausted'), () => {}, {
    target: exhaustedRealm,
    timeoutMs: 5,
    reconnect: { maxAttempts: 2, totalDeadlineMs: 30, backoffMs: [1, 1] },
  });
  exhaustedCore.dispose();
  await assert.rejects(exhausted.closed, errorCode('CORE_RECONNECT_EXHAUSTED'));
});

test('reconnect deadline starts on closure and a lifecycle event wakes backoff early', async () => {
  const realm = new TestRealm();
  const first = installCoreRuntime(coreIdentity({ buildId: 'long-lived' }), realm);
  const generations = [];
  const bootstrap = await bootstrapSSHelper(pluginDescriptor('example.long-lived'), (session) => generations.push(session.generation), {
    target: realm,
    timeoutMs: 15,
    reconnect: { maxAttempts: 1, totalDeadlineMs: 20, backoffMs: [100] },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  first.dispose();
  setTimeout(() => installCoreRuntime(coreIdentity({ buildId: 'event-wakeup' }), realm), 2);
  await Promise.race([
    new Promise((resolve) => {
      const timer = setInterval(() => {
        if (generations.length === 2) { clearInterval(timer); resolve(); }
      }, 1);
    }),
    bootstrap.closed.then((value) => { throw new Error(`bootstrap closed unexpectedly: ${value.reason}`); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('reconnect did not wake')), 50)),
  ]);
  assert.deepEqual(generations, [1, 2]);
  bootstrap.dispose();
});

test('reconnect backoff and connect timeout share one absolute deadline', async () => {
  for (const { backoffMs, timeoutMs } of [
    { backoffMs: [250], timeoutMs: 250 },
    { backoffMs: [0], timeoutMs: 250 },
  ]) {
    const realm = new TestRealm();
    const runtime = installCoreRuntime(coreIdentity(), realm);
    const bootstrap = await bootstrapSSHelper(pluginDescriptor(`example.deadline-${backoffMs[0]}`), () => {}, {
      target: realm,
      timeoutMs,
      reconnect: { maxAttempts: 1, totalDeadlineMs: 30, backoffMs },
    });
    const startedAt = Date.now();
    runtime.dispose();
    await assert.rejects(bootstrap.closed, errorCode('CORE_RECONNECT_EXHAUSTED'));
    assert.ok(Date.now() - startedAt < 150, 'reconnect exceeded its absolute deadline allowance');
  }
});
