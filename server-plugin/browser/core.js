import { installCoreRuntime } from './lib/runtime/install-core-runtime.js';
import { createSillyTavernHostBridge } from './lib/host/silly-tavern-adapter.js';

const styleId = 'ss-helper-sdk-core-style';
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('link');
  style.id = styleId;
  style.rel = 'stylesheet';
  style.href = '/api/plugins/ss-helper-sdk/browser/core.css';
  document.head?.append(style);
}

const host = createSillyTavernHostBridge(globalThis);
if (host.capabilities.length === 0) throw new Error('SS-Helper SDK found no supported SillyTavern host capabilities');

export const coreRuntime = installCoreRuntime({
  coreVersion: '2.1.0',
  sdkPackageVersion: '2.1.0',
  apiMajor: 2,
  apiMinor: 1,
  buildId: 'ss-helper-sdk',
  contentDigest: 'runtime',
  capabilities: host.capabilities,
}, globalThis, {
  hostAdapter: host.hostAdapter,
  document: globalThis.document,
  settingsContainer: globalThis.document?.querySelector?.('#extensions_settings') ?? globalThis.document?.body,
});

export const coreReady = Promise.resolve(coreRuntime);
