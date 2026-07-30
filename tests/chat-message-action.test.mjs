import test from 'node:test';
import assert from 'node:assert/strict';
import { installCoreRuntime } from '../apps/core-extension/dist/index.js';
import { coreIdentity, errorCode, pluginDescriptor, TestRealm } from './helpers/runtime-fixture.mjs';
import { FakeDocument, installFakeDomGlobals } from './helpers/fake-dom.mjs';

function messageRow(document, index) {
  const row = document.createElement('div');
  row.className = 'mes';
  row.setAttribute('mesid', String(index));
  const actions = document.createElement('div');
  actions.className = 'mes_buttons';
  const more = document.createElement('button');
  more.className = 'extraMesButtons';
  actions.append(more);
  row.append(actions);
  return { row, actions, more };
}

function adapter(messages) {
  return {
    context: { read: async () => ({ characterId: '6', groupId: 'null', chatKey: 'chat-1' }) },
    character: { read: async () => ({ id: 'char-1', name: 'Character' }) },
    chat: { readMessages: async () => messages },
  };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test('message actions resolve in batches, render beside direct controls and clean with the session', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const chat = document.createElement('div');
    chat.id = 'chat';
    const first = messageRow(document, 0);
    const second = messageRow(document, 1);
    chat.append(first.row, second.row);
    document.body.append(chat);
    const messages = [
      { id: 'm0', stableId: 'm0', index: 0, role: 'user', text: 'hello', author: { kind: 'user' } },
      { id: 'm1', stableId: 'm1', variantId: '0', index: 1, role: 'assistant', text: 'reply', author: { kind: 'assistant' } },
    ];
    const runtime = installCoreRuntime(
      coreIdentity({ capabilities: ['tavern.chat.read'] }),
      new TestRealm(),
      { document, hostAdapter: adapter(messages) },
    );
    const session = runtime.connect(pluginDescriptor('example.memory', {
      capabilities: ['tavern.chat.read', 'core.ui.chat-message-action.v0'],
    }));
    let resolveCalls = 0;
    let renderCalls = 0;
    const renderedTargets = [];
    const resolvedTargets = [];
    const resolveSignals = [];
    let invalidate;
    session.registerChatMessageAction({
      id: 'recall-detail',
      label: '查看召回',
      icon: 'brain',
      order: 10,
      subscribe: (listener) => { invalidate = listener; return () => { invalidate = undefined; }; },
      resolve: (targets, context) => {
        resolveCalls += 1;
        resolvedTargets.push(...targets);
        resolveSignals.push(context?.signal);
        return targets.map(target => ({
          targetKey: target.key,
          state: target.message.role === 'assistant' ? 'enabled' : 'hidden',
          ariaLabel: '查看本层召回：2 个候选',
        }));
      },
      render: (container, target) => {
        renderCalls += 1;
        renderedTargets.push(target);
        container.textContent = '召回详情';
      },
    });
    assert.throws(() => session.registerChatMessageAction({
      id: 'recall-detail',
      label: 'Duplicate',
      icon: 'brain',
      resolve: () => [],
      render: () => undefined,
    }), errorCode('CONFLICT'));
    const secondSession = runtime.connect(pluginDescriptor('example.fast-action', {
      capabilities: ['tavern.chat.read', 'core.ui.chat-message-action.v0'],
    }));
    secondSession.registerChatMessageAction({
      id: 'fast',
      label: '更早操作',
      icon: 'bolt',
      order: 5,
      resolve: targets => targets.map(target => ({
        targetKey: target.key,
        state: target.message.role === 'assistant' ? 'enabled' : 'hidden',
      })),
      render: container => { container.textContent = '快速操作'; },
    });
    await runtime.chatMessageActions.refresh();
    assert.equal(resolveCalls, 1);
    assert.equal(first.actions.querySelector('[data-ss-helper-message-action]'), null);
    const buttons = second.actions.querySelectorAll('[data-ss-helper-message-action]');
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].getAttribute('aria-label'), '更早操作');
    const button = buttons[1];
    assert.ok(button);
    assert.equal(second.actions.children[0], second.more);
    assert.equal(second.actions.children[2], button);
    assert.equal(button.getAttribute('aria-label'), '查看本层召回：2 个候选');
    assert.equal(button.classList.contains('mes_button'), true);
    assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(resolveSignals[0] instanceof AbortSignal, true);
    assert.equal(resolvedTargets[0]?.workspaceId, 'character:char-1');

    let redundantPlacements = 0;
    const originalMoreAfter = second.more.after.bind(second.more);
    const originalFastAfter = buttons[0].after.bind(buttons[0]);
    second.more.after = (...nodes) => { redundantPlacements += 1; return originalMoreAfter(...nodes); };
    buttons[0].after = (...nodes) => { redundantPlacements += 1; return originalFastAfter(...nodes); };
    await runtime.chatMessageActions.refresh();
    assert.equal(redundantPlacements, 0, 'stable action buttons are not moved during an unchanged refresh');

    button.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
    assert.equal(document.querySelector('.stx-chat-message-action-loading')?.textContent, '正在加载召回详情…');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(renderCalls, 1);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(button.classList.contains('is-open'), true);
    assert.equal(button.getAttribute('aria-controls'), 'ss-helper-chat-message-action-panel');
    assert.equal(document.querySelector('[data-ss-helper-message-action-panel="true"]')?.textContent, '');
    assert.equal(document.querySelector('.stx-chat-message-action-panel')?.textContent, '召回详情');
    document.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    assert.equal(document.querySelector('[data-ss-helper-message-action-panel="true"]'), null);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.classList.contains('is-open'), false);
    assert.equal(button.getAttribute('aria-controls'), null);
    assert.equal(document.activeElement, button);

    messages[1] = {
      ...messages[1],
      variantId: '1',
      text: 'swiped reply',
    };
    await runtime.chatMessageActions.refresh(true);
    const reusedButton = second.actions.querySelectorAll('[data-ss-helper-message-action]')[1];
    assert.equal(reusedButton, button, 'the same floor action button is reused after a swipe');
    reusedButton.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(renderCalls, 2);
    assert.equal(renderedTargets.at(-1)?.message.variantId, '1');
    assert.equal(renderedTargets.at(-1)?.message.text, 'swiped reply');
    document.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });

    invalidate();
    await runtime.chatMessageActions.refresh();
    assert.equal(resolveCalls, 3, 'provider subscription invalidates only its cached resolutions');

    session.dispose();
    await runtime.chatMessageActions.refresh();
    assert.equal(second.actions.querySelectorAll('[data-ss-helper-message-action]').length, 1);
    secondSession.dispose();
    await runtime.chatMessageActions.refresh();
    assert.equal(document.querySelector('[data-ss-helper-message-action]'), null);
    assert.equal(document.querySelector('[data-ss-helper-message-action-panel="true"]'), null);
    runtime.dispose();
  } finally {
    restore();
  }
});

test('a forced message action refresh aborts stale resolution and only mounts the newest result', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const chat = document.createElement('div');
    chat.id = 'chat';
    const message = messageRow(document, 0);
    chat.append(message.row);
    document.body.append(chat);
    const runtime = installCoreRuntime(
      coreIdentity({ capabilities: ['tavern.chat.read'] }),
      new TestRealm(),
      { document, hostAdapter: adapter([{ id: 'm0', stableId: 'm0', index: 0, role: 'assistant', text: 'reply', author: { kind: 'assistant' } }]) },
    );
    const session = runtime.connect(pluginDescriptor('example.abort-action', {
      capabilities: ['tavern.chat.read', 'core.ui.chat-message-action.v0'],
    }));
    const attempts = [];
    session.registerChatMessageAction({
      id: 'abortable',
      label: '可取消操作',
      icon: 'brain',
      resolve: (targets, context) => new Promise((resolve, reject) => {
        const entry = { targets, signal: context.signal, resolve };
        attempts.push(entry);
        context.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
      render: container => { container.textContent = '最新结果'; },
    });

    await waitFor(() => attempts.length === 1, 'the first action resolution');
    runtime.chatMessageActions.scheduleRefresh(true, true);
    await waitFor(() => attempts[0].signal.aborted, 'the stale action resolution to abort');
    await waitFor(() => attempts.length === 2, 'the replacement action resolution');
    attempts[1].resolve(attempts[1].targets.map(target => ({ targetKey: target.key, state: 'enabled' })));
    await waitFor(() => message.actions.querySelector('[data-ss-helper-message-action]') !== null, 'the newest action button');
    assert.equal(attempts[1].signal.aborted, false);

    session.dispose();
    runtime.dispose();
  } finally {
    restore();
  }
});

test('message actions resolve the newest rows even before SillyTavern finishes scrolling to the bottom', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const chat = document.createElement('div');
    chat.id = 'chat';
    chat.getBoundingClientRect = () => ({ left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 });
    const messages = [];
    for (let index = 0; index < 30; index += 1) {
      const item = messageRow(document, index);
      item.row.getBoundingClientRect = () => index === 0
        ? ({ left: 0, top: 0, right: 500, bottom: 24, width: 500, height: 24 })
        : ({ left: 0, top: 1_000, right: 500, bottom: 1_024, width: 500, height: 24 });
      chat.append(item.row);
      messages.push({ id: `m${index}`, stableId: `m${index}`, index, role: 'assistant', text: `reply ${index}`, author: { kind: 'assistant' } });
    }
    document.body.append(chat);
    const runtime = installCoreRuntime(coreIdentity({ capabilities: ['tavern.chat.read'] }), new TestRealm(), {
      document,
      hostAdapter: adapter(messages),
    });
    const session = runtime.connect(pluginDescriptor('example.latest-action', {
      capabilities: ['tavern.chat.read', 'core.ui.chat-message-action.v0'],
    }));
    const resolvedIndexes = [];
    session.registerChatMessageAction({
      id: 'latest', label: '最新操作', icon: 'brain',
      resolve: targets => {
        resolvedIndexes.push(...targets.map(target => target.message.index));
        return targets.map(target => ({ targetKey: target.key, state: 'enabled' }));
      },
      render: () => undefined,
    });

    await runtime.chatMessageActions.refresh();
    assert.ok(resolvedIndexes.includes(0), 'the currently visible row is resolved');
    assert.ok(resolvedIndexes.includes(29), 'the newest row is resolved before the host scroll settles');
    assert.equal(resolvedIndexes.includes(1), false, 'unrelated offscreen rows outside the tail stay cold');
    session.dispose();
    runtime.dispose();
  } finally {
    restore();
  }
});

test('message actions require both the Core action capability and chat read permission', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document, hostAdapter: adapter([]) });
    const session = runtime.connect(pluginDescriptor('example.denied', {
      capabilities: ['tavern.chat.read', 'core.ui.chat-message-action.v0'],
    }));
    assert.throws(() => session.registerChatMessageAction({
      id: 'denied',
      label: 'Denied',
      icon: 'brain',
      resolve: () => [],
      render: () => undefined,
    }), errorCode('FORBIDDEN'));
    runtime.dispose();
  } finally {
    restore();
  }
});

test('an omitted asynchronous action resolution remains retryable instead of being cached hidden', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const chat = document.createElement('div'); chat.id = 'chat';
    const message = messageRow(document, 0); chat.append(message.row); document.body.append(chat);
    const runtime = installCoreRuntime(coreIdentity({ capabilities: ['tavern.chat.read'] }), new TestRealm(), {
      document,
      hostAdapter: adapter([{ id: 'm0', stableId: 'm0', index: 0, role: 'assistant', text: 'reply', author: { kind: 'assistant' } }]),
    });
    const session = runtime.connect(pluginDescriptor('example.pending-action', { capabilities: ['tavern.chat.read', 'core.ui.chat-message-action.v0'] }));
    let ready = false;
    let calls = 0;
    session.registerChatMessageAction({
      id: 'pending', label: '延迟动作', icon: 'brain',
      resolve: targets => {
        calls += 1;
        return ready ? targets.map(target => ({ targetKey: target.key, state: 'enabled' })) : [];
      },
      render: () => undefined,
    });
    await runtime.chatMessageActions.refresh();
    assert.equal(message.actions.querySelector('[data-ss-helper-message-action]'), null);
    ready = true;
    await runtime.chatMessageActions.refresh();
    assert.ok(message.actions.querySelector('[data-ss-helper-message-action]'));
    assert.equal(calls, 2);
    session.dispose(); runtime.dispose();
  } finally { restore(); }
});

test('window message actions render Core chrome, minimize, ignore outside clicks, and close with Escape', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const chat = document.createElement('div'); chat.id = 'chat';
    const message = messageRow(document, 0); chat.append(message.row); document.body.append(chat);
    const runtime = installCoreRuntime(coreIdentity({ capabilities: ['tavern.chat.read'] }), new TestRealm(), {
      document,
      hostAdapter: adapter([{ id: 'm0', stableId: 'm0', index: 0, role: 'assistant', text: 'reply', author: { kind: 'assistant' } }]),
    });
    const session = runtime.connect(pluginDescriptor('example.window-action', { capabilities: ['tavern.chat.read', 'core.ui.chat-message-action.v0'] }));
    session.registerChatMessageAction({
      id: 'recall-window', label: '召回预览', icon: 'brain',
      presentation: { kind: 'window', initialWidth: 680, initialHeight: 610, minWidth: 520, minHeight: 420, minimizable: true, draggable: true, resizable: true, persistKey: 'recall-window' },
      resolve: targets => targets.map(target => ({ targetKey: target.key, state: 'enabled', window: { title: '召回预览 · 第 8 层', subtitle: '4 个候选 · 2 个注入', status: { label: '覆盖完整', tone: 'success' } } })),
      render: container => { container.textContent = '窗口正文'; },
    });
    await runtime.chatMessageActions.refresh();
    const button = message.actions.querySelector('[data-ss-helper-message-action]');
    button.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
    await new Promise(resolve => setTimeout(resolve, 0));
    const root = document.querySelector('[data-ss-helper-message-action-panel="true"]');
    assert.equal(root?.dataset.presentation, 'window');
    assert.equal(root?.querySelector('.stx-chat-action-window-title')?.textContent, '召回预览 · 第 8 层');
    assert.equal(root?.querySelector('.stx-chat-action-window-body')?.textContent, '窗口正文');
    document.body.dispatchEvent({ type: 'pointerdown', target: document.body });
    assert.ok(document.querySelector('[data-ss-helper-message-action-panel="true"]'), 'window is not dismissed by an outside pointer');
    const minimize = root.querySelector('button[aria-label="最小化"]');
    minimize.dispatchEvent({ type: 'click', target: minimize });
    assert.equal(root.querySelector('.stx-chat-action-window-body').hidden, true);
    document.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    assert.equal(document.querySelector('[data-ss-helper-message-action-panel="true"]'), null);
    session.dispose(); runtime.dispose();
  } finally { restore(); }
});

test('a window action render error preserves Core close controls', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const chat = document.createElement('div'); chat.id = 'chat';
    const message = messageRow(document, 0); chat.append(message.row); document.body.append(chat);
    const runtime = installCoreRuntime(coreIdentity({ capabilities: ['tavern.chat.read'] }), new TestRealm(), {
      document,
      hostAdapter: adapter([{ id: 'm0', stableId: 'm0', index: 0, role: 'assistant', text: 'reply', author: { kind: 'assistant' } }]),
    });
    const session = runtime.connect(pluginDescriptor('example.window-error', { capabilities: ['tavern.chat.read', 'core.ui.chat-message-action.v0'] }));
    session.registerChatMessageAction({
      id: 'broken-window', label: '错误窗口', icon: 'brain',
      presentation: { kind: 'window', initialWidth: 680, initialHeight: 610, minWidth: 520, minHeight: 420 },
      resolve: targets => targets.map(target => ({ targetKey: target.key, state: 'enabled', window: { title: '错误窗口' } })),
      render: () => { throw new Error('render failure'); },
    });
    await runtime.chatMessageActions.refresh();
    message.actions.querySelector('[data-ss-helper-message-action]').dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
    await new Promise(resolve => setTimeout(resolve, 0));
    const root = document.querySelector('[data-ss-helper-message-action-panel="true"]');
    assert.equal(root?.querySelector('.stx-chat-action-window-body')?.textContent, '该操作暂时无法显示。');
    assert.ok(root?.querySelector('button[aria-label="关闭"]'));
    session.dispose(); runtime.dispose();
  } finally { restore(); }
});
