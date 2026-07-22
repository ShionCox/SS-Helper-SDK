import { MEMORY_PLUGIN_ID } from './core.js';
import type { EventContract } from './events.js';
import type { ServiceContract } from './services.js';

export type MemoryRecallMode = 'strict_pov' | 'multi_actor' | 'omniscient';

/** v0 recall asks for a scene cast; host/card ids are workspace provenance only. */
export interface MemoryRecallRequest {
  readonly query: string;
  readonly chatKey: string;
  readonly sceneOwnerIds: readonly string[];
  readonly presentOwnerIds: readonly string[];
  readonly viewpointOwnerId: string;
  readonly mode: MemoryRecallMode;
  readonly maxItems?: number;
  readonly sceneEpoch?: string;
}

export interface MemoryRecallMemory {
  readonly text: string;
  readonly confidence: number;
  readonly strength?: number;
}

export interface MemoryRecallPartition {
  readonly ownerId: string;
  readonly owner: string;
  readonly memories: readonly MemoryRecallMemory[];
}

/**
 * Partitioned response. It intentionally contains realized memory text only;
 * evidence excerpts, complete prompts, and storage records never cross SDK.
 */
export interface MemoryRecallPartitionedResponse {
  readonly mode: MemoryRecallMode;
  readonly world: MemoryRecallPartition;
  readonly narrator: MemoryRecallPartition;
  readonly actors: readonly MemoryRecallPartition[];
}
export type MemoryRecallResponse = MemoryRecallPartitionedResponse;
export interface MemoryUpdatedPayload { readonly chatKey: string; readonly operation: 'created' | 'updated' | 'deleted'; readonly recordIds: readonly string[]; }

/** Read-only, chat-scoped relation graph. It deliberately omits evidence and prompt text. */
export interface MemoryGraphRequest { readonly chatKey: string; readonly query: string; readonly limit?: number; }
export interface MemoryGraphNode { readonly id: string; readonly label: string; }
export interface MemoryGraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly predicate: string;
  readonly kind: string;
  readonly confidence: number;
  readonly backingFactId: string;
}
export interface MemoryGraphResponse { readonly nodes: readonly MemoryGraphNode[]; readonly edges: readonly MemoryGraphEdge[]; }

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function safeText(value: unknown, min = 1, max = 1_024): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function isRecallMode(value: unknown): value is MemoryRecallMode {
  return value === 'strict_pov' || value === 'multi_actor' || value === 'omniscient';
}

function isMemoryRecallRequest(value: unknown): value is MemoryRecallRequest {
  const candidate = object(value);
  if (candidate === null || !onlyKeys(candidate, ['query', 'chatKey', 'sceneOwnerIds', 'presentOwnerIds', 'viewpointOwnerId', 'mode', 'maxItems', 'sceneEpoch'])) return false;
  const ownerList = (input: unknown): boolean => Array.isArray(input) && input.length <= 128 && input.every((item) => safeText(item, 1, 256));
  return safeText(candidate.query, 0, 16_000)
    && safeText(candidate.chatKey, 1, 512)
    && ownerList(candidate.sceneOwnerIds)
    && ownerList(candidate.presentOwnerIds)
    && safeText(candidate.viewpointOwnerId, 1, 256)
    && isRecallMode(candidate.mode)
    && (candidate.maxItems === undefined || (Number.isInteger(candidate.maxItems) && (candidate.maxItems as number) >= 1 && (candidate.maxItems as number) <= 100))
    && (candidate.sceneEpoch === undefined || safeText(candidate.sceneEpoch, 1, 256));
}

function isMemoryRecallMemory(value: unknown): value is MemoryRecallMemory {
  const candidate = object(value);
  return candidate !== null && onlyKeys(candidate, ['text', 'confidence', 'strength'])
    && safeText(candidate.text, 1, 2_000)
    && typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence) && candidate.confidence >= 0 && candidate.confidence <= 1
    && (candidate.strength === undefined || (typeof candidate.strength === 'number' && Number.isFinite(candidate.strength) && candidate.strength >= 0 && candidate.strength <= 100));
}

function isMemoryRecallPartition(value: unknown): value is MemoryRecallPartition {
  const candidate = object(value);
  return candidate !== null && onlyKeys(candidate, ['ownerId', 'owner', 'memories'])
    && safeText(candidate.ownerId, 1, 256) && safeText(candidate.owner, 1, 256)
    && Array.isArray(candidate.memories) && candidate.memories.length <= 100 && candidate.memories.every(isMemoryRecallMemory);
}

function isMemoryRecallResponse(value: unknown): value is MemoryRecallResponse {
  const candidate = object(value);
  return candidate !== null
    && onlyKeys(candidate, ['mode', 'world', 'narrator', 'actors'])
    && isRecallMode(candidate.mode)
    && isMemoryRecallPartition(candidate.world)
    && isMemoryRecallPartition(candidate.narrator)
    && Array.isArray(candidate.actors) && candidate.actors.length <= 128 && candidate.actors.every(isMemoryRecallPartition);
}

function isMemoryGraphRequest(value: unknown): value is MemoryGraphRequest {
  const candidate = object(value);
  return candidate !== null
    && onlyKeys(candidate, ['chatKey', 'query', 'limit'])
    && safeText(candidate.chatKey, 1, 512)
    && typeof candidate.query === 'string' && candidate.query.length <= 16_000
    && (candidate.limit === undefined || (Number.isInteger(candidate.limit) && (candidate.limit as number) >= 1 && (candidate.limit as number) <= 50));
}

function isMemoryGraphNode(value: unknown): value is MemoryGraphNode {
  const candidate = object(value);
  return candidate !== null && onlyKeys(candidate, ['id', 'label'])
    && safeText(candidate.id) && safeText(candidate.label);
}

function isMemoryGraphEdge(value: unknown): value is MemoryGraphEdge {
  const candidate = object(value);
  return candidate !== null
    && onlyKeys(candidate, ['id', 'from', 'to', 'predicate', 'kind', 'confidence', 'backingFactId'])
    && safeText(candidate.id)
    && safeText(candidate.from)
    && safeText(candidate.to)
    && safeText(candidate.predicate)
    && safeText(candidate.kind)
    && typeof candidate.confidence === 'number'
    && Number.isFinite(candidate.confidence)
    && candidate.confidence >= 0
    && candidate.confidence <= 1
    && safeText(candidate.backingFactId);
}

function isMemoryGraphResponse(value: unknown): value is MemoryGraphResponse {
  const candidate = object(value);
  return candidate !== null
    && onlyKeys(candidate, ['nodes', 'edges'])
    && Array.isArray(candidate.nodes)
    && Array.isArray(candidate.edges)
    // A result may contain two distinct endpoints for every permitted edge.
    // Keep the response bounded while allowing a 50-edge graph preview.
    && candidate.nodes.length <= 100
    && candidate.edges.length <= 50
    && candidate.nodes.every(isMemoryGraphNode)
    && candidate.edges.every(isMemoryGraphEdge);
}

export const MEMORY_RECALL_V0: ServiceContract<typeof MEMORY_PLUGIN_ID, 'recall', 0, MemoryRecallRequest, MemoryRecallResponse> = Object.freeze({
  kind: 'service', provider: MEMORY_PLUGIN_ID, name: 'recall', version: 0, schemaId: 'ss-helper.memory.recall.v0',
  validateRequest: isMemoryRecallRequest,
  validateResponse: isMemoryRecallResponse,
});

export const MEMORY_GRAPH_V0: ServiceContract<typeof MEMORY_PLUGIN_ID, 'graph', 0, MemoryGraphRequest, MemoryGraphResponse> = Object.freeze({
  kind: 'service', provider: MEMORY_PLUGIN_ID, name: 'graph', version: 0, schemaId: 'ss-helper.memory.graph.v0',
  validateRequest: isMemoryGraphRequest,
  validateResponse: isMemoryGraphResponse,
});

export const MEMORY_UPDATED_V0: EventContract<typeof MEMORY_PLUGIN_ID, 'updated', 0, MemoryUpdatedPayload> = Object.freeze({
  kind: 'event', provider: MEMORY_PLUGIN_ID, name: 'updated', version: 0, schemaId: 'ss-helper.memory.updated.v0',
});
