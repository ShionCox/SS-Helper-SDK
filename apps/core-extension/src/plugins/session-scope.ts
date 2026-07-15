import { SSHelperError } from '@ss-helper/sdk';

export interface SessionScope {
  readonly id: string;
  readonly generation: number;
  readonly disposed: boolean;
  assertActive(): void;
  addCleanup(cleanup: () => void): () => void;
}

export class ResourceScope implements SessionScope {
  readonly #cleanups = new Set<() => void>();
  #disposed = false;

  constructor(readonly id: string, readonly generation: number, private readonly coreActive: () => boolean) {}

  get disposed(): boolean { return this.#disposed; }

  assertActive(): void {
    if (!this.coreActive()) throw new SSHelperError('STALE_SESSION', 'The plugin session belongs to a stale Core generation', {
      pluginId: this.id,
      generation: this.generation,
    });
    if (this.#disposed) throw new SSHelperError('PLUGIN_DISPOSED', 'The plugin session is disposed', { pluginId: this.id });
  }

  addCleanup(cleanup: () => void): () => void {
    this.assertActive();
    let active = true;
    const wrapped = (): void => {
      if (!active) return;
      active = false;
      this.#cleanups.delete(wrapped);
      cleanup();
    };
    this.#cleanups.add(wrapped);
    return wrapped;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const cleanup of [...this.#cleanups].reverse()) cleanup();
    this.#cleanups.clear();
  }
}
