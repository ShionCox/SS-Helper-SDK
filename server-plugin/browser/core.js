import { installCoreRuntime } from './lib/runtime/install-core-runtime.js';
import { createSillyTavernHostBridge } from './lib/host/silly-tavern-adapter.js';
import { CORE_DISCOVERY_SYMBOL } from './vendor/sdk/contracts/core.js';
import { SSHelperError } from './vendor/sdk/errors.js';
import { waitForTavernReady } from './vendor/sdk/client/tavern-ready.js';

const styleId = 'ss-helper-sdk-core-style';
const iconStyleId = 'ss-helper-sdk-icon-style';
let loading;
let iconStyleFailed = false;
export let coreRuntime;

function activeCoreSnapshot() {
  const candidate = Reflect.get(globalThis, CORE_DISCOVERY_SYMBOL);
  if (candidate?.kind !== 'ss-helper-core-discovery' || candidate.descriptor?.state !== 'ready') return undefined;
  if (candidate.descriptor.id !== 'ss-helper.core' || typeof candidate.port?.connect !== 'function') return undefined;
  return candidate;
}

function ensureStyleLink(document, id, pathname, contentDigest, onError) {
  const suffix = typeof contentDigest === 'string' && /^[a-f0-9]{64}$/u.test(contentDigest) ? `?v=${contentDigest}` : '';
  const href = `${pathname}${suffix}`;
  const current = document.getElementById(id);
  if (current?.tagName === 'LINK') {
    if (current.getAttribute('href') !== href) current.setAttribute('href', href);
    if (onError && current.dataset.ssHelperErrorListener !== 'true') {
      current.dataset.ssHelperErrorListener = 'true';
      current.addEventListener('error', onError);
    }
    return;
  }
  current?.remove();
  const style = document.createElement('link');
  style.id = id;
  style.rel = 'stylesheet';
  style.href = href;
  if (onError) {
    style.dataset.ssHelperErrorListener = 'true';
    style.addEventListener('error', onError);
  }
  document.head?.append(style);
}

function ensureCoreStyle(contentDigest) {
  const document = globalThis.document;
  if (document === undefined) return;
  ensureStyleLink(document, styleId, '/api/plugins/ss-helper-sdk/browser/core.css', contentDigest);
  ensureStyleLink(document, iconStyleId, '/api/plugins/ss-helper-sdk/browser/fontawesome/ss-helper-icons.css', contentDigest, () => {
    iconStyleFailed = true;
    coreRuntime?.diagnosticsStore?.record({ type: 'core.ui.icon.degraded', code: 'ICON_STYLESHEET_LOAD_FAILED' });
  });
}

/**
 * The release manifest is written after the browser payload is assembled, so
 * it can carry a non-self-referential digest of the deployed Core tree. A
 * source checkout without a manifest remains usable for local development.
 */
async function loadArtifactDigest() {
  try {
    const response = await fetch(new URL('../artifact-manifest.json', import.meta.url));
    if (!response.ok) return undefined;
    const document = await response.json();
    const digest = typeof document?.contentDigest === 'string'
      ? document.contentDigest
      : typeof document?.artifact?.contentDigest === 'string'
        ? document.artifact.contentDigest
        : typeof document?.artifacts?.['SS-Helper-SDK']?.contentDigest === 'string'
          ? document.artifacts['SS-Helper-SDK'].contentDigest
          : undefined;
    return typeof digest === 'string' && /^[a-f0-9]{64}$/u.test(digest) ? digest : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Initialisation is deliberately asynchronous.  SillyTavern loads extensions
 * before APP_READY, and a rejected module evaluation is cached permanently by
 * browsers.  A failed attempt therefore clears its single-flight slot so a
 * later consumer can retry once the host has finished starting.
 */
export function ensureCoreReady() {
  const active = activeCoreSnapshot();
  if (active !== undefined) return Promise.resolve(active);
  if (coreRuntime?.active) return Promise.resolve(coreRuntime);
  if (loading !== undefined) return loading;
  const attempt = (async () => {
    await waitForTavernReady({ timeoutMs: 15_000 });
    // The extension entry and the hosted fallback may be separate ESM module
    // instances.  They share the discovery slot but not their module-local
    // runtime ownership map, so always reuse a Core another instance published
    // while this attempt was waiting.
    const published = activeCoreSnapshot();
    if (published !== undefined) return published;
    const [host, artifactDigest] = await Promise.all([
      Promise.resolve(createSillyTavernHostBridge(globalThis)),
      loadArtifactDigest(),
    ]);
    if (host.capabilities.length === 0) {
      throw new SSHelperError('HOST_NOT_READY', 'SillyTavern host capabilities are not available yet');
    }
    ensureCoreStyle(artifactDigest);
    const runtime = installCoreRuntime({
      coreVersion: '2.2.0',
      sdkPackageVersion: '2.2.0',
      apiMajor: 2,
      apiMinor: 2,
      buildId: 'ss-helper-sdk',
      contentDigest: artifactDigest ?? 'runtime',
      capabilities: [...host.capabilities, 'workspace.recovery', 'secrets.read', 'secrets.write'],
    }, globalThis, {
      hostAdapter: host.hostAdapter,
      document: globalThis.document,
      settingsContainer: globalThis.document?.querySelector?.('#extensions_settings') ?? globalThis.document?.body,
    });
    coreRuntime = runtime;
    if (iconStyleFailed) runtime.diagnosticsStore.record({ type: 'core.ui.icon.degraded', code: 'ICON_STYLESHEET_LOAD_FAILED' });
    return runtime;
  })();
  loading = attempt;
  return attempt.finally(() => { if (loading === attempt) loading = undefined; });
}

export const coreReady = ensureCoreReady();
void coreReady.catch(() => undefined);
