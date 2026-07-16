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
  try {
    const document = new FakeDocument();
    const container = document.createElement('div'); document.body.append(container);
    const realm = new TestRealm();
    const runtime = installCoreRuntime(coreIdentity(), realm, { settingsContainer: container, document });
    assert.equal(runtime.settings.mount(container), runtime.settings.mount(container));
    assert.equal(document.getElementById(SETTINGS_ROOT_ID), container.children[0]);
    const saved = [];
    const session = runtime.connect(pluginDescriptor('example.settings'));
    session.registerSettings(schema('example.settings'), {
      load: async () => ({ enabled: true, 'api-key': 'secret', count: 2, mode: 'a' }),
      save: async (values) => { saved.push(values); },
      reset: async () => ({ enabled: false, 'api-key': '', count: 1, mode: 'a' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(runtime.settings.snapshot()[0].values['api-key'], '[REDACTED]');
    assert.equal(container.children[0].children.filter((node) => node.dataset.pluginId === 'ss-helper.core').length, 1);
    assert.equal(container.children[0].children.filter((node) => node.dataset.ssHelperStyle === 'settings').length, 1);
    const opener = descendants(container.children[0]).find((node) => node.id === 'ss-helper-open-settings-center');
    opener.focus();
    opener.dispatchEvent({ type: 'click' });
    assert.ok(document.getElementById(SETTINGS_CENTER_OVERLAY_ID));
    assert.ok(document.getElementById(SETTINGS_CENTER_ID));
    assert.equal(document.body.style.overflow, 'hidden');
    const pluginNav = descendants(document.getElementById(SETTINGS_CENTER_ID)).find((node) => node.dataset.pluginId === 'example.settings');
    assert.ok(pluginNav);
    pluginNav.dispatchEvent({ type: 'click' });
    assert.equal(descendants(document.getElementById(SETTINGS_CENTER_ID)).some((node) => node.dataset.saveStatus === 'example.settings'), true);
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
  } finally { restore(); }
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

test('settings center renders screenshot-style tabs, search, controls, auto-save state, and inline errors', async () => {
  const restore = installFakeDomGlobals();
  try {
    const document = new FakeDocument();
    const container = document.createElement('div'); document.body.append(container);
    const runtime = installCoreRuntime(coreIdentity(), new TestRealm(), { settingsContainer: container, document });
    const session = runtime.connect(pluginDescriptor('example.legacy-theme'));
    const saved = [];
    session.registerSettings({
      id: 'example.legacy-theme', title: 'Legacy theme', fields: [
        { kind: 'section', id: 'basic', label: '基础', children: [
          { kind: 'toggle', id: 'enabled', label: '启用', description: '是否启用。' },
        ] },
        { kind: 'section', id: 'advanced', label: '高级', children: [
          { kind: 'range', id: 'volume', label: '预算', min: 0, max: 10, step: 1 },
          { kind: 'checkbox', id: 'strict', label: '严格模式' },
          { kind: 'radio', id: 'strategy', label: '响应策略', options: [{ value: 'auto', label: '自动' }, { value: 'exact', label: '精确' }] },
          { kind: 'multiSelect', id: 'sources', label: '记忆来源', options: [{ value: 'chat', label: '聊天记录' }, { value: 'world', label: '世界书' }] },
          { kind: 'number', id: 'count', label: '召回条数', step: 1, unit: '条', validation: { min: 1, max: 50 } },
          { kind: 'action', id: 'open', label: '打开工具', actionId: 'open' },
        ] },
      ],
    }, {
      load: async () => ({ enabled: true, volume: 3, strict: false, strategy: 'auto', sources: ['chat'], count: 12 }),
      save: async (values) => { saved.push(values); if (values.volume === 10) throw new Error('adapter failed'); },
      reset: async () => ({ enabled: false, volume: 0, strict: false, strategy: 'auto', sources: ['chat'], count: 1 }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = document.getElementById(SETTINGS_ROOT_ID);
    descendants(root).find((node) => node.id === 'ss-helper-open-settings-center').dispatchEvent({ type: 'click' });
    let center = document.getElementById(SETTINGS_CENTER_ID);
    descendants(center).find((node) => node.dataset.pluginId === 'example.legacy-theme').dispatchEvent({ type: 'click' });
    center = document.getElementById(SETTINGS_CENTER_ID);

    const tabButtons = descendants(center).filter((node) => node.dataset.tabId);
    const tabPanels = descendants(center).filter((node) => node.dataset.tabPanel);
    assert.equal(tabButtons.length, 2);
    assert.equal(tabPanels.filter((node) => node.hidden === false).length, 1);
    tabButtons[1].dispatchEvent({ type: 'click' });
    assert.equal(tabButtons[1].getAttribute('aria-selected'), 'true');
    assert.equal(tabPanels[1].hidden, false);

    const search = descendants(center).find((node) => node.tagName === 'INPUT' && node.type === 'search');
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
    const volume = descendants(center).find((node) => node.dataset.fieldId === 'volume').children
      .flatMap((node) => [node, ...descendants(node)]).find((node) => node.tagName === 'INPUT');
    const output = descendants(center).find((node) => node.tagName === 'OUTPUT');
    volume.value = '7';
    volume.dispatchEvent({ type: 'input' });
    assert.equal(output.textContent, '7');
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
      { kind: 'action', id: 'action', label: 'Action', actionId: 'run' },
      { kind: 'status', id: 'status', label: 'Status', value: 'Ready' },
    ],
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }));
  const invalid = runtime.connect(pluginDescriptor('example.invalid-kind'));
  assert.throws(() => invalid.registerSettings({
    id: 'example.invalid-kind', title: 'Invalid', fields: [{ kind: 'html', id: 'unsafe', label: 'Unsafe', html: '<b>x</b>' }],
  }, { load: () => ({}), save: () => {}, reset: () => ({}) }), errorCode('PAYLOAD_INVALID'));
  assert.equal(runtime.settings.snapshot().some((entry) => entry.id === 'example.invalid-kind'), false);
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
