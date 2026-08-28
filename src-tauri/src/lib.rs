mod commands;
mod db;
mod error;
mod models;
mod obsidian;
mod scripts;
mod settings;
mod state;
mod sync_engine;
mod util;
mod vaults;
#[cfg(windows)]
mod windows_desktop;

use crate::error::{AppResult, message};
use crate::state::{AppPaths, AppState};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_window_state::StateFlags;

pub fn run() {
    tauri::Builder::default()
        // This must remain the first plugin: a second launch should wake the
        // existing process before it has a chance to create another window.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|arg| arg == "--background") {
                request_show_main(app, false);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Visibility belongs to ChatObsidian's close-to-tray behavior.
                // Restoring it here can reveal the WebView before React paints.
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let state = app.state::<AppState>();
                        if state.shortcut_capture.load(Ordering::Relaxed) {
                            return;
                        }
                        let bindings = state
                            .preferences
                            .lock()
                            .ok()
                            .map(|value| value.shortcuts.clone());
                        if let Some(bindings) = bindings {
                            let action = shortcut_action(shortcut, &bindings);
                            match action.as_deref() {
                                Some("show") => {
                                    request_show_main(app, true);
                                }
                                Some("single") => {
                                    let _ = show_quick(app, "single");
                                }
                                Some("additive") => {
                                    let _ = show_quick(app, "additive");
                                }
                                _ => {}
                            }
                        }
                    }
                })
                .build(),
        )
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && payload.event() == PageLoadEvent::Finished
                && !background_launch_requested()
            {
                let window = webview.window();
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        })
        .on_tray_icon_event(|app, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                request_show_main(app, false);
            }
        })
        .setup(|app| {
            let config_dir = std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_config_dir()?)
                .join("ChatObsidian");
            let local_dir = std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_local_data_dir()?)
                .join("ChatObsidian");
            let paths = AppPaths {
                settings_file: config_dir.join("settings.json"),
                database_file: local_dir.join("catalog.sqlite"),
                backup_dir: local_dir.join("backups"),
                log_dir: local_dir.join("logs"),
                runtime_dir: local_dir.join("runtime"),
                config_dir,
                local_dir,
            };
            for path in [
                &paths.config_dir,
                &paths.local_dir,
                &paths.backup_dir,
                &paths.log_dir,
                &paths.runtime_dir,
            ] {
                std::fs::create_dir_all(path)?;
            }
            let home = std::env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("C:\\Users\\Administrator"));
            let preferences = settings::load(&paths.settings_file, &home);
            let connection = db::open(&paths.database_file)
                .map_err(|error| tauri::Error::AssetNotFound(error.to_string()))?;
            app.manage(AppState {
                db: std::sync::Mutex::new(connection),
                preferences: std::sync::Mutex::new(preferences.clone()),
                paths,
                exiting: AtomicBool::new(false),
                shortcut_capture: AtomicBool::new(false),
            });
            if let Err(error) = register_shortcuts(app.handle(), &preferences.shortcuts) {
                eprintln!("ChatObsidian global shortcuts are unavailable: {error}");
            }
            if let Err(error) = set_launch_at_startup(app.handle(), preferences.launch_at_startup) {
                eprintln!("ChatObsidian autostart state could not be restored: {error}");
            }
            build_tray(app)?;
            let prewarm_app = app.handle().clone();
            std::thread::spawn(move || {
                // Let the first paint and catalog load win I/O priority, then
                // prepare configuration snapshots for millisecond cache hits.
                std::thread::sleep(std::time::Duration::from_millis(500));
                let state = prewarm_app.state::<AppState>();
                let _ = obsidian::prewarm_hash_cache(&state);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "quick" && matches!(event, WindowEvent::Focused(false)) {
                let _ = window.hide();
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state.exiting.load(Ordering::Relaxed) {
                    return;
                }
                if window.label() == "quick" {
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "main" {
                    let close_to_tray = state
                        .preferences
                        .lock()
                        .map(|preferences| preferences.close_to_tray)
                        .unwrap_or(true);
                    if close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_dashboard,
            commands::scan_vaults,
            commands::refresh_quick_switcher,
            commands::update_vault,
            commands::reorder_vaults,
            commands::reorder_groups,
            commands::open_vault,
            commands::force_close_and_open,
            commands::search_notes,
            commands::compute_config_diff,
            commands::apply_sync,
            commands::rollback_operation,
            commands::adopt_vault_config,
            commands::list_template_plugins,
            commands::check_active_config_change,
            commands::dismiss_config_change,
            commands::list_scripts,
            commands::preview_script_run,
            commands::run_script,
            commands::refresh_script_runs,
            commands::list_operations,
            commands::save_preferences,
            commands::select_directory,
            commands::open_local_path,
            commands::show_quick_switcher,
            commands::hide_quick_switcher,
            commands::begin_shortcut_capture,
            commands::cancel_shortcut_capture,
        ])
        .run(tauri::generate_context!())
        .expect("ChatObsidian failed to start");
}

fn background_launch_requested() -> bool {
    std::env::args().skip(1).any(|arg| arg == "--background")
}

pub(crate) fn set_launch_at_startup(app: &tauri::AppHandle, enabled: bool) -> AppResult<()> {
    let manager = app.autolaunch();
    let current = manager
        .is_enabled()
        .map_err(|error| message(format!("无法读取开机自启状态：{error}")))?;
    if current == enabled {
        return Ok(());
    }
    if enabled {
        manager
            .enable()
            .map_err(|error| message(format!("无法启用开机自启：{error}")))
    } else {
        manager
            .disable()
            .map_err(|error| message(format!("无法关闭开机自启：{error}")))
    }
}

fn build_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示仓库中心", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "快速切换", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "完全退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quick, &quit])?;
    let mut builder = TrayIconBuilder::with_id("chatobsidian-tray")
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                request_show_main(app, false);
            }
            "quick" => {
                let mode = app
                    .state::<AppState>()
                    .preferences
                    .lock()
                    .ok()
                    .map(|value| value.switch_policy.clone())
                    .unwrap_or_else(|| "additive".into());
                let _ = show_quick(app, &mode);
            }
            "quit" => {
                let state = app.state::<AppState>();
                state.exiting.store(true, Ordering::Relaxed);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub(crate) fn show_main(app: &tauri::AppHandle, navigate_to_vaults: bool) -> AppResult<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| message("仓库中心窗口不存在"))?;
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        if let Err(error) = windows_desktop::move_to_foreground_desktop(hwnd.0 as isize) {
            eprintln!("ChatObsidian could not move the main window to the current desktop: {error}");
        }
    }
    window.show().map_err(|error| message(error.to_string()))?;
    window
        .unminimize()
        .map_err(|error| message(error.to_string()))?;
    window
        .set_focus()
        .map_err(|error| message(error.to_string()))?;
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        windows_desktop::focus_window(hwnd.0 as isize);
    }
    if navigate_to_vaults {
        let _ = window.emit("navigate-to-vaults", ());
    }
    Ok(())
}

/// Queue a window restore instead of running it inside a tray or single-instance
/// callback. The Windows single-instance plugin receives WM_COPYDATA synchronously;
/// doing WebView/virtual-desktop work inline can block that message and leave the
/// background-launched process with a visible tray icon but no responsive window.
fn request_show_main(app: &tauri::AppHandle, navigate_to_vaults: bool) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if let Err(error) = show_main(&handle, navigate_to_vaults) {
            eprintln!("ChatObsidian could not restore the main window: {error}");
        }
    }) {
        eprintln!("ChatObsidian could not queue the main window restore: {error}");
    }
}

pub(crate) fn show_quick(app: &tauri::AppHandle, mode: &str) -> AppResult<()> {
    let window = app
        .get_webview_window("quick")
        .ok_or_else(|| message("快速切换窗口不存在"))?;
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        let _ = windows_desktop::move_to_foreground_desktop(hwnd.0 as isize);
    }
    window
        .center()
        .map_err(|error| message(error.to_string()))?;
    window.show().map_err(|error| message(error.to_string()))?;
    window
        .set_focus()
        .map_err(|error| message(error.to_string()))?;
    let effective = if mode == "single" {
        "single"
    } else if mode == "native" {
        "native"
    } else {
        "additive"
    };
    let _ = window.emit("quick-switcher-opened", effective);
    Ok(())
}

pub(crate) fn register_shortcuts(
    app: &tauri::AppHandle,
    bindings: &crate::models::ShortcutBindings,
) -> AppResult<()> {
    let shortcuts = [
        bindings.show_vault_center.as_str(),
        bindings.single_open.as_str(),
        bindings.additive_open.as_str(),
    ];
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| message(format!("无法更新全局快捷键：{error}")))?;
    if let Err(error) = app.global_shortcut().register_multiple(shortcuts) {
        let _ = app.global_shortcut().unregister_all();
        return Err(message(format!("全局快捷键无效、重复或已被占用：{error}")));
    }
    Ok(())
}

fn shortcut_action(
    shortcut: &Shortcut,
    bindings: &crate::models::ShortcutBindings,
) -> Option<String> {
    [
        ("show", bindings.show_vault_center.as_str()),
        ("single", bindings.single_open.as_str()),
        ("additive", bindings.additive_open.as_str()),
    ]
    .into_iter()
    .find_map(|(action, text)| {
        text.parse::<Shortcut>()
            .ok()
            .filter(|candidate| candidate.id() == shortcut.id())
            .map(|_| action.to_string())
    })
}
