import type { PlainData } from './plain-data.js';

export interface WorkspaceSecretSetRequest {
  readonly workspaceId: string;
  readonly secretId: string;
  readonly value: string;
  readonly metadata?: PlainData;
}

export interface WorkspaceSecretMetadata {
  readonly secretId: string;
  readonly metadata?: PlainData;
  readonly maskedValue: string;
  readonly updatedAt: number;
  readonly keyVersion: number;
}

export interface SecretRecord extends WorkspaceSecretMetadata {
  readonly value: string;
}

export interface SecretPort {
  set(request: WorkspaceSecretSetRequest): Promise<WorkspaceSecretMetadata>;
  get(request: { readonly workspaceId: string; readonly secretId: string }): Promise<SecretRecord | null>;
  delete(request: { readonly workspaceId: string; readonly secretId: string }): Promise<boolean>;
  list(request: { readonly workspaceId: string }): Promise<readonly WorkspaceSecretMetadata[]>;
}
