import {
  API_MAJOR,
  CORE_DISCOVERY_SYMBOL,
  CORE_EXTENSION_DIRECTORY,
  LLM_COMPLETION_V1,
  LLM_STRUCTURED_TASK_V1,
  LLM_EMBEDDING_V1,
  LLM_RERANK_V1,
  LLM_ROUTE_CHANGED_V1,
  MEMORY_RECALL_V1,
  MEMORY_UPDATED_V1,
  type CoreDescriptor,
  type EventPort,
  type HostPort,
  type ChatMessageInput,
  type LlmCompletionRequest,
  type MemoryRecallRequest,
  type PluginDescriptor,
  type PluginSession,
  type ServicePort,
  type SettingsSchema,
  type VersionAxes,
} from '@ss-helper/sdk';
import { CORE_PLUGIN_ID } from '@ss-helper/sdk/contracts/core';
import type { EventContract } from '@ss-helper/sdk/contracts/events';
import type { HostCapability } from '@ss-helper/sdk/contracts/host';
import type { LlmCompletionResponse } from '@ss-helper/sdk/contracts/llm';
import type { MemoryRecallResponse } from '@ss-helper/sdk/contracts/memory';
import type { SessionCloseInfo } from '@ss-helper/sdk/contracts/plugin';
import type { ServiceContract } from '@ss-helper/sdk/contracts/services';
import type { SettingsAdapter } from '@ss-helper/sdk/contracts/settings';
import type { PopupToken } from '@ss-helper/sdk/contracts/ui';
import { SSHelperError } from '@ss-helper/sdk/errors';

const descriptor: CoreDescriptor = {
  kind: 'ss-helper-core', id: CORE_PLUGIN_ID, coreVersion: '2.4.0', sdkPackageVersion: '1.0.0',
  apiMajor: API_MAJOR, apiMinor: 0, generation: 1, state: 'ready', capabilities: [],
  artifact: { buildId: 'fixture', contentDigest: 'abc' },
};
const plugin: PluginDescriptor<'tavern.chat.read'> = {
  id: 'example.plugin', displayName: 'Example', pluginVersion: '9.1.0', sdkPackageVersion: '1.0.0',
  apiMajor: 1, minApiMinor: 0, capabilities: ['tavern.chat.read'],
};
const axes: VersionAxes = { coreVersion: '4.0.0', sdkPackageVersion: '1.2.3', apiMajor: 1, apiMinor: 7, pluginVersion: '0.8.0' };
const settings: SettingsSchema = { id: 'example', title: 'Example', fields: [{ kind: 'toggle', id: 'enabled', label: 'Enabled' }] };
const popup: PopupToken<{ readonly tab: string }> = { kind: 'popup', provider: 'example.plugin', name: 'workbench', version: 1 };

declare const services: ServicePort;
declare const events: EventPort;
declare const host: HostPort<'tavern.chat.read'>;
declare const combinedHost: HostPort<
  'tavern.chat.read' | 'tavern.chat.list' | 'tavern.generation.read' | 'tavern.generation.execute'
>;
declare const binaryHost: HostPort<'tavern.plugin.binary-request.v1'>;
declare const session: PluginSession<'tavern.chat.read'>;
declare const adapter: SettingsAdapter;
const request: LlmCompletionRequest = { messages: [{ role: 'user', content: 'hello' }] };
const recall: MemoryRecallRequest = { query: 'hello', chatKey: 'chat:1' };
services.call(LLM_COMPLETION_V1, request);
services.call(LLM_STRUCTURED_TASK_V1, { task: 'extract', input: { text: 'hello' } });
services.call(LLM_EMBEDDING_V1, { input: ['hello'] });
services.call(LLM_RERANK_V1, { query: 'hello', documents: [{ id: '1', text: 'world' }] });
services.call(MEMORY_RECALL_V1, recall);
events.publish(LLM_ROUTE_CHANGED_V1, { route: 'primary', reason: 'configured' });
events.publish(MEMORY_UPDATED_V1, { chatKey: 'chat:1', operation: 'updated', recordIds: ['r1'] });
host.chat.readCurrent();
combinedHost.chat.readCurrent();
combinedHost.chat.list();
combinedHost.generation.available();
combinedHost.generation.generate({ prompt: 'hello' });
const binaryResult = await binaryHost.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'POST', responseMode: 'binary' });
const acknowledgement = await binaryHost.binaryRequest.send({
  version: 1, path: '/api/plugins/memory/backup/import', method: 'POST', responseMode: 'json',
  body: { encoding: 'base64', contentType: 'application/vnd.sqlite3', data: '', byteLength: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
});
binaryResult.data;
acknowledgement.body.data;
session.registerSettings(settings, adapter);
session.ui.openPopup(popup, { tab: 'main' });

const serviceToken: ServiceContract<'ss-helper.llm', 'completion', 1, LlmCompletionRequest, LlmCompletionResponse> = LLM_COMPLETION_V1;
const eventToken: EventContract<'ss-helper.llm', 'route-changed', 1, { readonly route: string }> = LLM_ROUTE_CHANGED_V1;
const memoryResponse: MemoryRecallResponse = { items: [] };
const closeInfo: SessionCloseInfo = { reason: 'core_replaced', generation: 1, nextGeneration: 2 };
const capability: HostCapability = 'tavern.chat.read';
const error = new SSHelperError('CORE_MISSING', 'Core missing');
const memoryMessage: ChatMessageInput = { role: 'assistant', text: 'state', variables: [{ initialized_lorebooks: { lore: [] }, stat_data: { world: { day: 5 }, inventory: ['core'] } }] };

void [descriptor, plugin, axes, popup, serviceToken, eventToken, memoryResponse, closeInfo, capability, error, memoryMessage, CORE_DISCOVERY_SYMBOL, CORE_EXTENSION_DIRECTORY];
