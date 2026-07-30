import { SSHelperError } from '@ss-helper/sdk';

export interface StructuralContract {
  readonly kind: 'request' | 'event';
  readonly id: string;
  readonly version: number;
}

export function validateContract(contract: unknown, kind: StructuralContract['kind']): asserts contract is StructuralContract {
  if (typeof contract !== 'object' || contract === null) {
    throw new SSHelperError('INVALID_PAYLOAD', 'A structured contract token is required', { reason: 'contract' });
  }
  const value = contract as Partial<StructuralContract>;
  if (value.kind !== kind
    || typeof value.id !== 'string'
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*){2,}$/u.test(value.id)
    || !Number.isSafeInteger(value.version)
    || (value.version ?? -1) < 0) {
    throw new SSHelperError('INVALID_PAYLOAD', 'The contract token is invalid', {
      stage: 'contract',
      reasonCode: 'BUS_CONTRACT_INVALID',
    });
  }
}

export function contractKey(contract: StructuralContract): string {
  return JSON.stringify([contract.kind, contract.id, contract.version]);
}

export function contractBase(contract: StructuralContract): string {
  return JSON.stringify([contract.kind, contract.id]);
}

export function ownsContract(pluginId: string, contract: StructuralContract): boolean {
  return contract.id.startsWith(`${pluginId}.`);
}

export function isPlainData(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null && Object.getPrototypeOf(prototype) !== null) return false;
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isPlainData(item, seen))
    : Object.values(value as Record<string, unknown>).every((item) => isPlainData(item, seen));
  seen.delete(value);
  return valid;
}

export function assertPayload(value: unknown, validator?: (input: unknown) => boolean, phase = 'payload'): void {
  const plainDataAccepted = isPlainData(value);
  let validatorAccepted = true;
  if (validator !== undefined) {
    try { validatorAccepted = validator(value); } catch { validatorAccepted = false; }
  }
  if (!plainDataAccepted || !validatorAccepted) {
    throw new SSHelperError('INVALID_PAYLOAD', 'The public data boundary rejected a value', {
      stage: phase,
      reasonCode: plainDataAccepted ? 'PUBLIC_DATA_CONTRACT_INVALID' : 'PUBLIC_DATA_NOT_PLAIN',
    });
  }
}
