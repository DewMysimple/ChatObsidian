# ChatObsidian 工程协作入口

本项目是 Windows 11 x64 本地桌面应用，采用 React + TypeScript + Vite + Tauri 2 + Rust + SQLite。当前产品是以数据库视图组织仓库和独立页面的知识工作台。事实以当前代码、README 和最新工作日志为准。

## 开始前

任何编码、排查、设计或维护任务必须先读取：

1. `wiki_memory/AGENTS.md`
2. `wiki_memory/当前状态/项目概览.md`
3. `wiki_memory/当前状态/系统架构.md`
4. `wiki_memory/当前状态/当前约束.md` 与 `当前待办.md`
5. 任务相关的 active 决策和知识页，以及有冲突时的最新工作日志

长期记忆遵守确认后提升的协议。旧 active 页面可能描述重做前的工具箱/同步架构；遇到矛盾先核对当前代码、README 与重做日志，不得根据旧记忆恢复已经删除的危险能力。新结论先记入工作日志的“待确认长期记忆”，不擅自修改历史日志或提升未确认内容。

## 产品与设计原则

- 保留全局快速打开弹窗、单量打开、增量打开、托盘、单实例与可选开机自启。
- 核心数据是本地数据库中的页面；画廊、表格、看板是同一份数据的不同视图。视图的筛选、排序、预览和可见字段分别保存。
- Notion 化必须实际查看官方发布的**应用内部截图**，不能仅参考官网营销页或凭印象设计。将来源页面、截图标识与采用/未采用的细节写入 `docs/notion-research.md`。
- 使用白色/暖灰表面、墨色正文、细分隔线、克制的蓝色操作强调；禁止恢复旧紫色主题。图标与封面应使用本项目原创素材，保持品牌独立。
- 用户界面只展示有意义的操作与状态；浏览器演示必须明确标识，不能将演示动作描述成已经执行的系统操作。

## 不可越过的操作边界

- 仓库发现和笔记索引保持只读，不写入、移动、重命名、删除 Obsidian 文件或 `.obsidian` 配置。不得恢复脚本执行、配置同步、完整镜像或强杀 Obsidian 的接口。
- 前端不能传入任意命令。路径操作、SQLite、原生窗口与持久化校验集中在 Rust。
- 打开仓库前核对登记 ID 和实时路径；只打开仓库内已存在且规范化后不越界的 Markdown 文件。目录打开只允许登记仓库/应用数据中的真实目录，不能借此执行文件。
- Windows 窗口必须验证所属进程；同名或不确定归属时停止。仅发送正常关闭请求；15 秒超时停止，不强杀、不继续打开。跨 WebView 的打开操作必须互斥。
- 外部 I/O、扫描、索引、图片验证与 SQLite 等耗时工作放到 `spawn_blocking`。轮询必须单飞，隐藏窗口停止轮询，不持有前端同步 IPC 等待磁盘。
- 工作台使用事务和 revision 冲突检查。保存失败保留草稿；不能通过遗漏记录实现删除。归档必须可恢复。
- 数据库升级只能追加迁移；旧目录库迁移前创建 SQLite 一致性快照。旧备份和历史继续保留。不得在运行中用普通文件复制冒充 SQLite 一致性备份。
- 偏好设置原子替换，损坏文件不得被默认值覆盖。快捷键/开机自启失败必须回滚；保存队列跨组件卸载保持正确顺序。
- 本地图片只允许受限制的 PNG/JPEG/WebP；不支持远程图片、SVG 或任意文件路径封面。导出必须由原生保存对话框选择目标，不能覆盖应用内部文件或仓库数据。

## 实现与验证

- TypeScript 接口在 `src/contracts/`，桌面桥接在 `src/lib/desktop.ts`；Rust command 注册在 `src-tauri/src/lib.rs`。浏览器演示与桌面真实行为都要维护。
- 新数据库逻辑在 `workspace.rs`；原目录、索引和历史由 `db.rs` 保留。不要在 React 中生成用户真实仓库的虚构数据。
- UI 改动检查常用窗口宽度、暗色模式、键盘焦点、弹窗、空状态、错误与加载状态，并查看实际运行截图。
- 至少运行 `pnpm typecheck`、`pnpm test`。涉及交互/持久化时运行 `pnpm test:e2e`；涉及原生层时运行 `cargo test --manifest-path src-tauri/Cargo.toml`。
- 为并发保存、类型校验、路径/进程边界、迁移和用户流程编写有意义的回归测试。不为纯文案或低影响样式堆叠测试。
- 真实仓库迁移测试必须使用通过 SQLite 备份 API 生成的临时副本，禁止以用户正在使用的数据库或编辑窗口做破坏性实验。
- 用 Prettier 格式化前端，用 `cargo fmt` 格式化 Rust。新增依赖应有明确用途，删除功能时同时清理对应依赖、IPC、演示数据与过时测试。

## 版本、发布、提交

每个实质任务完成后：追加工程日志、更新日志索引、运行记忆 lint、相关验证、创建 Git 提交并推送 `origin/main`。禁止强制推送；远程出现未预期历史时停止并报告。

运行时行为的代码或配置迭代，除非用户另行指定版本，默认递增 patch，同步更新：

- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`
- 对应锁文件、README 和界面版本文本

完成验证后必须执行 `build-installer.ps1`。发布脚本必须：

1. 检查版本一致性、记忆 lint、类型检查、前端/Playwright/Rust 测试。
2. 只结束 ChatObsidian 自身进程，绝不结束 `Obsidian.exe`。
3. 覆盖 `src-tauri/target/release/chat-obsidian.exe`。
4. 保留版本号 NSIS 安装包，并覆盖 `src-tauri/target/release/bundle/nsis/ChatObsidian-latest-setup.exe`，校验两个包的 SHA-256 一致。
5. 检测到已有安装后自动执行固定安装包升级，保留应用数据；后台安装窗口隐藏。
6. 进程无法退出、文件仍被占用、测试/构建/安装失败时立即中止并报告。不自动重新启动 ChatObsidian。

发布产物位于 Git 忽略目录，不提交安装包或可执行文件。源图标及必要的界面截图可以提交。仅文档、排查或记忆更新无需重复发布，但仍需要日志、lint、提交和推送。

```powershell
python wiki_memory/工具/memory_lint.py index
python wiki_memory/工具/memory_lint.py check
.\build-installer.ps1
git fetch origin main
# 核对远程历史、差异和工作区，再提交与普通推送；不覆盖用户变更。
```
