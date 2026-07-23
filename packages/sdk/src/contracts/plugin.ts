import type { EventPort } from './events.js';
import type { HostCapability, HostPort } from './host.js';
import type { ServicePort } from './services.js';
import type { SettingsAdapter, SettingsSchema } from './settings.js';
import type { ChatIndicatorRegistration, ExtensionMenuItemRegistration, PopupRegistration, UiPort } from './ui.js';
import type { SecretPort } from './secrets.js';
import type { WorkspacePort } from './workspace.js';

export type PluginId = `${string}.${string}`;

export interface PluginDescriptor<Capabilities extends HostCapability = HostCapability> {
  readonly id: PluginId;
  readonly displayName: string;
  /**
   * Optional name used only by the SDK settings centre.  Keeping this
   * separate from displayName lets a plugin retain its package identity while
   * presenting a concise, localised settings entry.
   */
  readonly settingsDisplayName?: string;
  readonly pluginVersion: string;
  readonly sdkPackageVersion: string;
  readonly apiVersion: string;
  readonly minApiVersion: string;
  readonly capabilities: readonly Capabilities[];
}

export type SessionCloseReason = 'consumer_dispose' | 'core_disposed' | 'core_replaced' | 'registration_failed';
export interface SessionCloseInfo { readonly reason: SessionCloseReason; readonly generation: number; readonly nextGeneration?: number; }

export interface PluginSession<Capabilities extends HostCapability = HostCapability> {
  readonly descriptor: PluginDescriptor<Capabilities>;
  readonly generation: number;
  readonly host: HostPort<Capabilities>;
  readonly services: ServicePort;
  readonly events: EventPort;
  readonly ui: UiPort;
  readonly workspace: WorkspacePort;
  readonly secrets: SecretPort;
  readonly closed: Promise<SessionCloseInfo>;
  registerSettings(schema: SettingsSchema, adapter: SettingsAdapter): () => void;
  registerPopup(registration: PopupRegistration): () => void;
  /** Optional for compatibility with Core releases predating chat indicators. */
  registerChatIndicator?(registration: ChatIndicatorRegistration): () => void;
  /** Optional for compatibility with Core releases predating the SS-Helper extension-menu group. */
  registerExtensionMenuItem?(registration: ExtensionMenuItemRegistration): () => void;
  dispose(): void;
}
