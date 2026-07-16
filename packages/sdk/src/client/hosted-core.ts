import { CORE_DISCOVERY_SYMBOL, type CoreDiscoverySnapshot } from '../contracts/core.js';

let loading: Promise<CoreDiscoverySnapshot | unknown> | undefined;

export async function ensureHostedCore(modulePath = '/api/plugins/ss-helper-sdk/browser/core.js'): Promise<CoreDiscoverySnapshot | unknown> {
  const current = Reflect.get(globalThis as object, CORE_DISCOVERY_SYMBOL) as CoreDiscoverySnapshot | undefined;
  if (current?.descriptor.state === 'ready') return current;
  loading ??= (async () => {
    const url = new URL(modulePath, globalThis.location?.href ?? 'http://localhost/').href;
    const module = await import(/* @vite-ignore */ url) as { coreReady?: Promise<unknown>; coreRuntime?: unknown };
    return module.coreReady === undefined ? module.coreRuntime : await module.coreReady;
  })();
  try { return await loading; } finally { loading = undefined; }
}
