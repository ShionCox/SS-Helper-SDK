import type { PlainData } from './contracts/plain-data.js';
import type {
  WorkspaceCollectionRequest,
  WorkspaceHealth,
  WorkspaceInfo,
  WorkspaceOpenRequest,
  WorkspaceQueryPage,
  WorkspaceQueryRequest,
  WorkspaceRecord,
  WorkspaceRecordRequest,
  WorkspaceRecoveryRepairRequest,
  WorkspaceRecoveryRepairResult,
  WorkspaceSecretMetadata,
  WorkspaceTransactionRequest,
  WorkspaceTransactionResult,
} from './contracts/workspace.js';

export type ServerCapability = 'workspace.read' | 'workspace.write' | 'workspace.recovery' | 'secrets.read' | 'secrets.write' | 'services.register';

export interface ServerSecretRecord extends WorkspaceSecretMetadata { readonly value: string; }
export interface ServerWorkspacePort {
  health(): Promise<WorkspaceHealth>;
  open(request: WorkspaceOpenRequest): Promise<WorkspaceInfo>;
  defineCollection(request: WorkspaceCollectionRequest): Promise<void>;
  get(request: WorkspaceRecordRequest): Promise<WorkspaceRecord | null>;
  upsert(request: WorkspaceRecordRequest): Promise<WorkspaceRecord>;
  delete(request: Omit<WorkspaceRecordRequest, 'value'>): Promise<boolean>;
  query(request: WorkspaceQueryRequest): Promise<WorkspaceQueryPage>;
  transaction(request: WorkspaceTransactionRequest): Promise<WorkspaceTransactionResult>;
  clearOwned(request?: { readonly preserveWorkspaceIds?: readonly string[]; readonly idempotencyKey?: string }): Promise<number>;
  exportAll(): Promise<{ readonly archive: PlainData; readonly sha256: string }>;
  importAll(request: { readonly archive: PlainData; readonly sha256: string }): Promise<void>;
  repair(request: WorkspaceRecoveryRepairRequest): Promise<WorkspaceRecoveryRepairResult>;
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
  readonly workspace: ServerWorkspacePort;
  readonly secrets: ServerSecretPort;
  dispose(): void;
}

interface ServerBroker {
  connect(input: { readonly pluginId: string; readonly capabilities: readonly ServerCapability[] }): ServerPluginSession;
}

const BROKER_SYMBOL = Symbol.for('@ss-helper/sdk.server.v2');

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
  const error = new Error('SS-Helper SDK server bridge is unavailable') as Error & { code?: string };
  error.code = 'SDK_SERVER_BRIDGE_UNAVAILABLE';
  throw error;
}
