use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBindings {
    pub show_vault_center: String,
    pub single_open: String,
    pub additive_open: String,
}

impl Default for ShortcutBindings {
    fn default() -> Self {
        Self {
            show_vault_center: "Ctrl+Alt+O".into(),
            single_open: "Ctrl+Alt+1".into(),
            additive_open: "Ctrl+Alt+2".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    #[serde(default = "current_settings_version")]
    pub settings_version: u32,
    pub theme: String,
    pub switch_policy: String,
    pub scan_roots: Vec<String>,
    pub template_path: String,
    #[serde(default)]
    pub shortcuts: ShortcutBindings,
    pub backup_retention_days: u32,
    pub backup_retention_count: u32,
    pub close_to_tray: bool,
    #[serde(default)]
    pub launch_at_startup: bool,
    pub enabled_plugin_data_ids: Vec<String>,
}

impl AppPreferences {
    pub fn default_for_home(home: &std::path::Path) -> Self {
        let root = home.join("Desktop").join("Obsidian仓库");
        Self {
            settings_version: current_settings_version(),
            theme: "system".into(),
            switch_policy: "additive".into(),
            scan_roots: vec![root.to_string_lossy().to_string()],
            template_path: root
                .join(".模板")
                .join(".obsidian")
                .to_string_lossy()
                .to_string(),
            shortcuts: ShortcutBindings::default(),
            backup_retention_days: 30,
            backup_retention_count: 20,
            close_to_tray: true,
            launch_at_startup: false,
            enabled_plugin_data_ids: Vec::new(),
        }
    }
}

fn current_settings_version() -> u32 {
    3
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultRecord {
    pub id: String,
    pub obsidian_id: Option<String>,
    pub path: String,
    pub name: String,
    pub display_name: String,
    pub group_name: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub hidden: bool,
    pub archived: bool,
    pub order_index: i64,
    pub note_count: i64,
    pub last_opened: Option<i64>,
    pub is_open: bool,
    pub health: String,
    pub config_state: String,
    pub is_template: bool,
    pub excluded_categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenVaultResult {
    pub action: String,
    pub effective_mode: String,
    pub moved_window_count: usize,
    pub closed_vault_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultGroup {
    pub id: String,
    pub name: String,
    pub order_index: i64,
    pub collapsed: bool,
    pub vault_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteIndexEntry {
    pub id: i64,
    pub vault_id: String,
    pub vault_name: String,
    pub relative_path: String,
    pub title: String,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonChange {
    pub path: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDiffEntry {
    pub target_vault_id: String,
    pub target_vault_name: String,
    pub relative_path: String,
    pub category: String,
    pub status: String,
    pub source_size: u64,
    pub target_size: u64,
    pub json_changes: Vec<JsonChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDiff {
    pub source_path: String,
    pub target_count: usize,
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
    pub unchanged: usize,
    pub estimated_backup_bytes: u64,
    pub entries: Vec<ConfigDiffEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
    pub source_path: String,
    pub target_vault_ids: Vec<String>,
    pub categories: Vec<String>,
    pub plugin_data_ids: Vec<String>,
    pub full_mirror: bool,
    pub confirm_workspace: bool,
    pub confirm_deletions: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupItem {
    pub vault_id: String,
    pub relative_path: String,
    pub existed_before: bool,
    pub size: u64,
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub operation_id: String,
    pub created_at: i64,
    pub source_path: String,
    pub items: Vec<BackupItem>,
    #[serde(default)]
    pub target_paths: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRecord {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub status: String,
    pub detail: String,
    pub created_at: i64,
    pub finished_at: Option<i64>,
    pub can_rollback: bool,
    pub log_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptTool {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub exists: bool,
    pub last_run: Option<OperationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRunPreview {
    pub script_id: String,
    pub name: String,
    pub description: String,
    pub script_path: String,
    pub python_path: Option<String>,
    pub python_version: Option<String>,
    pub working_directory: String,
    pub terminal: String,
    pub log_directory: String,
    pub interactive: bool,
    pub ready: bool,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub has_data: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChangeNotice {
    pub vault_id: String,
    pub vault_name: String,
    pub changed_paths: Vec<String>,
    pub checked_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub vaults: Vec<VaultRecord>,
    pub groups: Vec<VaultGroup>,
    pub indexed_notes: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardData {
    pub vaults: Vec<VaultRecord>,
    pub groups: Vec<VaultGroup>,
    pub operations: Vec<OperationRecord>,
    pub preferences: AppPreferences,
    pub pending_change: Option<ConfigChangeNotice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVaultInput {
    pub id: String,
    pub display_name: Option<String>,
    pub group_name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub favorite: Option<bool>,
    pub hidden: Option<bool>,
    pub archived: Option<bool>,
    pub order_index: Option<i64>,
    pub excluded_categories: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderVaultsInput {
    pub group_name: String,
    pub vault_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderGroupsInput {
    pub group_ids: Vec<String>,
}
