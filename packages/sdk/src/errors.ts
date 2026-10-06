export const SS_HELPER_ERROR_CODES = [
  'CORE_UNAVAILABLE', 'STALE_SESSION', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
  'INVALID_PAYLOAD', 'TIMEOUT', 'ABORTED', 'INTERNAL',
] as const;

export type SSHelperErrorCode = (typeof SS_HELPER_ERROR_CODES)[number];

export interface SSHelperErrorDetails {
  readonly [key: string]: null | boolean | number | string | readonly string[] | undefined;
}

export interface SSHelperFailureContext extends SSHelperErrorDetails {
  readonly reasonCode: SSHelperReasonCode;
  readonly stage: string;
  readonly requestId?: string;
  readonly attemptId?: string;
  readonly batchIndex?: number;
  readonly collection?: string;
  readonly path?: string;
  readonly keyword?: string;
  readonly expected?: string;
  readonly httpStatus?: number;
  readonly providerKind?: string;
  readonly providerErrorCode?: string;
  readonly providerErrorType?: string;
  readonly providerErrorParam?: string;
  readonly resourceId?: string;
  readonly model?: string;
}

export interface SSHelperDiagnosticDefinition {
  readonly transportCode: SSHelperErrorCode;
  readonly title: string;
  readonly reason: string;
  readonly action: string;
  readonly retryable: boolean;
}

export interface SSHelperDiagnostic extends SSHelperFailureContext, SSHelperDiagnosticDefinition {}

const diagnostic = (
  transportCode: SSHelperErrorCode,
  title: string,
  reason: string,
  action: string,
  retryable: boolean,
): SSHelperDiagnosticDefinition => Object.freeze({ transportCode, title, reason, action, retryable });

/**
 * SS-Helper 唯一错误目录。
 *
 * Provider、Core、Bridge、LLM、Memory 与 UI 必须引用这里的 code 和中文说明，
 * 不得在业务模块维护第二份错误字典，也不得从 error.message 猜测 code。
 */
export const SS_HELPER_DIAGNOSTICS = Object.freeze({
  INTERNAL_ERROR: diagnostic('INTERNAL', '程序内部错误', '当前步骤发生了无法进一步分类的内部异常。', '保留请求 ID 和步骤信息后重试；持续出现时检查服务日志。', false),
  SETTINGS_READ_FAILED: diagnostic('INTERNAL', '设置读取失败', '设置适配器暂时无法提供有效设置或状态。', '检查插件与存储状态后点击重新读取；持续失败时保留诊断信息。', true),
  SETTINGS_SAVE_FAILED: diagnostic('INTERNAL', '设置保存失败', '设置适配器未能提交本次修改，界面已回滚。', '检查插件与存储状态后重新保存。', true),
  LLM_TASK_REQUIREMENT_UNSUPPORTED: diagnostic('INVALID_PAYLOAD', '任务能力要求无法满足', '当前资源或执行方式不支持任务声明的必需能力。', '选择支持该能力的资源并完成验证，或修正任务能力声明。', false),
  CLIPBOARD_WRITE_FAILED: diagnostic('INTERNAL', '复制失败', '浏览器未允许当前页面写入剪贴板。', '检查浏览器剪贴板权限后重新点击复制。', true),
  CANCELLED: diagnostic('ABORTED', '操作已取消', '用户在操作完成前主动取消了请求。', '如仍需执行，请重新发起操作。', false),
  REQUEST_ABORTED: diagnostic('ABORTED', '请求已中止', '请求关联的中止信号在完成前触发。', '确认当前会话仍有效后重新操作。', false),
  CORE_BRIDGE_UNAVAILABLE: diagnostic('CORE_UNAVAILABLE', 'SDK 服务端桥接不可用', '浏览器 Core 无法连接 SillyTavern 服务端插件。', '确认服务端插件已启用并重启 SillyTavern。', true),
  BRIDGE_STARTUP_TIMEOUT: diagnostic('CORE_UNAVAILABLE', 'SDK 服务端桥接启动超时', '服务端桥接未在启动期限内完成注册。', '检查服务端插件日志并重启 SillyTavern。', true),
  BRIDGE_ENVELOPE_INVALID: diagnostic('INVALID_PAYLOAD', 'Bridge 请求结构无效', '服务端收到的 Bridge 信封不符合 v0 契约。', '重新部署同一次构建生成的 SDK、LLM 与 Memory。', false),
  BRIDGE_OPERATION_DENIED: diagnostic('FORBIDDEN', 'Bridge 操作不允许', '请求的 Bridge 操作没有公开或不属于当前能力范围。', '检查插件调用的公共 SDK 接口。', false),
  SERVER_CAPABILITY_DENIED: diagnostic('FORBIDDEN', '服务端能力未授权', '当前插件没有执行该服务端操作的能力。', '检查 SDK 能力策略与插件标识。', false),
  SERVER_SESSION_CLOSED: diagnostic('STALE_SESSION', '服务端会话已关闭', '操作使用的服务端插件会话已经失效。', '刷新页面或重启插件后重试。', true),
  BUS_HANDLER_INVALID: diagnostic('INVALID_PAYLOAD', '服务处理器无效', '注册的 Bus 处理器不是可调用函数。', '修正插件的服务注册实现。', false),
  BUS_NAMESPACE_FORBIDDEN: diagnostic('FORBIDDEN', '服务命名空间不属于当前插件', '插件尝试注册或发布其他插件命名空间的契约。', '使用当前插件自己的契约标识。', false),
  BUS_HANDLER_CONFLICT: diagnostic('CONFLICT', '服务处理器重复注册', '同一个 Bus 契约已经存在活动处理器。', '清理旧会话或重复注册逻辑。', false),
  BUS_PROVIDER_CLOSED: diagnostic('STALE_SESSION', '服务提供方会话已关闭', '请求执行期间服务提供方被卸载或重连。', '等待插件重新连接后重试。', true),
  BUS_CONTRACT_VERSION_NOT_FOUND: diagnostic('NOT_FOUND', '服务契约版本不可用', '已有同名服务，但没有请求所需的契约版本。', '部署来自同一次构建的插件产物。', false),
  BUS_HANDLER_NOT_FOUND: diagnostic('NOT_FOUND', '请求的服务不可用', '当前 Core 中没有该契约的处理器。', '确认提供该服务的插件已经连接。', true),
  BUS_CALLER_ABORTED: diagnostic('ABORTED', '调用方已中止请求', '调用方在服务完成前取消了请求。', '需要时重新发起请求。', false),
  BUS_CALLER_CLOSED: diagnostic('STALE_SESSION', '调用方会话已关闭', '请求执行期间调用插件会话已经失效。', '刷新页面后重试。', true),
  BUS_REQUEST_TIMEOUT: diagnostic('TIMEOUT', '插件服务请求超时', 'Bus 请求没有在限定时间内完成。', '检查服务状态或适当增加超时时间。', true),
  BUS_HANDLER_FAILED: diagnostic('INTERNAL', '插件服务处理失败', '服务处理器抛出了未结构化的内部异常。', '保留请求 ID 并检查提供方日志。', false),
  BUS_LISTENER_INVALID: diagnostic('INVALID_PAYLOAD', '事件监听器无效', '注册的事件监听器不是可调用函数。', '修正插件的事件订阅实现。', false),
  BUS_CORE_DISPOSED: diagnostic('CORE_UNAVAILABLE', 'SDK Core 已关闭', 'Core 在请求完成前被释放。', '刷新页面并等待 Core 重新启动。', true),
  BUS_CONTRACT_INVALID: diagnostic('INVALID_PAYLOAD', '服务契约无效', '契约标识、类型或版本不符合公共规则。', '修正契约声明并重新构建。', false),
  PUBLIC_DATA_CONTRACT_INVALID: diagnostic('INVALID_PAYLOAD', '插件通信数据不符合契约', '请求或响应没有通过契约校验。', '部署来自同一次构建的 SDK、LLM 与 Memory。', false),
  PUBLIC_DATA_NOT_PLAIN: diagnostic('INVALID_PAYLOAD', '插件通信数据不是普通 JSON 数据', '数据包含循环、函数、访问器或自定义实例。', '只传递可序列化的普通 JSON 数据。', false),
  INVALID_PAYLOAD: diagnostic('INVALID_PAYLOAD', '请求参数无效', '请求缺少必需字段或字段值不符合约束。', '检查输入后重新提交。', false),
  WORKSPACE_ACCESS_DENIED: diagnostic('FORBIDDEN', '工作区访问被拒绝', '当前插件不是该工作区的所有者。', '检查插件身份和工作区绑定。', false),
  WORKSPACE_NOT_FOUND: diagnostic('NOT_FOUND', '工作区数据不存在', '请求的工作区、集合或记录尚未创建。', '先初始化对应工作区后重试。', true),
  WORKSPACE_CONFLICT: diagnostic('CONFLICT', '工作区数据发生并发冲突', '写入所依据的 revision 已被其他操作更新。', '重新读取最新数据后重试。', true),
  WORKSPACE_RECORD_TOO_LARGE: diagnostic('INVALID_PAYLOAD', '工作区记录超过大小限制', '单条记录的序列化内容超过工作区允许的上限。', '缩小记录或将审计快照分块后重新提交；无需重新调用模型。', false),
  WORKSPACE_INDEX_REQUIRED: diagnostic('INVALID_PAYLOAD', '工作区索引未声明', '查询字段没有在 Workspace Schema 中声明索引。', '更新集合 Schema 后重新打开工作区。', false),
  WORKSPACE_UNAVAILABLE: diagnostic('CORE_UNAVAILABLE', '工作区服务不可用', 'SDK 工作区服务当前无法完成请求。', '检查服务端插件和数据目录权限。', true),
  WORKSPACE_DATABASE_UNAVAILABLE: diagnostic('CORE_UNAVAILABLE', 'SQLite 数据库不可用', '工作区数据库无法打开或初始化。', '检查数据目录权限与服务端日志。', true),
  WORKSPACE_SECRET_UNAVAILABLE: diagnostic('CORE_UNAVAILABLE', '工作区密钥不可用', '服务端无法读取或创建加密密钥。', '检查数据目录权限后重启服务。', false),
  WORKSPACE_RECOVERY_DENIED: diagnostic('FORBIDDEN', '工作区恢复未授权', '当前插件没有执行恢复操作的权限。', '从 SDK 管理界面执行恢复。', false),
  WORKSPACE_RECOVERY_CONFIRMATION_REQUIRED: diagnostic('INVALID_PAYLOAD', '工作区恢复需要确认', '恢复操作缺少明确的用户确认。', '确认备份状态后重新执行。', false),
  WORKSPACE_RECOVERY_NOT_REQUIRED: diagnostic('CONFLICT', '当前无需恢复工作区', '工作区健康状态不满足恢复条件。', '返回工作区状态页重新检查。', false),
  WORKSPACE_RECOVERY_IN_PROGRESS: diagnostic('CONFLICT', '工作区正在恢复', '已有恢复任务正在执行。', '等待当前恢复完成。', true),
  WORKSPACE_RECOVERY_BACKUP_FAILED: diagnostic('INTERNAL', '工作区恢复备份失败', '恢复前的安全备份未能创建或验证。', '检查备份目录权限和磁盘空间。', false),
  WORKSPACE_RECOVERY_REBUILD_FAILED: diagnostic('INTERNAL', '工作区重建失败', '恢复过程未能创建可用的新工作区。', '保留备份并检查服务端日志。', false),
  BACKUP_INTEGRITY_INVALID: diagnostic('INVALID_PAYLOAD', '备份完整性校验失败', '备份内容与其完整性摘要不一致。', '不要导入该备份，重新生成可信备份。', false),
  BACKUP_TOO_LARGE: diagnostic('INVALID_PAYLOAD', '备份超过大小限制', '备份内容超过 SDK 允许的安全上限。', '减少数据范围后重新生成备份。', false),
  BACKUP_FORMAT_INVALID: diagnostic('INVALID_PAYLOAD', '备份格式无效', '备份不符合当前 v0 Workspace 格式。', '使用当前版本重新生成备份。', false),
  HTTP_URL_INVALID: diagnostic('INVALID_PAYLOAD', '服务地址无效', 'Base URL 不是允许的 HTTP 或 HTTPS 地址。', '修正资源的 Base URL。', false),
  HTTP_ADDRESS_FORBIDDEN: diagnostic('FORBIDDEN', '服务地址不允许访问', '目标地址解析到受保护的本机或私有网络范围。', '使用允许访问的公网服务地址。', false),
  HTTP_METHOD_INVALID: diagnostic('INVALID_PAYLOAD', 'HTTP 方法不受支持', 'Bridge 只允许声明的 HTTP 方法。', '修正 Provider 请求实现。', false),
  HTTP_HEADERS_INVALID: diagnostic('INVALID_PAYLOAD', 'HTTP 请求头无效', '请求包含未授权、非法或过大的 Header。', '只发送 Provider 必需的白名单 Header。', false),
  HTTP_BODY_INVALID: diagnostic('INVALID_PAYLOAD', 'HTTP 请求正文无效', '请求正文不是字符串或超过安全上限。', '缩小请求并重新发送。', false),
  HTTP_DNS_FAILED: diagnostic('INTERNAL', '无法解析服务地址', 'DNS 没有返回可用的目标地址。', '检查域名、DNS 和网络连接。', true),
  HTTP_CONNECT_FAILED: diagnostic('INTERNAL', '无法连接模型服务', '到目标主机的 TCP 连接失败或被重置。', '检查地址、端口及服务状态。', true),
  HTTP_TLS_FAILED: diagnostic('INTERNAL', '模型服务安全连接失败', 'TLS 证书或握手未能通过验证。', '检查 HTTPS 证书和代理配置。', false),
  HTTP_REQUEST_TIMEOUT: diagnostic('TIMEOUT', '模型请求超时', '请求没有在限定时间内完成。', '检查网络后重试，或适当增加超时时间。', true),
  HTTP_REQUEST_ABORTED: diagnostic('ABORTED', 'HTTP 请求已中止', '请求在响应完成前被取消。', '需要时重新发起请求。', false),
  HTTP_TRANSPORT_ERROR: diagnostic('INTERNAL', 'HTTP 传输失败', '底层传输返回了无法进一步分类的结构化异常。', '保留请求 ID 并检查服务端日志。', true),
  HTTP_REDIRECT_REJECTED: diagnostic('FORBIDDEN', '模型服务返回了不允许的重定向', 'Bridge 为防止请求越界拒绝了重定向响应。', '将 Base URL 改为最终服务地址。', false),
  HTTP_RESPONSE_TOO_LARGE: diagnostic('INVALID_PAYLOAD', '模型响应超过安全上限', '响应正文大小超过 Bridge 限制。', '减小模型输出或请求范围。', false),
  HTTP_RESPONSE_PROTOCOL_INVALID: diagnostic('INTERNAL', '模型响应格式无法识别', '响应正文或 Content-Type 不符合 Provider 协议。', '检查兼容接口实现。', false),
  PROVIDER_HTTP_ERROR: diagnostic('INTERNAL', '模型服务返回 HTTP 错误', '服务返回了未能进一步分类的非成功状态。', '根据状态码检查资源配置或服务状态。', false),
  PROVIDER_SERVICE_UNAVAILABLE: diagnostic('CORE_UNAVAILABLE', '模型服务暂时不可用', 'Provider 返回 5xx，当前无法完成请求。', '稍后重试；持续失败时检查 Provider 服务状态。', true),
  AUTH_FAILED: diagnostic('FORBIDDEN', '模型服务认证失败', 'API Key 缺失、无效或没有访问权限。', '检查并重新保存资源密钥。', false),
  RATE_LIMITED: diagnostic('TIMEOUT', '模型服务请求受限', 'Provider 拒绝了当前频率或配额下的请求。', '等待限流窗口结束后重试。', true),
  MODEL_NOT_FOUND: diagnostic('NOT_FOUND', '配置的模型不存在', 'Provider 无法找到请求中指定的模型。', '刷新模型列表并选择可用模型。', false),
  ENDPOINT_NOT_FOUND: diagnostic('NOT_FOUND', '模型服务端点不存在', 'Base URL 对应的接口路径不存在。', '检查 Base URL 和 Provider 类型。', false),
  PROVIDER_UNAVAILABLE: diagnostic('CORE_UNAVAILABLE', '没有可用的模型资源', '路由无法找到满足任务能力的已启用资源。', '在 LLM 设置中配置并启用对应资源。', true),
  PROVIDER_RESPONSE_INVALID: diagnostic('INTERNAL', '模型服务响应不符合协议', 'Provider 返回值缺少当前协议要求的字段。', '检查兼容接口或更换 Provider。', false),
  PROVIDER_STREAM_UNSUPPORTED: diagnostic('INVALID_PAYLOAD', '模型服务不支持流式响应', '当前服务或第三方中转明确拒绝了流式请求。', '启用中转站的流式兼容能力，或更换支持流式响应的服务。', false),
  RESPONSE_FORMAT_UNSUPPORTED: diagnostic('INVALID_PAYLOAD', '模型服务不支持结构化响应格式', '当前资源不支持请求的 JSON Schema 或 JSON Object 通道。', '修改资源能力配置或使用提示词模式。', false),
  CONTENT_FILTERED: diagnostic('FORBIDDEN', '模型服务拒绝了请求内容', 'Provider 的内容安全策略阻止了生成。', '调整输入内容或资源策略。', false),
  CIRCUIT_OPEN: diagnostic('CORE_UNAVAILABLE', '模型资源已暂时熔断', '该资源连续失败，路由保护暂时阻止继续调用。', '等待熔断恢复或选择其他资源。', true),
  TOKEN_LIMIT_EXCEEDED: diagnostic('INVALID_PAYLOAD', '模型输出达到长度上限', '生成在内容完成前达到 token 限制。', '缩小输入或提高输出上限。', true),
  OUTPUT_SCHEMA_REQUIRED: diagnostic('INVALID_PAYLOAD', '结构化任务缺少 Schema', '任务要求结构化结果但没有提供输出 Schema。', '修正任务声明。', false),
  STRUCTURED_OUTPUT_EMPTY: diagnostic('INTERNAL', '模型没有返回结构化内容', 'Provider 调用成功，但响应正文为空。', '检查模型内容过滤状态后从当前批次重试。', true),
  STRUCTURED_OUTPUT_TRUNCATED: diagnostic('INVALID_PAYLOAD', '模型结构化输出被截断', '模型达到输出上限，JSON 没有完整结束。', '减少批次内容或提高输出上限后重试。', true),
  INVALID_JSON: diagnostic('INVALID_PAYLOAD', '模型返回内容不是有效 JSON', '模型输出无法解析为单一完整 JSON。', '允许一次结构修复；持续失败时更换模型。', true),
  SCHEMA_VALIDATION_FAILED: diagnostic('INVALID_PAYLOAD', '模型返回内容不符合记忆结构', 'JSON 字段、类型或必填项不满足任务 Schema。', '根据字段路径执行一次定向修复。', true),
  LOG_UNAVAILABLE: diagnostic('CORE_UNAVAILABLE', 'LLM 请求日志不可用', '系统无法在调用模型前持久化 queued 日志。', '恢复 LLM Workspace 后重试；本次没有调用模型。', true),
  LLM_REQUEST_INVALID: diagnostic('INVALID_PAYLOAD', 'LLM 请求参数无效', '任务类型或请求字段不符合 LLM 公共契约。', '修正调用参数。', false),
  LLM_EXECUTION_MISMATCH: diagnostic('INVALID_PAYLOAD', 'LLM 执行链不匹配', '任务声明的场景与调用的执行链不同。', '让任务使用其声明的 completion、structured、tool_turn、embedding 或 rerank 链路。', false),
  LLM_GENERATION_TASK_CONFLICT: diagnostic('CONFLICT', '生成任务标识冲突', '当前生成任务标识已经被同一酒馆连接使用，不能覆盖正在运行或已记录的任务。', '为每次生成使用新的 taskId 后重试。', false),
  LLM_PROFILE_NOT_FOUND: diagnostic('NOT_FOUND', 'LLM 配置档不存在', '请求选择的路由配置档没有注册或已被删除。', '选择现有配置档后重试。', false),
  LLM_DISABLED: diagnostic('CORE_UNAVAILABLE', 'LLM 服务未启用', 'LLM 服务当前没有启动或已经关闭。', '启用 LLM 插件后重试。', true),
  LLM_TASK_UNSUPPORTED: diagnostic('INVALID_PAYLOAD', 'LLM 任务类型不受支持', '请求的任务类型没有对应执行器。', '使用公开的 completion、structured-task、embedding 或 rerank 契约。', false),
  LLM_MODEL_DISCOVERY_UNSUPPORTED: diagnostic('INVALID_PAYLOAD', '资源不支持模型发现', '当前 Provider 没有公开模型列表接口。', '手动填写模型名称。', false),
  LLM_MODEL_DISCOVERY_FAILED: diagnostic('INTERNAL', '模型列表获取失败', 'Provider 模型列表请求没有成功完成。', '检查资源连接后重试。', true),
  LLM_MODEL_PROBE_FAILED: diagnostic('INTERNAL', '模型验证失败', '候选模型没有通过最小连接验证。', '检查模型名称和资源权限。', true),
  LLM_CAPABILITY_UNAVAILABLE: diagnostic('INVALID_PAYLOAD', '资源能力不匹配', '该资源不支持当前任务要求的能力。', '选择支持该用途的 Provider 或模型。', false),
  LLM_REASONING_CAPABILITY_UNVERIFIED: diagnostic('CONFLICT', '思考能力尚未验证', '当前资源和模型没有针对所选思考策略的有效能力快照。', '在资源设置中重新检测思考能力。', true),
  LLM_REASONING_CONFIGURATION_UNSUPPORTED: diagnostic('INVALID_PAYLOAD', '思考策略不受支持', '当前资源、模型或执行链不接受所选思考模式或强度。', '选择已验证的思考策略，或改为跟随 Provider 默认。', false),
  LLM_REASONING_PROBE_FAILED: diagnostic('INTERNAL', '思考能力检测失败', 'Provider 未能完成当前思考策略的独立能力检测。', '检查资源连接和模型后重新检测。', true),
  LLM_TASK_ROUTE_UNAVAILABLE: diagnostic('CORE_UNAVAILABLE', '任务路由不可用', '显式绑定的资源或模型不可用，严格任务路由已停止执行。', '修复指定资源、重新验证模型，或将任务恢复为跟随默认。', true),
  LLM_TOOL_CALLS_UNSUPPORTED: diagnostic('INVALID_PAYLOAD', '模型不支持原生工具调用', '当前资源和模型没有可用的原生 Tool Calls 协议。', '关闭只读工具，或选择已验证支持工具调用的模型。', false),
  LLM_TOOL_SESSION_EXPIRED: diagnostic('STALE_SESSION', '工具会话已过期', '短生命周期 Tool Session 不存在或已经超过有效期。', '从当前 Stage 重新发起一次完整工具回合。', true),
  LLM_TOOL_SESSION_SCOPE_MISMATCH: diagnostic('FORBIDDEN', '工具会话作用域不匹配', '续轮请求与会话绑定的插件、聊天、批次、任务、资源或模型不一致。', '停止复用该会话并从当前 Stage 重新开始。', false),
  LLM_TOOL_CALL_INVALID: diagnostic('INVALID_PAYLOAD', '模型工具调用无效', 'Provider 返回了未知工具、重复调用 ID 或无法校验的参数。', '检查模型工具能力和 Adapter 协议实现。', false),
  LLM_TOOL_CALL_LIMIT_EXCEEDED: diagnostic('INVALID_PAYLOAD', '工具调用超过限制', '当前 Stage 的工具轮次、单轮调用数或总调用数超过固定上限。', '让模型使用已有上下文完成输出，或缩小本次任务。', false),
  LLM_TOOL_SCHEMA_UNSUPPORTED: diagnostic('INVALID_PAYLOAD', '工具参数结构不受支持', '工具 Schema 无法在当前 Provider 上保持业务约束地安全映射。', '更换模型或修正工具定义，不能静默删除约束。', false),
  LLM_TOOL_CAPABILITY_UNVERIFIED: diagnostic('CONFLICT', '工具能力尚未验证', '当前资源和模型没有有效的原生工具握手快照。', '在设置页重新执行工具能力验证。', true),
  LLM_TOOL_SESSION_CAPACITY_EXCEEDED: diagnostic('CONFLICT', '工具会话容量已满', 'Tool Session 状态大小或插件、聊天、资源、全局活跃数量达到安全上限。', '等待现有会话完成或取消后重试。', true),
  LLM_PROVIDER_STATE_NOT_AUTHORIZED: diagnostic('FORBIDDEN', '供应商托管状态未获授权', '当前资源没有获准保存远端会话状态或使用 previous id 续接。', '继续使用默认本地重放，或在高级设置中明确授权并确认留存风险。', false),
  LLM_TOOL_CONTEXT_INTEGRITY_FAILED: diagnostic('INTERNAL', '工具会话上下文不完整', 'Provider 续轮所需的 reasoning、assistant message、step 或调用配对信息缺失。', '停止当前会话并检查 Provider Adapter 的本地重放实现。', false),
  LLM_PROVIDER_TEST_FAILED: diagnostic('INTERNAL', '模型资源连接测试失败', '资源测试遇到了无法进一步分类的内部异常。', '检查请求 ID 对应的服务日志。', false),
  MEMORY_LLM_CLIENT_UNAVAILABLE: diagnostic('CORE_UNAVAILABLE', 'Memory 无法连接 LLM 服务', '当前会话没有可用的 LLM structured-task 客户端。', '确认 LLM 插件已连接后重试。', true),
  MEMORY_AGENT_ROUTE_UNAVAILABLE: diagnostic('CORE_UNAVAILABLE', '记忆 Agent 路由不可用', '当前管线必需的提取 Stage 没有满足能力要求的严格路由。', '在 Agent 管线设置中修复任务资源或关闭 Agent 模式。', true),
  MEMORY_AGENT_TOOL_NOT_ALLOWED: diagnostic('FORBIDDEN', 'Agent 工具调用越权', '当前 Stage 请求了不在固定只读白名单中的工具。', '检查 Stage 工具定义；该调用不会执行。', false),
  MEMORY_AGENT_TOOL_ARGUMENT_INVALID: diagnostic('INVALID_PAYLOAD', 'Agent 工具参数无效', '工具参数没有通过统一 Schema 或当前业务作用域校验。', '修正工具参数后重新运行当前 Stage。', false),
  MEMORY_AGENT_TOOL_TIMEOUT: diagnostic('TIMEOUT', '记忆查询工具超时', '只读工具没有在固定时间预算内完成查询。', '缩小查询范围或稍后重试当前 Stage。', true),
  MEMORY_AGENT_TOOL_STALE_REVISION: diagnostic('CONFLICT', '工具读取状态已经变化', 'Tool Read Set 中的记录在提交前被其他操作更新。', '重新裁决受影响的更新，必要时只重跑对应 Stage。', true),
  MEMORY_AGENT_TOOL_INSTRUCTION_TAINT: diagnostic('FORBIDDEN', '工具结果包含指令型文本', '已存储数据中检测到只能作为数据处理的命令或权限要求。', '忽略其中指令并仅使用经过裁剪的上下文字段。', false),
  MEMORY_UPDATE_PENDING_REVIEW: diagnostic('CONFLICT', '记忆更新需要人工审核', '候选与当前状态、证据、数量或时间关系无法安全自动裁决。', '在审核队列中接受、拒绝、编辑、合并或重新提取。', false),
  MEMORY_CAPTURE_EVIDENCE_MISMATCH: diagnostic('INVALID_PAYLOAD', '候选证据无法对应来源', '候选缺少可验证的来源引用或原文证据片段。', '重新提取相关 Stage；该候选不会提交。', true),
  MEMORY_REVIEW_APPROVED: diagnostic('CONFLICT', '人工审核已授权更新', '用户明确接受、编辑或合并了原本无法自动裁决的候选。', '按审核决定继续完整校验和原子提交。', false),
  MEMORY_UPDATE_CREATE: diagnostic('CONFLICT', '将创建新的记忆事实', '当前事实槽没有可匹配的有效记录。', '按来源证据创建新事实。', false),
  MEMORY_UPDATE_DUPLICATE: diagnostic('CONFLICT', '检测到重复记忆', '候选与当前事实或库存状态等价。', '跳过重复写入并保留现有记录。', false),
  MEMORY_UPDATE_APPEND_HISTORY: diagnostic('CONFLICT', '候选应追加为历史记录', '候选描述的故事时间早于当前状态，不能覆盖当前事实头。', '只追加历史事件并保持当前状态不变。', false),
  MEMORY_UPDATE_CONFLICT: diagnostic('CONFLICT', '记忆候选与当前状态冲突', '候选置信度或知识边界不足以安全覆盖当前事实。', '进入人工审核后再决定接受、编辑或合并。', false),
  MEMORY_UPDATE_SUPERSEDE: diagnostic('CONFLICT', '新事实将取代当前事实头', '候选由较新的直接证据支持且通过更新裁决。', '保留旧事实历史并将新事实设为当前头。', false),
  MEMORY_INVENTORY_CREATE: diagnostic('CONFLICT', '将创建新的库存状态', '当前目录没有同物品和计量类型的状态。', '创建物品状态并记录本次库存事件。', false),
  MEMORY_INVENTORY_UNIT_CONFLICT: diagnostic('CONFLICT', '库存单位发生冲突', '候选单位与当前状态单位不一致且无法确定性换算。', '编辑单位或人工确认后再提交。', false),
  MEMORY_INVENTORY_SET: diagnostic('CONFLICT', '库存将更新为新快照', '本批证据明确给出了当前库存快照。', '记录事件并更新当前库存状态。', false),
  MEMORY_INVENTORY_DELTA: diagnostic('CONFLICT', '库存将应用数量变化', '本批证据明确表达了库存增加或减少。', '记录事件并在精确同单位状态上应用变化。', false),
  MEMORY_SCENE_INITIAL: diagnostic('CONFLICT', '将创建初始场景', '当前聊天还没有可复用的场景状态。', '从本批直接证据创建初始场景。', false),
  MEMORY_SCENE_EXPLICIT_TRANSITION: diagnostic('CONFLICT', '检测到明确场景切换', '来源包含地点、时间跳转、场景重置或新的地点候选。', '保留前一场景并创建新的场景状态。', false),
  MEMORY_SCENE_PRESENCE: diagnostic('CONFLICT', '场景在场人员发生变化', '来源包含明确进入或离开线索。', '只更新在场状态并保留场景连续性。', false),
  MEMORY_SCENE_REUSE: diagnostic('CONFLICT', '继续复用当前场景', '没有直接证据表明地点或场景边界发生变化。', '沿用当前场景并更新必要的观测信息。', false),
  MEMORY_REVIEW_ITEM_EXPIRED: diagnostic('STALE_SESSION', '记忆审核项目已过期', '审核所依据的来源或当前状态已发生不可恢复的变化。', '重新提取相关 Stage 生成新的审核项目。', false),
  MEMORY_EXTRACTION_STAGE_FAILED: diagnostic('INTERNAL', '记忆提取阶段失败', '一个固定 Stage 没有产出可用结果，但其他 Stage 可以继续。', '查看阶段与请求 ID，修复路由或输入后定向重跑。', true),
  MEMORY_EXTRACTION_PIPELINE_CANCELLED: diagnostic('ABORTED', '记忆提取管线已取消', '聊天、设置作用域或用户操作在管线完成前触发取消。', '在当前聊天和最新设置下重新发起提取。', false),
  MEMORY_RETIRED_STORAGE_DETECTED: diagnostic('CONFLICT', '检测到已退休的 Memory 数据', '当前 v0 运行时检测到旧存储结构。', '删除活动旧数据目录后重新初始化。', false),
  MEMORY_ARCHIVE_EXPORT_DISABLED: diagnostic('FORBIDDEN', 'Memory 归档导出已禁用', '当前断代版本不从业务层导出运行时数据库。', '部署回滚仅使用停机后的目录级备份。', false),
  MEMORY_ARCHIVE_IMPORT_DISABLED: diagnostic('FORBIDDEN', 'Memory 归档导入已禁用', '当前断代版本不读取旧归档。', '使用当前运行时重新初始化聊天。', false),
  PLAIN_DATA_BOUNDARY_INVALID: diagnostic('INVALID_PAYLOAD', 'Memory 数据不符合公共边界', '待提交的数据包含不允许的值或结构。', '根据安全路径修正数据生产逻辑。', false),
  ENTITY_REF_UNSUPPORTED: diagnostic('INVALID_PAYLOAD', '实体引用缺少来源支持', '模型返回的实体引用无法由本次来源或实体目录确认。', '将该项目送入定向修复。', true),
  CAPTURE_ITEM_INVALID: diagnostic('INVALID_PAYLOAD', '记忆项目未通过业务校验', '结构合法的项目不满足 Memory 业务约束。', '检查拒绝原因；该项目不会写入事实。', false),
  REPAIR_UNRESOLVED: diagnostic('INVALID_PAYLOAD', '结构化修复仍未解决', '定向修复后项目仍未通过结构或引用校验。', '保留待修复状态并人工检查。', true),
  MEMORY_REPAIR_SOURCE_UNAVAILABLE: diagnostic('NOT_FOUND', '修复来源暂时不可用', '待修复项目找不到原始锚点或可用的来源窗口。', '恢复原聊天来源后继续处理；本次不会调用模型或消耗修复次数。', true),
  MEMORY_CAPTURE_ROLLBACK_FAILED: diagnostic('INTERNAL', '记忆批次回滚失败', '捕获提交失败后未能恢复到批次开始前的状态。', '停止继续写入并检查 Workspace 事务日志。', false),
  MEMORY_CAPTURE_INTEGRITY_FAILED: diagnostic('INTERNAL', '记忆批次完整性校验失败', '批次提交结果与预期的事实、证据或变更集不一致。', '保留请求 ID 和批次序号后检查 Workspace 日志。', false),
  MEMORY_CAPTURE_NOT_BOUND: diagnostic('CORE_UNAVAILABLE', '记忆捕获尚未绑定工作区', '当前聊天的捕获服务尚未完成 Workspace 与实体目录绑定。', '重新绑定当前聊天后再初始化。', true),
  MEMORY_STALE_GENERATION_SCOPE: diagnostic('STALE_SESSION', '生成上下文已经过期', '聊天或身份在生成任务完成前发生了变化。', '在当前聊天中重新发起操作。', false),
  MEMORY_CHAT_BIND_FAILED: diagnostic('CORE_UNAVAILABLE', '当前聊天记忆绑定失败', 'Memory 未能为当前聊天打开并绑定 Workspace 会话。', '重新检查 SDK Core 与当前聊天状态。', true),
  MEMORY_CHAT_READ_FAILED: diagnostic('INTERNAL', '当前聊天记忆读取失败', '已绑定工作区，但读取当前聊天的记忆状态失败。', '保留请求 ID 后重新读取。', true),
} satisfies Record<string, SSHelperDiagnosticDefinition>);

export type SSHelperReasonCode = keyof typeof SS_HELPER_DIAGNOSTICS;
export const SS_HELPER_REASON_CODES = Object.freeze(Object.keys(SS_HELPER_DIAGNOSTICS) as SSHelperReasonCode[]);

const errorCodeSet = new Set<string>(SS_HELPER_ERROR_CODES);
const reasonCodeSet = new Set<string>(SS_HELPER_REASON_CODES);
const contextKeys = new Set([
  'requestId', 'attemptId', 'batchIndex', 'collection', 'path', 'keyword',
  'expected', 'httpStatus', 'providerKind', 'resourceId', 'model',
  'providerErrorCode', 'providerErrorType', 'providerErrorParam',
]);

export function isSSHelperReasonCode(value: unknown): value is SSHelperReasonCode {
  return typeof value === 'string' && reasonCodeSet.has(value);
}

export function transportCodeFor(reasonCode: SSHelperReasonCode): SSHelperErrorCode {
  return SS_HELPER_DIAGNOSTICS[reasonCode].transportCode;
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safeContextValue(value: unknown): string | number | undefined {
  if (typeof value === 'string' && value.length > 0 && value.length <= 256) return value;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return undefined;
}

export function readSSHelperFailure(
  error: unknown,
  fallback?: Pick<SSHelperFailureContext, 'reasonCode' | 'stage'> & Partial<SSHelperFailureContext>,
): SSHelperFailureContext | undefined {
  const source = plainRecord(error);
  const details = plainRecord(source?.details);
  const candidateReason = details?.reasonCode ?? source?.reasonCode;
  const candidateStage = details?.stage ?? source?.stage;
  const reasonCode = isSSHelperReasonCode(candidateReason)
    ? candidateReason
    : fallback?.reasonCode;
  const stage = typeof candidateStage === 'string' && candidateStage.length > 0
    ? candidateStage
    : fallback?.stage;
  if (
    !isSSHelperReasonCode(candidateReason)
    && source?.cause !== undefined
    && source.cause !== error
  ) {
    const nested = readSSHelperFailure(source.cause, fallback);
    if (nested !== undefined) return nested;
  }
  if (reasonCode === undefined || stage === undefined) return undefined;
  const output: Record<string, string | number> = { reasonCode, stage };
  for (const key of contextKeys) {
    const value = safeContextValue(details?.[key] ?? source?.[key] ?? fallback?.[key]);
    if (value !== undefined) output[key] = value;
  }
  return output as unknown as SSHelperFailureContext;
}

export function describeSSHelperFailure(
  error: unknown,
  fallback: Pick<SSHelperFailureContext, 'reasonCode' | 'stage'> & Partial<SSHelperFailureContext> = {
    reasonCode: 'INTERNAL_ERROR',
    stage: 'unknown',
  },
): SSHelperDiagnostic {
  const context = readSSHelperFailure(error, fallback) ?? fallback as SSHelperFailureContext;
  return Object.freeze({ ...SS_HELPER_DIAGNOSTICS[context.reasonCode], ...context });
}

export function createSSHelperError(
  reasonCode: SSHelperReasonCode,
  context: Omit<SSHelperFailureContext, 'reasonCode'>,
): SSHelperError {
  const definition = SS_HELPER_DIAGNOSTICS[reasonCode];
  return new SSHelperError(definition.transportCode, definition.title, { ...context, reasonCode });
}

export class SSHelperError extends Error {
  readonly code: SSHelperErrorCode;
  readonly details?: SSHelperErrorDetails;
  constructor(code: SSHelperErrorCode, message: string, details?: SSHelperErrorDetails) {
    super(message);
    this.name = 'SSHelperError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isSSHelperError(value: unknown): value is SSHelperError {
  const record = plainRecord(value);
  return record?.name === 'SSHelperError'
    && typeof record.code === 'string'
    && errorCodeSet.has(record.code);
}
