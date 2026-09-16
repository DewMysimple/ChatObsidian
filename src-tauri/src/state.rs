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
    /// Only one external window operation may run across both WebViews.
    pub open_in_flight: AtomicBool,
}
