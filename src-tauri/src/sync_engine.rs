use crate::db;
use crate::error::{AppResult, message};
use crate::models::{
    BackupItem, BackupManifest, ConfigDiff, ConfigDiffEntry, JsonChange, OperationRecord, SyncPlan,
    TemplatePlugin, VaultRecord,
};
use crate::obsidian;
use crate::state::AppState;
use crate::util::{copy_file_atomic, file_hash, now_millis, safe_relative_path, write_json_atomic};
use fs2::available_space;
use rayon::prelude::*;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone)]
struct SelectedFile {
    path: PathBuf,
    category: String,
    size: u64,
}

pub fn compute_diff(state: &AppState, plan: &SyncPlan) -> AppResult<ConfigDiff> {
    validate_plan(plan)?;
    let source = resolve_obsidian_dir(Path::new(&plan.source_path))?;
    let source_files = collect_selected_files(&source, plan)?;
    let targets = get_targets(state, &plan.target_vault_ids)?;
    // Hash every selected template file once, then compare target vaults in
    // parallel. This removes the former N-vault multiplier on template reads
    // and makes good use of SSD concurrency without involving the UI thread.
    let source_hashes = source_files
        .par_iter()
        .map(|(relative, selected)| Ok((relative.clone(), file_hash(&selected.path)?)))
        .collect::<AppResult<BTreeMap<String, String>>>()?;
    let mut result = ConfigDiff {
        source_path: source.to_string_lossy().to_string(),
        target_count: targets.len(),
        added: 0,
        modified: 0,
        deleted: 0,
        unchanged: 0,
        estimated_backup_bytes: 0,
        entries: Vec::new(),
    };
    let partials = targets
        .par_iter()
        .map(|vault| compute_vault_diff(vault, &source, &source_files, &source_hashes, plan))
        .collect::<Vec<_>>();
    for partial in partials {
        merge_diff(&mut result, partial?);
    }
    result.entries.sort_by(|a, b| {
        a.target_vault_name
            .cmp(&b.target_vault_name)
            .then(a.relative_path.cmp(&b.relative_path))
    });
    Ok(result)
}

fn compute_vault_diff(
    vault: &VaultRecord,
    source: &Path,
    source_files: &BTreeMap<String, SelectedFile>,
    source_hashes: &BTreeMap<String, String>,
    plan: &SyncPlan,
) -> AppResult<ConfigDiff> {
    let target_root = Path::new(&vault.path).join(".obsidian");
    let mut result = ConfigDiff {
        source_path: String::new(),
        target_count: 0,
        added: 0,
        modified: 0,
        deleted: 0,
        unchanged: 0,
        estimated_backup_bytes: 0,
        entries: Vec::new(),
    };
    if target_root == source {
        return Ok(result);
    }
    let mut source_relatives = BTreeSet::new();
    for (relative, selected) in source_files {
        if vault.excluded_categories.contains(&selected.category) {
            continue;
        }
        source_relatives.insert(relative.clone());
        let target = target_root.join(safe_relative_path(relative)?);
        let (status, target_size, json_changes) = if !target.is_file() {
            ("added".to_string(), 0, Vec::new())
        } else {
            let target_size = target.metadata()?.len();
            let same = if target_size != selected.size {
                false
            } else {
                let source_hash = source_hashes
                    .get(relative)
                    .ok_or_else(|| message("模板摘要缺失"))?;
                &file_hash(&target)? == source_hash
            };
            if same {
                ("unchanged".to_string(), target_size, Vec::new())
            } else {
                let changes = if relative.to_ascii_lowercase().ends_with(".json") {
                    json_diff(&target, &selected.path).unwrap_or_default()
                } else {
                    Vec::new()
                };
                ("modified".to_string(), target_size, changes)
            }
        };
        add_count(&mut result, &status, target_size);
        if status != "unchanged" {
            result.entries.push(ConfigDiffEntry {
                target_vault_id: vault.id.clone(),
                target_vault_name: vault.display_name.clone(),
                relative_path: relative.clone(),
                category: selected.category.clone(),
                status,
                source_size: selected.size,
                target_size,
                json_changes,
            });
        }
    }
    if plan.full_mirror {
        for entry in WalkDir::new(&target_root)
            .follow_links(false)
            .into_iter()
            .flatten()
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(&target_root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let Some(category) = category_for_relative(&relative, plan) else {
                continue;
            };
            if vault.excluded_categories.contains(&category) || source_relatives.contains(&relative)
            {
                continue;
            }
            let size = std::fs::metadata(entry.path())?.len();
            add_count(&mut result, "deleted", size);
            result.entries.push(ConfigDiffEntry {
                target_vault_id: vault.id.clone(),
                target_vault_name: vault.display_name.clone(),
                relative_path: relative,
                category,
                status: "deleted".into(),
                source_size: 0,
                target_size: size,
                json_changes: Vec::new(),
            });
        }
    }
    Ok(result)
}

fn merge_diff(result: &mut ConfigDiff, partial: ConfigDiff) {
    result.added += partial.added;
    result.modified += partial.modified;
    result.deleted += partial.deleted;
    result.unchanged += partial.unchanged;
    result.estimated_backup_bytes += partial.estimated_backup_bytes;
    result.entries.extend(partial.entries);
}

pub fn apply(state: &AppState, plan: &SyncPlan) -> AppResult<OperationRecord> {
    if obsidian::is_running() {
        return Err(message(
            "Obsidian 正在运行。请先正常关闭全部仓库窗口再同步。",
        ));
    }
    let diff = compute_diff(state, plan)?;
    if diff.added + diff.modified + diff.deleted == 0 {
        return Ok(OperationRecord {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "sync".into(),
            title: "配置无需同步".into(),
            status: "success".into(),
            detail: "所选仓库已经与模板一致".into(),
            created_at: now_millis(),
            finished_at: Some(now_millis()),
            can_rollback: false,
            log_path: None,
        });
    }
    if diff.deleted > 0 && (!plan.full_mirror || !plan.confirm_deletions) {
        return Err(message("删除额外配置需要开启完整镜像并明确确认"));
    }
    if plan.categories.contains(&"workspace".to_string()) && !plan.confirm_workspace {
        return Err(message("同步工作区状态需要明确确认"));
    }

    let required = diff
        .estimated_backup_bytes
        .saturating_add(100 * 1024 * 1024);
    let available = available_space(&state.paths.local_dir)?;
    if available < required {
        return Err(message(format!(
            "备份空间不足：至少需要 {} MB 可用空间",
            required / 1024 / 1024
        )));
    }

    let operation_id = uuid::Uuid::new_v4().to_string();
    let operation_dir = state.paths.backup_dir.join(&operation_id);
    std::fs::create_dir_all(operation_dir.join("files"))?;
    let source = resolve_obsidian_dir(Path::new(&plan.source_path))?;
    let targets = get_targets(state, &plan.target_vault_ids)?;
    let target_map: HashMap<String, VaultRecord> = targets
        .into_iter()
        .map(|vault| (vault.id.clone(), vault))
        .collect();
    let mut manifest = BackupManifest {
        operation_id: operation_id.clone(),
        created_at: now_millis(),
        source_path: source.to_string_lossy().to_string(),
        items: Vec::new(),
        target_paths: BTreeMap::new(),
    };
    for (id, vault) in &target_map {
        manifest.target_paths.insert(
            id.clone(),
            Path::new(&vault.path)
                .join(".obsidian")
                .to_string_lossy()
                .to_string(),
        );
    }

    let changes: Vec<_> = diff
        .entries
        .iter()
        .filter(|entry| entry.status != "unchanged")
        .collect();
    for entry in &changes {
        let vault = target_map
            .get(&entry.target_vault_id)
            .ok_or_else(|| message("同步目标在预检后消失"))?;
        let relative = safe_relative_path(&entry.relative_path)?;
        let target = Path::new(&vault.path).join(".obsidian").join(&relative);
        let existed = target.is_file();
        let hash = if existed {
            Some(file_hash(&target)?)
        } else {
            None
        };
        let size = if existed { target.metadata()?.len() } else { 0 };
        if existed {
            let backup = operation_dir
                .join("files")
                .join(&entry.target_vault_id)
                .join(&relative);
            if let Some(parent) = backup.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&target, backup)?;
        }
        manifest.items.push(BackupItem {
            vault_id: entry.target_vault_id.clone(),
            relative_path: entry.relative_path.clone(),
            existed_before: existed,
            size,
            hash,
        });
    }
    write_json_atomic(&operation_dir.join("manifest.json"), &manifest)?;

    let source_files = collect_selected_files(&source, plan)?;
    let mut applied = 0_usize;
    let result: AppResult<()> = (|| {
        for entry in &changes {
            let vault = target_map.get(&entry.target_vault_id).unwrap();
            let target = Path::new(&vault.path)
                .join(".obsidian")
                .join(safe_relative_path(&entry.relative_path)?);
            if entry.status == "deleted" {
                if target.is_file() {
                    std::fs::remove_file(&target)?;
                }
            } else {
                let selected = source_files
                    .get(&entry.relative_path)
                    .ok_or_else(|| message(format!("模板文件已变化：{}", entry.relative_path)))?;
                copy_file_atomic(&selected.path, &target)?;
            }
            applied += 1;
        }
        Ok(())
    })();

    let operation = match result {
        Ok(()) => OperationRecord {
            id: operation_id.clone(),
            kind: "sync".into(),
            title: "配置同步完成".into(),
            status: "success".into(),
            detail: format!(
                "已向 {} 个仓库应用 {} 项变化，备份可回滚",
                diff.target_count, applied
            ),
            created_at: manifest.created_at,
            finished_at: Some(now_millis()),
            can_rollback: true,
            log_path: Some(
                operation_dir
                    .join("manifest.json")
                    .to_string_lossy()
                    .to_string(),
            ),
        },
        Err(error) => OperationRecord {
            id: operation_id.clone(),
            kind: "sync".into(),
            title: "配置同步部分失败".into(),
            status: "failed".into(),
            detail: format!("已应用 {applied} 项后停止：{error}"),
            created_at: manifest.created_at,
            finished_at: Some(now_millis()),
            can_rollback: applied > 0,
            log_path: Some(
                operation_dir
                    .join("manifest.json")
                    .to_string_lossy()
                    .to_string(),
            ),
        },
    };
    {
        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        db::save_operation(&connection, &operation)?;
    }
    if operation.status == "success" {
        cleanup_backups(state)?;
    }
    Ok(operation)
}

pub fn rollback(state: &AppState, operation_id: &str) -> AppResult<OperationRecord> {
    if obsidian::is_running() {
        return Err(message("Obsidian 正在运行。请先关闭全部仓库窗口再回滚。"));
    }
    let manifest_path = state
        .paths
        .backup_dir
        .join(operation_id)
        .join("manifest.json");
    let manifest: BackupManifest = serde_json::from_str(&std::fs::read_to_string(&manifest_path)?)?;
    let restored = restore_manifest(&state.paths.backup_dir, operation_id, &manifest)?;
    let now = now_millis();
    let operation = OperationRecord {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "rollback".into(),
        title: "配置回滚完成".into(),
        status: "success".into(),
        detail: format!("已恢复 {restored} 个文件"),
        created_at: now,
        finished_at: Some(now),
        can_rollback: false,
        log_path: Some(manifest_path.to_string_lossy().to_string()),
    };
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    db::save_operation(&connection, &operation)?;
    connection.execute(
        "UPDATE operations SET status='rolled_back',can_rollback=0 WHERE id=?1",
        rusqlite::params![operation_id],
    )?;
    Ok(operation)
}

fn restore_manifest(
    backup_dir: &Path,
    operation_id: &str,
    manifest: &BackupManifest,
) -> AppResult<usize> {
    let backup_root = backup_dir.join(operation_id).join("files");
    let mut restored = 0_usize;
    for item in manifest.items.iter().rev() {
        let target_root = manifest
            .target_paths
            .get(&item.vault_id)
            .ok_or_else(|| message("备份清单缺少目标路径"))?;
        let relative = safe_relative_path(&item.relative_path)?;
        let target = Path::new(target_root).join(&relative);
        if item.existed_before {
            let backup = backup_root.join(&item.vault_id).join(&relative);
            if !backup.is_file() {
                return Err(message(format!("备份文件缺失：{}", backup.display())));
            }
            copy_file_atomic(&backup, &target)?;
        } else if target.is_file() {
            std::fs::remove_file(&target)?;
        }
        restored += 1;
    }
    Ok(restored)
}

pub fn adopt_vault(
    state: &AppState,
    vault_id: &str,
    categories: &[String],
) -> AppResult<OperationRecord> {
    if obsidian::is_running() {
        return Err(message("Obsidian 正在运行。关闭后才能把配置吸收到模板。"));
    }
    let (vault, preferences) = {
        let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
        let vault = db::get_vault(&connection, vault_id)?.ok_or_else(|| message("仓库不存在"))?;
        let preferences = state
            .preferences
            .lock()
            .map_err(|_| message("偏好设置锁已损坏"))?
            .clone();
        (vault, preferences)
    };
    let template = resolve_obsidian_dir(Path::new(&preferences.template_path))?;
    let source = Path::new(&vault.path).join(".obsidian");
    let plan = SyncPlan {
        source_path: source.to_string_lossy().to_string(),
        target_vault_ids: vec![],
        categories: categories.to_vec(),
        plugin_data_ids: preferences.enabled_plugin_data_ids.clone(),
        full_mirror: false,
        confirm_workspace: false,
        confirm_deletions: false,
    };
    let files = collect_selected_files(&source, &plan)?;
    let operation_id = uuid::Uuid::new_v4().to_string();
    let operation_dir = state.paths.backup_dir.join(&operation_id);
    let backup_root = operation_dir.join("files").join("__template");
    std::fs::create_dir_all(&backup_root)?;
    let mut manifest = BackupManifest {
        operation_id: operation_id.clone(),
        created_at: now_millis(),
        source_path: source.to_string_lossy().to_string(),
        items: Vec::new(),
        target_paths: BTreeMap::from([(
            "__template".into(),
            template.to_string_lossy().to_string(),
        )]),
    };
    for (relative, selected) in &files {
        let relative_path = safe_relative_path(relative)?;
        let target = template.join(&relative_path);
        let existed = target.is_file();
        let size = if existed { target.metadata()?.len() } else { 0 };
        let hash = if existed {
            Some(file_hash(&target)?)
        } else {
            None
        };
        if existed {
            let backup = backup_root.join(&relative_path);
            if let Some(parent) = backup.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&target, backup)?;
        }
        manifest.items.push(BackupItem {
            vault_id: "__template".into(),
            relative_path: relative.clone(),
            existed_before: existed,
            size,
            hash,
        });
        copy_file_atomic(&selected.path, &target)?;
    }
    write_json_atomic(&operation_dir.join("manifest.json"), &manifest)?;
    let operation = OperationRecord {
        id: operation_id,
        kind: "sync".into(),
        title: "全局模板已更新".into(),
        status: "success".into(),
        detail: format!(
            "已从 {} 吸收 {} 个配置文件",
            vault.display_name,
            files.len()
        ),
        created_at: manifest.created_at,
        finished_at: Some(now_millis()),
        can_rollback: true,
        log_path: Some(
            operation_dir
                .join("manifest.json")
                .to_string_lossy()
                .to_string(),
        ),
    };
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    db::save_operation(&connection, &operation)?;
    connection.execute(
        "UPDATE config_snapshots SET dismissed=1 WHERE vault_id=?1",
        rusqlite::params![vault_id],
    )?;
    Ok(operation)
}

pub fn list_template_plugins(state: &AppState) -> AppResult<Vec<TemplatePlugin>> {
    let preferences = state
        .preferences
        .lock()
        .map_err(|_| message("偏好设置锁已损坏"))?
        .clone();
    let template = resolve_obsidian_dir(Path::new(&preferences.template_path))?;
    let enabled: Vec<String> = std::fs::read_to_string(template.join("community-plugins.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let plugins_dir = template.join("plugins");
    let mut plugins = Vec::new();
    if plugins_dir.is_dir() {
        for entry in std::fs::read_dir(plugins_dir)?.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let manifest_path = entry.path().join("manifest.json");
            let manifest: Value = std::fs::read_to_string(&manifest_path)
                .ok()
                .and_then(|text| serde_json::from_str(&text).ok())
                .unwrap_or(Value::Null);
            let id = manifest
                .get("id")
                .and_then(Value::as_str)
                .map(String::from)
                .unwrap_or_else(|| entry.file_name().to_string_lossy().to_string());
            plugins.push(TemplatePlugin {
                name: manifest
                    .get("name")
                    .and_then(Value::as_str)
                    .map(String::from)
                    .unwrap_or_else(|| id.clone()),
                version: manifest
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or("未知")
                    .to_string(),
                has_data: entry.path().join("data.json").is_file(),
                enabled: enabled.contains(&id),
                id,
            });
        }
    }
    plugins.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(plugins)
}

fn validate_plan(plan: &SyncPlan) -> AppResult<()> {
    if plan.categories.is_empty() {
        return Err(message("至少选择一个同步类别"));
    }
    if plan.full_mirror && !plan.confirm_deletions {
        return Err(message("完整镜像需要确认删除行为"));
    }
    Ok(())
}

fn get_targets(state: &AppState, ids: &[String]) -> AppResult<Vec<VaultRecord>> {
    let connection = state.db.lock().map_err(|_| message("数据库锁已损坏"))?;
    let all = db::list_vaults(&connection)?;
    let mut targets = Vec::new();
    for id in ids {
        let vault = all
            .iter()
            .find(|vault| &vault.id == id)
            .ok_or_else(|| message(format!("找不到同步目标：{id}")))?;
        if vault.health != "healthy" || vault.is_template {
            return Err(message(format!("同步目标无效：{}", vault.display_name)));
        }
        targets.push(vault.clone());
    }
    Ok(targets)
}

fn resolve_obsidian_dir(path: &Path) -> AppResult<PathBuf> {
    if path.file_name().and_then(|name| name.to_str()) == Some(".obsidian") && path.is_dir() {
        return Ok(path.to_path_buf());
    }
    let child = path.join(".obsidian");
    if child.is_dir() {
        return Ok(child);
    }
    Err(message(format!(
        "路径中没有有效的 .obsidian：{}",
        path.display()
    )))
}

fn collect_selected_files(
    source: &Path,
    plan: &SyncPlan,
) -> AppResult<BTreeMap<String, SelectedFile>> {
    let mut files = BTreeMap::new();
    for entry in WalkDir::new(source)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(source)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        let Some(category) = category_for_relative(&relative, plan) else {
            continue;
        };
        if !plan.categories.contains(&category) {
            continue;
        }
        files.insert(
            relative,
            SelectedFile {
                path: entry.path().to_path_buf(),
                category,
                size: std::fs::metadata(entry.path())?.len(),
            },
        );
    }
    Ok(files)
}

fn category_for_relative(relative: &str, plan: &SyncPlan) -> Option<String> {
    let lower = relative.to_ascii_lowercase();
    if lower == "workspace.json" || lower == "workspaces.json" {
        return Some("workspace".into());
    }
    if lower == "hotkeys.json" || lower == "command-palette.json" {
        return Some("shortcuts".into());
    }
    if lower == "appearance.json"
        || lower.starts_with("themes/")
        || lower.starts_with("icons/")
        || lower.starts_with("snippets/")
    {
        return Some("appearance".into());
    }
    if lower == "community-plugins.json" {
        return Some("community_plugins".into());
    }
    if lower.starts_with("plugins/") {
        let parts: Vec<_> = relative.split('/').collect();
        if parts.len() >= 3
            && parts
                .last()
                .is_some_and(|name| name.eq_ignore_ascii_case("data.json"))
        {
            return if plan
                .plugin_data_ids
                .iter()
                .any(|id| id.eq_ignore_ascii_case(parts[1]))
            {
                Some("plugin_data".into())
            } else {
                None
            };
        }
        return Some("community_plugins".into());
    }
    if lower.ends_with(".json") {
        return Some("core".into());
    }
    None
}

fn add_count(diff: &mut ConfigDiff, status: &str, target_size: u64) {
    match status {
        "added" => diff.added += 1,
        "modified" => {
            diff.modified += 1;
            diff.estimated_backup_bytes += target_size;
        }
        "deleted" => {
            diff.deleted += 1;
            diff.estimated_backup_bytes += target_size;
        }
        _ => diff.unchanged += 1,
    }
}

fn json_diff(before_path: &Path, after_path: &Path) -> AppResult<Vec<JsonChange>> {
    let before: Value = serde_json::from_str(&std::fs::read_to_string(before_path)?)?;
    let after: Value = serde_json::from_str(&std::fs::read_to_string(after_path)?)?;
    let mut before_flat = BTreeMap::new();
    let mut after_flat = BTreeMap::new();
    flatten_json_internal("$", &before, &mut before_flat, false);
    flatten_json_internal("$", &after, &mut after_flat, false);
    let keys: BTreeSet<_> = before_flat
        .keys()
        .chain(after_flat.keys())
        .cloned()
        .collect();
    Ok(keys
        .into_iter()
        .filter_map(|path| {
            let before = before_flat.get(&path).cloned();
            let after = after_flat.get(&path).cloned();
            (before != after).then(|| JsonChange {
                before: before.map(|value| redact_flat_value(&path, value)),
                after: after.map(|value| redact_flat_value(&path, value)),
                path,
            })
        })
        .take(200)
        .collect())
}

#[cfg(test)]
fn flatten_json(path: &str, value: &Value, output: &mut BTreeMap<String, String>) {
    flatten_json_internal(path, value, output, true);
}

fn flatten_json_internal(
    path: &str,
    value: &Value,
    output: &mut BTreeMap<String, String>,
    redact: bool,
) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                flatten_json_internal(&format!("{path}.{key}"), child, output, redact);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                flatten_json_internal(&format!("{path}[{index}]"), child, output, redact);
            }
        }
        _ => {
            let raw = truncate(value.to_string(), 160);
            let text = if redact {
                redact_flat_value(path, raw)
            } else {
                raw
            };
            output.insert(path.to_string(), text);
        }
    }
}

fn redact_flat_value(path: &str, value: String) -> String {
    let lower = path.to_ascii_lowercase();
    if [
        "token",
        "secret",
        "password",
        "apikey",
        "api_key",
        "authorization",
    ]
    .iter()
    .any(|key| lower.contains(key))
    {
        "••••••".to_string()
    } else {
        value
    }
}

fn truncate(value: String, max: usize) -> String {
    if value.chars().count() <= max {
        value
    } else {
        format!("{}…", value.chars().take(max).collect::<String>())
    }
}

fn cleanup_backups(state: &AppState) -> AppResult<()> {
    let preferences = state
        .preferences
        .lock()
        .map_err(|_| message("偏好设置锁已损坏"))?
        .clone();
    let mut entries: Vec<_> = std::fs::read_dir(&state.paths.backup_dir)?
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .collect();
    entries.sort_by_key(|entry| {
        std::cmp::Reverse(
            entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok(),
        )
    });
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(
            preferences.backup_retention_days as u64 * 86_400,
        ))
        .unwrap_or(std::time::UNIX_EPOCH);
    for (index, entry) in entries.into_iter().enumerate() {
        let old = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .is_ok_and(|modified| modified < cutoff);
        if index >= preferences.backup_retention_count as usize || old {
            std::fs::remove_dir_all(entry.path())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AppPreferences;
    use crate::models::ShortcutBindings;
    use crate::state::{AppPaths, AppState};
    use std::sync::{Mutex, atomic::AtomicBool};

    fn temporary_state(root: &Path) -> AppState {
        let local = root.join("app-data");
        let config = root.join("config");
        std::fs::create_dir_all(&local).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        let paths = AppPaths {
            settings_file: config.join("settings.json"),
            database_file: local.join("catalog.sqlite"),
            backup_dir: local.join("backups"),
            log_dir: local.join("logs"),
            runtime_dir: local.join("runtime"),
            config_dir: config,
            local_dir: local,
        };
        std::fs::create_dir_all(&paths.backup_dir).unwrap();
        AppState {
            db: Mutex::new(db::open(&paths.database_file).unwrap()),
            preferences: Mutex::new(AppPreferences {
                theme: "system".into(),
                settings_version: 3,
                switch_policy: "additive".into(),
                scan_roots: vec![root.to_string_lossy().to_string()],
                template_path: root
                    .join("template/.obsidian")
                    .to_string_lossy()
                    .to_string(),
                shortcuts: ShortcutBindings::default(),
                backup_retention_days: 30,
                backup_retention_count: 20,
                close_to_tray: true,
                launch_at_startup: false,
                enabled_plugin_data_ids: Vec::new(),
            }),
            paths,
            exiting: AtomicBool::new(false),
            shortcut_capture: AtomicBool::new(false),
        }
    }

    #[test]
    fn diff_payload_contains_only_actionable_rows() {
        let root = std::env::temp_dir().join(format!("chatobsidian-diff-{}", uuid::Uuid::new_v4()));
        let template = root.join("template/.obsidian");
        let target_root = root.join("vault");
        let target = target_root.join(".obsidian");
        std::fs::create_dir_all(&template).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(template.join("hotkeys.json"), r#"{"open":"Ctrl+O"}"#).unwrap();
        std::fs::write(target.join("hotkeys.json"), r#"{"open":"Ctrl+O"}"#).unwrap();

        let state = temporary_state(&root);
        let vault = VaultRecord {
            id: "vault".into(),
            obsidian_id: Some("vault".into()),
            path: target_root.to_string_lossy().to_string(),
            name: "vault".into(),
            display_name: "Vault".into(),
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
        };
        db::upsert_vault(&state.db.lock().unwrap(), &vault, now_millis()).unwrap();
        let plan = SyncPlan {
            source_path: template.to_string_lossy().to_string(),
            target_vault_ids: vec![vault.id.clone()],
            categories: vec!["shortcuts".into()],
            plugin_data_ids: Vec::new(),
            full_mirror: false,
            confirm_workspace: false,
            confirm_deletions: false,
        };

        let same = compute_diff(&state, &plan).unwrap();
        assert_eq!(same.unchanged, 1);
        assert!(same.entries.is_empty());

        std::fs::write(target.join("hotkeys.json"), r#"{"open":"Ctrl+P"}"#).unwrap();
        let changed = compute_diff(&state, &plan).unwrap();
        assert_eq!(changed.modified, 1);
        assert_eq!(changed.entries.len(), 1);
        assert_eq!(changed.entries[0].status, "modified");
        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "只读测量当前 Windows 用户的真实配置差异性能"]
    fn local_config_diff_performance_is_read_only() {
        let appdata = PathBuf::from(std::env::var("APPDATA").expect("APPDATA"));
        let localappdata = PathBuf::from(std::env::var("LOCALAPPDATA").expect("LOCALAPPDATA"));
        let config_dir = appdata.join("ChatObsidian");
        let local_dir = localappdata.join("ChatObsidian");
        let database_file = local_dir.join("catalog.sqlite");
        if !database_file.is_file() {
            return;
        }
        let home = PathBuf::from(std::env::var("USERPROFILE").expect("USERPROFILE"));
        let preferences = crate::settings::load(&config_dir.join("settings.json"), &home);
        let connection = rusqlite::Connection::open_with_flags(
            &database_file,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let target_vault_ids = db::list_vaults(&connection)
            .unwrap()
            .into_iter()
            .filter(|vault| {
                vault.health == "healthy" && !vault.is_template && !vault.hidden && !vault.archived
            })
            .map(|vault| vault.id)
            .collect::<Vec<_>>();
        let state = AppState {
            db: Mutex::new(connection),
            preferences: Mutex::new(preferences.clone()),
            paths: AppPaths {
                settings_file: config_dir.join("settings.json"),
                database_file,
                backup_dir: local_dir.join("backups"),
                log_dir: local_dir.join("logs"),
                runtime_dir: local_dir.join("runtime"),
                config_dir,
                local_dir,
            },
            exiting: AtomicBool::new(false),
            shortcut_capture: AtomicBool::new(false),
        };
        let plan = SyncPlan {
            source_path: preferences.template_path,
            target_vault_ids,
            categories: vec![
                "shortcuts".into(),
                "appearance".into(),
                "core".into(),
                "community_plugins".into(),
            ],
            plugin_data_ids: preferences.enabled_plugin_data_ids,
            full_mirror: false,
            confirm_workspace: false,
            confirm_deletions: false,
        };
        let started = std::time::Instant::now();
        let diff = compute_diff(&state, &plan).unwrap();
        println!(
            "targets={} elapsed_ms={} changed={} unchanged={} payload_rows={}",
            diff.target_count,
            started.elapsed().as_millis(),
            diff.added + diff.modified + diff.deleted,
            diff.unchanged,
            diff.entries.len()
        );
        assert_eq!(
            diff.entries.len(),
            diff.added + diff.modified + diff.deleted
        );
    }

    #[test]
    fn workspace_is_separate_and_plugin_data_is_opt_in() {
        let plan = SyncPlan {
            source_path: String::new(),
            target_vault_ids: vec![],
            categories: vec!["community_plugins".into()],
            plugin_data_ids: vec![],
            full_mirror: false,
            confirm_workspace: false,
            confirm_deletions: false,
        };
        assert_eq!(
            category_for_relative("workspace.json", &plan).as_deref(),
            Some("workspace")
        );
        assert_eq!(
            category_for_relative("plugins/copilot/main.js", &plan).as_deref(),
            Some("community_plugins")
        );
        assert!(category_for_relative("plugins/copilot/data.json", &plan).is_none());
    }

    #[test]
    fn secret_json_values_are_redacted() {
        let mut output = BTreeMap::new();
        flatten_json(
            "$",
            &serde_json::json!({"apiKey":"abc", "theme":"dark"}),
            &mut output,
        );
        assert_eq!(output.get("$.apiKey").unwrap(), "••••••");
        assert_eq!(output.get("$.theme").unwrap(), "\"dark\"");
    }

    #[test]
    fn json_diff_reports_changes_without_exposing_secrets() {
        let root = std::env::temp_dir().join(format!("chatobsidian-json-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let before = root.join("before.json");
        let after = root.join("after.json");
        std::fs::write(&before, r#"{"apiToken":"old","theme":"light"}"#).unwrap();
        std::fs::write(&after, r#"{"apiToken":"new","theme":"dark"}"#).unwrap();
        let changes = json_diff(&before, &after).unwrap();
        let token = changes
            .iter()
            .find(|change| change.path == "$.apiToken")
            .unwrap();
        assert_eq!(token.before.as_deref(), Some("••••••"));
        assert_eq!(token.after.as_deref(), Some("••••••"));
        assert!(changes.iter().any(|change| change.path == "$.theme"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restore_manifest_restores_overwrites_and_removes_new_files() {
        let root =
            std::env::temp_dir().join(format!("chatobsidian-rollback-{}", uuid::Uuid::new_v4()));
        let backup_dir = root.join("backups");
        let target = root.join("target");
        let operation_id = "operation";
        std::fs::create_dir_all(target.join("plugins/demo")).unwrap();
        let original = target.join("hotkeys.json");
        let added = target.join("plugins/demo/main.js");
        std::fs::write(&original, "changed").unwrap();
        std::fs::write(&added, "new").unwrap();
        let backup = backup_dir
            .join(operation_id)
            .join("files/vault/hotkeys.json");
        std::fs::create_dir_all(backup.parent().unwrap()).unwrap();
        std::fs::write(&backup, "original").unwrap();
        let manifest = BackupManifest {
            operation_id: operation_id.into(),
            created_at: 0,
            source_path: String::new(),
            target_paths: BTreeMap::from([("vault".into(), target.to_string_lossy().to_string())]),
            items: vec![
                BackupItem {
                    vault_id: "vault".into(),
                    relative_path: "hotkeys.json".into(),
                    existed_before: true,
                    size: 8,
                    hash: None,
                },
                BackupItem {
                    vault_id: "vault".into(),
                    relative_path: "plugins/demo/main.js".into(),
                    existed_before: false,
                    size: 0,
                    hash: None,
                },
            ],
        };
        assert_eq!(
            restore_manifest(&backup_dir, operation_id, &manifest).unwrap(),
            2
        );
        assert_eq!(std::fs::read_to_string(original).unwrap(), "original");
        assert!(!added.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
