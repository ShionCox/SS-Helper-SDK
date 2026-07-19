import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSillyTavernHostBridge, installCoreRuntime } from '../apps/core-extension/dist/index.js';
import { coreIdentity, errorCode, pluginDescriptor, TestRealm } from './helpers/runtime-fixture.mjs';

const ALL_CAPABILITIES = [
  'tavern.context.read', 'tavern.identity.read', 'tavern.character.read', 'tavern.persona.read', 'tavern.chat.read', 'tavern.chat.list', 'tavern.chat.write', 'tavern.chat.events',
  'tavern.worldbooks.read', 'tavern.worldbooks.write', 'tavern.generation.read', 'tavern.generation.execute',
  'tavern.prompt.contribute', 'tavern.plugin.request', 'tavern.plugin.binary-request.v1', 'tavern.metadata.write', 'tavern.settings.write', 'tavern.macros.execute', 'tavern.systemMessage.write',
];

const binaryBody = (bytes) => ({
  encoding: 'base64', contentType: 'application/vnd.sqlite3', data: bytes.toString('base64'), byteLength: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
const binaryResponse = (bytes, overrides = {}) => ({ version: 1, mode: 'binary', status: 200, ok: true, ...binaryBody(bytes), ...overrides });
const jsonResponse = (data = null, overrides = {}) => ({ version: 1, mode: 'json', status: 200, ok: true, body: { ok: true, data }, ...overrides });

test('production SillyTavern bridge feature-detects real seams and keeps request headers private', async () => {
  const prompts = []; const fetches = [];
  const context = {
    chatId: 'chat.jsonl', name1: 'User', name2: 'Character', characterId: 0,
    characters: [{ name: 'Character', avatar: 'character.png', description: 'public' }],
    chat: [{ id: 'm1', is_user: true, mes: 'hello' }],
    eventSource: { on() {}, off() {} }, event_types: {},
    setExtensionPrompt: (...args) => prompts.push(args), getRequestHeaders: () => ({ 'X-CSRF-Token': 'secret' }),
    generate: async () => 'generated', addOneMessage: async () => {}, saveChat: async () => {}, deleteMessage: async () => {},
  };
  const target = {
    SillyTavern: { getContext: () => context }, location: { origin: 'http://localhost' },
    fetch: async (url, init) => { fetches.push([String(url), init]); return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) }; },
  };
  const bridge = createSillyTavernHostBridge(target);
  assert.ok(bridge.capabilities.length > 0);
  assert.ok(bridge.capabilities.includes('tavern.plugin.request'));
  assert.equal((await bridge.hostAdapter.chat.readCurrent()).key, 'chat.jsonl');
  await bridge.hostAdapter.prompt.set({ id: 'memory', content: 'context' });
  await bridge.hostAdapter.prompt.remove('memory');
  const response = await bridge.hostAdapter.request.send({ path: '/api/plugins/memory', method: 'POST', body: { command: 'health' } });
  assert.deepEqual(response, { status: 200, ok: true, body: { ok: true } });
  assert.equal(fetches[0][1].headers['X-CSRF-Token'], 'secret');
  assert.equal(JSON.stringify(response).includes('secret'), false);
  await assert.rejects(bridge.hostAdapter.request.send({ path: '//evil.example/api' }));
  assert.deepEqual(prompts.at(-1), ['memory', '', 0, 0, false]);
  const unsafeEvents = createSillyTavernHostBridge({ SillyTavern: { getContext: () => ({ eventSource: { on() {} }, event_types: {} }) } });
  assert.equal(unsafeEvents.capabilities.includes('tavern.chat.events'), false);
});

test('SillyTavern chat snapshots keep distinct file keys when display names are identical', async () => {
  const context = {
    chatId: 'Assistant - 2026-07-18@03h29m55s201ms', name1: 'User', name2: 'Assistant', characterId: 0,
    characters: [{ name: 'Assistant', avatar: 'assistant.png' }], chat: [],
  };
  const bridge = createSillyTavernHostBridge({ SillyTavern: { getContext: () => context } });
  const first = await bridge.hostAdapter.chat.readCurrent();
  context.chatId = 'Assistant - 2026-07-18@03h30m01s622ms';
  const second = await bridge.hostAdapter.chat.readCurrent();

  assert.equal(first.name, second.name);
  assert.notEqual(first.key, second.key);
  assert.equal(second.key, context.chatId);
});

test('binary plugin request v1 preserves SQLite bytes and private authentication metadata', async () => {
  const sqlite = Buffer.from('SQLite format 3\0\x00\xffbinary', 'latin1');
  const fetches = [];
  const context = { getRequestHeaders: () => ({ 'X-CSRF-Token': 'private-csrf', Cookie: 'private-cookie' }) };
  const target = {
    SillyTavern: { getContext: () => context }, location: { origin: 'http://localhost' },
    fetch: async (url, init) => {
      fetches.push([String(url), init]);
      if (String(url).endsWith('/import')) return {
        status: 200, ok: true,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
        json: async () => ({ ok: true, data: { imported: true } }),
      };
      return {
        status: 200, ok: true,
        headers: { get: (name) => ({
          'content-type': 'application/vnd.sqlite3', 'content-length': String(sqlite.length),
          'content-disposition': 'attachment; filename="memory.sqlite3"',
        })[name.toLowerCase()] ?? null },
        arrayBuffer: async () => sqlite.buffer.slice(sqlite.byteOffset, sqlite.byteOffset + sqlite.byteLength),
      };
    },
  };
  const bridge = createSillyTavernHostBridge(target);
  assert.ok(bridge.capabilities.includes('tavern.plugin.binary-request.v1'));
  const exported = await bridge.hostAdapter.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'POST', responseMode: 'binary' }, { signal: new AbortController().signal });
  assert.deepEqual(exported, binaryResponse(sqlite, { filename: 'memory.sqlite3' }));
  assert.equal(new Headers(fetches[0][1].headers).get('X-CSRF-Token'), 'private-csrf');
  assert.equal(new Headers(fetches[0][1].headers).get('Cookie'), 'private-cookie');
  assert.equal(new Headers(fetches[0][1].headers).get('Accept'), 'application/vnd.sqlite3');
  assert.equal(JSON.stringify(exported).includes('private'), false);

  const imported = await bridge.hostAdapter.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/import', method: 'POST', responseMode: 'json', body: binaryBody(sqlite) }, { signal: new AbortController().signal });
  assert.deepEqual(Buffer.from(fetches[1][1].body), sqlite);
  assert.equal(new Headers(fetches[1][1].headers).get('Content-Type'), 'application/vnd.sqlite3');
  assert.equal(new Headers(fetches[1][1].headers).get('Accept'), 'application/json');
  assert.equal(new Headers(fetches[1][1].headers).get('X-Content-SHA256'), binaryBody(sqlite).sha256);
  assert.deepEqual(imported, jsonResponse({ imported: true }));
  assert.equal(Object.hasOwn(imported, 'headers'), false);
  assert.equal(JSON.stringify(imported).includes('private'), false);

  const unsupported = createSillyTavernHostBridge({
    SillyTavern: { getContext: () => context }, location: target.location,
    fetch: async () => ({ status: 200, ok: true, headers: { get: (name) => name === 'content-type' ? 'application/octet-stream' : null }, arrayBuffer: async () => new ArrayBuffer(0) }),
  });
  await assert.rejects(unsupported.hostAdapter.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'GET', responseMode: 'binary' }, { signal: new AbortController().signal }));
  const rejectingBridge = (responseHeaders) => createSillyTavernHostBridge({
    SillyTavern: { getContext: () => context }, location: target.location,
    fetch: async () => ({
      status: 200, ok: true, headers: { get: (name) => responseHeaders[name.toLowerCase()] ?? null },
      arrayBuffer: async () => sqlite.buffer.slice(sqlite.byteOffset, sqlite.byteOffset + sqlite.byteLength),
    }),
  });
  for (const responseHeaders of [
    { 'content-type': 'application/vnd.sqlite3', 'content-length': String(sqlite.length + 1) },
    { 'content-type': 'application/vnd.sqlite3', 'content-length': String(64 * 1024 * 1024 + 1) },
    { 'content-type': 'application/vnd.sqlite3', 'content-length': String(sqlite.length), 'content-disposition': 'attachment; filename="../secret.sqlite3"' },
  ]) {
    await assert.rejects(rejectingBridge(responseHeaders).hostAdapter.binaryRequest.send(
      { version: 1, path: '/api/plugins/memory/backup/export', method: 'GET', responseMode: 'binary' }, { signal: new AbortController().signal },
    ));
  }
  for (const invalidJson of [
    { contentType: 'text/plain', body: { ok: true, data: null } },
    { contentType: 'application/vnd.sqlite3', body: { ok: true, data: null } },
    { contentType: 'application/json', body: { ok: false, data: null } },
    { contentType: 'application/json', body: { ok: true, data: null, headers: {} } },
  ]) {
    const invalid = createSillyTavernHostBridge({
      SillyTavern: { getContext: () => context }, location: target.location,
      fetch: async () => ({ status: 200, ok: true, headers: { get: (name) => name === 'content-type' ? invalidJson.contentType : null }, json: async () => invalidJson.body }),
    });
    await assert.rejects(invalid.hostAdapter.binaryRequest.send(
      { version: 1, path: '/api/plugins/memory/backup/import', method: 'POST', responseMode: 'json', body: binaryBody(sqlite) },
      { signal: new AbortController().signal },
    ));
  }
});

test('binary request runtime enforces DTO hashes, capability denial, abort, timeout, and cleanup', async () => {
  const sqlite = Buffer.from('SQLite format 3\0runtime', 'utf8');
  const valid = binaryResponse(sqlite);
  let calls = 0;
  const runtime = installCoreRuntime(coreIdentity({ capabilities: ['tavern.plugin.binary-request.v1'] }), new TestRealm(), { hostAdapter: {
    binaryRequest: { send: async () => { calls += 1; return valid; } },
  } });
  const session = runtime.connect(pluginDescriptor('example.binary', { capabilities: ['tavern.plugin.binary-request.v1'] }));
  assert.deepEqual(await session.host.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'GET', responseMode: 'binary' }), valid);
  assert.throws(() => session.host.binaryRequest.send({ version: 1, path: '/api/worldinfo/list', method: 'GET', responseMode: 'binary' }), errorCode('PAYLOAD_INVALID'));
  await assert.rejects(session.host.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/import', method: 'POST', responseMode: 'json', body: { ...binaryBody(sqlite), sha256: '0'.repeat(64) } }), errorCode('PAYLOAD_INVALID'));
  assert.equal(calls, 1);
  const denied = runtime.connect(pluginDescriptor('example.binary-denied'));
  assert.throws(() => denied.host.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'GET', responseMode: 'binary' }), errorCode('CAPABILITY_NOT_GRANTED'));
  runtime.dispose();

  const pendingRuntime = installCoreRuntime(coreIdentity({ buildId: 'binary-controls', capabilities: ['tavern.plugin.binary-request.v1'] }), new TestRealm(), { hostAdapter: {
    binaryRequest: { send: async (_request, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private abort detail')), { once: true })) },
  } });
  const timeoutSession = pendingRuntime.connect(pluginDescriptor('example.binary-timeout', { capabilities: ['tavern.plugin.binary-request.v1'] }));
  await assert.rejects(timeoutSession.host.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'GET', responseMode: 'binary' }, { timeoutMs: 2 }), errorCode('CALL_TIMEOUT'));
  const controller = new AbortController();
  const aborted = timeoutSession.host.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'GET', responseMode: 'binary' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted, errorCode('CALL_ABORTED'));
  const disposed = timeoutSession.host.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'GET', responseMode: 'binary' });
  timeoutSession.dispose();
  await assert.rejects(disposed, errorCode('PLUGIN_DISPOSED'));
  pendingRuntime.dispose();

  const mismatchRuntime = installCoreRuntime(coreIdentity({ buildId: 'binary-mismatch', capabilities: ['tavern.plugin.binary-request.v1'] }), new TestRealm(), { hostAdapter: {
    binaryRequest: { send: async () => ({ ...valid, sha256: 'f'.repeat(64) }) },
  } });
  const mismatch = mismatchRuntime.connect(pluginDescriptor('example.binary-mismatch', { capabilities: ['tavern.plugin.binary-request.v1'] }));
  await assert.rejects(mismatch.host.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'GET', responseMode: 'binary' }), errorCode('PAYLOAD_INVALID'));
  mismatchRuntime.dispose();

  const crossModeRuntime = installCoreRuntime(coreIdentity({ buildId: 'binary-cross-mode', capabilities: ['tavern.plugin.binary-request.v1'] }), new TestRealm(), { hostAdapter: {
    binaryRequest: { send: async () => jsonResponse() },
  } });
  const crossMode = crossModeRuntime.connect(pluginDescriptor('example.binary-cross-mode', { capabilities: ['tavern.plugin.binary-request.v1'] }));
  await assert.rejects(crossMode.host.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'GET', responseMode: 'binary' }), errorCode('PAYLOAD_INVALID'));
  crossModeRuntime.dispose();

  const reverseCrossModeRuntime = installCoreRuntime(coreIdentity({ buildId: 'binary-reverse-cross-mode', capabilities: ['tavern.plugin.binary-request.v1'] }), new TestRealm(), { hostAdapter: {
    binaryRequest: { send: async () => valid },
  } });
  const reverseCrossMode = reverseCrossModeRuntime.connect(pluginDescriptor('example.binary-reverse-cross-mode', { capabilities: ['tavern.plugin.binary-request.v1'] }));
  await assert.rejects(reverseCrossMode.host.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/import', method: 'POST', responseMode: 'json', body: binaryBody(sqlite) }), errorCode('PAYLOAD_INVALID'));
  reverseCrossModeRuntime.dispose();
});

test('production bridge reads and writes worldbook snapshots only when every real seam exists', async () => {
  const selected = new Set(['Lore']);
  const books = new Map([['Lore', { entries: { 4: { uid: 4, key: ['alpha'], keysecondary: ['beta'], content: 'fact', disable: false, position: 2, order: 8, constant: true } } }]]);
  let updates = 0;
  const deleted = [];
  const context = {
    loadWorldInfo: async (name) => books.get(name) ?? null,
    saveWorldInfo: async (name, data, immediate) => { assert.equal(immediate, true); books.set(name, data); },
    updateWorldInfoList: async () => { updates += 1; },
    getRequestHeaders: () => ({ 'X-CSRF-Token': 'private' }),
    executeSlashCommandsWithOptions: async (command) => {
      if (command === '/getglobalbooks') return { pipe: JSON.stringify([...selected]) };
      const name = JSON.parse(command.slice(command.indexOf('"')));
      if (command.includes('state=on')) selected.add(name); else selected.delete(name);
      return { pipe: '' };
    },
  };
  const target = {
    SillyTavern: { getContext: () => context },
    fetch: async (url, init) => {
      assert.equal(init.headers['X-CSRF-Token'], 'private');
      if (url === '/api/worldinfo/list') return { ok: true, json: async () => [...books.keys()].map((name) => ({ file_id: name, name: `${name} display` })) };
      if (url === '/api/worldinfo/delete') { const { name } = JSON.parse(init.body); books.delete(name); deleted.push(name); return { ok: true }; }
      throw new Error(`unexpected ${url}`);
    },
  };
  const bridge = createSillyTavernHostBridge(target);
  assert.ok(bridge.capabilities.includes('tavern.worldbooks.read'));
  assert.ok(bridge.capabilities.includes('tavern.worldbooks.write'));
  assert.deepEqual(await bridge.hostAdapter.worldbooks.list(), [{ id: 'Lore', name: 'Lore display', active: true, entries: [{ id: '4', keys: ['alpha'], secondaryKeys: ['beta'], content: 'fact', enabled: true, position: 2, order: 8 }] }]);
  assert.equal((await bridge.hostAdapter.worldbooks.active())[0].name, 'Lore');
  await bridge.hostAdapter.worldbooks.save({ id: 'Lore', name: 'Lore', active: true, entries: [{ id: '4', keys: ['updated'], content: 'new', enabled: false }] });
  assert.deepEqual(books.get('Lore').entries['4'], { uid: 4, key: ['updated'], keysecondary: [], content: 'new', disable: true, position: 2, order: 8, constant: true, selective: false });
  await bridge.hostAdapter.worldbooks.setActive('Lore', false);
  assert.equal(selected.has('Lore'), false);
  await bridge.hostAdapter.worldbooks.delete('Lore');
  assert.deepEqual(deleted, ['Lore']); assert.equal(updates, 2);

  const readOnly = createSillyTavernHostBridge({ SillyTavern: { getContext: () => ({ loadWorldInfo: async () => null, getRequestHeaders: () => ({}), executeSlashCommandsWithOptions: async () => ({ pipe: '[]' }) }) }, fetch: target.fetch });
  assert.ok(readOnly.capabilities.includes('tavern.worldbooks.read'));
  assert.equal(readOnly.capabilities.includes('tavern.worldbooks.write'), false);
});

test('production bridge reads the current SillyTavern camel-case connection and selected chat completion model', async () => {
  const callbacks = new Map();
  const removed = [];
  const quietCalls = [];
  const rawCalls = [];
  const context = {
    chatId: 'current.jsonl',
    chat: [{ id: 'm1', is_user: true, mes: 'hello' }],
    name1: 'Current User',
    chatMetadata: { variables: { chapter: 3 } },
    powerUserSettings: { persona_description: 'Current persona description' },
    mainApi: 'openai',
    onlineStatus: 'Valid',
    chatCompletionSettings: { chat_completion_source: 'custom', custom_model: 'oracle-model' },
    eventSource: {
      on(name, callback) { callbacks.set(name, callback); },
      off(name, callback) { removed.push([name, callback]); callbacks.delete(name); },
    },
    eventTypes: {
      MAIN_API_CHANGED: 'main-api', ONLINE_STATUS_CHANGED: 'online',
      CHATCOMPLETION_SOURCE_CHANGED: 'source', CHATCOMPLETION_MODEL_CHANGED: 'model', CONNECTION_PROFILE_LOADED: 'profile', CONNECTION_PROFILE_UPDATED: 'profile-updated', CONNECTION_PROFILE_DELETED: 'profile-deleted',
      CHARACTER_EDITED: 'character', PERSONA_CHANGED: 'persona', PERSONA_UPDATED: 'persona-updated', PERSONA_RENAMED: 'persona-renamed', PERSONA_DELETED: 'persona-deleted', GROUP_UPDATED: 'group-updated',
    },
    generateQuietPrompt: async (options) => { quietCalls.push(options); return 'ok'; },
    generateRaw: async (options) => { rawCalls.push(options); return 'isolated'; },
  };
  const bridge = createSillyTavernHostBridge({ SillyTavern: { getContext: () => context } });
  assert.ok(bridge.capabilities.includes('tavern.generation.read'));
  assert.deepEqual(await bridge.hostAdapter.persona.read(), { name: 'Current User', description: 'Current persona description' });
  assert.deepEqual((await bridge.hostAdapter.chat.readCurrent()).variables, { variables: { chapter: 3 } });
  assert.equal(await bridge.hostAdapter.generation.available(), true);
  assert.deepEqual(await bridge.hostAdapter.generation.models(), ['oracle-model']);
  assert.deepEqual(await bridge.hostAdapter.generation.current(), { active: false, provider: 'custom', model: 'oracle-model' });
  assert.deepEqual(await bridge.hostAdapter.generation.generate({ prompt: 'non-empty prompt', model: 'ignored-override', quiet: true, jsonSchema: { name: 'memory_extract', value: { type: 'object' }, strict: true, returnInvalid: true } }), { text: 'ok', provider: 'custom', model: 'oracle-model' });
  assert.deepEqual(quietCalls, [{ quietPrompt: 'non-empty prompt', jsonSchema: { name: 'memory_extract', value: { type: 'object' }, strict: true, returnInvalid: true } }]);
  assert.deepEqual(await bridge.hostAdapter.generation.generate({ prompt: 'isolated prompt', quiet: true, contextMode: 'isolated' }), { text: 'isolated', provider: 'custom', model: 'oracle-model' });
  assert.deepEqual(rawCalls, [{ prompt: 'isolated prompt' }]);

  let generationChanges = 0;
  const unsubscribeGeneration = bridge.hostAdapter.events.subscribe('generation-config-changed', () => { generationChanges += 1; });
  assert.deepEqual([...callbacks.keys()].sort(), ['main-api', 'model', 'online', 'profile', 'profile-deleted', 'profile-updated', 'source']);
  for (const callback of callbacks.values()) callback();
  assert.equal(generationChanges, 7);
  unsubscribeGeneration();
  assert.equal(removed.length, 7);

  let identityChanges = 0;
  const unsubscribeIdentity = bridge.hostAdapter.events.subscribe('identity-changed', (event) => {
    identityChanges += 1;
    assert.equal(event.identity.userName, 'Current User');
  });
  assert.deepEqual([...callbacks.keys()].sort(), ['character', 'group-updated', 'persona', 'persona-deleted', 'persona-renamed', 'persona-updated']);
  for (const callback of callbacks.values()) callback();
  assert.equal(identityChanges, 6);
  unsubscribeIdentity();
  assert.equal(removed.length, 13);

  context.onlineStatus = 'no_connection';
  assert.equal(await bridge.hostAdapter.generation.available(), false);
});

test('production bridge keeps connected provider-only sources usable through generateQuietPrompt', async () => {
  const current = {
    mainApi: 'novel', onlineStatus: 'Opus tier',
    generateQuietPrompt: async ({ quietPrompt }) => `current:${quietPrompt}`,
  };
  const currentBridge = createSillyTavernHostBridge({ SillyTavern: { getContext: () => current } });
  assert.equal(await currentBridge.hostAdapter.generation.available(), true);
  assert.deepEqual(await currentBridge.hostAdapter.generation.models(), []);
  assert.deepEqual(await currentBridge.hostAdapter.generation.current(), { active: false, provider: 'novel' });
  assert.deepEqual(await currentBridge.hostAdapter.generation.test({ prompt: 'ping' }), { text: 'current:ping', provider: 'novel' });

});

test('every retained Tavern capability has an explicit DTO adapter path', async () => {
  const calls = [];
  const worldbook = { id: 'wb', name: 'World', active: true };
  const runtime = installCoreRuntime(coreIdentity({ capabilities: ALL_CAPABILITIES }), new TestRealm(), { hostAdapter: {
    context: { read: async () => ({ chatId: 'chat' }) }, identity: { read: async () => ({ userId: 'user' }) },
    chat: { readCurrent: async () => ({ key: 'chat', messageCount: 2 }), list: async () => [{ key: 'chat', messageCount: 2 }] },
    events: { subscribe: (_name, listener) => { listener({ name: 'chat-changed', chatKey: 'chat' }); return () => calls.push('event-cleanup'); } },
    worldbooks: {
      list: async () => [worldbook], load: async (id) => id === 'wb' ? worldbook : null,
      save: async (value) => calls.push(['worldbook-save', value.id]), delete: async (id) => calls.push(['worldbook-delete', id]),
      setActive: async (id, active) => calls.push(['worldbook-active', id, active]),
    },
    generation: {
      available: async () => true, models: async () => ['model'],
      generate: async (request) => ({ text: request.prompt, model: request.model }), test: async () => ({ text: 'ok' }),
    },
    metadata: { save: async (values) => calls.push(['metadata', values.key]) }, settings: { save: async () => calls.push('settings') },
    macros: { substitute: async (text) => text.replace('{{x}}', 'value') }, systemMessage: { send: async (text) => calls.push(['system', text]) },
  } });
  const session = runtime.connect(pluginDescriptor('example.complete-host', { capabilities: ALL_CAPABILITIES }));
  assert.deepEqual(await session.host.context.read(), { chatId: 'chat' });
  assert.deepEqual(await session.host.identity.read(), { userId: 'user' });
  assert.equal((await session.host.chat.readCurrent()).key, 'chat'); assert.equal((await session.host.chat.list()).length, 1);
  session.host.events.subscribe('chat-changed', (event) => calls.push(['event', event.chatKey]));
  assert.equal((await session.host.worldbooks.list())[0].id, 'wb'); assert.equal((await session.host.worldbooks.load('wb')).name, 'World');
  await session.host.worldbooks.save(worldbook); await session.host.worldbooks.delete('wb'); await session.host.worldbooks.setActive('wb', false);
  assert.equal(await session.host.generation.available(), true); assert.deepEqual(await session.host.generation.models(), ['model']);
  assert.equal((await session.host.generation.generate({ prompt: 'hello', model: 'model', quiet: true })).text, 'hello');
  assert.equal((await session.host.generation.test({ prompt: 'test' })).text, 'ok');
  await session.host.metadata.save({ key: 'value' }); await session.host.settings.save();
  assert.equal(await session.host.macros.substitute('{{x}}'), 'value'); await session.host.systemMessage.send('notice');
  assert.throws(() => session.host.generation.generate({ prompt: () => 'invalid' }), errorCode('PAYLOAD_INVALID'));
  session.dispose();
  assert.ok(calls.some((entry) => entry === 'event-cleanup'));
});

test('HostPort grants the requested/supported intersection and maps adapter failures', async () => {
  const realm = new TestRealm();
  const runtime = installCoreRuntime(coreIdentity({ capabilities: ['tavern.context.read', 'tavern.chat.read'] }), realm, {
    hostAdapter: {
      context: { read: async () => ({ chatId: 'chat-1' }) },
      chat: { readCurrent: async () => { throw new Error('private host failure'); }, list: async () => [] },
    },
  });
  const session = runtime.connect(pluginDescriptor('example.host', { capabilities: ['tavern.context.read', 'tavern.chat.read', 'tavern.worldbooks.read'] }));
  assert.deepEqual(session.host.capabilities, ['tavern.context.read', 'tavern.chat.read']);
  assert.equal(session.host.has('tavern.worldbooks.read'), false);
  assert.equal('worldbooks' in session.host, false);
  assert.throws(() => session.host.worldbooks.list(), errorCode('CAPABILITY_NOT_GRANTED'));
  assert.deepEqual(await session.host.context.read(), { chatId: 'chat-1' });
  await assert.rejects(session.host.chat.readCurrent(), errorCode('BRIDGE_CORRUPTED'));
});

test('HostPort fails closed when a supported adapter is absent and cleans event listeners', async () => {
  const realm = new TestRealm();
  let listener;
  let cleanups = 0;
  const runtime = installCoreRuntime(coreIdentity({ capabilities: ['tavern.chat.events', 'tavern.settings.write'] }), realm, {
    hostAdapter: { events: { subscribe: (_name, callback) => { listener = callback; return () => { listener = undefined; cleanups += 1; }; } } },
  });
  const session = runtime.connect(pluginDescriptor('example.events', { capabilities: ['tavern.chat.events', 'tavern.settings.write'] }));
  const unsubscribe = session.host.events.subscribe('chat-changed', () => {});
  assert.equal(typeof listener, 'function');
  assert.throws(() => session.host.settings.save(), errorCode('CAPABILITY_NOT_GRANTED'));
  unsubscribe();
  assert.equal(cleanups, 1);
  session.host.events.subscribe('chat-changed', () => {});
  session.dispose();
  assert.equal(cleanups, 2);
  assert.throws(() => session.host.events.subscribe('chat-changed', () => {}), errorCode('PLUGIN_DISPOSED'));
});

test('HostPort rejects invalid DTOs before sync or async adapters and preserves explicit callback capability', async () => {
  let generationCalls = 0;
  let worldbookCalls = 0;
  let eventCalls = 0;
  const runtime = installCoreRuntime(coreIdentity({ capabilities: ALL_CAPABILITIES }), new TestRealm(), { hostAdapter: {
    generation: {
      available: async () => true, models: async () => [],
      generate: async () => { generationCalls += 1; return { text: 'nope' }; },
      test: async () => { generationCalls += 1; return { text: 'nope' }; },
    },
    worldbooks: {
      list: async () => [], load: async () => null,
      save: async () => { worldbookCalls += 1; }, delete: async () => { worldbookCalls += 1; }, setActive: async () => { worldbookCalls += 1; },
    },
    events: { subscribe: (name, listener) => { eventCalls += 1; listener({ name, chatKey: () => 'invalid' }); return () => {}; } },
  } });
  const session = runtime.connect(pluginDescriptor('example.dto-guard', { capabilities: ALL_CAPABILITIES }));
  assert.throws(() => session.host.generation.generate({ prompt: () => 'invalid' }), errorCode('PAYLOAD_INVALID'));
  assert.throws(() => session.host.worldbooks.save({ id: 'wb', name: 'World', active: () => true }), errorCode('PAYLOAD_INVALID'));
  assert.equal(generationCalls, 0);
  assert.equal(worldbookCalls, 0);
  let callbacks = 0;
  assert.throws(() => session.host.events.subscribe('chat-changed', () => { callbacks += 1; }), errorCode('PAYLOAD_INVALID'));
  assert.equal(eventCalls, 1);
  assert.equal(callbacks, 0);
  await session.host.generation.generate({ prompt: 'valid' });
  await session.host.worldbooks.save({ id: 'wb', name: 'World', active: true });
  assert.equal(generationCalls, 1);
  assert.equal(worldbookCalls, 1);
});

test('production bridge maps every retained SillyTavern event to a narrow DTO and detaches listeners', async () => {
  const callbacks = new Map();
  const removed = [];
  const memoryVariables = [{ initialized_lorebooks: { Lore: [] }, stat_data: { 世界: { 灾变天数: 5 }, 核心储备: { 低级核心: 4 } } }];
  const context = {
    chatId: 'chat.jsonl', name1: 'User', characterId: 2, groupId: 'group', main_api: 'openai', online_status: 'gpt-test',
    selected_world_info: ['Lore'],
    chat: [{ id: 'm1', is_user: false, name: 'Character', mes: 'answer', variables: memoryVariables }],
    eventSource: {
      on(name, callback) { callbacks.set(name, callback); },
      off(name, callback) { removed.push([name, callback]); callbacks.delete(name); },
    },
    event_types: {
      CHAT_CHANGED: 'chat', MESSAGE_RECEIVED: 'received', MESSAGE_SENT: 'sent', MESSAGE_EDITED: 'edited', MESSAGE_DELETED: 'deleted',
      GENERATION_STARTED: 'started', GENERATION_ENDED: 'ended', CHAT_COMPLETION_PROMPT_READY: 'prompt', WORLDINFO_UPDATED: 'worldbook', CHARACTER_EDITED: 'identity',
    },
    addOneMessage: async (raw) => { context.chat.push(raw); }, saveChat: async () => {}, deleteMessage: async () => {},
  };
  const bridge = createSillyTavernHostBridge({ SillyTavern: { getContext: () => context } });
  const mappedMessages = await bridge.hostAdapter.chat.readMessages();
  assert.deepEqual(mappedMessages[0].variables, memoryVariables);
  assert.notEqual(mappedMessages[0].variables, memoryVariables);
  assert.notEqual(mappedMessages[0].variables[0].stat_data, memoryVariables[0].stat_data);
  const realm = new TestRealm();
  const runtime = installCoreRuntime(coreIdentity({ capabilities: ['tavern.chat.events'] }), realm, { hostAdapter: bridge.hostAdapter });
  const session = runtime.connect(pluginDescriptor('example.event-map', { capabilities: ['tavern.chat.events'] }));
  const received = new Map();
  const names = ['chat-changed', 'message-received', 'message-sent', 'message-edited', 'message-deleted', 'generation-started', 'generation-ended', 'prompt-ready', 'worldbook-updated', 'identity-changed'];
  const unsubscribes = names.map((name) => session.host.events.subscribe(name, (event) => received.set(name, event)));

  callbacks.get('chat')('other.jsonl');
  callbacks.get('received')(0, 'normal'); callbacks.get('sent')(0); callbacks.get('edited')(0); callbacks.get('deleted')(0);
  callbacks.get('started')('normal', { usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }, signal: new AbortController().signal }, false);
  callbacks.get('ended')(1);
  callbacks.get('prompt')({ chat: [{ role: 'system', content: 'rules' }, { role: 'user', name: 'User', content: [{ type: 'text', text: 'hi' }] }], dryRun: true });
  callbacks.get('worldbook')('Lore', { entries: { 7: { uid: 7, key: ['alpha'], keysecondary: ['beta'], content: 'fact', disable: false, position: 1, order: 10 } } });
  callbacks.get('identity')({ detail: { id: 9, character: { name: 'private raw object' } } });

  assert.deepEqual(received.get('chat-changed'), { name: 'chat-changed', chatKey: 'other.jsonl' });
  assert.deepEqual(received.get('message-received'), { name: 'message-received', chatKey: 'chat.jsonl', messageId: '0', message: { id: 'm1', index: 0, role: 'assistant', name: 'Character', text: 'answer', variables: memoryVariables } });
  memoryVariables[0].stat_data.世界.灾变天数 = 6;
  assert.equal(received.get('message-received').message.variables[0].stat_data.世界.灾变天数, 5);
  assert.equal(received.get('message-sent').message.text, 'answer');
  assert.equal(received.get('message-edited').messageId, '0');
  assert.deepEqual(received.get('message-deleted'), { name: 'message-deleted', chatKey: 'chat.jsonl', messageId: '0' });
  assert.deepEqual(received.get('generation-started'), { name: 'generation-started', chatKey: 'chat.jsonl', generation: { active: true, provider: 'openai', model: 'gpt-test', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } } });
  assert.deepEqual(received.get('generation-ended'), { name: 'generation-ended', chatKey: 'chat.jsonl', generation: { active: false, provider: 'openai', model: 'gpt-test' } });
  assert.deepEqual(received.get('prompt-ready').prompt, { messages: [{ role: 'system', content: 'rules' }, { role: 'user', name: 'User', content: [{ type: 'text', text: 'hi' }] }], dryRun: true });
  assert.deepEqual(received.get('worldbook-updated').worldbook, { id: 'Lore', name: 'Lore', active: true, entries: [{ id: '7', keys: ['alpha'], secondaryKeys: ['beta'], content: 'fact', enabled: true, position: 1, order: 10 }] });
  assert.deepEqual(received.get('identity-changed'), { name: 'identity-changed', identity: { userName: 'User', characterId: '9', groupId: 'group' } });
  assert.equal(JSON.stringify([...received.values()]).includes('private raw object'), false);
  context.chat.push({ id: 'unsafe', mes: 'unsafe', variables: [{ stat_data: { count: 1 }, callback: () => 'raw' }] });
  const sanitized = await bridge.hostAdapter.chat.readMessages();
  assert.equal('variables' in sanitized[1], false);
  const appended = await bridge.hostAdapter.chat.append({ role: 'assistant', text: 'memory', variables: [{ stat_data: { turn: 7 } }] });
  assert.deepEqual(appended.variables, [{ stat_data: { turn: 7 } }]);
  const edited = await bridge.hostAdapter.chat.edit('m1', { role: 'assistant', text: 'edited memory', variables: [{ stat_data: { turn: 8 } }] });
  assert.deepEqual(edited.variables, [{ stat_data: { turn: 8 } }]);

  unsubscribes[0]();
  runtime.dispose();
  assert.equal(removed.length, names.length);
  assert.equal(new Set(removed.map(([name]) => name)).size, names.length);
  unsubscribes[0]();
  assert.equal(removed.length, names.length);

  const replacement = installCoreRuntime(coreIdentity({ buildId: 'event-reload', capabilities: ['tavern.chat.events'] }), realm, { hostAdapter: bridge.hostAdapter });
  const replacementSession = replacement.connect(pluginDescriptor('example.event-map-reload', { capabilities: ['tavern.chat.events'] }));
  replacementSession.host.events.subscribe('chat-changed', () => {});
  assert.equal(callbacks.size, 1);
  replacement.dispose();
  assert.equal(callbacks.size, 0);
  assert.equal(removed.length, names.length + 1);
});

test('HostPort rejects malformed event DTOs for every retained event name', () => {
  const invalid = new Map([
    ['chat-changed', { name: 'chat-changed', chatKey: 1 }],
    ['message-received', { name: 'message-received', messageId: 1 }],
    ['message-sent', { name: 'message-sent', messageId: '1', message: { id: '1', index: 0, role: 'assistant', text: () => 'raw' } }],
    ['message-edited', { name: 'message-edited', messageId: '1', unexpected: true }],
    ['message-deleted', { name: 'message-deleted' }],
    ['generation-started', { name: 'generation-started', generation: { active: true, usage: { totalTokens: Number.POSITIVE_INFINITY } } }],
    ['generation-ended', { name: 'generation-ended', generation: { active: 'false' } }],
    ['prompt-ready', { name: 'prompt-ready', prompt: { messages: {}, dryRun: false } }],
    ['worldbook-updated', { name: 'worldbook-updated', worldbook: { id: 'Lore', name: 'Lore' } }],
    ['identity-changed', { name: 'identity-changed', identity: { characterId: 1 } }],
  ]);
  let adapterCalls = 0;
  const runtime = installCoreRuntime(coreIdentity({ capabilities: ['tavern.chat.events'] }), new TestRealm(), { hostAdapter: {
    events: { subscribe: (name, listener) => { adapterCalls += 1; listener(invalid.get(name)); return () => {}; } },
  } });
  const session = runtime.connect(pluginDescriptor('example.invalid-events', { capabilities: ['tavern.chat.events'] }));
  for (const name of invalid.keys()) assert.throws(() => session.host.events.subscribe(name, () => assert.fail('invalid DTO reached listener')), errorCode('PAYLOAD_INVALID'));
  assert.equal(adapterCalls, invalid.size);
  assert.throws(() => session.host.events.subscribe('not-retained', () => {}), errorCode('PAYLOAD_INVALID'));
  assert.equal(adapterCalls, invalid.size);
});
