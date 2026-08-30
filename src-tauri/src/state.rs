use crate::models::AppPreferences;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Mutex, atomic::AtomicBool};

#[derive(Clone)]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub local_dir: PathBuf,
    pub backup_dir: PathBuf,
    pub log_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub settings_file: PathBuf,
    pub database_file: PathBuf,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub preferences: Mutex<AppPreferences>,
    pub paths: AppPaths,
    pub exiting: AtomicBool,
    pub shortcut_capture: AtomicBool,
    /// Prevents periodic config checks from piling up when filesystem I/O is
    /// slower than the polling interval or an IPC caller disappears.
    pub config_check_in_flight: AtomicBool,
}
