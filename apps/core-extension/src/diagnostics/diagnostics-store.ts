import type { CoreDiagnosticEvent, CoreDiagnosticsSnapshot } from '@ss-helper/sdk';

export type DiagnosticCounts = { -readonly [Key in keyof Omit<CoreDiagnosticsSnapshot, 'generation' | 'events'>]: CoreDiagnosticsSnapshot[Key] };

const MAX_DIAGNOSTIC_EVENTS = 256;

export class DiagnosticsStore {
  readonly #events: CoreDiagnosticEvent[] = [];
  readonly #counts: DiagnosticCounts = { plugins: 0, handlers: 0, subscribers: 0, pending: 0, waiters: 0 };

  constructor(readonly generation: number) {}

  record(event: Omit<CoreDiagnosticEvent, 'timestamp' | 'generation'>): void {
    this.#events.push(Object.freeze({ timestamp: Date.now(), generation: this.generation, ...event }));
    if (this.#events.length > MAX_DIAGNOSTIC_EVENTS) this.#events.splice(0, this.#events.length - MAX_DIAGNOSTIC_EVENTS);
  }

  increment(key: keyof DiagnosticCounts, delta: number): void {
    this.#counts[key] = Math.max(0, this.#counts[key] + delta);
  }

  snapshot(): CoreDiagnosticsSnapshot {
    return Object.freeze({
      generation: this.generation,
      ...this.#counts,
      events: Object.freeze([...this.#events]),
    });
  }
}
