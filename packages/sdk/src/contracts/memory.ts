import { MEMORY_PLUGIN_ID } from './core.js';
import type { EventContract } from './events.js';
import type { ServiceContract } from './services.js';

export interface MemoryRecallRequest { readonly query: string; readonly chatKey: string; readonly limit?: number; readonly actorKey?: string; }
export interface MemoryRecallItem { readonly id: string; readonly text: string; readonly score: number; readonly source?: string; }
export interface MemoryRecallResponse { readonly items: readonly MemoryRecallItem[]; }
export interface MemoryUpdatedPayload { readonly chatKey: string; readonly operation: 'created' | 'updated' | 'deleted'; readonly recordIds: readonly string[]; }

export const MEMORY_RECALL_V1: ServiceContract<typeof MEMORY_PLUGIN_ID, 'recall', 1, MemoryRecallRequest, MemoryRecallResponse> = Object.freeze({
  kind: 'service', provider: MEMORY_PLUGIN_ID, name: 'recall', version: 1, schemaId: 'ss-helper.memory.recall.v1',
});

export const MEMORY_UPDATED_V1: EventContract<typeof MEMORY_PLUGIN_ID, 'updated', 1, MemoryUpdatedPayload> = Object.freeze({
  kind: 'event', provider: MEMORY_PLUGIN_ID, name: 'updated', version: 1, schemaId: 'ss-helper.memory.updated.v1',
});
