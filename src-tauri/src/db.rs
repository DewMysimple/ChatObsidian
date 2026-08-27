use crate::error::AppResult;
use crate::models::{NoteIndexEntry, OperationRecord, VaultGroup, VaultRecord};
use rusqlite::{Connection, params};
use std::path::Path;

pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let connection = Connection::open(path)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&connection)?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> AppResult<()> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS vaults (
            id TEXT PRIMARY KEY,
            obsidian_id TEXT,
            path TEXT NOT NULL UNIQUE COLLATE NOCASE,
            name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            group_name TEXT NOT NULL,
            tags_json TEXT NOT NULL DEFAULT '[]',
            favorite INTEGER NOT NULL DEFAULT 0,
            hidden INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            order_index INTEGER NOT NULL DEFAULT 0,
            note_count INTEGER NOT NULL DEFAULT 0,
            last_opened INTEGER,
            is_open INTEGER NOT NULL DEFAULT 0,
            health TEXT NOT NULL DEFAULT 'unchecked',
            config_state TEXT NOT NULL DEFAULT 'unchecked',
            is_template INTEGER NOT NULL DEFAULT 0,
            excluded_json TEXT NOT NULL DEFAULT '[]',
            discovered_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vault_group ON vaults(group_name, order_index);
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            order_index INTEGER NOT NULL DEFAULT 0,
            collapsed INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
            relative_path TEXT NOT NULL,
            title TEXT NOT NULL,
            modified_at INTEGER NOT NULL,
            UNIQUE(vault_id, relative_path)
        );
        CREATE INDEX IF NOT EXISTS idx_notes_title ON notes(title COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS operations (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            detail TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            finished_at INTEGER,
            can_rollback INTEGER NOT NULL DEFAULT 0,
            log_path TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_operations_created ON operations(created_at DESC);
        CREATE TABLE IF NOT EXISTS config_snapshots (
            vault_id TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,
            vault_name TEXT NOT NULL,
            hashes_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            dismissed INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS config_hash_cache (
            vault_id TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,
            fingerprint TEXT NOT NULL,
            hashes_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "#,
    )?;
    Ok(())
}

pub fn upsert_vault(connection: &Connection, vault: &VaultRecord, now: i64) -> AppResult<()> {
    connection.execute(
        r#"
        INSERT INTO vaults (
          id, obsidian_id, path, name, display_name, group_name, tags_json,
          favorite, hidden, archived, order_index, note_count, last_opened,
          is_open, health, config_state, is_template, excluded_json, discovered_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?19)
        ON CONFLICT(id) DO UPDATE SET
          obsidian_id=excluded.obsidian_id,
          path=excluded.path,
          name=excluded.name,
          display_name=excluded.display_name,
          group_name=excluded.group_name,
          tags_json=excluded.tags_json,
          favorite=excluded.favorite,
          hidden=excluded.hidden,
          archived=excluded.archived,
          order_index=excluded.order_index,
          last_opened=excluded.last_opened,
          is_open=excluded.is_open,
          health=excluded.health,
          config_state=excluded.config_state,
          is_template=excluded.is_template,
          note_count=excluded.note_count,
          excluded_json=excluded.excluded_json,
          updated_at=excluded.updated_at
        "#,
        params![
            vault.id,
            vault.obsidian_id,
            vault.path,
            vault.name,
            vault.display_name,
            vault.group_name,
            serde_json::to_string(&vault.tags)?,
            vault.favorite,
            vault.hidden,
            vault.archived,
            vault.order_index,
            vault.note_count,
            vault.last_opened,
            vault.is_open,
            vault.health,
            vault.config_state,
            vault.is_template,
            serde_json::to_string(&vault.excluded_categories)?,
            now,
        ],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO groups(id,name,order_index,collapsed) VALUES(?1,?2,(SELECT COUNT(*) FROM groups),0)",
        params![format!("g_{}", crate::util::stable_id(&vault.group_name)), vault.group_name],
    )?;
    Ok(())
}

pub fn list_vaults(connection: &Connection) -> AppResult<Vec<VaultRecord>> {
    let mut statement = connection.prepare(
        "SELECT id,obsidian_id,path,name,display_name,group_name,tags_json,favorite,hidden,archived,order_index,note_count,last_opened,is_open,health,config_state,is_template,excluded_json FROM vaults ORDER BY group_name COLLATE NOCASE, order_index, display_name COLLATE NOCASE",
    )?;
    let rows = statement.query_map([], |row| {
        let tags: String = row.get(6)?;
        let excluded: String = row.get(17)?;
        Ok(VaultRecord {
            id: row.get(0)?,
            obsidian_id: row.get(1)?,
            path: row.get(2)?,
            name: row.get(3)?,
            display_name: row.get(4)?,
            group_name: row.get(5)?,
            tags: serde_json::from_str(&tags).unwrap_or_default(),
            favorite: row.get(7)?,
            hidden: row.get(8)?,
            archived: row.get(9)?,
            order_index: row.get(10)?,
            note_count: row.get(11)?,
            last_opened: row.get(12)?,
            is_open: row.get(13)?,
            health: row.get(14)?,
            config_state: row.get(15)?,
            is_template: row.get(16)?,
            excluded_categories: serde_json::from_str(&excluded).unwrap_or_default(),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn get_vault(connection: &Connection, id: &str) -> AppResult<Option<VaultRecord>> {
    Ok(list_vaults(connection)?
        .into_iter()
        .find(|vault| vault.id == id))
}

pub fn list_groups(connection: &Connection) -> AppResult<Vec<VaultGroup>> {
    let mut statement = connection.prepare(
        "SELECT g.id,g.name,g.order_index,g.collapsed,COUNT(v.id) FROM groups g LEFT JOIN vaults v ON v.group_name=g.name GROUP BY g.id,g.name,g.order_index,g.collapsed HAVING COUNT(v.id)>0 ORDER BY g.order_index,g.name",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(VaultGroup {
            id: row.get(0)?,
            name: row.get(1)?,
            order_index: row.get(2)?,
            collapsed: row.get(3)?,
            vault_count: row.get(4)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn replace_note_index(
    connection: &mut Connection,
    vault: &VaultRecord,
    notes: &[(String, String, i64)],
) -> AppResult<()> {
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM notes WHERE vault_id=?1", params![vault.id])?;
    {
        let mut statement = transaction.prepare(
            "INSERT INTO notes(vault_id,relative_path,title,modified_at) VALUES(?1,?2,?3,?4)",
        )?;
        for (relative, title, modified) in notes {
            statement.execute(params![vault.id, relative, title, modified])?;
        }
    }
    transaction.execute(
        "UPDATE vaults SET note_count=?1 WHERE id=?2",
        params![notes.len() as i64, vault.id],
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn search_notes(
    connection: &Connection,
    query: &str,
    limit: usize,
) -> AppResult<Vec<NoteIndexEntry>> {
    let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
    let mut statement = connection.prepare(
        "SELECT n.id,n.vault_id,v.display_name,n.relative_path,n.title,n.modified_at FROM notes n JOIN vaults v ON v.id=n.vault_id WHERE n.title LIKE ?1 ESCAPE '\\' ORDER BY CASE WHEN n.title LIKE ?2 THEN 0 ELSE 1 END,n.modified_at DESC LIMIT ?3",
    )?;
    let prefix = format!("{}%", query.replace('%', "\\%").replace('_', "\\_"));
    let rows = statement.query_map(params![pattern, prefix, limit as i64], |row| {
        Ok(NoteIndexEntry {
            id: row.get(0)?,
            vault_id: row.get(1)?,
            vault_name: row.get(2)?,
            relative_path: row.get(3)?,
            title: row.get(4)?,
            modified_at: row.get(5)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn save_operation(connection: &Connection, operation: &OperationRecord) -> AppResult<()> {
    connection.execute(
        "INSERT OR REPLACE INTO operations(id,kind,title,status,detail,created_at,finished_at,can_rollback,log_path) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![operation.id,operation.kind,operation.title,operation.status,operation.detail,operation.created_at,operation.finished_at,operation.can_rollback,operation.log_path],
    )?;
    Ok(())
}

pub fn list_operations(connection: &Connection, limit: usize) -> AppResult<Vec<OperationRecord>> {
    let mut statement = connection.prepare("SELECT id,kind,title,status,detail,created_at,finished_at,can_rollback,log_path FROM operations ORDER BY created_at DESC LIMIT ?1")?;
    let rows = statement.query_map(params![limit as i64], |row| {
        Ok(OperationRecord {
            id: row.get(0)?,
            kind: row.get(1)?,
            title: row.get(2)?,
            status: row.get(3)?,
            detail: row.get(4)?,
            created_at: row.get(5)?,
            finished_at: row.get(6)?,
            can_rollback: row.get(7)?,
            log_path: row.get(8)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(path: &str, name: &str) -> VaultRecord {
        VaultRecord {
            id: "same-vault".into(),
            obsidian_id: Some("same-obsidian-id".into()),
            path: path.into(),
            name: name.into(),
            display_name: name.into(),
            group_name: "Notes".into(),
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
    fn upsert_tracks_a_vault_renamed_on_disk() {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        upsert_vault(&connection, &vault("C:\\Notes\\Old", "Old"), 1).unwrap();
        upsert_vault(&connection, &vault("C:\\Notes\\New", "New"), 2).unwrap();
        let rows = list_vaults(&connection).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].path, "C:\\Notes\\New");
        assert_eq!(rows[0].display_name, "New");
    }

    #[test]
    fn search_notes_matches_titles_but_not_relative_paths() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        let record = vault("C:\\Notes\\Vault", "Vault");
        upsert_vault(&connection, &record, 1).unwrap();
        replace_note_index(
            &mut connection,
            &record,
            &[
                ("目录/标题.md".into(), "目标笔记".into(), 2),
                ("其他.md".into(), "普通笔记".into(), 1),
            ],
        )
        .unwrap();

        assert!(search_notes(&connection, "目录", 10).unwrap().is_empty());
        assert_eq!(
            search_notes(&connection, "目标", 10).unwrap()[0].title,
            "目标笔记"
        );
    }
}
