import type { PlainData } from './contracts/plain-data.js';
import type { WorkspacePort } from './contracts/workspace.js';
import type { WorkspaceSecretMetadata } from './contracts/secrets.js';
import { createSSHelperError } from './errors.js';

export type ServerCapability =
  | 'workspace.read'
  | 'workspace.write'
  | 'workspace.recovery'
  | 'secrets.read'
  | 'secrets.write'
  | 'services.register';

export interface ServerSecretRecord extends WorkspaceSecretMetadata {
  readonly value: string;
}

export interface ServerSecretPort {
  set(request: { readonly workspaceId: string; readonly secretId: string; readonly value: string; readonly metadata?: PlainData }): Promise<WorkspaceSecretMetadata>;
  get(request: { readonly workspaceId: string; readonly secretId: string }): Promise<ServerSecretRecord | null>;
  delete(request: { readonly workspaceId: string; readonly secretId: string }): Promise<boolean>;
  list(request: { readonly workspaceId: string }): Promise<readonly WorkspaceSecretMetadata[]>;
}

export interface ServerPluginSession {
  readonly pluginId: string;
  readonly capabilities: ReadonlySet<ServerCapability>;
  readonly workspace: WorkspacePort;
  readonly secrets: ServerSecretPort;
  dispose(): void;
}

interface ServerBroker {
  connect(input: { readonly pluginId: string; readonly capabilities: readonly ServerCapability[] }): ServerPluginSession;
}

const BROKER_SYMBOL = Symbol.for('@ss-helper/sdk.server.v0');

export async function connectServerPlugin(input: {
  readonly pluginId: string;
  readonly capabilities: readonly ServerCapability[];
  readonly timeoutMs?: number;
}): Promise<ServerPluginSession> {
  const timeoutMs = Math.max(0, Math.min(30_000, input.timeoutMs ?? 5_000));
  const deadline = Date.now() + timeoutMs;
  do {
    const broker = (globalThis as Record<PropertyKey, unknown>)[BROKER_SYMBOL] as ServerBroker | undefined;
    if (broker) return broker.connect({ pluginId: input.pluginId, capabilities: input.capabilities });
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (true);
  throw createSSHelperError('CORE_BRIDGE_UNAVAILABLE', { stage: 'sdk.server.connect' });
}
