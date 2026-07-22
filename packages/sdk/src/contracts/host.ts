import type { PlainData } from './plain-data.js';

export type HostCapability =
  | 'core.ui.notification.v0'
  | 'tavern.context.read'
  | 'tavern.identity.read'
  | 'tavern.character.read'
  | 'tavern.persona.read'
  | 'tavern.chat.read'
  | 'tavern.chat.list'
  | 'tavern.chat.write'
  | 'tavern.chat.navigate'
  | 'tavern.chat.events'
  | 'tavern.worldbooks.read'
  | 'tavern.worldbooks.write'
  | 'tavern.generation.read'
  | 'tavern.generation.execute'
  | 'tavern.prompt.contribute'
  | 'tavern.plugin.request'
  | 'tavern.plugin.binary-request.v0'
  | 'tavern.metadata.write'
  | 'tavern.settings.write'
  | 'tavern.macros.execute'
  | 'tavern.systemMessage.write'
  /** Core-owned, destructive workspace recovery. Granted only to Memory. */
  | 'workspace.recovery'
  /** Encryption keys remain in the server workspace and are granted only to LLM. */
  | 'secrets.read'
  | 'secrets.write';

export interface HostIdentitySnapshot { readonly userId?: string | undefined; readonly userName?: string | undefined; readonly characterId?: string | undefined; readonly groupId?: string | undefined; }
export interface HostContextSnapshot { readonly chatId?: string | undefined; readonly chatKey?: string | undefined; readonly characterId?: string | undefined; readonly groupId?: string | undefined; }
export interface HostCharacterSnapshot { readonly id: string; readonly name: string; readonly avatar?: string | undefined; readonly description?: string | undefined; readonly personality?: string | undefined; readonly scenario?: string | undefined; readonly firstMessage?: string | undefined; readonly exampleMessages?: string | undefined; }
export interface HostPersonaSnapshot { readonly id?: string | undefined; readonly name: string; readonly avatar?: string | undefined; readonly description?: string | undefined; }
export type MessageVariableEntry = Readonly<Record<string, PlainData>>;
export type MessageVariablesSnapshot = MessageVariableEntry | readonly MessageVariableEntry[];
export type ChatMessageType = 'conversation' | 'system' | 'tool' | 'reasoning';
export interface ChatMessageSnapshot {
  readonly id: string;
  readonly index: number;
  readonly role: 'system' | 'user' | 'assistant';
  readonly name?: string | undefined;
  readonly text: string;
  readonly createdAt?: string | undefined;
  readonly variables?: MessageVariablesSnapshot;
  /** Optional provenance metadata; omitted by older hosts for ordinary messages. */
  readonly messageType?: ChatMessageType | undefined;
  readonly visibleToAi?: boolean | undefined;
}
export interface ChatSnapshot { readonly key: string; readonly id?: string | undefined; readonly name?: string | undefined; readonly messageCount: number; readonly messages?: readonly ChatMessageSnapshot[]; readonly variables?: Readonly<Record<string, PlainData>>; }
export interface ChatMessageInput { readonly role: 'system' | 'user' | 'assistant'; readonly text: string; readonly name?: string | undefined; readonly variables?: MessageVariablesSnapshot; }
/** Core-owned navigation target used by read-only UI references. */
export interface ChatNavigationTarget { readonly messageId?: string | undefined; readonly index?: number | undefined; }
export interface WorldbookEntrySnapshot { readonly id: string; readonly keys: readonly string[]; readonly secondaryKeys?: readonly string[]; readonly content: string; readonly enabled: boolean; readonly position?: number; readonly order?: number; }
export interface WorldbookSnapshot { readonly id: string; readonly name: string; readonly active: boolean; readonly entries?: readonly WorldbookEntrySnapshot[]; }
export interface GenerationUsageSnapshot { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number; }
export interface GenerationSnapshot { readonly active: boolean; readonly provider?: string | undefined; readonly model?: string | undefined; readonly usage?: GenerationUsageSnapshot; }
export interface GenerationJsonSchema { readonly name: string; readonly value: Readonly<Record<string, PlainData>>; readonly description?: string | undefined; readonly strict?: boolean; readonly returnInvalid?: boolean; }
export interface GenerationRequest { readonly prompt: string; readonly model?: string | undefined; readonly quiet?: boolean; readonly contextMode?: 'chat' | 'isolated' | undefined; readonly jsonSchema?: GenerationJsonSchema | undefined; }
export interface GenerationResult { readonly text: string; readonly provider?: string | undefined; readonly model?: string | undefined; readonly usage?: GenerationUsageSnapshot; }
export type HostEventName = 'chat-changed' | 'message-received' | 'message-sent' | 'message-edited' | 'message-deleted' | 'generation-started' | 'generation-ended' | 'generation-config-changed' | 'prompt-ready' | 'worldbook-updated' | 'identity-changed';
export interface PromptMessageSnapshot { readonly role?: string | undefined; readonly name?: string | undefined; readonly content?: PlainData; }
export interface PromptSnapshot { readonly messages: readonly PromptMessageSnapshot[]; readonly dryRun: boolean; }
export interface HostEventMap {
  readonly 'chat-changed': { readonly name: 'chat-changed'; readonly chatKey: string };
  readonly 'message-received': { readonly name: 'message-received'; readonly chatKey?: string | undefined; readonly messageId: string; readonly message?: ChatMessageSnapshot };
  readonly 'message-sent': { readonly name: 'message-sent'; readonly chatKey?: string | undefined; readonly messageId: string; readonly message?: ChatMessageSnapshot };
  readonly 'message-edited': { readonly name: 'message-edited'; readonly chatKey?: string | undefined; readonly messageId: string; readonly message?: ChatMessageSnapshot };
  readonly 'message-deleted': { readonly name: 'message-deleted'; readonly chatKey?: string | undefined; readonly messageId: string };
  readonly 'generation-started': { readonly name: 'generation-started'; readonly chatKey?: string | undefined; readonly generation: GenerationSnapshot };
  readonly 'generation-ended': { readonly name: 'generation-ended'; readonly chatKey?: string | undefined; readonly generation: GenerationSnapshot };
  readonly 'generation-config-changed': { readonly name: 'generation-config-changed'; readonly generation: GenerationSnapshot };
  readonly 'prompt-ready': { readonly name: 'prompt-ready'; readonly chatKey?: string | undefined; readonly prompt: PromptSnapshot };
  readonly 'worldbook-updated': { readonly name: 'worldbook-updated'; readonly worldbook: WorldbookSnapshot };
  readonly 'identity-changed': { readonly name: 'identity-changed'; readonly identity: HostIdentitySnapshot };
}
export type HostEvent = HostEventMap[HostEventName];
export interface PromptContribution { readonly id: string; readonly content: string; readonly position?: number; readonly depth?: number; readonly scan?: boolean; }
export type PluginRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface PluginApiRequest { readonly path: `/${string}`; readonly method?: PluginRequestMethod; readonly query?: Readonly<Record<string, string | number | boolean>>; readonly body?: PlainData; }
export interface PluginApiResponse { readonly status: number; readonly ok: boolean; readonly body?: PlainData; }
export const PLUGIN_BINARY_CONTENT_TYPE = 'application/vnd.sqlite3' as const;
export const PLUGIN_BINARY_MAX_BYTES = 64 * 1024 * 1024;
export interface PluginBinaryBodyV0 {
  readonly encoding: 'base64';
  readonly contentType: typeof PLUGIN_BINARY_CONTENT_TYPE;
  readonly data: string;
  readonly byteLength: number;
  readonly sha256: string;
}
export type PluginBinaryResponseModeV0 = 'binary' | 'json';
export interface PluginBinaryRequestV0<Mode extends PluginBinaryResponseModeV0 = PluginBinaryResponseModeV0> {
  readonly version: 0;
  readonly path: `/api/plugins/${string}`;
  readonly method: 'GET' | 'POST';
  readonly responseMode: Mode;
  readonly body?: PluginBinaryBodyV0;
}
export interface PluginBinaryBytesResponseV0 extends PluginBinaryBodyV0 {
  readonly version: 0;
  readonly mode: 'binary';
  readonly status: number;
  readonly ok: boolean;
  readonly filename?: string;
}
export interface PluginJsonAcknowledgementV0 {
  readonly ok: true;
  readonly data: PlainData;
}
export interface PluginBinaryJsonResponseV0 {
  readonly version: 0;
  readonly mode: 'json';
  readonly status: number;
  readonly ok: boolean;
  readonly body: PluginJsonAcknowledgementV0;
}
export type PluginBinaryResponseV0 = PluginBinaryBytesResponseV0 | PluginBinaryJsonResponseV0;
export type PluginBinaryResponseForModeV0<Mode extends PluginBinaryResponseModeV0> = Mode extends 'binary'
  ? PluginBinaryBytesResponseV0
  : PluginBinaryJsonResponseV0;
export interface PluginBinaryRequestOptions { readonly timeoutMs?: number; readonly signal?: AbortSignal; }

const binaryRecord = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const binaryExact = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean => {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => required.includes(key) || optional.includes(key));
};
const isCanonicalBase64 = (value: unknown, byteLength: unknown): value is string => {
  if (typeof value !== 'string' || !Number.isSafeInteger(byteLength) || (byteLength as number) < 0 || (byteLength as number) > PLUGIN_BINARY_MAX_BYTES
    || value.length > Math.ceil(PLUGIN_BINARY_MAX_BYTES / 3) * 4 || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return false;
  try {
    const decoded = atob(value);
    return decoded.length === byteLength && btoa(decoded) === value;
  } catch { return false; }
};
const isBinaryBody = (value: unknown): value is PluginBinaryBodyV0 => {
  const body = binaryRecord(value);
  return body !== undefined && binaryExact(body, ['encoding', 'contentType', 'data', 'byteLength', 'sha256'])
    && body.encoding === 'base64' && body.contentType === PLUGIN_BINARY_CONTENT_TYPE
    && isCanonicalBase64(body.data, body.byteLength) && typeof body.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(body.sha256);
};
const isBinaryPlainData = (value: unknown, seen = new Set<object>()): value is PlainData => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isBinaryPlainData(item, seen));
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value as Record<string, unknown>).every((item) => isBinaryPlainData(item, seen));
};
const isJsonAcknowledgement = (value: unknown): value is PluginJsonAcknowledgementV0 => {
  const acknowledgement = binaryRecord(value);
  return acknowledgement !== undefined && binaryExact(acknowledgement, ['ok', 'data'])
    && acknowledgement.ok === true && isBinaryPlainData(acknowledgement.data);
};
const isPluginApiPath = (value: unknown): value is `/api/plugins/${string}` => typeof value === 'string'
  && /^\/api\/plugins\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9._~-]+)*$/u.test(value)
  && value.split('/').every((segment) => segment !== '.' && segment !== '..');
export const isPluginBinaryRequestV0 = (value: unknown): value is PluginBinaryRequestV0 => {
  const request = binaryRecord(value);
  return request !== undefined && binaryExact(request, ['version', 'path', 'method', 'responseMode'], ['body']) && request.version === 0
    && isPluginApiPath(request.path) && (request.method === 'GET' || request.method === 'POST')
    && (request.responseMode === 'binary' || request.responseMode === 'json')
    && (request.method !== 'GET' || request.body === undefined) && (request.body === undefined || isBinaryBody(request.body));
};
export const isPluginBinaryResponseV0 = (value: unknown): value is PluginBinaryResponseV0 => {
  const response = binaryRecord(value);
  if (response === undefined || response.version !== 0 || !Number.isSafeInteger(response.status)
    || (response.status as number) < 100 || (response.status as number) > 599 || typeof response.ok !== 'boolean') return false;
  if (response.mode === 'binary') {
    return binaryExact(response, ['version', 'mode', 'status', 'ok', 'encoding', 'contentType', 'data', 'byteLength', 'sha256'], ['filename'])
      && isBinaryBody({ encoding: response.encoding, contentType: response.contentType, data: response.data, byteLength: response.byteLength, sha256: response.sha256 })
      && (response.filename === undefined || (typeof response.filename === 'string' && response.filename.length > 0 && response.filename.length <= 255 && !/[\u0000-\u001f\u007f/\\]/u.test(response.filename)));
  }
  return response.mode === 'json' && binaryExact(response, ['version', 'mode', 'status', 'ok', 'body'])
    && isJsonAcknowledgement(response.body);
};

type GrantedSlice<G extends HostCapability, R extends HostCapability, S> = [Extract<G, R>] extends [never] ? object : S;
type GrantedSurface<G extends HostCapability, R extends HostCapability, N extends PropertyKey, S> = GrantedSlice<G, R, { readonly [K in N]: S }>;
interface HostPortBase<G extends HostCapability> { readonly capabilities: readonly G[]; has<C extends HostCapability>(capability: C): capability is Extract<G, C>; }

type HostChatPort<G extends HostCapability> = GrantedSurface<G, 'tavern.chat.read' | 'tavern.chat.list' | 'tavern.chat.write' | 'tavern.chat.navigate', 'chat',
  GrantedSlice<G, 'tavern.chat.read', { readCurrent(): Promise<ChatSnapshot | null>; readMessages(): Promise<readonly ChatMessageSnapshot[]> }>
  & GrantedSlice<G, 'tavern.chat.list', { list(): Promise<readonly ChatSnapshot[]> }>
  & GrantedSlice<G, 'tavern.chat.write', { append(message: ChatMessageInput): Promise<ChatMessageSnapshot>; edit(messageId: string, message: ChatMessageInput): Promise<ChatMessageSnapshot>; delete(messageId: string): Promise<void> }>
  & GrantedSlice<G, 'tavern.chat.navigate', { navigate(target: ChatNavigationTarget): Promise<void> }>>;
type HostWorldbooksPort<G extends HostCapability> = GrantedSurface<G, 'tavern.worldbooks.read' | 'tavern.worldbooks.write', 'worldbooks',
  GrantedSlice<G, 'tavern.worldbooks.read', { list(): Promise<readonly WorldbookSnapshot[]>; load(id: string): Promise<WorldbookSnapshot | null>; active(): Promise<readonly WorldbookSnapshot[]> }>
  & GrantedSlice<G, 'tavern.worldbooks.write', { save(worldbook: WorldbookSnapshot): Promise<void>; delete(id: string): Promise<void>; setActive(id: string, active: boolean): Promise<void> }>>;
type HostGenerationPort<G extends HostCapability> = GrantedSurface<G, 'tavern.generation.read' | 'tavern.generation.execute', 'generation',
  GrantedSlice<G, 'tavern.generation.read', { available(): Promise<boolean>; models(): Promise<readonly string[]>; current(): Promise<GenerationSnapshot> }>
  & GrantedSlice<G, 'tavern.generation.execute', { generate(request: GenerationRequest): Promise<GenerationResult>; test(request: GenerationRequest): Promise<GenerationResult> }>>;

export type HostPort<G extends HostCapability = HostCapability> = HostPortBase<G>
  & GrantedSurface<G, 'tavern.context.read', 'context', { read(): Promise<HostContextSnapshot> }>
  & GrantedSurface<G, 'tavern.identity.read', 'identity', { read(): Promise<HostIdentitySnapshot> }>
  & GrantedSurface<G, 'tavern.character.read', 'character', { read(): Promise<HostCharacterSnapshot | null> }>
  & GrantedSurface<G, 'tavern.persona.read', 'persona', { read(): Promise<HostPersonaSnapshot | null> }>
  & HostChatPort<G>
  & GrantedSurface<G, 'tavern.chat.events', 'events', { subscribe<Name extends HostEventName>(name: Name, listener: (event: HostEventMap[Name]) => void): () => void }>
  & HostWorldbooksPort<G>
  & HostGenerationPort<G>
  & GrantedSurface<G, 'tavern.prompt.contribute', 'prompt', { set(contribution: PromptContribution): Promise<void>; remove(id: string): Promise<void> }>
  & GrantedSurface<G, 'tavern.plugin.request', 'request', { send(request: PluginApiRequest): Promise<PluginApiResponse> }>
  & GrantedSurface<G, 'tavern.plugin.binary-request.v0', 'binaryRequest', { send<Mode extends PluginBinaryResponseModeV0>(request: PluginBinaryRequestV0<Mode>, options?: PluginBinaryRequestOptions): Promise<PluginBinaryResponseForModeV0<Mode>> }>
  & GrantedSurface<G, 'tavern.metadata.write', 'metadata', { save(values: Readonly<Record<string, string>>): Promise<void> }>
  & GrantedSurface<G, 'tavern.settings.write', 'settings', { save(): Promise<void> }>
  & GrantedSurface<G, 'tavern.macros.execute', 'macros', { substitute(text: string): Promise<string> }>
  & GrantedSurface<G, 'tavern.systemMessage.write', 'systemMessage', { send(text: string): Promise<void> }>;
