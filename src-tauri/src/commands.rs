use crate::db;
use crate::error::{AppResult, message};
use crate::models::*;
use crate::state::AppState;
use crate::{obsidian, scripts, settings, sync_engine, vaults};
use rusqlite::params;
use std::path::Path;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

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
        // Startup must only read the existing catalog. A first-run scan and
        // configuration-change hashing can both touch thousands of files and
        // are scheduled after the shell is painted (see App.load and the
        // periodic check). Keeping them out of this request prevents the
        // loading shell from looking frozen on slow disks or large vaults.
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
            // Hashing is intentionally handled after the first paint by the
            // App-level single-flight polling effect. Returning a notice here
            // would make every cold start wait on filesystem I/O.
            pending_change: None,
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
pub fn update_vault(state: State<'_, AppState>, input: UpdateVaultInput) -> AppResult<()> {
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    if let Some(value) = input.display_name {
        connection.execute(
            "UPDATE vaults SET display_name=?1,updated_at=?2 WHERE id=?3",
            params![value, crate::util::now_millis(), input.id],
        )?;
    }
    if let Some(value) = input.group_name {
        connection.execute("INSERT OR IGNORE INTO groups(id,name,order_index,collapsed) VALUES(?1,?2,(SELECT COUNT(*) FROM groups),0)", params![format!("g_{}", crate::util::stable_id(&value)),value])?;
        connection.execute(
            "UPDATE vaults SET group_name=?1,updated_at=?2 WHERE id=?3",
            params![value, crate::util::now_millis(), input.id],
        )?;
    }
    if let Some(value) = input.tags {
        connection.execute(
            "UPDATE vaults SET tags_json=?1 WHERE id=?2",
            params![serde_json::to_string(&value)?, input.id],
        )?;
    }
    if let Some(value) = input.favorite {
        connection.execute(
            "UPDATE vaults SET favorite=?1 WHERE id=?2",
            params![value, input.id],
        )?;
    }
    if let Some(value) = input.hidden {
        connection.execute(
            "UPDATE vaults SET hidden=?1 WHERE id=?2",
            params![value, input.id],
        )?;
    }
    if let Some(value) = input.archived {
        connection.execute(
            "UPDATE vaults SET archived=?1 WHERE id=?2",
            params![value, input.id],
        )?;
    }
    if let Some(value) = input.order_index {
        connection.execute(
            "UPDATE vaults SET order_index=?1 WHERE id=?2",
            params![value, input.id],
        )?;
    }
    if let Some(value) = input.excluded_categories {
        connection.execute(
            "UPDATE vaults SET excluded_json=?1 WHERE id=?2",
            params![serde_json::to_string(&value)?, input.id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn reorder_vaults(state: State<'_, AppState>, input: ReorderVaultsInput) -> AppResult<()> {
    let mut connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    let transaction = connection.transaction()?;
    for (index, id) in input.vault_ids.iter().enumerate() {
        transaction.execute(
            "UPDATE vaults SET group_name=?1,order_index=?2 WHERE id=?3",
            params![input.group_name, index as i64, id],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

#[tauri::command]
pub fn reorder_groups(state: State<'_, AppState>, input: ReorderGroupsInput) -> AppResult<()> {
    let mut connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    let transaction = connection.transaction()?;
    for (index, id) in input.group_ids.iter().enumerate() {
        transaction.execute(
            "UPDATE groups SET order_index=?1 WHERE id=?2",
            params![index as i64, id],
        )?;
    }
    transaction.commit()?;
    Ok(())
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
            false,
            &mode,
            caller_hwnd,
        )
    })
    .await
}

#[tauri::command]
pub async fn force_close_and_open(
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
            true,
            &mode,
            caller_hwnd,
        )
    })
    .await
}

#[tauri::command]
pub fn search_notes(
    state: State<'_, AppState>,
    query: String,
    limit: usize,
) -> AppResult<Vec<NoteIndexEntry>> {
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    db::search_notes(&connection, query.trim(), limit.min(100))
}

#[tauri::command]
pub async fn compute_config_diff(app: AppHandle, plan: SyncPlan) -> AppResult<ConfigDiff> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        sync_engine::compute_diff(&state, &plan)
    })
    .await
}

#[tauri::command]
pub async fn apply_sync(app: AppHandle, plan: SyncPlan) -> AppResult<OperationRecord> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        sync_engine::apply(&state, &plan)
    })
    .await
}

#[tauri::command]
pub async fn rollback_operation(
    app: AppHandle,
    operation_id: String,
) -> AppResult<OperationRecord> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        sync_engine::rollback(&state, &operation_id)
    })
    .await
}

#[tauri::command]
pub async fn adopt_vault_config(
    app: AppHandle,
    vault_id: String,
    categories: Vec<String>,
) -> AppResult<OperationRecord> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        sync_engine::adopt_vault(&state, &vault_id, &categories)
    })
    .await
}

#[tauri::command]
pub async fn list_template_plugins(app: AppHandle) -> AppResult<Vec<TemplatePlugin>> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        sync_engine::list_template_plugins(&state)
    })
    .await
}

#[tauri::command]
pub async fn check_active_config_change(app: AppHandle) -> AppResult<Option<ConfigChangeNotice>> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        if state
            .config_check_in_flight
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::Acquire,
                std::sync::atomic::Ordering::Relaxed,
            )
            .is_err()
        {
            return Ok(None);
        }

        struct CheckGuard<'a>(&'a std::sync::atomic::AtomicBool);
        impl Drop for CheckGuard<'_> {
            fn drop(&mut self) {
                self.0
                    .store(false, std::sync::atomic::Ordering::Release);
            }
        }
        let _guard = CheckGuard(&state.config_check_in_flight);
        obsidian::check_active_change(&state)
    })
    .await
}

#[tauri::command]
pub fn dismiss_config_change(state: State<'_, AppState>, vault_id: String) -> AppResult<()> {
    obsidian::dismiss_change(&state, &vault_id)
}

#[tauri::command]
pub fn list_scripts(state: State<'_, AppState>) -> AppResult<Vec<ScriptTool>> {
    scripts::list(&state)
}

#[tauri::command]
pub fn preview_script_run(
    state: State<'_, AppState>,
    script_id: String,
) -> AppResult<ScriptRunPreview> {
    scripts::preview(&state, &script_id)
}

#[tauri::command]
pub fn run_script(state: State<'_, AppState>, script_id: String) -> AppResult<OperationRecord> {
    scripts::run(&state, &script_id)
}

#[tauri::command]
pub fn refresh_script_runs(state: State<'_, AppState>) -> AppResult<Vec<OperationRecord>> {
    scripts::refresh(&state)
}

#[tauri::command]
pub fn list_operations(state: State<'_, AppState>) -> AppResult<Vec<OperationRecord>> {
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    db::list_operations(&connection, 200)
}

#[tauri::command]
pub fn save_preferences(
    app: AppHandle,
    state: State<'_, AppState>,
    preferences: AppPreferences,
) -> AppResult<AppPreferences> {
    if preferences.scan_roots.is_empty() {
        return Err(message("至少保留一个扫描根目录"));
    }
    if preferences.template_path.trim().is_empty() {
        return Err(message("模板路径不能为空"));
    }
    if !(1..=365).contains(&preferences.backup_retention_days) {
        return Err(message("备份保留天数必须在 1–365 之间"));
    }
    if !(1..=200).contains(&preferences.backup_retention_count) {
        return Err(message("备份保留操作数必须在 1–200 之间"));
    }
    let mut current = state
        .preferences
        .lock()
        .map_err(|_| message("偏好设置锁已损坏"))?;
    let previous = current.clone();
    validate_shortcuts(&preferences.shortcuts)?;
    let shortcuts_changed = previous.shortcuts != preferences.shortcuts;
    let autostart_changed = previous.launch_at_startup != preferences.launch_at_startup;
    let capture_active = state
        .shortcut_capture
        .load(std::sync::atomic::Ordering::Relaxed);

    if shortcuts_changed || capture_active {
        if let Err(error) = crate::register_shortcuts(&app, &preferences.shortcuts) {
            let _ = crate::register_shortcuts(&app, &previous.shortcuts);
            state
                .shortcut_capture
                .store(false, std::sync::atomic::Ordering::Relaxed);
            return Err(error);
        }
    }

    if autostart_changed {
        if let Err(error) = crate::set_launch_at_startup(&app, preferences.launch_at_startup) {
            if shortcuts_changed || capture_active {
                let _ = crate::register_shortcuts(&app, &previous.shortcuts);
            }
            state
                .shortcut_capture
                .store(false, std::sync::atomic::Ordering::Relaxed);
            return Err(error);
        }
    }

    if let Err(error) = settings::save(&state.paths.settings_file, &preferences) {
        if shortcuts_changed || capture_active {
            let _ = crate::register_shortcuts(&app, &previous.shortcuts);
            state
                .shortcut_capture
                .store(false, std::sync::atomic::Ordering::Relaxed);
        }
        if autostart_changed {
            let _ = crate::set_launch_at_startup(&app, previous.launch_at_startup);
        }
        return Err(error);
    }

    *current = preferences.clone();
    state
        .shortcut_capture
        .store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(preferences)
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
pub fn begin_shortcut_capture(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| message(format!("无法暂停全局快捷键：{error}")))?;
    state
        .shortcut_capture
        .store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn cancel_shortcut_capture(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let bindings = state
        .preferences
        .lock()
        .map_err(|_| message("偏好设置锁已损坏"))?
        .shortcuts
        .clone();
    crate::register_shortcuts(&app, &bindings)?;
    state
        .shortcut_capture
        .store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn select_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_local_path(state: State<'_, AppState>, path: String) -> AppResult<()> {
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
    open::that_detached(requested).map_err(|error| message(format!("无法打开路径：{error}")))?;
    Ok(())
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
