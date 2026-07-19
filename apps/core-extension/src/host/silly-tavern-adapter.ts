import { PLUGIN_BINARY_CONTENT_TYPE, PLUGIN_BINARY_MAX_BYTES } from '@ss-helper/sdk';
import type {
  ChatMessageInput, ChatMessageSnapshot, ChatSnapshot, GenerationRequest, GenerationResult, GenerationSnapshot,
  HostCapability, HostCharacterSnapshot, HostContextSnapshot, HostEvent, HostEventName,
  HostIdentitySnapshot, HostPersonaSnapshot, MessageVariablesSnapshot, PlainData, PluginApiRequest, PluginApiResponse,
  PluginBinaryBodyV1, PluginBinaryRequestV1, PluginBinaryResponseV1, PluginJsonAcknowledgementV1,
  PromptContribution, WorldbookSnapshot,
} from '@ss-helper/sdk';
import type { TavernHostAdapter } from './tavern-host-port.js';

type UnknownRecord = Record<string, unknown>;
type HostFunction = (...args: unknown[]) => unknown;
const record = (value: unknown): UnknownRecord | undefined => typeof value === 'object' && value !== null ? value as UnknownRecord : undefined;
const fn = (value: unknown): HostFunction | undefined => typeof value === 'function' ? value as HostFunction : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined;
const plain = (value: unknown): PlainData | undefined => {
  try { return JSON.parse(JSON.stringify(value)) as PlainData; } catch { return undefined; }
};
const retainedPlain = (value: unknown, seen = new Set<object>()): PlainData | undefined => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || seen.has(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const output: PlainData[] = [];
    for (const item of value) { const converted = retainedPlain(item, seen); if (converted === undefined) return undefined; output.push(converted); }
    return output;
  }
  const output: Record<string, PlainData> = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor)) return undefined;
    const converted = retainedPlain(descriptor.value, seen); if (converted === undefined) return undefined; output[key] = converted;
  }
  return output;
};
const messageVariables = (value: unknown): MessageVariablesSnapshot | undefined => {
  const converted = retainedPlain(value);
  if (Array.isArray(converted)) return converted.every((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry)) ? converted as readonly Record<string, PlainData>[] : undefined;
  return typeof converted === 'object' && converted !== null ? converted as Record<string, PlainData> : undefined;
};
const integer = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const generationSelection = (context: UnknownRecord): { readonly provider?: string; readonly model?: string; readonly connected: boolean } => {
  const mainApi = text(context.mainApi) ?? text(context.main_api);
  const onlineStatus = text(context.onlineStatus) ?? text(context.online_status);
  const connected = onlineStatus !== undefined && onlineStatus !== 'no_connection';
  const chatCompletionSettings = record(context.chatCompletionSettings) ?? record(context.chat_completion_settings);
  if (mainApi === 'openai' && chatCompletionSettings !== undefined) {
    const provider = text(chatCompletionSettings.chat_completion_source) ?? mainApi;
    const modelKey = provider === 'makersuite' ? 'google_model' : `${provider}_model`;
    const model = text(chatCompletionSettings[modelKey]);
    return { connected, ...(provider === undefined ? {} : { provider }), ...(model === undefined ? {} : { model }) };
  }
  const model = mainApi === 'kobold' || mainApi === 'textgenerationwebui' || (mainApi === 'openai' && chatCompletionSettings === undefined)
    ? onlineStatus
    : undefined;
  return { connected, ...(mainApi === undefined ? {} : { provider: mainApi }), ...(model === undefined || !connected ? {} : { model }) };
};
const generationSnapshot = (context: UnknownRecord, active = context.is_send_press === true): GenerationSnapshot => {
  const selected = generationSelection(context);
  return { active, ...(selected.provider === undefined ? {} : { provider: selected.provider }), ...(selected.model === undefined ? {} : { model: selected.model }) };
};
const decodeBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const decoded = atob(value);
  const output = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) output[index] = decoded.charCodeAt(index);
  return output;
};
const encodeBase64 = (value: Uint8Array): string => {
  let binary = '';
  for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  return btoa(binary);
};
const binarySha256 = async (value: Uint8Array): Promise<string> => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const safeFilename = (value: string | null): string | undefined => {
  if (value === null) return undefined;
  const match = /^attachment\s*;\s*filename=(?:"([^"]+)"|([^;\s]+))\s*$/iu.exec(value);
  const filename = match?.[1] ?? match?.[2];
  if (filename === undefined || filename.length === 0 || filename.length > 255 || /[\u0000-\u001f\u007f/\\]/u.test(filename)) throw new Error('unsafe content disposition');
  return filename;
};
const assertBinaryBody = async (body: PluginBinaryBodyV1): Promise<Uint8Array<ArrayBuffer>> => {
  const bytes = decodeBase64(body.data);
  if (body.contentType !== PLUGIN_BINARY_CONTENT_TYPE || bytes.byteLength !== body.byteLength || bytes.byteLength > PLUGIN_BINARY_MAX_BYTES || await binarySha256(bytes) !== body.sha256) {
    throw new Error('invalid binary request body');
  }
  return bytes;
};
const jsonAcknowledgement = (value: unknown): PluginJsonAcknowledgementV1 => {
  const acknowledgement = retainedPlain(value);
  const item = record(acknowledgement);
  if (item === undefined || Object.keys(item).length !== 2 || item.ok !== true || !Object.hasOwn(item, 'data')) {
    throw new Error('invalid JSON acknowledgement');
  }
  return acknowledgement as unknown as PluginJsonAcknowledgementV1;
};
const message = (value: unknown, index: number): ChatMessageSnapshot => {
  const item = record(value) ?? {};
  const variables = messageVariables(item.variables);
  return {
    id: text(item.id) ?? text(item.messageId) ?? String(index), index,
    role: item.is_system === true ? 'system' : item.is_user === true ? 'user' : 'assistant',
    ...(text(item.name) === undefined ? {} : { name: text(item.name) }), text: text(item.mes) ?? text(item.text) ?? '',
    ...(text(item.send_date) === undefined ? {} : { createdAt: text(item.send_date) }),
    ...(variables === undefined ? {} : { variables }),
  };
};
const chatKey = (context: UnknownRecord): string | undefined => text(context.chatId) ?? text(context.chat_id) ?? text(context.chatFile);
const chatDisplayName = (context: UnknownRecord): string | undefined => {
  if (context.groupId !== undefined && context.groupId !== null && String(context.groupId).trim() !== '') {
    const groups = Array.isArray(context.groups) ? context.groups : [];
    const group = groups.map(record).find((item) => item !== undefined && String(item.id) === String(context.groupId));
    return text(group?.name) ?? text(context.name2);
  }
  const characters = Array.isArray(context.characters) ? context.characters : [];
  return text(record(characters[Number(context.characterId)])?.name) ?? text(context.name2);
};
const identity = (context: UnknownRecord, characterId?: unknown): HostIdentitySnapshot => ({
  ...(text(context.userId) === undefined ? {} : { userId: text(context.userId) }),
  ...(text(context.name1) === undefined ? {} : { userName: text(context.name1) }),
  ...(characterId === undefined && context.characterId === undefined ? {} : { characterId: String(characterId ?? context.characterId) }),
  ...(context.groupId === undefined ? {} : { groupId: String(context.groupId) }),
});
const persona = (context: UnknownRecord): HostPersonaSnapshot | null => {
  const name = text(context.name1);
  if (name === undefined) return null;
  const settings = record(context.powerUserSettings) ?? record(context.power_user);
  const description = text(settings?.persona_description) ?? text(context.persona_description);
  return { name, ...(text(context.user_avatar) === undefined ? {} : { avatar: text(context.user_avatar) }), ...(description === undefined ? {} : { description }) };
};
const messageEvent = (name: 'message-received' | 'message-sent' | 'message-edited' | 'message-deleted', context: UnknownRecord, payload: unknown): HostEvent => {
  const item = record(payload);
  const index = integer(payload) ?? integer(item?.index) ?? integer(item?.messageId);
  const id = typeof payload === 'string' ? payload : text(item?.id) ?? text(item?.messageId) ?? String(index ?? payload ?? '');
  const list = Array.isArray(context.chat) ? context.chat : [];
  const raw = index === undefined ? item : list[index] ?? item;
  const key = chatKey(context);
  if (name === 'message-deleted') return { name, messageId: id, ...(key === undefined ? {} : { chatKey: key }) };
  return { name, messageId: id, ...(key === undefined ? {} : { chatKey: key }), ...(raw === undefined ? {} : { message: message(raw, index ?? 0) }) };
};
const generationUsage = (...args: unknown[]): GenerationSnapshot['usage'] => {
  const source = args.map(record).find((item) => record(item?.usage) !== undefined || record(item?.tokenUsage) !== undefined);
  const usage = record(source?.usage) ?? record(source?.tokenUsage);
  if (usage === undefined) return undefined;
  const inputTokens = finite(usage.inputTokens) ?? finite(usage.input_tokens) ?? finite(usage.promptTokens) ?? finite(usage.prompt_tokens);
  const outputTokens = finite(usage.outputTokens) ?? finite(usage.output_tokens) ?? finite(usage.completionTokens) ?? finite(usage.completion_tokens);
  const totalTokens = finite(usage.totalTokens) ?? finite(usage.total_tokens);
  return inputTokens === undefined && outputTokens === undefined && totalTokens === undefined ? undefined : {
    ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(totalTokens === undefined ? {} : { totalTokens }),
  };
};
const generationEvent = (name: 'generation-started' | 'generation-ended' | 'generation-config-changed', context: UnknownRecord, args: unknown[]): HostEvent => {
  const usage = generationUsage(...args);
  const key = chatKey(context);
  const snapshot = generationSnapshot(context, name === 'generation-started');
  return {
    name, ...(key === undefined || name === 'generation-config-changed' ? {} : { chatKey: key }),
    generation: { ...snapshot, ...(usage === undefined ? {} : { usage }) },
  };
};
const promptEvent = (context: UnknownRecord, payload: unknown): HostEvent => {
  const value = record(payload) ?? {};
  const messages = (Array.isArray(value.chat) ? value.chat : []).map((entry) => {
    const item = record(entry) ?? {};
    const content = plain(item.content);
    return { ...(text(item.role) === undefined ? {} : { role: text(item.role) }), ...(text(item.name) === undefined ? {} : { name: text(item.name) }), ...(content === undefined ? {} : { content }) };
  });
  const key = chatKey(context);
  return { name: 'prompt-ready', ...(key === undefined ? {} : { chatKey: key }), prompt: { messages, dryRun: value.dryRun === true } };
};
const worldbookSnapshot = (context: UnknownRecord, nameValue: unknown, payload: unknown, active?: boolean): WorldbookSnapshot => {
  const name = text(nameValue) ?? '';
  const data = record(payload) ?? {};
  const rawEntries = record(data.entries) ?? {};
  const entries = Object.entries(rawEntries).map(([entryKey, raw]) => {
    const item = record(raw) ?? {};
    const keys = Array.isArray(item.key) ? item.key.filter((key): key is string => typeof key === 'string') : text(item.key) === undefined ? [] : [text(item.key) as string];
    const secondaryKeys = Array.isArray(item.keysecondary) ? item.keysecondary.filter((key): key is string => typeof key === 'string') : undefined;
    const position = finite(item.position);
    const order = finite(item.order);
    return {
      id: String(item.uid ?? entryKey), keys, ...(secondaryKeys === undefined ? {} : { secondaryKeys }), content: typeof item.content === 'string' ? item.content : '', enabled: item.disable !== true,
      ...(position === undefined ? {} : { position }), ...(order === undefined ? {} : { order }),
    };
  });
  const activeNames = Array.isArray(context.selected_world_info) ? context.selected_world_info : [];
  return { id: name, name, active: active ?? activeNames.includes(name), entries };
};
const worldbookEvent = (context: UnknownRecord, nameValue: unknown, payload: unknown): HostEvent => ({ name: 'worldbook-updated', worldbook: worldbookSnapshot(context, nameValue, payload) });
const worldbookData = (snapshot: WorldbookSnapshot, current: unknown): UnknownRecord => {
  const existing = record(current) ?? {};
  const existingEntries = record(existing.entries) ?? {};
  const entries = Object.fromEntries((snapshot.entries ?? []).map((entry) => {
    const previous = record(existingEntries[entry.id]) ?? {};
    const uid = Number.isSafeInteger(Number(entry.id)) && Number(entry.id) >= 0 ? Number(entry.id) : entry.id;
    return [String(entry.id), {
      ...previous, uid, key: [...entry.keys], keysecondary: [...(entry.secondaryKeys ?? [])], content: entry.content,
      disable: !entry.enabled, position: entry.position ?? previous.position ?? 0, order: entry.order ?? previous.order ?? 100,
      constant: previous.constant === true, selective: previous.selective === true,
    }];
  }));
  return { ...existing, entries };
};

export interface SillyTavernHostBridge { readonly capabilities: readonly HostCapability[]; readonly hostAdapter: TavernHostAdapter; }

export function createSillyTavernHostBridge(target: typeof globalThis = globalThis): SillyTavernHostBridge {
  const root = target as typeof globalThis & { SillyTavern?: { getContext?: () => unknown }; eventSource?: unknown; eventTypes?: unknown; event_types?: unknown; setExtensionPrompt?: unknown; getRequestHeaders?: unknown };
  const getContext = (): UnknownRecord => record(root.SillyTavern?.getContext?.()) ?? {};
  const initial = getContext();
  const capabilities: HostCapability[] = [];
  const adapter: { -readonly [K in keyof TavernHostAdapter]?: TavernHostAdapter[K] } = {};

  if (root.SillyTavern?.getContext !== undefined) {
    capabilities.push('tavern.context.read', 'tavern.identity.read', 'tavern.character.read', 'tavern.persona.read', 'tavern.chat.read');
    adapter.context = { read: async (): Promise<HostContextSnapshot> => { const c = getContext(); const key = chatKey(c); return { ...(key === undefined ? {} : { chatId: key, chatKey: key }), ...(c.characterId === undefined ? {} : { characterId: String(c.characterId) }), ...(c.groupId === undefined ? {} : { groupId: String(c.groupId) }) }; } };
    adapter.identity = { read: async (): Promise<HostIdentitySnapshot> => identity(getContext()) };
    adapter.character = { read: async (): Promise<HostCharacterSnapshot | null> => { const c = getContext(); const chars = Array.isArray(c.characters) ? c.characters : []; const raw = record(chars[Number(c.characterId)]); if (raw === undefined) return null; return { id: text(raw.avatar) ?? String(c.characterId ?? ''), name: text(raw.name) ?? text(c.name2) ?? '', ...(text(raw.avatar) === undefined ? {} : { avatar: text(raw.avatar) }), ...(text(raw.description) === undefined ? {} : { description: text(raw.description) }), ...(text(raw.personality) === undefined ? {} : { personality: text(raw.personality) }), ...(text(raw.scenario) === undefined ? {} : { scenario: text(raw.scenario) }), ...(text(raw.first_mes) === undefined ? {} : { firstMessage: text(raw.first_mes) }), ...(text(raw.mes_example) === undefined ? {} : { exampleMessages: text(raw.mes_example) }) }; } };
    adapter.persona = { read: async (): Promise<HostPersonaSnapshot | null> => persona(getContext()) };
    adapter.chat = {
      readCurrent: async (): Promise<ChatSnapshot | null> => { const c = getContext(); const list = Array.isArray(c.chat) ? c.chat : []; const key = text(c.chatId) ?? text(c.chat_id) ?? text(c.chatFile); const name = chatDisplayName(c); const value = retainedPlain(c.chatMetadata ?? c.chat_metadata); const variables: Readonly<Record<string, PlainData>> | undefined = value !== undefined && !Array.isArray(value) && value !== null && typeof value === 'object' ? value as Readonly<Record<string, PlainData>> : undefined; return key === undefined ? null : { key, messageCount: list.length, messages: list.map(message), ...(name === undefined ? {} : { name }), ...(variables === undefined ? {} : { variables }) }; },
      readMessages: async () => { const c = getContext(); return (Array.isArray(c.chat) ? c.chat : []).map(message); },
      list: async () => [],
      append: async (input: ChatMessageInput) => { const c = getContext(); const add = fn(c.addOneMessage); if (add === undefined) throw new Error('append unavailable'); const raw = { name: input.name ?? (input.role === 'user' ? c.name1 : c.name2), is_user: input.role === 'user', is_system: input.role === 'system', mes: input.text, variables: input.variables }; await add.call(c, raw); const list = Array.isArray(c.chat) ? c.chat : []; return message(list.at(-1) ?? raw, Math.max(0, list.length - 1)); },
      edit: async (id, input) => { const c = getContext(); const list = Array.isArray(c.chat) ? c.chat : []; const index = list.findIndex((item, i) => (record(item)?.id ?? String(i)) === id); if (index < 0) throw new Error('message unavailable'); const item = record(list[index]) ?? {}; item.mes = input.text; item.is_user = input.role === 'user'; item.is_system = input.role === 'system'; if (input.name !== undefined) item.name = input.name; if (input.variables !== undefined) item.variables = input.variables; const save = fn(c.saveChat); if (save === undefined) throw new Error('edit unavailable'); await save.call(c); return message(item, index); },
      delete: async (id) => { const c = getContext(); const remove = fn(c.deleteMessage); if (remove === undefined) throw new Error('delete unavailable'); await remove.call(c, id); },
    };
    const chat = adapter.chat;
    if (fn(initial.addOneMessage) !== undefined && fn(initial.saveChat) !== undefined && fn(initial.deleteMessage) !== undefined) capabilities.push('tavern.chat.write');
  }

  const eventSource = record(initial.eventSource) ?? record(root.eventSource);
  const eventTypes = record(initial.eventTypes) ?? record(initial.event_types) ?? record(root.eventTypes) ?? record(root.event_types) ?? {};
  const on = fn(eventSource?.on); const off = fn(eventSource?.off) ?? fn(eventSource?.removeListener);
  if (eventSource !== undefined && on !== undefined && off !== undefined) {
    capabilities.push('tavern.chat.events');
    const names: Record<HostEventName, string> = { 'chat-changed': 'CHAT_CHANGED', 'message-received': 'MESSAGE_RECEIVED', 'message-sent': 'MESSAGE_SENT', 'message-edited': 'MESSAGE_EDITED', 'message-deleted': 'MESSAGE_DELETED', 'generation-started': 'GENERATION_STARTED', 'generation-ended': 'GENERATION_ENDED', 'generation-config-changed': 'GENERATION_CONFIG_CHANGED', 'prompt-ready': 'CHAT_COMPLETION_PROMPT_READY', 'worldbook-updated': 'WORLDINFO_UPDATED', 'identity-changed': 'CHARACTER_EDITED' };
    adapter.events = { subscribe: (name, listener) => {
      const primaryKeys = name === 'generation-config-changed' ? ['MAIN_API_CHANGED', 'ONLINE_STATUS_CHANGED'] : [names[name]];
      const optionalKeys = name === 'generation-config-changed'
        ? ['CHATCOMPLETION_SOURCE_CHANGED', 'CHATCOMPLETION_MODEL_CHANGED', 'CONNECTION_PROFILE_LOADED', 'CONNECTION_PROFILE_UPDATED', 'CONNECTION_PROFILE_DELETED']
        : name === 'identity-changed' ? ['PERSONA_CHANGED', 'PERSONA_UPDATED', 'PERSONA_RENAMED', 'PERSONA_DELETED', 'GROUP_UPDATED'] : [];
      const keys = [...primaryKeys, ...optionalKeys.filter((key) => text(eventTypes[key]) !== undefined)];
      const subscriptions = [...new Set(keys.map((key) => `${key}\u0000${String(eventTypes[key] ?? key)}`))].map((entry) => {
        const [key, hostName] = entry.split('\u0000', 2) as [string, string];
        const callback = (...args: unknown[]): void => {
        const context = getContext();
        if (name === 'chat-changed') listener({ name, chatKey: text(args[0]) ?? chatKey(context) ?? '' });
        else if (name === 'message-received' || name === 'message-sent' || name === 'message-edited' || name === 'message-deleted') listener(messageEvent(name, context, args[0]));
        else if (name === 'generation-started' || name === 'generation-ended' || name === 'generation-config-changed') listener(generationEvent(name, context, args));
        else if (name === 'prompt-ready') listener(promptEvent(context, args[0]));
        else if (name === 'worldbook-updated') listener(worldbookEvent(context, args[0], args[1]));
        else { const detail = key === 'CHARACTER_EDITED' ? record(record(args[0])?.detail) : undefined; listener({ name, identity: identity(context, detail?.id) }); }
        };
        on.call(eventSource, hostName, callback);
        return { hostName, callback };
      });
      return () => { subscriptions.forEach(({ hostName, callback }) => off.call(eventSource, hostName, callback)); };
    } };
  }

  const setPrompt = fn(initial.setExtensionPrompt) ?? fn(root.setExtensionPrompt);
  if (setPrompt !== undefined) { capabilities.push('tavern.prompt.contribute'); adapter.prompt = { set: async (value: PromptContribution) => { setPrompt(value.id, value.content, value.position ?? 0, value.depth ?? 0, value.scan ?? false); }, remove: async (id) => { setPrompt(id, '', 0, 0, false); } }; }
  const headers = fn(initial.getRequestHeaders) ?? fn(root.getRequestHeaders);
  if (headers !== undefined && typeof target.fetch === 'function') {
    capabilities.push('tavern.plugin.request', 'tavern.plugin.binary-request.v1');
    adapter.request = { send: async (request: PluginApiRequest): Promise<PluginApiResponse> => { if (!request.path.startsWith('/') || request.path.startsWith('//') || request.path.includes('://')) throw new Error('relative same-origin path required'); const url = new URL(request.path, target.location?.origin ?? 'http://localhost'); if (target.location?.origin !== undefined && url.origin !== target.location.origin) throw new Error('cross-origin request denied'); for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, String(value)); const response = await target.fetch(url, { method: request.method ?? 'GET', headers: headers() as HeadersInit, ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }) }); const contentType = response.headers.get('content-type') ?? ''; const body = response.status === 204 ? undefined : plain(contentType.includes('json') ? await response.json() : await response.text()); return { status: response.status, ok: response.ok, ...(body === undefined ? {} : { body }) }; } };
    adapter.binaryRequest = { send: async (request: PluginBinaryRequestV1, options): Promise<PluginBinaryResponseV1> => {
      if (!/^\/api\/plugins\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9._~-]+)*$/u.test(request.path) || request.path.split('/').some((segment) => segment === '.' || segment === '..')) throw new Error('plugin API path required');
      const url = new URL(request.path, target.location?.origin ?? 'http://localhost');
      if (target.location?.origin !== undefined && url.origin !== target.location.origin) throw new Error('cross-origin request denied');
      const privateHeaders = new Headers(headers() as HeadersInit);
      privateHeaders.set('Accept', request.responseMode === 'binary' ? PLUGIN_BINARY_CONTENT_TYPE : 'application/json');
      const body = request.body === undefined ? undefined : await assertBinaryBody(request.body);
      if (body !== undefined) {
        privateHeaders.set('Content-Type', PLUGIN_BINARY_CONTENT_TYPE);
        privateHeaders.set('X-Content-SHA256', request.body!.sha256);
      }
      const response = await target.fetch(url, { method: request.method, headers: privateHeaders, signal: options.signal, ...(body === undefined ? {} : { body: body.buffer }) });
      const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase();
      if (request.responseMode === 'json') {
        if (contentType !== 'application/json' || !response.ok) throw new Error('unsupported JSON acknowledgement response');
        return { version: 1, mode: 'json', status: response.status, ok: response.ok, body: jsonAcknowledgement(await response.json()) };
      }
      if (contentType !== PLUGIN_BINARY_CONTENT_TYPE) throw new Error('unsupported binary response content type');
      const declaredLength = response.headers.get('content-length');
      if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > PLUGIN_BINARY_MAX_BYTES)) throw new Error('invalid binary response length');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > PLUGIN_BINARY_MAX_BYTES || (declaredLength !== null && Number(declaredLength) !== buffer.byteLength)) throw new Error('binary response length mismatch');
      const bytes = new Uint8Array(buffer);
      const filename = safeFilename(response.headers.get('content-disposition'));
      return {
        version: 1, mode: 'binary', status: response.status, ok: response.ok, encoding: 'base64', contentType: PLUGIN_BINARY_CONTENT_TYPE,
        data: encodeBase64(bytes), byteLength: bytes.byteLength, sha256: await binarySha256(bytes),
        ...(filename === undefined ? {} : { filename }),
      };
    } };
  }

  const generateQuietPrompt = fn(initial.generateQuietPrompt);
  if (generateQuietPrompt !== undefined) {
    const generateRaw = fn(initial.generateRaw);
    const execute = async (request: GenerationRequest): Promise<GenerationResult> => {
      const context = getContext();
      const result = request.contextMode === 'isolated'
        ? await (() => {
          if (generateRaw === undefined) throw new Error('SillyTavern isolated generation is unavailable');
          return generateRaw.call(context, {
            prompt: request.prompt,
            ...(request.jsonSchema === undefined ? {} : { jsonSchema: request.jsonSchema }),
          });
        })()
        : await generateQuietPrompt.call(context, {
          quietPrompt: request.prompt,
          ...(request.jsonSchema === undefined ? {} : { jsonSchema: request.jsonSchema }),
        });
      const selected = generationSelection(getContext());
      return { text: String(result ?? ''), ...(selected.provider === undefined ? {} : { provider: selected.provider }), ...(selected.model === undefined ? {} : { model: selected.model }) };
    };
    capabilities.push('tavern.generation.read', 'tavern.generation.execute');
    adapter.generation = { available: async () => generationSelection(getContext()).connected, models: async () => { const model = generationSelection(getContext()).model; return model === undefined ? [] : [model]; }, current: async (): Promise<GenerationSnapshot> => generationSnapshot(getContext()), generate: execute, test: execute };
  }

  const loadWorldInfo = fn(initial.loadWorldInfo);
  const saveWorldInfo = fn(initial.saveWorldInfo);
  const updateWorldInfoList = fn(initial.updateWorldInfoList);
  const executeSlash = fn(initial.executeSlashCommandsWithOptions);
  const requestHeaders = fn(initial.getRequestHeaders) ?? fn(root.getRequestHeaders);
  if (loadWorldInfo !== undefined && executeSlash !== undefined && requestHeaders !== undefined && typeof target.fetch === 'function') {
    const names = async (): Promise<readonly { readonly id: string; readonly name: string }[]> => {
      const response = await target.fetch('/api/worldinfo/list', { method: 'POST', headers: requestHeaders() as HeadersInit, body: '{}' });
      if (!response.ok) throw new Error('worldbook list unavailable');
      const data: unknown = await response.json();
      return Array.isArray(data) ? data.flatMap((item) => {
        const value = record(item);
        const id = text(value?.file_id) ?? text(value?.name);
        return id === undefined ? [] : [{ id, name: text(value?.name) ?? id }];
      }) : [];
    };
    const activeNames = async (): Promise<readonly string[]> => {
      const result = record(await executeSlash.call(getContext(), '/getglobalbooks'));
      if (result?.isError === true) throw new Error('worldbook activation query failed');
      try { const value: unknown = JSON.parse(typeof result?.pipe === 'string' ? result.pipe : '[]'); return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : []; } catch { throw new Error('worldbook activation query failed'); }
    };
    const loadSnapshot = async (id: string, displayName = id, active?: readonly string[]): Promise<WorldbookSnapshot | null> => {
      const raw = await loadWorldInfo.call(getContext(), id);
      const selected = active ?? await activeNames();
      return raw === null || raw === undefined ? null : { ...worldbookSnapshot(getContext(), id, raw, selected.includes(id)), name: displayName };
    };
    adapter.worldbooks = {
      list: async () => { const selected = await activeNames(); return (await Promise.all((await names()).map((book) => loadSnapshot(book.id, book.name, selected)))).filter((value): value is WorldbookSnapshot => value !== null); },
      load: (id) => loadSnapshot(id),
      active: async () => { const selected = await activeNames(); return (await Promise.all(selected.map((id) => loadSnapshot(id, id, selected)))).filter((value): value is WorldbookSnapshot => value !== null); },
      save: async (snapshot) => {
        if (saveWorldInfo === undefined) throw new Error('worldbook save unavailable');
        const current = await loadWorldInfo.call(getContext(), snapshot.id);
        await saveWorldInfo.call(getContext(), snapshot.id, worldbookData(snapshot, current), true);
        await updateWorldInfoList?.call(getContext());
      },
      delete: async (name) => {
        const deactivate = record(await executeSlash.call(getContext(), `/world state=off silent=true ${JSON.stringify(name)}`));
        if (deactivate?.isError === true) throw new Error('worldbook deactivation failed');
        const response = await target.fetch('/api/worldinfo/delete', { method: 'POST', headers: requestHeaders() as HeadersInit, body: JSON.stringify({ name }) });
        if (!response.ok) throw new Error('worldbook delete failed');
        await updateWorldInfoList?.call(getContext());
      },
      setActive: async (name, active) => {
        const result = record(await executeSlash.call(getContext(), `/world state=${active ? 'on' : 'off'} silent=true ${JSON.stringify(name)}`));
        if (result?.isError === true) throw new Error('worldbook activation failed');
      },
    };
    capabilities.push('tavern.worldbooks.read');
    if (saveWorldInfo !== undefined && updateWorldInfoList !== undefined) capabilities.push('tavern.worldbooks.write');
  }

  return Object.freeze({ capabilities: Object.freeze([...new Set(capabilities)]), hostAdapter: Object.freeze(adapter) });
}
