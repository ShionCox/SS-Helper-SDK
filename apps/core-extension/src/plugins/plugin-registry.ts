import {
  SSHelperError,
  type AnyEventContract,
  type AnyServiceContract,
  type CallOptions,
  type EventPort,
  type HostCapability,
  type HostPort,
  type PluginDescriptor,
  type PluginSession,
  type ServicePort,
  type SessionCloseInfo,
  type SessionCloseReason,
  type SettingsAdapter,
  type SettingsSchema,
  type PopupRegistration,
  type PopupToken,
  type PlainData,
  type UiPort,
} from '@ss-helper/sdk';
import type { EventHub } from '../communication/event-hub.js';
import type { ServiceRegistry } from '../communication/service-registry.js';
import type { DiagnosticsStore } from '../diagnostics/diagnostics-store.js';
import { ResourceScope } from './session-scope.js';
import { createTavernHostPort, type TavernHostAdapter } from '../host/tavern-host-port.js';
import type { SettingsHost } from '../settings/settings-host.js';
import type { PopupHost } from '../popup/popup-host.js';

export interface PluginSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly pluginVersion: string;
  readonly generation: number;
  readonly health: 'healthy' | 'degraded';
  readonly compatibility: 'compatible';
  readonly lastError?: string;
  readonly capabilities: readonly HostCapability[];
  readonly requestedCapabilities: readonly HostCapability[];
}

class PluginSessionImpl<Capabilities extends HostCapability> implements PluginSession<Capabilities> {
  readonly #scope: ResourceScope;
  readonly #close: (info: SessionCloseInfo) => void;
  readonly closed: Promise<SessionCloseInfo>;
  readonly services: ServicePort;
  readonly events: EventPort;
  readonly host: HostPort<Capabilities>;
  readonly ui: UiPort;
  #closed = false;

  constructor(
    readonly descriptor: PluginDescriptor<Capabilities>,
    readonly generation: number,
    coreActive: () => boolean,
    private readonly remove: (session: PluginSessionImpl<Capabilities>) => void,
    services: ServiceRegistry,
    events: EventHub,
    granted: readonly Capabilities[],
    hostAdapter: TavernHostAdapter,
    private readonly settingsHost: SettingsHost,
    private readonly popupHost: PopupHost,
  ) {
    this.#scope = new ResourceScope(descriptor.id, generation, coreActive);
    let close!: (info: SessionCloseInfo) => void;
    this.closed = new Promise((resolve) => { close = resolve; });
    this.#close = close;
    this.services = Object.freeze({
      expose: (contract: AnyServiceContract, handler: (request: unknown, context: unknown) => unknown) => services.expose(this.#scope, contract, handler as never),
      waitFor: (contract: AnyServiceContract, options?: CallOptions) => services.waitFor(this.#scope, contract, options),
      call: (contract: AnyServiceContract, request: unknown, options?: CallOptions) => services.call(this.#scope, contract, request, options),
    }) as ServicePort;
    this.events = Object.freeze({
      publish: (contract: AnyEventContract, payload: unknown) => events.publish(this.#scope, contract, payload),
      subscribe: (contract: AnyEventContract, listener: (payload: unknown) => void) => events.subscribe(this.#scope, contract, listener),
    }) as EventPort;
    this.host = createTavernHostPort(this.#scope, granted, hostAdapter);
    this.ui = Object.freeze({ openPopup: <Input extends PlainData>(token: PopupToken<Input>, input: Input) => this.popupHost.open(this.#scope, token, input) });
  }

  registerSettings(schema: SettingsSchema, adapter: SettingsAdapter): () => void {
    return this.settingsHost.register(this.#scope, {
      id: this.descriptor.id,
      displayName: this.descriptor.displayName,
      pluginVersion: this.descriptor.pluginVersion,
      capabilities: this.host.capabilities,
    }, schema, adapter, (token, input) => this.popupHost.open(this.#scope, token, input));
  }

  registerPopup(registration: PopupRegistration): () => void { return this.popupHost.register(this.#scope, registration); }

  dispose(): void { this.remove(this); }

  close(reason: SessionCloseReason, nextGeneration?: number): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#scope.dispose();
    const info: SessionCloseInfo = nextGeneration === undefined
      ? Object.freeze({ reason, generation: this.generation })
      : Object.freeze({ reason, generation: this.generation, nextGeneration });
    this.#close(info);
  }
}

function validateDescriptor(descriptor: PluginDescriptor): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(descriptor.id)
    || descriptor.id === 'ss-helper.core'
    || descriptor.displayName.trim() === ''
    || descriptor.pluginVersion.trim() === '') {
    throw new SSHelperError('PAYLOAD_INVALID', 'The plugin descriptor is invalid', { reason: 'descriptor' });
  }
}

export class PluginRegistry {
  readonly #sessions = new Map<string, PluginSessionImpl<HostCapability>>();

  constructor(
    private readonly generation: number,
    private readonly apiMajor: number,
    private readonly apiMinor: number,
    private readonly capabilities: readonly HostCapability[],
    private readonly coreActive: () => boolean,
    private readonly services: ServiceRegistry,
    private readonly events: EventHub,
    private readonly diagnostics: DiagnosticsStore,
    private readonly hostAdapter: TavernHostAdapter,
    private readonly settingsHost: SettingsHost,
    private readonly popupHost: PopupHost,
  ) {}

  register<Capabilities extends HostCapability>(descriptor: PluginDescriptor<Capabilities>): PluginSession<Capabilities> {
    if (!this.coreActive()) throw new SSHelperError('CORE_DISPOSED', 'Core is disposed');
    validateDescriptor(descriptor);
    if (descriptor.apiMajor !== this.apiMajor || descriptor.minApiMinor > this.apiMinor) {
      throw new SSHelperError('API_INCOMPATIBLE', 'The plugin requires an incompatible Core API');
    }
    if (this.#sessions.has(descriptor.id)) {
      throw new SSHelperError('DUPLICATE_PLUGIN_ID', 'The plugin ID is already registered', { pluginId: descriptor.id });
    }
    const frozenDescriptor = Object.freeze({ ...descriptor, capabilities: Object.freeze([...descriptor.capabilities]) });
    const granted = Object.freeze(descriptor.capabilities.filter((capability) => this.capabilities.includes(capability))) as readonly Capabilities[];
    const session = new PluginSessionImpl(
      frozenDescriptor,
      this.generation,
      this.coreActive,
      (candidate) => this.#remove(candidate as unknown as PluginSessionImpl<HostCapability>, 'consumer_dispose'),
      this.services,
      this.events,
      granted,
      this.hostAdapter,
      this.settingsHost,
      this.popupHost,
    );
    this.#sessions.set(descriptor.id, session as unknown as PluginSessionImpl<HostCapability>);
    this.diagnostics.increment('plugins', 1);
    this.diagnostics.record({ type: 'plugin.registered', pluginId: descriptor.id });
    return session;
  }

  #remove(session: PluginSessionImpl<HostCapability>, reason: SessionCloseReason, nextGeneration?: number): void {
    if (this.#sessions.get(session.descriptor.id) !== session) return;
    this.#sessions.delete(session.descriptor.id);
    this.diagnostics.increment('plugins', -1);
    session.close(reason, nextGeneration);
    this.diagnostics.record({ type: 'plugin.disposed', pluginId: session.descriptor.id });
  }

  closeAll(reason: SessionCloseReason, nextGeneration?: number): void {
    for (const session of [...this.#sessions.values()]) this.#remove(session, reason, nextGeneration);
  }

  snapshot(): readonly PluginSnapshot[] {
    const settings = new Map(this.settingsHost.snapshot().map((entry) => [entry.id, entry]));
    return Object.freeze([...this.#sessions.values()].map((session) => Object.freeze({
      id: session.descriptor.id,
      displayName: session.descriptor.displayName,
      pluginVersion: session.descriptor.pluginVersion,
      generation: session.generation,
      health: settings.get(session.descriptor.id)?.health ?? 'healthy' as const,
      compatibility: 'compatible' as const,
      ...(settings.get(session.descriptor.id)?.lastError === undefined ? {} : { lastError: settings.get(session.descriptor.id)!.lastError }),
      capabilities: Object.freeze([...session.host.capabilities]),
      requestedCapabilities: Object.freeze([...session.descriptor.capabilities]),
    })));
  }
}
