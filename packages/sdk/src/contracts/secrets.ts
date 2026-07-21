import type { WorkspaceSecretMetadata, WorkspaceSecretSetRequest } from './workspace.js';

export interface SecretRecord extends WorkspaceSecretMetadata {
  readonly value: string;
}

export interface SecretPort {
  set(request: WorkspaceSecretSetRequest): Promise<WorkspaceSecretMetadata>;
  get(request: { readonly workspaceId: string; readonly secretId: string }): Promise<SecretRecord | null>;
  delete(request: { readonly workspaceId: string; readonly secretId: string }): Promise<boolean>;
  list(request: { readonly workspaceId: string }): Promise<readonly WorkspaceSecretMetadata[]>;
}
