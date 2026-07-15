# 旧 SDK Capability Ledger 与数据库冻结账本

> 状态：G0 frozen inventory。决策词：**retain** 保留语义；**redesign** 保留目标但重做边界；**replace** 由新契约取代；**delete** 不进入新系统。所有旧 import/global 均不承诺兼容。

## 1. Capability ledger

| 旧能力/证据 | 决策 | Target owner | 替代契约 | 必须回归 |
|---|---|---|---|---|
| `Logger` / `Toast`（`SDK/logger.ts:12-79`、`toast.ts:5-45`） | redesign | Core 平台诊断；插件业务日志归插件 | 结构化 diagnostics + capability-gated UI notification；禁止 secret/payload | level/plugin/error code；日志脱敏；一个插件失败不污染其他插件 |
| `EventBus`（`bus/bus.ts:3-78`） | delete | Core | generation-bound EventHub | subscribe/unsubscribe 幂等；session dispose/reload listener 回零 |
| 裸 RPC request/respond（`bus/rpc.ts:43-203`） | replace | Core | typed `ServiceContract`、`waitFor/call/expose` | success/unknown/version/timeout/abort/provider dispose/pending cleanup |
| broadcast/subscribe（`bus/broadcast.ts:14-68`） | replace | Core | typed `EventContract` publish/subscribe | token identity按结构；version/payload/namespace 校验；dispose 清理 |
| static topic registry（`bus/registry.ts:17-56`） | delete | Core | dynamic plugin/service registry | unknown service fail closed；不再默认放行 unknown topic |
| `STX_PROTOCOL_VERSION=1`（`bus/protocol.ts:7`） | replace | SDK contracts + Core | apiMajor/apiMinor + per-contract version/schemaId | Core/package version轴独立；major/minor/capability handshake |
| `PluginManifest/STXRegistry/STXBus`（`stx.d.ts:22-59`） | replace | public SDK contracts | `PluginDescriptor`、`PluginSession`、typed contracts | duplicate/reserved ID；transactional register rollback；Core self row 独立 |
| `window.STX` discovery | delete | Core discovery bridge | `Symbol.for('@ss-helper/core.discovery')` + lifecycle event | absent/ready/disposed/replaced；race 无丢信号；非法 bridge fail closed |
| generic SDK settings store（`settings.ts:45-536`） | replace | 插件值归插件；Core 只渲染 | `session.registerSettings(schema, adapter)` | load/save/reset；adapter error 隔离；Core 不保存业务值 |
| settings account/local dual repair | delete as Core mechanism | LLM 或具体插件决定迁移 | plugin-owned adapter/migration | 既有 LLM 设置值迁移前后等价；Core uninstall 不删业务值 |
| `_Components/Setting` 和 shared field builders | redesign | Core internal Settings Host | 受控 schema：section/toggle/text/number/range/select/action/status | 8 类字段、a11y、validation、disabled reason、late register/unregister |
| shared dialog（`_Components/sharedDialog.ts:396-500`） | redesign | Core Popup Host + plugin popup implementation | registered popup token；不接受任意 settings HTML | focus return、Escape、focus trap、unregister 后不可打开 |
| tooltip/select/button/checkbox styles | retain visual semantics, redesign packaging | Core internal | local renderer/styles bundled in artifact | 无外部资源；重复 mount 不重复 style/listener |
| floating toolbar（`SDK/toolbar.ts:401-449`） | delete first release | 未承诺；未来 Core UI contribution | 首版无 public toolbar API | legacy symbol/import 为零；如以后增加须独立 contract |
| theme tokens/presets/CSS pure functions | retain | Core UI internal | local design tokens | dark/light/host rendering；无业务 setting ownership |
| global theme kernel/localStorage（`theme/kernel.ts:17-98`、`storage.ts:7-33`） | delete | Core | Core-only UI state | SDK bundle无 runtime singleton；consumer 多 bundle不增 kernel |
| Tailwind `?inline`（`tailwind.ts:1`） | replace | Core build | compiled local CSS asset | production artifact 无 `?inline`/sibling CSS |
| Font Awesome runtime link/copy | redesign | Core artifact | artifact-local icon/font CSS | offline可用；file hash inventory；缺装饰不阻止 ready |
| raw Tavern context/event source/runtime manager | delete from public API | Core host adapter | narrowed HostPort | public exports/runtime 不返回 raw global/manager |
| identity/context/character/group/user snapshots | retain | Core HostPort | capability-gated plain DTO | 参数/结果/空态与旧 wrapper一致；DTO plain-data |
| current chat/key/list/directory | retain | Core HostPort | `host.chat.*` | stable chat key、scope、fallback、list semantics |
| Tavern event subscription | redesign | Core HostPort | typed host event token | listener随 session dispose；reload 只订阅一次 |
| worldbook list/load/save/delete/active binding | retain | Core HostPort | `host.worldbooks.*` | capability availability、macro substitution、错误结构 |
| Tavern generation availability/model/quiet/raw/test | retain | Core HostPort | `host.generation.*` | provider unavailable、request/response/error，不泄露 raw context |
| metadata/settings save、macro/system message | retain | Core HostPort | explicit methods | capability not granted；宿主异常结构化 |
| normalize/chat-key helpers | retain | public stateless SDK helper | pure functions | current prompt/chatkey fixtures |
| prompt parse/mutate/insert helpers | retain | public stateless SDK helper | pure plain-data functions | `SDK/tavern/prompt.spec.ts` 语义与 Memory prompt injection |
| artifact stripping | retain | public stateless SDK helper | pure string helpers | MVU/RollHelper/runtime placeholder fixtures |
| generic chat-data/access-control IndexedDB | delete | 无新 owner | 无；需要者在插件内建明确 storage | Core/Memory/SDK bundle不得打开旧 mixed DB |
| `llm_credentials`、`llm_request_logs` | replace storage location, retain data | LLM | `SSHelperLLMDatabase` v1 | 完整 copy/index parity/marker/idempotency/rollback |
| 旧 MemoryOS/通用 non-LLM stores | legacy-preserved only | 旧 `SSHelperDatabase`，不再由新插件写 | 无新 public contract | LLM cutover 前后 version/store/index/rows byte-level不变 |
| `rebuildSSHelperDatabase`（`database.ts:393-396`） | delete | 无 | 禁止整库 delete/rebuild | static/runtime guard证明未调用 `Dexie.delete('SSHelperDatabase')` |
| Memory SQLite | retain unchanged | Memory server | 现有 `/api/plugins/ss-helper-memory/v1` | protocol 1/schema 2/server 0.0.x/data path/117 tests |

## 2. Mixed DB identity 与类型所有权

- Database name：`SSHelperDatabase`，证据 `SDK/db/database.ts:306-308`。
- 当前最高 Dexie version：4，证据 `database.ts:308-383`。
- LLM-owned rows：
  - `llm_credentials`，类型 `DBLlmCredential`：`database.ts:249-254`。
  - `llm_request_logs`，类型 `DBLlmRequestLog`：`database.ts:256-281`。
- legacy-preserved non-LLM stores：其余全部。新 Core、SDK、Memory 不得迁移、升级、删除或写入这些 stores。
- `stx_llm_vault` 是额外 legacy credential source，证据 `<llm-root>\src/vault/vault-manager.ts:12,31-60`；cutover merge 后仍不删除。

## 3. SSHelperDatabase v1 完整 stores/index

证据：`SDK/db/database.ts:308-325`。

```text
chat_documents: '&chatKey, entityKey, updatedAt'
chat_plugin_state: '&[pluginId+chatKey], pluginId, chatKey, updatedAt'
chat_plugin_records: '++id, pluginId, chatKey, collection, recordId, ts, updatedAt, [pluginId+chatKey+collection], [pluginId+chatKey+collection+ts]'
events: '&eventId, chatKey, ts, type, [chatKey+ts], [chatKey+type+ts]'
templates: '&templateId, chatKey, [chatKey+createdAt], updatedAt'
audit: '&auditId, chatKey, ts'
meta: '&chatKey, updatedAt'
memory_mutation_history: '&historyId, chatKey, [chatKey+ts], ts'
memory_entry_audit_records: '&auditId, chatKey, entryId, summaryId, actionType, [chatKey+ts], [chatKey+entryId], ts'
memory_entries: '&entryId, chatKey, [chatKey+entryType], [chatKey+category], [chatKey+updatedAt], updatedAt'
memory_entry_types: '&typeId, chatKey, [chatKey+key], [chatKey+updatedAt]'
actor_memory_profiles: '&actorKey, chatKey, [chatKey+actorKey], [chatKey+updatedAt]'
role_entry_memory: '&roleMemoryId, chatKey, [chatKey+actorKey], [chatKey+entryId], [chatKey+actorKey+entryId], [chatKey+updatedAt]'
summary_snapshots: '&summaryId, chatKey, [chatKey+updatedAt]'
llm_credentials: '&providerId, updatedAt'
llm_request_logs: '&logId, requestId, sourcePluginId, sortTs, state, [sourcePluginId+sortTs], [state+sortTs], updatedAt'
```

v1 不包含 `world_profile_bindings` 或 `memory_relationships`。

## 4. SSHelperDatabase v2 完整 stores/index

证据：`SDK/db/database.ts:326-344`。v2 在 v1 基础上增加 `world_profile_bindings`，其余定义如下完整冻结：

```text
chat_documents: '&chatKey, entityKey, updatedAt'
chat_plugin_state: '&[pluginId+chatKey], pluginId, chatKey, updatedAt'
chat_plugin_records: '++id, pluginId, chatKey, collection, recordId, ts, updatedAt, [pluginId+chatKey+collection], [pluginId+chatKey+collection+ts]'
events: '&eventId, chatKey, ts, type, [chatKey+ts], [chatKey+type+ts]'
templates: '&templateId, chatKey, [chatKey+createdAt], updatedAt'
audit: '&auditId, chatKey, ts'
meta: '&chatKey, updatedAt'
memory_mutation_history: '&historyId, chatKey, [chatKey+ts], ts'
memory_entry_audit_records: '&auditId, chatKey, entryId, summaryId, actionType, [chatKey+ts], [chatKey+entryId], ts'
memory_entries: '&entryId, chatKey, [chatKey+entryType], [chatKey+category], [chatKey+updatedAt], updatedAt'
memory_entry_types: '&typeId, chatKey, [chatKey+key], [chatKey+updatedAt]'
actor_memory_profiles: '&actorKey, chatKey, [chatKey+actorKey], [chatKey+updatedAt]'
role_entry_memory: '&roleMemoryId, chatKey, [chatKey+actorKey], [chatKey+entryId], [chatKey+actorKey+entryId], [chatKey+updatedAt]'
summary_snapshots: '&summaryId, chatKey, [chatKey+updatedAt]'
world_profile_bindings: '&chatKey, primaryProfile, updatedAt'
llm_credentials: '&providerId, updatedAt'
llm_request_logs: '&logId, requestId, sourcePluginId, sortTs, state, [sourcePluginId+sortTs], [state+sortTs], updatedAt'
```

## 5. SSHelperDatabase v3 完整 stores/index

证据：`SDK/db/database.ts:345-363`。v3 stores/index 文本与 v2 相同；这一“无结构变化的版本”本身也必须保留在 browser-backed migration fixture 中。

```text
chat_documents: '&chatKey, entityKey, updatedAt'
chat_plugin_state: '&[pluginId+chatKey], pluginId, chatKey, updatedAt'
chat_plugin_records: '++id, pluginId, chatKey, collection, recordId, ts, updatedAt, [pluginId+chatKey+collection], [pluginId+chatKey+collection+ts]'
events: '&eventId, chatKey, ts, type, [chatKey+ts], [chatKey+type+ts]'
templates: '&templateId, chatKey, [chatKey+createdAt], updatedAt'
audit: '&auditId, chatKey, ts'
meta: '&chatKey, updatedAt'
memory_mutation_history: '&historyId, chatKey, [chatKey+ts], ts'
memory_entry_audit_records: '&auditId, chatKey, entryId, summaryId, actionType, [chatKey+ts], [chatKey+entryId], ts'
memory_entries: '&entryId, chatKey, [chatKey+entryType], [chatKey+category], [chatKey+updatedAt], updatedAt'
memory_entry_types: '&typeId, chatKey, [chatKey+key], [chatKey+updatedAt]'
actor_memory_profiles: '&actorKey, chatKey, [chatKey+actorKey], [chatKey+updatedAt]'
role_entry_memory: '&roleMemoryId, chatKey, [chatKey+actorKey], [chatKey+entryId], [chatKey+actorKey+entryId], [chatKey+updatedAt]'
summary_snapshots: '&summaryId, chatKey, [chatKey+updatedAt]'
world_profile_bindings: '&chatKey, primaryProfile, updatedAt'
llm_credentials: '&providerId, updatedAt'
llm_request_logs: '&logId, requestId, sourcePluginId, sortTs, state, [sourcePluginId+sortTs], [state+sortTs], updatedAt'
```

## 6. SSHelperDatabase v4 完整 stores/index

证据：`SDK/db/database.ts:364-383`。v4 改变 `actor_memory_profiles` primary key 并增加 `memory_relationships`。

```text
chat_documents: '&chatKey, entityKey, updatedAt'
chat_plugin_state: '&[pluginId+chatKey], pluginId, chatKey, updatedAt'
chat_plugin_records: '++id, pluginId, chatKey, collection, recordId, ts, updatedAt, [pluginId+chatKey+collection], [pluginId+chatKey+collection+ts]'
events: '&eventId, chatKey, ts, type, [chatKey+ts], [chatKey+type+ts]'
templates: '&templateId, chatKey, [chatKey+createdAt], updatedAt'
audit: '&auditId, chatKey, ts'
meta: '&chatKey, updatedAt'
memory_mutation_history: '&historyId, chatKey, [chatKey+ts], ts'
memory_entry_audit_records: '&auditId, chatKey, entryId, summaryId, actionType, [chatKey+ts], [chatKey+entryId], ts'
memory_entries: '&entryId, chatKey, [chatKey+entryType], [chatKey+category], [chatKey+updatedAt], updatedAt'
memory_entry_types: '&typeId, chatKey, [chatKey+key], [chatKey+updatedAt]'
actor_memory_profiles: '&[chatKey+actorKey], chatKey, actorKey, [chatKey+updatedAt]'
role_entry_memory: '&roleMemoryId, chatKey, [chatKey+actorKey], [chatKey+entryId], [chatKey+actorKey+entryId], [chatKey+updatedAt]'
memory_relationships: '&relationshipId, chatKey, [chatKey+sourceActorKey], [chatKey+targetActorKey], [chatKey+sourceActorKey+targetActorKey], [chatKey+updatedAt], updatedAt'
summary_snapshots: '&summaryId, chatKey, [chatKey+updatedAt]'
world_profile_bindings: '&chatKey, primaryProfile, updatedAt'
llm_credentials: '&providerId, updatedAt'
llm_request_logs: '&logId, requestId, sourcePluginId, sortTs, state, [sourcePluginId+sortTs], [state+sortTs], updatedAt'
```

## 7. LLM target DB 冻结

新 owner：LLM plugin。新 DB：`SSHelperLLMDatabase` version 1。

```text
llm_credentials: '&providerId, updatedAt'
llm_request_logs: '&logId, requestId, sourcePluginId, sortTs, state, [sourcePluginId+sortTs], [state+sortTs], updatedAt'
```

新 DB 不包含任何 chat/Memory/general SDK store。Core 与 Memory bundle不得打开 `SSHelperDatabase` 或 `SSHelperLLMDatabase`。

## 8. Cutover 不变量

1. 使用 existence probe 检查旧 DB；旧 DB 不存在时不得因为检查而创建空 `SSHelperDatabase`。
2. 旧 DB 存在时只读打开现有最高 version，禁止 `version(...).stores(...)`、upgrade、deleteDatabase。
3. 先把两个 LLM stores 完整复制/merge 到 target staging，再校验 primary key、row count、payload 与两个 compound index query 语义。
4. 只有 parity 成功后写 cutover marker；marker 至少记录 source DB/version、target DB/version、row counts、schema digest、completedAt，不记录 credential/log payload。
5. 旧 DB name/version/stores/indexes/全部 non-LLM rows 在 cutover 前后不变。
6. `stx_llm_vault` merge：较新 `updatedAt` 获胜；相同时间 mixed DB 获胜。
7. 任一 credentials copy、logs copy、parity、marker write 失败：marker 不存在，旧 DB 完全不变；partial target 可只清理 target 后重试。
8. 有效 marker 的第二次启动不得重读/覆盖旧数据；新 DB 中更新后的值保持。
9. 迁移日志只记录计数、store、phase、error code、digest；不得记录 API key 或 request payload。

## 9. Rollback 不变量

1. rollback 只允许从新 LLM DB 回写旧 DB 的 `llm_credentials` 与 `llm_request_logs`。
2. 旧 DB 必须已存在且仍是 version 4/full frozen schema；不满足则 fail closed。
3. 写前创建只包含两个 LLM stores 的可验证 backup/evidence；不得复制 non-LLM payload 到日志。
4. rollback 后旧 DB version、store names、index definitions、所有 non-LLM row counts/content 完全不变。
5. rollback 不删除新 DB，不删除旧 DB，不删除 `stx_llm_vault`；成功 marker 与 rollback evidence 分离。
6. rollback fault 时保持 marker 指向已验证的新库，不宣称成功；允许幂等重试。
7. 绝不调用 `rebuildSSHelperDatabase`、`Dexie.delete('SSHelperDatabase')` 或任何 schema upgrade。

## 10. 回归与验收映射

- DB schema：test spec L-DB-001。
- cutover：L-DB-002、L-DB-007、L-DB-008。
- fault/rollback：L-DB-003、L-DB-005。
- legacy vault merge：L-DB-004。
- ownership guard：L-DB-006。
- browser-backed IndexedDB/Dexie 是验收必需；mock/fake-indexeddb 只可作为快速 unit test。
- G4 tarball/Core artifact 未通过前，以上只能实现 fixture/ledger，不得在 consumer 接入新 SDK。
