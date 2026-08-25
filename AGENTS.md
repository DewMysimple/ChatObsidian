# ChatObsidian Agent 入口

默认工作流：完成每个实质任务后更新工程记忆、运行相关验证、创建 Git 提交并推送到 origin/main。禁止强制推送；远程出现未预期历史时先停止并报告。

本项目的工程记忆协议和长期记忆均位于 [`wiki_memory/`](./wiki_memory/)。

任何涉及本工程的编码、排查、设计或维护任务，开始前必须先读取：

1. `wiki_memory/AGENTS.md`
2. `wiki_memory/当前状态/项目概览.md`
3. `wiki_memory/当前状态/系统架构.md`
4. `wiki_memory/当前状态/当前约束.md`
5. 与当前任务相关的 active 决策和知识页

完成实质任务后，按照 `wiki_memory/AGENTS.md` 追加工作日志，并运行记忆 lint。
