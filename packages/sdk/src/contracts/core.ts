import type { HostCapability } from './host.js';
import type { PluginDescriptor, PluginSession } from './plugin.js';

export const SDK_PACKAGE_VERSION = '2.0.0' as const;
export const API_MAJOR = 2 as const;
export const API_MINOR = 0 as const;

export const CORE_EXTENSION_DIRECTORY = 'third-party/SS-Helper-SDK' as const;
export const CORE_PLUGIN_ID = 'ss-helper.core' as const;
export const LLM_PLUGIN_ID = 'ss-helper.llm' as const;
export const MEMORY_PLUGIN_ID = 'ss-helper.memory' as const;
export const CORE_DISCOVERY_KEY = '@ss-helper/core.discovery' as const;
export const CORE_DISCOVERY_SYMBOL = Symbol.for(CORE_DISCOVERY_KEY);
export const CORE_LIFECYCLE_EVENT = 'ss-helper:core-lifecycle' as const;

export interface CoreDescriptor {
  readonly kind: 'ss-helper-core';
  readonly id: typeof CORE_PLUGIN_ID;
  readonly coreVersion: string;
  readonly sdkPackageVersion: string;
  readonly apiMajor: number;
  readonly apiMinor: number;
  readonly generation: number;
  readonly state: 'ready' | 'disposed';
  readonly capabilities: readonly HostCapability[];
  readonly artifact: {
    readonly buildId: string;
    readonly contentDigest: string;
  };
}

export interface VersionAxes {
  readonly coreVersion: string;
  readonly sdkPackageVersion: string;
  readonly apiMajor: number;
  readonly apiMinor: number;
  readonly pluginVersion: string;
}

export type CoreLifecycleKind = 'ready' | 'replaced' | 'disposed';

export interface CoreLifecycleDetail {
  readonly kind: CoreLifecycleKind;
  readonly previous?: CoreDescriptor;
  readonly current?: CoreDescriptor;
  readonly generation: number;
}

export interface CoreDiagnosticEvent {
  readonly timestamp: number;
  readonly generation: number;
  readonly type: string;
  readonly pluginId?: string;
  readonly serviceId?: string;
  readonly code?: string;
  readonly durationMs?: number;
}

export interface CoreDiagnosticsSnapshot {
  readonly generation: number;
  readonly plugins: number;
  readonly handlers: number;
  readonly subscribers: number;
  readonly pending: number;
  readonly waiters: number;
  readonly events: readonly CoreDiagnosticEvent[];
}

export interface CorePort {
  connect<Capabilities extends HostCapability>(
    descriptor: PluginDescriptor<Capabilities>,
  ): PluginSession<Capabilities>;
  diagnostics(): CoreDiagnosticsSnapshot;
}

export interface CoreDiscoverySnapshot {
  readonly kind: 'ss-helper-core-discovery';
  readonly descriptor: CoreDescriptor;
  readonly port: CorePort;
}
