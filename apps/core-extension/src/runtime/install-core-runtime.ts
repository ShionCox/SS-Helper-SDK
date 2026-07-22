import {
  CORE_DISCOVERY_SYMBOL,
  CORE_LIFECYCLE_EVENT,
  SSHelperError,
  type CoreDescriptor,
  type CoreDiscoverySnapshot,
} from '@ss-helper/sdk';
import { CoreRuntime, type CoreRuntimeIdentity, type CoreRuntimeOptions } from './core-runtime.js';
import { dispatchLifecycle, type CoreRealm } from './lifecycle.js';

const runtimes = new WeakMap<CoreDiscoverySnapshot, CoreRuntime>();

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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
    && isNonEmptyString(descriptor.coreVersion)
    && isNonEmptyString(descriptor.sdkPackageVersion)
    && typeof descriptor.apiVersion === 'string'
    && /^\d+\.\d+\.\d+$/u.test(descriptor.apiVersion)
    && Number.isSafeInteger(descriptor.generation)
    && descriptor.generation > 0
    && (descriptor.state === 'ready' || descriptor.state === 'disposed')
    && Array.isArray(descriptor.capabilities)
    && descriptor.capabilities.every(isNonEmptyString)
    && typeof descriptor.artifact === 'object'
    && descriptor.artifact !== null
    && isNonEmptyString(descriptor.artifact.buildId)
    && isNonEmptyString(descriptor.artifact.contentDigest);
}

function makeSnapshot(descriptor: CoreDescriptor, runtime: CoreRuntime): CoreDiscoverySnapshot {
  return Object.freeze({ kind: 'ss-helper-core-discovery', descriptor, port: runtime.port });
}

function defineSnapshot(realm: CoreRealm, expected: unknown, snapshot: CoreDiscoverySnapshot): void {
  let current: unknown;
  try { current = Reflect.get(realm as object, CORE_DISCOVERY_SYMBOL); } catch {
    throw new SSHelperError('BRIDGE_CORRUPTED', 'The Core discovery bridge could not be read');
  }
  if (current !== expected) {
    throw new SSHelperError('BRIDGE_CORRUPTED', 'The Core discovery bridge changed during installation');
  }
  try {
    Object.defineProperty(realm, CORE_DISCOVERY_SYMBOL, {
      value: snapshot,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  } catch {
    throw new SSHelperError('BRIDGE_CORRUPTED', 'The Core discovery bridge could not be updated');
  }
}

function sameArtifact(snapshot: CoreDiscoverySnapshot, identity: CoreRuntimeIdentity): boolean {
  const descriptor = snapshot.descriptor;
  return descriptor.coreVersion === identity.coreVersion
    && descriptor.apiVersion === identity.apiVersion
    && descriptor.artifact.buildId === identity.buildId
    && descriptor.artifact.contentDigest === identity.contentDigest;
}

export function installCoreRuntime(identity: CoreRuntimeIdentity, target?: CoreRealm, options: CoreRuntimeOptions = {}): CoreRuntime {
  const realm = target ?? (globalThis as unknown as CoreRealm);
  if (typeof realm.addEventListener !== 'function' || typeof realm.dispatchEvent !== 'function') {
    throw new SSHelperError('BRIDGE_CORRUPTED', 'Core requires an event-capable realm');
  }
  let current: unknown;
  try { current = Reflect.get(realm as object, CORE_DISCOVERY_SYMBOL); } catch {
    throw new SSHelperError('BRIDGE_CORRUPTED', 'The Core discovery bridge could not be read');
  }
  if (current !== undefined && !isSnapshot(current)) {
    throw new SSHelperError('BRIDGE_CORRUPTED', 'The discovery slot contains an invalid value');
  }
  if (current?.descriptor.state === 'ready') {
    if (!sameArtifact(current, identity)) throw new SSHelperError('CORE_ALREADY_ACTIVE', 'A different Core artifact is active');
    const existing = runtimes.get(current);
    if (existing === undefined) throw new SSHelperError('BRIDGE_CORRUPTED', 'The active Core runtime is not owned by this installer');
    return existing;
  }
  const generation = current === undefined ? 1 : current.descriptor.generation + 1;
  if (!Number.isSafeInteger(generation) || generation <= 0) throw new SSHelperError('BRIDGE_CORRUPTED', 'The Core generation is invalid');
  let installed!: CoreDiscoverySnapshot;
  const runtime = new CoreRuntime(generation, identity, realm, (disposing) => {
    if (disposing.snapshot() !== installed || Reflect.get(realm as object, CORE_DISCOVERY_SYMBOL) !== installed) {
      throw new SSHelperError('BRIDGE_CORRUPTED', 'The discovery bridge was replaced before Core disposal');
    }
    const disposedDescriptor: CoreDescriptor = Object.freeze({
      ...disposing.descriptor,
      state: 'disposed',
      capabilities: Object.freeze([...disposing.descriptor.capabilities]),
      artifact: Object.freeze({ ...disposing.descriptor.artifact }),
    });
    const disposed = makeSnapshot(disposedDescriptor, disposing);
    defineSnapshot(realm, installed, disposed);
    installed = disposed;
    disposing.attachSnapshot(disposed);
    runtimes.set(disposed, disposing);
    dispatchLifecycle(realm, CORE_LIFECYCLE_EVENT, {
      kind: 'disposed', previous: disposing.descriptor, current: disposedDescriptor, generation: disposing.generation,
    });
  }, options);
  installed = makeSnapshot(runtime.descriptor, runtime);
  defineSnapshot(realm, current, installed);
  runtime.attachSnapshot(installed);
  runtimes.set(installed, runtime);
  runtime.emit(current === undefined ? 'ready' : 'replaced', current?.descriptor);
  return runtime;
}
