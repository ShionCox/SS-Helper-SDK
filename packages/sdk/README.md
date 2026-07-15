# `@ss-helper/sdk`

无状态 ESM 公共包。只导出 descriptor、session、HostPort、settings、typed service/event token、DTO 与结构化错误；不包含 Core registry、bus、renderer、存储或宿主实现。

只使用 `package.json#exports` 列出的入口。`src/*` 与其他 deep import 是私有路径。
