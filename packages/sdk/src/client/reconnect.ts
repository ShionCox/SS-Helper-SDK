import type { HostCapability } from '../contracts/host.js';
import type { PluginSession, SessionCloseInfo } from '../contracts/plugin.js';
import { SSHelperError } from '../errors.js';
import { CORE_LIFECYCLE_EVENT } from '../contracts/core.js';
import {
  connectSSHelper,
  type ConnectDescriptor,
  type ConnectSSHelperOptions,
} from './connect-core.js';

export const DEFAULT_RECONNECT_POLICY = Object.freeze({
  maxAttempts: 3,
  totalDeadlineMs: 10_000,
  backoffMs: Object.freeze([100, 500, 1_500] as const),
  singleFlight: true,
});

export interface ReconnectPolicy {
  readonly maxAttempts?: number;
  readonly totalDeadlineMs?: number;
  readonly backoffMs?: readonly number[];
}

export interface BootstrapOptions extends ConnectSSHelperOptions {
  readonly reconnect?: ReconnectPolicy;
}

export interface SessionBootstrap<Capabilities extends HostCapability> {
  readonly current: PluginSession<Capabilities>;
  readonly closed: Promise<SessionCloseInfo>;
  dispose(): void;
}

function delay(ms: number, signal: AbortSignal, target?: ConnectSSHelperOptions['target']): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new SSHelperError('CALL_ABORTED', 'Reconnect was aborted'));
      return;
    }
    const eventTarget = target ?? (globalThis as unknown as ConnectSSHelperOptions['target']);
    let done = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      eventTarget?.removeEventListener(CORE_LIFECYCLE_EVENT, onLifecycle);
    };
    const finish = (): void => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    const onLifecycle: EventListener = () => finish();
    const onAbort = (): void => {
      if (done) return;
      done = true;
      cleanup();
      reject(new SSHelperError('CALL_ABORTED', 'Reconnect was aborted'));
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', onAbort, { once: true });
    eventTarget?.addEventListener(CORE_LIFECYCLE_EVENT, onLifecycle);
  });
}

export async function bootstrapSSHelper<Capabilities extends HostCapability = HostCapability>(
  descriptor: ConnectDescriptor<Capabilities>,
  onSession: (session: PluginSession<Capabilities>) => void,
  options: BootstrapOptions = {},
): Promise<SessionBootstrap<Capabilities>> {
  const controller = new AbortController();
  const maxAttempts = options.reconnect?.maxAttempts ?? DEFAULT_RECONNECT_POLICY.maxAttempts;
  const totalDeadlineMs = options.reconnect?.totalDeadlineMs ?? DEFAULT_RECONNECT_POLICY.totalDeadlineMs;
  const backoffMs = options.reconnect?.backoffMs ?? DEFAULT_RECONNECT_POLICY.backoffMs;
  let current = await connectSSHelper(descriptor, { ...options, signal: controller.signal });
  onSession(current);

  let resolveClosed!: (info: SessionCloseInfo) => void;
  let rejectClosed!: (error: unknown) => void;
  const closed = new Promise<SessionCloseInfo>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });

  void (async () => {
    while (!controller.signal.aborted) {
      const close = await current.closed;
      if (close.reason !== 'core_disposed' && close.reason !== 'core_replaced') {
        resolveClosed(close);
        return;
      }
      const reconnectStartedAt = Date.now();
      const reconnectDeadline = reconnectStartedAt + Math.max(0, totalDeadlineMs);
      let replacement: PluginSession<Capabilities> | undefined;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        let remaining = reconnectDeadline - Date.now();
        if (remaining <= 0) break;
        try {
          const backoff = Math.max(0, backoffMs[attempt] ?? backoffMs.at(-1) ?? 0);
          await delay(Math.min(backoff, remaining), controller.signal, options.target);
          remaining = reconnectDeadline - Date.now();
          if (remaining <= 0) break;
          replacement = await connectSSHelper(descriptor, {
            ...options,
            timeoutMs: Math.min(options.timeoutMs ?? remaining, remaining),
            signal: controller.signal,
          });
          break;
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof SSHelperError && error.code === 'API_INCOMPATIBLE') {
            rejectClosed(error);
            return;
          }
        }
      }
      if (replacement === undefined) {
        rejectClosed(new SSHelperError('CORE_RECONNECT_EXHAUSTED', 'Core reconnect policy was exhausted'));
        return;
      }
      current = replacement;
      onSession(current);
    }
  })().catch(rejectClosed);

  return {
    get current() { return current; },
    closed,
    dispose() {
      controller.abort();
      current.dispose();
      resolveClosed(Object.freeze({ reason: 'consumer_dispose', generation: current.generation }));
    },
  };
}
