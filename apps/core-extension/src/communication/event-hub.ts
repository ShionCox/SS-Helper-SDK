import { SSHelperError, type AnyEventContract } from '@ss-helper/sdk';
import type { DiagnosticsStore } from '../diagnostics/diagnostics-store.js';
import type { SessionScope } from '../plugins/session-scope.js';
import { assertPayload, contractBase, contractKey, validateContract } from './contracts.js';

interface Subscription { readonly owner: SessionScope; readonly contract: AnyEventContract; readonly listener: (payload: unknown) => void; }

export class EventHub {
  readonly #subscriptions = new Map<string, Set<Subscription>>();

  constructor(private readonly diagnostics: DiagnosticsStore) {}

  publish(owner: SessionScope, contract: AnyEventContract, payload: unknown): void {
    owner.assertActive();
    validateContract(contract, 'event');
    if (contract.provider !== owner.id) {
      throw new SSHelperError('PAYLOAD_INVALID', 'A session cannot publish another provider namespace', { reason: 'namespace' });
    }
    assertPayload(payload, contract.validatePayload, 'event');
    const key = contractKey(contract);
    const exact = this.#subscriptions.get(key);
    if (exact === undefined) {
      const base = contractBase(contract);
      if ([...this.#subscriptions.values()].some((set) => [...set].some((item) => contractBase(item.contract) === base))) {
        throw new SSHelperError('SERVICE_VERSION_MISMATCH', 'The event version or schema does not match subscribers');
      }
      return;
    }
    for (const subscription of [...exact]) {
      if (!subscription.owner.disposed) {
        try { subscription.listener(payload); } catch {
          throw new SSHelperError('PAYLOAD_INVALID', 'An event listener failed', { phase: 'listener' });
        }
      }
    }
  }

  subscribe(owner: SessionScope, contract: AnyEventContract, listener: (payload: unknown) => void): () => void {
    owner.assertActive();
    validateContract(contract, 'event');
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

  dispose(): void { this.#subscriptions.clear(); }
}
