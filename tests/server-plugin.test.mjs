import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const BRIDGE_ROUTE = '/internal/bridge/v0/call';

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
  let status = 200; let payload; const headers = {};
  const response = {
    status(code) { status = code; return response; },
    json(value) { payload = value; return response; },
    sendFile(file) { payload = { file }; return response; },
    setHeader(name, value) { headers[String(name).toLowerCase()] = String(value); return response; },
  };
  const handler = routes.get(`${method} ${route}`);
  assert.ok(handler, `missing ${method} ${route}`);
  await handler({
    user: { profile: { handle: 'default-user' }, directories: { root: path.join(process.env.SS_HELPER_ST_ROOT, 'data', 'default-user') } },
    ...request,
  }, response);
  return { status, payload, headers };
}

async function bridge(routes, pluginId, operation, input = {}, headers = {}) {
  return invoke(routes, 'POST', BRIDGE_ROUTE, {
    headers,
    body: { version: 0, pluginId, operation, requestId: `test:${pluginId}:${operation}`, input },
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
    const completeResponse = module.__test.httpResponseResult({
      status: 200, bytes: Buffer.from('{"ok":true}', 'utf8'), contentType: 'application/json',
    });
    assert.deepEqual(completeResponse, { status: 200, ok: true, body: { ok: true }, contentType: 'application/json', receivedBytes: 11 });
    const incompleteResponse = module.__test.httpResponseResult({
      status: 200, bytes: Buffer.from('data: {"partial":true', 'utf8'), contentType: 'text/event-stream', incomplete: true,
    });
    assert.deepEqual(incompleteResponse, {
      status: 200, ok: true, body: 'data: {"partial":true', contentType: 'text/event-stream', receivedBytes: 21, incomplete: true,
    });
    assert.equal(module.__test.resolveDatabasePath({ stRoot: null, dataRoot: path.join(root, 'isolated-data') }), path.join(root, 'isolated-data', '_ss-helper-v0', 'ss-helper.sqlite3'));
    let dnsLookups = 0;
    const pinned = await module.__test.safeOutboundUrl('https://api.example.test/v1', async () => {
      dnsLookups += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    });
    const pinnedAddress = await new Promise((resolve, reject) => pinned.lookup('api.example.test', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
    assert.deepEqual(pinnedAddress, { address: '93.184.216.34', family: 4 });
    assert.equal(dnsLookups, 1, 'the validated address is pinned and no second DNS lookup occurs during connect');
    await assert.rejects(new Promise((resolve, reject) => pinned.lookup('rebound.example.test', {}, (error, address) => error ? reject(error) : resolve(address))));
    await module.init(router);
    assert.equal(routes.has(`POST ${BRIDGE_ROUTE}`), true);
    assert.equal(routes.has('GET /artifact-manifest.json'), true);
    const manifest = await invoke(routes, 'GET', '/artifact-manifest.json', {});
    assert.equal(path.basename(manifest.payload.file), 'artifact-manifest.json');
    assert.equal(manifest.headers['cache-control'], 'no-store');

    const schema = { collections: [{ name: 'default', indexes: [] }, { name: 'facts', indexes: ['sourceChatKey', 'priority'] }] };
    let result = await bridge(routes, 'ss-helper.memory', 'workspace.open', { id: 'character:hero', schema }, { 'x-ss-helper-plugin': 'forged.plugin' });
    assert.equal(result.status, 200);
    assert.equal(result.payload.data.ownerPluginId, 'ss-helper.memory');
    assert.equal(result.payload.data.created, true);
    const missingWorkspace = await bridge(routes, 'ss-helper.memory', 'workspace.query', {
      workspaceId: 'character:never-opened',
      collection: 'facts',
      filter: { chatKey: 'chat:missing' },
      limit: 1,
    });
    assert.equal(missingWorkspace.status, 200);
    assert.equal(missingWorkspace.payload.ok, false);
    assert.equal(missingWorkspace.payload.error, 'WORKSPACE_NOT_FOUND');
    result = await bridge(routes, 'ss-helper.memory', 'workspace.open', { id: 'character:中文 角色/测试', schema });
    assert.equal(result.status, 200);
    result = await bridge(routes, 'ss-helper.memory', 'workspace.commit', { id: 'character:hero', idempotencyKey: 'put-1', operations: [{ action: 'put', collection: 'default', id: 'fact-1', value: { text: 'shared' } }] });
    assert.equal(result.payload.data.results[0].recordId, 'fact-1');
    const oversized = await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
      id: 'character:hero', idempotencyKey: 'oversized-audit', operations: [
        { action: 'put', collection: 'default', id: 'before-oversize', value: { text: 'must roll back' } },
        { action: 'put', collection: 'default', id: 'oversized', value: { text: 'x'.repeat(1024 * 1024) } },
      ],
    });
    assert.equal(oversized.status, 400);
    assert.equal(oversized.payload.details.reasonCode, 'WORKSPACE_RECORD_TOO_LARGE');
    assert.equal(oversized.payload.details.collection, 'default');
    assert.equal(oversized.payload.details.stage, 'server.workspace.write');
    assert.equal(oversized.payload.details.requestId, 'test:ss-helper.memory:workspace.commit');
    const rolledBackSize = await bridge(routes, 'ss-helper.memory', 'workspace.get', { workspaceId: 'character:hero', collection: 'default', recordId: 'before-oversize' });
    assert.equal(rolledBackSize.payload.data, null);
    const createdForResurrection = await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
      id: 'character:hero',
      idempotencyKey: 'resurrection-put-1',
      operations: [{ action: 'put', collection: 'default', id: 'fact-resurrect', value: { text: 'first' }, expectedRevision: 0 }],
    });
    assert.equal(createdForResurrection.payload.data.results[0].revision, 1);
    const tombstoned = await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
      id: 'character:hero',
      idempotencyKey: 'resurrection-delete',
      operations: [{ action: 'delete', collection: 'default', id: 'fact-resurrect', expectedRevision: 1 }],
    });
    assert.equal(tombstoned.payload.data.results[0].revision, 2);
    const logicallyMissing = await bridge(routes, 'ss-helper.memory', 'workspace.get', {
      workspaceId: 'character:hero',
      collection: 'default',
      recordId: 'fact-resurrect',
    });
    assert.equal(logicallyMissing.payload.data, null);
    const deletedAgain = await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
      id: 'character:hero',
      idempotencyKey: 'resurrection-delete-idempotent',
      operations: [{ action: 'delete', collection: 'default', id: 'fact-resurrect', expectedRevision: 0 }],
    });
    assert.equal(deletedAgain.payload.data.results[0].removed, false);
    assert.equal(deletedAgain.payload.data.results[0].revision, 2);
    const resurrected = await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
      id: 'character:hero',
      idempotencyKey: 'resurrection-put-2',
      operations: [{ action: 'put', collection: 'default', id: 'fact-resurrect', value: { text: 'second' }, expectedRevision: 0 }],
    });
    assert.equal(resurrected.payload.data.results[0].revision, 3);
    const restored = await bridge(routes, 'ss-helper.memory', 'workspace.get', {
      workspaceId: 'character:hero',
      collection: 'default',
      recordId: 'fact-resurrect',
    });
    assert.equal(restored.payload.data.revision, 3);
    assert.deepEqual(restored.payload.data.value, { text: 'second' });
    const invalidRecord = await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
      id: 'character:hero',
      idempotencyKey: 'invalid-record',
      operations: [{ action: 'put', collection: 'default', id: '中文记录', value: { text: 'rejected' } }],
    });
    assert.equal(invalidRecord.status, 400);
    assert.equal(invalidRecord.payload.error, 'INVALID_PAYLOAD');
    assert.equal(invalidRecord.payload.details.reasonCode, 'INVALID_PAYLOAD');
    assert.equal(invalidRecord.payload.details.stage, 'server.validation');
    const invalidRead = await bridge(routes, 'ss-helper.memory', 'workspace.get', {
      workspaceId: 'character:hero',
      collection: 'facts',
      recordId: '中文记录',
    });
    assert.equal(invalidRead.payload.details.reasonCode, 'INVALID_PAYLOAD');

    result = await bridge(routes, 'ss-helper.llm', 'workspace.get', { ownerPluginId: 'ss-helper.memory', workspaceId: 'character:hero', recordId: 'fact-1' });
    assert.equal(result.payload.error, 'WORKSPACE_NOT_FOUND');

    const first = await bridge(routes, 'ss-helper.memory', 'workspace.commit', { id: 'character:hero', idempotencyKey: 'tx-1', operations: [{ action: 'put', collection: 'default', id: 'fact-2', value: { text: 'once' } }] });
    const replay = await bridge(routes, 'ss-helper.memory', 'workspace.commit', { id: 'character:hero', idempotencyKey: 'tx-1', operations: [{ action: 'put', collection: 'default', id: 'fact-2', value: { text: 'twice' } }] });
    assert.deepEqual({ ...replay.payload.data, replayed: false }, first.payload.data);

    result = await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
      id: 'character:hero',
      idempotencyKey: 'facts-1',
      operations: [['fact-a', 'chat:a', 2], ['fact-b', 'chat:a', 1], ['fact-c', 'chat:b', 3]]
        .map(([id, sourceChatKey, priority]) => ({ action: 'put', collection: 'facts', id, value: { sourceChatKey, priority } })),
    });
    assert.equal(result.status, 200);
    result = await bridge(routes, 'ss-helper.memory', 'workspace.query', { workspaceId: 'character:hero', collection: 'facts', filter: { sourceChatKey: 'chat:a' }, orderBy: { field: 'priority', direction: 'asc' }, limit: 1, includeTotal: true });
    assert.equal(result.payload.data.records[0].recordId, 'fact-b');
    assert.equal(result.payload.data.total, 2);
    const secondPage = await bridge(routes, 'ss-helper.memory', 'workspace.query', { workspaceId: 'character:hero', collection: 'facts', filter: { sourceChatKey: 'chat:a' }, orderBy: { field: 'priority', direction: 'asc' }, cursor: result.payload.data.nextCursor, limit: 1 });
    assert.equal(secondPage.payload.data.records[0].recordId, 'fact-a');
    const byRecordId = await bridge(routes, 'ss-helper.memory', 'workspace.query', {
      workspaceId: 'character:hero',
      collection: 'facts',
      where: [{ field: 'recordId', op: 'in', value: ['fact-a', 'fact-c'] }],
      orderBy: { field: 'recordId', direction: 'asc' },
      includeTotal: true,
    });
    assert.deepEqual(byRecordId.payload.data.records.map(item => item.recordId), ['fact-a', 'fact-c']);
    assert.equal(byRecordId.payload.data.total, 2);
    const unindexed = await bridge(routes, 'ss-helper.memory', 'workspace.query', { workspaceId: 'character:hero', collection: 'facts', filter: { text: 'no index' } });
    assert.equal(unindexed.payload.error, 'WORKSPACE_INDEX_REQUIRED');

    result = await bridge(routes, 'ss-helper.memory', 'workspace.vectorUpsert', { workspaceId: 'character:hero', recordId: 'fact-1', vector: [1, 0], model: 'test', metadata: { source: 'chat:a' } });
    assert.equal(result.status, 200);
    result = await bridge(routes, 'ss-helper.memory', 'workspace.vectorSearch', { workspaceId: 'character:hero', vector: [1, 0], limit: 1 });
    assert.equal(result.payload.data[0].recordId, 'fact-1');
    assert.deepEqual(result.payload.data[0].metadata, { source: 'chat:a' });
    const vectorRecord = await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
      id: 'character:hero', idempotencyKey: 'vector-delete-put',
      operations: [{ action: 'put', collection: 'default', id: 'fact-vector-deleted', value: { text: 'temporary' }, expectedRevision: 0 }],
    });
    assert.equal(vectorRecord.payload.data.results[0].revision, 1);
    await bridge(routes, 'ss-helper.memory', 'workspace.vectorUpsert', { workspaceId: 'character:hero', recordId: 'fact-vector-deleted', vector: [0, 1], model: 'test' });
    await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
      id: 'character:hero', idempotencyKey: 'vector-delete-record',
      operations: [{ action: 'delete', collection: 'default', id: 'fact-vector-deleted', expectedRevision: 1 }],
    });
    const staleProjection = await bridge(routes, 'ss-helper.memory', 'workspace.vectorUpsert', { workspaceId: 'character:hero', recordId: 'fact-vector-deleted', vector: [0, 1], model: 'test' });
    assert.equal(staleProjection.payload.ok, false);
    assert.equal(staleProjection.payload.error, 'WORKSPACE_NOT_FOUND');
    const deletedVectorSearch = await bridge(routes, 'ss-helper.memory', 'workspace.vectorSearch', { workspaceId: 'character:hero', vector: [0, 1], limit: 10 });
    assert.equal(deletedVectorSearch.payload.data.some(item => item.recordId === 'fact-vector-deleted'), false);

    const exported = await bridge(routes, 'ss-helper.memory', 'workspace.backup', { id: 'character:hero' });
    assert.equal(exported.payload.data.archive.format, 'ss-helper-workspace');
    assert.equal(
      exported.payload.data.archive.vectors.some(item => item.recordId === 'fact-vector-deleted'),
      false,
      'workspace backup excludes vectors whose source record is tombstoned',
    );
    result = await bridge(routes, 'ss-helper.memory', 'workspace.reset', { preserveIds: ['character:hero'] });
    assert.equal(result.payload.data, 1);
    const health = await bridge(routes, 'ss-helper.memory', 'workspace.health');
    assert.equal(health.payload.data.ready, true);
    assert.match(health.payload.data.nodeVersion, /^v\d+/u);
    assert.equal(Number.isSafeInteger(health.payload.data.databaseSizeBytes), true);
    const forged = await invoke(routes, 'POST', BRIDGE_ROUTE, { headers: { 'x-ss-helper-plugin': 'ss-helper.memory' }, body: { version: 0, pluginId: 'forged.plugin', operation: 'workspace.health', requestId: 'test:forged', input: {} } });
    assert.equal(forged.status, 403);
    assert.equal(forged.payload.error, 'SERVER_CAPABILITY_DENIED');
  } finally {
    module?.exit();
    restoreEnv('SS_HELPER_ST_ROOT', previous);
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* Windows may retain SQLite handles briefly. */ }
  }
});

test('SDK server init registers the private bridge before deferred storage warmup', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-sdk-route-first-'));
  const previous = process.env.SS_HELPER_ST_ROOT;
  process.env.SS_HELPER_ST_ROOT = root;
  let module;
  try {
    const { routes, router } = createRouter();
    module = await import(`../server-plugin/index.js?route-first=${Date.now()}`);
    const initialized = module.init(router);
    assert.equal(routes.has(`POST ${BRIDGE_ROUTE}`), true, 'bridge route must exist synchronously during init');
    await initialized;
    const health = await bridge(routes, 'ss-helper.memory', 'workspace.health');
    assert.equal(health.status, 200);
    assert.equal(health.payload.data.ready, true);
  } finally {
    module?.exit();
    restoreEnv('SS_HELPER_ST_ROOT', previous);
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* ignore Windows SQLite handles */ }
  }
});

test('SDK bridge health and confirmed recovery work when SQLite is corrupt', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-sdk-recovery-'));
  const previous = process.env.SS_HELPER_ST_ROOT;
  process.env.SS_HELPER_ST_ROOT = root;
  const workspace = path.join(root, 'data', '_ss-helper-v0');
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
    assert.equal(health.payload.data.failure.reasonCode, 'WORKSPACE_DATABASE_UNAVAILABLE');
    assert.equal(health.payload.data.failure.stage, 'server.workspace');
    assert.equal(health.payload.data.recoverable, true);
    assert.equal(JSON.stringify(health.payload).includes(root), false);
    assert.equal(JSON.stringify(health.payload).includes('not a sqlite database'), false);
    const denied = await bridge(routes, 'ss-helper.llm', 'workspace.repair', {});
    assert.equal(denied.status, 403);
    assert.equal(denied.payload.error, 'SERVER_CAPABILITY_DENIED');
    const repaired = await bridge(routes, 'ss-helper.memory', 'workspace.repair', {});
    assert.equal(repaired.status, 200);
    assert.equal(repaired.payload.data.requiresReload, true);
    const backupId = repaired.payload.data.backupId;
    assert.match(backupId, /^ss-helper-recovery-/u);
    const backup = path.join(root, 'backups', backupId);
    assert.equal(existsSync(path.join(backup, 'ss-helper-recovery-manifest.json')), true);
    assert.deepEqual(readFileSync(path.join(backup, 'ss-helper.sqlite3')), corruptDatabase);
    assert.deepEqual(readFileSync(path.join(backup, 'ss-helper-secrets.key')), originalKey);
    const manifest = JSON.parse(readFileSync(path.join(backup, 'ss-helper-recovery-manifest.json'), 'utf8'));
    assert.equal(manifest.files.some((file) => file.path === 'ss-helper.sqlite3' && file.sha256.length === 64), true);
    const healthy = await bridge(routes, 'ss-helper.memory', 'workspace.health');
    assert.equal(healthy.payload.data.ready, true);
    assert.equal(healthy.payload.data.status, 'ready');
    const unnecessary = await bridge(routes, 'ss-helper.memory', 'workspace.repair', {});
    assert.equal(unnecessary.status, 400);
    assert.equal(unnecessary.payload.error, 'WORKSPACE_RECOVERY_NOT_REQUIRED');
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
    const dbBytes = readFileSync(path.join(root, 'data', '_ss-helper-v0', 'ss-helper.sqlite3'));
    assert.equal(dbBytes.includes(Buffer.from('sk-test-secret')), false);
  } finally {
    module?.exit();
    restoreEnv('SS_HELPER_ST_ROOT', previous);
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* ignore Windows SQLite handles */ }
  }
});

test('SDK bridge rejects malformed commits, rolls back dedup failures and paginates nullable indexes', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-sdk-atomic-'));
  const previous = process.env.SS_HELPER_ST_ROOT;
  process.env.SS_HELPER_ST_ROOT = root;
  let module;
  let db;
  try {
    const { routes, router } = createRouter();
    module = await import(`../server-plugin/index.js?atomic=${Date.now()}`);
    await module.init(router);
    await bridge(routes, 'ss-helper.memory', 'workspace.open', { id: 'w', schema: { collections: [{ name: 'facts', indexes: ['rank'] }] } });
    await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
      id: 'w', idempotencyKey: 'seed',
      operations: [['a', null], ['b', null], ['x', 1], ['y', 2]].map(([id, rank]) => ({ action: 'put', collection: 'facts', id, value: { rank } })),
    });
    for (const action of ['oops', undefined]) {
      const invalid = await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
        id: 'w', idempotencyKey: `invalid:${String(action)}`, operations: [{ action, collection: 'facts', id: 'x' }],
      });
      assert.equal(invalid.payload.error, 'INVALID_PAYLOAD');
    }
    const noKey = await bridge(routes, 'ss-helper.memory', 'workspace.commit', {
      id: 'w', operations: [{ action: 'delete', collection: 'facts', id: 'x' }],
    });
    assert.equal(noKey.payload.error, 'INVALID_PAYLOAD');
    assert.equal((await bridge(routes, 'ss-helper.memory', 'workspace.get', { workspaceId: 'w', collection: 'facts', recordId: 'x' })).payload.data.revision, 1);

    for (const [direction, expected] of [['asc', ['a', 'b', 'x', 'y']], ['desc', ['y', 'x', 'b', 'a']]]) {
      const ids = [];
      let cursor;
      do {
        const page = await bridge(routes, 'ss-helper.memory', 'workspace.query', {
          workspaceId: 'w', collection: 'facts', orderBy: { field: 'rank', direction }, limit: 1, ...(cursor ? { cursor } : {}),
        });
        ids.push(...page.payload.data.records.map(row => row.recordId));
        cursor = page.payload.data.nextCursor;
        assert.ok(ids.length <= 4, 'pagination must make progress');
      } while (cursor);
      assert.deepEqual(ids, expected);
    }

    db = new DatabaseSync(module.__test.DB_PATH);
    db.exec("CREATE TRIGGER fail_dedup BEFORE INSERT ON workspace_request_dedup_v0 BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    const request = { id: 'w', idempotencyKey: 'atomic', operations: [{ action: 'put', collection: 'facts', id: 'new', value: { rank: 3 }, expectedRevision: 0 }] };
    assert.equal((await bridge(routes, 'ss-helper.memory', 'workspace.commit', request)).payload.ok, false);
    assert.equal((await bridge(routes, 'ss-helper.memory', 'workspace.get', { workspaceId: 'w', collection: 'facts', recordId: 'new' })).payload.data, null);
    assert.equal((await bridge(routes, 'ss-helper.memory', 'workspace.reset', { idempotencyKey: 'reset-atomic' })).payload.ok, false);
    assert.equal((await bridge(routes, 'ss-helper.memory', 'workspace.get', { workspaceId: 'w', collection: 'facts', recordId: 'x' })).payload.data.revision, 1);
    db.exec('DROP TRIGGER fail_dedup');
    assert.equal((await bridge(routes, 'ss-helper.memory', 'workspace.commit', request)).payload.data.replayed, false);
    assert.equal((await bridge(routes, 'ss-helper.memory', 'workspace.commit', request)).payload.data.replayed, true);
    assert.equal((await bridge(routes, 'ss-helper.memory', 'workspace.reset', { idempotencyKey: 'reset-atomic' })).payload.data, 1);
    assert.equal((await bridge(routes, 'ss-helper.memory', 'workspace.reset', { idempotencyKey: 'reset-atomic' })).payload.data, 1);
  } finally {
    db?.close();
    module?.exit();
    restoreEnv('SS_HELPER_ST_ROOT', previous);
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('SDK bridge isolates authenticated user records with absolute and host-relative directories while retaining default data', async () => {
  const root = mkdtempSync(path.join(process.cwd(), '.tmp-ss-helper-sdk-users-'));
  const previous = process.env.SS_HELPER_ST_ROOT;
  process.env.SS_HELPER_ST_ROOT = root;
  let module;
  try {
    const { routes, router } = createRouter();
    module = await import(`../server-plugin/index.js?users=${Date.now()}`);
    await module.init(router);
    const callAs = (handle, pluginId, operation, input = {}, relative = false) => invoke(routes, 'POST', BRIDGE_ROUTE, {
      user: { profile: { handle }, directories: { root: relative ? path.relative(process.cwd(), path.join(root, 'data', handle)) : path.join(root, 'data', handle) } },
      body: { version: 0, pluginId, operation, requestId: `test:${operation}`, input },
    });
    for (const handle of ['default-user', 'alice', 'bob']) {
      await callAs(handle, 'ss-helper.llm', 'workspace.open', { id: 'llm:global' });
      assert.equal((await callAs(handle, 'ss-helper.llm', 'secrets.get', { workspaceId: 'llm:global', secretId: 'key' })).payload.data, null);
      await callAs(handle, 'ss-helper.llm', 'secrets.set', { workspaceId: 'llm:global', secretId: 'key', value: `test-key-${handle}` });
      await callAs(handle, 'ss-helper.memory', 'workspace.open', { id: 'chat' });
      await callAs(handle, 'ss-helper.memory', 'workspace.commit', {
        id: 'chat', idempotencyKey: 'same-key', operations: [{ action: 'put', collection: 'default', id: 'record', value: { handle } }],
      });
    }
    for (const handle of ['default-user', 'alice', 'bob']) {
      assert.equal((await callAs(handle, 'ss-helper.llm', 'secrets.get', { workspaceId: 'llm:global', secretId: 'key' })).payload.data.value, `test-key-${handle}`);
      assert.equal((await callAs(handle, 'ss-helper.memory', 'workspace.get', { workspaceId: 'chat', recordId: 'record' })).payload.data.value.handle, handle);
      assert.equal((await callAs(handle, 'ss-helper.memory', 'workspace.get', { workspaceId: 'chat', recordId: 'record' }, true)).payload.data.value.handle, handle);
    }
    const defaultKey = readFileSync(module.__test.SECRET_KEY_PATH);
    assert.notDeepEqual(readFileSync(path.join(root, 'data', 'alice', '_ss-helper-v0', 'ss-helper-secrets.key')), defaultKey);
    assert.equal((await callAs('alice', 'ss-helper.memory', 'workspace.reset')).payload.data, 1);
    assert.equal((await callAs('bob', 'ss-helper.memory', 'workspace.get', { workspaceId: 'chat', recordId: 'record' })).payload.data.value.handle, 'bob');

    const corruptRoot = path.join(root, 'data', 'carol', '_ss-helper-v0');
    mkdirSync(corruptRoot, { recursive: true });
    writeFileSync(path.join(corruptRoot, 'ss-helper.sqlite3'), 'not sqlite');
    assert.equal((await callAs('carol', 'ss-helper.memory', 'workspace.health')).payload.data.recoverable, true);
    const repaired = await callAs('carol', 'ss-helper.memory', 'workspace.repair');
    assert.equal(repaired.payload.data.requiresReload, true);
    assert.equal(existsSync(path.join(root, 'data', 'carol', 'backups', repaired.payload.data.backupId, 'ss-helper.sqlite3')), true);
    assert.deepEqual(readFileSync(module.__test.SECRET_KEY_PATH), defaultKey);
    assert.equal((await callAs('default-user', 'ss-helper.memory', 'workspace.get', { workspaceId: 'chat', recordId: 'record' })).payload.data.value.handle, 'default-user');
    const unauthenticated = await invoke(routes, 'POST', BRIDGE_ROUTE, {
      user: undefined, body: { version: 0, pluginId: 'ss-helper.llm', operation: 'secrets.get', requestId: 'test:unauthenticated', input: { workspaceId: 'llm:global', secretId: 'key' } },
    });
    assert.equal(unauthenticated.payload.error, 'WORKSPACE_ACCESS_DENIED');
    for (const [handle, userRoot] of [['alice', path.join(root, 'data', 'bob')], ['..', root]]) {
      const invalidUser = await invoke(routes, 'POST', BRIDGE_ROUTE, {
        user: { profile: { handle }, directories: { root: userRoot } },
        body: { version: 0, pluginId: 'ss-helper.llm', operation: 'secrets.get', requestId: 'test:invalid-user', input: { workspaceId: 'llm:global', secretId: 'key' } },
      });
      assert.equal(invalidUser.payload.error, 'WORKSPACE_ACCESS_DENIED');
    }
    module.exit();
    await module.init(router);
    assert.equal((await callAs('bob', 'ss-helper.llm', 'secrets.get', { workspaceId: 'llm:global', secretId: 'key' })).payload.data.value, 'test-key-bob');
  } finally {
    module?.exit();
    restoreEnv('SS_HELPER_ST_ROOT', previous);
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
