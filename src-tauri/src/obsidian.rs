use crate::db;
use crate::error::{AppResult, message};
use crate::models::{ConfigChangeNotice, OpenVaultResult, OperationRecord, VaultRecord};
use crate::state::AppState;
use crate::util::{file_hash, now_millis};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use rusqlite::{OptionalExtension, params};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};
use walkdir::WalkDir;

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
    force: bool,
    requested_mode: &str,
    caller_hwnd: Option<isize>,
) -> AppResult<OpenVaultResult> {
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
    if vault.health != "healthy" {
        return Err(message("仓库路径无效，无法打开"));
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
    let mut native_windows = crate::windows_desktop::obsidian_windows();
    #[cfg(not(windows))]
    let mut native_windows: Vec<()> = Vec::new();

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

    let mut closed_vault_ids = Vec::new();
    let mut reopened_cross_desktop = false;
    // A repository is considered open only when a real Obsidian window is
    // discoverable. The registry's `open` bit is historical and may linger
    // after a window has closed.
    let mut target_is_open = !force && !target_windows.is_empty();

    #[cfg(windows)]
    let target_desktop = caller_hwnd.and_then(|hwnd| crate::windows_desktop::desktop_id(hwnd).ok());
    #[cfg(windows)]
    let current_target_windows: Vec<_> = target_desktop
        .as_ref()
        .map(|desktop| {
            target_windows
                .iter()
                .filter(|window| crate::windows_desktop::is_on_desktop(window, desktop))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
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

    if force && effective_mode != "native" {
        #[cfg(windows)]
        for candidate in &catalog_vaults {
            if native_windows
                .iter()
                .any(|window| crate::windows_desktop::matches_vault(&window.title, &candidate.name))
            {
                closed_vault_ids.push(candidate.id.clone());
            }
        }
        force_close()?;
        native_windows.clear();
        target_windows.clear();
        target_is_open = false;
        reopened_cross_desktop = true;
        #[cfg(windows)]
        {
            target_on_current_desktop = false;
        }
    } else if effective_mode != "native" && is_running() {
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
            request_normal_close()?;
            if !wait_until_closed(Duration::from_secs(15)) {
                return Err(message("OBSIDIAN_CLOSE_TIMEOUT"));
            }
            target_is_open = false;
        }
    }

    let snapshot = if target_is_open {
        None
    } else {
        Some(cached_managed_hashes(state, &vault)?)
    };
    if let Some((hashes, _)) = &snapshot {
        save_snapshot(state, &vault, hashes.clone())?;
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
            "{}；模式={}；动作={}；移动窗口={}；关闭仓库={}；请求耗时={}ms；配置快照={}",
            relative_path
                .map(|path| format!("打开笔记：{path}"))
                .unwrap_or_else(|| "仓库切换请求已发送".into()),
            effective_mode,
            action,
            moved_window_count,
            closed_vault_ids.len(),
            started.elapsed().as_millis(),
            match snapshot {
                None => "已打开仓库，跳过",
                Some((_, true)) => "缓存命中",
                Some((_, false)) => "重新计算",
            }
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
    let vault_ref = vault.obsidian_id.as_deref().unwrap_or(&vault.name);
    let mut uri = format!(
        "obsidian://open?vault={}",
        utf8_percent_encode(vault_ref, NON_ALPHANUMERIC)
    );
    if let Some(path) = relative_path {
        uri.push_str("&file=");
        uri.push_str(
            &utf8_percent_encode(path.trim_end_matches(".md"), NON_ALPHANUMERIC).to_string(),
        );
    }
    uri
}

#[cfg(not(windows))]
pub fn request_normal_close() -> AppResult<()> {
    let script = "Get-Process -Name Obsidian -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }";
    Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags_no_window()
        .status()?;
    Ok(())
}

pub fn force_close() -> AppResult<()> {
    Command::new("taskkill")
        .args(["/IM", "Obsidian.exe", "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags_no_window()
        .status()?;
    if !wait_until_closed(Duration::from_secs(5)) {
        return Err(message("强制关闭 Obsidian 失败"));
    }
    Ok(())
}

fn wait_until_closed(timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if !is_running() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    !is_running()
}

fn save_snapshot(
    state: &AppState,
    vault: &VaultRecord,
    hashes: BTreeMap<String, String>,
) -> AppResult<()> {
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    connection.execute(
        "INSERT OR REPLACE INTO config_snapshots(vault_id,vault_name,hashes_json,created_at,dismissed) VALUES(?1,?2,?3,?4,0)",
        params![vault.id, vault.display_name, serde_json::to_string(&hashes)?, now_millis()],
    )?;
    Ok(())
}

pub fn check_active_change(state: &AppState) -> AppResult<Option<ConfigChangeNotice>> {
    if is_running() {
        return Ok(None);
    }
    let snapshot = {
        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        connection.query_row(
            "SELECT s.vault_id,s.vault_name,s.hashes_json,v.path FROM config_snapshots s JOIN vaults v ON v.id=s.vault_id WHERE s.dismissed=0 ORDER BY s.created_at DESC LIMIT 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?)),
        ).optional()?
    };
    let Some((vault_id, vault_name, hashes_json, path)) = snapshot else {
        return Ok(None);
    };
    let previous: BTreeMap<String, String> = serde_json::from_str(&hashes_json)?;
    let current = managed_hashes(&Path::new(&path).join(".obsidian"))?;
    let mut changed = Vec::new();
    for key in previous.keys().chain(current.keys()) {
        if previous.get(key) != current.get(key) && !changed.contains(key) {
            changed.push(key.clone());
        }
    }
    if changed.is_empty() {
        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        connection.execute(
            "UPDATE config_snapshots SET dismissed=1 WHERE vault_id=?1",
            params![vault_id],
        )?;
        return Ok(None);
    }
    Ok(Some(ConfigChangeNotice {
        vault_id,
        vault_name,
        changed_paths: changed,
        checked_at: now_millis(),
    }))
}

pub fn dismiss_change(state: &AppState, vault_id: &str) -> AppResult<()> {
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    connection.execute(
        "UPDATE config_snapshots SET dismissed=1 WHERE vault_id=?1",
        params![vault_id],
    )?;
    Ok(())
}

pub fn pending_change(state: &AppState) -> AppResult<Option<ConfigChangeNotice>> {
    check_active_change(state)
}

pub fn managed_hashes(obsidian_dir: &Path) -> AppResult<BTreeMap<String, String>> {
    let mut hashes = BTreeMap::new();
    if !obsidian_dir.is_dir() {
        return Ok(hashes);
    }
    for entry in WalkDir::new(obsidian_dir)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(obsidian_dir)
            .unwrap_or(entry.path());
        let text = relative.to_string_lossy().replace('\\', "/");
        if !is_managed_config_path(&text) {
            continue;
        }
        hashes.insert(text, file_hash(entry.path())?);
    }
    Ok(hashes)
}

fn is_managed_config_path(relative: &str) -> bool {
    relative != "workspace.json"
        && relative != "workspaces.json"
        && !relative.ends_with("/data.json")
}

fn managed_fingerprint(obsidian_dir: &Path) -> AppResult<String> {
    let mut entries = Vec::new();
    if obsidian_dir.is_dir() {
        for entry in WalkDir::new(obsidian_dir)
            .follow_links(false)
            .into_iter()
            .flatten()
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(obsidian_dir)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .replace('\\', "/");
            if !is_managed_config_path(&relative) {
                continue;
            }
            let metadata = std::fs::metadata(entry.path())?;
            let modified = metadata
                .modified()?
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            entries.push((relative, metadata.len(), modified));
        }
    }
    entries.sort_unstable_by(|left, right| left.0.cmp(&right.0));
    let mut hasher = Sha256::new();
    for (relative, length, modified) in entries {
        hasher.update(relative.as_bytes());
        hasher.update([0]);
        hasher.update(length.to_le_bytes());
        hasher.update(modified.to_le_bytes());
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn cached_managed_hashes(
    state: &AppState,
    vault: &VaultRecord,
) -> AppResult<(BTreeMap<String, String>, bool)> {
    let config_dir = Path::new(&vault.path).join(".obsidian");
    let fingerprint = managed_fingerprint(&config_dir)?;
    let cached = {
        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        connection
            .query_row(
                "SELECT hashes_json FROM config_hash_cache WHERE vault_id=?1 AND fingerprint=?2",
                params![vault.id, fingerprint],
                |row| row.get::<_, String>(0),
            )
            .optional()?
    };
    if let Some(hashes_json) = cached {
        return Ok((serde_json::from_str(&hashes_json)?, true));
    }

    let hashes = managed_hashes(&config_dir)?;
    let stable_fingerprint = managed_fingerprint(&config_dir)?;
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    connection.execute(
        "INSERT OR REPLACE INTO config_hash_cache(vault_id,fingerprint,hashes_json,updated_at) VALUES(?1,?2,?3,?4)",
        params![
            vault.id,
            stable_fingerprint,
            serde_json::to_string(&hashes)?,
            now_millis()
        ],
    )?;
    Ok((hashes, false))
}

pub fn prewarm_hash_cache(state: &AppState) -> AppResult<()> {
    let mut vaults = {
        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        db::list_vaults(&connection)?
    };
    vaults.retain(|vault| vault.health == "healthy" && !vault.is_template);
    vaults.sort_by(|left, right| {
        right
            .is_open
            .cmp(&left.is_open)
            .then_with(|| right.favorite.cmp(&left.favorite))
            .then_with(|| right.last_opened.cmp(&left.last_opened))
    });
    for vault in vaults {
        if state.exiting.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        let _ = cached_managed_hashes(state, &vault);
    }
    Ok(())
}

#[cfg(windows)]
trait CommandWindowsExt {
    fn creation_flags_no_window(&mut self) -> &mut Self;
}

#[cfg(windows)]
impl CommandWindowsExt for Command {
    fn creation_flags_no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(0x08000000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AppPreferences;
    use crate::state::AppPaths;
    use std::sync::{Mutex, atomic::AtomicBool};

    fn vault(path: &str, obsidian_id: Option<&str>) -> VaultRecord {
        VaultRecord {
            id: "test".into(),
            obsidian_id: obsidian_id.map(String::from),
            path: path.into(),
            name: "test".into(),
            display_name: "Test".into(),
            group_name: "Test".into(),
            tags: Vec::new(),
            favorite: false,
            hidden: false,
            archived: false,
            order_index: 0,
            note_count: 0,
            last_opened: None,
            is_open: false,
            health: "healthy".into(),
            config_state: "synced".into(),
            is_template: false,
            excluded_categories: Vec::new(),
        }
    }

    #[test]
    fn normal_uri_encodes_note_without_popup_parameter() {
        let uri = vault_uri(
            &vault("C:\\Notes\\Active", Some("abc")),
            Some("目录/当前笔记.md"),
        );
        assert!(!uri.contains("paneType"));
        assert!(uri.contains("file="));
        assert!(uri.contains("%E7%9B%AE%E5%BD%95"));
    }

    #[test]
    fn close_scope_matches_managed_cross_desktop_policy() {
        assert_eq!(managed_close_scope("additive", true), CloseScope::Target);
        assert_eq!(managed_close_scope("additive", false), CloseScope::None);
        assert_eq!(managed_close_scope("single", true), CloseScope::All);
        assert_eq!(managed_close_scope("single", false), CloseScope::Others);
        assert_eq!(managed_close_scope("native", true), CloseScope::None);
    }

    #[test]
    fn config_hash_cache_hits_and_invalidates_on_metadata_change() {
        let root = std::env::temp_dir().join(format!(
            "chatobsidian-config-cache-{}",
            uuid::Uuid::new_v4()
        ));
        let vault_dir = root.join("中文仓库");
        let config_dir = vault_dir.join(".obsidian");
        std::fs::create_dir_all(&config_dir).unwrap();
        let config_file = config_dir.join("app.json");
        std::fs::write(&config_file, br#"{"value":1}"#).unwrap();

        let database_file = root.join("catalog.sqlite");
        let connection = db::open(&database_file).unwrap();
        let record = vault(vault_dir.to_str().unwrap(), Some("cache-test"));
        db::upsert_vault(&connection, &record, now_millis()).unwrap();
        let state = AppState {
            db: Mutex::new(connection),
            preferences: Mutex::new(AppPreferences::default_for_home(&root)),
            paths: AppPaths {
                config_dir: root.join("config"),
                local_dir: root.clone(),
                backup_dir: root.join("backups"),
                log_dir: root.join("logs"),
                runtime_dir: root.join("runtime"),
                settings_file: root.join("settings.json"),
                database_file,
            },
            exiting: AtomicBool::new(false),
            shortcut_capture: AtomicBool::new(false),
        };

        let (first, first_hit) = cached_managed_hashes(&state, &record).unwrap();
        let (second, second_hit) = cached_managed_hashes(&state, &record).unwrap();
        assert!(!first_hit);
        assert!(second_hit);
        assert_eq!(first, second);

        std::thread::sleep(Duration::from_millis(10));
        std::fs::write(&config_file, br#"{"value":200}"#).unwrap();
        let (third, third_hit) = cached_managed_hashes(&state, &record).unwrap();
        assert!(!third_hit);
        assert_ne!(second, third);

        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "只读测量当前 Windows 用户的真实仓库配置快照性能"]
    fn local_snapshot_performance_is_read_only() {
        let registry = Path::new(&std::env::var("APPDATA").unwrap())
            .join("obsidian")
            .join("obsidian.json");
        let root: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(registry).unwrap()).unwrap();
        let vaults = root["vaults"].as_object().unwrap();
        for entry in vaults.values() {
            let Some(path) = entry.get("path").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let config = Path::new(path).join(".obsidian");
            if !config.is_dir() {
                continue;
            }
            let fingerprint_started = Instant::now();
            let _ = managed_fingerprint(&config).unwrap();
            let fingerprint_ms = fingerprint_started.elapsed().as_micros() as f64 / 1000.0;
            let started = Instant::now();
            let hashes = managed_hashes(&config).unwrap();
            println!(
                "fingerprint_ms={fingerprint_ms:.3} snapshot_ms={} files={} path={}",
                started.elapsed().as_millis(),
                hashes.len(),
                path
            );
        }

        let started = Instant::now();
        for _ in 0..100 {
            let _ = is_running();
        }
        println!(
            "native_process_check_avg_ms={:.3}",
            started.elapsed().as_micros() as f64 / 100_000.0
        );
    }
}

#[cfg(not(windows))]
trait CommandWindowsExt {
    fn creation_flags_no_window(&mut self) -> &mut Self;
}

#[cfg(not(windows))]
impl CommandWindowsExt for Command {
    fn creation_flags_no_window(&mut self) -> &mut Self {
        self
    }
}
