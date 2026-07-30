import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  LLM_EMBEDDING_V0,
  LLM_RERANK_V0,
  LLM_STRUCTURED_TASK_V0,
  MEMORY_RECALL_V0,
  MEMORY_GRAPH_V0,
  MEMORY_UPDATED_V0,
} from '../packages/sdk/dist/index.js';
import { installCoreRuntime } from '../apps/core-extension/dist/index.js';
import { coreIdentity, errorCode, pluginDescriptor, TestRealm } from './helpers/runtime-fixture.mjs';

const setup = () => {
  const runtime = installCoreRuntime(coreIdentity(), new TestRealm());
  return {
    runtime,
    llm: runtime.connect(pluginDescriptor('ss-helper.llm')),
    memory: runtime.connect(pluginDescriptor('ss-helper.memory')),
    consumer: runtime.connect(pluginDescriptor('fixture.cross-plugin-consumer')),
  };
};

test('exact LLM and Memory contracts run end-to-end through Core with deterministic no-network providers', async () => {
  const { runtime, llm, memory, consumer } = setup();
  const foreignStructuredOutput = vm.runInNewContext(
    '({ actorCandidates: [], locationCandidates: [], episodes: [], claims: [] })',
  );
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('network is forbidden in the deterministic contract fixture');
  };

  const removers = [
    llm.bus.handle(LLM_STRUCTURED_TASK_V0, (request, context) => ({
      requestId: context.requestId,
      output: request.task === 'foreign-output'
        ? foreignStructuredOutput
        : { task: request.task, input: request.input, caller: context.callerPluginId },
      route: { route: 'fixture', provider: 'deterministic', model: 'structured-v1' },
      diagnostics: {
        transport: 'json_schema',
        attemptCount: 1,
        repairCount: 0,
        validationOutcome: 'complete',
        itemRejections: [],
      },
    })),
    llm.bus.handle(LLM_EMBEDDING_V0, (request, context) => {
      const inputs = Array.isArray(request.input) ? request.input : [request.input];
      return {
        requestId: context.requestId,
        embeddings: inputs.map((value) => [value.length, value.split(/\s+/u).length]),
        route: { route: 'fixture', provider: 'deterministic', model: 'embedding-v1' },
      };
    }),
    llm.bus.handle(LLM_RERANK_V0, (request, context) => ({
      requestId: context.requestId,
      results: request.documents
        .map((document, index) => ({ id: document.id, score: document.text.includes(request.query) ? 1 : 0, index }))
        .sort((left, right) => right.score - left.score)
        .slice(0, request.topN ?? request.documents.length),
      route: { route: 'fixture', provider: 'deterministic', model: 'rerank-v1' },
    })),
    memory.bus.handle(MEMORY_RECALL_V0, (request) => ({
      mode: request.mode,
      world: { ownerId: 'owner:world', owner: '世界', memories: [] },
      narrator: { ownerId: 'owner:narrator', owner: '旁白', memories: [] },
      actors: [{ ownerId: request.sceneOwnerIds[0], owner: 'A', memories: [{ text: `remember:${request.query}`, confidence: 1, strength: 100 }] }],
    })),
    memory.bus.handle(MEMORY_GRAPH_V0, (request) => ({
      nodes: [{ id: `${request.chatKey}:node-a`, label: 'A' }, { id: `${request.chatKey}:node-b`, label: 'B' }],
      edges: [{ id: `${request.chatKey}:edge-a`, from: `${request.chatKey}:node-a`, to: `${request.chatKey}:node-b`, predicate: 'knows', kind: 'relationship', confidence: 0.9, backingFactId: `${request.chatKey}:fact-a` }],
    })),
  ];

  try {
    const structured = await consumer.bus.request(LLM_STRUCTURED_TASK_V0, { task: 'extract', input: { text: 'hello' }, outputSchema: { type: 'object' } });
    assert.deepEqual(
      { ...structured, requestId: '<requestId>' },
      {
        requestId: '<requestId>',
        output: { task: 'extract', input: { text: 'hello' }, caller: 'fixture.cross-plugin-consumer' },
        route: { route: 'fixture', provider: 'deterministic', model: 'structured-v1' },
        diagnostics: {
          transport: 'json_schema',
          attemptCount: 1,
          repairCount: 0,
          validationOutcome: 'complete',
          itemRejections: [],
        },
      },
    );
    const sharedSchemaNode = { type: 'string', minLength: 1 };
    assert.equal(
      (await consumer.bus.request(LLM_STRUCTURED_TASK_V0, {
        task: 'extract-shared-schema',
        input: { text: 'hello' },
        outputSchema: {
          type: 'object',
          properties: { actorId: sharedSchemaNode, locationId: sharedSchemaNode },
        },
      })).output.task,
      'extract-shared-schema',
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify((await consumer.bus.request(LLM_STRUCTURED_TASK_V0, {
        task: 'foreign-output',
        input: {},
        outputSchema: { type: 'object' },
      })).output)),
      { actorCandidates: [], locationCandidates: [], episodes: [], claims: [] },
    );
    const embedding = await consumer.bus.request(LLM_EMBEDDING_V0, { input: ['hello world', 'x'] });
    assert.deepEqual(
      { ...embedding, requestId: '<requestId>' },
      {
        requestId: '<requestId>',
        embeddings: [[11, 2], [1, 1]],
        route: { route: 'fixture', provider: 'deterministic', model: 'embedding-v1' },
      },
    );
    const rerank = await consumer.bus.request(LLM_RERANK_V0, {
        query: 'needle',
        documents: [{ id: 'a', text: 'plain' }, { id: 'b', text: 'has needle' }],
        topN: 1,
      });
    assert.deepEqual(
      { ...rerank, requestId: '<requestId>' },
      {
        requestId: '<requestId>',
        results: [{ id: 'b', score: 1, index: 1 }],
        route: { route: 'fixture', provider: 'deterministic', model: 'rerank-v1' },
      },
    );
    assert.deepEqual(
      await consumer.bus.request(MEMORY_RECALL_V0, {
        query: 'name', chatKey: 'chat-a', sceneOwnerIds: ['owner:actor:a'], presentOwnerIds: ['owner:actor:a'], viewpointOwnerId: 'owner:actor:a', mode: 'multi_actor', maxItems: 1,
      }),
      {
        mode: 'multi_actor',
        world: { ownerId: 'owner:world', owner: '世界', memories: [] },
        narrator: { ownerId: 'owner:narrator', owner: '旁白', memories: [] },
        actors: [{ ownerId: 'owner:actor:a', owner: 'A', memories: [{ text: 'remember:name', confidence: 1, strength: 100 }] }],
      },
    );
    assert.deepEqual(
      await consumer.bus.request(MEMORY_GRAPH_V0, { query: 'A', chatKey: 'chat-a', limit: 4 }),
      { nodes: [{ id: 'chat-a:node-a', label: 'A' }, { id: 'chat-a:node-b', label: 'B' }], edges: [{ id: 'chat-a:edge-a', from: 'chat-a:node-a', to: 'chat-a:node-b', predicate: 'knows', kind: 'relationship', confidence: 0.9, backingFactId: 'chat-a:fact-a' }] },
    );

    const updates = [];
    const unsubscribe = consumer.bus.subscribe(MEMORY_UPDATED_V0, (payload) => updates.push(payload));
    memory.bus.publish(MEMORY_UPDATED_V0, { chatKey: 'chat-a', operation: 'updated', recordIds: ['chat-a:1'] });
    assert.deepEqual(updates, [{ chatKey: 'chat-a', operation: 'updated', recordIds: ['chat-a:1'] }]);
    unsubscribe();

    assert.equal(networkCalls, 0);
    assert.deepEqual(
      { handlers: runtime.port.diagnostics().handlers, pending: runtime.port.diagnostics().pending },
      { handlers: 5, pending: 0 },
    );
  } finally {
    removers.reverse().forEach((remove) => remove());
    globalThis.fetch = originalFetch;
    consumer.dispose();
    memory.dispose();
    llm.dispose();
    runtime.dispose();
  }
});

test('exact contracts quarantine timeout/abort late results and permit clean provider replacement', async () => {
  const { runtime, llm, memory, consumer } = setup();
  let finishEmbedding;
  let embeddingSignal;
  const removeSlowEmbedding = llm.bus.handle(LLM_EMBEDDING_V0, (_request, context) => new Promise((resolve) => {
    embeddingSignal = context.signal;
    finishEmbedding = resolve;
  }));

  await assert.rejects(
    consumer.bus.request(LLM_EMBEDDING_V0, { input: 'late' }, { timeoutMs: 5 }),
    errorCode('TIMEOUT'),
  );
  assert.equal(embeddingSignal.aborted, true);
  assert.equal(runtime.port.diagnostics().pending, 0);
  finishEmbedding({ requestId: 'late', embeddings: [[999]], route: { route: 'stale' } });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(runtime.port.diagnostics().pending, 0);

  removeSlowEmbedding();
  const removeReplacement = llm.bus.handle(LLM_EMBEDDING_V0, (_request, context) => ({
    requestId: context.requestId,
    embeddings: [[1, 2]],
    route: { route: 'replacement', provider: 'deterministic', model: 'embedding-v2' },
  }));
  const freshEmbedding = await consumer.bus.request(LLM_EMBEDDING_V0, { input: 'fresh' });
  assert.deepEqual({ ...freshEmbedding, requestId: '<requestId>' }, {
    requestId: '<requestId>',
    embeddings: [[1, 2]],
    route: { route: 'replacement', provider: 'deterministic', model: 'embedding-v2' },
  });

  let recallSignal;
  const removeRecall = memory.bus.handle(MEMORY_RECALL_V0, (_request, context) => new Promise(() => {
    recallSignal = context.signal;
  }));
  const controller = new AbortController();
  const pendingRecall = consumer.bus.request(
    MEMORY_RECALL_V0,
    { query: 'cancel', chatKey: 'chat-a', sceneOwnerIds: [], presentOwnerIds: [], viewpointOwnerId: 'owner:narrator', mode: 'multi_actor' },
    { signal: controller.signal },
  );
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pendingRecall, errorCode('ABORTED'));
  assert.equal(recallSignal.aborted, true);
  assert.equal(runtime.port.diagnostics().pending, 0);

  removeRecall();
  removeReplacement();
  assert.equal(runtime.port.diagnostics().handlers, 0);
  consumer.dispose();
  memory.dispose();
  llm.dispose();
  runtime.dispose();
});
