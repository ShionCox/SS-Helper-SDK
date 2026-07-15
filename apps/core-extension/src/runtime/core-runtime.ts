import {
  CORE_LIFECYCLE_EVENT,
  SSHelperError,
  type CoreDescriptor,
  type CoreDiscoverySnapshot,
  type CorePort,
  type HostCapability,
  type PluginDescriptor,
  type PluginSession,
  type SessionCloseReason,
} from '@ss-helper/sdk';
import { EventHub } from '../communication/event-hub.js';
import { ServiceRegistry } from '../communication/service-registry.js';
import { DiagnosticsStore } from '../diagnostics/diagnostics-store.js';
import { PluginRegistry } from '../plugins/plugin-registry.js';
import { dispatchLifecycle, type CoreRealm } from './lifecycle.js';
import { PopupHost } from '../popup/popup-host.js';
import { SettingsHost } from '../settings/settings-host.js';
import type { TavernHostAdapter } from '../host/tavern-host-port.js';

export interface CoreRuntimeIdentity {
  readonly coreVersion: string;
  readonly sdkPackageVersion: string;
  readonly apiMajor: number;
  readonly apiMinor: number;
  readonly capabilities?: readonly HostCapability[];
  readonly buildId: string;
  readonly contentDigest: string;
}

export interface CoreRuntimeOptions {
  readonly hostAdapter?: TavernHostAdapter;
  readonly settingsContainer?: HTMLElement;
  readonly document?: Document;
}

export class CoreRuntime {
  readonly descriptor: CoreDescriptor;
  readonly diagnosticsStore: DiagnosticsStore;
  readonly services: ServiceRegistry;
  readonly events: EventHub;
  readonly plugins: PluginRegistry;
  readonly settings: SettingsHost;
  readonly popups: PopupHost;
  readonly port: CorePort;
  #active = true;
  #snapshot?: CoreDiscoverySnapshot;

  constructor(
    readonly generation: number,
    readonly identity: CoreRuntimeIdentity,
    private readonly realm: CoreRealm,
    private readonly transitionDisposed: (runtime: CoreRuntime) => void,
    options: CoreRuntimeOptions = {},
  ) {
    const capabilities = Object.freeze([...(identity.capabilities ?? [])]);
    this.descriptor = Object.freeze({
      kind: 'ss-helper-core',
      id: 'ss-helper.core',
      coreVersion: identity.coreVersion,
      sdkPackageVersion: identity.sdkPackageVersion,
      apiMajor: identity.apiMajor,
      apiMinor: identity.apiMinor,
      generation,
      state: 'ready',
      capabilities,
      artifact: Object.freeze({ buildId: identity.buildId, contentDigest: identity.contentDigest }),
    });
    this.diagnosticsStore = new DiagnosticsStore(generation);
    this.services = new ServiceRegistry(this.diagnosticsStore);
    this.events = new EventHub(this.diagnosticsStore);
    this.settings = new SettingsHost(this.descriptor);
    this.popups = new PopupHost(options.document ?? options.settingsContainer?.ownerDocument);
    this.plugins = new PluginRegistry(
      generation, identity.apiMajor, identity.apiMinor, capabilities,
      () => this.#active, this.services, this.events, this.diagnosticsStore,
      options.hostAdapter ?? {}, this.settings, this.popups,
    );
    if (options.settingsContainer !== undefined) this.settings.mount(options.settingsContainer);
    this.port = Object.freeze({
      connect: <Capabilities extends HostCapability>(descriptor: PluginDescriptor<Capabilities>): PluginSession<Capabilities> => this.connect(descriptor),
      diagnostics: () => this.diagnosticsStore.snapshot(),
    });
    this.diagnosticsStore.record({ type: 'core.ready' });
  }

  get active(): boolean { return this.#active; }

  attachSnapshot(snapshot: CoreDiscoverySnapshot): void { this.#snapshot = snapshot; }
  snapshot(): CoreDiscoverySnapshot {
    if (this.#snapshot === undefined) throw new SSHelperError('BRIDGE_CORRUPTED', 'Core snapshot was not installed');
    return this.#snapshot;
  }

  connect<Capabilities extends HostCapability>(descriptor: PluginDescriptor<Capabilities>): PluginSession<Capabilities> {
    if (!this.#active) throw new SSHelperError('CORE_DISPOSED', 'Core is disposed');
    return this.plugins.register(descriptor);
  }

  dispose(reason: SessionCloseReason = 'core_disposed', nextGeneration?: number): void {
    if (!this.#active) return;
    this.#active = false;
    this.plugins.closeAll(reason, nextGeneration);
    this.services.dispose();
    this.events.dispose();
    this.popups.dispose();
    this.diagnosticsStore.record({ type: 'core.disposed' });
    this.transitionDisposed(this);
  }

  emit(kind: 'ready' | 'replaced', previous?: CoreDescriptor): void {
    dispatchLifecycle(this.realm, CORE_LIFECYCLE_EVENT, {
      kind,
      ...(previous === undefined ? {} : { previous }),
      current: this.descriptor,
      generation: this.generation,
    });
  }
}
