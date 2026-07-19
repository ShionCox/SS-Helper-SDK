import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LLM_EMBEDDING_V1,
  LLM_RERANK_V1,
  LLM_STRUCTURED_TASK_V1,
  MEMORY_RECALL_V1,
  MEMORY_UPDATED_V1,
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
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('network is forbidden in the deterministic contract fixture');
  };

  const waits = [LLM_STRUCTURED_TASK_V1, LLM_EMBEDDING_V1, LLM_RERANK_V1, MEMORY_RECALL_V1]
    .map((contract) => consumer.services.waitFor(contract, { timeoutMs: 100 }));
  const removers = [
    llm.services.expose(LLM_STRUCTURED_TASK_V1, (request, context) => ({
      output: { task: request.task, input: request.input, caller: context.callerPluginId },
      route: { route: 'fixture', provider: 'deterministic', model: 'structured-v1' },
    })),
    llm.services.expose(LLM_EMBEDDING_V1, (request) => {
      const inputs = Array.isArray(request.input) ? request.input : [request.input];
      return {
        embeddings: inputs.map((value) => [value.length, value.split(/\s+/u).length]),
        route: { route: 'fixture', provider: 'deterministic', model: 'embedding-v1' },
      };
    }),
    llm.services.expose(LLM_RERANK_V1, (request) => ({
      results: request.documents
        .map((document, index) => ({ id: document.id, score: document.text.includes(request.query) ? 1 : 0, index }))
        .sort((left, right) => right.score - left.score)
        .slice(0, request.topN ?? request.documents.length),
      route: { route: 'fixture', provider: 'deterministic', model: 'rerank-v1' },
    })),
    memory.services.expose(MEMORY_RECALL_V1, (request) => ({
      items: [{ id: `${request.chatKey}:1`, text: `remember:${request.query}`, score: 1, source: 'fixture' }],
    })),
  ];

  try {
    await Promise.all(waits);
    assert.deepEqual(
      await consumer.services.call(LLM_STRUCTURED_TASK_V1, { task: 'extract', input: { text: 'hello' }, outputSchema: { type: 'object' } }),
      {
        output: { task: 'extract', input: { text: 'hello' }, caller: 'fixture.cross-plugin-consumer' },
        route: { route: 'fixture', provider: 'deterministic', model: 'structured-v1' },
      },
    );
    assert.deepEqual(
      await consumer.services.call(LLM_EMBEDDING_V1, { input: ['hello world', 'x'] }),
      {
        embeddings: [[11, 2], [1, 1]],
        route: { route: 'fixture', provider: 'deterministic', model: 'embedding-v1' },
      },
    );
    assert.deepEqual(
      await consumer.services.call(LLM_RERANK_V1, {
        query: 'needle',
        documents: [{ id: 'a', text: 'plain' }, { id: 'b', text: 'has needle' }],
        topN: 1,
      }),
      {
        results: [{ id: 'b', score: 1, index: 1 }],
        route: { route: 'fixture', provider: 'deterministic', model: 'rerank-v1' },
      },
    );
    assert.deepEqual(
      await consumer.services.call(MEMORY_RECALL_V1, { query: 'name', chatKey: 'chat-a', limit: 1 }),
      { items: [{ id: 'chat-a:1', text: 'remember:name', score: 1, source: 'fixture' }] },
    );

    const updates = [];
    const unsubscribe = consumer.events.subscribe(MEMORY_UPDATED_V1, (payload) => updates.push(payload));
    memory.events.publish(MEMORY_UPDATED_V1, { chatKey: 'chat-a', operation: 'updated', recordIds: ['chat-a:1'] });
    assert.deepEqual(updates, [{ chatKey: 'chat-a', operation: 'updated', recordIds: ['chat-a:1'] }]);
    unsubscribe();

    assert.equal(networkCalls, 0);
    assert.deepEqual(
      { handlers: runtime.port.diagnostics().handlers, pending: runtime.port.diagnostics().pending },
      { handlers: 4, pending: 0 },
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
  const removeSlowEmbedding = llm.services.expose(LLM_EMBEDDING_V1, (_request, context) => new Promise((resolve) => {
    embeddingSignal = context.signal;
    finishEmbedding = resolve;
  }));

  await assert.rejects(
    consumer.services.call(LLM_EMBEDDING_V1, { input: 'late' }, { timeoutMs: 5 }),
    errorCode('CALL_TIMEOUT'),
  );
  assert.equal(embeddingSignal.aborted, true);
  assert.equal(runtime.port.diagnostics().pending, 0);
  finishEmbedding({ embeddings: [[999]], route: { route: 'stale' } });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(runtime.port.diagnostics().pending, 0);

  removeSlowEmbedding();
  const removeReplacement = llm.services.expose(LLM_EMBEDDING_V1, () => ({
    embeddings: [[1, 2]],
    route: { route: 'replacement', provider: 'deterministic', model: 'embedding-v2' },
  }));
  assert.deepEqual(await consumer.services.call(LLM_EMBEDDING_V1, { input: 'fresh' }), {
    embeddings: [[1, 2]],
    route: { route: 'replacement', provider: 'deterministic', model: 'embedding-v2' },
  });

  let recallSignal;
  const removeRecall = memory.services.expose(MEMORY_RECALL_V1, (_request, context) => new Promise(() => {
    recallSignal = context.signal;
  }));
  const controller = new AbortController();
  const pendingRecall = consumer.services.call(
    MEMORY_RECALL_V1,
    { query: 'cancel', chatKey: 'chat-a' },
    { signal: controller.signal },
  );
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pendingRecall, errorCode('CALL_ABORTED'));
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
