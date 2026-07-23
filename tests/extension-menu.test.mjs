import assert from 'node:assert/strict';
import test from 'node:test';
import { installCoreRuntime, SS_HELPER_EXTENSION_MENU_GROUP_ID } from '../apps/core-extension/dist/index.js';
import { FakeDocument, installFakeDomGlobals } from './helpers/fake-dom.mjs';
import { coreIdentity, errorCode, pluginDescriptor, TestRealm } from './helpers/runtime-fixture.mjs';

function createRuntime({ withMenu = true, mutationObserver = false } = {}) {
  const document = new FakeDocument();
  let observer;
  if (mutationObserver) {
    document.defaultView.MutationObserver = class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() {}
      disconnect() { this.disconnected = true; }
      notify(target = document.body) { this.callback([{ target }]); }
    };
  }
  const menu = withMenu ? document.createElement('div') : undefined;
  if (menu) {
    menu.id = 'extensionsMenu';
    const hostItem = document.createElement('div');
    hostItem.textContent = '酒馆工具';
    menu.append(hostItem);
    document.body.append(menu);
  }
  const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
  return { document, menu, observer: () => observer, runtime };
}

function menuRegistration(id, label, icon, order, onActivate = () => undefined) {
  return { id, label, icon, order, onActivate };
}

test('extension menu host groups registered tools at the bottom between two separators', () => {
  const restore = installFakeDomGlobals();
  try {
    const { document, menu, runtime } = createRuntime();
    const memory = runtime.connect(pluginDescriptor('ss-helper.memory'));
    const llm = runtime.connect(pluginDescriptor('ss-helper.llm'));
    llm.registerExtensionMenuItem(menuRegistration('request-logs', 'LLM 请求日志', 'clipboard-list', 200));
    memory.registerExtensionMenuItem(menuRegistration('memory-workbench', '记忆工作台', 'brain', 100));

    const group = document.getElementById(SS_HELPER_EXTENSION_MENU_GROUP_ID);
    assert.equal(menu.children.at(-1), group);
    assert.equal(group.tagName, 'SECTION');
    assert.equal(group.getAttribute('aria-label'), 'SS-Helper 工具');
    assert.deepEqual(group.children.map((child) => child.tagName), ['HR', 'BUTTON', 'BUTTON', 'HR']);
    assert.deepEqual(group.children.slice(1, -1).map((child) => child.textContent), ['', '']);
    assert.deepEqual(group.children.slice(1, -1).map((child) => child.children[1].textContent), ['记忆工作台', 'LLM 请求日志']);
    assert.deepEqual(group.children.slice(1, -1).map((child) => child.children[0].getAttribute('name')), ['brain', 'clipboard-list']);
    assert.equal(group.children[0].dataset.ssHelperExtensionMenuSeparator, 'start');
    assert.equal(group.children.at(-1).dataset.ssHelperExtensionMenuSeparator, 'end');
  } finally {
    restore();
  }
});

test('extension menu registration validates input and rejects duplicates', () => {
  const restore = installFakeDomGlobals();
  try {
    const { runtime } = createRuntime();
    const session = runtime.connect(pluginDescriptor('ss-helper.memory'));
    session.registerExtensionMenuItem(menuRegistration('memory-workbench', '记忆工作台', 'brain', 100));
    assert.throws(
      () => session.registerExtensionMenuItem(menuRegistration('memory-workbench', '重复', 'brain', 100)),
      (error) => errorCode('PAYLOAD_INVALID')(error) && error.details?.reason === 'duplicate_extension_menu_item',
    );
    for (const registration of [
      menuRegistration('Bad ID', '工具', 'brain', 100),
      menuRegistration('empty-label', ' ', 'brain', 100),
      menuRegistration('bad-icon', '工具', 'Brain!', 100),
      menuRegistration('bad-order', '工具', 'brain', 1.5),
    ]) {
      assert.throws(
        () => session.registerExtensionMenuItem(registration),
        (error) => errorCode('PAYLOAD_INVALID')(error) && error.details?.reason === 'extension_menu_registration',
      );
    }
  } finally {
    restore();
  }
});

test('extension menu activation prevents duplicate async work and reports safe failures', async () => {
  const restore = installFakeDomGlobals();
  try {
    const { document, runtime } = createRuntime();
    const session = runtime.connect(pluginDescriptor('ss-helper.memory'));
    let calls = 0;
    let release;
    session.registerExtensionMenuItem(menuRegistration('memory-workbench', '记忆工作台', 'brain', 100, () => {
      calls += 1;
      return new Promise((resolve) => { release = resolve; });
    }));
    const button = document.getElementById(SS_HELPER_EXTENSION_MENU_GROUP_ID).children[1];
    button.dispatchEvent({ type: 'click' });
    button.dispatchEvent({ type: 'click' });
    assert.equal(calls, 1);
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute('aria-busy'), 'true');
    assert.equal(button.getAttribute('aria-disabled'), 'true');
    release();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute('aria-busy'), null);
    assert.equal(button.getAttribute('aria-disabled'), null);

    const failing = runtime.connect(pluginDescriptor('ss-helper.failure'));
    failing.registerExtensionMenuItem(menuRegistration('failing', '失败工具', 'triangle-exclamation', 300, () => {
      throw new Error('sensitive payload');
    }));
    const failureButton = document.getElementById(SS_HELPER_EXTENSION_MENU_GROUP_ID).children[2];
    failureButton.dispatchEvent({ type: 'click' });
    await Promise.resolve();
    assert.ok(runtime.diagnosticsStore.snapshot().events.some((event) => event.type === 'core.ui.extension-menu.activation-failed' && event.pluginId === 'ss-helper.failure'));
    const toast = document.body.querySelectorAll('[data-toast-plugin]').find((element) => element.dataset.toastPlugin === 'ss-helper.failure');
    assert.equal(toast?.dataset.toastCode, 'EXTENSION_MENU_ACTIVATION_FAILED');
    assert.equal(toast?.children[1].children[1].textContent, '“失败工具”暂时无法打开。');
  } finally {
    restore();
  }
});

test('extension menu unregisters items, removes empty separators, and clears on Core dispose', () => {
  const restore = installFakeDomGlobals();
  try {
    const { document, runtime } = createRuntime();
    const memory = runtime.connect(pluginDescriptor('ss-helper.memory'));
    const llm = runtime.connect(pluginDescriptor('ss-helper.llm'));
    const removeMemory = memory.registerExtensionMenuItem(menuRegistration('memory-workbench', '记忆工作台', 'brain', 100));
    const removeLlm = llm.registerExtensionMenuItem(menuRegistration('request-logs', 'LLM 请求日志', 'clipboard-list', 200));
    removeMemory();
    assert.deepEqual(
      document.getElementById(SS_HELPER_EXTENSION_MENU_GROUP_ID).children.slice(1, -1).map((child) => child.children[1].textContent),
      ['LLM 请求日志'],
    );
    removeLlm();
    assert.equal(document.getElementById(SS_HELPER_EXTENSION_MENU_GROUP_ID), null);

    memory.registerExtensionMenuItem(menuRegistration('memory-workbench', '记忆工作台', 'brain', 100));
    runtime.dispose();
    assert.equal(document.getElementById(SS_HELPER_EXTENSION_MENU_GROUP_ID), null);
  } finally {
    restore();
  }
});

test('extension menu mounts late and reattaches after the host replaces its menu DOM', async () => {
  const restore = installFakeDomGlobals();
  try {
    const { document, observer, runtime } = createRuntime({ withMenu: false, mutationObserver: true });
    const session = runtime.connect(pluginDescriptor('ss-helper.memory'));
    session.registerExtensionMenuItem(menuRegistration('memory-workbench', '记忆工作台', 'brain', 100));
    assert.equal(document.getElementById(SS_HELPER_EXTENSION_MENU_GROUP_ID), null);

    const firstMenu = document.createElement('div');
    firstMenu.id = 'extensionsMenu';
    document.body.append(firstMenu);
    observer().notify();
    await Promise.resolve();
    assert.equal(firstMenu.children.at(-1).id, SS_HELPER_EXTENSION_MENU_GROUP_ID);
    const laterHostItem = document.createElement('div');
    laterHostItem.textContent = '稍后加载的酒馆工具';
    firstMenu.append(laterHostItem);
    observer().notify(firstMenu);
    await Promise.resolve();
    assert.equal(firstMenu.children.at(-1).id, SS_HELPER_EXTENSION_MENU_GROUP_ID);

    firstMenu.remove();
    const replacement = document.createElement('div');
    replacement.id = 'extensionsMenu';
    document.body.append(replacement);
    observer().notify();
    await Promise.resolve();
    assert.equal(replacement.children.at(-1).id, SS_HELPER_EXTENSION_MENU_GROUP_ID);
    runtime.dispose();
    assert.equal(observer().disconnected, true);
  } finally {
    restore();
  }
});
