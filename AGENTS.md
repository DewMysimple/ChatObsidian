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

## 发布覆盖规则

涉及运行时行为的代码或配置迭代，除非用户明确指定其他版本，默认递增 patch 版本，并同步更新 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json`。

完成验证后必须运行 `build-installer.ps1` 发布构建。构建流程必须：

- 自动结束仅属于 ChatObsidian 的进程，不得结束 `Obsidian.exe`；
- 覆盖 `src-tauri/target/release/chat-obsidian.exe`；
- 保留带版本号的 NSIS 安装包，并覆盖 `src-tauri/target/release/bundle/nsis/ChatObsidian-latest-setup.exe`；
- 检测到已有安装时自动运行固定安装包升级，保留应用数据；
- 进程无法结束、文件仍被占用、测试失败或安装失败时立即中止并报告原因；
- 不自动重新启动 ChatObsidian。

仅文档、排查或工程记忆更新不重复构建发布产物，但仍遵守本文件规定的记忆同步、提交和推送流程。发布构建产物位于被 Git 忽略的目录，不提交二进制文件；完成实质任务后仍须创建 Git 提交并推送 `origin/main`，禁止强制推送。
