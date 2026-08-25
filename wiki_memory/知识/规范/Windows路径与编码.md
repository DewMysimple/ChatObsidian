---
type: knowledge
status: active
kind: operations
importance: high
updated: 2026-08-25
topic: windows-path-encoding
source_logs:
  - "[[日志/2026-08-25-Git初始化与工程记忆构建]]"
supersedes: null
---

# Windows 路径与编码

- \\?\C:\目录 在界面、搜索和复制时显示为 C:\目录。
- \\?\UNC\服务器\共享 显示为 \\服务器\共享。
- 文件操作、安全校验、SQLite 和 URI 编码继续使用后端规范原始路径。
- PowerShell 包装器必须带 UTF-8 BOM，并设置控制台 UTF-8 输入输出。
- 中文路径进入 PowerShell 时使用单引号转义和 -LiteralPath，避免空格、书名号和中文被误解析。
