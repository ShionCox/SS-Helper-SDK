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
  assert.throws(() => runtime.connect(pluginDescriptor('example.provider')), errorCode('DUPLICATE_PLUGIN_ID'));
  assert.throws(() => runtime.connect(pluginDescriptor('ss-helper.core')), errorCode('PAYLOAD_INVALID'));
  assert.throws(() => runtime.connect(pluginDescriptor('invalid')), errorCode('PAYLOAD_INVALID'));
  const snapshot = runtime.plugins.snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot[0]), true);
  provider.dispose();
  assert.equal(runtime.plugins.snapshot().length, 1);
});

test('structurally equal service tokens interoperate and late availability has no polling global', async () => {
  const { runtime, provider, caller } = setup();
  const providerToken = service('example.provider');
  const copiedToken = JSON.parse(JSON.stringify(providerToken));
  const waiting = caller.services.waitFor(copiedToken, { timeoutMs: 100 });
  const remove = provider.services.expose(providerToken, (request, context) => ({ echoed: request.value, caller: context.callerPluginId }));
  await waiting;
  assert.deepEqual(await caller.services.call(copiedToken, { value: 'ok' }), { echoed: 'ok', caller: 'example.caller' });
  assert.equal(runtime.port.diagnostics().pending, 0);
  remove();
  assert.equal(runtime.port.diagnostics().handlers, 0);
  await assert.rejects(caller.services.call(copiedToken, { value: 'no' }), errorCode('UNKNOWN_SERVICE'));
});

test('service errors from a separately bundled SDK retain their safe code, message, and details', async () => {
  const { provider, caller } = setup();
  const token = service('example.provider', 'foreign-error');
  class ForeignSSHelperError extends Error {
    constructor() {
      super('provider returned invalid JSON');
      this.name = 'SSHelperError';
      this.code = 'PAYLOAD_INVALID';
      this.details = { phase: 'handler', reasonCode: 'invalid_json' };
    }
  }
  provider.services.expose(token, async () => { throw new ForeignSSHelperError(); });

  await assert.rejects(
    caller.services.call(token, {}),
    (error) => error?.code === 'PAYLOAD_INVALID'
      && error?.message === 'provider returned invalid JSON'
      && error?.details?.reasonCode === 'invalid_json',
  );
});

test('service version/schema mismatch, namespace, validators, and plain-data boundaries fail closed', async () => {
  const { provider, caller } = setup();
  const token = service('example.provider', 'checked', 1, {
    validateRequest: (value) => value?.ok === true,
    validateResponse: (value) => value?.done === true,
  });
  provider.services.expose(token, () => ({ done: true }));
  await assert.rejects(caller.services.call(service('example.provider', 'checked', 2), { ok: true }), errorCode('SERVICE_VERSION_MISMATCH'));
  await assert.rejects(caller.services.call(token, { ok: false }), errorCode('PAYLOAD_INVALID'));
  await assert.rejects(caller.services.call(token, new (class Payload {})()), errorCode('PAYLOAD_INVALID'));
  assert.throws(() => caller.services.expose(service('example.provider'), () => ({})), errorCode('PAYLOAD_INVALID'));
  assert.throws(() => caller.services.expose('raw-service', () => ({})), errorCode('PAYLOAD_INVALID'));
});

test('service and event schema identifiers must match provider, name, and version exactly', async () => {
  const { provider, caller } = setup();
  const token = service('example.provider', 'canonical', 0);
  provider.services.expose(token, () => ({ ok: true }));
  const wrongSchema = { ...token, schemaId: 'example.provider.canonical.v1' };
  const missingSchema = { kind: token.kind, provider: token.provider, name: token.name, version: token.version };
  await assert.rejects(caller.services.call(wrongSchema, {}), errorCode('PAYLOAD_INVALID'));
  await assert.rejects(caller.services.waitFor(missingSchema, { timeoutMs: 10 }), errorCode('PAYLOAD_INVALID'));
  assert.throws(() => provider.events.publish({ ...eventContract('example.provider'), schemaId: 'example.provider.changed.v1' }, {}), errorCode('PAYLOAD_INVALID'));
});

test('provider validators remain authoritative for structurally copied service tokens', async () => {
  const { provider, caller } = setup();
  const providerToken = service('example.provider', 'authoritative', 1, {
    validateRequest: (value) => value?.ok === true,
    validateResponse: (value) => value?.done === true,
  });
  const copiedToken = JSON.parse(JSON.stringify(providerToken));
  let calls = 0;
  provider.services.expose(providerToken, () => {
    calls += 1;
    return { done: false };
  });

  await assert.rejects(caller.services.call(copiedToken, { ok: false }), errorCode('PAYLOAD_INVALID'));
  assert.equal(calls, 0);
  await assert.rejects(caller.services.call(copiedToken, { ok: true }), errorCode('PAYLOAD_INVALID'));
  assert.equal(calls, 1);
});

test('timeout and abort cancel provider context, clean pending state, and quarantine late results', async () => {
  const { runtime, provider, caller } = setup();
  const token = service('example.provider', 'slow');
  let providerAbortCount = 0;
  let complete;
  provider.services.expose(token, (_request, context) => new Promise((resolve) => {
    complete = resolve;
    context.signal.addEventListener('abort', () => { providerAbortCount += 1; }, { once: true });
  }));
  await assert.rejects(caller.services.call(token, {}, { timeoutMs: 5 }), errorCode('CALL_TIMEOUT'));
  assert.equal(runtime.port.diagnostics().pending, 0);
  complete({ late: true });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(runtime.port.diagnostics().pending, 0);

  const controller = new AbortController();
  const aborted = caller.services.call(token, {}, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(aborted, errorCode('CALL_ABORTED'));
  assert.equal(providerAbortCount, 2);
  assert.equal(runtime.port.diagnostics().pending, 0);
});

test('provider and Core disposal settle pending calls and restore all counts', async () => {
  const { runtime, provider, caller } = setup();
  const token = service('example.provider', 'pending');
  provider.services.expose(token, () => new Promise(() => {}));
  const pending = caller.services.call(token, {});
  await Promise.resolve();
  provider.dispose();
  await assert.rejects(pending, errorCode('PLUGIN_DISPOSED'));
  assert.deepEqual({ ...runtime.port.diagnostics(), events: undefined }, {
    generation: 1, plugins: 1, handlers: 0, subscribers: 0, pending: 0, waiters: 0, events: undefined,
  });
  runtime.dispose();
  await assert.rejects(caller.services.waitFor(token), errorCode('STALE_SESSION'));
});

test('events are structural, namespace-bound, validated, and subscription cleanup is idempotent', () => {
  const { runtime, provider, caller } = setup();
  const token = eventContract('example.provider');
  const received = [];
  const unsubscribe = caller.events.subscribe(JSON.parse(JSON.stringify(token)), (payload) => received.push(payload));
  provider.events.publish(token, { value: 1 });
  assert.deepEqual(received, [{ value: 1 }]);
  assert.throws(() => caller.events.publish(token, { value: 2 }), errorCode('PAYLOAD_INVALID'));
  assert.throws(() => provider.events.publish(eventContract('example.provider', 'changed', 2), { value: 2 }), errorCode('SERVICE_VERSION_MISMATCH'));
  assert.throws(() => provider.events.publish(token, { callback() {} }), errorCode('PAYLOAD_INVALID'));
  unsubscribe();
  unsubscribe();
  assert.equal(runtime.port.diagnostics().subscribers, 0);
});

test('diagnostics expose only fixed redacted fields, never payloads or secrets', async () => {
  const { runtime, provider, caller } = setup();
  const token = service('example.provider', 'redacted');
  provider.services.expose(token, () => ({ ok: true }));
  await caller.services.call(token, {
    apiKey: 'super-secret', prompt: 'private prompt', cookie: 'private-cookie', csrf: 'private-csrf',
    authorization: 'Bearer private-auth', sqliteBase64: 'U1FMaXRlIHByaXZhdGU=', userContent: 'private user content',
  });
  const serialized = JSON.stringify(runtime.port.diagnostics());
  assert.doesNotMatch(serialized, /super-secret|private prompt|private-cookie|private-csrf|private-auth|U1FMaXRlIHByaXZhdGU=|private user content|apiKey|prompt|cookie|csrf|authorization|sqliteBase64|userContent/u);
  assert.match(serialized, /service\.called/u);
});

test('waitFor timeout and abort clean every waiter', async () => {
  const { runtime, caller } = setup();
  const token = service('example.missing', 'late');
  await assert.rejects(caller.services.waitFor(token, { timeoutMs: 2 }), errorCode('CALL_TIMEOUT'));
  assert.equal(runtime.port.diagnostics().waiters, 0);
  const controller = new AbortController();
  const waiting = caller.services.waitFor(token, { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, errorCode('CALL_ABORTED'));
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
    provider.services.expose(serviceToken, () => ({ ok: true }));
    caller.events.subscribe(eventToken, () => {});
    await caller.services.call(serviceToken, {});
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
