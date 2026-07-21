import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  API_MAJOR, API_MINOR, CORE_DISCOVERY_SYMBOL, CORE_EXTENSION_DIRECTORY, CORE_PLUGIN_ID,
  LLM_COMPLETION_V1, LLM_STRUCTURED_TASK_V1, LLM_EMBEDDING_V1, LLM_RERANK_V1,
  LLM_ROUTE_DIAGNOSTICS_V1, LLM_PLUGIN_ID, LLM_ROUTE_CHANGED_V1, MEMORY_PLUGIN_ID, MEMORY_RECALL_V1,
  MEMORY_UPDATED_V1, MEMORY_GRAPH_V1, PLUGIN_BINARY_CONTENT_TYPE, PLUGIN_BINARY_MAX_BYTES, SDK_PACKAGE_VERSION, SS_HELPER_ERROR_CODES,
  isPluginBinaryRequestV1, isPluginBinaryResponseV1,
} from '../packages/sdk/dist/index.js';

const sdkPackage = JSON.parse(readFileSync(new URL('../packages/sdk/package.json', import.meta.url), 'utf8'));

const binaryBody = (bytes) => ({
  encoding: 'base64', contentType: PLUGIN_BINARY_CONTENT_TYPE, data: bytes.toString('base64'), byteLength: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

test('frozen public identities stay exact', () => {
  assert.equal(CORE_EXTENSION_DIRECTORY, 'third-party/SS-Helper-SDK');
  assert.equal(CORE_PLUGIN_ID, 'ss-helper.core');
  assert.equal(LLM_PLUGIN_ID, 'ss-helper.llm');
  assert.equal(MEMORY_PLUGIN_ID, 'ss-helper.memory');
  assert.equal(CORE_DISCOVERY_SYMBOL, Symbol.for('@ss-helper/core.discovery'));
});

test('tokens are structural, frozen contracts', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(LLM_COMPLETION_V1).filter(([key]) => !key.startsWith('validate'))), { kind: 'service', provider: 'ss-helper.llm', name: 'completion', version: 1, schemaId: 'ss-helper.llm.completion.v1' });
  assert.equal(LLM_COMPLETION_V1.validateRequest({ messages: [{ role: 'user', content: 'hello' }] }), true);
  assert.equal(LLM_COMPLETION_V1.validateRequest({ prompt: 'invalid' }), false);
  assert.equal(LLM_STRUCTURED_TASK_V1.validateResponse({ output: { ok: true }, route: { route: 'primary' } }), true);
  assert.equal(LLM_EMBEDDING_V1.validateResponse({ embeddings: [[0.1, 0.2]], route: { route: 'primary' } }), true);
  assert.equal(LLM_RERANK_V1.validateRequest({ query: 'q', documents: [{ id: 'a', text: 'A' }] }), true);
  assert.equal(LLM_ROUTE_DIAGNOSTICS_V1.validateResponse({ entries: [{ requestId: 'r', state: 'completed' }] }), true);
  assert.equal(Object.isFrozen(LLM_COMPLETION_V1), true);
  assert.equal(Object.isFrozen(LLM_ROUTE_CHANGED_V1), true);
  assert.equal(Object.isFrozen(MEMORY_RECALL_V1), true);
  assert.equal(Object.isFrozen(MEMORY_GRAPH_V1), true);
  assert.equal(Object.isFrozen(MEMORY_UPDATED_V1), true);
});

test('memory graph v1 only accepts safe read-only DTOs', () => {
  const request = { chatKey: 'chat-a', query: '艾琳与雷暴', limit: 12 };
  const response = {
    nodes: [{ id: 'graph-node:1', label: '艾琳' }, { id: 'graph-node:2', label: '雷暴' }],
    edges: [{ id: 'graph-edge:1', from: 'graph-node:1', to: 'graph-node:2', predicate: '害怕', kind: 'relationship', confidence: 0.9, backingFactId: 'fact:1' }],
  };
  assert.equal(MEMORY_GRAPH_V1.validateRequest(request), true);
  assert.equal(MEMORY_GRAPH_V1.validateResponse(response), true);
  assert.equal(MEMORY_GRAPH_V1.validateRequest({ ...request, limit: 0 }), false);
  assert.equal(MEMORY_GRAPH_V1.validateRequest({ ...request, evidence: 'secret' }), false);
  assert.equal(MEMORY_GRAPH_V1.validateResponse({ ...response, edges: [{ ...response.edges[0], evidenceExcerpt: 'chat text' }] }), false);
  assert.equal(MEMORY_GRAPH_V1.validateResponse({ ...response, nodes: [{ ...response.nodes[0], chatKey: 'chat-a' }] }), false);
  assert.equal(MEMORY_GRAPH_V1.validateResponse({
    nodes: Array.from({ length: 100 }, (_, index) => ({ id: `node:${index}`, label: `节点 ${index}` })),
    edges: response.edges,
  }), true);
  assert.equal(MEMORY_GRAPH_V1.validateResponse({
    nodes: Array.from({ length: 101 }, (_, index) => ({ id: `node:${index}`, label: `节点 ${index}` })),
    edges: response.edges,
  }), false);
});

test('binary plugin request v1 validators keep bytes narrow, canonical, and PlainData-safe', () => {
  const bytes = Buffer.from('SQLite format 3\0fixture', 'utf8');
  const body = binaryBody(bytes);
  const binaryRequest = { version: 1, path: '/api/plugins/memory/backup/export', method: 'POST', responseMode: 'binary' };
  const jsonRequest = { version: 1, path: '/api/plugins/memory/backup/import', method: 'POST', responseMode: 'json', body };
  const binaryResponse = { version: 1, mode: 'binary', status: 200, ok: true, ...body, filename: 'memory.sqlite3' };
  const jsonResponse = { version: 1, mode: 'json', status: 200, ok: true, body: { ok: true, data: null } };
  assert.equal(isPluginBinaryRequestV1(binaryRequest), true);
  assert.equal(isPluginBinaryRequestV1(jsonRequest), true);
  assert.equal(isPluginBinaryResponseV1(binaryResponse), true);
  assert.equal(isPluginBinaryResponseV1(jsonResponse), true);
  assert.equal(JSON.parse(JSON.stringify(jsonRequest)).body.data, body.data);
  for (const invalid of [
    { ...jsonRequest, responseMode: undefined }, { ...jsonRequest, responseMode: 'text' },
    { ...jsonRequest, path: '/api/worldinfo/list' }, { ...jsonRequest, path: '/api/plugins/memory/../secrets' },
    { ...jsonRequest, body: { ...body, data: `${body.data.slice(0, -2)}==` } }, { ...jsonRequest, body: { ...body, contentType: 'application/octet-stream' } },
    { ...jsonRequest, body: { ...body, byteLength: PLUGIN_BINARY_MAX_BYTES + 1 } }, { ...jsonRequest, headers: { authorization: 'secret' } },
    { ...jsonRequest, csrf: 'secret' }, { ...jsonRequest, cookies: 'secret' },
  ]) assert.equal(isPluginBinaryRequestV1(invalid), false);
  for (const invalid of [
    { ...binaryResponse, mode: 'json' }, { ...jsonResponse, mode: 'binary' },
    { ...binaryResponse, contentType: 'text/plain' }, { ...binaryResponse, filename: '../memory.sqlite3' },
    { ...binaryResponse, data: 'AB==' }, { ...binaryResponse, headers: { cookie: 'secret' } },
    { ...jsonResponse, body: { ok: false, data: null } }, { ...jsonResponse, body: { ok: true } },
    { ...jsonResponse, body: { ok: true, data: null, headers: {} } }, { ...jsonResponse, headers: { cookie: 'secret' } },
    { ...jsonResponse, body: { ok: true, data: Number.POSITIVE_INFINITY } }, { ...jsonResponse, body: { ok: true, data: () => null } },
  ]) assert.equal(isPluginBinaryResponseV1(invalid), false);
});

test('LLM service validators reject malformed requests and provider responses exactly', () => {
  const cases = [
    [LLM_COMPLETION_V1, { messages: [{ role: 'user', content: 'hello' }], route: 'primary', maxTokens: 64, temperature: 0.5 }, { text: 'ok', route: 'primary', model: 'model', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }, [
      { messages: [{ role: 'user', content: 'hello' }], route: 1 }, { messages: [{ role: 'user', content: 'hello' }], maxTokens: 0 },
      { messages: [{ role: 'user', content: 'hello' }], maxTokens: Number.POSITIVE_INFINITY }, { messages: [{ role: 'user', content: 'hello', raw: true }] },
    ], [{ text: 'ok', route: '', model: 'model' }, { text: 'ok', route: 'primary', model: 'model', usage: { totalTokens: -1 } }, { text: 'ok', route: 'primary', model: 'model', raw: true }]],
    [LLM_STRUCTURED_TASK_V1, { task: 'extract', input: { text: 'hello' }, outputSchema: { type: 'object', properties: { value: { type: 'string' } } }, route: 'primary', timeoutMs: 1000 }, { output: { value: 'ok' }, route: { route: 'primary', provider: 'p', model: 'm' } }, [
      { task: 'extract', input: {}, outputSchema: [] }, { task: 'extract', input: {}, timeoutMs: 0 }, { task: 'extract', input: () => 'raw' },
    ], [{ output: () => 'raw', route: { route: 'primary' } }, { output: {}, route: { route: 'primary', fallback: 'yes' } }]],
    [LLM_EMBEDDING_V1, { input: ['a', 'b'], model: 'embed', route: 'primary', dimensions: 2, timeoutMs: 1000 }, { embeddings: [[0.1, 0.2], [0.3, 0.4]], route: { route: 'primary' } }, [
      { input: 'a', dimensions: 0 }, { input: 'a', dimensions: 1.5 }, { input: [], timeoutMs: 100 }, { input: 'a', timeoutMs: Number.NaN },
    ], [{ embeddings: [], route: { route: 'primary' } }, { embeddings: [[Number.POSITIVE_INFINITY]], route: { route: 'primary' } }]],
    [LLM_RERANK_V1, { query: 'q', documents: [{ id: 'a', text: 'A', metadata: { source: 'x' } }], topN: 1, model: 'rank', route: 'primary', timeoutMs: 1000 }, { results: [{ id: 'a', score: 0.9, index: 0 }], route: { route: 'primary' } }, [
      { query: 'q', documents: [{ id: 'a', text: 'A' }], topN: 0 }, { query: 'q', documents: [{ id: 'a', text: 'A' }], topN: 2 },
      { query: 'q', documents: [{ id: 'a', text: 'A', metadata: [] }] }, { query: 'q', documents: [{ id: 'a', text: 'A' }], timeoutMs: -1 },
    ], [{ results: [{ id: 'a', score: 1, index: -1 }], route: { route: 'primary' } }, { results: [{ id: 'a', score: Number.NaN, index: 0 }], route: { route: 'primary' } }]],
    [LLM_ROUTE_DIAGNOSTICS_V1, { requestId: 'r' }, { entries: [{ requestId: 'r', state: 'completed', route: { route: 'primary' }, durationMs: 2 }] }, [
      { requestId: '' }, { requestId: 'r', raw: true },
    ], [{ entries: [{ requestId: 'r', state: 'completed', route: 'primary' }] }, { entries: [{ requestId: 'r', state: 'failed', durationMs: -1, errorCode: 42 }] }]],
  ];
  for (const [token, validRequest, validResponse, invalidRequests, invalidResponses] of cases) {
    assert.equal(token.validateRequest(validRequest), true, `${token.name} valid request`);
    assert.equal(token.validateResponse(validResponse), true, `${token.name} valid response`);
    for (const request of invalidRequests) assert.equal(token.validateRequest(request), false, `${token.name} accepted malformed request`);
    for (const response of invalidResponses) assert.equal(token.validateResponse(response), false, `${token.name} accepted malformed response`);
  }
  assert.equal(LLM_ROUTE_CHANGED_V1.validatePayload({ route: '', reason: 'configured' }), false);
  assert.equal(LLM_ROUTE_CHANGED_V1.validatePayload({ route: 'primary', reason: 'configured', raw: true }), false);
});

test('version axes are not conflated by exported metadata', () => {
  assert.match(SDK_PACKAGE_VERSION, /^\d+\.\d+\.\d+$/u);
  assert.equal(SDK_PACKAGE_VERSION, sdkPackage.version);
  assert.equal(API_MAJOR, 2);
  assert.equal(API_MINOR, 2);
});

test('the complete frozen error-code set is exported', () => {
  assert.deepEqual(SS_HELPER_ERROR_CODES, [
    'CORE_MISSING', 'CORE_TIMEOUT', 'API_INCOMPATIBLE', 'CORE_ALREADY_ACTIVE', 'CORE_DISPOSED',
    'CORE_RECONNECT_EXHAUSTED', 'BRIDGE_CORRUPTED', 'STALE_SESSION', 'CAPABILITY_NOT_GRANTED',
    'DUPLICATE_PLUGIN_ID', 'UNKNOWN_SERVICE', 'SERVICE_VERSION_MISMATCH', 'PAYLOAD_INVALID',
    'CALL_TIMEOUT', 'CALL_ABORTED', 'PLUGIN_DISPOSED', 'SETTINGS_ADAPTER_ERROR',
    'HOST_NOT_READY', 'BOOTSTRAP_CALLBACK_TIMEOUT',
  ]);
});
