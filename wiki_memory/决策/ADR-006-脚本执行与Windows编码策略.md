---
type: decision
status: active
kind: operations
importance: high
updated: 2026-08-25
topic: script-execution-encoding
source_logs:
  - "[[日志/2026-08-25-Git初始化与工程记忆构建]]"
supersedes: null
---

# ADR-006｜脚本执行与 Windows 编码策略

## 状态

active

## 决策

工具箱仅允许固定的 9 个 Python 脚本。每次运行先预检脚本、Python 解释器、工作目录和终端，再显示确认窗口；只有用户确认后才启动。

PowerShell 包装器使用 UTF-8 BOM，固定绝对 Python 路径和脚本工作目录，设置 UTF-8 输入输出，并将日志和退出码保存到 ChatObsidian 本地目录。

原 Python 文件保持只读，不通过文本替换修复编码问题。
