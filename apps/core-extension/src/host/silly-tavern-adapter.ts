import { PLUGIN_BINARY_CONTENT_TYPE, PLUGIN_BINARY_MAX_BYTES, createSSHelperError, readSSHelperFailure } from '@ss-helper/sdk';
import type {
  ChatMessageInput, ChatMessageSnapshot, ChatMessageType, ChatSnapshot, ChatNavigationTarget, GenerationRequest, GenerationResult, GenerationSnapshot, GenerationChunk, GenerationTaskStatusSnapshot,
  HostCapability, HostCharacterSnapshot, HostContextSnapshot, HostEvent, HostEventName, HostMessageAuthorSnapshot,
  HostIdentitySnapshot, HostPersonaSnapshot, MessageVariablesSnapshot, PlainData, PluginApiRequest, PluginApiResponse, PluginRequestOptions,
  PluginBinaryBodyV0, PluginBinaryRequestV0, PluginBinaryResponseV0, PluginJsonAcknowledgementV0,
  PromptContribution, WorldbookSnapshot,
} from '@ss-helper/sdk';
import type { TavernHostAdapter } from './tavern-host-port.js';

type UnknownRecord = Record<string, unknown>;
type HostFunction = (...args: unknown[]) => unknown;
const record = (value: unknown): UnknownRecord | undefined => typeof value === 'object' && value !== null ? value as UnknownRecord : undefined;
const fn = (value: unknown): HostFunction | undefined => typeof value === 'function' ? value as HostFunction : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined;

const RESPONSE_FORMAT_PROVIDER_CODES = new Set([
  'response_format_unsupported',
  'unsupported_response_format',
  'response_format_unavailable',
]);
const structuredProviderFailures = (error: unknown): UnknownRecord[] => {
  const root = record(error);
  const cause = record(root?.cause);
  return [
    root,
    record(root?.details),
    record(root?.error),
    cause,
    record(cause?.details),
    record(cause?.error),
  ].filter((value): value is UnknownRecord => value !== undefined);
};
const responseFormatFailureContext = (error: unknown): {
  readonly httpStatus?: number;
  readonly providerErrorCode?: string;
  readonly providerErrorType?: string;
  readonly providerErrorParam?: string;
} | undefined => {
  const root = record(error);
  const rootStatus = root?.httpStatus ?? root?.status ?? root?.statusCode;
  for (const value of structuredProviderFailures(error)) {
    const providerErrorCode = text(value.providerErrorCode) ?? text(value.code);
    const providerErrorType = text(value.providerErrorType) ?? text(value.type);
    const providerErrorParam = text(value.providerErrorParam) ?? text(value.param);
    const normalizedCode = providerErrorCode?.toLowerCase();
    const normalizedType = providerErrorType?.toLowerCase();
    const normalizedParam = providerErrorParam?.toLowerCase();
    const explicitlyNamesFormat = normalizedParam === 'response_format'
      || normalizedParam?.startsWith('response_format.') === true
      || (normalizedCode !== undefined && RESPONSE_FORMAT_PROVIDER_CODES.has(normalizedCode))
      || (normalizedType !== undefined && RESPONSE_FORMAT_PROVIDER_CODES.has(normalizedType));
    if (!explicitlyNamesFormat) continue;
    const status = value.httpStatus ?? value.status ?? value.statusCode ?? rootStatus;
    const httpStatus = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : undefined;
    return {
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(providerErrorCode === undefined ? {} : { providerErrorCode }),
      ...(providerErrorType === undefined ? {} : { providerErrorType }),
      ...(providerErrorParam === undefined ? {} : { providerErrorParam }),
    };
  }
  return undefined;
};

const mapGenerationFailure = (error: unknown): unknown => {
  if (readSSHelperFailure(error)?.reasonCode === 'RESPONSE_FORMAT_UNSUPPORTED') return error;
  const context = responseFormatFailureContext(error);
  return context === undefined ? error : createSSHelperError('RESPONSE_FORMAT_UNSUPPORTED', {
    stage: 'host.generation.response-format',
    providerKind: 'tavern',
    ...context,
  });
};
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
const generationSelection = (context: UnknownRecord): { readonly provider?: string; readonly model?: string; readonly mainApi?: string; readonly toolCallingSupported?: boolean; readonly connected: boolean } => {
  const mainApi = text(context.mainApi) ?? text(context.main_api);
  const onlineStatus = text(context.onlineStatus) ?? text(context.online_status);
  const connected = onlineStatus !== undefined && onlineStatus !== 'no_connection';
  const chatCompletionSettings = record(context.chatCompletionSettings) ?? record(context.chat_completion_settings);
  if (mainApi === 'openai' && chatCompletionSettings !== undefined) {
    const provider = text(chatCompletionSettings.chat_completion_source) ?? mainApi;
    const modelKey = provider === 'makersuite' ? 'google_model' : `${provider}_model`;
    const model = text(chatCompletionSettings[modelKey]);
    const toolCheck = typeof context.isToolCallingSupported === 'function' ? context.isToolCallingSupported : undefined;
    let toolCallingSupported: boolean | undefined;
    try { toolCallingSupported = toolCheck === undefined ? undefined : Boolean(toolCheck.call(context, chatCompletionSettings, model)); } catch { toolCallingSupported = undefined; }
    return { connected, ...(mainApi === undefined ? {} : { mainApi }), ...(provider === undefined ? {} : { provider }), ...(model === undefined ? {} : { model }), ...(toolCallingSupported === undefined ? {} : { toolCallingSupported }) };
  }
  const model = mainApi === 'kobold' || mainApi === 'textgenerationwebui' || (mainApi === 'openai' && chatCompletionSettings === undefined)
    ? onlineStatus
    : undefined;
  return { connected, ...(mainApi === undefined ? {} : { mainApi, provider: mainApi }), ...(model === undefined || !connected ? {} : { model }) };
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
const assertBinaryBody = async (body: PluginBinaryBodyV0): Promise<Uint8Array<ArrayBuffer>> => {
  const bytes = decodeBase64(body.data);
  if (body.contentType !== PLUGIN_BINARY_CONTENT_TYPE || bytes.byteLength !== body.byteLength || bytes.byteLength > PLUGIN_BINARY_MAX_BYTES || await binarySha256(bytes) !== body.sha256) {
    throw new Error('invalid binary request body');
  }
  return bytes;
};
const jsonAcknowledgement = (value: unknown): PluginJsonAcknowledgementV0 => {
  const acknowledgement = retainedPlain(value);
  const item = record(acknowledgement);
  if (item === undefined || Object.keys(item).length !== 2 || item.ok !== true || !Object.hasOwn(item, 'data')) {
    throw new Error('invalid JSON acknowledgement');
  }
  return acknowledgement as unknown as PluginJsonAcknowledgementV0;
};
const message = (value: unknown, index: number): ChatMessageSnapshot => {
  const item = record(value) ?? {};
  const extra = record(item.extra);
  const variables = messageVariables(item.variables);
  // SillyTavern overloads `is_system`: `/hide` sets it on ordinary user and
  // assistant floors. Treat only explicit/native system provenance as a system
  // message; the generic flag below remains a prompt-visibility signal.
  const isSystem = item.role === 'system'
    || item.messageType === 'system'
    || extra?.type === 'system'
    || text(item.name) === 'SillyTavern System'
    || extra?.uses_system_ui === true
    || extra?.isSmallSys === true;
  const isTool = item.role === 'tool' || extra?.type === 'tool';
  const isReasoning = item.is_reasoning === true;
  const isHidden = item.is_system === true || item.is_hidden === true || item.hidden === true || extra?.hidden === true;
  // Tool/reasoning provenance wins over a generic system marker so internal
  // outputs can never become opt-in historical正文 by accident.
  const isNarrator = item.messageType === 'narrator' || item.role === 'narrator' || extra?.type === 'narrator' || item.is_narrator === true;
  const messageType: ChatMessageType = isTool ? 'tool' : isReasoning ? 'reasoning' : isNarrator ? 'narrator' : isSystem ? 'system' : 'conversation';
  const visibleToAi = !(isSystem || isTool || isReasoning || isHidden);
  const author: HostMessageAuthorSnapshot = {
    kind: messageType === 'narrator' ? 'narrator' : isSystem ? 'system' : item.is_user === true ? 'user' : 'assistant',
    ...(text(item.name) === undefined ? {} : { displayName: text(item.name) }),
    ...(text(item.avatar) === undefined ? {} : { avatar: text(item.avatar) }),
    ...(text(item.original_avatar) === undefined ? {} : { originalAvatar: text(item.original_avatar) }),
  };
  const stableId = text(item.id) ?? text(item.messageId);
  const rawVariantId = item.swipe_id ?? item.swipeId ?? item.variantId;
  const variantId = typeof rawVariantId === 'string' || typeof rawVariantId === 'number'
    ? String(rawVariantId).trim()
    : '';
  return {
    id: stableId ?? String(index), index,
    ...(stableId === undefined ? {} : { stableId }),
    ...(variantId === '' ? {} : { variantId }),
    role: messageType === 'system' ? 'system' : item.is_user === true ? 'user' : 'assistant',
    ...(text(item.name) === undefined ? {} : { name: text(item.name) }), text: text(item.mes) ?? text(item.text) ?? '',
    ...(text(item.send_date) === undefined ? {} : { createdAt: text(item.send_date) }),
    ...(variables === undefined ? {} : { variables }),
    ...(messageType === 'conversation' ? {} : { messageType }),
    ...(visibleToAi ? {} : { visibleToAi: false }),
    author,
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

function navigationIndex(target: ChatNavigationTarget): number | undefined {
  if (target.index === undefined) return undefined;
  return Number.isSafeInteger(target.index) && target.index >= 0 ? target.index : undefined;
}

function navigationId(target: ChatNavigationTarget): string | undefined {
  if (target.messageId === undefined) return undefined;
  const value = String(target.messageId).trim();
  return value.length > 0 && value.length <= 256 ? value : undefined;
}

function messageElementMatches(element: Element, target: ChatNavigationTarget): boolean {
  const id = navigationId(target);
  const index = navigationIndex(target);
  if (id === undefined && index === undefined) return false;
  const candidates = [
    element.getAttribute('mesid'),
    element.getAttribute('data-mesid'),
    element.getAttribute('data-message-id'),
    element.id,
  ].filter((value): value is string => Boolean(value));
  if (id !== undefined && candidates.includes(id)) return true;
  if (index !== undefined) {
    const rawIndex = candidates.find((value) => /^\d+$/u.test(value));
    if (rawIndex !== undefined && Number(rawIndex) === index) return true;
    const position = Number((element as HTMLElement).dataset.messageIndex ?? (element as HTMLElement).dataset.index);
    if (Number.isSafeInteger(position) && position === index) return true;
  }
  return false;
}

async function navigateToMessage(target: typeof globalThis, destination: ChatNavigationTarget): Promise<void> {
  const messageId = navigationId(destination);
  const index = navigationIndex(destination);
  if (messageId === undefined && index === undefined) throw new Error('message target unavailable');
  const document = (target as typeof globalThis & { document?: Document }).document;
  if (!document) throw new Error('message navigation unavailable');
  const find = (): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('#chat .mes')].find((element) => messageElementMatches(element, { messageId, index }));
  let element = find();
  // Tavern virtualizes older floors behind this control. Ask it to reveal a
  // bounded number of older messages, yielding between clicks so the DOM can
  // settle before the next lookup.
  for (let attempt = 0; !element && attempt < 20; attempt += 1) {
    const more = document.querySelector<HTMLElement>('#show_more_messages');
    if (!more || more.hidden || more.getAttribute('aria-hidden') === 'true') break;
    more.click();
    await new Promise<void>((resolve) => (target.setTimeout ?? setTimeout)(resolve, 0));
    element = find();
  }
  if (!element) throw new Error('message unavailable');
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.classList.remove('ss-helper-chat-navigation-target');
  element.classList.add('ss-helper-chat-navigation-target');
  const previousOutline = element.style.outline;
  const previousOutlineOffset = element.style.outlineOffset;
  const previousBoxShadow = element.style.boxShadow;
  element.style.outline = '2px solid color-mix(in srgb, var(--SmartThemeEmColor, #f0b84b) 88%, transparent)';
  element.style.outlineOffset = '3px';
  element.style.boxShadow = '0 0 0 6px color-mix(in srgb, var(--SmartThemeEmColor, #f0b84b) 18%, transparent)';
  (target.setTimeout ?? setTimeout)(() => {
    element?.classList.remove('ss-helper-chat-navigation-target');
    if (element) {
      element.style.outline = previousOutline;
      element.style.outlineOffset = previousOutlineOffset;
      element.style.boxShadow = previousBoxShadow;
    }
  }, 1800);
}
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
  if (name === 'message-deleted') return { name, messageId: id, ...(key === undefined ? {} : { chatKey: key }), ...(index === undefined ? {} : { remainingCount: index }) };
  const snapshot = raw === undefined ? undefined : message(raw, index ?? 0);
  return { name, messageId: id, ...(key === undefined ? {} : { chatKey: key }), ...(snapshot === undefined ? {} : { message: snapshot }) };
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
const swipeDeletedEvent = (context: UnknownRecord, payload: unknown): HostEvent | undefined => {
  const item = record(payload);
  const messageIndex = integer(item?.messageId);
  const deletedVariant = integer(item?.swipeId) ?? text(item?.swipeId);
  const activeVariant = integer(item?.newSwipeId) ?? text(item?.newSwipeId);
  if (messageIndex === undefined || deletedVariant === undefined || activeVariant === undefined) return undefined;
  const list = Array.isArray(context.chat) ? context.chat : [];
  const snapshot = list[messageIndex] === undefined ? undefined : message(list[messageIndex], messageIndex);
  const key = chatKey(context);
  return {
    name: 'message-swipe-deleted',
    messageId: snapshot?.stableId ?? String(messageIndex),
    messageIndex,
    deletedVariantId: String(deletedVariant),
    activeVariantId: String(activeVariant),
    ...(key === undefined ? {} : { chatKey: key }),
  };
};
const finalizedPromptEvent = (context: UnknownRecord, payload: unknown, source: 'chat' | 'text'): HostEvent | undefined => {
  const value = record(payload) ?? {};
  if (value.dryRun === true) return undefined;
  const key = chatKey(context);
  if (source === 'text') {
    const prompt = text(value.prompt) ?? (typeof payload === 'string' ? payload : undefined);
    return prompt === undefined ? undefined : { name: 'prompt-finalized', ...(key === undefined ? {} : { chatKey: key }), prompt: { kind: 'text', prompt } };
  }
  const rawMessages = Array.isArray(value.chat) ? value.chat : Array.isArray(value.messages) ? value.messages : [];
  if (rawMessages.length === 0) return undefined;
  const messages = rawMessages.map((entry) => {
    const item = record(entry) ?? {};
    const content = plain(item.content);
    return { ...(text(item.role) === undefined ? {} : { role: text(item.role) }), ...(text(item.name) === undefined ? {} : { name: text(item.name) }), ...(content === undefined ? {} : { content }) };
  });
  return { name: 'prompt-finalized', ...(key === undefined ? {} : { chatKey: key }), prompt: { kind: 'chat', messages } };
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
      navigate: async (destination) => navigateToMessage(target, destination),
    };
    capabilities.push('tavern.chat.navigate');
    if (fn(initial.addOneMessage) !== undefined && fn(initial.saveChat) !== undefined && fn(initial.deleteMessage) !== undefined) capabilities.push('tavern.chat.write');
  }

  const eventSource = record(initial.eventSource) ?? record(root.eventSource);
  const eventTypes = record(initial.eventTypes) ?? record(initial.event_types) ?? record(root.eventTypes) ?? record(root.event_types) ?? {};
  const on = fn(eventSource?.on); const off = fn(eventSource?.off) ?? fn(eventSource?.removeListener);
  if (eventSource !== undefined && on !== undefined && off !== undefined) {
    capabilities.push('tavern.chat.events');
    const names: Record<HostEventName, string> = { 'chat-changed': 'CHAT_CHANGED', 'message-received': 'MESSAGE_RECEIVED', 'message-sent': 'MESSAGE_SENT', 'message-edited': 'MESSAGE_EDITED', 'message-deleted': 'MESSAGE_DELETED', 'message-swiped': 'MESSAGE_SWIPED', 'message-swipe-deleted': 'MESSAGE_SWIPE_DELETED', 'generation-started': 'GENERATION_STARTED', 'generation-ended': 'GENERATION_ENDED', 'generation-config-changed': 'GENERATION_CONFIG_CHANGED', 'prompt-ready': 'CHAT_COMPLETION_PROMPT_READY', 'prompt-finalized': 'CHAT_COMPLETION_PROMPT_READY', 'worldbook-updated': 'WORLDINFO_UPDATED', 'identity-changed': 'CHARACTER_EDITED' };
    adapter.events = { subscribe: (name, listener) => {
      let active = true;
      if (name === 'message-deleted') {
        const currentChat = (): unknown[] => { const value = getContext().chat; return Array.isArray(value) ? [...value] : []; };
        let previous = currentChat();
        const subscriptions: Array<{ hostName: string; callback: (...args: unknown[]) => void | Promise<void> }> = [];
        const attach = (key: string, callback: (...args: unknown[]) => void | Promise<void>): void => {
          const hostName = text(eventTypes[key]) ?? key;
          on.call(eventSource, hostName, callback);
          subscriptions.push({ hostName, callback });
        };
        const sync = (): void => { if (active) previous = currentChat(); };
        for (const key of ['CHAT_CHANGED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED']) attach(key, sync);
        attach('MESSAGE_DELETED', async (payload: unknown) => {
          if (!active) return;
          const context = getContext();
          const current = Array.isArray(context.chat) ? [...context.chat] : [];
          const deletedCount = previous.length - current.length;
          let fromIndex: number | undefined;
          if (deletedCount > 0) {
            const firstDifference = current.findIndex((item, index) => previous[index] !== item);
            const candidate = firstDifference < 0 ? current.length : firstDifference;
            const aligned = current.every((item, index) => previous[index < candidate ? index : index + deletedCount] === item);
            if (aligned) fromIndex = candidate;
          }
          previous = current;
          const base = messageEvent(name, context, payload);
          if (base.name !== 'message-deleted') return;
          await listener(fromIndex === undefined ? base : { ...base, fromIndex, deletedCount });
        });
        return () => { active = false; subscriptions.forEach(({ hostName, callback }) => off.call(eventSource, hostName, callback)); };
      }
      const primaryKeys = name === 'generation-config-changed' ? ['MAIN_API_CHANGED', 'ONLINE_STATUS_CHANGED']
        : name === 'prompt-finalized' ? ['CHAT_COMPLETION_PROMPT_READY', 'GENERATE_AFTER_COMBINE_PROMPTS'] : [names[name]];
      const optionalKeys = name === 'generation-config-changed'
        ? ['CHATCOMPLETION_SOURCE_CHANGED', 'CHATCOMPLETION_MODEL_CHANGED', 'CONNECTION_PROFILE_LOADED', 'CONNECTION_PROFILE_UPDATED', 'CONNECTION_PROFILE_DELETED']
        : name === 'identity-changed' ? ['PERSONA_CHANGED', 'PERSONA_UPDATED', 'PERSONA_RENAMED', 'PERSONA_DELETED', 'GROUP_UPDATED'] : [];
      const keys = [...primaryKeys, ...optionalKeys.filter((key) => text(eventTypes[key]) !== undefined)];
      const subscriptions = [...new Set(keys.map((key) => `${key}\u0000${String(eventTypes[key] ?? key)}`))].map((entry) => {
        const [key, hostName] = entry.split('\u0000', 2) as [string, string];
        const callback = async (...args: unknown[]): Promise<void> => {
        if (!active) return;
        const context = getContext();
        if (name === 'chat-changed') await listener({ name, chatKey: text(args[0]) ?? chatKey(context) ?? '' });
        else if (name === 'message-received' || name === 'message-sent' || name === 'message-edited') await listener(messageEvent(name, context, args[0]));
        else if (name === 'message-swiped') {
          const event = messageEvent('message-edited', context, args[0]);
          if (event.name === 'message-edited') await listener({ ...event, name: 'message-swiped' });
        }
        else if (name === 'message-swipe-deleted') { const event = swipeDeletedEvent(context, args[0]); if (event !== undefined) await listener(event); }
        else if (name === 'generation-started' || name === 'generation-ended' || name === 'generation-config-changed') await listener(generationEvent(name, context, args));
        else if (name === 'prompt-ready') await listener(promptEvent(context, args[0]));
        else if (name === 'prompt-finalized') {
          const source = key === 'GENERATE_AFTER_COMBINE_PROMPTS' ? 'text' : 'chat';
          setTimeout(() => {
            if (!active) return;
            const event = finalizedPromptEvent(getContext(), args[0], source);
            if (event !== undefined) listener(event);
          }, 0);
        }
        else if (name === 'worldbook-updated') await listener(worldbookEvent(context, args[0], args[1]));
        else { const detail = key === 'CHARACTER_EDITED' ? record(record(args[0])?.detail) : undefined; await listener({ name, identity: identity(context, detail?.id) }); }
        };
        on.call(eventSource, hostName, callback);
        return { hostName, callback };
      });
      return () => { active = false; subscriptions.forEach(({ hostName, callback }) => off.call(eventSource, hostName, callback)); };
    } };
  }

  const setPrompt = fn(initial.setExtensionPrompt) ?? fn(root.setExtensionPrompt);
  if (setPrompt !== undefined) { capabilities.push('tavern.prompt.contribute'); adapter.prompt = { set: async (value: PromptContribution) => { setPrompt(value.id, value.content, value.position ?? 0, value.depth ?? 0, value.scan ?? false); }, remove: async (id) => { setPrompt(id, '', 0, 0, false); } }; }
  const headers = fn(initial.getRequestHeaders) ?? fn(root.getRequestHeaders);
  if (headers !== undefined && typeof target.fetch === 'function') {
    capabilities.push('tavern.plugin.request', 'tavern.plugin.binary-request.v0');
    adapter.request = { send: async (request: PluginApiRequest, options?: PluginRequestOptions): Promise<PluginApiResponse> => { if (!request.path.startsWith('/') || request.path.startsWith('//') || request.path.includes('://')) throw new Error('relative same-origin path required'); const url = new URL(request.path, target.location?.origin ?? 'http://localhost'); if (target.location?.origin !== undefined && url.origin !== target.location.origin) throw new Error('cross-origin request denied'); for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, String(value)); const response = await target.fetch(url, { method: request.method ?? 'GET', headers: headers() as HeadersInit, ...(options?.signal === undefined ? {} : { signal: options.signal }), ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }) }); const contentType = response.headers.get('content-type') ?? ''; const body = response.status === 204 ? undefined : plain(contentType.includes('json') ? await response.json() : await response.text()); return { status: response.status, ok: response.ok, ...(body === undefined ? {} : { body }) }; } };
    adapter.binaryRequest = { send: async (request: PluginBinaryRequestV0, options): Promise<PluginBinaryResponseV0> => {
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
        return { version: 0, mode: 'json', status: response.status, ok: response.ok, body: jsonAcknowledgement(await response.json()) };
      }
      if (contentType !== PLUGIN_BINARY_CONTENT_TYPE) throw new Error('unsupported binary response content type');
      const declaredLength = response.headers.get('content-length');
      if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > PLUGIN_BINARY_MAX_BYTES)) throw new Error('invalid binary response length');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > PLUGIN_BINARY_MAX_BYTES || (declaredLength !== null && Number(declaredLength) !== buffer.byteLength)) throw new Error('binary response length mismatch');
      const bytes = new Uint8Array(buffer);
      const filename = safeFilename(response.headers.get('content-disposition'));
      return {
        version: 0, mode: 'binary', status: response.status, ok: response.ok, encoding: 'base64', contentType: PLUGIN_BINARY_CONTENT_TYPE,
        data: encodeBase64(bytes), byteLength: bytes.byteLength, sha256: await binarySha256(bytes),
        ...(filename === undefined ? {} : { filename }),
      };
    } };
  }

  const generateQuietPrompt = fn(initial.generateQuietPrompt);
  if (generateQuietPrompt !== undefined) {
    const generateRaw = fn(initial.generateRaw);
    const chatCompletionService = initial.ChatCompletionService as { readonly presetToGeneratePayload?: unknown } | undefined;
    const presetToGeneratePayload = chatCompletionService !== undefined && typeof chatCompletionService.presetToGeneratePayload === 'function'
      ? chatCompletionService.presetToGeneratePayload as (preset: unknown, overridePreset: unknown, overridePayload: UnknownRecord) => Promise<UnknownRecord>
      : undefined;
    const requestHeaders = fn(initial.getRequestHeaders) ?? fn(root.getRequestHeaders);
    const nextTaskId = (() => {
      let sequence = 0;
      return (): string => {
        try {
          if (typeof globalThis.crypto?.randomUUID === 'function') return `task-${globalThis.crypto.randomUUID()}`;
        } catch { /* Fall through to the monotonic local fallback. */ }
        sequence += 1;
        return `task-${Date.now()}-${sequence}`;
      };
    })();
    const connectionRevision = (selected: ReturnType<typeof generationSelection>): string => JSON.stringify({
      connected: selected.connected,
      provider: selected.provider,
      model: selected.model,
      mainApi: selected.mainApi,
      toolCallingSupported: selected.toolCallingSupported,
    });
    const streamChatCompletion = async (request: GenerationRequest, taskId: string, onChunk?: (chunk: GenerationChunk) => void | Promise<void>): Promise<GenerationResult> => {
      if (presetToGeneratePayload === undefined || requestHeaders === undefined || typeof target.fetch !== 'function') throw new Error('SillyTavern chat completion transport is unavailable');
      request.signal?.throwIfAborted();
      const context = getContext();
      const messages = request.messages ?? [{ role: 'user' as const, content: request.prompt ?? '' }];
      const reasoningOverride = request.reasoning === undefined ? {} : {
        ...(request.reasoning.mode === 'provider_default' ? {} : { include_reasoning: request.reasoning.mode === 'enabled' }),
        ...(request.reasoning.effort === 'provider_default' ? {} : { reasoning_effort: request.reasoning.effort === 'minimal' ? 'min' : request.reasoning.effort === 'xhigh' ? 'max' : request.reasoning.effort }),
      };
      const payload = await presetToGeneratePayload({}, {}, {
        messages,
        model: request.model,
        stream: request.stream === true,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        tools: request.tools,
        tool_choice: request.toolChoice,
        json_schema: request.jsonSchema,
        ...reasoningOverride,
      });
      const response = await target.fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: requestHeaders() as HeadersInit,
        body: JSON.stringify(payload),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      if (!response.ok) throw new Error(`SillyTavern generation failed (${response.status})`);
      if (request.stream !== true) {
        const data = plain(await response.json()) ?? null;
        const choices = record(data)?.choices;
        const first = Array.isArray(choices) ? record(choices[0]) : undefined;
        const message = record(first?.message);
        const text = typeof message?.content === 'string' ? message.content : typeof first?.text === 'string' ? first.text : '';
        return { text, data, ...generationSelection(context) };
      }
      if (response.body === null) throw new Error('SillyTavern stream body unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      const consume = async (line: string): Promise<void> => {
        const value = line.match(/^data:\s*(.*)$/mu)?.[1];
        if (value === undefined || value === '[DONE]') return;
        let data: PlainData | undefined;
        try { data = plain(JSON.parse(value)); } catch {
          throw createSSHelperError('INVALID_JSON', { stage: 'host.generation.stream', providerKind: 'tavern' });
        }
        if (data === undefined) return;
        const choices = record(data)?.choices;
        const first = Array.isArray(choices) ? record(choices[0]) : undefined;
        const delta = record(first?.delta);
        if (typeof delta?.content === 'string') text += delta.content;
        await onChunk?.({ taskId, text, data, done: false, ...generationSelection(context) });
      };
      while (true) {
        request.signal?.throwIfAborted();
        const next = await reader.read();
        buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
        const lines = buffer.split(/\r?\n\r?\n/u);
        buffer = lines.pop() ?? '';
        for (const line of lines) await consume(line);
        if (next.done) break;
      }
      if (buffer.trim()) await consume(buffer);
      return { text, ...generationSelection(context) };
    };
    const execute = async (request: GenerationRequest, onChunk?: (chunk: GenerationChunk) => void | Promise<void>): Promise<GenerationResult> => {
      const context = getContext();
      let result: unknown;
      try {
        request.signal?.throwIfAborted();
        const selection = generationSelection(context);
        const hasReasoningOverride = request.reasoning !== undefined
          && (request.reasoning.mode !== 'provider_default' || request.reasoning.effort !== 'provider_default');
        if ((selection.mainApi === 'openai' || hasReasoningOverride) && (request.messages !== undefined || request.tools !== undefined || request.stream === true || hasReasoningOverride)) {
          return await streamChatCompletion(request, request.taskId ?? nextTaskId(), onChunk);
        }
        result = request.contextMode === 'isolated'
          ? await (() => {
            if (generateRaw === undefined) throw new Error('SillyTavern isolated generation is unavailable');
            return generateRaw.call(context, {
              prompt: request.prompt ?? request.messages?.map((message) => message.content).join('\n') ?? '',
              ...(request.jsonSchema === undefined ? {} : { jsonSchema: request.jsonSchema }),
            });
          })()
          : await generateQuietPrompt.call(context, {
            quietPrompt: request.prompt ?? request.messages?.map((message) => message.content).join('\n') ?? '',
            ...(request.jsonSchema === undefined ? {} : { jsonSchema: request.jsonSchema }),
          });
        request.signal?.throwIfAborted();
      } catch (error) {
        if (request.signal?.aborted) throw createSSHelperError('REQUEST_ABORTED', { stage: 'host.generation.execute', providerKind: 'tavern' });
        throw mapGenerationFailure(error);
      }
      const selected = generationSelection(getContext());
      return { text: String(result ?? ''), ...(selected.provider === undefined ? {} : { provider: selected.provider }), ...(selected.model === undefined ? {} : { model: selected.model }) };
    };
    capabilities.push('tavern.generation.read', 'tavern.generation.execute');
    const taskStates = new Map<string, GenerationTaskStatusSnapshot>();
    const activeControllers = new Map<string, AbortController>();
    const executeTask = async (request: GenerationRequest, onChunk?: (chunk: GenerationChunk) => void | Promise<void>): Promise<GenerationResult> => {
      const taskId = request.taskId ?? nextTaskId();
      if (taskStates.has(taskId) || activeControllers.has(taskId)) {
        throw createSSHelperError('LLM_GENERATION_TASK_CONFLICT', { stage: 'host.generation.task-id', providerKind: 'tavern' });
      }
      const controller = new AbortController();
      const forwardAbort = () => controller.abort();
      request.signal?.addEventListener('abort', forwardAbort, { once: true });
      activeControllers.set(taskId, controller);
      taskStates.set(taskId, { taskId, status: 'running' });
      let deliveredDone = false;
      try {
        const result = await execute({ ...request, taskId, signal: controller.signal }, async (chunk) => {
          deliveredDone ||= chunk.done === true;
          if (!chunk.done) taskStates.set(taskId, { taskId, status: 'streaming', ...(chunk.provider === undefined ? {} : { provider: chunk.provider }), ...(chunk.model === undefined ? {} : { model: chunk.model }) });
          await onChunk?.(chunk);
        });
        controller.signal.throwIfAborted();
        if (onChunk && !deliveredDone) await onChunk({ taskId, text: result.text, done: true, ...(result.provider === undefined ? {} : { provider: result.provider }), ...(result.model === undefined ? {} : { model: result.model }) });
        taskStates.set(taskId, { taskId, status: 'completed', ...(result.provider === undefined ? {} : { provider: result.provider }), ...(result.model === undefined ? {} : { model: result.model }) });
        return result;
      } catch (error) {
        const cancelled = controller.signal.aborted || request.signal?.aborted;
        const failureError = cancelled ? createSSHelperError('REQUEST_ABORTED', { stage: 'host.generation.execute', providerKind: 'tavern' }) : error;
        const failure = readSSHelperFailure(failureError);
        taskStates.set(taskId, { taskId, status: cancelled ? 'cancelled' : 'failed', ...(failure === undefined ? {} : { failure }) });
        throw failureError;
      } finally {
        if (activeControllers.get(taskId) === controller) activeControllers.delete(taskId);
        request.signal?.removeEventListener('abort', forwardAbort);
      }
    };
    adapter.generation = {
      available: async () => generationSelection(getContext()).connected,
      models: async () => { const model = generationSelection(getContext()).model; return model === undefined ? [] : [model]; },
      current: async (): Promise<GenerationSnapshot> => generationSnapshot(getContext()),
      inspect: async (taskId?: string): Promise<GenerationTaskStatusSnapshot> => {
        const selected = generationSelection(getContext());
        const previous = taskStates.get(taskId ?? '');
        return {
          ...(previous ?? { taskId: taskId ?? 'current', status: 'queued' as const }),
          ...(selected.provider === undefined ? {} : { provider: selected.provider }),
          ...(selected.model === undefined ? {} : { model: selected.model }),
          ...(selected.mainApi === undefined ? {} : { mainApi: selected.mainApi }),
          ...(selected.toolCallingSupported === undefined ? {} : { toolCallingSupported: selected.toolCallingSupported }),
          available: selected.connected,
          connectionRevision: connectionRevision(selected),
        };
      },
      generate: execute,
      test: execute,
      execute: executeTask,
      cancel: async (taskId: string) => {
        const controller = activeControllers.get(taskId);
        if (controller === undefined) return;
        controller.abort();
        const failure = readSSHelperFailure(createSSHelperError('REQUEST_ABORTED', { stage: 'host.generation.execute', providerKind: 'tavern' }));
        taskStates.set(taskId, { taskId, status: 'cancelled', ...(failure === undefined ? {} : { failure }) });
      },
    };
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
