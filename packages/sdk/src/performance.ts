export type SSHelperPerformancePlugin = 'core' | 'llm' | 'memory';
export type SSHelperPerformanceStatus = 'success' | 'error' | 'aborted';

export interface SSHelperPerformanceEntry {
  readonly plugin: SSHelperPerformancePlugin;
  readonly stage: string;
  readonly kind: 'checkpoint' | 'span';
  readonly status: SSHelperPerformanceStatus;
  readonly atMs: number;
  readonly elapsedMs: number;
  readonly deltaMs: number;
  readonly durationMs?: number;
}

interface PerformanceTimelineState {
  readonly originMs: number;
  readonly lastByPlugin: Partial<Record<SSHelperPerformancePlugin, number>>;
  readonly entries: SSHelperPerformanceEntry[];
}

const TIMELINE_SYMBOL = Symbol.for('ss-helper.performance.timeline.v0');
const MAX_ENTRIES = 1_000;

type TraceGlobal = typeof globalThis & {
  __SSHelperPerformanceTrace?: unknown;
  [TIMELINE_SYMBOL]?: PerformanceTimelineState;
};

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function enabled(): boolean {
  if ((globalThis as TraceGlobal).__SSHelperPerformanceTrace === true) return true;
  try {
    return /(?:^|[?&])ssHelperPerformance=1(?:&|$)/u.test(globalThis.location?.search ?? '');
  } catch {
    return false;
  }
}

function consoleTraceEnabled(): boolean {
  try {
    return /(?:^|[?&])ssHelperPerformance=1(?:&|$)/u.test(globalThis.location?.search ?? '');
  } catch {
    return false;
  }
}

function state(atMs: number): PerformanceTimelineState {
  const target = globalThis as TraceGlobal;
  if (!target[TIMELINE_SYMBOL]) {
    target[TIMELINE_SYMBOL] = { originMs: atMs, lastByPlugin: {}, entries: [] };
  }
  return target[TIMELINE_SYMBOL];
}

function append(
  plugin: SSHelperPerformancePlugin,
  stage: string,
  kind: SSHelperPerformanceEntry['kind'],
  status: SSHelperPerformanceStatus,
  atMs: number,
  durationMs?: number,
): SSHelperPerformanceEntry | undefined {
  if (!enabled()) return undefined;
  const timeline = state(atMs);
  const previous = timeline.lastByPlugin[plugin] ?? timeline.originMs;
  const entry: SSHelperPerformanceEntry = Object.freeze({
    plugin,
    stage,
    kind,
    status,
    atMs,
    elapsedMs: atMs - timeline.originMs,
    deltaMs: atMs - previous,
    ...(durationMs === undefined ? {} : { durationMs }),
  });
  timeline.lastByPlugin[plugin] = atMs;
  timeline.entries.push(entry);
  if (timeline.entries.length > MAX_ENTRIES) timeline.entries.splice(0, timeline.entries.length - MAX_ENTRIES);
  if (consoleTraceEnabled()) console.info('[SS-Helper Performance]', JSON.stringify(entry));
  return entry;
}

export function traceSSHelperPerformance(
  plugin: SSHelperPerformancePlugin,
  stage: string,
  status: SSHelperPerformanceStatus = 'success',
): SSHelperPerformanceEntry | undefined {
  return append(plugin, stage, 'checkpoint', status, now());
}

export function startSSHelperPerformanceSpan(
  plugin: SSHelperPerformancePlugin,
  stage: string,
): (status?: SSHelperPerformanceStatus) => SSHelperPerformanceEntry | undefined {
  if (!enabled()) return () => undefined;
  const startedAt = now();
  let finished = false;
  return (status = 'success') => {
    if (finished) return undefined;
    finished = true;
    const endedAt = now();
    return append(plugin, stage, 'span', status, endedAt, endedAt - startedAt);
  };
}

export function readSSHelperPerformanceTimeline(): readonly SSHelperPerformanceEntry[] {
  const timeline = (globalThis as TraceGlobal)[TIMELINE_SYMBOL];
  return timeline ? timeline.entries.map((entry) => ({ ...entry })) : [];
}

export function clearSSHelperPerformanceTimeline(): void {
  Reflect.deleteProperty(globalThis as TraceGlobal, TIMELINE_SYMBOL);
}
