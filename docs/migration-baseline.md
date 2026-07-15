# 旧 SS-Helper SDK 迁移基线

> 阶段：G0 inventory only。本文不实现 Core、不建立 `@ss-helper/sdk`、不提供旧 API 兼容层。

## 1. 审计范围与证据身份

- 旧单体仓：`<legacy-monolith-root>`，本轮审计 HEAD `199b99dddc1b1da963e6046bd9918901f27fd97f`。
- 旧共享目录：`SDK/` 共 47 个文件；`_Components/` 共 27 个文件。
- 新 SDK 仓：`<repo>`，G0 只增加本文、capability ledger 和只读验证脚本。
- LLM 基线副本：`<llm-root>`。
- Memory：`<memory-root>`，继续保留 SQLite server 和版本规则。
- 决策来源：`.omx/plans/prd-ss-helper-sdk-core-20260714T031324Z.md` 与配套 test spec。

## 2. Workspace、入口、manifest 与构建

### 2.1 旧 SDK 不是 package

- `pnpm-workspace.yaml:1-4` 只包含 MemoryOS、LLMHub、RollHelper，未包含 `SDK` 或 `_Components`。
- 根 `package.json:6-22` 只提供三个插件的 Vite build/watch/clean 命令；`SDK` 没有 package identity、exports、files whitelist、pack 或独立 typecheck。
- 根依赖中的 Dexie/Zod 位于 `package.json:35-37`，旧 SDK 通过单体 workspace 隐式取得 Dexie。

### 2.2 旧插件入口

- `vite.shared.mjs:7-26` 固定三个构建目标；LLM 入口是 `LLMHub/src/index.ts`，MemoryOS 入口是 `MemoryOS/src/index.ts`，RollHelper 入口是 `RollHelper/index.ts`。
- 所有目标输出单个 `index.js`：`vite.shared.mjs:212-249`。
- manifest 在 closeBundle 时直接复制：`vite.shared.mjs:45-58`。
- Font Awesome 在每个目标构建后从根 assets 复制：`vite.shared.mjs:140-158`。
- LLM manifest 为 loading order -10：`LLMHub/manifest.json:2-8`；旧 MemoryOS 为 -9：`MemoryOS/manifest.json:2-8`。两者都没有 Core extension dependency。

### 2.3 构建越界

- 旧 SDK 的 `toolbar.ts:1-2` 直接反向引用 `../_Components/sharedButton` 与 `sharedTooltip`。
- `SDK/tailwind.ts:1` 依赖 Vite 专用 `?inline`。
- 多个 `_Components/*.ts:1` 同样依赖 CSS `?inline`，并反向依赖 `SDK/theme`，例如 `sharedTooltip.ts:1-2`、`sharedDialog.ts:1-2`、`sharedSelect.ts:1-3`。
- 因此旧目录不是可直接 `pnpm pack` 的 package boundary；G1 必须重新划分 package/Core internal，而不是复制目录后发布。

## 3. RPC、event 与 registry 基线

### 3.1 EventBus

- `SDK/bus/bus.ts:3-78` 是进程内同步 Map-based bus。
- emit 自动写死来源 `stx_memory_os@1.0.0`：`bus.ts:17-24`，已越过业务所有权。
- handler 生命周期只靠调用方保存 unsubscribe：`bus.ts:41-76`，没有 PluginSession 统一清理。

### 3.2 RPC

- request/respond/sendError 都直接读取 `window.STX.bus`：`SDK/bus/rpc.ts:49-52,145-146,206-221`。
- client 有 100 个 active pending 上限、5 秒默认 timeout、AbortSignal 清理：`rpc.ts:27-37,54-60,76-126`。
- server 有 5 秒 module-scope dedupe Set：`rpc.ts:15-24,166-169`。
- response channel 是动态裸字符串 `plugin:response:<reqId>`：`rpc.ts:59-74,178-191`。
- `SDK/bus/broadcast.ts:14-68` 同样依赖 `window.STX.bus` 与裸 topic。
- protocol 只有全局 `STX_PROTOCOL_VERSION=1`：`SDK/bus/protocol.ts:7`；不是按 service/event token 版本化。
- 静态 topic registry 位于 `SDK/bus/registry.ts:17-43`，unknown topic 默认放行：`registry.ts:48-56`。

### 3.3 迁移结论

旧 bus/RPC/registry 实现整体删除，不进入 public package。语义上保留 timeout、abort、wait-for-provider、structured error、cleanup 和 namespace 校验，但由 Core 的 typed service/event registry 与 generation-bound PluginSession 重做。

## 4. UI、theme 与 assets 基线

### 4.1 组件

- `_Components/Setting/index.ts:3-125` 提供旧设置 schema、HTML/style builder 和 hydrate。
- shared checkbox/select/button 分别在 `sharedCheckbox.ts:5-100`、`sharedSelect.ts:7-323`、`sharedButton.ts:5-131`。
- shared dialog 在 `sharedDialog.ts:10-91,396-500` 管理 host、focus、escape/backdrop、replace/destroy；但允许 `bodyHtml` 注入：`sharedDialog.ts:470`。
- tooltip 创建全局 DOM root/listener：`sharedTooltip.ts:104-139,365,443`。
- 这些是行为参考，不是 public arbitrary-HTML API。统一普通设置应成为 Core internal schema renderer；插件个性 UI 只通过注册 popup contract。

### 4.2 Toolbar

- `SDK/toolbar.ts:44-55` 定义全局 toolbar ID/style/observer map。
- 默认挂载到 `#send_form.compact`：`toolbar.ts:57-62`。
- 直接管理 DOM、MutationObserver、retry 与 click listener：`toolbar.ts:244-394`。
- public functions 位于 `toolbar.ts:401-449`，且依赖 `_Components`。首版不作为 public SDK capability；旧实现删除，未来若需要由 Core 注册式 UI contribution 重新设计。

### 4.3 Theme

- `SDK/theme/kernel.ts:17-98` 在 `globalThis.__ssThemeKernelV2` 创建另一份全局 kernel。
- `SDK/theme/storage.ts:7,18-33` 用 localStorage 键 `stx_sdk_theme_global_v2` 持久化。
- token/preset/CSS 生成属于可保留的纯视觉逻辑：`theme/tokens.ts:8-44`、`theme/presets.ts:139`、`theme/css.ts:61`。
- 全局 theme kernel/storage 不保留为 public runtime；Core 只拥有自身 UI state，插件业务设置仍归插件 adapter。

### 4.4 Assets

- `SDK/runtime-styles.ts:1-9` 只转调 Font Awesome runtime loader。
- `SDK/fontawesome.ts:3-5,29-39,59-92` 通过相对 URL 建立 CSS link。
- 旧 build 将 `assets/fontawesome` 和 webfonts 复制到每个插件：`vite.shared.mjs:140-158`。
- Core artifact 必须自带所需 CSS/font/icon，不允许外部 CDN、旧根 assets 或未处理 `?inline`；装饰缺失不得阻止 Core ready。

## 5. Settings 与 storage 基线

### 5.1 旧通用 settings store

- storage prefix 是 `stx.sdk.settings.v1`：`SDK/settings.ts:45`。
- 它直接读取 SillyTavern accountStorage：`settings.ts:53-68`，并以 localStorage fallback：`82-115`。
- 通过 timestamp/shape 对 account/local 两份 bucket 选择与修复：`249-291`。
- 监听 browser storage event：`310-328`。
- public read/write/subscribe/ui-state/store factory 位于 `434-536`。

该实现不迁入 Core business store。Core settings host 只渲染插件 schema，并调用插件提供的 load/save/reset adapter；业务值仍由 LLM/Memory 自己持久化。Core 只可保存 Core 自身 UI state。

### 5.2 Mixed IndexedDB

- `SDK/db/database.ts:283-387` 定义 Dexie `SSHelperDatabase`，当前 schema version 4。
- DB 同时包含通用 chat/plugin records、旧 MemoryOS 表与 LLM credentials/request logs，违反新所有权。
- `SDK/db/chat-data.ts:62-580` 公开 shared chat/plugin-state/record cache 与 CRUD。
- `SDK/db/access-control.ts:18-57` 只做 caller/target 字符串级访问检查。
- `SDK/db/llm-request-logs.ts:67-180` 直接操作 mixed DB 的 LLM 日志。
- `rebuildSSHelperDatabase` 会删除整个旧库：`database.ts:389-396`；迁移和 rollback 都绝对禁止调用。

完整 v1-v4 schema、所有权和 cutover 不变量冻结在 `docs/old-sdk-capability-ledger.md`。

## 6. Tavern host wrappers

### 6.1 直接宿主访问

- context 从 `globalThis.SillyTavern.getContext()` 取得：`SDK/tavern/context.ts:21-35`。
- runtime wrapper 暴露 chat metadata、extension settings、raw event source/types、slash command runtime、macro registration、system message 和 save：`tavern/runtime.ts:12-124`。
- characters/groups/user snapshots 分别位于 `characters.ts:79-176`、`groups.ts:51-83`、`user.ts:33-88`。
- chats/list/scope directory 位于 `chats.ts:322-390`。
- worldbook list/load/save/delete/binding/capability 位于 `worldbooks.ts:229-440`。
- Tavern LLM availability/model/quiet/raw/test 位于 `llm.ts:1423-1576`。
- macro substitution 位于 `macros.ts:46-128`。
- prompt parsing/mutation/insertion 位于 `prompt.ts:160-730`。
- artifact stripping位于 `artifacts.ts:59-138`。
- chat key normalization/build/parse 位于 `normalize.ts:13-230` 与 `chatkey.ts:10-23`。

### 6.2 Target boundary

- raw context、eventSource、manager、slash command runtime 不进入 public package。
- 需要宿主状态/副作用的能力经 capability-gated `PluginSession.host` facade：identity/context snapshots、chat、Tavern events、worldbooks、generation、metadata/settings save、macro/system-message。
- normalize、prompt parsing、artifact stripping等无状态纯函数可以成为 SDK helper。
- HostPort listener/timer 与 session 同生命周期；Core reload 后旧 port 必须拒绝调用。

## 7. Consumer 越界引用

### 7.1 LLM

- 旧/new copy 仍从 `../../SDK` 或 `../../../SDK` 导入 bus、logger、toast、db、tavern、theme：`<llm-root>\src/index.ts:113-135`、`runtime-entry.ts:1`、`log/requestLogService.ts:1-6`、`vault/vault-manager.ts:9`。
- 它转出旧 bus：`src/index.ts:164-165`。
- 它把 SDK 挂到旧全局并连接 registry/bus：`src/index.ts:1061-1067`。
- 它直接挂载 `#extensions_settings` 并创建 `ss-helper-plugins-container`：`src/ui/index.ts:891,908-912`。
- UI 直接引用 `_Components` 和 SDK theme/tavern：`src/ui/index.ts:12-27`、`settingsCardHtmlTemplate.ts:1-5`、`settingsCardStylesTemplate.ts:1-5`。

### 7.2 Memory

- 外部 SDK imports 位于 `src/application/memory-application.ts:1`、`src/host/memory-runtime.ts:1-8`、`prompt-injection.ts:1-5`、`source-adapter.ts:1-7`、`runtime-feedback.ts:1-2`、`memory-sqlite-client.ts:1`。
- CSS 越界位于 `src/ui/memory.css:1`。
- 直接挂载 `window.STX.memory`：`src/host/memory-runtime.ts:31-54`。
- 直接读取 `window.STX.llm`：`src/application/ingest/llm-extractor.ts:206-210`。
- 普通设置直接挂载 `#extensions_settings`：`src/ui/memory-ui.ts:644-654`。
- workbench 已是 dialog popup：`memory-ui.ts:481-491,639`，应保留在 Memory。

## 8. G0 冻结结论

1. 旧目录不能原样成为 package；必须以 capability ledger 重建边界。
2. Core 是唯一 runtime/settings/service owner；public SDK 无状态，不创建 bus、registry、theme kernel 或 DB。
3. LLM 与 Memory 的业务、存储、恢复、版本继续归各自插件。
4. 旧 `window.STX`、裸 topic RPC、generic shared DB、direct settings mount 与 sibling imports 最终全部删除，不做兼容。
5. 在 G4 fresh tarball/Core artifact 双门禁通过前，consumer 只能保留本轮 baseline/test/docs，不得接入 `@ss-helper/sdk`。
