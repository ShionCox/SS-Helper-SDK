import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installCoreRuntime,
  SETTINGS_CENTER_ID,
  SETTINGS_CENTER_OVERLAY_ID,
  SETTINGS_ROOT_ID,
} from '../apps/core-extension/dist/index.js';
import { coreIdentity, errorCode, pluginDescriptor, TestRealm } from './helpers/runtime-fixture.mjs';
import { FakeDocument, installFakeDomGlobals } from './helpers/fake-dom.mjs';
import { createSSHelperError } from '@ss-helper/sdk';

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

const schema = (id) => ({
  id,
  title: id,
  fields: [
    { kind: 'toggle', id: 'enabled', label: 'Enabled', description: 'Turn it on', aria: { label: 'Plugin enabled' } },
    { kind: 'text', id: 'api-key', label: 'API key', secret: true, validation: { required: true } },
    { kind: 'number', id: 'count', label: 'Count', validation: { min: 1, max: 4 } },
    { kind: 'range', id: 'volume', label: 'Volume', min: 0, max: 10, step: 1 },
    { kind: 'select', id: 'mode', label: 'Mode', options: [{ value: 'a', label: 'A' }] },
    { kind: 'section', id: 'advanced', label: 'Advanced', children: [{ kind: 'text', id: 'note', label: 'Note', disabledReason: 'Unavailable' }] },
    { kind: 'status', id: 'state', label: 'State', value: 'Ready' },
  ],
});

test('a stale initial load failure cannot overwrite a newer authoritative subscription snapshot', async () => {
  const runtime = installCoreRuntime(coreIdentity(), new TestRealm());
  const session = runtime.connect(pluginDescriptor('example.stale-load'));
  let rejectLoad;
  let emitValues;
  session.registerSettings(schema('example.stale-load'), {
    load: () => new Promise((_resolve, reject) => { rejectLoad = reject; }),
    save: async () => {},
    reset: async () => ({ enabled: false, 'api-key': 'reset', count: 1, volume: 0, mode: 'a' }),
    subscribe: (listener) => { emitValues = listener; return () => {}; },
  });
  emitValues({ enabled: true, 'api-key': 'ready', count: 2, volume: 5, mode: 'a' });
  rejectLoad(new Error('late startup failure'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.settings.snapshot()[0].health, 'healthy');
  assert.equal(runtime.settings.snapshot()[0].failure?.reasonCode, undefined);
  session.dispose();
  runtime.dispose();
});

test('Core owns one idempotent launcher and one settings center with dynamic plugin navigation', async () => {
  const restore = installFakeDomGlobals();
  const originalFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return { ok: true, json: async () => ({ ok: true, ready: true, schemaVersion: 2, walMode: 'wal' }) };
  };
  try {
    const document = new FakeDocument();
    const container = document.createElement('div'); document.body.append(container);
    const realm = new TestRealm();
    const runtime = installCoreRuntime(coreIdentity(), realm, { settingsContainer: container, document });
    assert.equal(runtime.settings.mount(container), runtime.settings.mount(container));
    assert.equal(document.getElementById(SETTINGS_ROOT_ID), container.children[0]);
    const saved = [];
    const session = runtime.connect({ ...pluginDescriptor('example.settings'), settingsDisplayName: '记忆系统', pluginVersion: '0.0.2' });
    session.registerSettings(schema('example.settings'), {
      load: async () => ({ enabled: true, 'api-key': 'secret', count: 2, mode: 'a' }),
      save: async (values) => { saved.push(values); },
      reset: async () => ({ enabled: false, 'api-key': '', count: 1, mode: 'a' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(runtime.settings.snapshot()[0].values['api-key'], '[REDACTED]');
    assert.equal(container.children[0].children.filter((node) => node.dataset.pluginId === 'ss-helper.core').length, 1);
    const coreStyles = document.body.children.find((node) => node.dataset.ssHelperStyle === 'core-ui');
    assert.ok(coreStyles);
    assert.match(coreStyles.textContent, /\.stx-ui-control-action \{ justify-content: flex-start; \}/);
    assert.match(coreStyles.textContent, /\.stx-ui-control-status \{ justify-content: flex-start; flex-wrap: wrap; \}/);
    assert.match(coreStyles.textContent, /\.stx-ui-badge-neutral/);
    assert.match(coreStyles.textContent, /\.stx-ui-status-badge/);
    assert.match(coreStyles.textContent, /background: color-mix\(in srgb, var\(--ss-theme-text\) 10%, transparent\)/);
    assert.match(coreStyles.textContent, /border-left: 3px solid var\(--stx-status-color\)/);
    assert.match(coreStyles.textContent, /background: color-mix\(in srgb, var\(--stx-status-color\) 16%, var\(--ss-theme-surface\)\)/);
    assert.match(coreStyles.textContent, /\.stx-ui-control-status \{ align-items: flex-start; flex-direction: column; \}/);
    assert.match(coreStyles.textContent, /\.stx-ui-select-wrap \{ position: relative;/);
    assert.match(coreStyles.textContent, /\.stx-ui-select-trigger \{/);
    assert.match(coreStyles.textContent, /\.stx-ui-select-arrow \{/);
    assert.match(coreStyles.textContent, /\.stx-ui-select-listbox \{/);
    assert.match(coreStyles.textContent, /position: fixed; z-index: 2147483000/);
    assert.match(coreStyles.textContent, /\.stx-ui-select-check\[hidden\] \{ display: none; \}/);
    assert.match(coreStyles.textContent, /background: var\(--ss-theme-surface-3\)/);
    const opener = descendants(container.children[0]).find((node) => node.id === 'ss-helper-open-settings-center');
    opener.focus();
    opener.dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(fetched, [], 'the Core settings center must not use a legacy workspace health HTTP route');
    assert.ok(document.getElementById(SETTINGS_CENTER_OVERLAY_ID));
    assert.ok(document.getElementById(SETTINGS_CENTER_ID));
    assert.equal(document.body.style.overflow, 'hidden');
    const pluginNav = descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.pluginId === 'example.settings');
    assert.ok(pluginNav);
    assert.equal(descendants(pluginNav).some((node) => node.textContent === '记忆系统'), true);
    assert.equal(descendants(pluginNav).some((node) => node.textContent === 'v0.0.2'), true);
    pluginNav.dispatchEvent({ type: 'click' });
    assert.equal(descendants(document.getElementById(SETTINGS_CENTER_ID)).some((node) => node.dataset.saveStatus === 'example.settings'), true);
    const selectWrap = descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.className === 'stx-ui-select-wrap');
    assert.ok(selectWrap);
    assert.equal(selectWrap.children[0].tagName, 'BUTTON');
    assert.equal(selectWrap.children[0].getAttribute('role'), 'combobox');
    assert.equal(selectWrap.children[0].getAttribute('aria-expanded'), 'false');
    assert.match(selectWrap.children[0].children[1].className, /stx-ui-select-arrow/u);
    assert.equal(selectWrap.children[0].children[1].getAttribute('aria-hidden'), 'true');
    assert.equal(selectWrap.children[1].getAttribute('role'), 'listbox');
    assert.equal(selectWrap.children[1].getAttribute('popover'), 'manual');
    assert.equal(selectWrap.children[1].hidden, true);
    await runtime.settings.save('example.settings', { enabled: false, 'api-key': 'next', count: 3, mode: 'a' });
    assert.equal(saved.length, 1);
    await assert.rejects(runtime.settings.save('example.settings', { enabled: false, 'api-key': '', count: 9, mode: 'x' }), errorCode('INVALID_PAYLOAD'));
    session.dispose();
    assert.equal(runtime.settings.snapshot().length, 0);
    assert.equal(descendants(document.getElementById(SETTINGS_CENTER_ID)).some((node) => node.dataset.pluginId === 'example.settings'), false);
    document.getElementById(SETTINGS_CENTER_ID).dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    assert.equal(document.getElementById(SETTINGS_CENTER_OVERLAY_ID), null);
    assert.equal(document.body.style.overflow, '');
    assert.equal(document.activeElement, opener);
    runtime.dispose();
    const replacement = installCoreRuntime(coreIdentity({ buildId: 'reload' }), realm, { settingsContainer: container, document });
    assert.equal(replacement.generation, 2);
    assert.equal(document.body.children.flatMap((node) => node.children).filter((node) => node.id === SETTINGS_ROOT_ID).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('custom select renders its own listbox and supports keyboard selection', async () => {
  const restore = installFakeDomGlobals();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, ready: true, schemaVersion: 2, walMode: 'wal' }) });
  try {
    const document = new FakeDocument();
    const container = document.createElement('div'); document.body.append(container);
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { settingsContainer: container, document });
    runtime.settings.mount(container);
    const saved = [];
    const session = runtime.connect(pluginDescriptor('example.custom-select'));
    session.registerSettings({
      id: 'example.custom-select', title: 'Select', fields: [{ kind: 'select', id: 'mode', label: '模式', options: [
        { value: 'balanced', label: '均衡' }, { value: 'precise', label: '精确' }, { value: 'creative', label: '创意' },
      ] }],
    }, {
      load: async () => ({ mode: 'precise' }),
      save: async (values) => { saved.push(values); },
      reset: async () => ({ mode: 'balanced' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    descendants(container).find((node) => node.id === 'ss-helper-open-settings-center').dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    let center = document.getElementById(SETTINGS_CENTER_ID);
    descendants(center).find((node) => node.dataset.pluginId === 'example.custom-select').dispatchEvent({ type: 'click' });
    center = document.getElementById(SETTINGS_CENTER_ID);
    const trigger = descendants(center).find((node) => node.className === 'stx-ui-select-trigger');
    const listbox = descendants(center).find((node) => node.className === 'stx-ui-select-listbox');
    const initialChecks = descendants(listbox).filter((node) => node.className === 'stx-ui-select-check');
    assert.equal(initialChecks.filter((node) => node.hidden === false).length, 1);
    trigger.focus();
    trigger.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {} });
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(listbox.hidden, false);
    assert.match(trigger.getAttribute('aria-activedescendant'), /option-1$/u);
    trigger.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {} });
    assert.match(trigger.getAttribute('aria-activedescendant'), /option-2$/u);
    trigger.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(saved.at(-1).mode, 'creative');
    assert.equal(runtime.settings.snapshot()[0].values.mode, 'creative');
    center = document.getElementById(SETTINGS_CENTER_ID);
    const rerenderedTrigger = descendants(center).find((node) => node.className === 'stx-ui-select-trigger');
    rerenderedTrigger.dispatchEvent({ type: 'click' });
    assert.equal(rerenderedTrigger.getAttribute('aria-expanded'), 'true');
    rerenderedTrigger.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(rerenderedTrigger.getAttribute('aria-expanded'), 'false');
    runtime.dispose();
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('automatic saves are serialized per plugin and the newest successful value wins', async () => {
  const runtime = installCoreRuntime(coreIdentity(), new TestRealm());
  const session = runtime.connect(pluginDescriptor('example.save-queue'));
  const started = [];
  let releaseFirst;
  session.registerSettings({
    id: 'example.save-queue', title: 'Queue', fields: [{ kind: 'number', id: 'count', label: 'Count' }],
  }, {
    load: async () => ({ count: 0 }),
    save: async (values) => {
      started.push(values.count);
      if (started.length === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    },
    reset: async () => ({ count: 0 }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const first = runtime.settings.save('example.save-queue', { count: 1 });
  const second = runtime.settings.save('example.save-queue', { count: 2 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, [1]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(started, [1, 2]);
  assert.equal(runtime.settings.snapshot()[0].values.count, 2);
});

test('a failed queued save rolls back to the preceding successful save or reset', async () => {
  for (const operation of ['save', 'reset']) {
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm());
    const pluginId = `example.rollback-${operation}`;
    const session = runtime.connect(pluginDescriptor(pluginId));
    let releaseFirst;
    let markStarted;
    let persisted = { count: 0 };
    const started = new Promise((resolve) => { markStarted = resolve; });
    session.registerSettings({ id: pluginId, title: 'Queue', fields: [{ kind: 'number', id: 'count', label: 'Count' }] }, {
      load: async () => ({ ...persisted }),
      save: async (values) => {
        if (values.count === 2) throw new Error('save failed');
        await new Promise((release) => { releaseFirst = release; markStarted(); });
        persisted = { ...values };
      },
      reset: async () => {
        await new Promise((release) => { releaseFirst = release; markStarted(); });
        persisted = { count: 1 };
        return { ...persisted };
      },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const first = operation === 'save' ? runtime.settings.save(pluginId, { count: 1 }) : runtime.settings.reset(pluginId);
      await started;
      const second = assert.rejects(runtime.settings.save(pluginId, { count: 2 }), errorCode('INTERNAL'));
      releaseFirst();
      await Promise.all([first, second]);
      assert.deepEqual(persisted, { count: 1 });
      assert.deepEqual(runtime.settings.snapshot()[0].values, persisted);
    } finally { runtime.dispose(); }
  }
});

test('permanent settings failures preserve their root context, stop retrying, and recover on explicit reload', async () => {
  const runtime = installCoreRuntime(coreIdentity(), new TestRealm());
  const id = 'example.settings-recovery';
  const session = runtime.connect(pluginDescriptor(id));
  let loads = 0;
  let broken = true;
  const failure = createSSHelperError('INVALID_PAYLOAD', { stage: 'fixture.settings.read', requestId: 'settings-root' });
  session.registerSettings({ id, title: id, fields: [{ kind: 'toggle', id: 'enabled', label: 'Enabled' }] }, {
    load: async () => { loads++; if (broken) throw failure; return { enabled: true }; },
    save: async () => { throw failure; },
    reset: async () => ({ enabled: false }),
  });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(loads, 1);
  assert.deepEqual(runtime.settings.snapshot()[0].failure, { reasonCode: 'INVALID_PAYLOAD', stage: 'fixture.settings.read', requestId: 'settings-root' });
  broken = false;
  await runtime.settings.reload(id);
  assert.equal(runtime.settings.snapshot()[0].health, 'healthy');
  await assert.rejects(runtime.settings.save(id, { enabled: false }), error => error.details.reasonCode === 'INVALID_PAYLOAD' && error.details.requestId === 'settings-root');
  assert.equal(runtime.settings.snapshot()[0].values.enabled, true);
  session.dispose();
  runtime.dispose();
});

test('reset shares the save queue and reloads authoritative values after failure', async () => {
  const runtime = installCoreRuntime(coreIdentity(), new TestRealm());
  const session = runtime.connect(pluginDescriptor('example.reset-queue'));
  const order = []; let releaseSave; let persisted = { count: 0 }; let failReset = false;
  session.registerSettings({ id: 'example.reset-queue', title: 'Queue', fields: [{ kind: 'number', id: 'count', label: 'Count' }] }, {
    load: async () => ({ ...persisted }),
    save: async (values) => { order.push(`save:${values.count}`); await new Promise((resolve) => { releaseSave = resolve; }); persisted = { ...values }; },
    reset: async () => { order.push('reset'); if (failReset) throw new Error('reset failed'); persisted = { count: 0 }; return { ...persisted }; },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const save = runtime.settings.save('example.reset-queue', { count: 1 });
  const reset = runtime.settings.reset('example.reset-queue');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ['save:1']);
  releaseSave(); await Promise.all([save, reset]);
  assert.deepEqual(order, ['save:1', 'reset']);
  assert.equal(runtime.settings.snapshot()[0].values.count, 0);

  failReset = true; persisted = { count: 7 };
  await assert.rejects(runtime.settings.reset('example.reset-queue'), errorCode('INTERNAL'));
  assert.equal(runtime.settings.snapshot()[0].values.count, 7);
});

test('settings center renders screenshot-style tabs, search, controls, auto-save state, and inline errors', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const container = document.createElement('div'); document.body.append(container);
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { settingsContainer: container, document });
    const session = runtime.connect(pluginDescriptor('example.legacy-theme'));
    const saved = [];
    let emitSettings;
    let popupInput;
    const popupToken = { kind: 'popup', provider: 'example.legacy-theme', name: 'tools', version: 0 };
    session.registerPopup({ token: popupToken, title: 'Tools', render: (_popupContainer, input) => { popupInput = input; } });
    session.registerSettings({
      id: 'example.legacy-theme', title: 'Legacy theme', fields: [
        { kind: 'section', id: 'basic', label: '基础', children: [
          { kind: 'toggle', id: 'enabled', label: '启用', description: '是否启用。' },
          { kind: 'action', id: 'legacyAction', label: '旧版底栏动作', actionId: 'legacy' },
        ] },
        { kind: 'section', id: 'advanced', label: '高级', children: [
          { kind: 'range', id: 'volume', label: '预算', min: 0, max: 10, step: 1 },
          { kind: 'checkbox', id: 'strict', label: '严格模式' },
          { kind: 'radio', id: 'strategy', label: '响应策略', options: [{ value: 'auto', label: '自动' }, { value: 'exact', label: '精确' }] },
          { kind: 'multiSelect', id: 'sources', label: '记忆来源', options: [{ value: 'chat', label: '聊天记录' }, { value: 'world', label: '世界书' }] },
          { kind: 'number', id: 'count', label: '召回条数', step: 1, unit: '条', validation: { min: 1, max: 50 } },
          { kind: 'action', id: 'open', label: '打开工具', description: '在高级页打开工具。', actionId: 'open', placement: 'inline', buttonLabel: '进入工具', popup: popupToken },
          { kind: 'action', id: 'danger', label: '危险工具', actionId: 'danger', tone: 'danger', placement: 'inline', buttonLabel: '执行', disabledReason: '当前不可用' },
        ] },
      ],
    }, {
      load: async () => ({ enabled: true, volume: 3, strict: false, strategy: 'auto', sources: ['chat'], count: 12 }),
      save: async (values) => { saved.push(values); if (values.volume === 10) throw new Error('adapter failed'); },
      reset: async () => ({ enabled: false, volume: 0, strict: false, strategy: 'auto', sources: ['chat'], count: 1 }),
      subscribe: (listener) => { emitSettings = listener; return () => {}; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = document.getElementById(SETTINGS_ROOT_ID);
    descendants(root).find((node) => node.id === 'ss-helper-open-settings-center').dispatchEvent({ type: 'click' });
    let center = document.getElementById(SETTINGS_CENTER_ID);
    descendants(center).find((node) => node.dataset.pluginId === 'example.legacy-theme').dispatchEvent({ type: 'click' });
    center = document.getElementById(SETTINGS_CENTER_ID);
    const scrollArea = descendants(center).find((node) => node.classList.contains('stx-center-scroll'));
    scrollArea.scrollTop = 173;
    emitSettings({ enabled: true, volume: 3, strict: false, strategy: 'auto', sources: ['chat'], count: 12 });
    center = document.getElementById(SETTINGS_CENTER_ID);
    assert.equal(descendants(center).find((node) => node.classList.contains('stx-center-scroll')).scrollTop, 173);

    const tabButtons = descendants(center).filter((node) => node.dataset.tabId);
    const tabPanels = descendants(center).filter((node) => node.dataset.tabPanel);
    assert.equal(tabButtons.length, 2);
    assert.equal(tabPanels.filter((node) => node.hidden === false).length, 1);
    tabButtons[1].dispatchEvent({ type: 'click' });
    assert.equal(tabButtons[1].getAttribute('aria-selected'), 'true');
    assert.equal(tabPanels[1].hidden, false);

    tabButtons[0].dispatchEvent({ type: 'click' });
    const search = descendants(center).find((node) => node.tagName === 'INPUT' && node.type === 'search');
    search.value = '打开工具';
    search.dispatchEvent({ type: 'input' });
    assert.equal(tabButtons[1].getAttribute('aria-selected'), 'true');
    assert.equal(tabPanels[1].hidden, false);
    const inlineActionRow = descendants(center).find((node) => node.dataset.fieldId === 'open');
    const footerActions = descendants(center).find((node) => node.className === 'stx-center-footer-actions');
    assert.equal(tabPanels[1].contains(inlineActionRow), true);
    assert.equal(footerActions.contains(inlineActionRow), false);
    assert.equal(descendants(footerActions).some((node) => node.tagName === 'BUTTON' && node.textContent === '旧版底栏动作'), true);
    const inlineActionButton = descendants(inlineActionRow).find((node) => node.tagName === 'BUTTON');
    assert.equal(inlineActionButton.textContent, '进入工具');
    assert.equal(inlineActionButton.id, 'ss-helper-example-legacy-theme-open');
    assert.ok(inlineActionButton.getAttribute('aria-describedby'));
    const savesBeforeAction = saved.length;
    inlineActionButton.dispatchEvent({ type: 'click' });
    assert.deepEqual(popupInput, { actionId: 'open' });
    assert.equal(saved.length, savesBeforeAction);
    const actionPopup = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    actionPopup.children[0].dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.activeElement, inlineActionButton);
    const disabledActionButton = descendants(center).find((node) => node.dataset.fieldId === 'danger').children
      .flatMap((node) => [node, ...descendants(node)]).find((node) => node.tagName === 'BUTTON');
    assert.equal(disabledActionButton.disabled, true);
    assert.equal(disabledActionButton.getAttribute('aria-disabled'), 'true');
    assert.match(disabledActionButton.className, /stx-ui-btn-danger/u);

    search.value = '预算';
    search.dispatchEvent({ type: 'input' });
    let rows = descendants(center).filter((node) => node.dataset.fieldId);
    assert.equal(rows.find((node) => node.dataset.fieldId === 'enabled').hidden, true);
    assert.equal(rows.find((node) => node.dataset.fieldId === 'volume').hidden, false);
    search.value = '不存在';
    search.dispatchEvent({ type: 'input' });
    assert.equal(descendants(center).find((node) => node.dataset.searchEmpty === 'true')?.hidden, false);

    search.value = '预算';
    search.dispatchEvent({ type: 'input' });
    const volumeInputs = descendants(center).find((node) => node.dataset.fieldId === 'volume').children
      .flatMap((node) => [node, ...descendants(node)]).filter((node) => node.tagName === 'INPUT');
    const volume = volumeInputs.find((node) => node.type === 'range');
    const volumeNumber = volumeInputs.find((node) => node.type === 'number');
    assert.ok(volume);
    assert.ok(volumeNumber);
    assert.equal(descendants(center).some((node) => node.tagName === 'OUTPUT'), false);
    volume.value = '7';
    volume.dispatchEvent({ type: 'input' });
    assert.equal(volumeNumber.value, '7');
    volumeNumber.value = '8';
    volumeNumber.dispatchEvent({ type: 'input' });
    volumeNumber.dispatchEvent({ type: 'blur' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(saved.at(-1).volume, 8);
    volume.value = '10';
    volume.dispatchEvent({ type: 'change' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(saved.at(-1).volume, 10);
    center = document.getElementById(SETTINGS_CENTER_ID);
    rows = descendants(center).filter((node) => node.dataset.fieldId);
    assert.match(rows.find((node) => node.dataset.fieldId === 'volume').dataset.validationError, /保存失败/);
    assert.equal(descendants(center).some((node) => node.className.includes('stx-ui-number-stepper')), true);
    assert.equal(descendants(center).some((node) => node.className.includes('stx-ui-radio-option')), true);
    assert.equal(descendants(center).some((node) => node.className.includes('stx-ui-chip')), true);
  } finally { restore(); }
});

test('settings schemas allow the eleven supported kinds and reject unknown kinds before rendering', () => {
  const runtime = installCoreRuntime(coreIdentity(), new TestRealm());
  const valid = runtime.connect(pluginDescriptor('example.valid-kinds'));
  assert.doesNotThrow(() => valid.registerSettings({
    id: 'example.valid-kinds', title: 'All kinds', fields: [
      { kind: 'toggle', id: 'toggle', label: 'Toggle' },
      { kind: 'checkbox', id: 'checkbox', label: 'Checkbox' },
      { kind: 'text', id: 'text', label: 'Text' },
      { kind: 'number', id: 'timeoutMs', label: 'Number', step: 1, unit: 'ms' },
      { kind: 'range', id: 'range', label: 'Range', min: 0, max: 1 },
      { kind: 'select', id: 'select', label: 'Select', options: [{ value: 'a', label: 'A' }] },
      { kind: 'radio', id: 'radio', label: 'Radio', options: [{ value: 'a', label: 'A' }] },
      { kind: 'multiSelect', id: 'multi', label: 'Multi', options: [{ value: 'a', label: 'A' }] },
      { kind: 'section', id: 'section', label: 'Section', children: [] },
      { kind: 'action', id: 'action', label: 'Action', actionId: 'run', placement: 'inline', buttonLabel: 'Run' },
      { kind: 'status', id: 'status', label: 'Status', value: 'Ready' },
    ],
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }));
  const invalid = runtime.connect(pluginDescriptor('example.invalid-kind'));
  assert.throws(() => invalid.registerSettings({
    id: 'example.invalid-kind', title: 'Invalid', fields: [{ kind: 'html', id: 'unsafe', label: 'Unsafe', html: '<b>x</b>' }],
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }), errorCode('INVALID_PAYLOAD'));
  assert.equal(runtime.settings.snapshot().some((entry) => entry.id === 'example.invalid-kind'), false);
  const invalidPlacement = runtime.connect(pluginDescriptor('example.invalid-action-placement'));
  assert.throws(() => invalidPlacement.registerSettings({
    id: 'example.invalid-action-placement', title: 'Invalid action placement', fields: [{ kind: 'action', id: 'run', label: 'Run', actionId: 'run', placement: 'sidebar' }],
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }), errorCode('INVALID_PAYLOAD'));
  const invalidButtonLabel = runtime.connect(pluginDescriptor('example.invalid-action-label'));
  assert.throws(() => invalidButtonLabel.registerSettings({
    id: 'example.invalid-action-label', title: 'Invalid action label', fields: [{ kind: 'action', id: 'run', label: 'Run', actionId: 'run', buttonLabel: '   ' }],
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }), errorCode('INVALID_PAYLOAD'));
  const invalidDefault = runtime.connect(pluginDescriptor('example.invalid-default'));
  assert.throws(() => invalidDefault.registerSettings({
    id: 'example.invalid-default', title: 'Invalid default', fields: [{ kind: 'select', id: 'mode', label: 'Mode', options: [{ value: 'a', label: 'A' }], defaultValue: 'missing' }],
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }), errorCode('INVALID_PAYLOAD'));
  const invalidFieldKey = runtime.connect(pluginDescriptor('example.invalid-field-key'));
  assert.throws(() => invalidFieldKey.registerSettings({
    id: 'example.invalid-field-key', title: 'Invalid field key', fields: [{ kind: 'toggle', id: 'enabled', label: 'Enabled', legacyValue: true }],
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }), errorCode('INVALID_PAYLOAD'));
  const invalidValidation = runtime.connect(pluginDescriptor('example.invalid-validation'));
  assert.throws(() => invalidValidation.registerSettings({
    id: 'example.invalid-validation', title: 'Invalid validation', fields: [{ kind: 'number', id: 'count', label: 'Count', validation: { min: 10, max: 1 } }],
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }), errorCode('INVALID_PAYLOAD'));
});

test('settings values reject undeclared domain fields on load, subscribe, save, and reset', async () => {
  const runtime = installCoreRuntime(coreIdentity(), new TestRealm());
  const loadSession = runtime.connect(pluginDescriptor('example.unknown-load'));
  loadSession.registerSettings({ id: 'example.unknown-load', title: 'Load', fields: [{ kind: 'toggle', id: 'enabled', label: 'Enabled' }] }, {
    load: async () => ({ enabled: true, internalOnly: 'secret-domain-state' }),
    save: async () => {},
    reset: async () => ({ enabled: false }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.settings.snapshot().find((entry) => entry.id === 'example.unknown-load').failure?.reasonCode, 'INVALID_PAYLOAD');

  const session = runtime.connect(pluginDescriptor('example.unknown-values'));
  let emit;
  let saves = 0;
  session.registerSettings({ id: 'example.unknown-values', title: 'Values', fields: [{ kind: 'toggle', id: 'enabled', label: 'Enabled' }] }, {
    load: async () => ({ enabled: true }),
    save: async () => { saves += 1; },
    reset: async () => ({ enabled: false, legacyInternal: 1 }),
    subscribe: (listener) => { emit = listener; return () => {}; },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(runtime.settings.save('example.unknown-values', { enabled: false, internalOnly: true }), errorCode('INVALID_PAYLOAD'));
  assert.equal(saves, 0);
  emit({ enabled: true, internalOnly: 'nope' });
  assert.equal(runtime.settings.snapshot().find((entry) => entry.id === 'example.unknown-values').failure?.reasonCode, 'INVALID_PAYLOAD');
  await assert.rejects(runtime.settings.reset('example.unknown-values'), errorCode('INVALID_PAYLOAD'));
  assert.equal(runtime.settings.snapshot().find((entry) => entry.id === 'example.unknown-values').failure?.reasonCode, 'INVALID_PAYLOAD');
});

test('required settings are validated consistently and missing saves never reach the adapter', async () => {
  const runtime = installCoreRuntime(coreIdentity(), new TestRealm());
  const session = runtime.connect(pluginDescriptor('example.required'));
  let saves = 0;
  let emit;
  session.registerSettings(schema('example.required'), {
    load: async () => ({ enabled: true }),
    save: async () => { saves += 1; },
    reset: async () => ({ enabled: false }),
    subscribe: (listener) => { emit = listener; return () => {}; },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.settings.snapshot()[0].health, 'degraded');
  await assert.rejects(runtime.settings.save('example.required', { enabled: false }), errorCode('INVALID_PAYLOAD'));
  assert.equal(saves, 0);
  emit({ enabled: true });
  assert.equal(runtime.settings.snapshot()[0].health, 'degraded');
  await assert.rejects(runtime.settings.reset('example.required'), errorCode('INVALID_PAYLOAD'));
  assert.equal(runtime.settings.snapshot()[0].health, 'degraded');
});

test('adapter errors degrade only one plugin and reload restores through its own adapter', async () => {
  const realm = new TestRealm();
  const runtime = installCoreRuntime(coreIdentity(), realm);
  const bad = runtime.connect(pluginDescriptor('example.bad'));
  const good = runtime.connect(pluginDescriptor('example.good'));
  bad.registerSettings(schema('example.bad'), { load: async () => { throw new Error('secret'); }, save: async () => {}, reset: async () => ({}) });
  good.registerSettings(schema('example.good'), { load: async () => ({ enabled: true, 'api-key': 'good' }), save: async () => {}, reset: async () => ({}) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const snapshots = runtime.settings.snapshot();
  assert.equal(snapshots.find((entry) => entry.id === 'example.bad').health, 'degraded');
  assert.equal(snapshots.find((entry) => entry.id === 'example.bad').failure?.reasonCode, 'SETTINGS_READ_FAILED');
  assert.equal(snapshots.find((entry) => entry.id === 'example.good').health, 'healthy');
  bad.dispose();
  const reloaded = runtime.connect(pluginDescriptor('example.bad'));
  reloaded.registerSettings(schema('example.bad'), { load: async () => ({ enabled: false, 'api-key': 'restored' }), save: async () => {}, reset: async () => ({}) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.settings.snapshot().find((entry) => entry.id === 'example.bad').health, 'healthy');
});

test('a later authoritative settings snapshot clears a transient startup read failure without showing a save failure', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const container = document.createElement('div'); document.body.append(container);
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { settingsContainer: container, document });
    const session = runtime.connect(pluginDescriptor('example.settings-recovery'));
    let emitValues;
    session.registerSettings(schema('example.settings-recovery'), {
      load: async () => { throw new Error('bridge warming'); },
      save: async () => {},
      reset: async () => ({ enabled: false, 'api-key': 'reset', count: 1, volume: 0, mode: 'a' }),
      subscribe: (listener) => { emitValues = listener; return () => {}; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(runtime.settings.snapshot()[0].health, 'degraded');
    assert.equal(runtime.settings.snapshot()[0].failure?.reasonCode, 'SETTINGS_READ_FAILED');

    descendants(container).find((node) => node.id === 'ss-helper-open-settings-center').dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.pluginId === 'example.settings-recovery').dispatchEvent({ type: 'click' });
    let footer = descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.saveStatus === 'example.settings-recovery');
    assert.equal(descendants(footer).some((node) => node.textContent.includes('SETTINGS_READ_FAILED')), true);
    assert.equal(descendants(footer).some((node) => node.textContent === '保存失败，请检查设置'), false);

    emitValues({ enabled: true, 'api-key': 'ready', count: 2, volume: 5, mode: 'a' });
    assert.equal(runtime.settings.snapshot()[0].health, 'healthy');
    assert.equal(runtime.settings.snapshot()[0].failure?.reasonCode, undefined);
    footer = descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.saveStatus === 'example.settings-recovery');
    assert.equal(descendants(footer).some((node) => node.textContent === '修改后自动保存'), true);
    session.dispose();
    runtime.dispose();
  } finally { restore(); }
});

test('auxiliary status failures stay advisory, keep settings writable, and recover through their own subscription', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const container = document.createElement('div'); document.body.append(container);
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { settingsContainer: container, document });
    const session = runtime.connect(pluginDescriptor('example.status-recovery'));
    let emitStatus;
    let saves = 0;
    session.registerSettings({
      id: 'example.status-recovery', title: 'Status recovery', fields: [
        { kind: 'toggle', id: 'enabled', label: 'Enabled' },
        { kind: 'status', id: 'state', label: 'State', value: 'Waiting' },
      ],
    }, {
      load: async () => ({ enabled: true }),
      save: async () => { saves += 1; },
      reset: async () => ({ enabled: false }),
      loadStatus: async () => { throw new Error('status warming'); },
      subscribeStatus: (listener) => { emitStatus = listener; return () => {}; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(runtime.settings.snapshot()[0].health, 'degraded');
    assert.equal(runtime.settings.snapshot()[0].failure?.reasonCode, 'SETTINGS_READ_FAILED');

    descendants(container).find((node) => node.id === 'ss-helper-open-settings-center').dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.pluginId === 'example.status-recovery').dispatchEvent({ type: 'click' });
    let footer = descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.saveStatus === 'example.status-recovery');
    assert.equal(descendants(footer).some((node) => node.textContent.includes('SETTINGS_READ_FAILED')), true);
    assert.equal(descendants(footer).some((node) => node.textContent === '保存失败，请检查设置'), false);

    await runtime.settings.save('example.status-recovery', { enabled: false });
    assert.equal(saves, 1);
    assert.equal(runtime.settings.snapshot()[0].health, 'degraded', 'a successful save must not hide an unrelated status issue');
    footer = descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.saveStatus === 'example.status-recovery');
    assert.equal(descendants(footer).some((node) => node.textContent.includes('SETTINGS_READ_FAILED')), true);

    emitStatus({ state: { value: 'Ready', tone: 'success' } });
    assert.equal(runtime.settings.snapshot()[0].health, 'healthy');
    assert.equal(runtime.settings.snapshot()[0].failure?.reasonCode, undefined);
    session.dispose();
    runtime.dispose();
  } finally { restore(); }
});

test('a real persistence failure survives unrelated snapshots until a later save succeeds', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const container = document.createElement('div'); document.body.append(container);
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { settingsContainer: container, document });
    const session = runtime.connect(pluginDescriptor('example.persistence-recovery'));
    let emitValues;
    let rejectSave = true;
    session.registerSettings({ id: 'example.persistence-recovery', title: 'Persistence', fields: [{ kind: 'toggle', id: 'enabled', label: 'Enabled' }] }, {
      load: async () => ({ enabled: true }),
      save: async () => { if (rejectSave) throw new Error('disk unavailable'); },
      reset: async () => ({ enabled: false }),
      subscribe: (listener) => { emitValues = listener; return () => {}; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await assert.rejects(runtime.settings.save('example.persistence-recovery', { enabled: false }), errorCode('INTERNAL'));
    assert.equal(runtime.settings.snapshot()[0].failure?.reasonCode, 'SETTINGS_SAVE_FAILED');

    emitValues({ enabled: true });
    assert.equal(runtime.settings.snapshot()[0].health, 'degraded', 'a value snapshot does not prove the failed write committed');
    assert.equal(runtime.settings.snapshot()[0].failure?.reasonCode, 'SETTINGS_SAVE_FAILED');

    rejectSave = false;
    await runtime.settings.save('example.persistence-recovery', { enabled: false });
    assert.equal(runtime.settings.snapshot()[0].health, 'healthy');
    assert.equal(runtime.settings.snapshot()[0].failure?.reasonCode, undefined);
    session.dispose();
    runtime.dispose();
  } finally { restore(); }
});

test('registered popup owns dialog lifecycle, Escape cleanup, focus return, and unregister fail-closed', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.popup'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.popup', name: 'workbench', version: 0 });
    let disposed = 0;
    const unregister = session.registerPopup({ token, title: 'Workbench', render: (container) => { const input = document.createElement('input'); container.append(input); return () => { disposed += 1; }; } });
    session.ui.openPopup(token, { tab: 'main' });
    const overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    const dialog = overlay.children[0];
    assert.equal(dialog.getAttribute('role'), 'dialog');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(disposed, 1);
    assert.equal(document.activeElement, opener);
    unregister();
    assert.throws(() => session.ui.openPopup(token, {}), errorCode('INVALID_PAYLOAD'));
  } finally { restore(); }
});

test('popup tokens cannot be opened by a different plugin session', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const owner = runtime.connect(pluginDescriptor('example.popup-owner'));
    const caller = runtime.connect(pluginDescriptor('example.popup-caller'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.popup-owner', name: 'details', version: 0 });
    let renders = 0;
    owner.registerPopup({ token, title: 'Details', render: () => { renders += 1; } });
    assert.throws(() => caller.ui.openPopup(token, {}), errorCode('INVALID_PAYLOAD'));
    assert.equal(renders, 0);
    assert.equal(document.body.children.some((node) => node.dataset.ssHelperPopup !== undefined), false);
  } finally { restore(); }
});

test('workspace popup exposes a stable presentation marker and shared chrome', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.workspace-popup'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.workspace-popup', name: 'workbench', version: 0 });
    session.registerPopup({ token, title: 'Workspace', presentation: 'workspace', render: (container) => { container.append(document.createElement('main')); } });
    session.ui.openPopup(token, {});
    const overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    const dialog = overlay.children[0];
    assert.equal(dialog.dataset.presentation, 'workspace');
    assert.equal(dialog.children[0].dataset.popupHeader, 'true');
    assert.equal(dialog.children[1].dataset.popupContent, 'true');
    assert.equal(dialog.children[2].dataset.popupResizeHandle, 'true');
    assert.equal(dialog.children[2].getAttribute('aria-label'), '调整窗口大小');
    assert.equal(dialog.children[2].dataset.popupResizeEdge, 'right');
    assert.equal(dialog.children[3].dataset.popupResizeHandle, 'true');
    assert.equal(dialog.children[3].dataset.popupResizeEdge, 'left');
    assert.equal(dialog.children[3].getAttribute('aria-label'), '从左下角调整窗口大小');
    const coreStyles = document.getElementById('ss-helper-core-ui-styles').textContent;
    assert.match(coreStyles, /width: min\(96vw, 88rem\); height: min\(92vh, 58rem\)/);
    assert.match(coreStyles, /\[data-popup-resize-handle="true"\]/);
    assert.match(coreStyles, /\[data-popup-resize-handle="true"\]\[data-popup-resize-edge="left"\]/);
    assert.match(coreStyles, /clip-path: polygon\(100% 0, 100% 100%, 0 100%\); opacity: \.48;/);
    assert.match(coreStyles, /\[data-popup-resize-handle="true"\] \{ display: none; \}/);
    dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.activeElement, opener);
    assert.throws(() => session.registerPopup({ token: Object.freeze({ kind: 'popup', provider: 'example.workspace-popup', name: 'invalid', version: 0 }), title: 'Invalid', presentation: 'unsupported', render: () => {} }), errorCode('INVALID_PAYLOAD'));
  } finally { restore(); }
});

test('workspace popup restores and updates its browser-persisted size', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const values = new Map([['ss-helper.popup-size:["example.popup-size","workbench",0]', JSON.stringify({ width: 900, height: 700 })]]);
    Object.assign(document.defaultView, {
      innerWidth: 1600,
      innerHeight: 1000,
      getComputedStyle: () => ({ minWidth: '672px', minHeight: '512px' }),
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    });
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.popup-size'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.popup-size', name: 'workbench', version: 0 });
    session.registerPopup({ token, title: 'Workspace', presentation: 'workspace', render: () => {} });
    session.ui.openPopup(token, {});
    let overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    let dialog = overlay.children[0];
    assert.equal(dialog.style.width, '900px');
    assert.equal(dialog.style.height, '700px');
    dialog.getBoundingClientRect = () => ({ width: Number.parseFloat(dialog.style.width), height: Number.parseFloat(dialog.style.height) });
    dialog.children[2].dispatchEvent({ type: 'keydown', key: 'ArrowRight', shiftKey: false, preventDefault() {} });
    assert.deepEqual(JSON.parse(values.values().next().value), { width: 910, height: 700 });
    dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.ui.openPopup(token, {});
    overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    dialog = overlay.children[0];
    assert.equal(dialog.style.width, '910px');
    assert.equal(dialog.style.height, '700px');
  } finally { restore(); }
});

test('workspace popup keeps corner drags under the pointer and recenters after viewport changes', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    Object.assign(document.defaultView, {
      innerWidth: 1600,
      innerHeight: 1000,
      getComputedStyle: () => ({ minWidth: '672px', minHeight: '512px' }),
    });
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.popup-pointer-resize'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.popup-pointer-resize', name: 'workbench', version: 0 });
    session.registerPopup({ token, title: 'Workspace', presentation: 'workspace', render: () => {} });
    session.ui.openPopup(token, {});
    const overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    const dialog = overlay.children[0];
    const readStyleNumber = (value, fallback) => {
      const parsed = Number.parseFloat(value ?? '');
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    dialog.getBoundingClientRect = () => ({
      left: readStyleNumber(dialog.style.left, 350),
      top: readStyleNumber(dialog.style.top, 150),
      width: readStyleNumber(dialog.style.width, 900),
      height: readStyleNumber(dialog.style.height, 700),
    });
    const leftHandle = dialog.children[3];
    leftHandle.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 7, clientX: 350, clientY: 850, preventDefault() {} });
    document.defaultView.dispatchEvent({ type: 'pointermove', pointerId: 7, clientX: 300, clientY: 875, preventDefault() {} });
    assert.equal(dialog.style.width, '1000px');
    assert.equal(dialog.style.height, '750px');
    assert.equal(dialog.style.left, '300px');
    assert.equal(dialog.style.top, '125px');
    document.defaultView.dispatchEvent({ type: 'pointerup', pointerId: 7 });
    assert.equal(dialog.style.position, 'fixed');

    document.defaultView.innerWidth = 600;
    document.defaultView.innerHeight = 800;
    document.defaultView.dispatchEvent({ type: 'resize' });
    assert.equal(dialog.style.position, '');
    assert.equal(dialog.style.left, '');
    assert.equal(dialog.style.top, '');
    assert.equal(dialog.style.margin, '');
    dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  } finally { restore(); }
});

test('popup restores focus to a rerendered opener with the same stable id', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const opener = document.createElement('button'); opener.id = 'stable-popup-opener'; document.body.append(opener); opener.focus();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.popup-focus'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.popup-focus', name: 'focus', version: 0 });
    session.registerPopup({ token, title: 'Focus', render: () => {} });
    session.ui.openPopup(token, {});
    const replacement = document.createElement('button'); replacement.id = opener.id;
    opener.remove(); opener.isConnected = false; document.body.append(replacement);
    const overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    overlay.children[0].dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.activeElement, replacement);
  } finally { restore(); }
});

test('popup public controls share Core styles and enhance native selects idempotently', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.popup-controls'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.popup-controls', name: 'controls', version: 0 });
    let nativeSelect;
    let changes = 0;
    let toggleValue = true;
    let menuSelection = '';
    session.registerPopup({
      token,
      title: 'Controls',
      closeLabel: '关闭控件测试',
      render: (container, _input, ui) => {
        const label = document.createElement('label'); label.textContent = '模式';
        nativeSelect = document.createElement('select'); nativeSelect.setAttribute('data-ss-helper-control', 'select'); nativeSelect.setAttribute('aria-label', '模式');
        const first = document.createElement('option'); first.value = 'a'; first.textContent = 'A'; first.selected = true;
        const second = document.createElement('option'); second.value = 'b'; second.textContent = 'B';
        nativeSelect.value = 'a'; nativeSelect.append(first, second); nativeSelect.addEventListener('change', () => { changes += 1; });
        label.append(nativeSelect); container.append(label);
        container.append(ui.createIcon({ name: 'circle-plus', label: '新增' }));
        container.append(ui.createButton({ label: '刷新', icon: 'rotate', iconOnly: true, size: 'sm' }));
        container.append(ui.createToggle({ label: '启用资源', checked: true, onChange: async (value) => { toggleValue = value; } }));
        container.append(ui.createMenu({
          label: '更多操作',
          items: [
            { id: 'copy', label: '复制', icon: 'copy' },
            { id: 'delete', label: '删除', icon: 'trash', tone: 'danger', separatorBefore: true },
          ],
          onSelect: async (id) => { menuSelection = id; },
        }).element);
        ui?.refreshControls(container); ui?.refreshControls(container);
      },
    });
    session.ui.openPopup(token, {});
    const overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    const dialog = overlay.children[0];
    const controls = descendants(dialog);
    const shells = controls.filter((node) => node.className === 'stx-ui-select-wrap');
    assert.equal(shells.length, 1);
    assert.equal(shells[0].previousElementSibling, nativeSelect);
    assert.equal(nativeSelect.hidden, true);
    assert.equal(nativeSelect.getAttribute('aria-hidden'), 'true');
    const trigger = shells[0].children[0];
    trigger.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {}, stopPropagation() {} });
    trigger.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {}, stopPropagation() {} });
    trigger.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {}, stopPropagation() {} });
    assert.equal(nativeSelect.value, 'b');
    assert.equal(changes, 1);
    assert.equal(shells[0].children[1].children[0].getAttribute('aria-selected'), 'false');
    assert.equal(shells[0].children[1].children[1].getAttribute('aria-selected'), 'true');
    assert.equal(shells[0].children[1].children[1].children[1].hidden, false);
    const closeButton = dialog.children[0].children[1];
    assert.equal(closeButton.getAttribute('aria-label'), '关闭控件测试');
    assert.equal(closeButton.children[0].tagName, 'SS-HELPER-ICON');
    assert.equal(closeButton.children[0].getAttribute('name'), 'xmark');
    assert.equal(closeButton.children[0].getAttribute('aria-hidden'), 'true');
    const publicIcon = controls.find((node) => node.tagName === 'SS-HELPER-ICON' && node.getAttribute('name') === 'circle-plus' && node.getAttribute('role') === 'img');
    assert.equal(publicIcon.getAttribute('aria-label'), '新增');
    const iconButton = controls.find((node) => node.title === '刷新');
    assert.equal(iconButton.dataset.ssHelperIconOnly, 'true');
    assert.equal(iconButton.children[0].getAttribute('name'), 'rotate');
    const toggle = controls.find((node) => node.getAttribute('role') === 'switch');
    toggle.dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(toggle.getAttribute('aria-checked'), 'false');
    assert.equal(toggleValue, false);
    const menuTrigger = controls.find((node) => node.getAttribute('aria-haspopup') === 'menu');
    menuTrigger.dispatchEvent({ type: 'click' });
    const menuList = document.body.children.find((node) => node.className === 'stx-popup-menu-list');
    assert.ok(menuList);
    assert.equal(menuList.children[1].dataset.tone, 'danger');
    assert.equal(menuList.children[1].dataset.separatorBefore, 'true');
    menuList.children[0].dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(menuSelection, 'copy');
    assert.equal(document.body.children.some((node) => node.className === 'stx-popup-menu-list'), false);
    dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(nativeSelect.hidden, false);
    const styles = document.body.children.find((node) => node.dataset.ssHelperStyle === 'core-ui').textContent;
    assert.match(styles, /\[data-ss-helper-popup\].*--ss-theme-surface/su);
    assert.match(styles, /padding-inline-start:\s*var\(--ss-control-input-padding-inline-start,\s*11px\)/u);
    assert.match(styles, /padding-inline-end:\s*var\(--ss-control-input-padding-inline-end,\s*11px\)/u);
    for (const kind of ['button', 'segmented', 'input', 'textarea', 'checkbox', 'status', 'progress', 'file-trigger']) {
      assert.ok(styles.includes(`data-ss-helper-control="${kind}"`));
    }
    for (const tone of ['neutral', 'primary', 'danger', 'success', 'warning', 'error']) {
      assert.ok(styles.includes(`data-ss-helper-tone="${tone}"`));
    }
    for (const size of ['xs', 'sm', 'md', 'lg']) {
      assert.ok(styles.includes(`data-ss-helper-size="${size}"`));
    }
    assert.match(styles, /\[data-ss-helper-icon-only\][^{]*\{[^}]*border:\s*0[^}]*background:\s*transparent/u);
    assert.match(styles, /\[data-ss-helper-control="segmented"\]\s*>\s*\[data-ss-helper-control="button"\]\s*\{[^}]*border:\s*0[^}]*transition:/u);
    assert.match(styles, /\[data-ss-helper-control="segmented"\]\s*>\s*\[data-ss-helper-control="button"\]:is\(\[aria-pressed="true"\],\s*\[aria-selected="true"\]\)\s*\{[^}]*border:\s*0[^}]*box-shadow:\s*none[^}]*filter:\s*brightness\(1\.12\)/u);
    assert.match(styles, /\[data-ss-helper-control="segmented"\]\s*>\s*\[data-ss-helper-control="button"\]:hover\s*\{[^}]*transform:\s*translateY\(-1px\)/u);
    assert.match(styles, /\.stx-center-close\s*\{[^}]*border:\s*0/u);
    assert.match(styles, /\[data-popup-header="true"\]\s+button\s*\{[^}]*border:\s*0/u);
  } finally { restore(); }
});

test('popup select preserves option groups and renders concise secondary descriptions', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.grouped-select'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.grouped-select', name: 'controls', version: 0 });
    let nativeSelect;
    let changes = 0;
    session.registerPopup({
      token,
      title: 'Grouped Select',
      render: (container, _input, ui) => {
        nativeSelect = document.createElement('select');
        nativeSelect.setAttribute('data-ss-helper-control', 'select');
        nativeSelect.setAttribute('aria-label', '目标人物');
        const recommended = document.createElement('optgroup'); recommended.setAttribute('label', '推荐匹配');
        const first = document.createElement('option'); first.value = 'owner-a'; first.textContent = '艾琳'; first.selected = true;
        first.setAttribute('data-ss-helper-description', '已确认 · 置信度 93% · 别名：店长');
        recommended.append(first);
        const pending = document.createElement('optgroup'); pending.setAttribute('label', '待确认人物');
        const second = document.createElement('option'); second.value = 'owner-b'; second.textContent = '贝拉';
        second.setAttribute('data-ss-helper-description', '待确认 · 置信度 86%');
        pending.append(second);
        nativeSelect.value = 'owner-a';
        nativeSelect.append(recommended, pending);
        nativeSelect.addEventListener('change', () => { changes += 1; });
        container.append(nativeSelect);
        ui?.refreshControls(container);
      },
    });
    session.ui.openPopup(token, {});
    const overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    const shell = descendants(overlay).find((node) => node.className === 'stx-ui-select-wrap');
    const listbox = shell.children[1];
    assert.equal(listbox.children[0].className, 'stx-ui-select-group');
    assert.equal(listbox.children[0].textContent, '推荐匹配');
    assert.equal(listbox.children[1].getAttribute('role'), 'option');
    assert.equal(listbox.children[1].children[0].children[0].textContent, '艾琳');
    assert.equal(listbox.children[1].children[0].children[1].textContent, '已确认 · 置信度 93% · 别名：店长');
    assert.equal(listbox.children[2].textContent, '待确认人物');
    listbox.children[3].dispatchEvent({ type: 'click' });
    assert.equal(nativeSelect.value, 'owner-b');
    assert.equal(changes, 1);
  } finally { restore(); }
});

test('throwing popup render rolls back overlay, listeners, session cleanup, and focus', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.throwing-popup'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.throwing-popup', name: 'broken', version: 0 });
    session.registerPopup({ token, title: 'Broken', render: () => { throw new Error('private renderer failure'); } });
    assert.throws(() => session.ui.openPopup(token, {}), errorCode('INVALID_PAYLOAD'));
    assert.equal(document.body.children.filter((node) => node.dataset.ssHelperPopup !== undefined).length, 0);
    assert.equal(document.activeElement, opener);
    assert.doesNotThrow(() => session.dispose());
    assert.equal(document.body.children.filter((node) => node.dataset.ssHelperPopup !== undefined).length, 0);
  } finally { restore(); }
});

test('popup virtual list loads one cursor page, bounds DOM rows, and preserves a stable mounted instance', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.popup-list'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.popup-list', name: 'list', version: 0 });
    const requests = [];
    let firstElement;
    let handle;
    let popupUi;
    let listDefinition;
    let popupContainer;
    session.registerPopup({
      token,
      title: 'Virtual list',
      render: (container, _input, ui) => {
        popupUi = ui;
        popupContainer = container;
        const host = document.createElement('div');
        container.append(host);
        listDefinition = {
          id: 'records',
          ariaLabel: '记录列表',
          queryKey: 'all',
          overscan: 6,
          maxCachedPages: 1,
          itemHeight: 20,
          itemGap: 4,
          selectable: true,
          getKey: item => item.id,
          loadPage: async ({ cursor, limit, signal }) => {
            requests.push({ cursor, limit, signal });
            return {
              items: Array.from({ length: limit }, (_, index) => ({ id: `${cursor ?? 'first'}-${index}` })),
              nextCursor: cursor === undefined ? 'page-2' : null,
              total: 40,
            };
          },
          renderItem: (item) => {
            const row = document.createElement('button');
            row.textContent = item.id;
            return row;
          },
        };
        handle = ui.mountList(host, listDefinition);
        firstElement = handle.element;
        const replacement = document.createElement('div');
        container.append(replacement);
        const second = ui.mountList(replacement, listDefinition);
        assert.equal(second.element, firstElement);
      },
    });
    session.ui.openPopup(token, {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].limit, 20);
    assert.equal(handle.element.getAttribute('role'), 'listbox');
    assert.equal(handle.element.getAttribute('aria-label'), '记录列表');
    const visibleOptions = descendants(handle.element).filter(node => node.getAttribute('role') === 'option');
    assert.ok(visibleOptions.length > 0 && visibleOptions.length <= 14);
    const firstRow = descendants(handle.element).find(node => node.dataset.listIndex === '0');
    assert.equal(firstRow.style.top, '2px');
    assert.equal(firstRow.style.height, '16px');
    handle.element.scrollTop = 200;
    handle.element.dispatchEvent({ type: 'scroll' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 1, 'the next page waits until the loaded rows reach the viewport bottom');
    handle.element.remove();
    handle.element.scrollTop = 0;
    const reattachedHost = document.createElement('div');
    popupContainer.append(reattachedHost);
    popupUi.mountList(reattachedHost, listDefinition);
    assert.equal(handle.element.scrollTop, 200, 'a stable list restores its last connected scroll position after reattachment');
    popupUi.mountList(reattachedHost, { ...listDefinition, selectedKey: 'first-0' });
    assert.equal(handle.selectedKey(), 'first-0');
    popupUi.mountList(reattachedHost, { ...listDefinition, selectedKey: undefined });
    assert.equal(handle.selectedKey(), undefined, 'an updated definition can explicitly clear selection');
    handle.element.scrollTop = 400;
    handle.element.dispatchEvent({ type: 'scroll' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests[1].cursor, 'page-2');
    handle.element.scrollTop = 600;
    handle.element.dispatchEvent({ type: 'scroll' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    handle.element.scrollTop = 0;
    handle.element.dispatchEvent({ type: 'scroll' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests[2].cursor, undefined, 'an evicted first page reloads from its retained cursor checkpoint');
    const overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    overlay.children[0].dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    runtime.dispose();
  } finally { restore(); }
});

test('Core-owned popup wizard renders fields, gates navigation, updates checks, and protects dirty close', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.popup-wizard'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.popup-wizard', name: 'resource', version: 0 });
    let listener = () => {};
    const state = {
      activeStepId: 'purpose',
      completedStepIds: [],
      values: { type: 'generation', mode: 'official', name: '' },
      fieldErrors: {},
      hiddenFieldIds: ['advanced'],
      dirty: true,
      checks: { network: { state: 'idle', description: 'Waiting' } },
    };
    const adapter = {
      snapshot: () => ({ ...state }),
      change: (fieldId, value) => { state.values = { ...state.values, [fieldId]: value }; listener(); },
      navigate: (stepId) => { state.activeStepId = stepId; listener(); },
      back: () => { state.activeStepId = 'purpose'; listener(); },
      submit: () => {
        state.completedStepIds = ['purpose'];
        state.activeStepId = 'connection';
        state.checks = { network: { state: 'running', description: 'Connecting' } };
        listener();
      },
      subscribe: (next) => { listener = next; return () => { listener = () => {}; }; },
    };
    session.registerPopup({
      token,
      title: 'Add resource',
      render: (_container, _input, ui) => ui.mountWizard({
        id: 'resource',
        submitLabel: 'Test and save',
        busyLabel: 'Testing',
        confirmDiscard: { title: 'Discard?', message: 'Changes will be lost.' },
        steps: [
          { id: 'purpose', label: 'Purpose', description: 'Choose purpose', fields: [{ kind: 'radio', id: 'type', label: 'Type', options: [{ value: 'generation', label: 'Generation' }] }] },
          {
            id: 'connection',
            label: 'Connection',
            description: 'Connect provider',
            fields: [
              { kind: 'segmented', id: 'mode', label: 'Mode', options: [{ value: 'official', label: 'Official' }, { value: 'relay', label: 'Relay' }] },
              { kind: 'text', id: 'name', label: 'Name', validation: { required: true } },
              { kind: 'text', id: 'secret', label: 'API Key', secret: true },
              { kind: 'text', id: 'advanced', label: 'Advanced' },
            ],
          },
        ],
        aside: { title: 'Checks', checks: [{ id: 'network', label: 'Network' }] },
      }, adapter),
    });
    session.ui.openPopup(token, {});
    let overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    let wizard = descendants(overlay).find((node) => node.className === 'stx-popup-wizard');
    assert.ok(wizard);
    let steps = descendants(wizard).filter((node) => node.className === 'stx-popup-wizard-step');
    assert.equal(steps[0].getAttribute('aria-current'), 'step');
    assert.equal(steps[1].disabled, true);
    descendants(wizard).find((node) => node.dataset.popupWizardSubmit === 'true').dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    wizard = descendants(overlay).find((node) => node.className === 'stx-popup-wizard');
    steps = descendants(wizard).filter((node) => node.className === 'stx-popup-wizard-step');
    assert.equal(steps[0].disabled, false);
    assert.equal(steps[1].getAttribute('aria-current'), 'step');
    assert.equal(descendants(wizard).some((node) => node.dataset.fieldId === 'advanced'), false);
    let modeButtons = descendants(wizard).find((node) => node.dataset.ssHelperControl === 'segmented').children;
    assert.equal(modeButtons[0].getAttribute('aria-pressed'), 'true');
    modeButtons[1].dispatchEvent({ type: 'click' });
    wizard = descendants(document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined)).find((node) => node.className === 'stx-popup-wizard');
    modeButtons = descendants(wizard).find((node) => node.dataset.ssHelperControl === 'segmented').children;
    assert.equal(state.values.mode, 'relay');
    assert.equal(modeButtons[1].getAttribute('aria-pressed'), 'true');
    let secretInput = descendants(wizard).find((node) => node.dataset.popupWizardField === 'secret');
    let secretToggle = descendants(wizard).find((node) => node.className === 'stx-popup-wizard-secret-toggle');
    assert.equal(secretInput.type, 'password');
    assert.equal(secretToggle.textContent, '');
    assert.equal(secretToggle.getAttribute('aria-pressed'), 'false');
    assert.equal(secretToggle.children[0].getAttribute('name'), 'eye');
    assert.equal(secretToggle.className.includes('stx-ui-btn'), false);
    secretToggle.dispatchEvent({ type: 'click' });
    wizard = descendants(document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined)).find((node) => node.className === 'stx-popup-wizard');
    secretInput = descendants(wizard).find((node) => node.dataset.popupWizardField === 'secret');
    secretToggle = descendants(wizard).find((node) => node.className === 'stx-popup-wizard-secret-toggle');
    assert.equal(secretInput.type, 'text');
    assert.equal(secretToggle.getAttribute('aria-pressed'), 'true');
    assert.equal(secretToggle.children[0].getAttribute('name'), 'eye-slash');
    const runningCheck = descendants(wizard).find((node) => node.dataset.state === 'running');
    assert.equal(descendants(runningCheck).some((node) => node.textContent === 'Network'), true);
    const dialog = overlay.children[0];
    dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    assert.equal(document.body.children.some((node) => node.dataset.ssHelperPopup !== undefined), true);
    let confirmation = document.body.children.find((node) => node.className === 'stx-popup-confirm-overlay');
    assert.ok(confirmation);
    confirmation.children[0].children[2].children[0].dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    confirmation = document.body.children.find((node) => node.className === 'stx-popup-confirm-overlay');
    assert.ok(confirmation);
    confirmation.children[0].children[2].children[1].dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.body.children.some((node) => node.dataset.ssHelperPopup !== undefined), false);
    const styles = document.getElementById('ss-helper-core-ui-styles').textContent;
    assert.match(styles, /\.stx-popup-wizard-content/);
    assert.match(styles, /\.stx-popup-wizard-step\[data-state="current"\]/);
  } finally { restore(); }
});

test('ToastHost gates notifications, stacks and deduplicates safe DTOs, and cleans session state', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const denied = runtime.connect(pluginDescriptor('example.toast-denied'));
    assert.throws(() => denied.ui.showToast({ level: 'info', message: 'Denied' }), errorCode('FORBIDDEN'));

    const session = runtime.connect(pluginDescriptor('example.toast', { capabilities: ['core.ui.notification.v0'] }));
    assert.throws(() => session.ui.showToast({ level: 'info', message: '', durationMs: 10 }), errorCode('INVALID_PAYLOAD'));
    for (let index = 0; index < 6; index += 1) session.ui.showToast({ level: index === 0 ? 'error' : 'warning', title: `Notice ${index}`, message: `Message ${index}`, code: `NOTICE_${index}`, durationMs: 0 });
    const root = document.getElementById('ss-helper-toast-root');
    assert.ok(root);
    assert.equal(root.children.length, 5);
    assert.equal(root.children[0].getAttribute('role'), 'alert');
    session.ui.showToast({ level: 'success', title: 'Updated', message: 'Updated message', code: 'NOTICE_5', durationMs: 0 });
    assert.equal(root.children.length, 5);
    assert.equal(descendants(root.children[0]).some((node) => node.textContent === 'Updated message'), true);
    assert.equal(runtime.port.diagnostics().events.at(-1).code, 'NOTICE_5');
    session.dispose();
    assert.equal(document.getElementById('ss-helper-toast-root'), null);
    runtime.dispose();
  } finally { restore(); }
});

test('ToastHost pauses automatic dismissal while expanded and resumes after click collapse', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.toast-timer', { capabilities: ['core.ui.notification.v0'] }));
    session.ui.showToast({ level: 'info', message: 'Timed message', durationMs: 1_500 });
    const root = document.getElementById('ss-helper-toast-root');
    root.dispatchEvent({ type: 'click', target: root });
    assert.equal(root.dataset.expanded, 'true');
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    assert.equal(root.children.length, 1);
    root.dispatchEvent({ type: 'click', target: root });
    assert.equal(root.dataset.expanded, 'false');
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    assert.equal(document.getElementById('ss-helper-toast-root'), null);
    runtime.dispose();
  } finally { restore(); }
});

test('dynamic field state disables the current control with an inline reason and updates by subscription', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const container = document.createElement('div'); document.body.append(container);
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { settingsContainer: container, document });
    const session = runtime.connect(pluginDescriptor('example.field-state'));
    let fieldStateListener;
    session.registerSettings({ id: 'example.field-state', title: 'Field state', fields: [{ kind: 'toggle', id: 'enabled', label: 'Enabled' }] }, {
      load: () => ({ enabled: true }), save: () => {}, reset: () => ({ enabled: true }),
      loadFieldState: () => ({ enabled: { disabled: true, disabledReason: 'Enter a chat first' } }),
      subscribeFieldState: (listener) => { fieldStateListener = listener; return () => {}; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    descendants(container).find((node) => node.id === 'ss-helper-open-settings-center').dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.pluginId === 'example.field-state').dispatchEvent({ type: 'click' });
    let row = descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.fieldId === 'enabled');
    assert.equal(descendants(row).find((node) => node.tagName === 'INPUT').disabled, true);
    assert.equal(descendants(row).some((node) => node.textContent === 'Enter a chat first'), true);
    fieldStateListener({ enabled: { disabled: false } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    row = descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.fieldId === 'enabled');
    assert.equal(descendants(row).find((node) => node.tagName === 'INPUT').disabled, false);
    runtime.dispose();
  } finally { restore(); }
});

test('hidden fields survive saves and searches while collapsed groups remember expansion', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const container = document.createElement('div'); document.body.append(container);
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { settingsContainer: container, document });
    const session = runtime.connect(pluginDescriptor('example.progressive'));
    let emitState;
    const saved = [];
    session.registerSettings({ id: 'example.progressive', title: 'Progressive', fields: [
      { kind: 'toggle', id: 'enabled', label: 'Enabled' },
      { kind: 'section', id: 'advanced', label: 'Advanced', collapsible: true, children: [{ kind: 'number', id: 'limit', label: 'Limit' }] },
    ] }, {
      load: () => ({ enabled: true, limit: 42 }), save: (values) => { saved.push(values); }, reset: () => ({ enabled: true, limit: 42 }),
      loadFieldState: () => ({ limit: { disabled: false, hidden: true } }),
      subscribeFieldState: (listener) => { emitState = listener; return () => {}; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    descendants(container).find((node) => node.id === 'ss-helper-open-settings-center').dispatchEvent({ type: 'click' });
    descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.pluginId === 'example.progressive').dispatchEvent({ type: 'click' });
    const center = document.getElementById(SETTINGS_CENTER_ID);
    const row = () => descendants(center).find((node) => node.dataset.fieldId === 'limit');
    const group = () => descendants(center).find((node) => node.dataset.groupKey);
    assert.equal(row().hidden, true);
    assert.equal(group().open, false);
    group().open = true; group().dispatchEvent({ type: 'toggle' });
    await runtime.settings.save('example.progressive', { enabled: false, limit: 42 });
    assert.equal(saved.at(-1).limit, 42);
    assert.equal(group().open, true);
    const search = descendants(center).find((node) => node.type === 'search');
    search.value = 'Limit'; search.dispatchEvent({ type: 'input' });
    assert.equal(row().hidden, true, 'search must not reveal a mode-inactive field');
    emitState({ limit: { disabled: false, hidden: false } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(row().hidden, false);
    assert.equal(group().open, true);
    search.value = ''; search.dispatchEvent({ type: 'input' });
    assert.equal(group().open, true);
    runtime.dispose();
  } finally { restore(); }
});

test('an external settings snapshot during a delayed save remains authoritative', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.settings-race'));
    let releaseSave;
    let valuesListener;
    let failSave = false;
    session.registerSettings({ id: 'example.settings-race', title: 'Race', fields: [{ kind: 'text', id: 'chat', label: 'Chat' }] }, {
      load: () => ({ chat: 'chat-a' }),
      save: () => { if (failSave) throw new Error('save failed'); return new Promise((resolve) => { releaseSave = resolve; }); },
      reset: () => ({ chat: 'chat-a' }),
      subscribe: (listener) => { valuesListener = listener; return () => {}; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saving = runtime.settings.save('example.settings-race', { chat: 'chat-a-saved' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    valuesListener({ chat: 'chat-b' });
    releaseSave();
    await saving;
    assert.deepEqual(runtime.settings.snapshot().find((item) => item.id === 'example.settings-race').values, { chat: 'chat-b' });
    failSave = true;
    await assert.rejects(runtime.settings.save('example.settings-race', { chat: 'chat-b-unsaved' }), errorCode('INTERNAL'));
    assert.deepEqual(runtime.settings.snapshot().find((item) => item.id === 'example.settings-race').values, { chat: 'chat-b' });
    runtime.dispose();
  } finally { restore(); }
});
