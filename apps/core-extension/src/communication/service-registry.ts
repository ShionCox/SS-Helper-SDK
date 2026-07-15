import { SSHelperError, type AnyServiceContract, type CallOptions, type ServiceCallContext } from '@ss-helper/sdk';
import type { DiagnosticsStore } from '../diagnostics/diagnostics-store.js';
import type { SessionScope } from '../plugins/session-scope.js';
import { assertPayload, contractBase, contractKey, validateContract } from './contracts.js';

type Handler = (request: unknown, context: ServiceCallContext) => unknown | Promise<unknown>;
interface Exposed { readonly owner: SessionScope; readonly contract: AnyServiceContract; readonly handler: Handler; }
interface Waiter { readonly owner: SessionScope; readonly key: string; settle(error?: unknown): void; }
interface Pending { readonly caller: SessionScope; readonly provider: SessionScope; readonly abort: AbortController; settle(error: unknown): void; }

export class ServiceRegistry {
  readonly #handlers = new Map<string, Exposed>();
  readonly #waiters = new Set<Waiter>();
  readonly #pending = new Set<Pending>();

  constructor(private readonly diagnostics: DiagnosticsStore) {}

  expose(owner: SessionScope, contract: AnyServiceContract, handler: Handler): () => void {
    owner.assertActive();
    validateContract(contract, 'service');
    if (contract.provider !== owner.id) {
      throw new SSHelperError('PAYLOAD_INVALID', 'A session cannot expose another provider namespace', { reason: 'namespace' });
    }
    const key = contractKey(contract);
    if (this.#handlers.has(key)) throw new SSHelperError('SERVICE_VERSION_MISMATCH', 'The service contract is already exposed');
    const exposed = { owner, contract, handler };
    this.#handlers.set(key, exposed);
    this.diagnostics.increment('handlers', 1);
    this.diagnostics.record({ type: 'service.exposed', pluginId: owner.id, serviceId: key });
    for (const waiter of [...this.#waiters]) if (waiter.key === key) waiter.settle();
    return owner.addCleanup(() => {
      if (this.#handlers.get(key) !== exposed) return;
      this.#handlers.delete(key);
      this.diagnostics.increment('handlers', -1);
      this.diagnostics.record({ type: 'service.removed', pluginId: owner.id, serviceId: key });
      for (const pending of [...this.#pending]) {
        if (pending.provider === owner) pending.settle(new SSHelperError('PLUGIN_DISPOSED', 'The service provider was disposed'));
      }
    });
  }

  async waitFor(owner: SessionScope, contract: AnyServiceContract, options: CallOptions = {}): Promise<void> {
    owner.assertActive();
    validateContract(contract, 'service');
    const key = contractKey(contract);
    if (this.#handlers.has(key)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void => settle(new SSHelperError('CALL_ABORTED', 'Waiting for the service was aborted'));
      const unregister = owner.addCleanup(() => settle(new SSHelperError('PLUGIN_DISPOSED', 'The waiting plugin was disposed')));
      const settle = (error?: unknown): void => {
        if (done) return;
        done = true;
        this.#waiters.delete(waiter);
        this.diagnostics.increment('waiters', -1);
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        unregister();
        if (error === undefined) resolve(); else reject(error);
      };
      const waiter: Waiter = { owner, key, settle };
      this.#waiters.add(waiter);
      this.diagnostics.increment('waiters', 1);
      if (options.signal?.aborted === true) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });
      if (!done && options.timeoutMs !== undefined) {
        timer = setTimeout(() => settle(new SSHelperError('CALL_TIMEOUT', 'Waiting for the service timed out')), Math.max(0, options.timeoutMs));
      }
    });
  }

  async call(owner: SessionScope, contract: AnyServiceContract, request: unknown, options: CallOptions = {}): Promise<unknown> {
    owner.assertActive();
    validateContract(contract, 'service');
    const key = contractKey(contract);
    const exposed = this.#handlers.get(key);
    if (exposed === undefined) {
      const base = contractBase(contract);
      if ([...this.#handlers.values()].some((candidate) => contractBase(candidate.contract) === base)) {
        return Promise.reject(new SSHelperError('SERVICE_VERSION_MISMATCH', 'The requested service version or schema is unavailable'));
      }
      return Promise.reject(new SSHelperError('UNKNOWN_SERVICE', 'The requested service is unavailable'));
    }
    assertPayload(request, exposed.contract.validateRequest, 'request');
    exposed.owner.assertActive();
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const abort = new AbortController();
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void => settle(new SSHelperError('CALL_ABORTED', 'The service call was aborted'));
      const callerCleanup = owner.addCleanup(() => settle(new SSHelperError('PLUGIN_DISPOSED', 'The calling plugin was disposed')));
      const pending: Pending = {
        caller: owner,
        provider: exposed.owner,
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
          this.diagnostics.record({ type: 'service.called', pluginId: owner.id, serviceId: key, durationMs });
          resolve(value);
        } else {
          this.diagnostics.record({ type: 'service.failed', pluginId: owner.id, serviceId: key, code: error instanceof SSHelperError ? error.code : 'PAYLOAD_INVALID', durationMs });
          reject(error);
        }
      };
      this.#pending.add(pending);
      this.diagnostics.increment('pending', 1);
      if (options.signal?.aborted === true) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });
      if (!done && options.timeoutMs !== undefined) {
        timer = setTimeout(() => settle(new SSHelperError('CALL_TIMEOUT', 'The service call timed out')), Math.max(0, options.timeoutMs));
      }
      if (done) return;
      Promise.resolve().then(() => exposed.handler(request, {
        signal: abort.signal,
        callerPluginId: owner.id as `${string}.${string}`,
      })).then((response) => {
        if (done) return;
        try {
          assertPayload(response, exposed.contract.validateResponse, 'response');
          settle(undefined, response);
        } catch (error) { settle(error); }
      }, (error: unknown) => settle(error instanceof SSHelperError ? error : new SSHelperError(
        'PAYLOAD_INVALID', 'The service handler failed', { phase: 'handler' },
      )));
    });
  }

  dispose(): void {
    for (const pending of [...this.#pending]) pending.settle(new SSHelperError('CORE_DISPOSED', 'Core was disposed'));
    for (const waiter of [...this.#waiters]) waiter.settle(new SSHelperError('CORE_DISPOSED', 'Core was disposed'));
    this.#handlers.clear();
    this.#waiters.clear();
    this.#pending.clear();
  }
}
