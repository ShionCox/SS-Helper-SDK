import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('SDK server plugin creates a shared database and enforces workspace ownership', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-sdk-'));
  const previous = process.env.SS_HELPER_ST_ROOT;
  process.env.SS_HELPER_ST_ROOT = root;
  try {
    const routes = new Map();
    const router = {
      get(route, handler) { routes.set(`GET ${route}`, handler); },
      post(route, handler) { routes.set(`POST ${route}`, handler); },
    };
    const module = await import(`../server-plugin/index.js?test=${Date.now()}`);
    assert.equal(module.__test.resolveDatabasePath({ stRoot: null, dataRoot: path.join(root, 'isolated-data') }), path.join(root, 'isolated-data', '_ss-helper', 'ss-helper.sqlite3'));
    await module.init(router);
    const invoke = async (method, route, request) => {
      let status = 200; let payload;
      const response = { status(code) { status = code; return response; }, json(value) { payload = value; return response; }, sendFile() { return response; } };
      await routes.get(`${method} ${route}`)(request, response);
      return { status, payload };
    };
    const caller = (plugin) => ({ headers: { 'x-ss-helper-plugin': plugin }, body: {} });
    let result = await invoke('POST', '/v2/workspaces/open', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', create: true } });
    assert.equal(result.status, 200);
    result = await invoke('POST', '/v2/workspaces/open', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:中文 角色/测试', create: true } });
    assert.equal(result.status, 200);
    result = await invoke('POST', '/v2/workspaces/record', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', recordId: 'fact-1', value: { text: 'shared' }, action: 'upsert' } });
    assert.equal(result.status, 200);
    result = await invoke('POST', '/v2/workspaces/record', { ...caller('ss-helper.llm'), body: { ownerPluginId: 'ss-helper.memory', workspaceId: 'character:hero', recordId: 'fact-1', action: 'get' } });
    assert.equal(result.status, 403);
    result = await invoke('POST', '/v2/workspaces/grant', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', granteePluginId: 'ss-helper.llm', actions: ['read'] } });
    assert.equal(result.status, 200);
    result = await invoke('POST', '/v2/workspaces/record', { ...caller('ss-helper.llm'), body: { ownerPluginId: 'ss-helper.memory', workspaceId: 'character:hero', recordId: 'fact-1', action: 'get' } });
    assert.equal(result.status, 200);
    result = await invoke('POST', '/v2/workspaces/grant', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', granteePluginId: 'ss-helper.llm', action: 'revoke' } });
    assert.equal(result.status, 200);
    result = await invoke('POST', '/v2/workspaces/transaction', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', idempotencyKey: 'tx-1', operations: [{ action: 'upsert', recordId: 'fact-2', value: { text: 'once' } }] } });
    assert.equal(result.status, 200);
    const replay = await invoke('POST', '/v2/workspaces/transaction', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', idempotencyKey: 'tx-1', operations: [{ action: 'upsert', recordId: 'fact-2', value: { text: 'twice' } }] } });
    assert.deepEqual({ ...replay.payload, replayed: false }, result.payload);
    result = await invoke('POST', '/v2/workspaces/collection', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', name: 'facts', indexes: ['sourceChatKey', 'priority'] } });
    assert.equal(result.status, 200);
    for (const [recordId, sourceChatKey, priority] of [['fact-a', 'chat:a', 2], ['fact-b', 'chat:a', 1], ['fact-c', 'chat:b', 3]]) {
      result = await invoke('POST', '/v2/workspaces/record', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', collection: 'facts', recordId, value: { sourceChatKey, priority }, action: 'upsert' } });
      assert.equal(result.status, 200);
    }
    result = await invoke('POST', '/v2/workspaces/query', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', collection: 'facts', filter: { sourceChatKey: 'chat:a' }, orderBy: { field: 'priority', direction: 'asc' }, limit: 1 } });
    assert.equal(result.payload.records[0].recordId, 'fact-b');
    assert.equal(typeof result.payload.nextCursor, 'string');
    const secondPage = await invoke('POST', '/v2/workspaces/query', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', collection: 'facts', filter: { sourceChatKey: 'chat:a' }, orderBy: { field: 'priority', direction: 'asc' }, cursor: result.payload.nextCursor, limit: 1 } });
    assert.equal(secondPage.payload.records[0].recordId, 'fact-a');
    const unindexed = await invoke('POST', '/v2/workspaces/query', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', collection: 'facts', filter: { text: 'no index' } } });
    assert.equal(unindexed.payload.error, 'WORKSPACE_INDEX_REQUIRED');
    result = await invoke('POST', '/v2/workspaces/vector', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', recordId: 'fact-1', vector: [1, 0], model: 'test', metadata: { source: 'chat:a' } } });
    assert.equal(result.status, 200);
    result = await invoke('POST', '/v2/workspaces/vector/search', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', vector: [1, 0], limit: 1 } });
    assert.equal(result.payload.hits[0].recordId, 'fact-1');
    assert.deepEqual(result.payload.hits[0].metadata, { source: 'chat:a' });
    const vectors = await invoke('POST', '/v2/workspaces/vector/list', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', metadata: { source: 'chat:a' } } });
    assert.equal(vectors.payload.vectors.length, 1);
    const exported = await invoke('POST', '/v2/workspaces/backup/export', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero' } });
    assert.equal(exported.status, 200);
    assert.equal(exported.payload.archive.format, 'ss-helper-workspace');
    result = await invoke('POST', '/v2/workspaces/backup/import', { ...caller('ss-helper.memory'), body: { workspaceId: 'character:hero', archive: exported.payload.archive, sha256: exported.payload.sha256 } });
    assert.equal(result.status, 200);
    const exportedAll = await invoke('GET', '/v2/workspaces/backup/export-all', caller('ss-helper.memory'));
    assert.equal(exportedAll.payload.archive.ownerPluginId, 'ss-helper.memory');
    assert.equal(exportedAll.payload.archive.workspaces.length, 2);
    result = await invoke('POST', '/v2/workspaces/clear-owned', { ...caller('ss-helper.memory'), body: { preserveWorkspaceIds: ['character:hero'] } });
    assert.equal(result.payload.removed, 1);
    const listed = await invoke('POST', '/v2/workspaces/list', caller('ss-helper.memory'));
    assert.deepEqual(listed.payload.workspaces.map((item) => item.workspaceId), ['character:hero']);
    assert.equal(routes.has('GET /v1/memory/health'), false);
    module.exit();
  } finally {
    if (previous === undefined) delete process.env.SS_HELPER_ST_ROOT;
    else process.env.SS_HELPER_ST_ROOT = previous;
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* Windows may retain SQLite WAL handles until process exit. */ }
  }
});

test('SDK server bridge encrypts secrets while browser secret routes stay gone', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-sdk-secret-'));
  const previous = process.env.SS_HELPER_ST_ROOT;
  process.env.SS_HELPER_ST_ROOT = root;
  process.env.SS_HELPER_SDK_SERVER_CAPABILITIES = JSON.stringify({ 'ss-helper.sdk.test': ['workspace.read', 'workspace.write', 'secrets.read', 'secrets.write'] });
  try {
    const routes = new Map();
    const router = { get(route, handler) { routes.set(`GET ${route}`, handler); }, post(route, handler) { routes.set(`POST ${route}`, handler); } };
    const module = await import(`../server-plugin/index.js?secret-test=${Date.now()}`);
    await module.init(router);
    const invoke = async (method, route, request) => { let status = 200; let payload; const response = { status(code) { status = code; return response; }, json(value) { payload = value; return response; }, sendFile() { return response; } }; await routes.get(`${method} ${route}`)(request, response); return { status, payload }; };
    const legacy = await invoke('POST', '/v1/workspaces/secret', { headers: {}, body: {} });
    assert.equal(legacy.status, 410); assert.equal(legacy.payload.error, 'SECRET_API_REMOVED');
    const { connectServerPlugin } = await import(`../packages/sdk/dist/server.js?secret-client=${Date.now()}`);
    const server = await connectServerPlugin({ pluginId: 'ss-helper.sdk.test', capabilities: ['workspace.read', 'workspace.write', 'secrets.read', 'secrets.write'] });
    await server.workspace.open({ workspaceId: 'llm:global', create: true });
    const metadata = await server.secrets.set({ workspaceId: 'llm:global', secretId: 'resource:demo:api-key', value: 'sk-test-secret', metadata: { label: 'Demo' } });
    assert.equal(metadata.maskedValue, 'sk-t***cret');
    assert.equal((await server.secrets.get({ workspaceId: 'llm:global', secretId: 'resource:demo:api-key' })).value, 'sk-test-secret');
    assert.equal(JSON.stringify(await server.workspace.exportAll()).includes('sk-test-secret'), false);
    assert.throws(() => globalThis[Symbol.for('@ss-helper/sdk.server.v2')].connect({ pluginId: 'other.plugin', capabilities: ['secrets.read'] }), { code: 'SERVER_CAPABILITY_DENIED' });
    const dbBytes = readFileSync(path.join(root, 'data', '_ss-helper', 'ss-helper.sqlite3'));
    assert.equal(dbBytes.includes(Buffer.from('sk-test-secret')), false);
    server.dispose(); module.exit();
  } finally {
    if (previous === undefined) delete process.env.SS_HELPER_ST_ROOT; else process.env.SS_HELPER_ST_ROOT = previous;
    delete process.env.SS_HELPER_SDK_SERVER_CAPABILITIES;
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* ignore Windows sqlite handles */ }
  }
});
