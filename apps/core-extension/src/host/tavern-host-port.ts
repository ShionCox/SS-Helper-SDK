import {
  SSHelperError,
  type ChatSnapshot,
  type ChatMessageInput,
  type ChatMessageSnapshot,
  type ChatNavigationTarget,
  type GenerationRequest,
  type GenerationResult,
  type GenerationSnapshot,
  type HostCapability,
  type HostContextSnapshot,
  type HostIdentitySnapshot,
  type HostCharacterSnapshot,
  type HostPersonaSnapshot,
  type HostEvent,
  type HostEventName,
  type HostPort,
  type PluginApiRequest,
  type PluginApiResponse,
  type PluginBinaryBodyV0,
  type PluginBinaryRequestOptions,
  type PluginBinaryRequestV0,
  type PluginBinaryResponseForModeV0,
  type PluginBinaryResponseModeV0,
  type PluginBinaryResponseV0,
  type PromptContribution,
  type WorldbookSnapshot,
  isPluginBinaryRequestV0,
  isPluginBinaryResponseV0,
} from '@ss-helper/sdk';
import type { SessionScope } from '../plugins/session-scope.js';
import { assertPayload, isPlainData } from '../communication/contracts.js';

export interface TavernHostAdapter {
  readonly context?: { read(): Promise<HostContextSnapshot> };
  readonly identity?: { read(): Promise<HostIdentitySnapshot> };
  readonly character?: { read(): Promise<HostCharacterSnapshot | null> };
  readonly persona?: { read(): Promise<HostPersonaSnapshot | null> };
  readonly chat?: { readCurrent(): Promise<ChatSnapshot | null>; readMessages(): Promise<readonly ChatMessageSnapshot[]>; list(): Promise<readonly ChatSnapshot[]>; append(message: ChatMessageInput): Promise<ChatMessageSnapshot>; edit(messageId: string, message: ChatMessageInput): Promise<ChatMessageSnapshot>; delete(messageId: string): Promise<void>; navigate(target: ChatNavigationTarget): Promise<void> };
  readonly events?: { subscribe(name: HostEventName, listener: (event: HostEvent) => void): () => void };
  readonly worldbooks?: {
    list(): Promise<readonly WorldbookSnapshot[]>;
    load(id: string): Promise<WorldbookSnapshot | null>;
    active(): Promise<readonly WorldbookSnapshot[]>;
    save(worldbook: WorldbookSnapshot): Promise<void>;
    delete(id: string): Promise<void>;
    setActive(id: string, active: boolean): Promise<void>;
  };
  readonly generation?: {
    available(): Promise<boolean>;
    models(): Promise<readonly string[]>;
    current(): Promise<GenerationSnapshot>;
    generate(request: GenerationRequest): Promise<GenerationResult>;
    test(request: GenerationRequest): Promise<GenerationResult>;
  };
  readonly prompt?: { set(contribution: PromptContribution): Promise<void>; remove(id: string): Promise<void> };
  readonly request?: { send(request: PluginApiRequest): Promise<PluginApiResponse> };
  readonly binaryRequest?: { send(request: PluginBinaryRequestV0, options: { readonly signal: AbortSignal }): Promise<PluginBinaryResponseV0> };
  readonly metadata?: { save(values: Readonly<Record<string, string>>): Promise<void> };
  readonly settings?: { save(): Promise<void> };
  readonly macros?: { substitute(text: string): Promise<string> };
  readonly systemMessage?: { send(text: string): Promise<void> };
}

function unavailable(capability: HostCapability): never {
  throw new SSHelperError('CAPABILITY_NOT_GRANTED', 'The Tavern capability is unavailable', { capability });
}

function requireAdapter<T>(value: T | undefined, capability: HostCapability): T {
  return value ?? unavailable(capability);
}

function guarded<TArgs extends readonly unknown[], TResult>(scope: SessionScope, operation: (...args: TArgs) => TResult): (...args: TArgs) => TResult {
  return (...args) => {
    scope.assertActive();
    try {
      assertPayload(args, undefined, 'host_input');
      const result = operation(...args);
      if (typeof result === 'object' && result !== null && 'then' in result) {
        return Promise.resolve(result).then((value) => {
          if (value !== undefined) assertPayload(value, undefined, 'host_output');
          return value;
        }).catch((error: unknown) => {
          if (error instanceof SSHelperError) throw error;
          throw new SSHelperError('BRIDGE_CORRUPTED', 'The Tavern host adapter failed', { reason: 'host_adapter' });
        }) as TResult;
      }
      return result;
    } catch (error) {
      if (error instanceof SSHelperError) throw error;
      throw new SSHelperError('BRIDGE_CORRUPTED', 'The Tavern host adapter failed', { reason: 'host_adapter' });
    }
  };
}

const binaryHash = async (body: PluginBinaryBodyV0): Promise<string> => {
  const decoded = atob(body.data);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
};

const assertBinaryHash = async (body: PluginBinaryBodyV0 | undefined, phase: 'host_input' | 'host_output'): Promise<void> => {
  if (body !== undefined && await binaryHash(body) !== body.sha256) {
    throw new SSHelperError('PAYLOAD_INVALID', 'The binary payload hash does not match its bytes', { phase, reason: 'sha256_mismatch' });
  }
};

const isAbortSignal = (value: unknown): value is AbortSignal => typeof value === 'object' && value !== null
  && typeof (value as AbortSignal).aborted === 'boolean'
  && typeof (value as AbortSignal).addEventListener === 'function'
  && typeof (value as AbortSignal).removeEventListener === 'function';

function sendBinaryRequest<Mode extends PluginBinaryResponseModeV0>(
  scope: SessionScope,
  adapter: TavernHostAdapter,
  request: PluginBinaryRequestV0<Mode>,
  options: PluginBinaryRequestOptions = {},
): Promise<PluginBinaryResponseForModeV0<Mode>> {
  scope.assertActive();
  assertPayload(request, isPluginBinaryRequestV0, 'host_input');
  const optionKeys = Object.keys(options);
  if (optionKeys.some((key) => key !== 'timeoutMs' && key !== 'signal')
    || (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0 || options.timeoutMs > 120_000))
    || (options.signal !== undefined && !isAbortSignal(options.signal))) {
    throw new SSHelperError('PAYLOAD_INVALID', 'The binary request controls are invalid', { phase: 'host_input' });
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  return new Promise<PluginBinaryResponseForModeV0<Mode>>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeScopeCleanup = (): void => {};
    const onExternalAbort = (): void => {
      controller.abort();
      finish(new SSHelperError('CALL_ABORTED', 'The binary plugin request was aborted'));
    };
    const finish = (error?: unknown, value?: PluginBinaryResponseForModeV0<Mode>): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
      removeScopeCleanup();
      if (error !== undefined) reject(error); else resolve(value as PluginBinaryResponseForModeV0<Mode>);
    };
    removeScopeCleanup = scope.addCleanup(() => {
      controller.abort();
      finish(new SSHelperError('PLUGIN_DISPOSED', 'The calling plugin was disposed'));
    });
    if (options.signal?.aborted === true) onExternalAbort();
    else options.signal?.addEventListener('abort', onExternalAbort, { once: true });
    if (!settled) timer = setTimeout(() => {
      controller.abort();
      finish(new SSHelperError('CALL_TIMEOUT', 'The binary plugin request timed out'));
    }, timeoutMs);
    void (async () => {
      try {
        await assertBinaryHash(request.body, 'host_input');
        const response = await requireAdapter(adapter.binaryRequest, 'tavern.plugin.binary-request.v0').send(request, { signal: controller.signal });
        assertPayload(response, isPluginBinaryResponseV0, 'host_output');
        if (response.mode !== request.responseMode) {
          throw new SSHelperError('PAYLOAD_INVALID', 'The binary request response mode does not match the request', { phase: 'host_output', reason: 'response_mode_mismatch' });
        }
        if (response.mode === 'binary') await assertBinaryHash(response, 'host_output');
        scope.assertActive();
        finish(undefined, response as PluginBinaryResponseForModeV0<Mode>);
      } catch (error) {
        if (settled) return;
        finish(error instanceof SSHelperError ? error : new SSHelperError('BRIDGE_CORRUPTED', 'The Tavern binary request adapter failed', { reason: 'host_adapter' }));
      }
    })();
  });
}

function subscribeToChatEvents(
  scope: SessionScope,
  adapter: TavernHostAdapter,
  name: HostEventName,
  listener: (event: HostEvent) => void,
): () => void {
  scope.assertActive();
  if (!HOST_EVENT_NAMES.has(name) || typeof listener !== 'function') {
    throw new SSHelperError('PAYLOAD_INVALID', 'The Tavern event subscription is invalid', { phase: 'host_input' });
  }
  try {
    const cleanup = requireAdapter(adapter.events, 'tavern.chat.events').subscribe(name, (event) => {
      assertPayload(event, (value) => isHostEvent(name, value), 'host_output');
      listener(event);
    });
    if (typeof cleanup !== 'function') throw new SSHelperError('BRIDGE_CORRUPTED', 'The Tavern host adapter returned an invalid cleanup', { reason: 'host_adapter' });
    return scope.addCleanup(cleanup);
  } catch (error) {
    if (error instanceof SSHelperError) throw error;
    throw new SSHelperError('BRIDGE_CORRUPTED', 'The Tavern host adapter failed', { reason: 'host_adapter' });
  }
}

const HOST_EVENT_NAMES = new Set<HostEventName>([
  'chat-changed', 'message-received', 'message-sent', 'message-edited', 'message-deleted',
  'generation-started', 'generation-ended', 'generation-config-changed', 'prompt-ready', 'worldbook-updated', 'identity-changed',
]);

const exactKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean => {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => required.includes(key) || optional.includes(key));
};
const object = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';
const optionalBoolean = (value: unknown): boolean => value === undefined || typeof value === 'boolean';
const finiteCount = (value: unknown): boolean => value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const isVariables = (value: unknown): boolean => value === undefined || (isPlainData(value) && (object(value) !== undefined || (Array.isArray(value) && value.every((entry) => object(entry) !== undefined))));
const isMessage = (value: unknown): boolean => {
  const item = object(value);
  const author = item === undefined ? undefined : object(item.author);
  const validAuthor = item !== undefined && (item.author === undefined
    || (author !== undefined
      && exactKeys(author, ['kind'], ['displayName', 'avatar', 'originalAvatar'])
      && ['user', 'assistant', 'narrator', 'system'].includes(author.kind as string)
      && optionalString(author.displayName) && optionalString(author.avatar) && optionalString(author.originalAvatar)));
  return item !== undefined && exactKeys(item, ['id', 'index', 'role', 'text'], ['name', 'createdAt', 'variables', 'messageType', 'visibleToAi', 'author'])
    && typeof item.id === 'string' && Number.isSafeInteger(item.index) && (item.index as number) >= 0
    && (item.role === 'system' || item.role === 'user' || item.role === 'assistant') && typeof item.text === 'string'
    && optionalString(item.name) && optionalString(item.createdAt) && isVariables(item.variables)
    && (item.messageType === undefined || ['conversation', 'system', 'narrator', 'tool', 'reasoning'].includes(item.messageType as string))
    && optionalBoolean(item.visibleToAi) && validAuthor;
};
const isGeneration = (value: unknown): boolean => {
  const item = object(value);
  if (item === undefined || !exactKeys(item, ['active'], ['provider', 'model', 'usage']) || typeof item.active !== 'boolean' || !optionalString(item.provider) || !optionalString(item.model)) return false;
  if (item.usage === undefined) return true;
  const usage = object(item.usage);
  return usage !== undefined && exactKeys(usage, [], ['inputTokens', 'outputTokens', 'totalTokens'])
    && finiteCount(usage.inputTokens) && finiteCount(usage.outputTokens) && finiteCount(usage.totalTokens);
};
const isPrompt = (value: unknown): boolean => {
  const item = object(value);
  if (item === undefined || !exactKeys(item, ['messages', 'dryRun']) || !Array.isArray(item.messages) || typeof item.dryRun !== 'boolean') return false;
  return item.messages.every((entry) => {
    const message = object(entry);
    return message !== undefined && exactKeys(message, [], ['role', 'name', 'content']) && optionalString(message.role) && optionalString(message.name);
  });
};
const isWorldbook = (value: unknown): boolean => {
  const item = object(value);
  if (item === undefined || !exactKeys(item, ['id', 'name', 'active'], ['entries']) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.active !== 'boolean') return false;
  return item.entries === undefined || (Array.isArray(item.entries) && item.entries.every((entry) => {
    const value = object(entry);
    return value !== undefined && exactKeys(value, ['id', 'keys', 'content', 'enabled'], ['secondaryKeys', 'position', 'order'])
      && typeof value.id === 'string' && Array.isArray(value.keys) && value.keys.every((key) => typeof key === 'string')
      && (value.secondaryKeys === undefined || (Array.isArray(value.secondaryKeys) && value.secondaryKeys.every((key) => typeof key === 'string')))
      && typeof value.content === 'string' && typeof value.enabled === 'boolean'
      && (value.position === undefined || (typeof value.position === 'number' && Number.isFinite(value.position)))
      && (value.order === undefined || (typeof value.order === 'number' && Number.isFinite(value.order)));
  }));
};
const isIdentity = (value: unknown): boolean => {
  const item = object(value);
  return item !== undefined && exactKeys(item, [], ['userId', 'userName', 'characterId', 'groupId'])
    && optionalString(item.userId) && optionalString(item.userName) && optionalString(item.characterId) && optionalString(item.groupId);
};
function isHostEvent(expectedName: HostEventName, value: unknown): boolean {
  const event = object(value);
  if (event === undefined || event.name !== expectedName) return false;
  if (expectedName === 'chat-changed') return exactKeys(event, ['name', 'chatKey']) && typeof event.chatKey === 'string';
  if (expectedName === 'message-received' || expectedName === 'message-sent' || expectedName === 'message-edited') {
    return exactKeys(event, ['name', 'messageId'], ['chatKey', 'message']) && typeof event.messageId === 'string' && optionalString(event.chatKey) && (event.message === undefined || isMessage(event.message));
  }
  if (expectedName === 'message-deleted') return exactKeys(event, ['name', 'messageId'], ['chatKey']) && typeof event.messageId === 'string' && optionalString(event.chatKey);
  if (expectedName === 'generation-started' || expectedName === 'generation-ended') return exactKeys(event, ['name', 'generation'], ['chatKey']) && optionalString(event.chatKey) && isGeneration(event.generation);
  if (expectedName === 'generation-config-changed') return exactKeys(event, ['name', 'generation']) && isGeneration(event.generation);
  if (expectedName === 'prompt-ready') return exactKeys(event, ['name', 'prompt'], ['chatKey']) && optionalString(event.chatKey) && isPrompt(event.prompt);
  if (expectedName === 'worldbook-updated') return exactKeys(event, ['name', 'worldbook']) && isWorldbook(event.worldbook);
  return exactKeys(event, ['name', 'identity']) && isIdentity(event.identity);
}

function deniedSurface(capability: HostCapability, methods: readonly string[]): object {
  return Object.freeze(Object.fromEntries(methods.map((method) => [method, () => unavailable(capability)])));
}

const deniedTopLevel: Readonly<Record<string, object>> = Object.freeze({
  context: deniedSurface('tavern.context.read', ['read']),
  identity: deniedSurface('tavern.identity.read', ['read']),
  character: deniedSurface('tavern.character.read', ['read']),
  persona: deniedSurface('tavern.persona.read', ['read']),
  chat: deniedSurface('tavern.chat.read', ['readCurrent', 'readMessages', 'list', 'append', 'edit', 'delete', 'navigate']),
  events: deniedSurface('tavern.chat.events', ['subscribe']),
  worldbooks: deniedSurface('tavern.worldbooks.read', ['list', 'load', 'save', 'delete', 'setActive']),
  generation: deniedSurface('tavern.generation.read', ['available', 'models', 'current', 'generate', 'test']),
  prompt: deniedSurface('tavern.prompt.contribute', ['set', 'remove']),
  request: deniedSurface('tavern.plugin.request', ['send']),
  binaryRequest: deniedSurface('tavern.plugin.binary-request.v0', ['send']),
  metadata: deniedSurface('tavern.metadata.write', ['save']),
  settings: deniedSurface('tavern.settings.write', ['save']),
  macros: deniedSurface('tavern.macros.execute', ['substitute']),
  systemMessage: deniedSurface('tavern.systemMessage.write', ['send']),
});

export function createTavernHostPort<Granted extends HostCapability>(scope: SessionScope, granted: readonly Granted[], adapter: TavernHostAdapter): HostPort<Granted> {
  const has = (capability: HostCapability): boolean => granted.includes(capability as Granted);
  const port: Record<string, unknown> = { capabilities: granted, has };
  if (has('tavern.context.read')) port.context = { read: guarded(scope, () => requireAdapter(adapter.context, 'tavern.context.read').read()) };
  if (has('tavern.identity.read')) port.identity = { read: guarded(scope, () => requireAdapter(adapter.identity, 'tavern.identity.read').read()) };
  if (has('tavern.character.read')) port.character = { read: guarded(scope, () => requireAdapter(adapter.character, 'tavern.character.read').read()) };
  if (has('tavern.persona.read')) port.persona = { read: guarded(scope, () => requireAdapter(adapter.persona, 'tavern.persona.read').read()) };
  if (has('tavern.chat.read') || has('tavern.chat.list') || has('tavern.chat.write') || has('tavern.chat.navigate')) {
    const chat: Record<string, unknown> = {};
    if (has('tavern.chat.read')) { chat.readCurrent = guarded(scope, () => requireAdapter(adapter.chat, 'tavern.chat.read').readCurrent()); chat.readMessages = guarded(scope, () => requireAdapter(adapter.chat, 'tavern.chat.read').readMessages()); }
    if (has('tavern.chat.list')) chat.list = guarded(scope, () => requireAdapter(adapter.chat, 'tavern.chat.list').list());
    if (has('tavern.chat.write')) { chat.append = guarded(scope, (message: ChatMessageInput) => requireAdapter(adapter.chat, 'tavern.chat.write').append(message)); chat.edit = guarded(scope, (id: string, message: ChatMessageInput) => requireAdapter(adapter.chat, 'tavern.chat.write').edit(id, message)); chat.delete = guarded(scope, (id: string) => requireAdapter(adapter.chat, 'tavern.chat.write').delete(id)); }
    if (has('tavern.chat.navigate')) chat.navigate = guarded(scope, (target: ChatNavigationTarget) => requireAdapter(adapter.chat, 'tavern.chat.navigate').navigate(target));
    port.chat = Object.freeze(new Proxy(chat, { get: (target, property, receiver) => Reflect.has(target, property) ? Reflect.get(target, property, receiver) : () => unavailable('tavern.chat.list') }));
  }
  if (has('tavern.chat.events')) port.events = { subscribe: (name: HostEventName, listener: (event: HostEvent) => void) => subscribeToChatEvents(scope, adapter, name, listener) };
  if (has('tavern.worldbooks.read') || has('tavern.worldbooks.write')) {
    const worldbooks: Record<string, unknown> = {};
    if (has('tavern.worldbooks.read')) {
      worldbooks.list = guarded(scope, () => requireAdapter(adapter.worldbooks, 'tavern.worldbooks.read').list());
      worldbooks.load = guarded(scope, (id: string) => requireAdapter(adapter.worldbooks, 'tavern.worldbooks.read').load(id));
      worldbooks.active = guarded(scope, () => requireAdapter(adapter.worldbooks, 'tavern.worldbooks.read').active());
    }
    if (has('tavern.worldbooks.write')) {
      worldbooks.save = guarded(scope, (value: WorldbookSnapshot) => requireAdapter(adapter.worldbooks, 'tavern.worldbooks.write').save(value));
      worldbooks.delete = guarded(scope, (id: string) => requireAdapter(adapter.worldbooks, 'tavern.worldbooks.write').delete(id));
      worldbooks.setActive = guarded(scope, (id: string, active: boolean) => requireAdapter(adapter.worldbooks, 'tavern.worldbooks.write').setActive(id, active));
    }
    port.worldbooks = Object.freeze(new Proxy(worldbooks, { get: (target, property, receiver) => Reflect.has(target, property) ? Reflect.get(target, property, receiver) : () => unavailable(has('tavern.worldbooks.read') ? 'tavern.worldbooks.write' : 'tavern.worldbooks.read') }));
  }
  if (has('tavern.generation.read') || has('tavern.generation.execute')) {
    const generation: Record<string, unknown> = {};
    if (has('tavern.generation.read')) {
      generation.available = guarded(scope, () => requireAdapter(adapter.generation, 'tavern.generation.read').available());
      generation.models = guarded(scope, () => requireAdapter(adapter.generation, 'tavern.generation.read').models());
      generation.current = guarded(scope, () => requireAdapter(adapter.generation, 'tavern.generation.read').current());
    }
    if (has('tavern.generation.execute')) {
      generation.generate = guarded(scope, (request: GenerationRequest) => requireAdapter(adapter.generation, 'tavern.generation.execute').generate(request));
      generation.test = guarded(scope, (request: GenerationRequest) => requireAdapter(adapter.generation, 'tavern.generation.execute').test(request));
    }
    port.generation = Object.freeze(new Proxy(generation, { get: (target, property, receiver) => Reflect.has(target, property) ? Reflect.get(target, property, receiver) : () => unavailable(has('tavern.generation.read') ? 'tavern.generation.execute' : 'tavern.generation.read') }));
  }
  if (has('tavern.prompt.contribute')) port.prompt = { set: guarded(scope, (value: PromptContribution) => requireAdapter(adapter.prompt, 'tavern.prompt.contribute').set(value)), remove: guarded(scope, (id: string) => requireAdapter(adapter.prompt, 'tavern.prompt.contribute').remove(id)) };
  if (has('tavern.plugin.request')) port.request = { send: guarded(scope, (request: PluginApiRequest) => requireAdapter(adapter.request, 'tavern.plugin.request').send(request)) };
  if (has('tavern.plugin.binary-request.v0')) port.binaryRequest = { send: (request: PluginBinaryRequestV0, options?: PluginBinaryRequestOptions) => sendBinaryRequest(scope, adapter, request, options) };
  if (has('tavern.metadata.write')) port.metadata = { save: guarded(scope, (values: Readonly<Record<string, string>>) => requireAdapter(adapter.metadata, 'tavern.metadata.write').save(values)) };
  if (has('tavern.settings.write')) port.settings = { save: guarded(scope, () => requireAdapter(adapter.settings, 'tavern.settings.write').save()) };
  if (has('tavern.macros.execute')) port.macros = { substitute: guarded(scope, (text: string) => requireAdapter(adapter.macros, 'tavern.macros.execute').substitute(text)) };
  if (has('tavern.systemMessage.write')) port.systemMessage = { send: guarded(scope, (text: string) => requireAdapter(adapter.systemMessage, 'tavern.systemMessage.write').send(text)) };
  return Object.freeze(new Proxy(port, {
    get: (target, property, receiver) => Reflect.has(target, property) ? Reflect.get(target, property, receiver) : deniedTopLevel[String(property)],
  })) as HostPort<Granted>;
}
