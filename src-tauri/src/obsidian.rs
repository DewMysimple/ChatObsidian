use crate::db;
use crate::error::{AppResult, message};
use crate::models::{OpenVaultResult, OperationRecord, VaultRecord};
use crate::state::AppState;
use crate::util::{is_within, now_millis, safe_relative_path};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use rusqlite::params;
use std::path::Path;
#[cfg(not(windows))]
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CloseScope {
    None,
    Target,
    Others,
    All,
}

fn managed_close_scope(mode: &str, target_only_on_other_desktop: bool) -> CloseScope {
    match (mode, target_only_on_other_desktop) {
        ("single", true) => CloseScope::All,
        ("single", false) => CloseScope::Others,
        ("additive", true) => CloseScope::Target,
        _ => CloseScope::None,
    }
}

#[cfg(windows)]
pub fn is_running() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };

    // SAFETY: the snapshot handle is checked before use, PROCESSENTRY32W has
    // the required size, and the handle is closed on every successful open.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let length = entry
                    .szExeFile
                    .iter()
                    .position(|unit| *unit == 0)
                    .unwrap_or(entry.szExeFile.len());
                if String::from_utf16_lossy(&entry.szExeFile[..length])
                    .eq_ignore_ascii_case("obsidian.exe")
                {
                    found = true;
                    break;
                }
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
        found
    }
}

#[cfg(not(windows))]
pub fn is_running() -> bool {
    Command::new("pgrep")
        .arg("-x")
        .arg("Obsidian")
        .status()
        .is_ok_and(|status| status.success())
}

pub fn open_vault(
    state: &AppState,
    vault_id: &str,
    relative_path: Option<&str>,
    requested_mode: &str,
    caller_hwnd: Option<isize>,
) -> AppResult<OpenVaultResult> {
    if state
        .open_in_flight
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::Acquire,
            std::sync::atomic::Ordering::Relaxed,
        )
        .is_err()
    {
        return Err(message("已有仓库打开请求正在处理，请稍候"));
    }
    struct OpenGuard<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for OpenGuard<'_> {
        fn drop(&mut self) {
            self.0.store(false, std::sync::atomic::Ordering::Release);
        }
    }
    let _guard = OpenGuard(&state.open_in_flight);
    let started = Instant::now();
    let (vault, configured_policy, catalog_vaults) = {
        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        let vault = db::get_vault(&connection, vault_id)?.ok_or_else(|| message("仓库不存在"))?;
        let catalog_vaults = db::list_vaults(&connection)?;
        let policy = state
            .preferences
            .lock()
            .map_err(|_| message("偏好设置锁已损坏"))?
            .switch_policy
            .clone();
        (vault, policy, catalog_vaults)
    };
    if vault.health != "healthy" || !Path::new(&vault.path).join(".obsidian").is_dir() {
        return Err(message("仓库路径无效，无法打开"));
    }
    if vault.obsidian_id.as_deref().is_none_or(|id| id.is_empty()) {
        return Err(message(
            "此文件夹尚未在 Obsidian 登记。请先在 Obsidian 中将其作为仓库打开，再扫描后重试。",
        ));
    }
    let registered = crate::vaults::registered_vault_path(vault.obsidian_id.as_deref().unwrap())?
        .ok_or_else(|| message("Obsidian 已不再登记此仓库，请重新扫描"))?;
    if !crate::util::normalize_path(&registered)
        .eq_ignore_ascii_case(&crate::util::normalize_path(Path::new(&vault.path)))
    {
        return Err(message("仓库登记路径已变化，请重新扫描后再打开"));
    }
    if let Some(relative) = relative_path {
        validate_note_path(Path::new(&vault.path), relative)?;
    }
    if !["configured", "single", "additive", "native"].contains(&requested_mode) {
        return Err(message("打开模式无效"));
    }
    let effective_mode = match requested_mode {
        "single" => "single",
        "additive" => "additive",
        "native" => "native",
        _ if configured_policy == "single" => "single",
        _ if configured_policy == "native" => "native",
        _ => "additive",
    };

    #[cfg(windows)]
    let native_windows = crate::windows_desktop::obsidian_windows();
    #[cfg(not(windows))]
    let native_windows: Vec<()> = Vec::new();

    #[cfg(windows)]
    let mut target_windows: Vec<_> = native_windows
        .iter()
        .filter(|window| crate::windows_desktop::matches_vault(&window.title, &vault.name))
        .cloned()
        .collect();
    #[cfg(not(windows))]
    let mut target_windows: Vec<()> = Vec::new();

    #[cfg(windows)]
    if !target_windows.is_empty()
        && catalog_vaults
            .iter()
            .filter(|item| item.name.eq_ignore_ascii_case(&vault.name))
            .count()
            > 1
    {
        return Err(message(format!(
            "存在多个名为 {} 的仓库，无法安全识别其窗口",
            vault.name
        )));
    }

    #[cfg(windows)]
    if target_windows.iter().any(|window| {
        catalog_vaults
            .iter()
            .filter(|candidate| {
                crate::windows_desktop::matches_vault(&window.title, &candidate.name)
            })
            .count()
            != 1
    }) {
        return Err(message(
            "窗口标题匹配了多个仓库，已取消操作以避免关闭错误窗口",
        ));
    }

    let mut closed_vault_ids = Vec::new();
    let mut reopened_cross_desktop = false;
    // A repository is considered open only when a real Obsidian window is
    // discoverable. The registry's `open` bit is historical and may linger
    // after a window has closed.
    let mut target_is_open = !target_windows.is_empty();

    #[cfg(windows)]
    let target_desktop = caller_hwnd.and_then(|hwnd| crate::windows_desktop::desktop_id(hwnd).ok());
    #[cfg(windows)]
    let current_target_windows: Vec<_> = if let Some(desktop) = target_desktop.as_ref() {
        let mut current = Vec::new();
        for window in &target_windows {
            if crate::windows_desktop::desktop_id(window.hwnd)? == *desktop {
                current.push(window.clone());
            }
        }
        current
    } else {
        Vec::new()
    };
    #[cfg(windows)]
    let mut target_on_current_desktop = !current_target_windows.is_empty();
    #[cfg(windows)]
    let target_only_on_other_desktop = effective_mode != "native"
        && !target_windows.is_empty()
        && target_desktop.is_some()
        && !target_on_current_desktop;

    #[cfg(windows)]
    if effective_mode != "native" && !target_windows.is_empty() && target_desktop.is_none() {
        return Err(message(
            "无法确定 ChatObsidian 当前所在的 Windows 桌面，已取消跨桌面操作",
        ));
    }

    if effective_mode != "native" && is_running() {
        #[cfg(windows)]
        {
            let close_scope = managed_close_scope(effective_mode, target_only_on_other_desktop);
            let windows_to_close: Vec<_> = match close_scope {
                CloseScope::All => native_windows.clone(),
                CloseScope::Others => native_windows
                    .iter()
                    .filter(|window| {
                        !crate::windows_desktop::matches_vault(&window.title, &vault.name)
                    })
                    .cloned()
                    .collect(),
                CloseScope::Target => target_windows.clone(),
                CloseScope::None => Vec::new(),
            };

            for candidate in &catalog_vaults {
                if windows_to_close.iter().any(|window| {
                    crate::windows_desktop::matches_vault(&window.title, &candidate.name)
                }) {
                    closed_vault_ids.push(candidate.id.clone());
                }
            }
            if !windows_to_close.is_empty() {
                crate::windows_desktop::close_windows(&windows_to_close)?;
                let deadline = Instant::now() + Duration::from_secs(15);
                loop {
                    let remaining = crate::windows_desktop::obsidian_windows();
                    let still_open = match close_scope {
                        CloseScope::All => !remaining.is_empty(),
                        CloseScope::Target => remaining.iter().any(|window| {
                            crate::windows_desktop::matches_vault(&window.title, &vault.name)
                        }),
                        CloseScope::Others => remaining.iter().any(|window| {
                            !crate::windows_desktop::matches_vault(&window.title, &vault.name)
                        }),
                        CloseScope::None => false,
                    };
                    if !still_open {
                        break;
                    }
                    if Instant::now() >= deadline {
                        return Err(message("OBSIDIAN_CLOSE_TIMEOUT"));
                    }
                    thread::sleep(Duration::from_millis(50));
                }
            }
            if target_only_on_other_desktop {
                target_windows.clear();
                target_is_open = false;
                target_on_current_desktop = false;
                reopened_cross_desktop = true;
            }
        }
        #[cfg(not(windows))]
        if effective_mode == "single" {
            return Err(message("窗口管理仅支持 Windows"));
        }
    }

    let moved_window_count = 0;
    let action;
    #[cfg(windows)]
    {
        if reopened_cross_desktop {
            if let Some(hwnd) = caller_hwnd {
                crate::windows_desktop::focus_window(hwnd);
            }
            let uri = vault_uri(&vault, relative_path);
            open::that_detached(&uri).map_err(|error| {
                message(format!("无法在当前桌面重新打开 Obsidian 仓库：{error}"))
            })?;
            action = "reopened";
        } else if effective_mode != "native" && target_is_open && target_on_current_desktop {
            if relative_path.is_some() {
                crate::windows_desktop::focus_largest(&current_target_windows);
                let uri = vault_uri(&vault, relative_path);
                open::that_detached(&uri)
                    .map_err(|error| message(format!("无法调用 Obsidian URI：{error}")))?;
            } else {
                crate::windows_desktop::focus_largest(&current_target_windows);
            }
            action = "focused";
        } else {
            let uri = vault_uri(&vault, relative_path);
            open::that_detached(&uri)
                .map_err(|error| message(format!("无法调用 Obsidian URI：{error}")))?;
            action = if target_is_open {
                "focused"
            } else {
                "dispatched"
            };
        }
    }
    #[cfg(not(windows))]
    {
        let uri = vault_uri(&vault, relative_path);
        open::that_detached(&uri)
            .map_err(|error| message(format!("无法调用 Obsidian URI：{error}")))?;
        action = if target_is_open {
            "focused"
        } else {
            "dispatched"
        };
    }
    let operation = OperationRecord {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "open".into(),
        title: format!("打开 {}", vault.display_name),
        status: "success".into(),
        detail: format!(
            "{}；模式={}；动作={}；移动窗口={}；关闭仓库={}；请求耗时={}ms",
            relative_path
                .map(|path| format!("打开笔记：{path}"))
                .unwrap_or_else(|| "仓库切换请求已发送".into()),
            effective_mode,
            action,
            moved_window_count,
            closed_vault_ids.len(),
            started.elapsed().as_millis(),
        ),
        created_at: now_millis(),
        finished_at: Some(now_millis()),
        can_rollback: false,
        log_path: None,
    };
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    if effective_mode == "single" {
        connection.execute(
            "UPDATE vaults SET is_open=CASE WHEN id=?1 THEN 1 ELSE 0 END,last_opened=CASE WHEN id=?1 THEN ?2 ELSE last_opened END",
            params![vault.id, now_millis()],
        )?;
    } else {
        connection.execute(
            "UPDATE vaults SET is_open=1,last_opened=?1 WHERE id=?2",
            params![now_millis(), vault.id],
        )?;
    }
    db::save_operation(&connection, &operation)?;
    Ok(OpenVaultResult {
        action: action.into(),
        effective_mode: effective_mode.into(),
        moved_window_count,
        closed_vault_ids,
    })
}

fn vault_uri(vault: &VaultRecord, relative_path: Option<&str>) -> String {
    // open_vault rejects unregistered folders before performing any window action.
    let vault_ref = vault.obsidian_id.as_deref().unwrap_or_default();
    let mut uri = format!(
        "obsidian://open?vault={}",
        utf8_percent_encode(vault_ref, NON_ALPHANUMERIC)
    );
    if let Some(path) = relative_path {
        uri.push_str("&file=");
        uri.push_str(&utf8_percent_encode(path, NON_ALPHANUMERIC).to_string());
    }
    uri
}

fn validate_note_path(vault: &Path, relative: &str) -> AppResult<()> {
    let path = safe_relative_path(relative)?;
    let target = vault.join(path);
    if relative.is_empty()
        || relative.contains(['#', '^'])
        || !target.is_file()
        || !is_within(&target, vault)
        || target
            .extension()
            .and_then(|s| s.to_str())
            .is_none_or(|s| !s.eq_ignore_ascii_case("md"))
    {
        return Err(message("笔记必须是仓库内已有的 Markdown 文件"));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn close_scope_matches_managed_cross_desktop_policy() {
        assert_eq!(managed_close_scope("additive", true), CloseScope::Target);
        assert_eq!(managed_close_scope("additive", false), CloseScope::None);
        assert_eq!(managed_close_scope("single", true), CloseScope::All);
        assert_eq!(managed_close_scope("single", false), CloseScope::Others);
        assert_eq!(managed_close_scope("native", true), CloseScope::None);
    }
    #[test]
    fn note_validation_rejects_traversal_and_non_markdown() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("safe.md"), "note").unwrap();
        std::fs::write(root.join("unsafe.exe"), "data").unwrap();
        assert!(validate_note_path(&root, "safe.md").is_ok());
        assert!(validate_note_path(&root, "../safe.md").is_err());
        assert!(validate_note_path(&root, "unsafe.exe").is_err());
        assert!(validate_note_path(&root, "").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
