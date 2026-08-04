import { LLM_PLUGIN_ID } from './core.js';
import type { BusEventContract, RequestContract } from './bus.js';
import type { PlainData } from './plain-data.js';
import { isSSHelperReasonCode, type SSHelperFailureContext } from '../errors.js';

export interface LlmMessage { readonly role: 'system' | 'user' | 'assistant'; readonly content: string; }
export interface LlmUsage { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number; }
export interface LlmRouteMetadata { readonly route: string; readonly provider?: string; readonly model?: string; readonly fallback?: boolean; }
export interface LlmWorkflowTrace {
  readonly workflowId: string;
  readonly workflowLabel: string;
  readonly workflowKind: string;
  readonly jobId?: string;
  readonly batchIndex?: number;
  readonly batchCount?: number;
  readonly stageKey?: string;
  readonly stageDescription?: string;
}
export type LlmStructuredTransport = 'json_schema' | 'json_object' | 'tavern_json_schema' | 'prompt_only';
export type LlmStructuredAttemptPhase = 'initial' | 'schema_repair' | 'transient_retry' | 'route_fallback' | 'transport_fallback';
export type LlmStructuredRepairReason = 'INVALID_JSON' | 'SCHEMA_VALIDATION_FAILED';
export interface LlmStructuredValidationIssue {
  readonly path: string;
  readonly keyword: string;
  readonly expected: string;
}
export interface LlmStructuredItemRejection {
  readonly collection: string;
  readonly itemIndex: number;
  readonly issues: readonly LlmStructuredValidationIssue[];
  readonly sourceRefs: readonly string[];
}
export interface LlmStructuredRepairPolicy {
  readonly maxProviderAttempts: 1 | 2;
  readonly repairOn: readonly LlmStructuredRepairReason[];
  readonly itemFailure?: 'return_partial' | 'fail';
  readonly envelopeFailure?: 'repair_once' | 'fail';
  readonly itemCollections?: readonly string[];
}
export interface LlmStructuredTaskDiagnostics {
  readonly transport: LlmStructuredTransport;
  readonly attemptCount: number;
  readonly repairCount: number;
  readonly validationOutcome: 'complete' | 'partial';
  readonly itemRejections: readonly LlmStructuredItemRejection[];
}
export interface LlmCompletionRequest { readonly messages: readonly LlmMessage[]; readonly route?: string; readonly maxTokens?: number; readonly temperature?: number; readonly trace?: LlmWorkflowTrace; }
export interface LlmCompletionResponse { readonly requestId: string; readonly text: string; readonly route: string; readonly model: string; readonly provider?: string; readonly finishReason?: string; readonly usage?: LlmUsage; }
export interface LlmStructuredTaskRequest { readonly task: string; readonly input: PlainData; readonly outputSchema: Readonly<Record<string, PlainData>>; readonly route?: string; readonly model?: string; readonly timeoutMs?: number; readonly parentRequestId?: string; readonly trace?: LlmWorkflowTrace; }
export interface LlmStructuredTaskResponse { readonly requestId: string; readonly parentRequestId?: string; readonly output: PlainData; readonly route: LlmRouteMetadata; readonly diagnostics: LlmStructuredTaskDiagnostics; readonly usage?: LlmUsage; }
export interface LlmEmbeddingRequest { readonly task?: string; readonly input: string | readonly string[]; readonly model?: string; readonly route?: string; readonly dimensions?: number; readonly timeoutMs?: number; readonly trace?: LlmWorkflowTrace; }
export interface LlmEmbeddingResponse { readonly requestId: string; readonly embeddings: readonly (readonly number[])[]; readonly route: LlmRouteMetadata; readonly usage?: LlmUsage; }
export interface LlmRerankDocument { readonly id: string; readonly text: string; readonly metadata?: Readonly<Record<string, PlainData>>; }
export interface LlmRerankRequest { readonly task?: string; readonly query: string; readonly documents: readonly LlmRerankDocument[]; readonly topN?: number; readonly model?: string; readonly route?: string; readonly timeoutMs?: number; readonly trace?: LlmWorkflowTrace; }
export interface LlmRerankResult { readonly id: string; readonly score: number; readonly index: number; }
export interface LlmRerankResponse { readonly requestId: string; readonly results: readonly LlmRerankResult[]; readonly route: LlmRouteMetadata; readonly usage?: LlmUsage; }
export interface LlmRouteDiagnosticsRequest { readonly requestId?: string; }
export interface LlmRouteDiagnostic { readonly requestId: string; readonly state: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'; readonly route?: LlmRouteMetadata; readonly durationMs?: number; readonly failure?: SSHelperFailureContext; }
export interface LlmRouteDiagnosticsResponse { readonly entries: readonly LlmRouteDiagnostic[]; }
export interface LlmRouteChangedPayload { readonly previousRoute?: string; readonly route: string; readonly reason: 'configured' | 'fallback' | 'availability'; }
export type LlmCapabilityKind = 'generation' | 'embedding' | 'rerank';
export type LlmCapabilityReason = 'llm_disabled' | 'no_resource' | 'resource_disabled' | 'credential_missing' | 'route_unavailable' | 'tavern_unavailable' | 'status_unavailable';
export interface LlmCapabilityCheck { readonly id: string; readonly taskKey: string; readonly taskKind: LlmCapabilityKind; readonly requiredCapabilities?: readonly string[]; }
export interface LlmCapabilityStatusRequest { readonly checks: readonly LlmCapabilityCheck[]; }
export interface LlmCapabilityStatusEntry { readonly id: string; readonly configured: boolean; readonly available: boolean; readonly resourceId?: string; readonly model?: string; readonly source?: 'tavern' | 'custom'; readonly reason?: LlmCapabilityReason; }
export interface LlmCapabilityStatusResponse { readonly revision: number; readonly checks: readonly LlmCapabilityStatusEntry[]; }
export interface LlmCapabilityStatusChangedPayload { readonly revision: number; readonly kinds: readonly LlmCapabilityKind[]; }
export interface LlmConsumerTask { readonly taskKey: string; readonly taskKind: 'generation' | 'embedding' | 'rerank'; readonly requiredCapabilities?: readonly string[]; readonly description?: string; readonly backgroundEligible?: boolean; readonly maxTokens?: number; readonly recommendedRoute?: { readonly resourceId?: string; readonly profileId?: string }; readonly structuredPolicy?: LlmStructuredRepairPolicy; }
export interface LlmConsumerRegistration { readonly displayName: string; readonly registrationVersion: number; readonly tasks: readonly LlmConsumerTask[]; }
export interface LlmConsumerUnregisterRequest { readonly keepPersistent?: boolean; }
export interface LlmConsumerRegistrationResponse { readonly ok: true; }

export type ProviderToolDialect =
  | 'openai_responses'
  | 'anthropic_messages'
  | 'gemini_interactions'
  | 'deepseek_chat'
  | 'kimi_chat'
  | 'glm_chat'
  | 'openai_chat_compatible';
export type ToolSchemaProfile = 'ss_helper_tool_v0';
export type ProviderConversationStateMode = 'local_replay' | 'provider_managed';
export interface ProviderPrivacyPolicy {
  readonly conversationStateMode: ProviderConversationStateMode;
  readonly storeProviderState: boolean;
  readonly allowRemoteRetention: boolean;
}
export interface VerifiedToolCapabilities {
  readonly status: 'unknown' | 'declared' | 'verified' | 'failed';
  readonly resourceId: string;
  readonly model: string;
  readonly dialect: ProviderToolDialect;
  readonly parallelToolCalls: boolean;
  readonly streamingToolCalls: boolean;
  readonly strictToolSchema: 'native' | 'beta' | 'none';
  readonly reasoningReplay: 'none' | 'required' | 'opaque';
  readonly verifiedAt?: number;
  readonly expiresAt?: number;
  readonly probeVersion: number;
  readonly capabilityDigest?: string;
  readonly failureCode?: string;
}
export interface LlmSafeResourceSummary {
  readonly resourceId: string;
  readonly label: string;
  readonly type: LlmCapabilityKind;
  readonly apiType: string;
  readonly defaultModel?: string;
  readonly enabled: boolean;
  readonly available: boolean;
  readonly capabilities: readonly string[];
  readonly toolCapabilities?: VerifiedToolCapabilities;
  readonly privacyPolicy?: ProviderPrivacyPolicy;
  readonly unavailableReason?: string;
}
export interface LlmToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: PlainData;
  readonly strict?: boolean;
}
export interface NormalizedToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: PlainData;
}
export interface NormalizedToolResult {
  readonly callId: string;
  readonly name: string;
  readonly ok: boolean;
  readonly content: PlainData;
}
export interface LlmToolTurnDiagnostics {
  readonly toolSessionRound: number;
  readonly totalCalls: number;
  readonly toolSchemaProfile: ToolSchemaProfile;
  readonly providerAdapterVersion: number;
  readonly capabilitySnapshotId: string;
}
export interface LlmToolTurnRequest {
  readonly task: string;
  readonly pipelineRunId: string;
  readonly chatKey: string;
  readonly input?: PlainData;
  readonly outputSchema?: PlainData;
  readonly tools?: readonly LlmToolDefinition[];
  readonly toolSessionId?: string;
  readonly toolResults?: readonly NormalizedToolResult[];
  readonly route?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
  readonly parentRequestId?: string;
  readonly trace?: LlmWorkflowTrace;
}
export type LlmToolTurnResponse =
  | {
      readonly requestId: string;
      readonly parentRequestId?: string;
      readonly state: 'tool_calls';
      readonly toolSessionId: string;
      readonly calls: readonly NormalizedToolCall[];
      readonly route: LlmRouteMetadata;
      readonly diagnostics: LlmToolTurnDiagnostics;
      readonly usage?: LlmUsage;
    }
  | {
      readonly requestId: string;
      readonly parentRequestId?: string;
      readonly state: 'final';
      readonly output: PlainData;
      readonly route: LlmRouteMetadata;
      readonly diagnostics: LlmToolTurnDiagnostics;
      readonly usage?: LlmUsage;
    };
export interface LlmToolSessionCancelRequest {
  readonly toolSessionId: string;
  readonly reason?: 'cancelled' | 'chat_changed' | 'pipeline_disposed';
}
export interface LlmTaskRoutingAssignment {
  readonly taskKey: string;
  readonly resourceId?: string;
  readonly model?: string;
}
export interface LlmTaskRoutingGetRequest { readonly taskKeys?: readonly string[]; }
export interface LlmTaskRoutingSnapshot {
  readonly revision: number;
  readonly assignments: readonly LlmTaskRoutingAssignment[];
  readonly resources: readonly LlmSafeResourceSummary[];
}
export interface LlmTaskRoutingSetRequest {
  readonly expectedRevision: number;
  readonly assignments: readonly LlmTaskRoutingAssignment[];
}
export interface LlmToolCapabilityVerifyRequest {
  readonly resourceId: string;
  readonly model?: string;
  readonly force?: boolean;
}
export interface LlmToolCapabilityVerifyResponse { readonly capability: VerifiedToolCapabilities; }

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
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null && Object.getPrototypeOf(prototype) !== null) return false;
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => plainData(item, seen))
    : Object.values(value as Record<string, unknown>).every((item) => plainData(item, seen));
  seen.delete(value);
  return valid;
};
const optionalNonEmpty = (value: unknown): boolean => value === undefined || nonEmpty(value);
const optionalTimeout = (value: unknown): boolean => value === undefined || positiveInteger(value);
const workflowTrace = (value: unknown): value is LlmWorkflowTrace => record(value)
  && exact(value, ['workflowId', 'workflowLabel', 'workflowKind'], ['jobId', 'batchIndex', 'batchCount', 'stageKey', 'stageDescription'])
  && nonEmpty(value.workflowId)
  && nonEmpty(value.workflowLabel)
  && nonEmpty(value.workflowKind)
  && optionalNonEmpty(value.jobId)
  && (value.batchIndex === undefined || nonNegativeInteger(value.batchIndex))
  && (value.batchCount === undefined || positiveInteger(value.batchCount))
  && optionalNonEmpty(value.stageKey)
  && optionalNonEmpty(value.stageDescription);
const optionalWorkflowTrace = (value: unknown): boolean => value === undefined || workflowTrace(value);
const optionalRecommendation = (value: unknown): boolean => value === undefined || (record(value) && exact(value, [], ['resourceId', 'profileId']) && optionalNonEmpty(value.resourceId) && optionalNonEmpty(value.profileId));
const failureContext = (value: unknown): value is SSHelperFailureContext => record(value)
  && exact(value, ['reasonCode', 'stage'], ['requestId', 'attemptId', 'batchIndex', 'collection', 'path', 'keyword', 'expected', 'httpStatus', 'providerKind', 'providerErrorCode', 'providerErrorType', 'providerErrorParam', 'resourceId', 'model'])
  && isSSHelperReasonCode(value.reasonCode)
  && nonEmpty(value.stage)
  && optionalNonEmpty(value.requestId)
  && optionalNonEmpty(value.attemptId)
  && (value.batchIndex === undefined || nonNegativeInteger(value.batchIndex))
  && optionalNonEmpty(value.collection)
  && optionalNonEmpty(value.path)
  && optionalNonEmpty(value.keyword)
  && (value.expected === undefined || typeof value.expected === 'string')
  && (value.httpStatus === undefined || nonNegativeInteger(value.httpStatus))
  && optionalNonEmpty(value.providerKind)
  && optionalNonEmpty(value.providerErrorCode)
  && optionalNonEmpty(value.providerErrorType)
  && optionalNonEmpty(value.providerErrorParam)
  && optionalNonEmpty(value.resourceId)
  && optionalNonEmpty(value.model);
const structuredTransport = (value: unknown): value is LlmStructuredTransport => ['json_schema', 'json_object', 'tavern_json_schema', 'prompt_only'].includes(String(value));
const structuredRepairReason = (value: unknown): value is LlmStructuredRepairReason => value === 'INVALID_JSON' || value === 'SCHEMA_VALIDATION_FAILED';
const structuredPolicy = (value: unknown): value is LlmStructuredRepairPolicy => record(value)
  && exact(value, ['maxProviderAttempts', 'repairOn'], ['itemFailure', 'envelopeFailure', 'itemCollections'])
  && (value.maxProviderAttempts === 1 || value.maxProviderAttempts === 2)
  && Array.isArray(value.repairOn)
  && value.repairOn.every(structuredRepairReason)
  && (value.itemFailure === undefined || value.itemFailure === 'return_partial' || value.itemFailure === 'fail')
  && (value.envelopeFailure === undefined || value.envelopeFailure === 'repair_once' || value.envelopeFailure === 'fail')
  && (value.itemCollections === undefined || (Array.isArray(value.itemCollections) && value.itemCollections.length > 0 && value.itemCollections.every(nonEmpty)));
const structuredIssue = (value: unknown): value is LlmStructuredValidationIssue => record(value)
  && exact(value, ['path', 'keyword', 'expected'])
  && nonEmpty(value.path)
  && nonEmpty(value.keyword)
  && typeof value.expected === 'string';
const structuredItemRejection = (value: unknown): value is LlmStructuredItemRejection => record(value)
  && exact(value, ['collection', 'itemIndex', 'issues', 'sourceRefs'])
  && nonEmpty(value.collection)
  && nonNegativeInteger(value.itemIndex)
  && Array.isArray(value.issues)
  && value.issues.length > 0
  && value.issues.every(structuredIssue)
  && Array.isArray(value.sourceRefs)
  && value.sourceRefs.every(nonEmpty);
const structuredDiagnostics = (value: unknown): value is LlmStructuredTaskDiagnostics => record(value)
  && exact(value, ['transport', 'attemptCount', 'repairCount', 'validationOutcome', 'itemRejections'])
  && structuredTransport(value.transport)
  && positiveInteger(value.attemptCount)
  && value.attemptCount <= 2
  && nonNegativeInteger(value.repairCount)
  && value.repairCount <= value.attemptCount
  && (value.validationOutcome === 'complete' || value.validationOutcome === 'partial')
  && Array.isArray(value.itemRejections)
  && value.itemRejections.every(structuredItemRejection)
  && (value.validationOutcome === 'partial' ? value.itemRejections.length > 0 : value.itemRejections.length === 0);
const route = (value: unknown): value is LlmRouteMetadata => record(value) && exact(value, ['route'], ['provider', 'model', 'fallback']) && nonEmpty(value.route) && optionalNonEmpty(value.provider) && optionalNonEmpty(value.model) && (value.fallback === undefined || typeof value.fallback === 'boolean');
const usage = (value: unknown): value is LlmUsage => value === undefined || (record(value) && exact(value, [], ['inputTokens', 'outputTokens', 'totalTokens']) && ['inputTokens', 'outputTokens', 'totalTokens'].every((key) => value[key] === undefined || nonNegativeInteger(value[key])));
const message = (value: unknown): value is LlmMessage => record(value) && exact(value, ['role', 'content']) && (value.role === 'system' || value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string';
export const isLlmCompletionRequest = (value: unknown): value is LlmCompletionRequest => record(value) && exact(value, ['messages'], ['route', 'maxTokens', 'temperature', 'trace']) && Array.isArray(value.messages) && value.messages.length > 0 && value.messages.every(message) && optionalNonEmpty(value.route) && (value.maxTokens === undefined || positiveInteger(value.maxTokens)) && (value.temperature === undefined || (finite(value.temperature) && value.temperature >= 0 && value.temperature <= 2)) && optionalWorkflowTrace(value.trace);
export const isLlmCompletionResponse = (value: unknown): value is LlmCompletionResponse => record(value) && exact(value, ['requestId', 'text', 'route', 'model'], ['provider', 'finishReason', 'usage']) && nonEmpty(value.requestId) && typeof value.text === 'string' && nonEmpty(value.route) && nonEmpty(value.model) && optionalNonEmpty(value.provider) && optionalNonEmpty(value.finishReason) && usage(value.usage);
export const isLlmStructuredTaskRequest = (value: unknown): value is LlmStructuredTaskRequest => record(value) && exact(value, ['task', 'input', 'outputSchema'], ['route', 'model', 'timeoutMs', 'parentRequestId', 'trace']) && nonEmpty(value.task) && plainData(value.input) && record(value.outputSchema) && plainData(value.outputSchema) && optionalNonEmpty(value.route) && optionalNonEmpty(value.model) && optionalTimeout(value.timeoutMs) && optionalNonEmpty(value.parentRequestId) && optionalWorkflowTrace(value.trace);
export const isLlmStructuredTaskResponse = (value: unknown): value is LlmStructuredTaskResponse => record(value) && exact(value, ['requestId', 'output', 'route', 'diagnostics'], ['parentRequestId', 'usage']) && nonEmpty(value.requestId) && optionalNonEmpty(value.parentRequestId) && plainData(value.output) && route(value.route) && structuredDiagnostics(value.diagnostics) && usage(value.usage);
export const isLlmEmbeddingRequest = (value: unknown): value is LlmEmbeddingRequest => record(value) && exact(value, ['input'], ['task', 'model', 'route', 'dimensions', 'timeoutMs', 'trace']) && optionalNonEmpty(value.task) && (nonEmpty(value.input) || (Array.isArray(value.input) && value.input.length > 0 && value.input.every(nonEmpty))) && optionalNonEmpty(value.model) && optionalNonEmpty(value.route) && (value.dimensions === undefined || positiveInteger(value.dimensions)) && optionalTimeout(value.timeoutMs) && optionalWorkflowTrace(value.trace);
export const isLlmEmbeddingResponse = (value: unknown): value is LlmEmbeddingResponse => record(value) && exact(value, ['requestId', 'embeddings', 'route'], ['usage']) && nonEmpty(value.requestId) && Array.isArray(value.embeddings) && value.embeddings.length > 0 && value.embeddings.every((vector) => Array.isArray(vector) && vector.length > 0 && vector.every(finite)) && route(value.route) && usage(value.usage);
const rerankDocument = (value: unknown): value is LlmRerankDocument => record(value) && exact(value, ['id', 'text'], ['metadata']) && nonEmpty(value.id) && nonEmpty(value.text) && (value.metadata === undefined || (record(value.metadata) && plainData(value.metadata)));
export const isLlmRerankRequest = (value: unknown): value is LlmRerankRequest => record(value) && exact(value, ['query', 'documents'], ['task', 'topN', 'model', 'route', 'timeoutMs', 'trace']) && optionalNonEmpty(value.task) && nonEmpty(value.query) && Array.isArray(value.documents) && value.documents.length > 0 && value.documents.every(rerankDocument) && (value.topN === undefined || (positiveInteger(value.topN) && value.topN <= value.documents.length)) && optionalNonEmpty(value.model) && optionalNonEmpty(value.route) && optionalTimeout(value.timeoutMs) && optionalWorkflowTrace(value.trace);
export const isLlmRerankResponse = (value: unknown): value is LlmRerankResponse => record(value) && exact(value, ['requestId', 'results', 'route'], ['usage']) && nonEmpty(value.requestId) && Array.isArray(value.results) && value.results.every((item) => record(item) && exact(item, ['id', 'score', 'index']) && nonEmpty(item.id) && finite(item.score) && nonNegativeInteger(item.index)) && route(value.route) && usage(value.usage);
export const isLlmRouteDiagnosticsRequest = (value: unknown): value is LlmRouteDiagnosticsRequest => record(value) && exact(value, [], ['requestId']) && optionalNonEmpty(value.requestId);
export const isLlmRouteDiagnosticsResponse = (value: unknown): value is LlmRouteDiagnosticsResponse => record(value) && exact(value, ['entries']) && Array.isArray(value.entries) && value.entries.every((item) => record(item) && exact(item, ['requestId', 'state'], ['route', 'durationMs', 'failure']) && nonEmpty(item.requestId) && ['queued', 'running', 'completed', 'failed', 'aborted'].includes(String(item.state)) && (item.route === undefined || route(item.route)) && (item.durationMs === undefined || (finite(item.durationMs) && item.durationMs >= 0)) && (item.failure === undefined || failureContext(item.failure)));
export const isLlmRouteChangedPayload = (value: unknown): value is LlmRouteChangedPayload => record(value) && exact(value, ['route', 'reason'], ['previousRoute']) && nonEmpty(value.route) && optionalNonEmpty(value.previousRoute) && ['configured', 'fallback', 'availability'].includes(String(value.reason));
const capabilityKind = (value: unknown): value is LlmCapabilityKind => value === 'generation' || value === 'embedding' || value === 'rerank';
const capabilityReason = (value: unknown): value is LlmCapabilityReason => ['llm_disabled', 'no_resource', 'resource_disabled', 'credential_missing', 'route_unavailable', 'tavern_unavailable', 'status_unavailable'].includes(String(value));
const capabilityCheck = (value: unknown): value is LlmCapabilityCheck => record(value) && exact(value, ['id', 'taskKey', 'taskKind'], ['requiredCapabilities']) && nonEmpty(value.id) && nonEmpty(value.taskKey) && capabilityKind(value.taskKind) && (value.requiredCapabilities === undefined || (Array.isArray(value.requiredCapabilities) && value.requiredCapabilities.every(nonEmpty)));
const capabilityEntry = (value: unknown): value is LlmCapabilityStatusEntry => record(value) && exact(value, ['id', 'configured', 'available'], ['resourceId', 'model', 'source', 'reason']) && nonEmpty(value.id) && typeof value.configured === 'boolean' && typeof value.available === 'boolean' && optionalNonEmpty(value.resourceId) && optionalNonEmpty(value.model) && (value.source === undefined || value.source === 'tavern' || value.source === 'custom') && (value.reason === undefined || capabilityReason(value.reason));
export const isLlmCapabilityStatusRequest = (value: unknown): value is LlmCapabilityStatusRequest => record(value) && exact(value, ['checks']) && Array.isArray(value.checks) && value.checks.length > 0 && value.checks.every(capabilityCheck);
export const isLlmCapabilityStatusResponse = (value: unknown): value is LlmCapabilityStatusResponse => record(value) && exact(value, ['revision', 'checks']) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 && Array.isArray(value.checks) && value.checks.every(capabilityEntry);
export const isLlmCapabilityStatusChangedPayload = (value: unknown): value is LlmCapabilityStatusChangedPayload => record(value) && exact(value, ['revision', 'kinds']) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 && Array.isArray(value.kinds) && value.kinds.length > 0 && value.kinds.every(capabilityKind);

const toolDialect = (value: unknown): value is ProviderToolDialect => [
  'openai_responses', 'anthropic_messages', 'gemini_interactions', 'deepseek_chat',
  'kimi_chat', 'glm_chat', 'openai_chat_compatible',
].includes(String(value));
const privacyPolicy = (value: unknown): value is ProviderPrivacyPolicy => record(value)
  && exact(value, ['conversationStateMode', 'storeProviderState', 'allowRemoteRetention'])
  && (value.conversationStateMode === 'local_replay' || value.conversationStateMode === 'provider_managed')
  && typeof value.storeProviderState === 'boolean'
  && typeof value.allowRemoteRetention === 'boolean';
const verifiedToolCapabilities = (value: unknown): value is VerifiedToolCapabilities => record(value)
  && exact(value, ['status', 'resourceId', 'model', 'dialect', 'parallelToolCalls', 'streamingToolCalls', 'strictToolSchema', 'reasoningReplay', 'probeVersion'], ['verifiedAt', 'expiresAt', 'capabilityDigest', 'failureCode'])
  && ['unknown', 'declared', 'verified', 'failed'].includes(String(value.status))
  && nonEmpty(value.resourceId)
  && nonEmpty(value.model)
  && toolDialect(value.dialect)
  && typeof value.parallelToolCalls === 'boolean'
  && typeof value.streamingToolCalls === 'boolean'
  && ['native', 'beta', 'none'].includes(String(value.strictToolSchema))
  && ['none', 'required', 'opaque'].includes(String(value.reasoningReplay))
  && positiveInteger(value.probeVersion)
  && (value.verifiedAt === undefined || nonNegativeInteger(value.verifiedAt))
  && (value.expiresAt === undefined || nonNegativeInteger(value.expiresAt))
  && optionalNonEmpty(value.capabilityDigest)
  && optionalNonEmpty(value.failureCode);
const safeResourceSummary = (value: unknown): value is LlmSafeResourceSummary => record(value)
  && exact(value, ['resourceId', 'label', 'type', 'apiType', 'enabled', 'available', 'capabilities'], ['defaultModel', 'toolCapabilities', 'privacyPolicy', 'unavailableReason'])
  && nonEmpty(value.resourceId)
  && nonEmpty(value.label)
  && capabilityKind(value.type)
  && nonEmpty(value.apiType)
  && typeof value.enabled === 'boolean'
  && typeof value.available === 'boolean'
  && Array.isArray(value.capabilities)
  && value.capabilities.every(nonEmpty)
  && optionalNonEmpty(value.defaultModel)
  && (value.toolCapabilities === undefined || verifiedToolCapabilities(value.toolCapabilities))
  && (value.privacyPolicy === undefined || privacyPolicy(value.privacyPolicy))
  && optionalNonEmpty(value.unavailableReason);
const toolDefinition = (value: unknown): value is LlmToolDefinition => record(value)
  && exact(value, ['name', 'description', 'parameters'], ['strict'])
  && nonEmpty(value.name)
  && nonEmpty(value.description)
  && plainData(value.parameters)
  && (value.strict === undefined || typeof value.strict === 'boolean');
const normalizedToolCall = (value: unknown): value is NormalizedToolCall => record(value)
  && exact(value, ['callId', 'name', 'arguments'])
  && nonEmpty(value.callId)
  && nonEmpty(value.name)
  && plainData(value.arguments);
const normalizedToolResult = (value: unknown): value is NormalizedToolResult => record(value)
  && exact(value, ['callId', 'name', 'ok', 'content'])
  && nonEmpty(value.callId)
  && nonEmpty(value.name)
  && typeof value.ok === 'boolean'
  && plainData(value.content);
const toolTurnDiagnostics = (value: unknown): value is LlmToolTurnDiagnostics => record(value)
  && exact(value, ['toolSessionRound', 'totalCalls', 'toolSchemaProfile', 'providerAdapterVersion', 'capabilitySnapshotId'])
  && positiveInteger(value.toolSessionRound)
  && nonNegativeInteger(value.totalCalls)
  && value.toolSchemaProfile === 'ss_helper_tool_v0'
  && positiveInteger(value.providerAdapterVersion)
  && nonEmpty(value.capabilitySnapshotId);
export const isLlmToolTurnRequest = (value: unknown): value is LlmToolTurnRequest => {
  if (!record(value) || !exact(value, ['task', 'pipelineRunId', 'chatKey'], ['input', 'outputSchema', 'tools', 'toolSessionId', 'toolResults', 'route', 'model', 'timeoutMs', 'maxTokens', 'parentRequestId', 'trace'])) return false;
  if (!nonEmpty(value.task) || !nonEmpty(value.pipelineRunId) || !nonEmpty(value.chatKey) || !optionalNonEmpty(value.route) || !optionalNonEmpty(value.model) || !optionalTimeout(value.timeoutMs) || (value.maxTokens !== undefined && (!positiveInteger(value.maxTokens) || value.maxTokens > 65_536)) || !optionalNonEmpty(value.parentRequestId)) return false;
  if (!optionalWorkflowTrace(value.trace) || (value.trace !== undefined && (value.trace as LlmWorkflowTrace).workflowId !== value.pipelineRunId)) return false;
  const start = value.toolSessionId === undefined
    && value.toolResults === undefined
    && value.input !== undefined
    && value.outputSchema !== undefined
    && Array.isArray(value.tools)
    && value.tools.length > 0
    && value.tools.every(toolDefinition)
    && plainData(value.input)
    && plainData(value.outputSchema);
  const continuation = nonEmpty(value.toolSessionId)
    && Array.isArray(value.toolResults)
    && value.toolResults.length > 0
    && value.toolResults.every(normalizedToolResult)
    && value.input === undefined
    && value.outputSchema === undefined
    && value.tools === undefined;
  return start || continuation;
};
export const isLlmToolTurnResponse = (value: unknown): value is LlmToolTurnResponse => {
  if (!record(value) || !nonEmpty(value.requestId) || !optionalNonEmpty(value.parentRequestId) || !route(value.route) || !toolTurnDiagnostics(value.diagnostics) || !usage(value.usage)) return false;
  if (value.state === 'tool_calls') return exact(value, ['requestId', 'state', 'toolSessionId', 'calls', 'route', 'diagnostics'], ['parentRequestId', 'usage'])
    && nonEmpty(value.toolSessionId)
    && Array.isArray(value.calls)
    && value.calls.length > 0
    && value.calls.every(normalizedToolCall)
    && new Set(value.calls.map((call) => call.callId)).size === value.calls.length;
  return value.state === 'final'
    && exact(value, ['requestId', 'state', 'output', 'route', 'diagnostics'], ['parentRequestId', 'usage'])
    && plainData(value.output);
};
export const isLlmToolSessionCancelRequest = (value: unknown): value is LlmToolSessionCancelRequest => record(value)
  && exact(value, ['toolSessionId'], ['reason'])
  && nonEmpty(value.toolSessionId)
  && (value.reason === undefined || ['cancelled', 'chat_changed', 'pipeline_disposed'].includes(String(value.reason)));
const taskRoutingAssignment = (value: unknown): value is LlmTaskRoutingAssignment => record(value)
  && exact(value, ['taskKey'], ['resourceId', 'model'])
  && nonEmpty(value.taskKey)
  && optionalNonEmpty(value.resourceId)
  && optionalNonEmpty(value.model)
  && !(value.model !== undefined && value.resourceId === undefined);
export const isLlmTaskRoutingGetRequest = (value: unknown): value is LlmTaskRoutingGetRequest => record(value)
  && exact(value, [], ['taskKeys'])
  && (value.taskKeys === undefined || (Array.isArray(value.taskKeys) && value.taskKeys.length > 0 && value.taskKeys.every(nonEmpty)));
export const isLlmTaskRoutingSnapshot = (value: unknown): value is LlmTaskRoutingSnapshot => record(value)
  && exact(value, ['revision', 'assignments', 'resources'])
  && nonNegativeInteger(value.revision)
  && Array.isArray(value.assignments)
  && value.assignments.every(taskRoutingAssignment)
  && new Set(value.assignments.map((assignment) => assignment.taskKey)).size === value.assignments.length
  && Array.isArray(value.resources)
  && value.resources.every(safeResourceSummary);
export const isLlmTaskRoutingSetRequest = (value: unknown): value is LlmTaskRoutingSetRequest => record(value)
  && exact(value, ['expectedRevision', 'assignments'])
  && nonNegativeInteger(value.expectedRevision)
  && Array.isArray(value.assignments)
  && value.assignments.every(taskRoutingAssignment)
  && new Set(value.assignments.map((assignment) => assignment.taskKey)).size === value.assignments.length;
export const isLlmToolCapabilityVerifyRequest = (value: unknown): value is LlmToolCapabilityVerifyRequest => record(value)
  && exact(value, ['resourceId'], ['model', 'force'])
  && nonEmpty(value.resourceId)
  && optionalNonEmpty(value.model)
  && (value.force === undefined || typeof value.force === 'boolean');
export const isLlmToolCapabilityVerifyResponse = (value: unknown): value is LlmToolCapabilityVerifyResponse => record(value)
  && exact(value, ['capability'])
  && verifiedToolCapabilities(value.capability);
const isAck = (value: unknown): value is { readonly ok: true } => record(value) && exact(value, ['ok']) && value.ok === true;

const request = <N extends string, Q, S>(name: N, validateRequest: (value: unknown) => value is Q, validateResponse: (value: unknown) => value is S): RequestContract<`${typeof LLM_PLUGIN_ID}.${N}`, 0, Q, S> => Object.freeze({ kind: 'request', id: `${LLM_PLUGIN_ID}.${name}`, version: 0, validateRequest, validateResponse });
export const LLM_COMPLETION_V0 = request('completion', isLlmCompletionRequest, isLlmCompletionResponse);
export const LLM_STRUCTURED_TASK_V0 = request('structured-task', isLlmStructuredTaskRequest, isLlmStructuredTaskResponse);
export const LLM_EMBEDDING_V0 = request('embedding', isLlmEmbeddingRequest, isLlmEmbeddingResponse);
export const LLM_RERANK_V0 = request('rerank', isLlmRerankRequest, isLlmRerankResponse);
export const LLM_CAPABILITY_STATUS_V0 = request('capability-status', isLlmCapabilityStatusRequest, isLlmCapabilityStatusResponse);
export const LLM_TOOL_TURN_V0 = request('tool-turn', isLlmToolTurnRequest, isLlmToolTurnResponse);
export const LLM_TOOL_SESSION_CANCEL_V0 = request('tool-session-cancel', isLlmToolSessionCancelRequest, isAck);
export const LLM_TASK_ROUTING_GET_V0 = request('task-routing-get', isLlmTaskRoutingGetRequest, isLlmTaskRoutingSnapshot);
export const LLM_TASK_ROUTING_SET_V0 = request('task-routing-set', isLlmTaskRoutingSetRequest, isLlmTaskRoutingSnapshot);
export const LLM_TOOL_CAPABILITY_VERIFY_V0 = request('tool-capability-verify', isLlmToolCapabilityVerifyRequest, isLlmToolCapabilityVerifyResponse);
export const isLlmConsumerRegistration = (value: unknown): value is LlmConsumerRegistration => record(value) && exact(value, ['displayName', 'registrationVersion', 'tasks']) && nonEmpty(value.displayName) && positiveInteger(value.registrationVersion) && Array.isArray(value.tasks) && value.tasks.every((task) => record(task) && exact(task, ['taskKey', 'taskKind'], ['requiredCapabilities', 'description', 'backgroundEligible', 'maxTokens', 'recommendedRoute', 'structuredPolicy']) && nonEmpty(task.taskKey) && ['generation', 'embedding', 'rerank'].includes(String(task.taskKind)) && (task.requiredCapabilities === undefined || (Array.isArray(task.requiredCapabilities) && task.requiredCapabilities.every(nonEmpty))) && (task.description === undefined || typeof task.description === 'string') && (task.backgroundEligible === undefined || typeof task.backgroundEligible === 'boolean') && (task.maxTokens === undefined || positiveInteger(task.maxTokens)) && optionalRecommendation(task.recommendedRoute) && (task.structuredPolicy === undefined || (record(task.structuredPolicy) && exact(task.structuredPolicy, ['maxProviderAttempts', 'repairOn'], ['itemFailure', 'envelopeFailure', 'itemCollections']) && structuredPolicy(task.structuredPolicy))));
const isConsumerUnregisterRequest = (value: unknown): value is LlmConsumerUnregisterRequest => record(value) && exact(value, [], ['keepPersistent']) && (value.keepPersistent === undefined || typeof value.keepPersistent === 'boolean');
export const LLM_CONSUMER_DECLARE_V0 = request('consumer-declare', isLlmConsumerRegistration, isAck);
export const LLM_CONSUMER_RELEASE_V0 = request('consumer-release', isConsumerUnregisterRequest, isAck);
export const LLM_ROUTE_CHANGED_V0: BusEventContract<`${typeof LLM_PLUGIN_ID}.route-changed`, 0, LlmRouteChangedPayload> = Object.freeze({ kind: 'event', id: 'ss-helper.llm.route-changed', version: 0, validatePayload: isLlmRouteChangedPayload });
export const LLM_CAPABILITY_STATUS_CHANGED_V0: BusEventContract<`${typeof LLM_PLUGIN_ID}.capability-status-changed`, 0, LlmCapabilityStatusChangedPayload> = Object.freeze({ kind: 'event', id: 'ss-helper.llm.capability-status-changed', version: 0, validatePayload: isLlmCapabilityStatusChangedPayload });
