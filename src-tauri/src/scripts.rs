use crate::db;
use crate::error::{AppResult, message};
use crate::models::{OperationRecord, ScriptRunPreview, ScriptTool};
use crate::state::AppState;
use crate::util::now_millis;
use rusqlite::params;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone)]
struct PythonInterpreter {
    path: PathBuf,
    version: String,
}

struct ScriptDefinition {
    id: &'static str,
    name: &'static str,
    description: &'static str,
}

const SCRIPTS: &[ScriptDefinition] = &[
    ScriptDefinition {
        id: "backup",
        name: ".Backup删除.py",
        description: "清理历史备份目录",
    },
    ScriptDefinition {
        id: "claude",
        name: ".Claude替换.py",
        description: "同步 Claude 配置",
    },
    ScriptDefinition {
        id: "convert",
        name: ".Convert_txt.py",
        description: "批量转换 TXT 文件",
    },
    ScriptDefinition {
        id: "number",
        name: ".Number统计.py",
        description: "统计仓库编号与数量",
    },
    ScriptDefinition {
        id: "obsidian",
        name: ".Obsidian替换.py",
        description: "完整同步 Obsidian 配置",
    },
    ScriptDefinition {
        id: "sync",
        name: ".Synchronize.py",
        description: "同步模板内容",
    },
    ScriptDefinition {
        id: "templater",
        name: ".Templater替换.py",
        description: "同步 Templater 配置",
    },
    ScriptDefinition {
        id: "trash",
        name: ".Trash删除.py",
        description: "清理仓库废纸篓",
    },
    ScriptDefinition {
        id: "web",
        name: ".Web替换.py",
        description: "同步 Web 插件配置",
    },
];

pub fn list(state: &AppState) -> AppResult<Vec<ScriptTool>> {
    refresh(state)?;
    let operations = {
        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        db::list_operations(&connection, 200)?
    };
    let root = scripts_root();
    Ok(SCRIPTS
        .iter()
        .map(|definition| {
            let path = root.join(definition.name);
            let last_run = operations
                .iter()
                .find(|operation| {
                    operation.kind == "script" && operation.title.contains(definition.name)
                })
                .cloned();
            ScriptTool {
                id: definition.id.into(),
                name: definition.name.into(),
                description: definition.description.into(),
                path: path.to_string_lossy().to_string(),
                exists: path.is_file(),
                last_run,
            }
        })
        .collect())
}

pub fn preview(state: &AppState, script_id: &str) -> AppResult<ScriptRunPreview> {
    let definition = definition(script_id)?;
    let script_path = scripts_root().join(definition.name);
    let working_directory = script_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(scripts_root);
    let python = resolve_python();
    let mut issues = Vec::new();
    if !script_path.is_file() {
        issues.push(format!("脚本文件不存在：{}", script_path.display()));
    }
    if !working_directory.is_dir() {
        issues.push(format!("工作目录不存在：{}", working_directory.display()));
    }
    if python.is_none() {
        issues.push("没有找到可运行的 Python 解释器".to_string());
    }
    let uses_windows_terminal = command_exists("wt.exe");
    Ok(ScriptRunPreview {
        script_id: definition.id.into(),
        name: definition.name.into(),
        description: definition.description.into(),
        script_path: script_path.to_string_lossy().to_string(),
        python_path: python
            .as_ref()
            .map(|interpreter| interpreter.path.to_string_lossy().to_string()),
        python_version: python
            .as_ref()
            .map(|interpreter| interpreter.version.clone()),
        working_directory: working_directory.to_string_lossy().to_string(),
        terminal: if uses_windows_terminal {
            "Windows Terminal"
        } else {
            "独立 PowerShell 窗口"
        }
        .into(),
        log_directory: state.paths.log_dir.to_string_lossy().to_string(),
        interactive: true,
        ready: issues.is_empty(),
        issues,
    })
}

pub fn run(state: &AppState, script_id: &str) -> AppResult<OperationRecord> {
    let definition = definition(script_id)?;
    let launch = preview(state, script_id)?;
    if !launch.ready {
        return Err(message(launch.issues.join("；")));
    }
    let script_path = PathBuf::from(&launch.script_path);
    let python_path = PathBuf::from(
        launch
            .python_path
            .as_deref()
            .ok_or_else(|| message("Python 解释器预检失败"))?,
    );
    let working_directory = PathBuf::from(&launch.working_directory);
    let operation_id = uuid::Uuid::new_v4().to_string();
    let log_path = state
        .paths
        .log_dir
        .join(format!("script-{operation_id}.log"));
    let done_path = state
        .paths
        .runtime_dir
        .join(format!("script-{operation_id}.done"));
    let wrapper_path = state
        .paths
        .runtime_dir
        .join(format!("script-{operation_id}.ps1"));
    let wrapper = build_wrapper(
        &script_path,
        &python_path,
        &working_directory,
        &log_path,
        &done_path,
    );
    write_utf8_bom(&wrapper_path, &wrapper)?;

    let operation = OperationRecord {
        id: operation_id.clone(),
        kind: "script".into(),
        title: format!("运行 {}", definition.name),
        status: "running".into(),
        detail: format!(
            "脚本={}；Python={}；工作目录={}；终端={}",
            script_path.display(),
            python_path.display(),
            working_directory.display(),
            launch.terminal
        ),
        created_at: now_millis(),
        finished_at: None,
        can_rollback: false,
        log_path: Some(log_path.to_string_lossy().to_string()),
    };
    let launch_result = if launch.terminal == "Windows Terminal" {
        Command::new("wt.exe")
            .args([
                "new-tab",
                "--title",
                definition.name,
                "powershell.exe",
                "-NoProfile",
                "-NoExit",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&wrapper_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    } else {
        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NoExit",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&wrapper_path)
            .creation_flags_new_console()
            .spawn()
    };
    if let Err(error) = launch_result {
        let failed = OperationRecord {
            status: "failed".into(),
            detail: format!("无法启动终端：{error}"),
            finished_at: Some(now_millis()),
            ..operation
        };
        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        db::save_operation(&connection, &failed)?;
        return Err(error.into());
    }
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    db::save_operation(&connection, &operation)?;
    Ok(operation)
}

fn definition(script_id: &str) -> AppResult<&'static ScriptDefinition> {
    SCRIPTS
        .iter()
        .find(|script| script.id == script_id)
        .ok_or_else(|| message("脚本不在允许列表中"))
}

fn build_wrapper(
    script_path: &Path,
    python_path: &Path,
    working_directory: &Path,
    log_path: &Path,
    done_path: &Path,
) -> String {
    format!(
        "$ErrorActionPreference = 'Continue'\r\n\
         $utf8 = New-Object System.Text.UTF8Encoding($false)\r\n\
         [Console]::InputEncoding = $utf8\r\n\
         [Console]::OutputEncoding = $utf8\r\n\
         $OutputEncoding = $utf8\r\n\
         Set-Location -LiteralPath '{}'\r\n\
         Start-Transcript -LiteralPath '{}' -Force\r\n\
         & '{}' '{}'\r\n\
         $scriptExit = if ($null -eq $LASTEXITCODE) {{ 0 }} else {{ $LASTEXITCODE }}\r\n\
         Stop-Transcript\r\n\
         Set-Content -LiteralPath '{}' -Value $scriptExit -Encoding utf8\r\n\
         Write-Host ''\r\n\
         Write-Host ('脚本已结束，退出代码：' + $scriptExit)\r\n\
         Read-Host '按 Enter 关闭终端' | Out-Null\r\n\
         exit $scriptExit\r\n",
        escape_powershell_path(working_directory),
        escape_powershell_path(&log_path),
        escape_powershell_path(python_path),
        escape_powershell_path(&script_path),
        escape_powershell_path(&done_path)
    )
}

fn write_utf8_bom(path: &Path, content: &str) -> AppResult<()> {
    let mut bytes = Vec::with_capacity(3 + content.len());
    bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    bytes.extend_from_slice(content.as_bytes());
    std::fs::write(path, bytes)?;
    Ok(())
}

fn resolve_python() -> Option<PythonInterpreter> {
    let output = Command::new("where.exe")
        .arg("python.exe")
        .creation_flags_no_window()
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .find_map(|path| {
            let result = Command::new(&path)
                .arg("--version")
                .creation_flags_no_window()
                .output()
                .ok()?;
            if !result.status.success() {
                return None;
            }
            let version = if result.stdout.is_empty() {
                String::from_utf8_lossy(&result.stderr).trim().to_string()
            } else {
                String::from_utf8_lossy(&result.stdout).trim().to_string()
            };
            Some(PythonInterpreter { path, version })
        })
}

pub fn refresh(state: &AppState) -> AppResult<Vec<OperationRecord>> {
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    let running: Vec<_> = db::list_operations(&connection, 500)?
        .into_iter()
        .filter(|operation| operation.kind == "script" && operation.status == "running")
        .collect();
    for operation in running {
        let done = state
            .paths
            .runtime_dir
            .join(format!("script-{}.done", operation.id));
        if !done.is_file() {
            continue;
        }
        let code = std::fs::read_to_string(&done)
            .ok()
            .and_then(|text| {
                text.trim()
                    .trim_start_matches('\u{feff}')
                    .parse::<i32>()
                    .ok()
            })
            .unwrap_or(-1);
        let status = if code == 0 { "success" } else { "failed" };
        let detail = if code == 0 {
            "脚本已正常结束".to_string()
        } else {
            format!("脚本退出代码：{code}")
        };
        connection.execute(
            "UPDATE operations SET status=?1,detail=?2,finished_at=?3 WHERE id=?4",
            params![status, detail, now_millis(), operation.id],
        )?;
    }
    db::list_operations(&connection, 200)
}

fn scripts_root() -> PathBuf {
    let home = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\Users\\Administrator"));
    home.join("Desktop").join("Obsidian仓库")
}

fn escape_powershell_path(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

fn command_exists(name: &str) -> bool {
    Command::new("where.exe")
        .arg(name)
        .creation_flags_no_window()
        .output()
        .is_ok_and(|output| output.status.success())
}

#[cfg(windows)]
trait CommandWindowsExt {
    fn creation_flags_no_window(&mut self) -> &mut Self;
    fn creation_flags_new_console(&mut self) -> &mut Self;
}

#[cfg(windows)]
impl CommandWindowsExt for Command {
    fn creation_flags_no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(0x08000000)
    }
    fn creation_flags_new_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(0x00000010)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    use std::io::Write;

    #[test]
    fn wrapper_is_utf8_bom_and_preserves_chinese_paths() {
        let root =
            std::env::temp_dir().join(format!("chatobsidian-wrapper-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let wrapper_path = root.join("运行脚本.ps1");
        let script = PathBuf::from(r"C:\Users\Administrator\Desktop\Obsidian仓库\.Synchronize.py");
        let python = PathBuf::from(r"D:\03_Python\Python\python.exe");
        let working = PathBuf::from(r"C:\Users\Administrator\Desktop\Obsidian仓库");
        let log = root.join("脚本.log");
        let done = root.join("完成.done");
        let content = build_wrapper(&script, &python, &working, &log, &done);
        write_utf8_bom(&wrapper_path, &content).unwrap();
        let bytes = std::fs::read(&wrapper_path).unwrap();
        assert_eq!(&bytes[..3], &[0xEF, 0xBB, 0xBF]);
        let decoded = std::str::from_utf8(&bytes[3..]).unwrap();
        assert!(decoded.contains("Obsidian仓库"));
        assert!(decoded.contains("按 Enter 关闭终端"));
        assert!(decoded.contains(
            "Set-Location -LiteralPath 'C:\\Users\\Administrator\\Desktop\\Obsidian仓库'"
        ));
        assert!(decoded.contains("& 'D:\\03_Python\\Python\\python.exe' 'C:\\Users\\Administrator\\Desktop\\Obsidian仓库\\.Synchronize.py'"));
        let parser_check = format!(
            "$tokens=$null; $errors=$null; $text=Get-Content -LiteralPath '{}' -Raw; \
             if(-not $text.Contains('Obsidian仓库')) {{ exit 2 }}; \
             [System.Management.Automation.Language.Parser]::ParseFile('{}',[ref]$tokens,[ref]$errors) | Out-Null; \
             if($errors.Count -gt 0) {{ $errors | Out-String | Write-Error; exit 3 }}",
            escape_powershell_path(&wrapper_path),
            escape_powershell_path(&wrapper_path)
        );
        let parsed = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &parser_check])
            .output()
            .unwrap();
        assert!(
            parsed.status.success(),
            "PowerShell 5.1 parser rejected wrapper: {}",
            String::from_utf8_lossy(&parsed.stderr)
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn powershell_51_executes_wrapper_from_chinese_working_directory() {
        let root = std::env::temp_dir().join(format!("chatobsidian-exec-{}", uuid::Uuid::new_v4()));
        let working = root.join("Obsidian仓库");
        std::fs::create_dir_all(&working).unwrap();

        let script = working.join(".验证.py");
        std::fs::write(
            &script,
            "from pathlib import Path\nPath('python-ran.txt').write_text('ok', encoding='utf-8')\nprint('PYTHON_OK')\n",
        )
        .unwrap();
        let python = resolve_python().expect("a verified Python interpreter is required");
        let wrapper_path = root.join("运行脚本.ps1");
        let log = root.join("脚本.log");
        let done = root.join("完成.done");
        let content = build_wrapper(&script, &python.path, &working, &log, &done);
        write_utf8_bom(&wrapper_path, &content).unwrap();

        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&wrapper_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.as_mut().unwrap().write_all(b"\r\n").unwrap();
        let output = child.wait_with_output().unwrap();
        let stdout = std::str::from_utf8(&output.stdout)
            .expect("wrapper output must remain valid UTF-8 under Windows PowerShell 5.1");
        let stderr = String::from_utf8_lossy(&output.stderr);

        assert!(
            output.status.success(),
            "wrapper execution failed; stdout={stdout}; stderr={stderr}"
        );
        assert_eq!(
            std::fs::read_to_string(working.join("python-ran.txt")).unwrap(),
            "ok"
        );
        assert!(stdout.contains("PYTHON_OK"));
        assert!(stdout.contains("脚本已结束，退出代码：0"));
        assert!(std::fs::read(&done).unwrap().ends_with(b"0\r\n"));

        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(not(windows))]
trait CommandWindowsExt {
    fn creation_flags_no_window(&mut self) -> &mut Self;
    fn creation_flags_new_console(&mut self) -> &mut Self;
}

#[cfg(not(windows))]
impl CommandWindowsExt for Command {
    fn creation_flags_no_window(&mut self) -> &mut Self {
        self
    }
    fn creation_flags_new_console(&mut self) -> &mut Self {
        self
    }
}
