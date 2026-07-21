import { SSHelperError } from '../errors.js';

type UnknownRecord = Record<string, unknown>;
type HostFunction = (...args: unknown[]) => unknown;

export interface TavernReadyTarget {
  readonly SillyTavern?: { readonly getContext?: () => unknown };
  readonly eventSource?: unknown;
  readonly eventTypes?: unknown;
  readonly event_types?: unknown;
}

export interface WaitForTavernReadyOptions {
  readonly target?: TavernReadyTarget;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface TavernReadySnapshot {
  readonly appReadyEvent: string;
}

const asRecord = (value: unknown): UnknownRecord | undefined => typeof value === 'object' && value !== null
  ? value as UnknownRecord
  : undefined;
const asFunction = (value: unknown): HostFunction | undefined => typeof value === 'function'
  ? value as HostFunction
  : undefined;

function contextOf(target: TavernReadyTarget): UnknownRecord | undefined {
  try { return asRecord(target.SillyTavern?.getContext?.()); } catch { return undefined; }
}

function eventName(context: UnknownRecord | undefined, target: TavernReadyTarget): string {
  const names = asRecord(context?.eventTypes) ?? asRecord(context?.event_types)
    ?? asRecord(target.eventTypes) ?? asRecord(target.event_types);
  return typeof names?.APP_READY === 'string' && names.APP_READY.length > 0 ? names.APP_READY : 'app_ready';
}

function eventSourceOf(context: UnknownRecord | undefined, target: TavernReadyTarget): UnknownRecord | undefined {
  return asRecord(context?.eventSource) ?? asRecord(target.eventSource);
}

/**
 * Waits for SillyTavern's replayable APP_READY lifecycle event.  The event
 * emitter replays APP_READY to late listeners, so this also works for a
 * consumer loaded after the application has already finished initialising.
 */
export async function waitForTavernReady(options: WaitForTavernReadyOptions = {}): Promise<TavernReadySnapshot> {
  const target = options.target ?? (globalThis as unknown as TavernReadyTarget);
  const timeoutMs = Math.max(0, options.timeoutMs ?? 15_000);

  return await new Promise<TavernReadySnapshot>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poller: ReturnType<typeof setInterval> | undefined;
    let subscribedSource: UnknownRecord | undefined;
    let subscribedEvent = '';
    let listener: HostFunction | undefined;

    const unsubscribe = (): void => {
      if (subscribedSource === undefined || listener === undefined) return;
      const remove = asFunction(subscribedSource.off) ?? asFunction(subscribedSource.removeListener);
      try { remove?.call(subscribedSource, subscribedEvent, listener); } catch { /* Host teardown is best effort. */ }
      subscribedSource = undefined;
      listener = undefined;
    };
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      if (poller !== undefined) clearInterval(poller);
      unsubscribe();
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = (): void => finish(() => reject(new SSHelperError('CALL_ABORTED', 'Waiting for SillyTavern readiness was aborted')));
    const complete = (name: string): void => {
      const context = contextOf(target);
      if (context === undefined || typeof target.SillyTavern?.getContext !== 'function') return;
      finish(() => resolve(Object.freeze({ appReadyEvent: name })));
    };
    const inspect = (): void => {
      if (settled) return;
      const context = contextOf(target);
      if (context === undefined || typeof target.SillyTavern?.getContext !== 'function') return;
      const source = eventSourceOf(context, target);
      const on = asFunction(source?.on);
      if (source === undefined || on === undefined) return;
      const name = eventName(context, target);
      if (source === subscribedSource && name === subscribedEvent) return;
      unsubscribe();
      const nextListener: HostFunction = () => complete(name);
      try {
        subscribedSource = source;
        subscribedEvent = name;
        listener = nextListener;
        on.call(source, name, nextListener);
      } catch {
        unsubscribe();
      }
    };

    if (options.signal?.aborted === true) { onAbort(); return; }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    inspect();
    if (settled) return;
    poller = setInterval(inspect, 25);
    timer = setTimeout(() => finish(() => reject(new SSHelperError(
      'HOST_NOT_READY',
      'SillyTavern did not emit APP_READY before the deadline',
      { timeoutMs },
    ))), timeoutMs);
  });
}
