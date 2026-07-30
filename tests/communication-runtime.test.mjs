import test from 'node:test';
import assert from 'node:assert/strict';
import { installCoreRuntime } from '../apps/core-extension/dist/index.js';
import { coreIdentity, errorCode, eventContract, pluginDescriptor, service, TestRealm } from './helpers/runtime-fixture.mjs';

const setup = () => {
  const realm = new TestRealm();
  const runtime = installCoreRuntime(coreIdentity(), realm);
  return {
    runtime,
    provider: runtime.connect(pluginDescriptor('example.provider')),
    caller: runtime.connect(pluginDescriptor('example.caller')),
  };
};

test('registry validates identity, rejects duplicates, and exposes immutable snapshots', () => {
  const { runtime, provider } = setup();
  assert.throws(() => runtime.connect(pluginDescriptor('example.provider')), errorCode('CONFLICT'));
  assert.throws(() => runtime.connect(pluginDescriptor('ss-helper.core')), errorCode('INVALID_PAYLOAD'));
  assert.throws(() => runtime.connect(pluginDescriptor('invalid')), errorCode('INVALID_PAYLOAD'));
  const snapshot = runtime.plugins.snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot[0]), true);
  provider.dispose();
  assert.equal(runtime.plugins.snapshot().length, 1);
});

test('structurally equal request tokens interoperate without a polling availability API', async () => {
  const { runtime, provider, caller } = setup();
  const providerToken = service('example.provider');
  const copiedToken = JSON.parse(JSON.stringify(providerToken));
  const remove = provider.bus.handle(providerToken, (request, context) => ({ echoed: request.value, caller: context.callerPluginId }));
  assert.deepEqual(await caller.bus.request(copiedToken, { value: 'ok' }), { echoed: 'ok', caller: 'example.caller' });
  assert.equal(runtime.port.diagnostics().pending, 0);
  remove();
  assert.equal(runtime.port.diagnostics().handlers, 0);
  await assert.rejects(caller.bus.request(copiedToken, { value: 'no' }), errorCode('NOT_FOUND'));
});

test('service errors from a separately bundled SDK retain the root reason and use the central safe message', async () => {
  const { provider, caller } = setup();
  const token = service('example.provider', 'foreign-error');
  class ForeignSSHelperError extends Error {
    constructor() {
      super('provider returned invalid JSON');
      this.name = 'SSHelperError';
      this.code = 'INVALID_PAYLOAD';
      this.details = { stage: 'handler', reasonCode: 'INVALID_JSON', requestId: 'provider-root-request' };
    }
  }
  provider.bus.handle(token, async () => { throw new ForeignSSHelperError(); });

  await assert.rejects(
    caller.bus.request(token, {}),
    (error) => error?.code === 'INVALID_PAYLOAD'
      && error?.message === '模型返回内容不是有效 JSON'
      && error?.details?.reasonCode === 'INVALID_JSON'
      && error?.details?.requestId === 'provider-root-request',
  );
});

test('request version, namespace, validators, and plain-data boundaries fail closed', async () => {
  const { provider, caller } = setup();
  const token = service('example.provider', 'checked', 1, {
    validateRequest: (value) => value?.ok === true,
    validateResponse: (value) => value?.done === true,
  });
  provider.bus.handle(token, () => ({ done: true }));
  await assert.rejects(caller.bus.request(service('example.provider', 'checked', 2), { ok: true }), errorCode('NOT_FOUND'));
  await assert.rejects(caller.bus.request(token, { ok: false }), errorCode('INVALID_PAYLOAD'));
  await assert.rejects(caller.bus.request(token, new (class Payload {})()), errorCode('INVALID_PAYLOAD'));
  assert.throws(() => caller.bus.handle(service('example.provider'), () => ({})), errorCode('FORBIDDEN'));
  assert.throws(() => caller.bus.handle('raw-service', () => ({})), errorCode('INVALID_PAYLOAD'));
});

test('request and event tokens require canonical ids and non-negative versions', async () => {
  const { provider, caller } = setup();
  const token = service('example.provider', 'canonical', 0);
  provider.bus.handle(token, () => ({ ok: true }));
  await assert.rejects(caller.bus.request({ ...token, id: 'invalid' }, {}), errorCode('INVALID_PAYLOAD'));
  await assert.rejects(caller.bus.request({ kind: token.kind, version: token.version }, {}), errorCode('INVALID_PAYLOAD'));
  assert.throws(() => provider.bus.publish({ ...eventContract('example.provider'), version: -1 }, {}), errorCode('INVALID_PAYLOAD'));
});

test('provider validators remain authoritative for structurally copied service tokens', async () => {
  const { provider, caller } = setup();
  const providerToken = service('example.provider', 'authoritative', 1, {
    validateRequest: (value) => value?.ok === true,
    validateResponse: (value) => value?.done === true,
  });
  const copiedToken = JSON.parse(JSON.stringify(providerToken));
  let calls = 0;
  provider.bus.handle(providerToken, () => {
    calls += 1;
    return { done: false };
  });

  await assert.rejects(caller.bus.request(copiedToken, { ok: false }), errorCode('INVALID_PAYLOAD'));
  assert.equal(calls, 0);
  await assert.rejects(caller.bus.request(copiedToken, { ok: true }), errorCode('INVALID_PAYLOAD'));
  assert.equal(calls, 1);
});

test('timeout and abort cancel provider context, clean pending state, and quarantine late results', async () => {
  const { runtime, provider, caller } = setup();
  const token = service('example.provider', 'slow');
  let providerAbortCount = 0;
  let complete;
  provider.bus.handle(token, (_request, context) => new Promise((resolve) => {
    complete = resolve;
    context.signal.addEventListener('abort', () => { providerAbortCount += 1; }, { once: true });
  }));
  await assert.rejects(caller.bus.request(token, {}, { timeoutMs: 5 }), errorCode('TIMEOUT'));
  assert.equal(runtime.port.diagnostics().pending, 0);
  complete({ late: true });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(runtime.port.diagnostics().pending, 0);

  const controller = new AbortController();
  const aborted = caller.bus.request(token, {}, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(aborted, errorCode('ABORTED'));
  assert.equal(providerAbortCount, 2);
  assert.equal(runtime.port.diagnostics().pending, 0);
});

test('provider and Core disposal settle pending calls and restore all counts', async () => {
  const { runtime, provider, caller } = setup();
  const token = service('example.provider', 'pending');
  provider.bus.handle(token, () => new Promise(() => {}));
  const pending = caller.bus.request(token, {});
  await Promise.resolve();
  provider.dispose();
  await assert.rejects(pending, errorCode('STALE_SESSION'));
  assert.deepEqual({ ...runtime.port.diagnostics(), events: undefined }, {
    generation: 1, plugins: 1, handlers: 0, subscribers: 0, pending: 0, waiters: 0, events: undefined,
  });
  runtime.dispose();
  await assert.rejects(caller.bus.request(token, {}), errorCode('STALE_SESSION'));
});

test('removing one handler only settles requests dispatched through that contract', async () => {
  const { runtime, provider, caller } = setup();
  const first = service('example.provider', 'first-pending');
  const second = service('example.provider', 'second-pending');
  let completeSecond;
  const removeFirst = provider.bus.handle(first, () => new Promise(() => {}));
  provider.bus.handle(second, () => new Promise((resolve) => { completeSecond = resolve; }));

  const firstPending = caller.bus.request(first, {});
  const secondPending = caller.bus.request(second, {});
  await Promise.resolve();
  removeFirst();

  await assert.rejects(firstPending, (error) =>
    error?.code === 'STALE_SESSION' && error?.details?.reasonCode === 'BUS_PROVIDER_CLOSED');
  assert.equal(runtime.port.diagnostics().pending, 1);
  completeSecond({ ok: true });
  await assert.doesNotReject(secondPending);
  assert.equal(runtime.port.diagnostics().pending, 0);
});

test('events are structural, namespace-bound, validated, and subscription cleanup is idempotent', () => {
  const { runtime, provider, caller } = setup();
  const token = eventContract('example.provider');
  const received = [];
  const unsubscribe = caller.bus.subscribe(JSON.parse(JSON.stringify(token)), (payload) => received.push(payload));
  provider.bus.publish(token, { value: 1 });
  assert.deepEqual(received, [{ value: 1 }]);
  assert.throws(() => caller.bus.publish(token, { value: 2 }), errorCode('FORBIDDEN'));
  provider.bus.publish(eventContract('example.provider', 'changed', 2), { value: 2 });
  assert.deepEqual(received, [{ value: 1 }]);
  assert.throws(() => provider.bus.publish(token, { callback() {} }), errorCode('INVALID_PAYLOAD'));
  unsubscribe();
  unsubscribe();
  assert.equal(runtime.port.diagnostics().subscribers, 0);
});

test('diagnostics expose only fixed redacted fields, never payloads or secrets', async () => {
  const { runtime, provider, caller } = setup();
  const token = service('example.provider', 'redacted');
  provider.bus.handle(token, () => ({ ok: true }));
  await caller.bus.request(token, {
    apiKey: 'super-secret', prompt: 'private prompt', cookie: 'private-cookie', csrf: 'private-csrf',
    authorization: 'Bearer private-auth', sqliteBase64: 'U1FMaXRlIHByaXZhdGU=', userContent: 'private user content',
  });
  const serialized = JSON.stringify(runtime.port.diagnostics());
  assert.doesNotMatch(serialized, /super-secret|private prompt|private-cookie|private-csrf|private-auth|U1FMaXRlIHByaXZhdGU=|private user content|apiKey|prompt|cookie|csrf|authorization|sqliteBase64|userContent/u);
  assert.match(serialized, /bus\.request\.completed/u);
});

test('missing handlers fail immediately without waiter state', async () => {
  const { runtime, caller } = setup();
  const token = service('example.missing', 'late');
  await assert.rejects(caller.bus.request(token, {}), errorCode('NOT_FOUND'));
  assert.equal(runtime.port.diagnostics().waiters, 0);
});

test('repeated session churn returns registry, handler, subscriber, pending and waiter counts to baseline', async () => {
  const realm = new TestRealm();
  const runtime = installCoreRuntime(coreIdentity(), realm);
  for (let index = 0; index < 100; index += 1) {
    const provider = runtime.connect(pluginDescriptor(`reload.provider-${index}`));
    const caller = runtime.connect(pluginDescriptor(`reload.caller-${index}`));
    const serviceToken = service(provider.descriptor.id);
    const eventToken = eventContract(provider.descriptor.id);
    provider.bus.handle(serviceToken, () => ({ ok: true }));
    caller.bus.subscribe(eventToken, () => {});
    await caller.bus.request(serviceToken, {});
    caller.dispose();
    provider.dispose();
  }
  const snapshot = runtime.port.diagnostics();
  assert.equal(snapshot.events.length, 256, 'diagnostics retain only the newest bounded event window');
  assert.deepEqual(
    { plugins: snapshot.plugins, handlers: snapshot.handlers, subscribers: snapshot.subscribers, pending: snapshot.pending, waiters: snapshot.waiters },
    { plugins: 0, handlers: 0, subscribers: 0, pending: 0, waiters: 0 },
  );
});
