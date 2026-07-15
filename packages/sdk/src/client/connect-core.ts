import {
  API_MAJOR,
  API_MINOR,
  CORE_DISCOVERY_SYMBOL,
  CORE_LIFECYCLE_EVENT,
  SDK_PACKAGE_VERSION,
  type CoreDiscoverySnapshot,
  type CoreLifecycleDetail,
} from '../contracts/core.js';
import type { HostCapability } from '../contracts/host.js';
import type { PluginDescriptor, PluginSession } from '../contracts/plugin.js';
import { SSHelperError } from '../errors.js';

export interface DiscoveryTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface ConnectSSHelperOptions {
  readonly target?: DiscoveryTarget;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export type ConnectDescriptor<Capabilities extends HostCapability> = Omit<
  PluginDescriptor<Capabilities>,
  'sdkPackageVersion' | 'apiMajor' | 'minApiMinor'
> & {
  readonly sdkPackageVersion?: string;
  readonly apiMajor?: number;
  readonly minApiMinor?: number;
};

function targetOrGlobal(target?: DiscoveryTarget): DiscoveryTarget {
  const value = target ?? (globalThis as unknown as DiscoveryTarget);
  if (typeof value.addEventListener !== 'function' || typeof value.removeEventListener !== 'function') {
    throw new SSHelperError('BRIDGE_CORRUPTED', 'The discovery target is not an event target');
  }
  return value;
}

function readSnapshot(target: DiscoveryTarget): unknown {
  try { return Reflect.get(target as object, CORE_DISCOVERY_SYMBOL); } catch {
    throw new SSHelperError('BRIDGE_CORRUPTED', 'The Core discovery snapshot could not be read');
  }
}

function isSnapshot(value: unknown): value is CoreDiscoverySnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CoreDiscoverySnapshot>;
  const descriptor = candidate.descriptor;
  return candidate.kind === 'ss-helper-core-discovery'
    && typeof candidate.port?.connect === 'function'
    && typeof candidate.port?.diagnostics === 'function'
    && typeof descriptor === 'object'
    && descriptor !== null
    && descriptor.kind === 'ss-helper-core'
    && descriptor.id === 'ss-helper.core'
    && Number.isSafeInteger(descriptor.generation)
    && descriptor.generation > 0
    && (descriptor.state === 'ready' || descriptor.state === 'disposed');
}

function normalizedDescriptor<Capabilities extends HostCapability>(
  descriptor: ConnectDescriptor<Capabilities>,
): PluginDescriptor<Capabilities> {
  return Object.freeze({
    ...descriptor,
    sdkPackageVersion: descriptor.sdkPackageVersion ?? SDK_PACKAGE_VERSION,
    apiMajor: descriptor.apiMajor ?? API_MAJOR,
    minApiMinor: descriptor.minApiMinor ?? API_MINOR,
    capabilities: Object.freeze([...descriptor.capabilities]),
  });
}

function connectSnapshot<Capabilities extends HostCapability>(
  snapshot: CoreDiscoverySnapshot,
  descriptor: PluginDescriptor<Capabilities>,
): PluginSession<Capabilities> | undefined {
  if (snapshot.descriptor.state !== 'ready') return undefined;
  if (snapshot.descriptor.apiMajor !== descriptor.apiMajor || snapshot.descriptor.apiMinor < descriptor.minApiMinor) {
    throw new SSHelperError('API_INCOMPATIBLE', 'Core API version is incompatible', {
      requiredMajor: descriptor.apiMajor,
      requiredMinor: descriptor.minApiMinor,
      actualMajor: snapshot.descriptor.apiMajor,
      actualMinor: snapshot.descriptor.apiMinor,
    });
  }
  const missing = descriptor.capabilities.filter((capability) => !snapshot.descriptor.capabilities.includes(capability));
  if (missing.length > 0) {
    throw new SSHelperError('API_INCOMPATIBLE', 'Core capabilities are incompatible', { missing });
  }
  return snapshot.port.connect(descriptor);
}

export async function connectSSHelper<Capabilities extends HostCapability = HostCapability>(
  input: ConnectDescriptor<Capabilities>,
  options: ConnectSSHelperOptions = {},
): Promise<PluginSession<Capabilities>> {
  const target = targetOrGlobal(options.target);
  const descriptor = normalizedDescriptor(input);
  const timeoutMs = options.timeoutMs ?? 5_000;
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let lastSeenGeneration = 0;
  let sawSnapshot = false;

  return await new Promise<PluginSession<Capabilities>>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      target.removeEventListener(CORE_LIFECYCLE_EVENT, onLifecycle);
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const inspect = (value: unknown): void => {
      if (value === undefined) return;
      sawSnapshot = true;
      if (!isSnapshot(value)) {
        finish(() => reject(new SSHelperError('BRIDGE_CORRUPTED', 'The Core discovery snapshot is invalid')));
        return;
      }
      if (value.descriptor.generation < lastSeenGeneration) return;
      lastSeenGeneration = value.descriptor.generation;
      try {
        const session = connectSnapshot(value, descriptor);
        if (session !== undefined) finish(() => resolve(session));
      } catch (error) {
        finish(() => reject(error));
      }
    };
    const onLifecycle: EventListener = (event) => {
      const detail = (event as Event & { readonly detail?: CoreLifecycleDetail }).detail;
      if (detail !== undefined && detail.generation < lastSeenGeneration) return;
      try { inspect(readSnapshot(target)); } catch (error) { finish(() => reject(error)); }
    };
    const onAbort = (): void => finish(() => reject(new SSHelperError('CALL_ABORTED', 'Core connection was aborted')));

    let first: unknown;
    try { first = readSnapshot(target); } catch (error) { finish(() => reject(error)); return; }
    inspect(first);
    if (settled) return;
    target.addEventListener(CORE_LIFECYCLE_EVENT, onLifecycle);
    let second: unknown;
    try { second = readSnapshot(target); } catch (error) { finish(() => reject(error)); return; }
    if (second !== first) inspect(second);
    if (settled) return;
    if (options.signal?.aborted === true) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(() => reject(new SSHelperError(
      sawSnapshot ? 'CORE_TIMEOUT' : 'CORE_MISSING',
      sawSnapshot ? 'Core did not become ready before the deadline' : 'SS-Helper Core is not installed',
    ))), Math.max(0, deadline - Date.now()));
  });
}
