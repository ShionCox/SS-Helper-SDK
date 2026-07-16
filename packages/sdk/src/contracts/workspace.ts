import type { PlainData } from './plain-data.js';

export type WorkspaceAction = 'read' | 'write' | 'vector' | 'backup';
export interface WorkspaceHealth {
  readonly ready: boolean;
  readonly database: string;
  readonly schemaVersion: number;
  readonly sqliteVersion?: string;
  readonly walMode?: string;
  readonly error?: string;
  readonly secretReady?: boolean;
  readonly secretError?: string;
}
export interface WorkspaceIntegrity { readonly ok: boolean; readonly messages: readonly string[]; }
export interface WorkspaceRecord { readonly recordId: string; readonly value: PlainData; readonly version: number; readonly updatedAt: number; }
export interface WorkspaceOpenRequest { readonly workspaceId: string; readonly ownerPluginId?: string; readonly create?: boolean; readonly metadata?: PlainData; }
export interface WorkspaceInfo { readonly ownerPluginId: string; readonly workspaceId: string; readonly created: boolean; readonly metadata?: PlainData; readonly version?: number; }
export interface WorkspaceListRequest { readonly cursor?: string; readonly limit?: number; }
export interface WorkspaceListPage { readonly workspaces: readonly WorkspaceInfo[]; readonly nextCursor: string | null; }
export interface WorkspaceRemoveRequest { readonly workspaceId: string; readonly expectedVersion?: number; }
export interface WorkspaceClearOwnedRequest { readonly preserveWorkspaceIds?: readonly string[]; readonly idempotencyKey?: string; }
export interface WorkspaceCollectionRequest { readonly workspaceId: string; readonly ownerPluginId?: string; readonly name: string; readonly indexes?: readonly string[]; }
export interface WorkspaceRecordRequest { readonly workspaceId: string; readonly ownerPluginId?: string; readonly collection?: string; readonly recordId: string; readonly value?: PlainData; readonly expectedVersion?: number; }
export type WorkspaceQueryOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
export interface WorkspaceQueryPredicate { readonly field: string; readonly op: WorkspaceQueryOperator; readonly value: PlainData; }
export interface WorkspaceQueryRequest { readonly workspaceId: string; readonly ownerPluginId?: string; readonly collection?: string; readonly filter?: Readonly<Record<string, PlainData>>; readonly where?: readonly WorkspaceQueryPredicate[]; readonly orderBy?: { readonly field: string; readonly direction?: 'asc' | 'desc' }; readonly cursor?: string; readonly limit?: number; }
export interface WorkspaceQueryPage { readonly records: readonly WorkspaceRecord[]; readonly nextCursor: string | null; }
export type WorkspaceTransactionOperation =
  | { readonly action: 'upsert'; readonly collection?: string; readonly recordId: string; readonly value: PlainData; readonly expectedVersion?: number }
  | { readonly action: 'delete'; readonly collection?: string; readonly recordId: string; readonly expectedVersion?: number };
export interface WorkspaceTransactionRequest { readonly workspaceId: string; readonly ownerPluginId?: string; readonly idempotencyKey?: string; readonly operations: readonly WorkspaceTransactionOperation[]; }
export interface WorkspaceTransactionResult { readonly operationCount: number; readonly replayed: boolean; readonly results: readonly { readonly collection: string; readonly recordId: string; readonly action: 'upsert' | 'delete'; readonly version?: number; readonly removed?: boolean }[]; }
export interface WorkspaceVectorRequest { readonly workspaceId: string; readonly ownerPluginId?: string; readonly collection?: string; readonly recordId: string; readonly vector: readonly number[]; readonly model?: string; readonly metadata?: PlainData; }
export interface WorkspaceVectorFilter { readonly collection?: string; readonly model?: string; readonly metadata?: Readonly<Record<string, PlainData>>; }
export interface WorkspaceVectorListRequest extends WorkspaceVectorFilter { readonly workspaceId: string; readonly ownerPluginId?: string; readonly cursor?: string; readonly limit?: number; }
export interface WorkspaceVectorInfo { readonly collection: string; readonly recordId: string; readonly model?: string; readonly metadata?: PlainData; readonly dimensions: number; readonly createdAt: number; readonly updatedAt: number; }
export interface WorkspaceVectorPage { readonly vectors: readonly WorkspaceVectorInfo[]; readonly nextCursor: string | null; }
export interface WorkspaceVectorSearchRequest extends WorkspaceVectorFilter { readonly workspaceId: string; readonly ownerPluginId?: string; readonly vector: readonly number[]; readonly limit?: number; }
export interface WorkspaceVectorSearchHit { readonly collection: string; readonly recordId: string; readonly score: number; readonly model?: string; readonly metadata?: PlainData; }
export interface WorkspaceVectorClearRequest extends WorkspaceVectorFilter { readonly workspaceId: string; readonly ownerPluginId?: string; }
export interface WorkspaceSecretSetRequest {
  readonly workspaceId: string;
  readonly secretId: string;
  readonly value: string;
  readonly metadata?: PlainData;
}
export interface WorkspaceSecretGetRequest { readonly workspaceId: string; readonly secretId: string; }
export interface WorkspaceSecretDeleteRequest { readonly workspaceId: string; readonly secretId: string; }
export interface WorkspaceSecretListRequest { readonly workspaceId: string; }
export interface WorkspaceSecretMetadata { readonly secretId: string; readonly metadata?: PlainData; readonly maskedValue: string; readonly updatedAt: number; readonly keyVersion: number; }
export interface WorkspaceSecretRecord extends WorkspaceSecretMetadata { readonly value: string; }
export interface WorkspaceGrantRequest { readonly workspaceId: string; readonly ownerPluginId?: string; readonly granteePluginId: string; readonly actions: readonly WorkspaceAction[]; readonly expiresAt?: number; }
export interface WorkspaceBackup { readonly format: 'ss-helper-workspace'; readonly version: 1; readonly ownerPluginId: string; readonly workspaceId: string; readonly metadata: PlainData; readonly workspaceVersion: number; readonly collections: readonly PlainData[]; readonly records: readonly PlainData[]; readonly vectors: readonly PlainData[]; }
export interface WorkspaceOwnerBackup { readonly format: 'ss-helper-workspace-owner'; readonly version: 1; readonly ownerPluginId: string; readonly exportedAt: number; readonly workspaces: readonly WorkspaceBackup[]; }
export interface WorkspaceBackupExportRequest { readonly workspaceId: string; readonly ownerPluginId?: string; }
export interface WorkspaceBackupImportRequest { readonly workspaceId: string; readonly ownerPluginId?: string; readonly archive: WorkspaceBackup; readonly sha256: string; }
export interface WorkspaceOwnerBackupImportRequest { readonly archive: WorkspaceOwnerBackup; readonly sha256: string; }

export interface WorkspacePort {
  health(): Promise<WorkspaceHealth>;
  integrity(): Promise<WorkspaceIntegrity>;
  open(request: WorkspaceOpenRequest): Promise<WorkspaceInfo>;
  list(request?: WorkspaceListRequest): Promise<WorkspaceListPage>;
  removeWorkspace(request: WorkspaceRemoveRequest): Promise<void>;
  clearOwned(request?: WorkspaceClearOwnedRequest): Promise<number>;
  defineCollection(request: WorkspaceCollectionRequest): Promise<void>;
  get(request: WorkspaceRecordRequest): Promise<WorkspaceRecord | null>;
  upsert(request: WorkspaceRecordRequest): Promise<WorkspaceRecord>;
  delete(request: Omit<WorkspaceRecordRequest, 'value'>): Promise<boolean>;
  query(request: WorkspaceQueryRequest): Promise<WorkspaceQueryPage>;
  transaction(request: WorkspaceTransactionRequest): Promise<WorkspaceTransactionResult>;
  vectorUpsert(request: WorkspaceVectorRequest): Promise<void>;
  vectorSearch(request: WorkspaceVectorSearchRequest): Promise<readonly WorkspaceVectorSearchHit[]>;
  vectorDelete(request: Omit<WorkspaceVectorRequest, 'vector' | 'model' | 'metadata'>): Promise<boolean>;
  vectorList(request: WorkspaceVectorListRequest): Promise<WorkspaceVectorPage>;
  vectorClear(request: WorkspaceVectorClearRequest): Promise<number>;
  secretSet(request: WorkspaceSecretSetRequest): Promise<WorkspaceSecretMetadata>;
  secretGet(request: WorkspaceSecretGetRequest): Promise<WorkspaceSecretRecord | null>;
  secretDelete(request: WorkspaceSecretDeleteRequest): Promise<boolean>;
  secretList(request: WorkspaceSecretListRequest): Promise<readonly WorkspaceSecretMetadata[]>;
  grant(request: WorkspaceGrantRequest): Promise<void>;
  revoke(request: WorkspaceGrantRequest): Promise<void>;
  export(request: WorkspaceBackupExportRequest): Promise<{ readonly archive: WorkspaceBackup; readonly sha256: string }>;
  import(request: WorkspaceBackupImportRequest): Promise<void>;
  exportAll(): Promise<{ readonly archive: WorkspaceOwnerBackup; readonly sha256: string }>;
  importAll(request: WorkspaceOwnerBackupImportRequest): Promise<void>;
}
