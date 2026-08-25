use crate::error::{AppResult, message};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
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

pub fn file_hash(path: &Path) -> AppResult<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let parent = path.parent().ok_or_else(|| message("配置文件没有父目录"))?;
    std::fs::create_dir_all(parent)?;
    let temp = path.with_extension("tmp");
    let mut file = File::create(&temp)?;
    file.write_all(serde_json::to_string_pretty(value)?.as_bytes())?;
    file.sync_all()?;
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    std::fs::rename(temp, path)?;
    Ok(())
}

pub fn safe_relative_path(value: &str) -> AppResult<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute()
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

pub fn copy_file_atomic(source: &Path, target: &Path) -> AppResult<u64> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = target.with_extension(format!("chatobsidian-{}.tmp", uuid::Uuid::new_v4()));
    let bytes = std::fs::copy(source, &temp)?;
    if target.exists() {
        std::fs::remove_file(target)?;
    }
    std::fs::rename(temp, target)?;
    Ok(bytes)
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
    fn hashes_are_stable_and_change_with_content() {
        let path = std::env::temp_dir().join(format!("chatobsidian-hash-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, "alpha").unwrap();
        let first = file_hash(&path).unwrap();
        assert_eq!(first, file_hash(&path).unwrap());
        std::fs::write(&path, "beta").unwrap();
        assert_ne!(first, file_hash(&path).unwrap());
        std::fs::remove_file(path).unwrap();
    }
}
