use crate::error::AppResult;
use crate::models::AppPreferences;
use crate::util::write_json_atomic;
use std::path::Path;

pub fn load(path: &Path, home: &Path) -> AppPreferences {
    if let Some(text) = std::fs::read_to_string(path).ok() {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Ok(mut preferences) = serde_json::from_value::<AppPreferences>(value.clone()) {
                let legacy = value.get("settingsVersion").is_none();
                let mut migrated = false;
                if legacy {
                    if let Some(shortcut) =
                        value.get("globalShortcut").and_then(|item| item.as_str())
                    {
                        preferences.shortcuts.show_vault_center = shortcut.to_string();
                    }
                    if matches!(preferences.switch_policy.as_str(), "native" | "focus") {
                        preferences.switch_policy = "additive".into();
                    }
                    migrated = true;
                }
                if preferences.settings_version < 3 {
                    preferences.settings_version = 3;
                    migrated = true;
                }
                if migrated {
                    let _ = save(path, &preferences);
                }
                return preferences;
            }
        }
    }
    let preferences = AppPreferences::default_for_home(home);
    let _ = save(path, &preferences);
    preferences
}

pub fn save(path: &Path, preferences: &AppPreferences) -> AppResult<()> {
    write_json_atomic(path, preferences)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_shortcut_and_native_policy() {
        let root =
            std::env::temp_dir().join(format!("chatobsidian-settings-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("settings.json");
        std::fs::write(
            &path,
            r#"{
          "theme":"system","switchPolicy":"native","scanRoots":["C:\\Notes"],
          "templatePath":"C:\\Notes\\.模板\\.obsidian","globalShortcut":"Ctrl+Alt+P",
          "backupRetentionDays":30,"backupRetentionCount":20,"closeToTray":true,
          "enabledPluginDataIds":[]
        }"#,
        )
        .unwrap();
        let loaded = load(&path, &root);
        assert_eq!(loaded.settings_version, 3);
        assert!(!loaded.launch_at_startup);
        assert_eq!(loaded.switch_policy, "additive");
        assert_eq!(loaded.shortcuts.show_vault_center, "Ctrl+Alt+P");
        assert_eq!(loaded.shortcuts.single_open, "Ctrl+Alt+1");
        std::fs::remove_dir_all(root).unwrap();
    }
}
