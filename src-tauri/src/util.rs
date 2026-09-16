use crate::error::{AppResult, message};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

pub fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn stable_id(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_lowercase().as_bytes());
    format!("v_{}", &format!("{:x}", hasher.finalize())[..22])
}

pub fn normalize_path(path: &Path) -> String {
    let absolute = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    absolute
        .to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_string()
}

pub fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let parent = path.parent().ok_or_else(|| message("配置文件没有父目录"))?;
    std::fs::create_dir_all(parent)?;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut file = File::create(&temp)?;
    file.write_all(serde_json::to_string_pretty(value)?.as_bytes())?;
    file.sync_all()?;
    drop(file);
    // Replace in one filesystem operation. Never remove the last good settings
    // file first: a power loss or failed rename must not destroy preferences.
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
        };
        let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                source.as_ptr(),
                target.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            let error = std::io::Error::last_os_error();
            let _ = std::fs::remove_file(&temp);
            return Err(error.into());
        }
    }
    #[cfg(not(windows))]
    std::fs::rename(temp, path)?;
    Ok(())
}

pub fn safe_relative_path(value: &str) -> AppResult<PathBuf> {
    let path = Path::new(value);
    if value.contains(':')
        || value.contains('\0')
        || path.is_absolute()
        || path.components().any(|part| {
            matches!(
                part,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err(message(format!("拒绝不安全的相对路径：{value}")));
    }
    Ok(path.to_path_buf())
}

pub fn is_within(child: &Path, parent: &Path) -> bool {
    let child = std::fs::canonicalize(child).unwrap_or_else(|_| child.to_path_buf());
    let parent = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    child.starts_with(parent)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_absolute_and_parent_relative_paths() {
        assert!(safe_relative_path("../outside.json").is_err());
        assert!(safe_relative_path("C:\\outside.json").is_err());
        assert!(safe_relative_path("plugins/demo/data.json").is_ok());
    }

    #[test]
    fn atomic_settings_replacement_preserves_valid_json() {
        let root =
            std::env::temp_dir().join(format!("chatobsidian-atomic-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("settings.json");
        write_json_atomic(&path, &serde_json::json!({"version":1})).unwrap();
        write_json_atomic(&path, &serde_json::json!({"version":2})).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(&path).unwrap())
                .unwrap()["version"],
            2
        );
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
}
