import type { PlainData } from './plain-data.js';
import type { SSHelperFailureContext } from '../errors.js';

export interface WorkspaceHealth {
  readonly ready: boolean;
  readonly status: 'ready' | 'degraded';
  readonly failure?: SSHelperFailureContext;
  readonly recoverable?: boolean;
  readonly database: string;
  readonly schemaVersion: number;
  readonly nodeVersion?: string;
  readonly sqliteVersion?: string;
  readonly walMode?: string;
  readonly databaseSizeBytes?: number;
  readonly secretReady?: boolean;
  readonly secretFailure?: SSHelperFailureContext;
}

export interface WorkspaceIntegrity {
  readonly ok: boolean;
  readonly messages: readonly string[];
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly value: PlainData;
  readonly revision: number;
  readonly updatedAt: number;
}

export interface WorkspaceCollectionSchema {
  readonly name: string;
  readonly indexes?: readonly string[];
}

export interface WorkspaceSchema {
  readonly collections: readonly WorkspaceCollectionSchema[];
}

export interface WorkspaceOpenRequest {
  readonly id: string;
  readonly schema: WorkspaceSchema;
  readonly metadata?: PlainData;
}

export type WorkspaceQueryOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
export interface WorkspaceQueryPredicate {
  readonly field: string;
  readonly op: WorkspaceQueryOperator;
  readonly value: PlainData;
}

export interface WorkspaceQueryOptions {
  readonly filter?: Readonly<Record<string, PlainData>>;
  readonly where?: readonly WorkspaceQueryPredicate[];
  readonly orderBy?: { readonly field: string; readonly direction?: 'asc' | 'desc' };
  readonly cursor?: string;
  readonly limit?: number;
  readonly includeTotal?: boolean;
}

export interface WorkspaceQueryPage {
  readonly records: readonly WorkspaceRecord[];
  readonly nextCursor: string | null;
  readonly total?: number;
}

export type WorkspaceCommitOperation =
  | {
      readonly action: 'put';
      readonly collection: string;
      readonly id: string;
      readonly value: PlainData;
      readonly expectedRevision?: number;
    }
  | {
      readonly action: 'delete';
      readonly collection: string;
      readonly id: string;
      readonly expectedRevision?: number;
    };

export interface WorkspaceCommitRequest {
  readonly idempotencyKey: string;
  readonly operations: readonly WorkspaceCommitOperation[];
}

export interface WorkspaceCommitResult {
  readonly requestId: string;
  readonly replayed: boolean;
  readonly results: readonly {
    readonly collection: string;
    readonly id: string;
    readonly action: 'put' | 'delete';
    readonly revision: number;
    readonly removed?: boolean;
  }[];
}

export interface WorkspaceVectorFilter {
  readonly collection?: string;
  readonly model?: string;
  readonly metadata?: Readonly<Record<string, PlainData>>;
}

export interface WorkspaceVectorUpsertRequest {
  readonly collection: string;
  readonly id: string;
  readonly vector: readonly number[];
  readonly model?: string;
  readonly metadata?: PlainData;
}

export interface WorkspaceVectorListOptions extends WorkspaceVectorFilter {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface WorkspaceVectorInfo {
  readonly collection: string;
  readonly id: string;
  readonly model?: string;
  readonly metadata?: PlainData;
  readonly dimensions: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkspaceVectorPage {
  readonly vectors: readonly WorkspaceVectorInfo[];
  readonly nextCursor: string | null;
}

export interface WorkspaceVectorSearchRequest extends WorkspaceVectorFilter {
  readonly vector: readonly number[];
  readonly limit?: number;
}

export interface WorkspaceVectorSearchHit {
  readonly collection: string;
  readonly id: string;
  readonly score: number;
  readonly model?: string;
  readonly metadata?: PlainData;
}

export interface WorkspaceVectors {
  upsert(request: WorkspaceVectorUpsertRequest): Promise<void>;
  search(request: WorkspaceVectorSearchRequest): Promise<readonly WorkspaceVectorSearchHit[]>;
  delete(collection: string, id: string): Promise<boolean>;
  list(options?: WorkspaceVectorListOptions): Promise<WorkspaceVectorPage>;
  clear(filter?: WorkspaceVectorFilter): Promise<number>;
}

export interface WorkspaceSession {
  readonly id: string;
  get(collection: string, id: string): Promise<WorkspaceRecord | null>;
  query(collection: string, options?: WorkspaceQueryOptions): Promise<WorkspaceQueryPage>;
  commit(request: WorkspaceCommitRequest): Promise<WorkspaceCommitResult>;
  readonly vectors: WorkspaceVectors;
}

export interface WorkspaceBackup {
  readonly format: 'ss-helper-workspace';
  readonly version: 0;
  readonly workspaceId: string;
  readonly metadata: PlainData;
  readonly workspaceVersion: number;
  readonly collections: readonly PlainData[];
  readonly records: readonly PlainData[];
  readonly vectors: readonly PlainData[];
}

export interface WorkspaceRepairResult {
  readonly backupId: string;
  readonly requiresReload: true;
}

export interface WorkspaceAdmin {
  health(): Promise<WorkspaceHealth>;
  integrity(): Promise<WorkspaceIntegrity>;
  reset(request?: { readonly preserveIds?: readonly string[]; readonly idempotencyKey?: string }): Promise<number>;
  backup(id: string): Promise<{ readonly archive: WorkspaceBackup; readonly sha256: string }>;
  repair(): Promise<WorkspaceRepairResult>;
}

export interface WorkspacePort {
  open(request: WorkspaceOpenRequest): Promise<WorkspaceSession>;
  readonly admin: WorkspaceAdmin;
}
