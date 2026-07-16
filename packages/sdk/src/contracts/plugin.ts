import type { EventPort } from './events.js';
import type { HostCapability, HostPort } from './host.js';
import type { ServicePort } from './services.js';
import type { SettingsAdapter, SettingsSchema } from './settings.js';
import type { PopupRegistration, UiPort } from './ui.js';
import type { WorkspacePort } from './workspace.js';

export type PluginId = `${string}.${string}`;

export interface PluginDescriptor<Capabilities extends HostCapability = HostCapability> {
  readonly id: PluginId;
  readonly displayName: string;
  readonly pluginVersion: string;
  readonly sdkPackageVersion: string;
  readonly apiMajor: number;
  readonly minApiMinor: number;
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
  readonly closed: Promise<SessionCloseInfo>;
  registerSettings(schema: SettingsSchema, adapter: SettingsAdapter): () => void;
  registerPopup(registration: PopupRegistration): () => void;
  dispose(): void;
}
