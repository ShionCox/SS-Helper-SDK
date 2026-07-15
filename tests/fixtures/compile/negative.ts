import {
  LLM_COMPLETION_V1,
  LLM_EMBEDDING_V1,
  LLM_ROUTE_CHANGED_V1,
  MEMORY_RECALL_V1,
  type CoreDescriptor,
  type EventPort,
  type HostPort,
  type ChatMessageInput,
  type PluginDescriptor,
  type ServicePort,
  type SettingsSchema,
  type VersionAxes,
} from '@ss-helper/sdk';

declare const services: ServicePort;
declare const events: EventPort;
declare const chatOnlyHost: HostPort<'tavern.chat.read'>;
declare const binaryHost: HostPort<'tavern.plugin.binary-request.v1'>;

// @ts-expect-error private source deep imports are blocked by package exports
import '@ss-helper/sdk/src/contracts/core.js';
// @ts-expect-error undeclared package subpaths are private
import '@ss-helper/sdk/testing';

// @ts-expect-error plugin IDs require a namespace separator
const badPlugin: PluginDescriptor = { id: 'invalid', displayName: 'Bad', pluginVersion: '1', sdkPackageVersion: '1', apiMajor: 1, minApiMinor: 0, capabilities: [] };
// @ts-expect-error arbitrary settings field kinds/HTML are not public schema
const badSettings: SettingsSchema = { id: 'bad', title: 'Bad', fields: [{ kind: 'html', id: 'x', label: 'X', html: '<b>x</b>' }] };

// @ts-expect-error coreVersion is an independent, required version axis
const missingCoreVersion: VersionAxes = { sdkPackageVersion: '1.0.0', apiMajor: 1, apiMinor: 0, pluginVersion: '2.0.0' };
// @ts-expect-error sdkPackageVersion cannot be merged into coreVersion
const missingSdkPackageVersion: VersionAxes = { coreVersion: '4.0.0', apiMajor: 1, apiMinor: 0, pluginVersion: '2.0.0' };
// @ts-expect-error apiMajor and apiMinor are separate required axes
const missingApiMajor: VersionAxes = { coreVersion: '4.0.0', sdkPackageVersion: '1.0.0', apiMinor: 0, pluginVersion: '2.0.0' };
// @ts-expect-error apiMinor cannot be represented by apiMajor alone
const missingApiMinor: VersionAxes = { coreVersion: '4.0.0', sdkPackageVersion: '1.0.0', apiMajor: 1, pluginVersion: '2.0.0' };
// @ts-expect-error pluginVersion is an independent, required version axis
const missingPluginVersion: VersionAxes = { coreVersion: '4.0.0', sdkPackageVersion: '1.0.0', apiMajor: 1, apiMinor: 0 };
// @ts-expect-error a core descriptor cannot attribute pluginVersion as coreVersion
const coreWithPluginVersion: CoreDescriptor = { kind: 'ss-helper-core', id: 'ss-helper.core', pluginVersion: '4.0.0', sdkPackageVersion: '1.0.0', apiMajor: 1, apiMinor: 0, generation: 1, state: 'ready', capabilities: [], artifact: { buildId: 'fixture', contentDigest: 'abc' } };
// @ts-expect-error a plugin descriptor cannot attribute coreVersion as pluginVersion or apiMinor as minApiMinor
const pluginWithCoreAxes: PluginDescriptor = { id: 'example.plugin', displayName: 'Example', coreVersion: '4.0.0', sdkPackageVersion: '1.0.0', apiMajor: 1, apiMinor: 0, capabilities: [] };

// @ts-expect-error public service API requires a typed structural token
services.call('ss-helper.llm:completion', { messages: [] });
// @ts-expect-error wrong request DTO
services.call(LLM_COMPLETION_V1, { prompt: 'not messages' });
// @ts-expect-error embedding input must be text or a non-empty text array at runtime
services.call(LLM_EMBEDDING_V1, { input: 42 });
// @ts-expect-error wrong recall DTO
services.call(MEMORY_RECALL_V1, { query: 'x' });
// @ts-expect-error handler response must satisfy the contract response DTO
services.expose(LLM_COMPLETION_V1, async () => ({ content: 'wrong' }));
// @ts-expect-error public event API requires a typed structural token
events.publish('ss-helper.llm:route-changed', { route: 'x' });
// @ts-expect-error invalid event payload reason
events.publish(LLM_ROUTE_CHANGED_V1, { route: 'x', reason: 'manual' });

chatOnlyHost.chat.readCurrent();
// @ts-expect-error generation is absent without a generation capability
chatOnlyHost.generation.generate({ prompt: 'hello' });
// @ts-expect-error worldbooks are absent without a worldbook capability
chatOnlyHost.worldbooks.list();
// @ts-expect-error chat.list is absent without tavern.chat.list
chatOnlyHost.chat.list();

// @ts-expect-error a strict response mode is required
binaryHost.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'POST' });
// @ts-expect-error arbitrary headers and secrets are not public request DTO fields
binaryHost.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'POST', responseMode: 'binary', headers: { authorization: 'secret' } });
const jsonAcknowledgement = await binaryHost.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/import', method: 'POST', responseMode: 'json' });
// @ts-expect-error JSON acknowledgement responses never expose binary bytes
jsonAcknowledgement.data;
const binaryBytes = await binaryHost.binaryRequest.send({ version: 1, path: '/api/plugins/memory/backup/export', method: 'POST', responseMode: 'binary' });
// @ts-expect-error binary responses never expose a JSON acknowledgement body
binaryBytes.body;

// @ts-expect-error message variables remain plain data and never expose functions
const messageWithRawVariables: ChatMessageInput = { role: 'assistant', text: 'unsafe', variables: [{ stat_data: { read: () => 'raw' } }] };
// @ts-expect-error message variable arrays contain snapshot records, not scalar values
const messageWithScalarVariables: ChatMessageInput = { role: 'assistant', text: 'unsafe', variables: [1] };

void [badPlugin, badSettings, missingCoreVersion, missingSdkPackageVersion, missingApiMajor, missingApiMinor, missingPluginVersion, coreWithPluginVersion, pluginWithCoreAxes, messageWithRawVariables, messageWithScalarVariables];
