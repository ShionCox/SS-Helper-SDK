import {
  SS_HELPER_ERROR_CODES,
  SSHelperError,
  createSSHelperError,
  readSSHelperFailure,
  type AnyBusEventContract,
  type AnyRequestContract,
  type BusRequestOptions,
  type BusRequestContext,
  type SSHelperErrorCode,
  type SSHelperErrorDetails,
} from '@ss-helper/sdk';
import type { DiagnosticsStore } from '../diagnostics/diagnostics-store.js';
import type { SessionScope } from '../plugins/session-scope.js';
import { assertPayload, contractBase, contractKey, ownsContract, validateContract } from './contracts.js';

type Handler = (request: unknown, context: BusRequestContext) => unknown | Promise<unknown>;
interface RegisteredHandler { readonly owner: SessionScope; readonly contract: AnyRequestContract; readonly handler: Handler; }
interface Subscription { readonly owner: SessionScope; readonly contract: AnyBusEventContract; readonly listener: (payload: unknown) => void; }
interface Pending {
  readonly caller: SessionScope;
  readonly provider: SessionScope;
  readonly registration: RegisteredHandler;
  readonly abort: AbortController;
  settle(error: unknown): void;
}

const errorCodes = new Set<string>(SS_HELPER_ERROR_CODES);

function safeErrorDetails(value: unknown): SSHelperErrorDetails | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const details: Record<string, null | boolean | number | string | readonly string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || typeof item === 'boolean' || typeof item === 'string') details[key] = item;
    else if (typeof item === 'number' && Number.isFinite(item)) details[key] = item;
    else if (Array.isArray(item) && item.every((entry) => typeof entry === 'string')) details[key] = [...item];
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

function retainBusError(error: unknown, requestId: string): SSHelperError | undefined {
  const failure = readSSHelperFailure(error);
  if (failure !== undefined) {
    const { reasonCode, ...context } = failure;
    return createSSHelperError(reasonCode, { ...context, requestId: context.requestId ?? requestId });
  }
  if (error instanceof SSHelperError) {
    return new SSHelperError(error.code, error.message, {
      ...error.details,
      requestId: typeof error.details?.requestId === 'string' ? error.details.requestId : requestId,
    });
  }
  if (error === null || typeof error !== 'object') return undefined;
  const candidate = error as Record<string, unknown>;
  if (
    candidate.name !== 'SSHelperError'
    || typeof candidate.code !== 'string'
    || !errorCodes.has(candidate.code)
  ) return undefined;
  return new SSHelperError(
    candidate.code as SSHelperErrorCode,
    typeof candidate.message === 'string' ? candidate.message : 'The request failed',
    {
      ...safeErrorDetails(candidate.details),
      requestId: typeof (candidate.details as Record<string, unknown> | undefined)?.requestId === 'string'
        ? (candidate.details as Record<string, string>).requestId
        : requestId,
    },
  );
}

export class MessageBus {
  readonly #handlers = new Map<string, RegisteredHandler>();
  readonly #subscriptions = new Map<string, Set<Subscription>>();
  readonly #pending = new Set<Pending>();
  #sequence = 0;

  constructor(private readonly diagnostics: DiagnosticsStore) {}

  handle(owner: SessionScope, contract: AnyRequestContract, handler: Handler): () => void {
    owner.assertActive();
    validateContract(contract, 'request');
    if (typeof handler !== 'function') {
      throw new SSHelperError('INVALID_PAYLOAD', 'The request handler must be a function', {
        stage: 'contract',
        reasonCode: 'BUS_HANDLER_INVALID',
      });
    }
    if (!ownsContract(owner.id, contract)) {
      throw new SSHelperError('FORBIDDEN', 'A session cannot handle another plugin namespace', {
        stage: 'contract',
        reasonCode: 'BUS_NAMESPACE_FORBIDDEN',
      });
    }
    const key = contractKey(contract);
    if (this.#handlers.has(key)) {
      throw new SSHelperError('CONFLICT', 'The request contract is already handled', {
        stage: 'contract',
        reasonCode: 'BUS_HANDLER_CONFLICT',
      });
    }
    const registered = { owner, contract, handler };
    this.#handlers.set(key, registered);
    this.diagnostics.increment('handlers', 1);
    this.diagnostics.record({ type: 'bus.handler.registered', pluginId: owner.id, serviceId: contract.id });
    return owner.addCleanup(() => {
      if (this.#handlers.get(key) !== registered) return;
      this.#handlers.delete(key);
      this.diagnostics.increment('handlers', -1);
      this.diagnostics.record({ type: 'bus.handler.removed', pluginId: owner.id, serviceId: contract.id });
      for (const pending of [...this.#pending]) {
        if (pending.registration === registered) {
          pending.settle(new SSHelperError('STALE_SESSION', 'The request provider session closed', {
            stage: 'provider',
            reasonCode: 'BUS_PROVIDER_CLOSED',
          }));
        }
      }
    });
  }

  async request(
    owner: SessionScope,
    contract: AnyRequestContract,
    request: unknown,
    options: BusRequestOptions = {},
  ): Promise<unknown> {
    owner.assertActive();
    validateContract(contract, 'request');
    const key = contractKey(contract);
    const registered = this.#handlers.get(key);
    const requestId = `${owner.id}:${owner.generation}:${Date.now()}:${++this.#sequence}`;
    if (registered === undefined) {
      const reasonCode = [...this.#handlers.values()].some((candidate) => contractBase(candidate.contract) === contractBase(contract))
        ? 'BUS_CONTRACT_VERSION_NOT_FOUND'
        : 'BUS_HANDLER_NOT_FOUND';
      throw new SSHelperError('NOT_FOUND', 'The requested handler is unavailable', {
        requestId,
        stage: 'dispatch',
        reasonCode,
      });
    }
    try {
      assertPayload(request, registered.contract.validateRequest, 'request');
    } catch (error) {
      throw retainBusError(error, requestId) ?? error;
    }
    registered.owner.assertActive();
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const abort = new AbortController();
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void => settle(new SSHelperError('ABORTED', 'The request was aborted', {
        requestId,
        stage: 'caller',
        reasonCode: 'BUS_CALLER_ABORTED',
      }));
      const callerCleanup = owner.addCleanup(() => settle(new SSHelperError('STALE_SESSION', 'The caller session closed', {
        requestId,
        stage: 'caller',
        reasonCode: 'BUS_CALLER_CLOSED',
      })));
      const pending: Pending = {
        caller: owner,
        provider: registered.owner,
        registration: registered,
        abort,
        settle: (error) => settle(error),
      };
      const settle = (error?: unknown, value?: unknown): void => {
        if (done) return;
        done = true;
        abort.abort();
        this.#pending.delete(pending);
        this.diagnostics.increment('pending', -1);
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        callerCleanup();
        const durationMs = Date.now() - startedAt;
        if (error === undefined) {
          this.diagnostics.record({ type: 'bus.request.completed', pluginId: owner.id, serviceId: contract.id, durationMs });
          resolve(value);
        } else {
          const retained = retainBusError(error, requestId) ?? new SSHelperError('INTERNAL', 'The request handler failed', {
            requestId,
            stage: 'handler',
            reasonCode: 'BUS_HANDLER_FAILED',
          });
          this.diagnostics.record({ type: 'bus.request.failed', pluginId: owner.id, serviceId: contract.id, code: retained.code, durationMs });
          reject(retained);
        }
      };
      this.#pending.add(pending);
      this.diagnostics.increment('pending', 1);
      if (options.signal?.aborted === true) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });
      if (!done && options.timeoutMs !== undefined) {
        timer = setTimeout(() => settle(new SSHelperError('TIMEOUT', 'The request timed out', {
          requestId,
          stage: 'dispatch',
          reasonCode: 'BUS_REQUEST_TIMEOUT',
        })), Math.max(0, options.timeoutMs));
      }
      if (done) return;
      Promise.resolve().then(() => registered.handler(request, {
        signal: abort.signal,
        callerPluginId: owner.id as `${string}.${string}`,
        requestId,
      })).then((response) => {
        if (done) return;
        try {
          assertPayload(response, registered.contract.validateResponse, 'response');
          settle(undefined, response);
        } catch (error) {
          settle(error);
        }
      }, (error: unknown) => settle(error));
    });
  }

  publish(owner: SessionScope, contract: AnyBusEventContract, payload: unknown): void {
    owner.assertActive();
    validateContract(contract, 'event');
    if (!ownsContract(owner.id, contract)) {
      throw new SSHelperError('FORBIDDEN', 'A session cannot publish another plugin namespace', {
        stage: 'contract',
        reasonCode: 'BUS_NAMESPACE_FORBIDDEN',
      });
    }
    assertPayload(payload, contract.validatePayload, 'event');
    const exact = this.#subscriptions.get(contractKey(contract));
    if (exact === undefined) return;
    for (const subscription of [...exact]) {
      if (subscription.owner.disposed) continue;
      try {
        subscription.listener(payload);
      } catch {
        this.diagnostics.record({
          type: 'bus.event.listener.failed',
          pluginId: subscription.owner.id,
          serviceId: contract.id,
          code: 'INTERNAL',
        });
      }
    }
  }

  subscribe(
    owner: SessionScope,
    contract: AnyBusEventContract,
    listener: (payload: unknown) => void,
  ): () => void {
    owner.assertActive();
    validateContract(contract, 'event');
    if (typeof listener !== 'function') {
      throw new SSHelperError('INVALID_PAYLOAD', 'The event listener must be a function', {
        stage: 'contract',
        reasonCode: 'BUS_LISTENER_INVALID',
      });
    }
    const key = contractKey(contract);
    const set = this.#subscriptions.get(key) ?? new Set<Subscription>();
    this.#subscriptions.set(key, set);
    const subscription = { owner, contract, listener };
    set.add(subscription);
    this.diagnostics.increment('subscribers', 1);
    return owner.addCleanup(() => {
      if (!set.delete(subscription)) return;
      this.diagnostics.increment('subscribers', -1);
      if (set.size === 0) this.#subscriptions.delete(key);
    });
  }

  dispose(): void {
    for (const pending of [...this.#pending]) {
      pending.settle(new SSHelperError('CORE_UNAVAILABLE', 'Core closed during the request', {
        stage: 'core',
        reasonCode: 'BUS_CORE_DISPOSED',
      }));
    }
    if (this.#handlers.size > 0) this.diagnostics.increment('handlers', -this.#handlers.size);
    let subscriberCount = 0;
    for (const subscriptions of this.#subscriptions.values()) subscriberCount += subscriptions.size;
    if (subscriberCount > 0) this.diagnostics.increment('subscribers', -subscriberCount);
    this.#handlers.clear();
    this.#subscriptions.clear();
    this.#pending.clear();
  }
}
