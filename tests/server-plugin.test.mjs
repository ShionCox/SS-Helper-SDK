import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const BRIDGE_ROUTE = '/internal/bridge/v1/call';

function createRouter() {
  const routes = new Map();
  return {
    routes,
    router: {
      get(route, handler) { routes.set(`GET ${route}`, handler); },
      post(route, handler) { routes.set(`POST ${route}`, handler); },
    },
  };
}

async function invoke(routes, method, route, request) {
  let status = 200; let payload;
  const response = {
    status(code) { status = code; return response; },
    json(value) { payload = value; return response; },
    sendFile(file) { payload = { file }; return response; },
  };
  const handler = routes.get(`${method} ${route}`);
  assert.ok(handler, `missing ${method} ${route}`);
  await handler(request, response);
  return { status, payload };
}

async function bridge(routes, pluginId, operation, input = {}, headers = {}) {
  return invoke(routes, 'POST', BRIDGE_ROUTE, {
    headers,
    body: { version: 1, pluginId, operation, input },
  });
}

function restoreEnv(name, previous) {
  if (previous === undefined) delete process.env[name]; else process.env[name] = previous;
}

test('SDK internal bridge owns all browser workspace CRUD and rejects old public routes', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-sdk-'));
  const previous = process.env.SS_HELPER_ST_ROOT;
  process.env.SS_HELPER_ST_ROOT = root;
  let module;
  try {
    const { routes, router } = createRouter();
    module = await import(`../server-plugin/index.js?bridge=${Date.now()}`);
    assert.equal(module.__test.resolveDatabasePath({ stRoot: null, dataRoot: path.join(root, 'isolated-data') }), path.join(root, 'isolated-data', '_ss-helper', 'ss-helper.sqlite3'));
    await module.init(router);
    assert.equal(routes.has('POST /v2/workspaces/open'), false);
    assert.equal(routes.has('GET /v2/health'), false);
    assert.equal(routes.has(`POST ${BRIDGE_ROUTE}`), true);
    assert.equal(routes.has('GET /artifact-manifest.json'), true);
    const manifest = await invoke(routes, 'GET', '/artifact-manifest.json', {});
    assert.equal(path.basename(manifest.payload.file), 'artifact-manifest.json');

    let result = await bridge(routes, 'ss-helper.memory', 'workspace.open', { workspaceId: 'character:hero', create: true }, { 'x-ss-helper-plugin': 'forged.plugin' });
    assert.equal(result.status, 200);
    assert.equal(result.payload.data.ownerPluginId, 'ss-helper.memory');
    assert.equal(result.payload.data.created, true);
    result = await bridge(routes, 'ss-helper.memory', 'workspace.open', { workspaceId: 'character:中文 角色/测试', create: true });
    assert.equal(result.status, 200);
    result = await bridge(routes, 'ss-helper.memory', 'workspace.upsert', { workspaceId: 'character:hero', recordId: 'fact-1', value: { text: 'shared' } });
    assert.equal(result.payload.data.recordId, 'fact-1');

    result = await bridge(routes, 'ss-helper.llm', 'workspace.get', { ownerPluginId: 'ss-helper.memory', workspaceId: 'character:hero', recordId: 'fact-1' });
    assert.equal(result.status, 403);
    assert.equal(result.payload.error, 'WORKSPACE_ACCESS_DENIED');
    result = await bridge(routes, 'ss-helper.memory', 'workspace.grant', { workspaceId: 'character:hero', granteePluginId: 'ss-helper.llm', actions: ['read'] });
    assert.equal(result.status, 200);
    result = await bridge(routes, 'ss-helper.llm', 'workspace.get', { ownerPluginId: 'ss-helper.memory', workspaceId: 'character:hero', recordId: 'fact-1' });
    assert.equal(result.payload.data.value.text, 'shared');
    result = await bridge(routes, 'ss-helper.memory', 'workspace.revoke', { workspaceId: 'character:hero', granteePluginId: 'ss-helper.llm' });
    assert.equal(result.status, 200);

    const first = await bridge(routes, 'ss-helper.memory', 'workspace.transaction', { workspaceId: 'character:hero', idempotencyKey: 'tx-1', operations: [{ action: 'upsert', recordId: 'fact-2', value: { text: 'once' } }] });
    const replay = await bridge(routes, 'ss-helper.memory', 'workspace.transaction', { workspaceId: 'character:hero', idempotencyKey: 'tx-1', operations: [{ action: 'upsert', recordId: 'fact-2', value: { text: 'twice' } }] });
    assert.deepEqual({ ...replay.payload.data, replayed: false }, first.payload.data);

    result = await bridge(routes, 'ss-helper.memory', 'workspace.defineCollection', { workspaceId: 'character:hero', name: 'facts', indexes: ['sourceChatKey', 'priority'] });
    assert.equal(result.status, 200);
    for (const [recordId, sourceChatKey, priority] of [['fact-a', 'chat:a', 2], ['fact-b', 'chat:a', 1], ['fact-c', 'chat:b', 3]]) {
      result = await bridge(routes, 'ss-helper.memory', 'workspace.upsert', { workspaceId: 'character:hero', collection: 'facts', recordId, value: { sourceChatKey, priority } });
      assert.equal(result.status, 200);
    }
    result = await bridge(routes, 'ss-helper.memory', 'workspace.query', { workspaceId: 'character:hero', collection: 'facts', filter: { sourceChatKey: 'chat:a' }, orderBy: { field: 'priority', direction: 'asc' }, limit: 1 });
    assert.equal(result.payload.data.records[0].recordId, 'fact-b');
    const secondPage = await bridge(routes, 'ss-helper.memory', 'workspace.query', { workspaceId: 'character:hero', collection: 'facts', filter: { sourceChatKey: 'chat:a' }, orderBy: { field: 'priority', direction: 'asc' }, cursor: result.payload.data.nextCursor, limit: 1 });
    assert.equal(secondPage.payload.data.records[0].recordId, 'fact-a');
    const unindexed = await bridge(routes, 'ss-helper.memory', 'workspace.query', { workspaceId: 'character:hero', collection: 'facts', filter: { text: 'no index' } });
    assert.equal(unindexed.payload.error, 'WORKSPACE_INDEX_REQUIRED');

    result = await bridge(routes, 'ss-helper.memory', 'workspace.vectorUpsert', { workspaceId: 'character:hero', recordId: 'fact-1', vector: [1, 0], model: 'test', metadata: { source: 'chat:a' } });
    assert.equal(result.status, 200);
    result = await bridge(routes, 'ss-helper.memory', 'workspace.vectorSearch', { workspaceId: 'character:hero', vector: [1, 0], limit: 1 });
    assert.equal(result.payload.data[0].recordId, 'fact-1');
    assert.deepEqual(result.payload.data[0].metadata, { source: 'chat:a' });

    const exported = await bridge(routes, 'ss-helper.memory', 'workspace.export', { workspaceId: 'character:hero' });
    assert.equal(exported.payload.data.archive.format, 'ss-helper-workspace');
    result = await bridge(routes, 'ss-helper.memory', 'workspace.import', { workspaceId: 'character:hero', archive: exported.payload.data.archive, sha256: exported.payload.data.sha256 });
    assert.equal(result.status, 200);
    result = await bridge(routes, 'ss-helper.memory', 'workspace.clearOwned', { preserveWorkspaceIds: ['character:hero'] });
    assert.equal(result.payload.data, 1);
    const health = await bridge(routes, 'ss-helper.memory', 'workspace.health');
    assert.equal(health.payload.data.ready, true);
    assert.match(health.payload.data.nodeVersion, /^v\d+/u);
    assert.equal(Number.isSafeInteger(health.payload.data.databaseSizeBytes), true);
    const forged = await invoke(routes, 'POST', BRIDGE_ROUTE, { headers: { 'x-ss-helper-plugin': 'ss-helper.memory' }, body: { version: 1, pluginId: 'forged.plugin', operation: 'workspace.health', input: {} } });
    assert.equal(forged.status, 403);
    assert.equal(forged.payload.error, 'SERVER_CAPABILITY_DENIED');
  } finally {
    module?.exit();
    restoreEnv('SS_HELPER_ST_ROOT', previous);
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* Windows may retain SQLite handles briefly. */ }
  }
});

test('SDK bridge health and confirmed recovery work when SQLite is corrupt', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-sdk-recovery-'));
  const previous = process.env.SS_HELPER_ST_ROOT;
  process.env.SS_HELPER_ST_ROOT = root;
  const workspace = path.join(root, 'data', '_ss-helper');
  const corruptDatabase = Buffer.from('not a sqlite database', 'utf8');
  const originalKey = Buffer.alloc(32, 7);
  mkdirSync(workspace, { recursive: true });
  writeFileSync(path.join(workspace, 'ss-helper.sqlite3'), corruptDatabase);
  writeFileSync(path.join(workspace, 'ss-helper-secrets.key'), originalKey);
  let module;
  try {
    const { routes, router } = createRouter();
    module = await import(`../server-plugin/index.js?recovery=${Date.now()}`);
    await module.init(router);
    const health = await bridge(routes, 'ss-helper.memory', 'workspace.health');
    assert.equal(health.status, 200);
    assert.equal(health.payload.data.ready, false);
    assert.equal(health.payload.data.status, 'degraded');
    assert.equal(health.payload.data.errorCode, 'WORKSPACE_DATABASE_UNAVAILABLE');
    assert.equal(health.payload.data.recoverable, true);
    assert.equal(JSON.stringify(health.payload).includes(root), false);
    assert.equal(JSON.stringify(health.payload).includes('not a sqlite database'), false);
    const denied = await bridge(routes, 'ss-helper.llm', 'workspace.repair', { confirm: true });
    assert.equal(denied.status, 403);
    assert.equal(denied.payload.error, 'SERVER_CAPABILITY_DENIED');
    const unconfirmed = await bridge(routes, 'ss-helper.memory', 'workspace.repair', {});
    assert.equal(unconfirmed.status, 400);
    assert.equal(unconfirmed.payload.error, 'WORKSPACE_RECOVERY_CONFIRMATION_REQUIRED');
    const repaired = await bridge(routes, 'ss-helper.memory', 'workspace.repair', { confirm: true });
    assert.equal(repaired.status, 200);
    assert.equal(repaired.payload.data.requiresReload, true);
    assert.match(repaired.payload.data.backupId, /^ss-helper-recovery-/u);
    const backup = path.join(root, 'backups', repaired.payload.data.backupId);
    assert.equal(existsSync(path.join(backup, 'ss-helper-recovery-manifest.json')), true);
    assert.deepEqual(readFileSync(path.join(backup, 'ss-helper.sqlite3')), corruptDatabase);
    assert.deepEqual(readFileSync(path.join(backup, 'ss-helper-secrets.key')), originalKey);
    const manifest = JSON.parse(readFileSync(path.join(backup, 'ss-helper-recovery-manifest.json'), 'utf8'));
    assert.equal(manifest.files.some((file) => file.path === 'ss-helper.sqlite3' && file.sha256.length === 64), true);
    const healthy = await bridge(routes, 'ss-helper.memory', 'workspace.health');
    assert.equal(healthy.payload.data.ready, true);
    assert.equal(healthy.payload.data.status, 'ready');
  } finally {
    module?.exit();
    restoreEnv('SS_HELPER_ST_ROOT', previous);
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* ignore Windows SQLite handles */ }
  }
});

test('SDK bridge stores secrets encrypted and limits them to the LLM policy entry', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-sdk-secret-'));
  const previous = process.env.SS_HELPER_ST_ROOT;
  process.env.SS_HELPER_ST_ROOT = root;
  let module;
  try {
    const { routes, router } = createRouter();
    module = await import(`../server-plugin/index.js?secret=${Date.now()}`);
    await module.init(router);
    await bridge(routes, 'ss-helper.llm', 'workspace.open', { workspaceId: 'llm:global', create: true });
    const metadata = await bridge(routes, 'ss-helper.llm', 'secrets.set', { workspaceId: 'llm:global', secretId: 'resource:demo:api-key', value: 'sk-test-secret', metadata: { label: 'Demo' } });
    assert.equal(metadata.payload.data.maskedValue, 'sk-t***cret');
    const value = await bridge(routes, 'ss-helper.llm', 'secrets.get', { workspaceId: 'llm:global', secretId: 'resource:demo:api-key' });
    assert.equal(value.payload.data.value, 'sk-test-secret');
    const denied = await bridge(routes, 'ss-helper.memory', 'secrets.get', { workspaceId: 'llm:global', secretId: 'resource:demo:api-key' });
    assert.equal(denied.status, 403);
    assert.equal(denied.payload.error, 'SERVER_CAPABILITY_DENIED');
    const dbBytes = readFileSync(path.join(root, 'data', '_ss-helper', 'ss-helper.sqlite3'));
    assert.equal(dbBytes.includes(Buffer.from('sk-test-secret')), false);
  } finally {
    module?.exit();
    restoreEnv('SS_HELPER_ST_ROOT', previous);
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* ignore Windows SQLite handles */ }
  }
});
