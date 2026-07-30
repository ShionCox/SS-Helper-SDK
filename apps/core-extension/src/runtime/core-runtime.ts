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
import { MessageBus } from '../communication/message-bus.js';
import { DiagnosticsStore } from '../diagnostics/diagnostics-store.js';
import { PluginRegistry } from '../plugins/plugin-registry.js';
import { dispatchLifecycle, type CoreRealm } from './lifecycle.js';
import { PopupHost } from '../popup/popup-host.js';
import { ToastHost } from '../toast/toast-host.js';
import { SettingsHost } from '../settings/settings-host.js';
import type { TavernHostAdapter } from '../host/tavern-host-port.js';
import { InternalBridgeClient } from '../bridge/internal-bridge.js';
import { ChatIndicatorHost } from '../chat/chat-indicator-host.js';
import { ChatMessageActionHost } from '../chat/chat-message-action-host.js';
import { ensureIconElement } from '../ui/icon-element.js';
import { ExtensionMenuHost } from '../ui/extension-menu-host.js';

export interface CoreRuntimeIdentity {
  readonly coreVersion: string;
  readonly sdkPackageVersion: string;
  readonly apiVersion: string;
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
  readonly bus: MessageBus;
  readonly plugins: PluginRegistry;
  readonly settings: SettingsHost;
  readonly popups: PopupHost;
  readonly toasts: ToastHost;
  readonly chatIndicators: ChatIndicatorHost;
  readonly chatMessageActions: ChatMessageActionHost;
  readonly extensionMenus: ExtensionMenuHost;
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
    const document = options.document ?? options.settingsContainer?.ownerDocument;
    const capabilities = Object.freeze([...new Set([
      ...(identity.capabilities ?? []),
      ...(document === undefined ? [] : [
        'core.ui.notification.v0' as const,
        'core.ui.chat-message-action.v0' as const,
      ]),
    ])]);
    this.descriptor = Object.freeze({
      kind: 'ss-helper-core',
      id: 'ss-helper.core',
      coreVersion: identity.coreVersion,
      sdkPackageVersion: identity.sdkPackageVersion,
      apiVersion: identity.apiVersion,
      generation,
      state: 'ready',
      capabilities,
      artifact: Object.freeze({ buildId: identity.buildId, contentDigest: identity.contentDigest }),
    });
    this.diagnosticsStore = new DiagnosticsStore(generation);
    if (document !== undefined && !ensureIconElement(document)) {
      this.diagnosticsStore.record({ type: 'core.ui.icon.degraded', code: 'CUSTOM_ELEMENT_UNAVAILABLE' });
    }
    this.bus = new MessageBus(this.diagnosticsStore);
    this.settings = new SettingsHost(this.descriptor);
    this.popups = new PopupHost(document);
    this.toasts = new ToastHost(document, this.diagnosticsStore);
    this.chatIndicators = new ChatIndicatorHost(document, options.hostAdapter ?? {}, this.diagnosticsStore);
    this.chatMessageActions = new ChatMessageActionHost(document, options.hostAdapter ?? {}, this.diagnosticsStore);
    this.extensionMenus = new ExtensionMenuHost(document, this.diagnosticsStore, this.toasts);
    const bridge = new InternalBridgeClient(options.hostAdapter ?? {});
    this.plugins = new PluginRegistry(
      generation, identity.apiVersion, capabilities,
      () => this.#active, this.bus, this.diagnosticsStore,
      options.hostAdapter ?? {}, this.settings, this.popups, this.toasts,
      this.chatIndicators, this.chatMessageActions, this.extensionMenus, bridge,
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
    if (this.#snapshot === undefined) throw new SSHelperError('INTERNAL', 'Core snapshot was not installed');
    return this.#snapshot;
  }

  connect<Capabilities extends HostCapability>(descriptor: PluginDescriptor<Capabilities>): PluginSession<Capabilities> {
    if (!this.#active) throw new SSHelperError('CORE_UNAVAILABLE', 'Core is disposed');
    return this.plugins.register(descriptor);
  }

  dispose(reason: SessionCloseReason = 'core_disposed', nextGeneration?: number): void {
    if (!this.#active) return;
    this.#active = false;
    this.settings.dispose();
    this.plugins.closeAll(reason, nextGeneration);
    this.extensionMenus.dispose();
    this.chatMessageActions.dispose();
    this.chatIndicators.dispose();
    this.bus.dispose();
    this.popups.dispose();
    this.toasts.dispose();
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
