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
  WorkspaceSecretDeleteRequest,
  WorkspaceSecretGetRequest,
  WorkspaceSecretListRequest,
  WorkspaceSecretMetadata,
  WorkspaceSecretRecord,
  WorkspaceSecretSetRequest,
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

type RequestBody = Record<string, unknown>;

function requestHeaders(pluginId: string): Headers {
  const root = globalThis as typeof globalThis & {
    getRequestHeaders?: () => Record<string, string>;
    SillyTavern?: { getContext?: () => { getRequestHeaders?: () => Record<string, string> } };
  };
  const headers = new Headers(
    root.SillyTavern?.getContext?.()?.getRequestHeaders?.() ?? root.getRequestHeaders?.() ?? {},
  );
  headers.set('Content-Type', 'application/json');
  headers.set('X-SS-Helper-Plugin', pluginId);
  return headers;
}

async function request(scope: ResourceScope, pluginId: string, path: string, body?: RequestBody): Promise<Record<string, unknown>> {
  scope.assertActive();
  const response = await fetch(`/api/plugins/ss-helper-sdk/v1${path}`, {
    method: body ? 'POST' : 'GET', headers: requestHeaders(pluginId), ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    const error = new Error(String(payload.message ?? payload.error ?? 'WORKSPACE_UNAVAILABLE')) as Error & { code?: string };
    error.code = String(payload.error ?? 'WORKSPACE_UNAVAILABLE');
    throw error;
  }
  return payload;
}

const post = (scope: ResourceScope, pluginId: string, path: string, body: RequestBody) => request(scope, pluginId, path, body);

export function createWorkspacePort(scope: ResourceScope, pluginId: string): WorkspacePort {
  return Object.freeze({
    health: async (): Promise<WorkspaceHealth> => request(scope, pluginId, '/workspaces/health') as unknown as WorkspaceHealth,
    integrity: async (): Promise<WorkspaceIntegrity> => {
      const payload = await request(scope, pluginId, '/workspaces/integrity');
      return { ok: payload.integrityOk === true, messages: Array.isArray(payload.messages) ? payload.messages.map(String) : [] };
    },
    open: async (value: WorkspaceOpenRequest): Promise<WorkspaceInfo> => post(scope, pluginId, '/workspaces/open', value as unknown as RequestBody) as unknown as WorkspaceInfo,
    list: async (value: WorkspaceListRequest = {}): Promise<WorkspaceListPage> => post(scope, pluginId, '/workspaces/list', value as unknown as RequestBody) as unknown as WorkspaceListPage,
    removeWorkspace: async (value: WorkspaceRemoveRequest): Promise<void> => { await post(scope, pluginId, '/workspaces/delete', value as unknown as RequestBody); },
    clearOwned: async (value: WorkspaceClearOwnedRequest = {}): Promise<number> => Number((await post(scope, pluginId, '/workspaces/clear-owned', value as unknown as RequestBody)).removed ?? 0),
    defineCollection: async (value: WorkspaceCollectionRequest): Promise<void> => { await post(scope, pluginId, '/workspaces/collection', value as unknown as RequestBody); },
    get: async (value: WorkspaceRecordRequest): Promise<WorkspaceRecord | null> => ((await post(scope, pluginId, '/workspaces/record', { ...value, action: 'get' })).record as WorkspaceRecord | null) ?? null,
    upsert: async (value: WorkspaceRecordRequest): Promise<WorkspaceRecord> => (await post(scope, pluginId, '/workspaces/record', { ...value, action: 'upsert' })).record as WorkspaceRecord,
    delete: async (value: Omit<WorkspaceRecordRequest, 'value'>): Promise<boolean> => (await post(scope, pluginId, '/workspaces/record', { ...value, action: 'delete' })).removed === true,
    query: async (value: WorkspaceQueryRequest): Promise<WorkspaceQueryPage> => post(scope, pluginId, '/workspaces/query', value as unknown as RequestBody) as unknown as WorkspaceQueryPage,
    transaction: async (value: WorkspaceTransactionRequest): Promise<WorkspaceTransactionResult> => post(scope, pluginId, '/workspaces/transaction', value as unknown as RequestBody) as unknown as WorkspaceTransactionResult,
    vectorUpsert: async (value: WorkspaceVectorRequest): Promise<void> => { await post(scope, pluginId, '/workspaces/vector', value as unknown as RequestBody); },
    vectorSearch: async (value: WorkspaceVectorSearchRequest): Promise<readonly WorkspaceVectorSearchHit[]> => (await post(scope, pluginId, '/workspaces/vector/search', value as unknown as RequestBody)).hits as WorkspaceVectorSearchHit[],
    vectorDelete: async (value: Omit<WorkspaceVectorRequest, 'vector' | 'model' | 'metadata'>): Promise<boolean> => (await post(scope, pluginId, '/workspaces/vector', { ...value, action: 'delete' })).removed === true,
    vectorList: async (value: WorkspaceVectorListRequest): Promise<WorkspaceVectorPage> => post(scope, pluginId, '/workspaces/vector/list', value as unknown as RequestBody) as unknown as WorkspaceVectorPage,
    vectorClear: async (value: WorkspaceVectorClearRequest): Promise<number> => Number((await post(scope, pluginId, '/workspaces/vector/clear', value as unknown as RequestBody)).removed ?? 0),
    secretSet: async (value: WorkspaceSecretSetRequest): Promise<WorkspaceSecretMetadata> => (await post(scope, pluginId, '/workspaces/secret', { ...value, action: 'set' } as unknown as RequestBody)).secret as WorkspaceSecretMetadata,
    secretGet: async (value: WorkspaceSecretGetRequest): Promise<WorkspaceSecretRecord | null> => ((await post(scope, pluginId, '/workspaces/secret', { ...value, action: 'get' } as unknown as RequestBody)).secret as WorkspaceSecretRecord | null) ?? null,
    secretDelete: async (value: WorkspaceSecretDeleteRequest): Promise<boolean> => (await post(scope, pluginId, '/workspaces/secret', { ...value, action: 'delete' } as unknown as RequestBody)).removed === true,
    secretList: async (value: WorkspaceSecretListRequest): Promise<readonly WorkspaceSecretMetadata[]> => (await post(scope, pluginId, '/workspaces/secret', { ...value, action: 'list' } as unknown as RequestBody)).secrets as WorkspaceSecretMetadata[],
    grant: async (value: WorkspaceGrantRequest): Promise<void> => { await post(scope, pluginId, '/workspaces/grant', value as unknown as RequestBody); },
    revoke: async (value: WorkspaceGrantRequest): Promise<void> => { await post(scope, pluginId, '/workspaces/grant', { ...value, action: 'revoke' }); },
    export: async (value: WorkspaceBackupExportRequest) => post(scope, pluginId, '/workspaces/backup/export', value as unknown as RequestBody) as never,
    import: async (value: WorkspaceBackupImportRequest) => { await post(scope, pluginId, '/workspaces/backup/import', value as unknown as RequestBody); },
    exportAll: async () => request(scope, pluginId, '/workspaces/backup/export-all') as never,
    importAll: async (value: WorkspaceOwnerBackupImportRequest) => { await post(scope, pluginId, '/workspaces/backup/import-all', value as unknown as RequestBody); },
  });
}
