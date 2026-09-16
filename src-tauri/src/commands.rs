use crate::db;
use crate::error::{AppResult, message};
use crate::models::*;
use crate::state::AppState;
use crate::{obsidian, settings, vaults, workspace};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::Shortcut;

async fn run_blocking<T, F>(task: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| message(format!("后台任务异常结束：{error}")))?
}

#[tauri::command]
pub async fn get_dashboard(app: AppHandle) -> AppResult<DashboardData> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        // Render the catalog before a first-run directory scan.
        let _ = vaults::refresh_registered_metadata(&connection);
        {
            vaults::refresh_runtime_status(&connection)?;
        }
        let (vaults, groups, operations) = {
            (
                db::list_vaults(&connection)?,
                db::list_groups(&connection)?,
                db::list_operations(&connection, 100)?,
            )
        };
        Ok(DashboardData {
            vaults,
            groups,
            operations,
            preferences: state
                .preferences
                .lock()
                .map_err(|_| message("偏好设置锁已损坏"))?
                .clone(),
        })
    })
    .await
}

#[tauri::command]
pub async fn scan_vaults(app: AppHandle) -> AppResult<ScanResult> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        let preferences = state
            .preferences
            .lock()
            .map_err(|_| message("偏好设置锁已损坏"))?
            .clone();
        let mut connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        let mut result = vaults::scan(&mut connection, &preferences)?;
        vaults::refresh_runtime_status(&connection)?;
        result.vaults = db::list_vaults(&connection)?;
        result.groups = db::list_groups(&connection)?;
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn refresh_quick_switcher(
    app: AppHandle,
    refresh_notes: bool,
) -> AppResult<QuickSwitcherRefresh> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        let mut connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        let preferences = state
            .preferences
            .lock()
            .map_err(|_| message("偏好设置锁已损坏"))?
            .clone();

        // Registry metadata is cheap and picks up directory/display-name changes.
        // A missing or temporarily locked registry must not make the quick
        // switcher unusable; the catalog and real window state still work.
        let _ = vaults::refresh_registered_metadata(&connection);
        if refresh_notes {
            let _ = vaults::refresh_scan_root_metadata(&connection, &preferences);
        }
        vaults::refresh_runtime_status(&connection)?;
        let indexed_notes = if refresh_notes {
            vaults::refresh_note_index(&mut connection)?
        } else {
            db::list_vaults(&connection)?
                .into_iter()
                .map(|vault| vault.note_count.max(0) as usize)
                .sum()
        };
        let vaults = db::list_vaults(&connection)?;
        Ok(QuickSwitcherRefresh {
            vaults,
            groups: db::list_groups(&connection)?,
            indexed_notes,
            refreshed_at: crate::util::now_millis(),
        })
    })
    .await
}

#[tauri::command]
pub async fn open_vault(
    app: AppHandle,
    window: tauri::WebviewWindow,
    vault_id: String,
    relative_path: Option<String>,
    mode: String,
) -> AppResult<OpenVaultResult> {
    #[cfg(windows)]
    let caller_hwnd = window.hwnd().ok().map(|hwnd| hwnd.0 as isize);
    #[cfg(not(windows))]
    let caller_hwnd = None;
    run_blocking(move || {
        let state = app.state::<AppState>();
        obsidian::open_vault(
            &state,
            &vault_id,
            relative_path.as_deref(),
            &mode,
            caller_hwnd,
        )
    })
    .await
}

#[tauri::command]
pub async fn search_notes(
    app: AppHandle,
    query: String,
    limit: usize,
) -> AppResult<Vec<NoteIndexEntry>> {
    run_blocking(move || {
        let state = app.state::<AppState>();

        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        db::search_notes(&connection, query.trim(), limit.min(100))
    })
    .await
}

#[tauri::command]
pub async fn list_operations(app: AppHandle) -> AppResult<Vec<OperationRecord>> {
    run_blocking(move || {
        let state = app.state::<AppState>();

        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        db::list_operations(&connection, 200)
    })
    .await
}

#[tauri::command]
pub async fn save_preferences(
    app: AppHandle,
    preferences: AppPreferences,
) -> AppResult<AppPreferences> {
    run_blocking(move || {
        let state = app.state::<AppState>();

        if preferences.scan_roots.is_empty() {
            return Err(message("至少保留一个扫描根目录"));
        }
        if !["light", "dark", "system"].contains(&preferences.theme.as_str())
            || !["single", "additive", "native"].contains(&preferences.switch_policy.as_str())
        {
            return Err(message("主题或打开模式无效"));
        }
        let mut current = state
            .preferences
            .lock()
            .map_err(|_| message("偏好设置锁已损坏"))?;
        let previous = current.clone();
        validate_shortcuts(&preferences.shortcuts)?;
        let shortcuts_changed = previous.shortcuts != preferences.shortcuts;
        let autostart_changed = previous.launch_at_startup != preferences.launch_at_startup;
        if shortcuts_changed {
            if let Err(error) = crate::register_shortcuts(&app, &preferences.shortcuts) {
                let _ = crate::register_shortcuts(&app, &previous.shortcuts);
                return Err(error);
            }
        }

        if autostart_changed {
            if let Err(error) = crate::set_launch_at_startup(&app, preferences.launch_at_startup) {
                if shortcuts_changed {
                    let _ = crate::register_shortcuts(&app, &previous.shortcuts);
                }
                return Err(error);
            }
        }

        if let Err(error) = settings::save(&state.paths.settings_file, &preferences) {
            if shortcuts_changed {
                let _ = crate::register_shortcuts(&app, &previous.shortcuts);
            }
            if autostart_changed {
                let _ = crate::set_launch_at_startup(&app, previous.launch_at_startup);
            }
            return Err(error);
        }

        *current = preferences.clone();
        let _ = app.emit("preferences-changed", &preferences);
        Ok(preferences)
    })
    .await
}

fn validate_shortcuts(bindings: &ShortcutBindings) -> AppResult<()> {
    let values = [
        &bindings.show_vault_center,
        &bindings.single_open,
        &bindings.additive_open,
    ];
    let parsed = values
        .iter()
        .map(|value| {
            value
                .parse::<Shortcut>()
                .map_err(|error| message(format!("快捷键 {value} 无效：{error}")))
        })
        .collect::<AppResult<Vec<_>>>()?;
    if parsed[0].id() == parsed[1].id()
        || parsed[0].id() == parsed[2].id()
        || parsed[1].id() == parsed[2].id()
    {
        return Err(message("三个全局快捷键不能重复"));
    }
    Ok(())
}

#[tauri::command]
pub async fn select_directory() -> AppResult<Option<String>> {
    run_blocking(|| {
        Ok(rfd::FileDialog::new()
            .pick_folder()
            .map(|path| path.to_string_lossy().to_string()))
    })
    .await
}

#[tauri::command]
pub async fn open_local_path(app: AppHandle, path: String) -> AppResult<()> {
    run_blocking(move || {
        let state = app.state::<AppState>();

        let requested = Path::new(&path);
        let vaults = {
            let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
            db::list_vaults(&connection)?
        };
        let allowed = crate::util::is_within(requested, &state.paths.local_dir)
            || crate::util::is_within(requested, &state.paths.config_dir)
            || vaults
                .iter()
                .any(|vault| crate::util::is_within(requested, Path::new(&vault.path)));
        if !allowed {
            return Err(message("拒绝打开未登记的本地路径"));
        }
        if !requested.is_dir() {
            return Err(message("只允许在资源管理器中打开目录"));
        }
        open::that_detached(requested)
            .map_err(|error| message(format!("无法打开路径：{error}")))?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn show_quick_switcher(app: AppHandle, mode: Option<String>) -> AppResult<()> {
    let effective = mode.unwrap_or_else(|| {
        app.state::<AppState>()
            .preferences
            .lock()
            .ok()
            .map(|value| value.switch_policy.clone())
            .unwrap_or_else(|| "additive".into())
    });
    crate::show_quick(&app, &effective)
}

#[tauri::command]
pub fn hide_quick_switcher(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("quick") {
        window.hide().map_err(|error| message(error.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_workspace(app: AppHandle) -> AppResult<workspace::Workspace> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        let mut connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        workspace::load(&mut connection)
    })
    .await
}
#[tauri::command]
pub async fn save_workspace(
    app: AppHandle,
    workspace: workspace::Workspace,
) -> AppResult<workspace::Workspace> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        let mut connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        workspace::save(&mut connection, workspace)
    })
    .await
}

#[tauri::command]
pub async fn export_workspace(app: AppHandle) -> AppResult<Option<String>> {
    run_blocking(move || {
        let Some(path) = rfd::FileDialog::new().add_filter("JSON 工作台快照", &["json"]).set_file_name("ChatObsidian-workspace.json").save_file() else { return Ok(None); };
        if path.extension().and_then(|v|v.to_str()) != Some("json") { return Err(message("请选择 .json 文件")); }
        let state = app.state::<AppState>();
        let workspace = {
            let mut connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
            let parent = path.parent().ok_or_else(|| message("导出路径无效"))?;
            if crate::util::is_within(parent, &state.paths.config_dir)
                || crate::util::is_within(parent, &state.paths.local_dir) {
                return Err(message("请选择应用数据目录以外的导出位置，以免覆盖设置或数据库文件"));
            }
            if db::list_vaults(&connection)?.iter().any(|v| crate::util::is_within(parent, Path::new(&v.path))) {
                return Err(message("请选择 Obsidian 仓库以外的导出位置"));
            }
            workspace::load(&mut connection)?
        };
        crate::util::write_json_atomic(&path, &serde_json::json!({"format":"chatobsidian.workspace.v1","exportedAt":crate::util::now_millis(),"workspace":workspace}))?;
        Ok(Some(path.to_string_lossy().to_string()))
    }).await
}
