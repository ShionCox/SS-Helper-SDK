import assert from 'node:assert/strict';
import test from 'node:test';

import { InternalBridgeClient } from '../apps/core-extension/dist/bridge/internal-bridge.js';
import { ResourceScope } from '../apps/core-extension/dist/plugins/session-scope.js';

function scope() {
  return new ResourceScope('ss-helper.memory', 1, () => true);
}

test('internal bridge waits through startup 404s and then executes the real call once', async () => {
  const operations = [];
  let healthAttempts = 0;
  const client = new InternalBridgeClient({
    request: {
      async send(request) {
        const operation = request.body.operation;
        operations.push(operation);
        if (operation === 'workspace.health' && healthAttempts++ < 2) {
          return { status: 404, ok: false, body: 'Not Found' };
        }
        if (operation === 'workspace.health') {
          return { status: 200, ok: true, body: { ok: true, data: { ready: true } } };
        }
        return { status: 200, ok: true, body: { ok: true, data: { saved: true } } };
      },
    },
  }, { startupDeadlineMs: 100, startupRetryDelaysMs: [0] });

  const result = await client.call(scope(), 'ss-helper.memory', 'workspace.upsert', { recordId: 'settings' });
  assert.deepEqual(result, { saved: true });
  assert.deepEqual(operations, ['workspace.health', 'workspace.health', 'workspace.health', 'workspace.upsert']);
});

test('concurrent startup calls share one readiness probe instead of spamming the missing route', async () => {
  const operations = [];
  let release;
  const firstHealth = new Promise(resolve => { release = resolve; });
  const client = new InternalBridgeClient({
    request: {
      async send(request) {
        const operation = request.body.operation;
        operations.push(operation);
        if (operation === 'workspace.health') {
          await firstHealth;
          return { status: 200, ok: true, body: { ok: true, data: { ready: true } } };
        }
        return { status: 200, ok: true, body: { ok: true, data: operation } };
      },
    },
  }, { startupDeadlineMs: 100, startupRetryDelaysMs: [0] });

  const activeScope = scope();
  const first = client.call(activeScope, 'ss-helper.memory', 'workspace.get', {});
  const second = client.call(activeScope, 'ss-helper.memory', 'workspace.list', {});
  await Promise.resolve();
  assert.deepEqual(operations, ['workspace.health']);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['workspace.get', 'workspace.list']);
  assert.equal(operations.filter(operation => operation === 'workspace.health').length, 1);
});

test('handled bridge errors are not retried as startup failures', async () => {
  const operations = [];
  const client = new InternalBridgeClient({
    request: {
      async send(request) {
        const operation = request.body.operation;
        operations.push(operation);
        if (operation === 'workspace.health') {
          return { status: 200, ok: true, body: { ok: true, data: { ready: true } } };
        }
        return { status: 409, ok: false, body: { ok: false, error: 'WORKSPACE_CONFLICT', details: { stage: 'server.workspace', requestId: request.body.requestId } } };
      },
    },
  }, { startupDeadlineMs: 100, startupRetryDelaysMs: [0] });

  await assert.rejects(
    client.call(scope(), 'ss-helper.memory', 'workspace.upsert', {}),
    error => error?.code === 'CONFLICT'
      && error?.details?.reasonCode === 'WORKSPACE_CONFLICT'
      && error?.details?.stage === 'server.workspace',
  );
  assert.deepEqual(operations, ['workspace.health', 'workspace.upsert']);
});

test('invalid payload exposes only the server safe validation reason', async () => {
  const client = new InternalBridgeClient({
    request: {
      async send(request) {
        if (request.body.operation === 'workspace.health') {
          return { status: 200, ok: true, body: { ok: true, data: { ready: true } } };
        }
        return {
          status: 400,
          ok: false,
          body: { ok: false, error: 'INVALID_PAYLOAD', details: { stage: 'server.validation', requestId: request.body.requestId } },
        };
      },
    },
  }, { startupDeadlineMs: 100, startupRetryDelaysMs: [0] });

  await assert.rejects(
    client.call(scope(), 'ss-helper.memory', 'workspace.commit', {}),
    error => error?.code === 'INVALID_PAYLOAD'
      && error?.details?.reasonCode === 'INVALID_PAYLOAD'
      && error?.message === '请求参数无效',
  );
});

test('structured missing-workspace result is returned once and never mistaken for a missing route', async () => {
  const operations = [];
  const client = new InternalBridgeClient({
    request: {
      async send(request) {
        const operation = request.body.operation;
        operations.push(operation);
        if (operation === 'workspace.health') {
          return { status: 200, ok: true, body: { ok: true, data: { ready: true } } };
        }
        return { status: 200, ok: true, body: { ok: false, error: 'WORKSPACE_NOT_FOUND', details: { stage: 'server.workspace', requestId: request.body.requestId } } };
      },
    },
  }, { startupDeadlineMs: 100, startupRetryDelaysMs: [0] });

  await assert.rejects(
    client.call(scope(), 'ss-helper.memory', 'workspace.get', {}),
    error => error?.code === 'NOT_FOUND' && error?.details?.reasonCode === 'WORKSPACE_NOT_FOUND',
  );
  assert.deepEqual(operations, ['workspace.health', 'workspace.get']);
});
