import type { CoreLifecycleDetail } from '@ss-helper/sdk';

export interface CoreRealm {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
}

export function dispatchLifecycle(target: CoreRealm, type: string, detail: CoreLifecycleDetail): void {
  const event = new Event(type);
  Object.defineProperty(event, 'detail', { value: Object.freeze(detail), enumerable: true });
  target.dispatchEvent(event);
}
