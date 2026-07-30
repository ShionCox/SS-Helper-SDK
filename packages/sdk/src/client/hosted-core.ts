import { CORE_DISCOVERY_SYMBOL, type CoreDiscoverySnapshot } from '../contracts/core.js';
import { startSSHelperPerformanceSpan } from '../performance.js';

let loading: Promise<CoreDiscoverySnapshot | unknown> | undefined;

export async function ensureHostedCore(modulePath = '/api/plugins/ss-helper-sdk/browser/core.js'): Promise<CoreDiscoverySnapshot | unknown> {
  const finish = startSSHelperPerformanceSpan('core', 'hosted-core.ensure');
  const current = Reflect.get(globalThis as object, CORE_DISCOVERY_SYMBOL) as CoreDiscoverySnapshot | undefined;
  if (current?.descriptor.state === 'ready') { finish(); return current; }
  loading ??= (async () => {
    const url = new URL(modulePath, globalThis.location?.href ?? 'http://localhost/').href;
    const module = await import(/* @vite-ignore */ url) as {
      ensureCoreReady?: () => Promise<unknown>;
      coreReady?: Promise<unknown>;
      coreRuntime?: unknown;
    };
    if (typeof module.ensureCoreReady === 'function') return await module.ensureCoreReady();
    return module.coreReady === undefined ? module.coreRuntime : await module.coreReady;
  })();
  try {
    const result = await loading;
    finish();
    return result;
  } catch (error) {
    finish('error');
    throw error;
  } finally { loading = undefined; }
}
