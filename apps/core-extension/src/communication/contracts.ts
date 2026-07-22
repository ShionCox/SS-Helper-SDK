import { SSHelperError } from '@ss-helper/sdk';

export interface StructuralContract {
  readonly kind: 'service' | 'event';
  readonly provider: string;
  readonly name: string;
  readonly version: number;
  readonly schemaId: string;
}

export function validateContract(contract: unknown, kind: StructuralContract['kind']): asserts contract is StructuralContract {
  if (typeof contract !== 'object' || contract === null) {
    throw new SSHelperError('PAYLOAD_INVALID', 'A structured contract token is required', { reason: 'contract' });
  }
  const value = contract as Partial<StructuralContract>;
  if (value.kind !== kind || typeof value.provider !== 'string' || typeof value.name !== 'string'
    || !Number.isSafeInteger(value.version) || (value.version ?? -1) < 0
    || value.schemaId !== `${value.provider}.${value.name}.v${value.version}`) {
    throw new SSHelperError('PAYLOAD_INVALID', 'The contract token is invalid', { reason: 'contract' });
  }
}

export function contractKey(contract: StructuralContract): string {
  return JSON.stringify([contract.kind, contract.provider, contract.name, contract.version, contract.schemaId]);
}

export function contractBase(contract: StructuralContract): string {
  return JSON.stringify([contract.kind, contract.provider, contract.name]);
}

export function isPlainData(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isPlainData(item, seen));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every((item) => isPlainData(item, seen));
}

export function assertPayload(value: unknown, validator?: (input: unknown) => boolean, phase = 'payload'): void {
  let validatorAccepted = true;
  if (validator !== undefined) {
    try { validatorAccepted = validator(value); } catch { validatorAccepted = false; }
  }
  if (!isPlainData(value) || !validatorAccepted) {
    throw new SSHelperError('PAYLOAD_INVALID', 'The public data boundary rejected a value', { phase });
  }
}
