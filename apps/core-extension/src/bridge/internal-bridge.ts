import { SSHelperError, type PlainData } from '@ss-helper/sdk';
import type { TavernHostAdapter } from '../host/tavern-host-port.js';
import type { ResourceScope } from '../plugins/session-scope.js';

const BRIDGE_PATH = '/api/plugins/ss-helper-sdk/internal/bridge/v1/call' as const;

type BridgeResponse = {
  readonly ok?: unknown;
  readonly data?: unknown;
  readonly error?: unknown;
  readonly message?: unknown;
};

/**
 * Private Core transport. Consumer plugins receive ports backed by this client
 * and never receive a route name, request headers, or caller identity hook.
 * This narrows accidental misuse but does not turn same-origin extensions into
 * mutually hostile security principals.
 */
export class InternalBridgeClient {
  constructor(private readonly hostAdapter: TavernHostAdapter) {}

  async call<T>(scope: ResourceScope, pluginId: string, operation: string, input: unknown = {}): Promise<T> {
    scope.assertActive();
    if (this.hostAdapter.request === undefined) {
      throw new SSHelperError('HOST_NOT_READY', 'The SillyTavern plugin request bridge is unavailable');
    }
    const response = await this.hostAdapter.request.send({
      path: BRIDGE_PATH,
      method: 'POST',
      body: { version: 1, pluginId, operation, input: input as PlainData },
    });
    scope.assertActive();
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
