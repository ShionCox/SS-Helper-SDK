import { SSHelperError, type PlainData } from '@ss-helper/sdk';
import type { TavernHostAdapter } from '../host/tavern-host-port.js';
import type { ResourceScope } from '../plugins/session-scope.js';

const BRIDGE_PATH = '/api/plugins/ss-helper-sdk/internal/bridge/v0/call' as const;
const DEFAULT_STARTUP_DEADLINE_MS = 15_000;
const DEFAULT_STARTUP_RETRY_DELAYS_MS = Object.freeze([100, 200, 400, 800, 1_500, 2_500, 4_000] as const);

type BridgeResponse = {
  readonly ok?: unknown;
  readonly data?: unknown;
  readonly error?: unknown;
  readonly message?: unknown;
};

export interface InternalBridgeClientOptions {
  /** Maximum time spent waiting for SillyTavern to register the server-plugin route. */
  readonly startupDeadlineMs?: number;
  /** Injectable for deterministic tests; production uses bounded exponential backoff. */
  readonly startupRetryDelaysMs?: readonly number[];
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function isHandledBridgeResponse(response: { readonly status: number; readonly body?: unknown }): boolean {
  if (response.body === null || typeof response.body !== 'object' || Array.isArray(response.body)) return false;
  const body = response.body as BridgeResponse;
  return body.ok === true || (body.ok === false && typeof body.error === 'string');
}

function isMissingBridgeRoute(response: { readonly status: number; readonly body?: unknown }): boolean {
  return response.status === 404 && !isHandledBridgeResponse(response);
}

/**
 * Private Core transport. Consumer plugins receive ports backed by this client
 * and never receive a route name, request headers, or caller identity hook.
 * This narrows accidental misuse but does not turn same-origin extensions into
 * mutually hostile security principals.
 */
export class InternalBridgeClient {
  #bridgeReady = false;
  #readiness: Promise<void> | undefined;
  readonly #startupDeadlineMs: number;
  readonly #startupRetryDelaysMs: readonly number[];

  constructor(
    private readonly hostAdapter: TavernHostAdapter,
    options: InternalBridgeClientOptions = {},
  ) {
    this.#startupDeadlineMs = Math.max(0, Math.min(120_000, options.startupDeadlineMs ?? DEFAULT_STARTUP_DEADLINE_MS));
    this.#startupRetryDelaysMs = options.startupRetryDelaysMs?.length
      ? options.startupRetryDelaysMs.map(value => Math.max(0, Math.min(30_000, Number(value) || 0)))
      : DEFAULT_STARTUP_RETRY_DELAYS_MS;
  }

  async #send(pluginId: string, operation: string, input: unknown): Promise<Awaited<ReturnType<NonNullable<TavernHostAdapter['request']>['send']>>> {
    if (this.hostAdapter.request === undefined) {
      throw new SSHelperError('HOST_NOT_READY', 'The SillyTavern plugin request bridge is unavailable');
    }
    return this.hostAdapter.request.send({
      path: BRIDGE_PATH,
      method: 'POST',
      body: { version: 0, pluginId, operation, input: input as PlainData },
    });
  }

  async #probe(scope: ResourceScope, pluginId: string): Promise<void> {
    const deadline = Date.now() + this.#startupDeadlineMs;
    let attempt = 0;
    while (true) {
      scope.assertActive();
      const response = await this.#send(pluginId, 'workspace.health', {});
      scope.assertActive();
      // Any handled response proves that the private route exists. A 400/403
      // remains a real policy/business error for the subsequent operation and
      // must not be hidden by startup retries.
      if (!isMissingBridgeRoute(response)) {
        this.#bridgeReady = true;
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new SSHelperError('HOST_NOT_READY', 'The SS-Helper server bridge was not registered before the startup deadline', {
          status: 404,
          retryAttempts: attempt,
        });
      }
      const configured = this.#startupRetryDelaysMs[Math.min(attempt, this.#startupRetryDelaysMs.length - 1)] ?? remaining;
      attempt += 1;
      await delay(Math.min(configured, remaining));
    }
  }

  async #ensureReady(scope: ResourceScope, pluginId: string): Promise<void> {
    scope.assertActive();
    if (this.#bridgeReady) return;
    this.#readiness ??= this.#probe(scope, pluginId).finally(() => { this.#readiness = undefined; });
    await this.#readiness;
    scope.assertActive();
  }

  async call<T>(scope: ResourceScope, pluginId: string, operation: string, input: unknown = {}): Promise<T> {
    await this.#ensureReady(scope, pluginId);
    let response = await this.#send(pluginId, operation, input);
    scope.assertActive();
    // A hot server-plugin reload can temporarily remove the route after the
    // browser Core was already marked ready. Retry only an unhandled 404 page;
    // structured Bridge errors such as WORKSPACE_NOT_FOUND are real business
    // results and must never execute the operation twice.
    if (isMissingBridgeRoute(response)) {
      this.#bridgeReady = false;
      await this.#ensureReady(scope, pluginId);
      response = await this.#send(pluginId, operation, input);
      scope.assertActive();
    }
    const body = (response.body ?? {}) as BridgeResponse;
    if (!response.ok || body.ok !== true) {
      const error = new Error('The workspace bridge request could not be completed') as Error & { code?: string };
      error.code = typeof body.error === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/u.test(body.error)
        ? body.error
        : 'WORKSPACE_UNAVAILABLE';
      throw error;
    }
    return body.data as T;
  }
}
