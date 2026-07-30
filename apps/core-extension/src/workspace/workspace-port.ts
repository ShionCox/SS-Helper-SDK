import {
  createSSHelperError,
  type HostCapability,
  type WorkspaceCommitRequest,
  type WorkspaceCommitResult,
  type WorkspaceHealth,
  type WorkspaceIntegrity,
  type WorkspaceOpenRequest,
  type WorkspacePort,
  type WorkspaceQueryOptions,
  type WorkspaceQueryPage,
  type WorkspaceRecord,
  type WorkspaceRepairResult,
  type WorkspaceSession,
  type WorkspaceVectorFilter,
  type WorkspaceVectorInfo,
  type WorkspaceVectorListOptions,
  type WorkspaceVectorPage,
  type WorkspaceVectorSearchHit,
  type WorkspaceVectorSearchRequest,
  type WorkspaceVectorUpsertRequest,
} from '@ss-helper/sdk';
import type { ResourceScope } from '../plugins/session-scope.js';
import type { InternalBridgeClient } from '../bridge/internal-bridge.js';

interface BridgeRecord {
  readonly recordId: string;
  readonly value: WorkspaceRecord['value'];
  readonly version: number;
  readonly revision?: number;
  readonly updatedAt: number;
}

function toRecord(record: BridgeRecord | null): WorkspaceRecord | null {
  return record === null ? null : {
    id: record.recordId,
    value: record.value,
    revision: record.revision ?? record.version,
    updatedAt: record.updatedAt,
  };
}

export function createWorkspacePort(
  scope: ResourceScope,
  pluginId: string,
  capabilities: readonly HostCapability[] = [],
  bridge: InternalBridgeClient,
): WorkspacePort {
  const requireRecovery = (): void => {
    if (!capabilities.includes('workspace.recovery')) {
      throw createSSHelperError('WORKSPACE_RECOVERY_DENIED', {
        stage: 'workspace.admin',
      });
    }
  };

  const open = async (request: WorkspaceOpenRequest): Promise<WorkspaceSession> => {
    await bridge.call(scope, pluginId, 'workspace.open', {
      id: request.id,
      schema: request.schema,
      metadata: request.metadata,
    });

    const workspaceId = request.id;
    const session: WorkspaceSession = {
      id: workspaceId,
      get: async (collection: string, id: string): Promise<WorkspaceRecord | null> =>
        toRecord(await bridge.call<BridgeRecord | null>(scope, pluginId, 'workspace.get', {
          workspaceId,
          collection,
          recordId: id,
        })),
      query: async (collection: string, options: WorkspaceQueryOptions = {}): Promise<WorkspaceQueryPage> => {
        const page = await bridge.call<{
          readonly records: readonly BridgeRecord[];
          readonly nextCursor: string | null;
          readonly total?: number;
        }>(scope, pluginId, 'workspace.query', { workspaceId, collection, ...options });
        return {
          records: page.records.map(record => toRecord(record)!),
          nextCursor: page.nextCursor,
          ...(page.total === undefined ? {} : { total: page.total }),
        };
      },
      commit: async (request: WorkspaceCommitRequest): Promise<WorkspaceCommitResult> => {
        const result = await bridge.call<{
          readonly replayed: boolean;
          readonly results: readonly {
            readonly collection: string;
            readonly recordId: string;
            readonly action: 'put' | 'delete';
            readonly revision?: number;
            readonly removed?: boolean;
          }[];
        }>(scope, pluginId, 'workspace.commit', {
          id: workspaceId,
          idempotencyKey: request.idempotencyKey,
          operations: request.operations,
        });
        return {
          requestId: request.idempotencyKey,
          replayed: result.replayed,
          results: result.results.map(item => ({
            collection: item.collection,
            id: item.recordId,
            action: item.action,
            revision: item.revision ?? 0,
            ...(item.removed === undefined ? {} : { removed: item.removed }),
          })),
        };
      },
      vectors: {
        upsert: async (value: WorkspaceVectorUpsertRequest): Promise<void> => {
          await bridge.call(scope, pluginId, 'workspace.vectorUpsert', {
            workspaceId,
            collection: value.collection,
            recordId: value.id,
            vector: value.vector,
            model: value.model,
            metadata: value.metadata,
          });
        },
        search: async (value: WorkspaceVectorSearchRequest): Promise<readonly WorkspaceVectorSearchHit[]> => {
          const hits = await bridge.call<readonly (Omit<WorkspaceVectorSearchHit, 'id'> & { readonly recordId: string })[]>(
            scope,
            pluginId,
            'workspace.vectorSearch',
            { workspaceId, ...value },
          );
          return hits.map(({ recordId, ...hit }) => ({ ...hit, id: recordId }));
        },
        delete: async (collection: string, id: string): Promise<boolean> =>
          bridge.call(scope, pluginId, 'workspace.vectorDelete', { workspaceId, collection, recordId: id }),
        list: async (value: WorkspaceVectorListOptions = {}): Promise<WorkspaceVectorPage> => {
          const page = await bridge.call<{
            readonly vectors: readonly (Omit<WorkspaceVectorInfo, 'id'> & { readonly recordId: string })[];
            readonly nextCursor: string | null;
          }>(scope, pluginId, 'workspace.vectorList', { workspaceId, ...value });
          return {
            vectors: page.vectors.map(({ recordId, ...vector }) => ({ ...vector, id: recordId })),
            nextCursor: page.nextCursor,
          };
        },
        clear: async (value: WorkspaceVectorFilter = {}): Promise<number> =>
          bridge.call(scope, pluginId, 'workspace.vectorClear', { workspaceId, ...value }),
      },
    };
    return Object.freeze(session);
  };

  return Object.freeze({
    open,
    admin: Object.freeze({
      health: async (): Promise<WorkspaceHealth> => {
        return bridge.call(scope, pluginId, 'workspace.health');
      },
      integrity: async (): Promise<WorkspaceIntegrity> => {
        requireRecovery();
        return bridge.call(scope, pluginId, 'workspace.integrity');
      },
      reset: async (value: { readonly preserveIds?: readonly string[]; readonly idempotencyKey?: string } = {}): Promise<number> => {
        requireRecovery();
        return bridge.call(scope, pluginId, 'workspace.reset', {
          preserveIds: value.preserveIds,
          idempotencyKey: value.idempotencyKey,
        });
      },
      backup: async (id: string) => {
        requireRecovery();
        return bridge.call(scope, pluginId, 'workspace.backup', { id }) as never;
      },
      repair: async (): Promise<WorkspaceRepairResult> => {
        requireRecovery();
        return bridge.call(scope, pluginId, 'workspace.repair');
      },
    }),
  });
}
