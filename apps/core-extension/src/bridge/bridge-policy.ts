import policyDocument from './bridge-policy.json' with { type: 'json' };
import type { HostCapability } from '@ss-helper/sdk';

/**
 * Capabilities which are not inferred from Core-wide host support.  They are
 * granted only when both the consumer descriptor and this policy allow them.
 * The server reads the same JSON document before dispatching bridge calls.
 */
export const MANAGED_BRIDGE_CAPABILITIES = Object.freeze([
  'workspace.recovery',
  'secrets.read',
  'secrets.write',
] as const satisfies readonly HostCapability[]);

export const BRIDGE_CAPABILITY_POLICY = Object.freeze(
  Object.fromEntries(
    Object.entries(policyDocument.plugins).map(([pluginId, capabilities]) => [
      pluginId,
      Object.freeze(capabilities.filter((capability): capability is HostCapability =>
        typeof capability === 'string' && (MANAGED_BRIDGE_CAPABILITIES as readonly string[]).includes(capability),
      )),
    ]),
  ) as Readonly<Record<string, readonly HostCapability[]>>,
);

export function policyAllows(pluginId: string, capability: HostCapability): boolean {
  return BRIDGE_CAPABILITY_POLICY[pluginId]?.includes(capability) === true;
}
