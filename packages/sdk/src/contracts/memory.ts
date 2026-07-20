import { MEMORY_PLUGIN_ID } from './core.js';
import type { EventContract } from './events.js';
import type { ServiceContract } from './services.js';

export interface MemoryRecallRequest { readonly query: string; readonly chatKey: string; readonly limit?: number; readonly actorKey?: string; }
export interface MemoryRecallItem { readonly id: string; readonly text: string; readonly score: number; readonly source?: string; }
export interface MemoryRecallResponse { readonly items: readonly MemoryRecallItem[]; }
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

export const MEMORY_RECALL_V1: ServiceContract<typeof MEMORY_PLUGIN_ID, 'recall', 1, MemoryRecallRequest, MemoryRecallResponse> = Object.freeze({
  kind: 'service', provider: MEMORY_PLUGIN_ID, name: 'recall', version: 1, schemaId: 'ss-helper.memory.recall.v1',
});

export const MEMORY_GRAPH_V1: ServiceContract<typeof MEMORY_PLUGIN_ID, 'graph', 1, MemoryGraphRequest, MemoryGraphResponse> = Object.freeze({
  kind: 'service', provider: MEMORY_PLUGIN_ID, name: 'graph', version: 1, schemaId: 'ss-helper.memory.graph.v1',
  validateRequest: isMemoryGraphRequest,
  validateResponse: isMemoryGraphResponse,
});

export const MEMORY_UPDATED_V1: EventContract<typeof MEMORY_PLUGIN_ID, 'updated', 1, MemoryUpdatedPayload> = Object.freeze({
  kind: 'event', provider: MEMORY_PLUGIN_ID, name: 'updated', version: 1, schemaId: 'ss-helper.memory.updated.v1',
});
