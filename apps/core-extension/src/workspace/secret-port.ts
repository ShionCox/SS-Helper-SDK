import {
  SSHelperError,
  type HostCapability,
  type SecretPort,
  type WorkspaceSecretMetadata,
  type WorkspaceSecretSetRequest,
} from '@ss-helper/sdk';
import type { InternalBridgeClient } from '../bridge/internal-bridge.js';
import type { ResourceScope } from '../plugins/session-scope.js';

type SecretLookup = { readonly workspaceId: string; readonly secretId: string };
type SecretRecord = WorkspaceSecretMetadata & { readonly value: string };

export function createSecretPort(
  scope: ResourceScope,
  pluginId: string,
  capabilities: readonly HostCapability[],
  bridge: InternalBridgeClient,
): SecretPort {
  const requireCapability = (capability: 'secrets.read' | 'secrets.write'): void => {
    if (!capabilities.includes(capability)) {
      throw new SSHelperError('CAPABILITY_NOT_GRANTED', 'Secret access is unavailable', { capability });
    }
  };
  return Object.freeze({
    set: async (input: WorkspaceSecretSetRequest): Promise<WorkspaceSecretMetadata> => {
      requireCapability('secrets.write');
      return bridge.call(scope, pluginId, 'secrets.set', input);
    },
    get: async (input: SecretLookup): Promise<SecretRecord | null> => {
      requireCapability('secrets.read');
      return bridge.call(scope, pluginId, 'secrets.get', input);
    },
    delete: async (input: SecretLookup): Promise<boolean> => {
      requireCapability('secrets.write');
      return bridge.call(scope, pluginId, 'secrets.delete', input);
    },
    list: async (input: { readonly workspaceId: string }): Promise<readonly WorkspaceSecretMetadata[]> => {
      requireCapability('secrets.read');
      return bridge.call(scope, pluginId, 'secrets.list', input);
    },
  });
}
