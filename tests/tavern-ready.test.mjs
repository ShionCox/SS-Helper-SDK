import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForTavernReady } from '../packages/sdk/dist/index.js';

class ReplayEmitter {
  #listeners = new Map();
  #emitted = new Set();

  on(name, listener) {
    const listeners = this.#listeners.get(name) ?? [];
    listeners.push(listener);
    this.#listeners.set(name, listeners);
    if (this.#emitted.has(name)) listener();
  }

  removeListener(name, listener) {
    this.#listeners.set(name, (this.#listeners.get(name) ?? []).filter((candidate) => candidate !== listener));
  }

  emit(name) {
    this.#emitted.add(name);
    for (const listener of [...(this.#listeners.get(name) ?? [])]) listener();
  }
}

test('waitForTavernReady waits for APP_READY and supports the emitter replay path', async () => {
  const emitter = new ReplayEmitter();
  const target = {
    SillyTavern: { getContext: () => ({ eventSource: emitter, eventTypes: { APP_READY: 'app_ready' } }) },
  };
  const pending = waitForTavernReady({ target, timeoutMs: 100 });
  setTimeout(() => emitter.emit('app_ready'), 5);
  assert.deepEqual(await pending, { appReadyEvent: 'app_ready' });
  assert.deepEqual(await waitForTavernReady({ target, timeoutMs: 100 }), { appReadyEvent: 'app_ready' });
});

test('waitForTavernReady times out safely and a later host can retry', async () => {
  const target = {};
  await assert.rejects(
    waitForTavernReady({ target, timeoutMs: 1 }),
    (error) => error?.code === 'HOST_NOT_READY',
  );
  const emitter = new ReplayEmitter();
  target.SillyTavern = { getContext: () => ({ eventSource: emitter, eventTypes: { APP_READY: 'app_ready' } }) };
  const pending = waitForTavernReady({ target, timeoutMs: 100 });
  emitter.emit('app_ready');
  assert.equal((await pending).appReadyEvent, 'app_ready');
});
