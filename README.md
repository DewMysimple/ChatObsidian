# ChatObsidian

Windows 11 本地 Obsidian 多仓库管理桌面应用。界面使用 React + TypeScript + 原生 CSS，危险的文件、同步和进程能力全部封装在 Tauri/Rust 后端。

当前版本为 0.1.10：支持在偏好设置中随时启用或关闭 Windows 开机自启，自启时静默驻留托盘；仓库与父分组未设置自定义显示名时会跟随磁盘目录重命名，同时继续保留用户明确设置的显示名。另提供“显示仓库中心、单量打开、增量打开”三个可录制的全局快捷键、跨 Windows 桌面安全重开、单实例、配置快照缓存和安全同步能力。快速切换浮窗会优先显示真实打开仓库，再按最近打开时间排序，并在“仓库”开关旁显示当前可用仓库数量。

## 开发

需要 Node.js 24、pnpm 11、Rust stable 和 Tauri 的 Windows 编译依赖。

```powershell
corepack pnpm install
corepack pnpm tauri:dev
```

浏览器演示模式不会访问本地文件：

```powershell
corepack pnpm dev
```

## 验证与打包

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
corepack pnpm tauri:build
```

日常发布应使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\build-installer.ps1
```

该脚本只结束 `chat-obsidian.exe`，不会结束 `Obsidian.exe`；验证通过后会覆盖：

- `src-tauri/target/release/chat-obsidian.exe`
- `src-tauri/target/release/bundle/nsis/ChatObsidian-latest-setup.exe`

带版本号的 NSIS 安装包会同时保留。检测到已有安装时，脚本自动运行固定安装包完成覆盖升级；无法结束进程、文件被占用、测试或安装失败时会中止。安装升级只替换程序文件和资源，不删除应用数据。

## 本地数据

- `%APPDATA%\ChatObsidian\settings.json`
- `%LOCALAPPDATA%\ChatObsidian\catalog.sqlite`
- `%LOCALAPPDATA%\ChatObsidian\backups`
- `%LOCALAPPDATA%\ChatObsidian\logs`

现有仓库和九个 Python 工具脚本不会被移动、重命名或改写。工具箱仅通过临时 PowerShell 包装器调用固定允许列表中的脚本。
