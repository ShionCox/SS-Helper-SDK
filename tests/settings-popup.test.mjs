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
    const session = runtime.connect({ ...pluginDescriptor('example.settings'), settingsDisplayName: '记忆系统', pluginVersion: 'V0.0.2' });
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
    assert.match(coreStyles.textContent, /\.stx-ui-select-check\[hidden\] \{ display: none; \}/);
    assert.match(coreStyles.textContent, /background: var\(--ss-theme-surface-3\)/);
    const opener = descendants(container.children[0]).find((node) => node.id === 'ss-helper-open-settings-center');
    opener.focus();
    opener.dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(fetched, ['/api/plugins/ss-helper-sdk/v2/workspaces/health']);
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
    assert.equal(selectWrap.children[1].hidden, true);
    await runtime.settings.save('example.settings', { enabled: false, 'api-key': 'next', count: 3, mode: 'a' });
    assert.equal(saved.length, 1);
    await assert.rejects(runtime.settings.save('example.settings', { enabled: false, 'api-key': '', count: 9, mode: 'x' }), errorCode('PAYLOAD_INVALID'));
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
  await assert.rejects(runtime.settings.reset('example.reset-queue'), errorCode('SETTINGS_ADAPTER_ERROR'));
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
    const popupToken = { kind: 'popup', provider: 'example.legacy-theme', name: 'tools', version: 1 };
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
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }), errorCode('PAYLOAD_INVALID'));
  assert.equal(runtime.settings.snapshot().some((entry) => entry.id === 'example.invalid-kind'), false);
  const invalidPlacement = runtime.connect(pluginDescriptor('example.invalid-action-placement'));
  assert.throws(() => invalidPlacement.registerSettings({
    id: 'example.invalid-action-placement', title: 'Invalid action placement', fields: [{ kind: 'action', id: 'run', label: 'Run', actionId: 'run', placement: 'sidebar' }],
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }), errorCode('PAYLOAD_INVALID'));
  const invalidButtonLabel = runtime.connect(pluginDescriptor('example.invalid-action-label'));
  assert.throws(() => invalidButtonLabel.registerSettings({
    id: 'example.invalid-action-label', title: 'Invalid action label', fields: [{ kind: 'action', id: 'run', label: 'Run', actionId: 'run', buttonLabel: '   ' }],
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }), errorCode('PAYLOAD_INVALID'));
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
  await assert.rejects(runtime.settings.save('example.required', { enabled: false }), errorCode('PAYLOAD_INVALID'));
  assert.equal(saves, 0);
  emit({ enabled: true });
  assert.equal(runtime.settings.snapshot()[0].health, 'degraded');
  await assert.rejects(runtime.settings.reset('example.required'), errorCode('SETTINGS_ADAPTER_ERROR'));
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
  assert.equal(snapshots.find((entry) => entry.id === 'example.bad').lastError, 'SETTINGS_ADAPTER_ERROR');
  assert.equal(snapshots.find((entry) => entry.id === 'example.good').health, 'healthy');
  bad.dispose();
  const reloaded = runtime.connect(pluginDescriptor('example.bad'));
  reloaded.registerSettings(schema('example.bad'), { load: async () => ({ enabled: false, 'api-key': 'restored' }), save: async () => {}, reset: async () => ({}) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.settings.snapshot().find((entry) => entry.id === 'example.bad').health, 'healthy');
});

test('registered popup owns dialog lifecycle, Escape cleanup, focus return, and unregister fail-closed', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.popup'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.popup', name: 'workbench', version: 1 });
    let disposed = 0;
    const unregister = session.registerPopup({ token, title: 'Workbench', render: (container) => { const input = document.createElement('input'); container.append(input); return () => { disposed += 1; }; } });
    session.ui.openPopup(token, { tab: 'main' });
    const overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    const dialog = overlay.children[0];
    assert.equal(dialog.getAttribute('role'), 'dialog');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    assert.equal(disposed, 1);
    assert.equal(document.activeElement, opener);
    unregister();
    assert.throws(() => session.ui.openPopup(token, {}), errorCode('PAYLOAD_INVALID'));
  } finally { restore(); }
});

test('workspace popup exposes a stable presentation marker and shared chrome', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.workspace-popup'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.workspace-popup', name: 'workbench', version: 1 });
    session.registerPopup({ token, title: 'Workspace', presentation: 'workspace', render: (container) => { container.append(document.createElement('main')); } });
    session.ui.openPopup(token, {});
    const overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    const dialog = overlay.children[0];
    assert.equal(dialog.dataset.presentation, 'workspace');
    assert.equal(dialog.children[0].dataset.popupHeader, 'true');
    assert.equal(dialog.children[1].dataset.popupContent, 'true');
    dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    assert.equal(document.activeElement, opener);
    assert.throws(() => session.registerPopup({ token: Object.freeze({ kind: 'popup', provider: 'example.workspace-popup', name: 'invalid', version: 1 }), title: 'Invalid', presentation: 'unsupported', render: () => {} }), errorCode('PAYLOAD_INVALID'));
  } finally { restore(); }
});

test('popup restores focus to a rerendered opener with the same stable id', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const opener = document.createElement('button'); opener.id = 'stable-popup-opener'; document.body.append(opener); opener.focus();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.popup-focus'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.popup-focus', name: 'focus', version: 1 });
    session.registerPopup({ token, title: 'Focus', render: () => {} });
    session.ui.openPopup(token, {});
    const replacement = document.createElement('button'); replacement.id = opener.id;
    opener.remove(); opener.isConnected = false; document.body.append(replacement);
    const overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    overlay.children[0].dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    assert.equal(document.activeElement, replacement);
  } finally { restore(); }
});

test('popup public controls share Core styles and enhance native selects idempotently', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.popup-controls'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.popup-controls', name: 'controls', version: 1 });
    let nativeSelect;
    let changes = 0;
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
        ui?.refreshControls(container); ui?.refreshControls(container);
      },
    });
    session.ui.openPopup(token, {});
    const overlay = document.body.children.find((node) => node.dataset.ssHelperPopup !== undefined);
    const dialog = overlay.children[0];
    const controls = descendants(dialog);
    const shells = controls.filter((node) => node.className === 'stx-ui-select-wrap');
    assert.equal(shells.length, 1);
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
    assert.match(closeButton.children[0].className, /fa-xmark/u);
    dialog.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    assert.equal(nativeSelect.hidden, false);
    const styles = document.body.children.find((node) => node.dataset.ssHelperStyle === 'core-ui').textContent;
    assert.match(styles, /\[data-ss-helper-popup\].*--ss-theme-surface/su);
    assert.match(styles, /padding-inline-start:\s*var\(--ss-control-input-padding-inline-start,\s*11px\)/u);
    assert.match(styles, /padding-inline-end:\s*var\(--ss-control-input-padding-inline-end,\s*11px\)/u);
    for (const kind of ['button', 'input', 'textarea', 'checkbox', 'status', 'progress', 'file-trigger']) {
      assert.ok(styles.includes(`data-ss-helper-control="${kind}"`));
    }
    for (const tone of ['neutral', 'primary', 'danger', 'success', 'warning', 'error']) {
      assert.ok(styles.includes(`data-ss-helper-tone="${tone}"`));
    }
  } finally { restore(); }
});

test('throwing popup render rolls back overlay, listeners, session cleanup, and focus', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.throwing-popup'));
    const token = Object.freeze({ kind: 'popup', provider: 'example.throwing-popup', name: 'broken', version: 1 });
    session.registerPopup({ token, title: 'Broken', render: () => { throw new Error('private renderer failure'); } });
    assert.throws(() => session.ui.openPopup(token, {}), errorCode('PAYLOAD_INVALID'));
    assert.equal(document.body.children.filter((node) => node.dataset.ssHelperPopup !== undefined).length, 0);
    assert.equal(document.activeElement, opener);
    assert.doesNotThrow(() => session.dispose());
    assert.equal(document.body.children.filter((node) => node.dataset.ssHelperPopup !== undefined).length, 0);
  } finally { restore(); }
});

test('ToastHost gates notifications, stacks and deduplicates safe DTOs, and cleans session state', () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const denied = runtime.connect(pluginDescriptor('example.toast-denied'));
    assert.throws(() => denied.ui.showToast({ level: 'info', message: 'Denied' }), errorCode('CAPABILITY_NOT_GRANTED'));

    const session = runtime.connect(pluginDescriptor('example.toast', { capabilities: ['core.ui.notification.v1'] }));
    assert.throws(() => session.ui.showToast({ level: 'info', message: '', durationMs: 10 }), errorCode('PAYLOAD_INVALID'));
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
    const session = runtime.connect(pluginDescriptor('example.toast-timer', { capabilities: ['core.ui.notification.v1'] }));
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

test('an external settings snapshot during a delayed save remains authoritative', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { document });
    const session = runtime.connect(pluginDescriptor('example.settings-race'));
    let releaseSave;
    let valuesListener;
    session.registerSettings({ id: 'example.settings-race', title: 'Race', fields: [{ kind: 'text', id: 'chat', label: 'Chat' }] }, {
      load: () => ({ chat: 'chat-a' }),
      save: () => new Promise((resolve) => { releaseSave = resolve; }),
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
    runtime.dispose();
  } finally { restore(); }
});
