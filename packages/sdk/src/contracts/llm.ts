import { LLM_PLUGIN_ID } from './core.js';
import type { EventContract } from './events.js';
import type { PlainData } from './plain-data.js';
import type { ServiceContract } from './services.js';

export interface LlmMessage { readonly role: 'system' | 'user' | 'assistant'; readonly content: string; }
export interface LlmUsage { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number; }
export interface LlmRouteMetadata { readonly route: string; readonly provider?: string; readonly model?: string; readonly fallback?: boolean; }
export interface LlmCompletionRequest { readonly messages: readonly LlmMessage[]; readonly route?: string; readonly maxTokens?: number; readonly temperature?: number; }
export interface LlmCompletionResponse { readonly text: string; readonly route: string; readonly model: string; readonly provider?: string; readonly finishReason?: string; readonly usage?: LlmUsage; }
export interface LlmStructuredTaskRequest { readonly task: string; readonly input: PlainData; readonly outputSchema: Readonly<Record<string, PlainData>>; readonly route?: string; readonly timeoutMs?: number; }
export interface LlmStructuredTaskResponse { readonly output: PlainData; readonly route: LlmRouteMetadata; readonly usage?: LlmUsage; }
export interface LlmEmbeddingRequest { readonly input: string | readonly string[]; readonly model?: string; readonly route?: string; readonly dimensions?: number; readonly timeoutMs?: number; }
export interface LlmEmbeddingResponse { readonly embeddings: readonly (readonly number[])[]; readonly route: LlmRouteMetadata; readonly usage?: LlmUsage; }
export interface LlmRerankDocument { readonly id: string; readonly text: string; readonly metadata?: Readonly<Record<string, PlainData>>; }
export interface LlmRerankRequest { readonly query: string; readonly documents: readonly LlmRerankDocument[]; readonly topN?: number; readonly model?: string; readonly route?: string; readonly timeoutMs?: number; }
export interface LlmRerankResult { readonly id: string; readonly score: number; readonly index: number; }
export interface LlmRerankResponse { readonly results: readonly LlmRerankResult[]; readonly route: LlmRouteMetadata; readonly usage?: LlmUsage; }
export interface LlmRouteDiagnosticsRequest { readonly requestId?: string; }
export interface LlmRouteDiagnostic { readonly requestId: string; readonly state: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'; readonly route?: LlmRouteMetadata; readonly durationMs?: number; readonly errorCode?: string; }
export interface LlmRouteDiagnosticsResponse { readonly entries: readonly LlmRouteDiagnostic[]; }
export interface LlmRouteChangedPayload { readonly previousRoute?: string; readonly route: string; readonly reason: 'configured' | 'fallback' | 'availability'; }
export type LlmCapabilityKind = 'generation' | 'embedding' | 'rerank';
export type LlmCapabilityReason = 'llm_disabled' | 'no_resource' | 'resource_disabled' | 'credential_missing' | 'route_unavailable' | 'tavern_unavailable' | 'status_unavailable';
export interface LlmCapabilityCheck { readonly id: string; readonly taskKey: string; readonly taskKind: LlmCapabilityKind; readonly requiredCapabilities?: readonly string[]; }
export interface LlmCapabilityStatusRequest { readonly checks: readonly LlmCapabilityCheck[]; }
export interface LlmCapabilityStatusEntry { readonly id: string; readonly configured: boolean; readonly available: boolean; readonly resourceId?: string; readonly model?: string; readonly source?: 'tavern' | 'custom'; readonly reason?: LlmCapabilityReason; }
export interface LlmCapabilityStatusResponse { readonly revision: number; readonly checks: readonly LlmCapabilityStatusEntry[]; }
export interface LlmCapabilityStatusChangedPayload { readonly revision: number; readonly kinds: readonly LlmCapabilityKind[]; }
export interface LlmConsumerTask { readonly taskKey: string; readonly taskKind: 'generation' | 'embedding' | 'rerank'; readonly requiredCapabilities?: readonly string[]; readonly description?: string; readonly backgroundEligible?: boolean; readonly maxTokens?: number; readonly recommendedRoute?: { readonly resourceId?: string; readonly profileId?: string }; readonly recommendedDisplay?: 'fullscreen' | 'compact' | 'silent'; }
export interface LlmConsumerRegistration { readonly displayName: string; readonly registrationVersion: number; readonly tasks: readonly LlmConsumerTask[]; }
export interface LlmConsumerUnregisterRequest { readonly keepPersistent?: boolean; }
export interface LlmWaitForDisplayRequest { readonly requestId: string; }
export interface LlmWaitForDisplayResponse { readonly closed: boolean; }

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const exact = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean => required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const nonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const plainData = (value: unknown, seen = new Set<object>()): value is PlainData => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => plainData(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  return Object.values(value as Record<string, unknown>).every((item) => plainData(item, seen));
};
const optionalNonEmpty = (value: unknown): boolean => value === undefined || nonEmpty(value);
const optionalTimeout = (value: unknown): boolean => value === undefined || positiveInteger(value);
const optionalRecommendation = (value: unknown): boolean => value === undefined || (record(value) && exact(value, [], ['resourceId', 'profileId']) && optionalNonEmpty(value.resourceId) && optionalNonEmpty(value.profileId));
const route = (value: unknown): value is LlmRouteMetadata => record(value) && exact(value, ['route'], ['provider', 'model', 'fallback']) && nonEmpty(value.route) && optionalNonEmpty(value.provider) && optionalNonEmpty(value.model) && (value.fallback === undefined || typeof value.fallback === 'boolean');
const usage = (value: unknown): value is LlmUsage => value === undefined || (record(value) && exact(value, [], ['inputTokens', 'outputTokens', 'totalTokens']) && ['inputTokens', 'outputTokens', 'totalTokens'].every((key) => value[key] === undefined || nonNegativeInteger(value[key])));
const message = (value: unknown): value is LlmMessage => record(value) && exact(value, ['role', 'content']) && (value.role === 'system' || value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string';
export const isLlmCompletionRequest = (value: unknown): value is LlmCompletionRequest => record(value) && exact(value, ['messages'], ['route', 'maxTokens', 'temperature']) && Array.isArray(value.messages) && value.messages.length > 0 && value.messages.every(message) && optionalNonEmpty(value.route) && (value.maxTokens === undefined || positiveInteger(value.maxTokens)) && (value.temperature === undefined || (finite(value.temperature) && value.temperature >= 0 && value.temperature <= 2));
export const isLlmCompletionResponse = (value: unknown): value is LlmCompletionResponse => record(value) && exact(value, ['text', 'route', 'model'], ['provider', 'finishReason', 'usage']) && typeof value.text === 'string' && nonEmpty(value.route) && nonEmpty(value.model) && optionalNonEmpty(value.provider) && optionalNonEmpty(value.finishReason) && usage(value.usage);
export const isLlmStructuredTaskRequest = (value: unknown): value is LlmStructuredTaskRequest => record(value) && exact(value, ['task', 'input', 'outputSchema'], ['route', 'timeoutMs']) && nonEmpty(value.task) && plainData(value.input) && record(value.outputSchema) && plainData(value.outputSchema) && optionalNonEmpty(value.route) && optionalTimeout(value.timeoutMs);
export const isLlmStructuredTaskResponse = (value: unknown): value is LlmStructuredTaskResponse => record(value) && exact(value, ['output', 'route'], ['usage']) && plainData(value.output) && route(value.route) && usage(value.usage);
export const isLlmEmbeddingRequest = (value: unknown): value is LlmEmbeddingRequest => record(value) && exact(value, ['input'], ['model', 'route', 'dimensions', 'timeoutMs']) && (nonEmpty(value.input) || (Array.isArray(value.input) && value.input.length > 0 && value.input.every(nonEmpty))) && optionalNonEmpty(value.model) && optionalNonEmpty(value.route) && (value.dimensions === undefined || positiveInteger(value.dimensions)) && optionalTimeout(value.timeoutMs);
export const isLlmEmbeddingResponse = (value: unknown): value is LlmEmbeddingResponse => record(value) && exact(value, ['embeddings', 'route'], ['usage']) && Array.isArray(value.embeddings) && value.embeddings.length > 0 && value.embeddings.every((vector) => Array.isArray(vector) && vector.length > 0 && vector.every(finite)) && route(value.route) && usage(value.usage);
const rerankDocument = (value: unknown): value is LlmRerankDocument => record(value) && exact(value, ['id', 'text'], ['metadata']) && nonEmpty(value.id) && nonEmpty(value.text) && (value.metadata === undefined || (record(value.metadata) && plainData(value.metadata)));
export const isLlmRerankRequest = (value: unknown): value is LlmRerankRequest => record(value) && exact(value, ['query', 'documents'], ['topN', 'model', 'route', 'timeoutMs']) && nonEmpty(value.query) && Array.isArray(value.documents) && value.documents.length > 0 && value.documents.every(rerankDocument) && (value.topN === undefined || (positiveInteger(value.topN) && value.topN <= value.documents.length)) && optionalNonEmpty(value.model) && optionalNonEmpty(value.route) && optionalTimeout(value.timeoutMs);
export const isLlmRerankResponse = (value: unknown): value is LlmRerankResponse => record(value) && exact(value, ['results', 'route'], ['usage']) && Array.isArray(value.results) && value.results.every((item) => record(item) && exact(item, ['id', 'score', 'index']) && nonEmpty(item.id) && finite(item.score) && nonNegativeInteger(item.index)) && route(value.route) && usage(value.usage);
export const isLlmRouteDiagnosticsRequest = (value: unknown): value is LlmRouteDiagnosticsRequest => record(value) && exact(value, [], ['requestId']) && optionalNonEmpty(value.requestId);
export const isLlmRouteDiagnosticsResponse = (value: unknown): value is LlmRouteDiagnosticsResponse => record(value) && exact(value, ['entries']) && Array.isArray(value.entries) && value.entries.every((item) => record(item) && exact(item, ['requestId', 'state'], ['route', 'durationMs', 'errorCode']) && nonEmpty(item.requestId) && ['queued', 'running', 'completed', 'failed', 'aborted'].includes(String(item.state)) && (item.route === undefined || route(item.route)) && (item.durationMs === undefined || (finite(item.durationMs) && item.durationMs >= 0)) && optionalNonEmpty(item.errorCode));
export const isLlmRouteChangedPayload = (value: unknown): value is LlmRouteChangedPayload => record(value) && exact(value, ['route', 'reason'], ['previousRoute']) && nonEmpty(value.route) && optionalNonEmpty(value.previousRoute) && ['configured', 'fallback', 'availability'].includes(String(value.reason));
const capabilityKind = (value: unknown): value is LlmCapabilityKind => value === 'generation' || value === 'embedding' || value === 'rerank';
const capabilityReason = (value: unknown): value is LlmCapabilityReason => ['llm_disabled', 'no_resource', 'resource_disabled', 'credential_missing', 'route_unavailable', 'tavern_unavailable', 'status_unavailable'].includes(String(value));
const capabilityCheck = (value: unknown): value is LlmCapabilityCheck => record(value) && exact(value, ['id', 'taskKey', 'taskKind'], ['requiredCapabilities']) && nonEmpty(value.id) && nonEmpty(value.taskKey) && capabilityKind(value.taskKind) && (value.requiredCapabilities === undefined || (Array.isArray(value.requiredCapabilities) && value.requiredCapabilities.every(nonEmpty)));
const capabilityEntry = (value: unknown): value is LlmCapabilityStatusEntry => record(value) && exact(value, ['id', 'configured', 'available'], ['resourceId', 'model', 'source', 'reason']) && nonEmpty(value.id) && typeof value.configured === 'boolean' && typeof value.available === 'boolean' && optionalNonEmpty(value.resourceId) && optionalNonEmpty(value.model) && (value.source === undefined || value.source === 'tavern' || value.source === 'custom') && (value.reason === undefined || capabilityReason(value.reason));
export const isLlmCapabilityStatusRequest = (value: unknown): value is LlmCapabilityStatusRequest => record(value) && exact(value, ['checks']) && Array.isArray(value.checks) && value.checks.length > 0 && value.checks.every(capabilityCheck);
export const isLlmCapabilityStatusResponse = (value: unknown): value is LlmCapabilityStatusResponse => record(value) && exact(value, ['revision', 'checks']) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 && Array.isArray(value.checks) && value.checks.every(capabilityEntry);
export const isLlmCapabilityStatusChangedPayload = (value: unknown): value is LlmCapabilityStatusChangedPayload => record(value) && exact(value, ['revision', 'kinds']) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 && Array.isArray(value.kinds) && value.kinds.length > 0 && value.kinds.every(capabilityKind);

const service = <N extends string, Q, S>(name: N, validateRequest: (value: unknown) => value is Q, validateResponse: (value: unknown) => value is S): ServiceContract<typeof LLM_PLUGIN_ID, N, 1, Q, S> => Object.freeze({ kind: 'service', provider: LLM_PLUGIN_ID, name, version: 1, schemaId: `ss-helper.llm.${name}.v1`, validateRequest, validateResponse });
export const LLM_COMPLETION_V1 = service('completion', isLlmCompletionRequest, isLlmCompletionResponse);
export const LLM_STRUCTURED_TASK_V1 = service('structured-task', isLlmStructuredTaskRequest, isLlmStructuredTaskResponse);
export const LLM_EMBEDDING_V1 = service('embedding', isLlmEmbeddingRequest, isLlmEmbeddingResponse);
export const LLM_RERANK_V1 = service('rerank', isLlmRerankRequest, isLlmRerankResponse);
export const LLM_ROUTE_DIAGNOSTICS_V1 = service('route-diagnostics', isLlmRouteDiagnosticsRequest, isLlmRouteDiagnosticsResponse);
export const LLM_CAPABILITY_STATUS_V1 = service('capability-status', isLlmCapabilityStatusRequest, isLlmCapabilityStatusResponse);
const isConsumerRegistration = (value: unknown): value is LlmConsumerRegistration => record(value) && exact(value, ['displayName', 'registrationVersion', 'tasks']) && nonEmpty(value.displayName) && positiveInteger(value.registrationVersion) && Array.isArray(value.tasks) && value.tasks.every((task) => record(task) && exact(task, ['taskKey', 'taskKind'], ['requiredCapabilities', 'description', 'backgroundEligible', 'maxTokens', 'recommendedRoute', 'recommendedDisplay']) && nonEmpty(task.taskKey) && ['generation', 'embedding', 'rerank'].includes(String(task.taskKind)) && (task.requiredCapabilities === undefined || (Array.isArray(task.requiredCapabilities) && task.requiredCapabilities.every(nonEmpty))) && (task.description === undefined || typeof task.description === 'string') && (task.backgroundEligible === undefined || typeof task.backgroundEligible === 'boolean') && (task.maxTokens === undefined || positiveInteger(task.maxTokens)) && optionalRecommendation(task.recommendedRoute) && (task.recommendedDisplay === undefined || ['fullscreen', 'compact', 'silent'].includes(String(task.recommendedDisplay))));
const isConsumerUnregisterRequest = (value: unknown): value is LlmConsumerUnregisterRequest => record(value) && exact(value, [], ['keepPersistent']) && (value.keepPersistent === undefined || typeof value.keepPersistent === 'boolean');
const isWaitForDisplayRequest = (value: unknown): value is LlmWaitForDisplayRequest => record(value) && exact(value, ['requestId']) && nonEmpty(value.requestId);
const isWaitForDisplayResponse = (value: unknown): value is LlmWaitForDisplayResponse => record(value) && exact(value, ['closed']) && typeof value.closed === 'boolean';
const isAck = (value: unknown): value is { readonly ok: true } => record(value) && exact(value, ['ok']) && value.ok === true;
export const LLM_CONSUMER_REGISTER_V1 = service('consumer-register', isConsumerRegistration, isAck);
export const LLM_CONSUMER_UNREGISTER_V1 = service('consumer-unregister', isConsumerUnregisterRequest, isAck);
export const LLM_WAIT_FOR_DISPLAY_V1 = service('wait-for-display', isWaitForDisplayRequest, isWaitForDisplayResponse);
export const LLM_ROUTE_CHANGED_V1: EventContract<typeof LLM_PLUGIN_ID, 'route-changed', 1, LlmRouteChangedPayload> = Object.freeze({ kind: 'event', provider: LLM_PLUGIN_ID, name: 'route-changed', version: 1, schemaId: 'ss-helper.llm.route-changed.v1', validatePayload: isLlmRouteChangedPayload });
export const LLM_CAPABILITY_STATUS_CHANGED_V1: EventContract<typeof LLM_PLUGIN_ID, 'capability-status-changed', 1, LlmCapabilityStatusChangedPayload> = Object.freeze({ kind: 'event', provider: LLM_PLUGIN_ID, name: 'capability-status-changed', version: 1, schemaId: 'ss-helper.llm.capability-status-changed.v1', validatePayload: isLlmCapabilityStatusChangedPayload });
