use crate::db;
use crate::error::{AppResult, message};
use crate::models::{AppPreferences, ScanResult, VaultRecord};
use crate::util::{file_hash, normalize_path, now_millis, stable_id};
use rusqlite::Connection;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::{DirEntry, WalkDir};

#[derive(Debug, Deserialize)]
struct ObsidianConfig {
    #[serde(default)]
    vaults: HashMap<String, ObsidianVault>,
}

#[derive(Debug, Deserialize)]
struct ObsidianVault {
    path: String,
    ts: Option<i64>,
    #[serde(default)]
    open: bool,
}

#[derive(Debug, Clone)]
struct DiscoveredVault {
    obsidian_id: Option<String>,
    path: PathBuf,
    last_opened: Option<i64>,
    is_open: bool,
}

pub fn refresh_registered_metadata(connection: &Connection) -> AppResult<()> {
    let config = read_obsidian_config()?;
    let existing_by_obsidian_id: HashMap<String, VaultRecord> = db::list_vaults(connection)?
        .into_iter()
        .filter_map(|vault| vault.obsidian_id.clone().map(|id| (id, vault)))
        .collect();
    let now = now_millis();

    for (obsidian_id, registered) in config.vaults {
        let Some(previous) = existing_by_obsidian_id.get(&obsidian_id) else {
            continue;
        };
        let path = PathBuf::from(&registered.path);
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名仓库")
            .to_string();
        let group = path
            .parent()
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            .unwrap_or("未分组")
            .to_string();
        let obsidian_dir = path.join(".obsidian");
        let mut updated = previous.clone();
        updated.path = normalize_path(&path);
        updated.name = name.clone();
        updated.display_name = inherited_display_name(Some(previous), &name);
        updated.group_name = inherited_group_name(Some(previous), &group);
        updated.last_opened = registered.ts.or(previous.last_opened);
        updated.is_open = registered.open;
        updated.health = if !path.is_dir() {
            "missing"
        } else if !obsidian_dir.is_dir() {
            "invalid"
        } else {
            "healthy"
        }
        .to_string();
        db::upsert_vault(connection, &updated, now)?;
    }
    Ok(())
}

pub fn scan(connection: &mut Connection, preferences: &AppPreferences) -> AppResult<ScanResult> {
    let started = now_millis();
    let existing = db::list_vaults(connection)?;
    let existing_by_path: HashMap<String, VaultRecord> = existing
        .iter()
        .cloned()
        .map(|vault| (normalize_key(Path::new(&vault.path)), vault))
        .collect();
    let existing_by_obsidian_id: HashMap<String, VaultRecord> = existing
        .into_iter()
        .filter_map(|vault| vault.obsidian_id.clone().map(|id| (id, vault)))
        .collect();
    let mut discovered: HashMap<String, DiscoveredVault> = HashMap::new();
    let mut warnings = Vec::new();

    match read_obsidian_config() {
        Ok(config) => {
            for (obsidian_id, vault) in config.vaults {
                let path = PathBuf::from(&vault.path);
                discovered.insert(
                    normalize_key(&path),
                    DiscoveredVault {
                        obsidian_id: Some(obsidian_id),
                        path,
                        last_opened: vault.ts,
                        is_open: vault.open,
                    },
                );
            }
        }
        Err(error) => warnings.push(format!("无法读取 Obsidian 仓库列表：{error}")),
    }

    for root in &preferences.scan_roots {
        let path = PathBuf::from(root);
        if !path.exists() {
            warnings.push(format!("扫描根目录不存在：{root}"));
            continue;
        }
        for vault_path in discover_under_root(&path) {
            let key = normalize_key(&vault_path);
            discovered.entry(key).or_insert(DiscoveredVault {
                obsidian_id: None,
                path: vault_path,
                last_opened: None,
                is_open: false,
            });
        }
    }

    let template_obsidian = normalize_key(Path::new(&preferences.template_path));
    let template_root = Path::new(&preferences.template_path)
        .parent()
        .unwrap_or_else(|| Path::new(&preferences.template_path));
    if Path::new(&preferences.template_path).is_dir() {
        discovered
            .entry(normalize_key(template_root))
            .or_insert(DiscoveredVault {
                obsidian_id: None,
                path: template_root.to_path_buf(),
                last_opened: None,
                is_open: false,
            });
    }

    let template_signature = config_signature(Path::new(&preferences.template_path)).ok();
    let mut records = Vec::new();
    for (key, found) in discovered {
        let normalized = normalize_path(&found.path);
        let name = found
            .path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名仓库")
            .to_string();
        let group = found
            .path
            .parent()
            .and_then(|path| path.file_name())
            .and_then(|value| value.to_str())
            .unwrap_or("未分组")
            .to_string();
        let obsidian_dir = found.path.join(".obsidian");
        let exists = found.path.is_dir();
        let valid = obsidian_dir.is_dir();
        let is_template = normalize_key(&obsidian_dir) == template_obsidian || name == ".模板";
        let previous = existing_by_path.get(&key).or_else(|| {
            found
                .obsidian_id
                .as_ref()
                .and_then(|id| existing_by_obsidian_id.get(id))
        });
        let order_index = previous.map(|vault| vault.order_index).unwrap_or_else(|| {
            records
                .iter()
                .filter(|record: &&VaultRecord| record.group_name == group)
                .count() as i64
        });
        let config_state = if !valid {
            "missing".to_string()
        } else if is_template {
            "synced".to_string()
        } else if let Some(template) = &template_signature {
            match config_signature(&obsidian_dir) {
                Ok(value) if &value == template => "synced".to_string(),
                Ok(_) => "drifted".to_string(),
                Err(_) => "unchecked".to_string(),
            }
        } else {
            "unchecked".to_string()
        };
        let id = previous.map(|vault| vault.id.clone()).unwrap_or_else(|| {
            found
                .obsidian_id
                .clone()
                .map(|id| format!("obs_{id}"))
                .unwrap_or_else(|| stable_id(&normalized))
        });
        records.push(VaultRecord {
            id,
            obsidian_id: found
                .obsidian_id
                .or_else(|| previous.and_then(|vault| vault.obsidian_id.clone())),
            path: normalized,
            name: name.clone(),
            display_name: inherited_display_name(previous, &name),
            group_name: inherited_group_name(previous, &group),
            tags: previous.map(|vault| vault.tags.clone()).unwrap_or_default(),
            favorite: previous.is_some_and(|vault| vault.favorite),
            hidden: previous.is_some_and(|vault| vault.hidden),
            archived: previous.is_some_and(|vault| vault.archived),
            order_index,
            note_count: previous.map(|vault| vault.note_count).unwrap_or(0),
            last_opened: found
                .last_opened
                .or_else(|| previous.and_then(|vault| vault.last_opened)),
            is_open: found.is_open,
            health: if !exists {
                "missing"
            } else if !valid {
                "invalid"
            } else {
                "healthy"
            }
            .to_string(),
            config_state,
            is_template,
            excluded_categories: previous
                .map(|vault| vault.excluded_categories.clone())
                .unwrap_or_default(),
        });
    }

    records.sort_by(|a, b| {
        a.group_name
            .cmp(&b.group_name)
            .then(a.order_index.cmp(&b.order_index))
    });
    for record in &records {
        db::upsert_vault(connection, record, started)?;
    }

    let mut indexed_notes = 0_usize;
    for record in &records {
        if record.health != "healthy" || record.is_template || record.archived {
            continue;
        }
        let notes = index_notes(Path::new(&record.path));
        indexed_notes += notes.len();
        db::replace_note_index(connection, record, &notes)?;
    }

    let operation = crate::models::OperationRecord {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "scan".into(),
        title: "仓库扫描完成".into(),
        status: "success".into(),
        detail: format!(
            "发现 {} 个仓库，索引 {} 篇笔记标题",
            records.iter().filter(|vault| !vault.is_template).count(),
            indexed_notes
        ),
        created_at: started,
        finished_at: Some(now_millis()),
        can_rollback: false,
        log_path: None,
    };
    db::save_operation(connection, &operation)?;
    Ok(ScanResult {
        vaults: db::list_vaults(connection)?,
        groups: db::list_groups(connection)?,
        indexed_notes,
        warnings,
    })
}

fn inherited_display_name(previous: Option<&VaultRecord>, directory_name: &str) -> String {
    previous
        .map(|vault| {
            if vault.display_name.trim().is_empty() || vault.display_name == vault.name {
                directory_name.to_string()
            } else {
                vault.display_name.clone()
            }
        })
        .unwrap_or_else(|| directory_name.to_string())
}

fn inherited_group_name(previous: Option<&VaultRecord>, parent_name: &str) -> String {
    previous
        .map(|vault| {
            let old_parent = Path::new(&vault.path)
                .parent()
                .and_then(Path::file_name)
                .and_then(|value| value.to_str());
            if old_parent.is_some_and(|name| name == vault.group_name) {
                parent_name.to_string()
            } else {
                vault.group_name.clone()
            }
        })
        .unwrap_or_else(|| parent_name.to_string())
}

fn read_obsidian_config() -> AppResult<ObsidianConfig> {
    let appdata = std::env::var_os("APPDATA").ok_or_else(|| message("APPDATA 环境变量不存在"))?;
    let path = PathBuf::from(appdata)
        .join("obsidian")
        .join("obsidian.json");
    let text = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text)?)
}

fn discover_under_root(root: &Path) -> Vec<PathBuf> {
    let mut found = HashSet::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| allow_scan_entry(entry));
    for entry in walker.flatten() {
        if entry.file_type().is_dir() && entry.file_name() == ".obsidian" {
            if let Some(parent) = entry.path().parent() {
                found.insert(parent.to_path_buf());
            }
        }
    }
    found.into_iter().collect()
}

fn allow_scan_entry(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !matches!(
        name.as_ref(),
        ".git" | ".trash" | "node_modules" | "__pycache__"
    )
}

fn index_notes(root: &Path) -> Vec<(String, String, i64)> {
    let mut notes = Vec::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            !matches!(
                entry.file_name().to_string_lossy().as_ref(),
                ".obsidian" | ".trash" | ".git"
            )
        });
    for entry in walker.flatten() {
        if !entry.file_type().is_file()
            || entry
                .path()
                .extension()
                .and_then(|value| value.to_str())
                .is_none_or(|value| !value.eq_ignore_ascii_case("md"))
        {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        let title = entry
            .path()
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名笔记")
            .to_string();
        let modified = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0);
        notes.push((
            relative.to_string_lossy().replace('\\', "/"),
            title,
            modified,
        ));
    }
    notes
}

fn config_signature(obsidian_dir: &Path) -> AppResult<String> {
    if !obsidian_dir.is_dir() {
        return Err(message("缺少 .obsidian 目录"));
    }
    let mut files = Vec::new();
    for name in [
        "app.json",
        "appearance.json",
        "command-palette.json",
        "community-plugins.json",
        "core-plugins.json",
        "hotkeys.json",
        "templates.json",
        "types.json",
        "webviewer.json",
    ] {
        let path = obsidian_dir.join(name);
        if path.is_file() {
            files.push(path);
        }
    }
    let plugin_dir = obsidian_dir.join("plugins");
    if plugin_dir.is_dir() {
        for entry in WalkDir::new(&plugin_dir).max_depth(2).into_iter().flatten() {
            if entry.file_type().is_file() && entry.file_name() == "manifest.json" {
                files.push(entry.path().to_path_buf());
            }
        }
    }
    files.sort();
    let mut hasher = Sha256::new();
    for path in files {
        if let Ok(relative) = path.strip_prefix(obsidian_dir) {
            hasher.update(relative.to_string_lossy().replace('\\', "/").as_bytes());
        }
        hasher.update(file_hash(&path)?.as_bytes());
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn normalize_key(path: &Path) -> String {
    normalize_path(path).to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(path: &str, name: &str, display_name: &str, group_name: &str) -> VaultRecord {
        VaultRecord {
            id: "vault-id".into(),
            obsidian_id: Some("obsidian-id".into()),
            path: path.into(),
            name: name.into(),
            display_name: display_name.into(),
            group_name: group_name.into(),
            tags: Vec::new(),
            favorite: false,
            hidden: false,
            archived: false,
            order_index: 0,
            note_count: 0,
            last_opened: None,
            is_open: false,
            health: "healthy".into(),
            config_state: "unchecked".into(),
            is_template: false,
            excluded_categories: Vec::new(),
        }
    }

    #[test]
    fn directory_rename_updates_only_inherited_names() {
        let inherited = vault("C:\\Notes\\Old", "Old", "Old", "Notes");
        assert_eq!(inherited_display_name(Some(&inherited), "New"), "New");

        let customized = vault("C:\\Notes\\Old", "Old", "My Vault", "My Group");
        assert_eq!(inherited_display_name(Some(&customized), "New"), "My Vault");
        assert_eq!(
            inherited_group_name(Some(&customized), "Renamed"),
            "My Group"
        );
        assert_eq!(inherited_group_name(Some(&inherited), "Renamed"), "Renamed");
    }

    #[test]
    fn note_index_excludes_obsidian_and_trash() {
        let root =
            std::env::temp_dir().join(format!("chatobsidian-vault-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join(".obsidian")).unwrap();
        std::fs::create_dir_all(root.join(".trash")).unwrap();
        std::fs::create_dir_all(root.join("中文 目录")).unwrap();
        std::fs::write(root.join("中文 目录").join("《测试》.md"), "# test").unwrap();
        std::fs::write(root.join(".obsidian").join("hidden.md"), "hidden").unwrap();
        std::fs::write(root.join(".trash").join("removed.md"), "removed").unwrap();
        let notes = index_notes(&root);
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].1, "《测试》");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "只读扫描当前 Windows 用户的真实 Obsidian 仓库"]
    fn local_catalog_scan_is_read_only() {
        let home = PathBuf::from(std::env::var("USERPROFILE").expect("USERPROFILE"));
        let root = home.join("Desktop").join("Obsidian仓库");
        if !root.is_dir() {
            return;
        }
        let database =
            std::env::temp_dir().join(format!("chatobsidian-scan-{}.sqlite", uuid::Uuid::new_v4()));
        let mut connection = db::open(&database).unwrap();
        let result = scan(&mut connection, &AppPreferences::default_for_home(&home)).unwrap();
        println!(
            "vaults={} notes={} warnings={:?}",
            result.vaults.len(),
            result.indexed_notes,
            result.warnings
        );
        assert!(
            result
                .vaults
                .iter()
                .filter(|vault| !vault.is_template)
                .count()
                >= 1
        );
        assert!(result.indexed_notes >= 1);
        drop(connection);
        std::fs::remove_file(database).unwrap();
    }
}
