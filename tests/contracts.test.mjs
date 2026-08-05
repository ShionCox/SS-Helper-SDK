import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  API_VERSION, CORE_DISCOVERY_SYMBOL, CORE_EXTENSION_DIRECTORY, CORE_PLUGIN_ID,
  LLM_COMPLETION_V0, LLM_STRUCTURED_TASK_V0, LLM_EMBEDDING_V0, LLM_RERANK_V0,
  LLM_CONSUMER_DECLARE_V0, LLM_TOOL_TURN_V0, LLM_TOOL_SESSION_CANCEL_V0,
  LLM_TASK_STATUS_V0, LLM_TASK_ROUTE_SET_V0, LLM_RESOURCE_CAPABILITY_VERIFY_V0,
  LLM_PLUGIN_ID, MEMORY_PLUGIN_ID, MEMORY_RECALL_V0,
  MEMORY_UPDATED_V0, MEMORY_GRAPH_V0, PLUGIN_BINARY_CONTENT_TYPE, PLUGIN_BINARY_MAX_BYTES, SDK_PACKAGE_VERSION, SS_HELPER_ERROR_CODES,
  isPluginBinaryRequestV0, isPluginBinaryResponseV0,
} from '../packages/sdk/dist/index.js';
import * as sdk from '../packages/sdk/dist/index.js';
import { connectServerPlugin } from '../packages/sdk/dist/server.js';

const sdkPackage = JSON.parse(readFileSync(new URL('../packages/sdk/package.json', import.meta.url), 'utf8'));
const completeDiagnostics = {
  transport: 'json_schema',
  attemptCount: 1,
  repairCount: 0,
  validationOutcome: 'complete',
  itemRejections: [],
};
const route = (execution = 'structured', overrides = {}) => ({
  resourceId: 'primary', source: 'custom', provider: 'p', model: 'model', execution, transport: 'json', ...overrides,
});

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
  assert.deepEqual(Object.fromEntries(Object.entries(LLM_COMPLETION_V0).filter(([key]) => !key.startsWith('validate'))), { kind: 'request', id: 'ss-helper.llm.completion', version: 0 });
  assert.equal(LLM_COMPLETION_V0.validateRequest({ messages: [{ role: 'user', content: 'hello' }] }), true);
  assert.equal(LLM_COMPLETION_V0.validateRequest({ prompt: 'invalid' }), false);
  assert.equal(LLM_STRUCTURED_TASK_V0.validateResponse({ requestId: 'r', output: { ok: true }, route: route(), diagnostics: completeDiagnostics }), true);
  assert.equal(LLM_EMBEDDING_V0.validateResponse({ requestId: 'r', embeddings: [[0.1, 0.2]], route: route('embedding') }), true);
  assert.equal(LLM_RERANK_V0.validateRequest({ query: 'q', documents: [{ id: 'a', text: 'A' }] }), true);
  assert.equal(Object.isFrozen(LLM_COMPLETION_V0), true);
  assert.equal(Object.isFrozen(MEMORY_RECALL_V0), true);
  assert.equal(Object.isFrozen(MEMORY_GRAPH_V0), true);
  assert.equal(Object.isFrozen(MEMORY_UPDATED_V0), true);
});

test('memory graph v0 only accepts safe read-only DTOs', () => {
  const request = { chatKey: 'chat-a', query: '艾琳与雷暴', limit: 12 };
  const response = {
    nodes: [{ id: 'graph-node:1', label: '艾琳' }, { id: 'graph-node:2', label: '雷暴' }],
    edges: [{ id: 'graph-edge:1', from: 'graph-node:1', to: 'graph-node:2', predicate: '害怕', kind: 'relationship', confidence: 0.9, backingFactId: 'fact:1' }],
  };
  assert.equal(MEMORY_GRAPH_V0.validateRequest(request), true);
  assert.equal(MEMORY_GRAPH_V0.validateResponse(response), true);
  assert.equal(MEMORY_GRAPH_V0.validateRequest({ ...request, limit: 0 }), false);
  assert.equal(MEMORY_GRAPH_V0.validateRequest({ ...request, evidence: 'secret' }), false);
  assert.equal(MEMORY_GRAPH_V0.validateResponse({ ...response, edges: [{ ...response.edges[0], evidenceExcerpt: 'chat text' }] }), false);
  assert.equal(MEMORY_GRAPH_V0.validateResponse({ ...response, nodes: [{ ...response.nodes[0], chatKey: 'chat-a' }] }), false);
  assert.equal(MEMORY_GRAPH_V0.validateResponse({
    nodes: Array.from({ length: 100 }, (_, index) => ({ id: `node:${index}`, label: `节点 ${index}` })),
    edges: response.edges,
  }), true);
  assert.equal(MEMORY_GRAPH_V0.validateResponse({
    nodes: Array.from({ length: 101 }, (_, index) => ({ id: `node:${index}`, label: `节点 ${index}` })),
    edges: response.edges,
  }), false);
});

test('binary plugin request v0 validators keep bytes narrow, canonical, and PlainData-safe', () => {
  const bytes = Buffer.from('SQLite format 3\0fixture', 'utf8');
  const body = binaryBody(bytes);
  const binaryRequest = { version: 0, path: '/api/plugins/memory/backup/export', method: 'POST', responseMode: 'binary' };
  const jsonRequest = { version: 0, path: '/api/plugins/memory/backup/import', method: 'POST', responseMode: 'json', body };
  const binaryResponse = { version: 0, mode: 'binary', status: 200, ok: true, ...body, filename: 'memory.sqlite3' };
  const jsonResponse = { version: 0, mode: 'json', status: 200, ok: true, body: { ok: true, data: null } };
  assert.equal(isPluginBinaryRequestV0(binaryRequest), true);
  assert.equal(isPluginBinaryRequestV0(jsonRequest), true);
  assert.equal(isPluginBinaryResponseV0(binaryResponse), true);
  assert.equal(isPluginBinaryResponseV0(jsonResponse), true);
  assert.equal(JSON.parse(JSON.stringify(jsonRequest)).body.data, body.data);
  for (const invalid of [
    { ...jsonRequest, responseMode: undefined }, { ...jsonRequest, responseMode: 'text' },
    { ...jsonRequest, path: '/api/worldinfo/list' }, { ...jsonRequest, path: '/api/plugins/memory/../secrets' },
    { ...jsonRequest, body: { ...body, data: `${body.data.slice(0, -2)}==` } }, { ...jsonRequest, body: { ...body, contentType: 'application/octet-stream' } },
    { ...jsonRequest, body: { ...body, byteLength: PLUGIN_BINARY_MAX_BYTES + 1 } }, { ...jsonRequest, headers: { authorization: 'secret' } },
    { ...jsonRequest, csrf: 'secret' }, { ...jsonRequest, cookies: 'secret' },
  ]) assert.equal(isPluginBinaryRequestV0(invalid), false);
  for (const invalid of [
    { ...binaryResponse, mode: 'json' }, { ...jsonResponse, mode: 'binary' },
    { ...binaryResponse, contentType: 'text/plain' }, { ...binaryResponse, filename: '../memory.sqlite3' },
    { ...binaryResponse, data: 'AB==' }, { ...binaryResponse, headers: { cookie: 'secret' } },
    { ...jsonResponse, body: { ok: false, data: null } }, { ...jsonResponse, body: { ok: true } },
    { ...jsonResponse, body: { ok: true, data: null, headers: {} } }, { ...jsonResponse, headers: { cookie: 'secret' } },
    { ...jsonResponse, body: { ok: true, data: Number.POSITIVE_INFINITY } }, { ...jsonResponse, body: { ok: true, data: () => null } },
  ]) assert.equal(isPluginBinaryResponseV0(invalid), false);
});

test('LLM service validators reject malformed requests and provider responses exactly', () => {
  const trace = {
    workflowId: 'workflow:1', workflowLabel: '初始化记忆', workflowKind: 'agent',
    jobId: 'job:1', batchIndex: 0, batchCount: 2,
    stageKey: 'memory_extract_entities', stageDescription: '人物与地点实体解析',
  };
  const cases = [
    [LLM_COMPLETION_V0, { messages: [{ role: 'user', content: 'hello' }], maxTokens: 64, temperature: 0.5, trace }, { requestId: 'r', text: 'ok', route: route('completion'), usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }, [
      { messages: [{ role: 'user', content: 'hello' }], route: 1 }, { messages: [{ role: 'user', content: 'hello' }], maxTokens: 0 },
      { messages: [{ role: 'user', content: 'hello' }], maxTokens: Number.POSITIVE_INFINITY }, { messages: [{ role: 'user', content: 'hello', raw: true }] },
    ], [{ text: 'ok', route: { resourceId: '', source: 'custom', provider: 'p', model: 'model', execution: 'completion', transport: 'json' } }, { text: 'ok', route: route('completion'), usage: { totalTokens: -1 } }, { text: 'ok', route: route('completion'), raw: true }]],
    [LLM_STRUCTURED_TASK_V0, { task: 'extract', input: { text: 'hello' }, outputSchema: { type: 'object', properties: { value: { type: 'string' } } }, timeoutMs: 1000, trace }, { requestId: 'r', output: { value: 'ok' }, route: route(), diagnostics: completeDiagnostics }, [
      { task: 'extract', input: {}, outputSchema: [] }, { task: 'extract', input: {}, timeoutMs: 0 }, { task: 'extract', input: () => 'raw' },
    ], [{ output: () => 'raw', route: route() }, { output: {}, route: route() }]],
    [LLM_EMBEDDING_V0, { task: 'memory_embed', input: ['a', 'b'], dimensions: 2, timeoutMs: 1000, trace }, { requestId: 'r', embeddings: [[0.1, 0.2], [0.3, 0.4]], route: route('embedding') }, [
      { task: '', input: 'a' }, { task: 1, input: 'a' }, { input: 'a', dimensions: 0 }, { input: 'a', dimensions: 1.5 }, { input: [], timeoutMs: 100 }, { input: 'a', timeoutMs: Number.NaN },
    ], [{ embeddings: [], route: route('embedding') }, { embeddings: [[Number.POSITIVE_INFINITY]], route: route('embedding') }]],
    [LLM_RERANK_V0, { task: 'memory_rerank', query: 'q', documents: [{ id: 'a', text: 'A', metadata: { source: 'x' } }], topN: 1, timeoutMs: 1000, trace }, { requestId: 'r', results: [{ id: 'a', score: 0.9, index: 0 }], route: route('rerank') }, [
      { task: '', query: 'q', documents: [{ id: 'a', text: 'A' }] }, { task: false, query: 'q', documents: [{ id: 'a', text: 'A' }] },
      { query: 'q', documents: [{ id: 'a', text: 'A' }], topN: 0 }, { query: 'q', documents: [{ id: 'a', text: 'A' }], topN: 2 },
      { query: 'q', documents: [{ id: 'a', text: 'A', metadata: [] }] }, { query: 'q', documents: [{ id: 'a', text: 'A' }], timeoutMs: -1 },
    ], [{ results: [{ id: 'a', score: 1, index: -1 }], route: route('rerank') }, { results: [{ id: 'a', score: Number.NaN, index: 0 }], route: route('rerank') }]],
  ];
  for (const [token, validRequest, validResponse, invalidRequests, invalidResponses] of cases) {
    assert.equal(token.validateRequest(validRequest), true, `${token.id} valid request`);
    assert.equal(token.validateResponse(validResponse), true, `${token.id} valid response`);
    for (const request of invalidRequests) assert.equal(token.validateRequest(request), false, `${token.id} accepted malformed request`);
    for (const response of invalidResponses) assert.equal(token.validateResponse(response), false, `${token.id} accepted malformed response`);
  }
  assert.equal(LLM_COMPLETION_V0.validateRequest({ messages: [{ role: 'user', content: 'hello' }], route: 'primary' }), false);
  assert.equal(LLM_STRUCTURED_TASK_V0.validateRequest({ task: 'x', input: {}, outputSchema: {}, trace: { ...trace, batchCount: 0 } }), false);
});

test('LLM tool, routing and capability contracts keep provider state private and scopes exact', () => {
  const diagnostics = {
    toolSessionRound: 1,
    totalCalls: 1,
    toolSchemaProfile: 'ss_helper_tool_v0',
    providerAdapterVersion: 1,
    capabilitySnapshotId: 'capability:1',
  };
  const start = {
    task: 'memory_extract_content',
    pipelineRunId: 'pipeline:1',
    chatKey: 'chat:1',
    input: { evidence: [{ ref: 'message:1', text: '检查急救包' }] },
    outputSchema: { type: 'object', additionalProperties: false },
    tools: [{
      name: 'inventory.resolve_context',
      description: 'Resolve an existing inventory reference.',
      parameters: { type: 'object', properties: { mentions: { type: 'array', items: { type: 'string' } } }, required: ['mentions'], additionalProperties: false },
      strict: true,
    }],
    maxTokens: 2048,
    trace: {
      workflowId: 'pipeline:1', workflowLabel: 'Agent 记忆提取', workflowKind: 'agent',
      jobId: 'job:1', batchIndex: 0, batchCount: 2,
      stageKey: 'memory_extract_content', stageDescription: '内容与库存联合提取',
    },
  };
  assert.equal(LLM_TOOL_TURN_V0.validateRequest(start), true);
  assert.equal(LLM_TOOL_TURN_V0.validateRequest({ ...start, reasoning_content: 'private' }), false);
  assert.equal(LLM_TOOL_TURN_V0.validateRequest({ ...start, tools: [] }), false);
  assert.equal(LLM_TOOL_TURN_V0.validateRequest({ ...start, toolSessionId: 'session:1' }), false);
  assert.equal(LLM_TOOL_TURN_V0.validateRequest({ ...start, maxTokens: 0 }), false);
  assert.equal(LLM_TOOL_TURN_V0.validateRequest({ ...start, maxTokens: 65_537 }), false);
  assert.equal(LLM_TOOL_TURN_V0.validateRequest({ ...start, trace: { ...start.trace, workflowId: 'pipeline:other' } }), false);
  const continuation = {
    task: start.task,
    pipelineRunId: start.pipelineRunId,
    chatKey: start.chatKey,
    toolSessionId: 'session:1',
    toolResults: [{ callId: 'call:1', name: 'inventory.resolve_context', ok: true, content: { contextOnly: true } }],
    trace: start.trace,
  };
  assert.equal(LLM_TOOL_TURN_V0.validateRequest(continuation), true);
  assert.equal(LLM_TOOL_TURN_V0.validateRequest({ ...continuation, input: {} }), false);
  assert.equal(LLM_TOOL_TURN_V0.validateResponse({
    requestId: 'request:1', state: 'tool_calls', toolSessionId: 'session:1',
    calls: [{ callId: 'call:1', name: 'inventory.resolve_context', arguments: { mentions: ['急救包'] } }],
    route: route('tool_turn', { resourceId: 'inventory', provider: 'openai', model: 'gpt-tool', transport: 'tool_call' }), diagnostics,
  }), true);
  assert.equal(LLM_TOOL_TURN_V0.validateResponse({
    requestId: 'request:2', state: 'final', output: { itemCandidates: [] },
    route: route('tool_turn', { resourceId: 'inventory', provider: 'openai', model: 'gpt-tool', transport: 'tool_call' }), diagnostics,
  }), true);
  assert.equal(LLM_TOOL_TURN_V0.validateResponse({
    requestId: 'request:1', state: 'tool_calls', toolSessionId: 'session:1',
    calls: [
      { callId: 'duplicate', name: 'a', arguments: {} },
      { callId: 'duplicate', name: 'b', arguments: {} },
    ], route: route('tool_turn', { resourceId: 'inventory', transport: 'tool_call' }), diagnostics,
  }), false);
  assert.equal(LLM_TOOL_SESSION_CANCEL_V0.validateRequest({ toolSessionId: 'session:1', reason: 'chat_changed' }), true);

  const capability = {
    status: 'verified', resourceId: 'resource:1', model: 'model:1', dialect: 'openai_responses',
    parallelToolCalls: true, streamingToolCalls: 'incremental', strictToolSchema: 'native',
    reasoningReplay: 'opaque', verifiedAt: 1, expiresAt: 2, probeVersion: 1,
    capabilityDigest: 'sha256:abc',
  };
  const snapshot = {
    revision: 2,
    assignments: [{ taskKey: 'memory_extract_content', resourceId: 'resource:1' }],
    resources: [{
      resourceId: 'resource:1', label: 'OpenAI', type: 'generation', apiType: 'openai',
      defaultModel: 'model:1', enabled: true, available: true, capabilities: ['generation', 'tools'],
      toolCapabilities: capability,
      privacyPolicy: { conversationStateMode: 'local_replay', storeProviderState: false, allowRemoteRetention: false },
    }],
  };
  const status = {
    revision: 2,
    tasks: [{ taskKey: 'memory_extract_content', execution: 'tool_turn', available: true, resourceId: 'resource:1', route: route('tool_turn', { resourceId: 'resource:1', provider: 'openai', model: 'model:1', transport: 'tool_call' }), requirements: { strictToolSchema: 'preferred', streamingToolCalls: 'preferred' } }],
    defaults: { tool_turn: 'resource:1' },
    assignments: snapshot.assignments,
    resources: snapshot.resources,
  };
  assert.equal(LLM_TASK_STATUS_V0.validateRequest({ taskKeys: ['memory_extract_content'] }), true);
  assert.equal(LLM_TASK_STATUS_V0.validateResponse(status), true);
  assert.equal(LLM_TASK_ROUTE_SET_V0.validateRequest({ expectedRevision: 2, assignments: snapshot.assignments }), true);
  assert.equal(LLM_TASK_ROUTE_SET_V0.validateRequest({ expectedRevision: 2, assignments: [{ taskKey: 'x', model: 'orphan' }] }), false);
  assert.equal(LLM_RESOURCE_CAPABILITY_VERIFY_V0.validateRequest({ resourceId: 'resource:1', taskKeys: ['memory_extract_content'], force: true }), true);
  assert.equal(LLM_RESOURCE_CAPABILITY_VERIFY_V0.validateResponse({ resourceId: 'resource:1', taskKeys: ['memory_extract_content'], capabilities: [capability] }), true);
  assert.equal(LLM_RESOURCE_CAPABILITY_VERIFY_V0.validateResponse({ resourceId: 'resource:1', taskKeys: [], capabilities: [{ ...capability, status: 'failed', failureCode: 'PROVIDER_UNAVAILABLE' }] }), false);
  assert.equal(LLM_TASK_STATUS_V0.validateResponse({ ...status, resources: [{ ...snapshot.resources[0], baseUrl: 'secret' }] }), false);
});

test('structured task validation accepts shared JSON-schema nodes but still rejects cycles', () => {
  const sharedStringSchema = { type: 'string', minLength: 1 };
  const outputSchema = {
    type: 'object',
    properties: {
      actorId: sharedStringSchema,
      locationId: sharedStringSchema,
    },
  };
  assert.equal(LLM_STRUCTURED_TASK_V0.validateRequest({
    task: 'memory_capture',
    input: { messages: [{ role: 'user', content: 'hello' }] },
    outputSchema,
  }), true);

  const cyclicSchema = { type: 'object' };
  cyclicSchema.properties = { self: cyclicSchema };
  assert.equal(LLM_STRUCTURED_TASK_V0.validateRequest({
    task: 'memory_capture',
    input: {},
    outputSchema: cyclicSchema,
  }), false);
});

test('LLM consumer declaration accepts only the bounded structured repair policy', () => {
  const valid = {
    displayName: 'Memory',
    registrationVersion: 1,
    tasks: [{
      taskKey: 'memory_capture',
      taskKind: 'generation',
      structuredPolicy: {
        maxProviderAttempts: 2,
        repairOn: ['INVALID_JSON', 'SCHEMA_VALIDATION_FAILED'],
        itemFailure: 'return_partial',
        envelopeFailure: 'repair_once',
        itemCollections: ['actorCandidates', 'locationCandidates', 'episodes', 'claims'],
      },
    }],
  };
  assert.equal(LLM_CONSUMER_DECLARE_V0.validateRequest(valid), true);
  assert.equal(LLM_CONSUMER_DECLARE_V0.validateRequest({
    ...valid,
    tasks: [{ ...valid.tasks[0], structuredPolicy: { maxProviderAttempts: 3, repairOn: ['SCHEMA_VALIDATION_FAILED'] } }],
  }), false);
});

test('structured task validation accepts plain JSON objects from another realm', () => {
  const foreignOutput = vm.runInNewContext(
    '({ actorCandidates: [], locationCandidates: [], episodes: [], claims: [] })',
  );
  assert.equal(LLM_STRUCTURED_TASK_V0.validateResponse({
    requestId: 'r',
    output: foreignOutput,
    route: route('structured', { resourceId: 'tavern:active', source: 'tavern', provider: 'deepseek', model: 'model', transport: 'tavern_json_schema' }),
    diagnostics: {
      transport: 'tavern_json_schema',
      attemptCount: 2,
      repairCount: 1,
      validationOutcome: 'complete',
      itemRejections: [],
    },
  }), true);

  const ForeignRecord = vm.runInNewContext('(class ForeignRecord { constructor() { this.value = 1; } })');
  assert.equal(LLM_STRUCTURED_TASK_V0.validateResponse({
    requestId: 'r',
    output: new ForeignRecord(),
    route: route('structured', { resourceId: 'tavern:active', source: 'tavern', provider: 'deepseek', model: 'model', transport: 'tavern_json_schema' }),
    diagnostics: {
      transport: 'tavern_json_schema',
      attemptCount: 1,
      repairCount: 0,
      validationOutcome: 'complete',
      itemRejections: [],
    },
  }), false);
});

test('version axes are not conflated by exported metadata', () => {
  assert.match(SDK_PACKAGE_VERSION, /^\d+\.\d+\.\d+$/u);
  assert.equal(SDK_PACKAGE_VERSION, sdkPackage.version);
  assert.equal(API_VERSION, '0.0.1');
});

test('the complete frozen error-code set is exported', () => {
  assert.deepEqual(SS_HELPER_ERROR_CODES, [
    'CORE_UNAVAILABLE', 'STALE_SESSION', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
    'INVALID_PAYLOAD', 'TIMEOUT', 'ABORTED', 'INTERNAL',
  ]);
});

test('every exported v0 request and event token has one canonical id', () => {
  const tokens = Object.entries(sdk)
    .filter(([name, value]) => /^[A-Z0-9_]+_V0$/u.test(name) && value && (value.kind === 'request' || value.kind === 'event'))
    .map(([, value]) => value);
  assert.ok(tokens.length > 0);
  for (const token of tokens) {
    assert.equal(token.version, 0, `${token.id} version`);
    assert.match(token.id, /^[a-z0-9-]+(?:\.[a-z0-9-]+){2,}$/u);
  }
});

test('server SDK connects to the v0 process broker symbol', async () => {
  const symbol = Symbol.for('@ss-helper/sdk.server.v0');
  const session = { pluginId: 'example.server', capabilities: new Set(), workspace: {}, secrets: {}, dispose() {} };
  globalThis[symbol] = { connect: (input) => ({ ...session, pluginId: input.pluginId, capabilities: new Set(input.capabilities) }) };
  try {
    const connected = await connectServerPlugin({ pluginId: 'example.server', capabilities: ['workspace.read'], timeoutMs: 0 });
    assert.equal(connected.pluginId, 'example.server');
    assert.deepEqual([...connected.capabilities], ['workspace.read']);
  } finally {
    delete globalThis[symbol];
  }
});
