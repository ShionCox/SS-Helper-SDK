import test from 'node:test';
import assert from 'node:assert/strict';
import { installCoreRuntime, chatIndicatorTargetFromRow } from '../apps/core-extension/dist/index.js';
import { coreIdentity, errorCode, pluginDescriptor, TestRealm } from './helpers/runtime-fixture.mjs';
import { FakeDocument, installFakeDomGlobals } from './helpers/fake-dom.mjs';

function recentChat(document, file, avatar = '', group = '') {
  const row = document.createElement('div'); row.className = 'recentChat';
  row.dataset.file = file; row.dataset.avatar = avatar; row.dataset.group = group;
  const info = document.createElement('div'); info.className = 'recentChatInfo';
  const container = document.createElement('div'); container.className = 'chatNameContainer';
  const heading = document.createElement('div'); heading.className = 'chatName'; heading.textContent = file;
  const date = document.createElement('small'); date.textContent = 'today';
  container.append(heading, date); info.append(container); row.append(info);
  return row;
}

test('Core maps recent chats and renders direct, retained and aggregated dependency indicators', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const list = document.createElement('div'); list.className = 'recentChatList';
    const enabled = recentChat(document, 'Enabled chat', 'Assistant.png');
    const retained = recentChat(document, 'Retained chat', '', 'group-1');
    const empty = recentChat(document, 'Empty chat', 'Assistant.png');
    list.append(enabled, retained, empty); document.body.append(list);
    assert.deepEqual(chatIndicatorTargetFromRow(enabled), {
      key: JSON.stringify(['character:Assistant.png', 'Enabled chat']),
      workspaceId: 'character:Assistant.png', chatKey: 'Enabled chat', characterId: 'Assistant.png',
    });
    assert.deepEqual(chatIndicatorTargetFromRow(retained), {
      key: JSON.stringify(['group:group-1', 'Retained chat']),
      workspaceId: 'group:group-1', chatKey: 'Retained chat', groupId: 'group-1',
    });

    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const memory = runtime.connect(pluginDescriptor('ss-helper.memory'));
    const llm = runtime.connect(pluginDescriptor('ss-helper.llm'));
    let memoryCalls = 0; let llmCalls = 0; let invalidateMemory;
    memory.registerChatIndicator({
      label: '记忆', icon: 'brain', kind: 'direct', order: 10,
      resolve: (targets) => {
        memoryCalls += 1;
        return targets.map((target) => ({
          targetKey: target.key,
          state: target.chatKey === 'Enabled chat' ? 'enabled' : target.chatKey === 'Retained chat' ? 'retained' : 'hidden',
          ...(target.chatKey === 'Enabled chat' ? { activeDependencies: ['ss-helper.llm'] } : {}),
        }));
      },
      subscribe: (listener) => { invalidateMemory = listener; return () => { invalidateMemory = undefined; }; },
    });
    llm.registerChatIndicator({
      label: 'LLM', icon: 'microchip', kind: 'dependency', order: 20,
      resolve: (targets) => { llmCalls += 1; return targets.map((target) => ({ targetKey: target.key, state: 'enabled' })); },
    });
    await runtime.chatIndicators.refresh();

    const enabledIcons = enabled.querySelectorAll('[data-ss-helper-chat-indicator-plugin]');
    assert.equal(enabledIcons.length, 2);
    assert.equal(enabledIcons[0].dataset.ssHelperChatIndicatorPlugin, 'ss-helper.memory');
    assert.equal(enabledIcons[0].getAttribute('title'), '该聊天已启用记忆插件');
    assert.equal(enabledIcons[0].children[0].tagName, 'SS-HELPER-ICON');
    assert.equal(enabledIcons[0].children[0].getAttribute('name'), 'brain');
    assert.equal(enabledIcons[0].children[0].getAttribute('aria-hidden'), 'true');
    assert.equal(enabledIcons[1].dataset.ssHelperChatIndicatorPlugin, 'ss-helper.llm');
    assert.equal(enabledIcons[1].getAttribute('title'), '该聊天已启用 LLM 插件（由记忆插件使用）');
    assert.equal(enabledIcons[1].getAttribute('aria-label'), enabledIcons[1].getAttribute('title'));
    assert.equal(enabledIcons[1].children[0].getAttribute('name'), 'microchip');
    const retainedIcon = retained.querySelector('[data-ss-helper-chat-indicator-plugin]');
    assert.equal(retainedIcon.dataset.state, 'retained');
    assert.equal(retainedIcon.getAttribute('title'), '该聊天已有记忆数据，但记忆插件已关闭');
    assert.equal(empty.querySelector('[data-ss-helper-chat-indicators="true"]'), null);
    assert.equal(memoryCalls, 1); assert.equal(llmCalls, 1);

    await runtime.chatIndicators.refresh();
    assert.equal(memoryCalls, 1); assert.equal(llmCalls, 1, 'stable rows use provider caches');
    invalidateMemory([chatIndicatorTargetFromRow(enabled).key]);
    await runtime.chatIndicators.refresh();
    assert.equal(memoryCalls, 2); assert.equal(llmCalls, 1);
    memory.dispose();
    await runtime.chatIndicators.refresh();
    assert.equal(document.querySelectorAll('[data-ss-helper-chat-indicators="true"]').length, 0);
    runtime.dispose();
  } finally { restore(); }
});

test('chat indicator registrations validate metadata, isolate provider failures and clean replacement DOM', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const list = document.createElement('div'); list.className = 'recentChatList';
    const row = recentChat(document, 'Chat', 'Assistant.png'); list.append(row); document.body.append(list);
    const realm = new TestRealm();
    const runtime = installCoreRuntime(coreIdentity(), realm, { document });
    const broken = runtime.connect(pluginDescriptor('example.broken'));
    assert.throws(() => broken.registerChatIndicator({ label: '', icon: 'brain', resolve: () => [] }), errorCode('PAYLOAD_INVALID'));
    broken.registerChatIndicator({ label: 'Broken', icon: 'triangle-exclamation', resolve: () => { throw new Error('private'); } });
    assert.throws(() => broken.registerChatIndicator({ label: 'Again', icon: 'circle', resolve: () => [] }), errorCode('PAYLOAD_INVALID'));
    await runtime.chatIndicators.refresh();
    assert.equal(row.querySelector('[data-ss-helper-chat-indicators="true"]'), null);
    assert.equal(runtime.diagnosticsStore.snapshot().events.at(-1).code, 'CHAT_INDICATOR_PROVIDER_FAILED');
    runtime.dispose();
    assert.equal(document.querySelector('[data-ss-helper-chat-indicators="true"]'), null);
  } finally { restore(); }
});

test('recent-list replacement refreshes providers while unrelated DOM mutations stay quiet', async () => {
  const restore = installFakeDomGlobals();
  try {
    let observer;
    class FakeMutationObserver {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() {}
      disconnect() { this.disconnected = true; }
      trigger(records) { this.callback(records); }
    }
    const document = new FakeDocument();
    document.defaultView.MutationObserver = FakeMutationObserver;
    const firstList = document.createElement('div'); firstList.className = 'recentChatList';
    firstList.append(recentChat(document, 'Chat', 'Assistant.png')); document.body.append(firstList);
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.memory'));
    let calls = 0;
    session.registerChatIndicator({
      label: '记忆', icon: 'brain',
      resolve: (targets) => { calls += 1; return targets.map((target) => ({ targetKey: target.key, state: 'enabled' })); },
    });
    await runtime.chatIndicators.refresh();
    assert.equal(calls, 1);
    const unrelated = document.createElement('div');
    observer.trigger([{ addedNodes: [unrelated], removedNodes: [] }]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(calls, 1);

    const secondList = document.createElement('div'); secondList.className = 'recentChatList';
    const replacementRow = recentChat(document, 'Chat', 'Assistant.png'); secondList.append(replacementRow);
    firstList.remove(); document.body.append(secondList);
    observer.trigger([{ addedNodes: [secondList], removedNodes: [firstList] }]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(calls, 2);
    assert.equal(replacementRow.querySelectorAll('[data-ss-helper-chat-indicator-plugin]').length, 1);
    runtime.dispose();
    assert.equal(observer.disconnected, true);
  } finally { restore(); }
});
