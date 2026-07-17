# SS-Helper 当前项目状态与续作交接

> 日期：2026-07-15
>
> 状态：G007 为历史联合验收快照；G008（`in_progress`）最终清理、文档与新鲜质量复跑正在执行。该历史证据快照当时，最终独立 `code-reviewer` 审批与 `architect` clearance 均尚未完成；本文件不声称它们随后已完成。
>
> 权威来源：[实施 brief](../.omx/ultragoal/brief.md)、[goals.json](../.omx/ultragoal/goals.json)、[ledger.jsonl](../.omx/ultragoal/ledger.jsonl)。`artifacts/g009-release-evidence.json` 仅是历史 G009 artifact/runtime 证据，不能作为最终 G008 的新鲜复跑证据。

## 1. 项目目标与架构

项目目标是在独立 pnpm workspace 中交付两个协同但边界清晰的产品：

- **SS-Helper Core Extension**：SillyTavern 中唯一、必装、先加载的运行时所有者，负责 discovery、插件注册、服务/事件总线、HostPort、统一设置宿主、popup 与诊断。
- **`@ss-helper/sdk`**：无状态、ESM-only 的开发者包，只公开连接器、类型契约、DTO、contract token 与窄 HostPort facade，不创建第二个 runtime，也不暴露 Core 内部 manager 或原始 Tavern 全局对象。
- **LLM 与 Memory consumer**：通过同一 SDK artifact 接入 Core。LLM 继续拥有 provider、路由、凭据与请求日志；Memory 继续拥有 SQLite/server、capture、recall、write、备份与恢复语义。

核心架构不变量是“**唯一运行时所有者 + 显式公共契约 + 业务所有权不迁移**”：Core 管平台机制，LLM/Memory 管各自业务和数据；插件间只通过版本化、命名空间化的 typed service/event 交互。现有契约说明见 [public-contracts.md](public-contracts.md)，迁移基线见 [migration-baseline.md](migration-baseline.md)，产物门禁见 [artifact-gate.md](artifact-gate.md)。

## 2. 当前执行状态

- 项目 aggregate **尚未完成**。G001–G007 主交付链与后续替代故事为已记录快照；G008 最终清理、文档与质量门正在执行。任何最终完成结论均须等待完整复跑证据以及独立 `code-reviewer` APPROVE 和 `architect` CLEAR。
- 本文保留 G007 快照作为历史验证证据；它不替代 G008 的新鲜检查，也不授权写入 Ultragoal checkpoint。
- `goals.json` 中 G006、G010 的原始 `status` 仍显示 `in_progress`，但二者均已被 steering 标记为 **superseded historical story**；其替代故事已完成，不能把它们重新列为剩余工作。

## 3. 仓库快照

`63ec9ab`、`d00272d`、`c16d528` 是 **G007 历史快照**，不是当前版本声明。当前 SDK/Core 一律以**本文件所在提交**为准；LLM 当前基线为 `c11731b`，Memory 当前基线为转码后的 `ab55ec7`。`b84d8a1` 仅是转码前的历史证据节点，不能作为当前或最终 Memory 证据。恢复或验收时必须重新核对各仓 HEAD 与工作树，不能把下表的历史值当作当前证据。

| 仓库 | 路径 | 当前基线/解释 |
|---|---|---|
| SDK/Core | `I:\VUE\SS-Helper-SDK` | 本文件所在提交（运行时重新核对 HEAD） |
| LLM | `I:\VUE\SS-Helper-LLM` | `c11731b` |
| Memory | `I:\VUE\SS-Helper-Memory` | 转码后的当前 HEAD `ab55ec7`；`b84d8a1` 仅为转码前历史节点 |
| 原始 monorepo | `I:\VUE\SillyTavern-SS-Helper` | 不可变边界；恢复时重新核对 |

本交接不声称任何仓库已发布、已推送或已进入外部 registry。

## 4. 最终产物身份

| 产物/身份 | SHA-256 / digest |
|---|---|
| SDK tgz：`artifacts/ss-helper-sdk-1.0.0.tgz` | `425e5509fdff5c73cdc7cf1200f969359caa76de9645199dd00fdda0fd9524ad` |
| Core zip：`artifacts/ss-helper-core-1.0.0.zip` | `73f35d03156f49460592fba71625feca4f8ca7a108a3f5353afc9281d20da125` |
| Core canonical `contentDigest` | `baaa73720a8eb0a334a322a00e26c6e0da2d8a44fc18ff50b009eb5cd8b5c514` |

`archiveSha256` 与 `contentDigest` 是不同身份：前者校验归档字节，后者校验规范化文件清单及内容。该身份与详细 inventory、工具链及官方浏览器 smoke 可在 [历史 G009 release evidence](../artifacts/g009-release-evidence.json) 查阅；它不是最终 G008 的新鲜复跑证据。

## 5. Goal 状态总表

| Goal | 标题 | 原始状态 | 交接判定 |
|---|---|---|---|
| G001 | G0 基线冻结与安全复制 | `complete` | 已完成 |
| G002 | G1 Workspace 与公共契约 | `complete` | 已完成 |
| G003 | G2 Core 生命周期与通信内核 | `complete` | 已完成 |
| G004 | G3 HostPort 与统一设置宿主 | `complete` | 已完成 |
| G005 | G4 SDK tarball 与 Core artifact 双门禁 | `complete` | 已完成 |
| G006 | G5 LLM 与 Memory 并行迁移 | `in_progress` | **历史故事，已被 G009/G010 supersede；不是剩余工作** |
| G009 | G5A 上游 Host 与 LLM 合同补齐及 artifact 重签发 | `complete` | 已完成 |
| G010 | G5B LLM 与 Memory 使用重签 artifact 完成迁移 | `in_progress` | **历史故事，已被 G011/G012 supersede；不是剩余工作** |
| G011 | G5C 窄化二进制 Host 请求合同与 artifact 重签发 | `complete` | 已完成 |
| G012 | G5D Memory 二进制备份迁移与双 consumer 终审 | `complete` | 已完成 |
| G007 | G6 SillyTavern 1.16.0 跨仓联合验收 | `complete` | 已完成 |
| G008 | G7 清理文档与最终质量门 | `in_progress` | **当前执行中；仍需新鲜复跑证据** |

## 6. 已完成能力

- **Core/discovery/runtime**：唯一 bridge、冻结 descriptor、generation 与 reload/dispose 状态机、session 生命周期清理、结构化失败、typed service/event、诊断脱敏。
- **窄 HostPort**：按 capability 授权 Tavern context/chat/worldbook/generation 等能力；包含经过验证、限制大小并由 Core 私下补齐认证信息的 binary request，不向 consumer 暴露任意 headers、CSRF 或 secret。
- **统一 UI**：唯一 settings root、schema renderer、插件列表、隔离存储、popup/dialog、reload/late-registration 与可访问性/焦点行为。
- **typed consumer contracts**：SDK 公开版本化 DTO、service/event token、LLM completion/structured-task/embedding/rerank/route diagnostics 与 Memory recall/update 边界。
- **LLM 非破坏迁移**：保留旧 Dexie v4 中非 LLM rows；LLM stores 迁入新库后校验 parity，失败回滚且不提前写 marker；真实 Chrome cutover/rollback 已验证。
- **Memory 数据与协议保留**：SQLite server、schema、`V0.0.3` 插件版本、server `0.0.1`、authenticated raw SQLite backup/import content type 与响应元数据未被改写。
- **官方联合矩阵**：SillyTavern 1.16.0 + Chrome 150 下完成 Core、LLM、Memory、双 fixture consumer 的注册、加载顺序、reload、清理、设置、popup、typed services、二进制传输、ownership 与诊断脱敏验证。

## 7. 最新验证证据

| 检查 | 最新结果 |
|---|---|
| SDK/Core suite | **57/57 PASS** |
| G0 baseline / ownership | **24/24 PASS** |
| LLM suite | **21/21 PASS**，另含真实 Chrome Dexie v4→v1 cutover/rollback |
| Memory suite | **136 PASS**，另有 **1 个已知 environment-gated skip** |
| 官方运行时 | SillyTavern 1.16.0 + Chrome 150 joint gate **PASS** |
| 路径泄漏扫描 | fresh/tracked path scan **0 命中** |
| 仓库卫生 | SDK/Core、LLM、Memory、原始 monorepo 均 clean |

这些数字及 artifact identity 来自历史 G007/G009 记录，不能证明最终 G008 已完成；最终 G008 仍需新鲜复跑证据。逐项映射见 [acceptance-matrix.md](acceptance-matrix.md)，命令、原始证据位置与剩余门禁见 [artifact-gate.md](artifact-gate.md#historical-artifactruntime-evidence--g008-fresh-rerun-required)。它们不替代独立 `code-reviewer` APPROVE 和 `architect` CLEAR。

## 8. 已发现并解决的重要阻塞

1. **Host/LLM 公共合同缺失**：以 G009 补齐 retained Host 事件、worldbook、LLM typed contracts 与真实 provider 路径，并重签 artifact。
2. **二进制传输缺口**：原 PlainData request 无法保留 Memory SQLite backup wire protocol；G011 增加窄化、capability-gated 的 binary request，由 Core 私下处理认证、bytes/base64、content type、大小限制与脱敏。
3. **JSON import acknowledgement 不匹配**：官方环境中的 import 返回 JSON acknowledgement，相关适配与真实浏览器回归已修复。
4. **settings schema identity / release path / browser bundle 问题**：已统一 token/schema 身份、artifact 消费路径与浏览器可运行 bundle，并纳入门禁。
5. **绝对 sibling-root 证据泄漏**：G007 已修复 evidence 中的绝对 sibling root，并用 fresh/tracked path scan 证明 0 命中。

这些问题均已由替代故事和 G007 联合验收关闭，不应作为重开 G006/G010 的理由。

## 9. 唯一剩余工作：G008 完整清单

G008 必须按以下顺序完整执行，不能只补文档后提前完成 aggregate goal：

1. 在所有既有回归仍通过后，删除目标仓中已确认无引用的 dead paths。
2. 对 SDK/Core、LLM、Memory 执行完整 legacy scan，证明旧相对 SDK import、`window.STX`、旧 settings root、MemoryOS/兼容残留与越界路径已清除。
3. 完成并校验 plugin authoring、public API、settings schema、compatibility、本地 tgz 使用、migration 文档。
4. 固化最终 artifact evidence：tarball/Core inventory、`archiveSha256`、`contentDigest`、构建/测试及官方 ST/Chrome smoke。
5. 对 G008 changed files 运行 `ai-slop-cleaner`，只做行为保持的清理，不扩展范围。
6. cleaner 后重新执行 SDK/Core、LLM、Memory、package/artifact、legacy scan 与官方 ST 1.16.0 + Chrome 全部门禁。
7. 对 [PRD 的 30 条可测试验收标准](../.omx/ultragoal/brief.md)逐条给出可复现证据，不以汇总叙述代替单项证明。
8. 完成 architecture invariant audit，至少核对唯一 runtime、无 raw globals/secrets、无业务所有权迁移、artifact identity 与生命周期清理。
9. 取得独立 `code-reviewer` **APPROVE** 与 `architect` **CLEAR**；任何未关闭 finding 都阻止完成。
10. 只有上述证据齐全后，才把项目 aggregate Codex goal 更新为 `complete`，并写入最终 Ultragoal checkpoint。

## 10. 明确排除项与不变量

- 不发布 npm/其他 registry，不请求或使用发布凭证。
- 不删除、不覆盖、不回写原始 `SillyTavern-SS-Helper/LLMHub`；原始 monorepo 必须保持未修改。
- 不改变 Memory schema、SQLite/server 架构、wire protocol、数据职责或版本元数据规则。
- 不迁移 LLM、Memory 之外的其他插件，不扩大到无授权仓库。
- consumer 不得读取 raw Tavern globals，不得取得任意 headers、CSRF、API key 或其他 secrets。
- 保持最终 SDK tgz/Core zip 的精确身份和跨仓 vendored artifact 一致性。
- 保持所有权边界：Core 只管机制；LLM/Memory 继续拥有各自业务、存储、迁移与恢复策略。

## 11. 精确恢复流程

仅在用户明确要求继续后执行：

1. 先重新读取 [goals.json](../.omx/ultragoal/goals.json)、[ledger.jsonl](../.omx/ultragoal/ledger.jsonl) 与最新四仓 git 状态，确认没有新的漂移。
2. 重新激活 Ultragoal runtime；把 aggregate `get_goal` 的 `blocked` 状态按“用户停止后的恢复”语义进行 reconcile，而不是当作技术失败重置历史。
3. 从 **G008** 开始；不得 replay G006 或 G010，也不得改写它们的历史 superseded 关系。
4. 执行第 9 节全部清理、文档、复测、30 项验收、架构审计和独立 reviewer/architect 门禁。
5. 在所有最终门禁通过前，不得把 aggregate goal 标为完成；完成时再写最终 Ultragoal checkpoint 与可追溯 evidence。

## 12. 风险与备注

- evidence JSON 含时间戳；重新生成 evidence 会改变 **evidence 文件自身** 的哈希，即使 SDK/Core 产物字节未变。验收时必须区分 artifact hash、`contentDigest` 与 evidence-file hash。
- Memory 当前有 1 个依赖外部 fixture 的已知条件 skip；G008 必须继续明确记录，不能把 skip 写成 pass，也不能把它误判为产品回归。
- 原始 monorepo 是不可变边界；任何 dirty 状态都应阻断最终完成并先定位来源。
- 当前分支/HEAD 只证明本地状态；本交接不声称远端已发布或外部消费者已采用。
- 本文件记录停止时快照。恢复前必须重新核对可漂移的 HEAD、工作树、artifact 与 runtime 状态。
