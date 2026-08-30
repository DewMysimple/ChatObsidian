---
type: moc
status: active
kind: process
importance: high
updated: 2026-08-31
topic: work-log-index
source_logs: []
supersedes: null
---

# 工作日志 MOC

> 单一工作日志索引，按更新时间倒序。任务类型通过 `kind` 元数据区分。

| 时间 | 类型 | 目标 | 状态 | 主题 | 日志 |
| --- | --- | --- | --- | --- | --- |
| 2026-08-31 | bug | - | archived | release-freeze-and-relocation-cache | [[日志/2026-08-31-发布版卡死与迁移缓存修复.md|发布版卡死与迁移缓存修复]] |
| 2026-08-28 | bug | - | archived | quick-switcher-recent-order-and-vault-count | [[日志/2026-08-28-快速切换最近排序与仓库计数修复.md|快速切换最近排序与仓库计数修复]] |
| 2026-08-28 | bug | - | archived | startup-tray-window-restore | [[日志/2026-08-28-开机自启托盘恢复修复.md|开机自启托盘恢复修复]] |
| 2026-08-28 | maintenance | - | archived | workspace-relocation | [[日志/2026-08-28-ChatObsidian项目迁移.md|ChatObsidian 项目迁移]] |
| 2026-08-27 | bug | - | archived | quick-switcher-refresh-and-search | [[日志/2026-08-27-浮窗实时索引与搜索体验修复.md|浮窗实时索引与搜索体验修复]] |
| 2026-08-27 | maintenance | - | archived | build-artifact-overwrite-and-agent-release-policy | [[日志/2026-08-27-构建产物覆盖与Agent发布规则.md|构建产物覆盖与 Agent 发布规则]] |
| 2026-08-25 | maintenance | 初始化 ChatObsidian Git 仓库，绑定 GitHub 远程，并建立项目工程记忆。 | archived | git-and-memory-bootstrap | [[日志/2026-08-25-Git初始化与工程记忆构建.md|2026-08-25｜Git 初始化与工程记忆构建]] |

## 使用方式

- 由 `python 工具/memory_lint.py index` 生成或刷新。
- 查询时先阅读当前状态，再按关键词定位日志。
- 历史日志是审计记录，不应直接覆盖当前状态。

## 入口

- [[README|工程 Agent 记忆系统]]
- [[AGENTS|记忆维护协议]]
- [[当前状态/项目概览|当前项目概览]]
- [[当前状态/系统架构|当前系统架构]]
