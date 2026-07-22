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
  type ChatIndicatorRegistration,
  type PopupRegistration,
  type PopupToken,
  type PlainData,
  type UiPort,
  type ToastNotification,
} from '@ss-helper/sdk';
import type { EventHub } from '../communication/event-hub.js';
import type { ServiceRegistry } from '../communication/service-registry.js';
import type { DiagnosticsStore } from '../diagnostics/diagnostics-store.js';
import { ResourceScope } from './session-scope.js';
import { createTavernHostPort, type TavernHostAdapter } from '../host/tavern-host-port.js';
import type { SettingsHost } from '../settings/settings-host.js';
import type { PopupHost } from '../popup/popup-host.js';
import type { ToastHost } from '../toast/toast-host.js';
import type { ChatIndicatorHost } from '../chat/chat-indicator-host.js';
import { createWorkspacePort } from '../workspace/workspace-port.js';
import { createSecretPort } from '../workspace/secret-port.js';
import type { InternalBridgeClient } from '../bridge/internal-bridge.js';
import { MANAGED_BRIDGE_CAPABILITIES, policyAllows } from '../bridge/bridge-policy.js';

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
  readonly workspace: import('@ss-helper/sdk').WorkspacePort;
  readonly secrets: import('@ss-helper/sdk').SecretPort;
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
    private readonly toastHost: ToastHost,
    private readonly chatIndicatorHost: ChatIndicatorHost,
    bridge: InternalBridgeClient,
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
    this.workspace = createWorkspacePort(this.#scope, descriptor.id, granted, bridge);
    this.secrets = createSecretPort(this.#scope, descriptor.id, granted, bridge);
    this.ui = Object.freeze({
      openPopup: <Input extends PlainData>(token: PopupToken<Input>, input: Input) => this.popupHost.open(this.#scope, token, input),
      showToast: (notification: ToastNotification) => {
      if (!this.host.has('core.ui.notification.v0')) throw new SSHelperError('CAPABILITY_NOT_GRANTED', 'Toast notifications are unavailable', { capability: 'core.ui.notification.v0' });
        this.toastHost.show(this.#scope, notification);
      },
    });
  }

  registerSettings(schema: SettingsSchema, adapter: SettingsAdapter): () => void {
    return this.settingsHost.register(this.#scope, {
      id: this.descriptor.id,
      displayName: settingsDisplayNameOf(this.descriptor),
      pluginVersion: this.descriptor.pluginVersion,
      capabilities: this.host.capabilities,
    }, schema, adapter, (token, input, restoreFocus) => this.popupHost.open(this.#scope, token, input, restoreFocus));
  }

  registerPopup(registration: PopupRegistration): () => void { return this.popupHost.register(this.#scope, registration); }

  registerChatIndicator(registration: ChatIndicatorRegistration): () => void { return this.chatIndicatorHost.register(this.#scope, registration); }

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

function settingsDisplayNameOf(descriptor: PluginDescriptor): string {
  return descriptor.settingsDisplayName === undefined
    ? descriptor.displayName
    : descriptor.settingsDisplayName.trim();
}

function validateDescriptor(descriptor: PluginDescriptor): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(descriptor.id)
    || descriptor.id === 'ss-helper.core'
    || descriptor.displayName.trim() === ''
    || !isSemVer(descriptor.pluginVersion)
    || !isSemVer(descriptor.sdkPackageVersion)
    || !isSemVer(descriptor.apiVersion)
    || !isSemVer(descriptor.minApiVersion)) {
    throw new SSHelperError('PAYLOAD_INVALID', 'The plugin descriptor is invalid', { reason: 'descriptor' });
  }
  if (descriptor.settingsDisplayName !== undefined) {
    const value = descriptor.settingsDisplayName.trim();
    if (value.length === 0 || value.length > 40 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new SSHelperError('PAYLOAD_INVALID', 'The plugin settings display name is invalid', { reason: 'descriptor.settingsDisplayName' });
    }
  }
}

export class PluginRegistry {
  readonly #sessions = new Map<string, PluginSessionImpl<HostCapability>>();

  constructor(
    private readonly generation: number,
    private readonly apiVersion: string,
    private readonly capabilities: readonly HostCapability[],
    private readonly coreActive: () => boolean,
    private readonly services: ServiceRegistry,
    private readonly events: EventHub,
    private readonly diagnostics: DiagnosticsStore,
    private readonly hostAdapter: TavernHostAdapter,
    private readonly settingsHost: SettingsHost,
    private readonly popupHost: PopupHost,
    private readonly toastHost: ToastHost,
    private readonly chatIndicatorHost: ChatIndicatorHost,
    private readonly bridge: InternalBridgeClient,
  ) {}

  register<Capabilities extends HostCapability>(descriptor: PluginDescriptor<Capabilities>): PluginSession<Capabilities> {
    if (!this.coreActive()) throw new SSHelperError('CORE_DISPOSED', 'Core is disposed');
    validateDescriptor(descriptor);
    if (compareSemVer(this.apiVersion, descriptor.minApiVersion) < 0) {
      throw new SSHelperError('API_INCOMPATIBLE', 'The plugin requires an incompatible Core API');
    }
    if (this.#sessions.has(descriptor.id)) {
      throw new SSHelperError('DUPLICATE_PLUGIN_ID', 'The plugin ID is already registered', { pluginId: descriptor.id });
    }
    const frozenDescriptor = Object.freeze({ ...descriptor, capabilities: Object.freeze([...descriptor.capabilities]) });
    const granted = Object.freeze(descriptor.capabilities.filter((capability) => {
      if (!this.capabilities.includes(capability)) return false;
      return !(MANAGED_BRIDGE_CAPABILITIES as readonly HostCapability[]).includes(capability)
        || policyAllows(descriptor.id, capability);
    })) as readonly Capabilities[];
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
      this.toastHost,
      this.chatIndicatorHost,
      this.bridge,
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

function compareSemVer(left: string, right: string): number {
  const parse = (value: string): readonly [number, number, number] | undefined => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
    return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const a = parse(left); const b = parse(right);
  if (a === undefined || b === undefined) return -1;
  const [aMajor, aMinor, aPatch] = a; const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  if (aPatch !== bPatch) return aPatch - bPatch;
  return 0;
}

function isSemVer(value: string): boolean { return /^\d+\.\d+\.\d+$/u.test(value); }
