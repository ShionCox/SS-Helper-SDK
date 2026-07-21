import {
  SSHelperError,
  type HostCapability,
  type WorkspaceRecoveryRepairRequest,
  type WorkspaceRecoveryRepairResult,
} from '@ss-helper/sdk';
import type {
  WorkspaceBackupExportRequest,
  WorkspaceBackupImportRequest,
  WorkspaceClearOwnedRequest,
  WorkspaceCollectionRequest,
  WorkspaceGrantRequest,
  WorkspaceHealth,
  WorkspaceInfo,
  WorkspaceIntegrity,
  WorkspaceListPage,
  WorkspaceListRequest,
  WorkspaceOpenRequest,
  WorkspaceOwnerBackupImportRequest,
  WorkspacePort,
  WorkspaceQueryPage,
  WorkspaceQueryRequest,
  WorkspaceRecord,
  WorkspaceRecordRequest,
  WorkspaceRemoveRequest,
  WorkspaceTransactionRequest,
  WorkspaceTransactionResult,
  WorkspaceVectorClearRequest,
  WorkspaceVectorListRequest,
  WorkspaceVectorPage,
  WorkspaceVectorRequest,
  WorkspaceVectorSearchHit,
  WorkspaceVectorSearchRequest,
} from '@ss-helper/sdk';
import type { ResourceScope } from '../plugins/session-scope.js';
import type { InternalBridgeClient } from '../bridge/internal-bridge.js';

export function createWorkspacePort(
  scope: ResourceScope,
  pluginId: string,
  capabilities: readonly HostCapability[] = [],
  bridge: InternalBridgeClient,
): WorkspacePort {
  const requireRecovery = (): void => {
    if (!capabilities.includes('workspace.recovery')) {
      throw new SSHelperError('CAPABILITY_NOT_GRANTED', 'Workspace recovery is unavailable', { capability: 'workspace.recovery' });
    }
  };
  return Object.freeze({
    health: async (): Promise<WorkspaceHealth> => bridge.call(scope, pluginId, 'workspace.health'),
    integrity: async (): Promise<WorkspaceIntegrity> => bridge.call(scope, pluginId, 'workspace.integrity'),
    open: async (value: WorkspaceOpenRequest): Promise<WorkspaceInfo> => bridge.call(scope, pluginId, 'workspace.open', value),
    list: async (value: WorkspaceListRequest = {}): Promise<WorkspaceListPage> => bridge.call(scope, pluginId, 'workspace.list', value),
    removeWorkspace: async (value: WorkspaceRemoveRequest): Promise<void> => { await bridge.call(scope, pluginId, 'workspace.remove', value); },
    clearOwned: async (value: WorkspaceClearOwnedRequest = {}): Promise<number> => bridge.call(scope, pluginId, 'workspace.clearOwned', value),
    defineCollection: async (value: WorkspaceCollectionRequest): Promise<void> => { await bridge.call(scope, pluginId, 'workspace.defineCollection', value); },
    get: async (value: WorkspaceRecordRequest): Promise<WorkspaceRecord | null> => bridge.call(scope, pluginId, 'workspace.get', value),
    upsert: async (value: WorkspaceRecordRequest): Promise<WorkspaceRecord> => bridge.call(scope, pluginId, 'workspace.upsert', value),
    delete: async (value: Omit<WorkspaceRecordRequest, 'value'>): Promise<boolean> => bridge.call(scope, pluginId, 'workspace.delete', value),
    query: async (value: WorkspaceQueryRequest): Promise<WorkspaceQueryPage> => bridge.call(scope, pluginId, 'workspace.query', value),
    transaction: async (value: WorkspaceTransactionRequest): Promise<WorkspaceTransactionResult> => bridge.call(scope, pluginId, 'workspace.transaction', value),
    vectorUpsert: async (value: WorkspaceVectorRequest): Promise<void> => { await bridge.call(scope, pluginId, 'workspace.vectorUpsert', value); },
    vectorSearch: async (value: WorkspaceVectorSearchRequest): Promise<readonly WorkspaceVectorSearchHit[]> => bridge.call(scope, pluginId, 'workspace.vectorSearch', value),
    vectorDelete: async (value: Omit<WorkspaceVectorRequest, 'vector' | 'model' | 'metadata'>): Promise<boolean> => bridge.call(scope, pluginId, 'workspace.vectorDelete', value),
    vectorList: async (value: WorkspaceVectorListRequest): Promise<WorkspaceVectorPage> => bridge.call(scope, pluginId, 'workspace.vectorList', value),
    vectorClear: async (value: WorkspaceVectorClearRequest): Promise<number> => bridge.call(scope, pluginId, 'workspace.vectorClear', value),
    grant: async (value: WorkspaceGrantRequest): Promise<void> => { await bridge.call(scope, pluginId, 'workspace.grant', value); },
    revoke: async (value: WorkspaceGrantRequest): Promise<void> => { await bridge.call(scope, pluginId, 'workspace.revoke', value); },
    export: async (value: WorkspaceBackupExportRequest) => bridge.call(scope, pluginId, 'workspace.export', value) as never,
    import: async (value: WorkspaceBackupImportRequest) => { await bridge.call(scope, pluginId, 'workspace.import', value); },
    exportAll: async () => bridge.call(scope, pluginId, 'workspace.exportAll') as never,
    importAll: async (value: WorkspaceOwnerBackupImportRequest) => { await bridge.call(scope, pluginId, 'workspace.importAll', value); },
    repair: async (value: WorkspaceRecoveryRepairRequest): Promise<WorkspaceRecoveryRepairResult> => {
      requireRecovery();
      return await bridge.call(scope, pluginId, 'workspace.repair', value);
    },
  });
}
