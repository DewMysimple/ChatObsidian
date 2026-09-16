//! Local database pages. This module only writes the application catalog.
use crate::{
    db,
    error::{AppResult, message},
    util::now_millis,
};
use base64::Engine;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Property {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub options: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub description: String,
    pub properties: Vec<Property>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Item {
    pub id: String,
    pub collection_id: String,
    pub vault_id: Option<String>,
    pub title: String,
    pub icon: String,
    pub cover: String,
    #[serde(default)]
    pub cover_image: Option<String>,
    pub description: String,
    pub body: String,
    pub status: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub archived: bool,
    pub values: BTreeMap<String, Value>,
    pub created_at: i64,
    pub updated_at: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseView {
    pub id: String,
    pub collection_id: String,
    pub name: String,
    pub layout: String,
    pub search: String,
    pub status: String,
    pub tag: String,
    pub sort: String,
    pub card_size: String,
    pub preview: String,
    #[serde(default)]
    pub fit_image: bool,
    pub show_description: bool,
    pub show_tags: bool,
    pub show_status: bool,
    pub visible_properties: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Workspace {
    pub revision: i64,
    pub collections: Vec<Collection>,
    pub items: Vec<Item>,
    pub views: Vec<DatabaseView>,
}

pub fn migrate(connection: &Connection) -> AppResult<()> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS workspace_meta(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
        INSERT OR IGNORE INTO workspace_meta VALUES(1,0);
        CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workspace_items(id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id), vault_id TEXT UNIQUE REFERENCES vaults(id), data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_workspace_collection ON workspace_items(collection_id);
        CREATE TABLE IF NOT EXISTS database_views(id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id), data TEXT NOT NULL);")?;
    for (id, name, icon, description) in [
        ("vaults", "仓库画廊", "◈", "给知识一个井然有序的家。"),
        (
            "library",
            "灵感与项目",
            "✳",
            "收集想法，让值得做的事慢慢发生。",
        ),
    ] {
        let collection = Collection {
            id: id.into(),
            name: name.into(),
            icon: icon.into(),
            description: description.into(),
            properties: vec![],
        };
        connection.execute(
            "INSERT OR IGNORE INTO collections VALUES(?1,?2)",
            params![id, serde_json::to_string(&collection)?],
        )?;
        for (layout, name) in [("gallery", "画廊"), ("table", "表格"), ("board", "看板")] {
            let view = default_view(id, layout, name);
            connection.execute(
                "INSERT OR IGNORE INTO database_views VALUES(?1,?2,?3)",
                params![view.id, id, serde_json::to_string(&view)?],
            )?;
        }
    }
    Ok(())
}

fn default_view(collection: &str, layout: &str, name: &str) -> DatabaseView {
    DatabaseView {
        id: format!("{collection}-{layout}"),
        collection_id: collection.into(),
        name: name.into(),
        layout: layout.into(),
        search: String::new(),
        status: String::new(),
        tag: String::new(),
        sort: "manual".into(),
        card_size: "medium".into(),
        preview: "cover".into(),
        fit_image: false,
        show_description: true,
        show_tags: true,
        show_status: true,
        visible_properties: vec![],
    }
}

pub fn load(connection: &mut Connection) -> AppResult<Workspace> {
    let transaction = connection.transaction()?;
    let mut added = false;
    for (index, vault) in db::list_vaults(&transaction)?
        .into_iter()
        .filter(|v| !v.is_template)
        .enumerate()
    {
        let now = now_millis();
        let item = Item {
            id: format!("vault:{}", vault.id),
            collection_id: "vaults".into(),
            vault_id: Some(vault.id.clone()),
            title: vault.display_name,
            icon: "◈".into(),
            cover_image: None,
            cover: ["paper", "sage", "sand", "ink", "blue", "clay"][index % 6].into(),
            description: String::new(),
            body: String::new(),
            status: "active".into(),
            tags: vault.tags,
            favorite: vault.favorite,
            archived: vault.archived || vault.hidden,
            values: BTreeMap::new(),
            created_at: now,
            updated_at: now,
        };
        added |= transaction.execute(
            "INSERT OR IGNORE INTO workspace_items VALUES(?1,?2,?3,?4)",
            params![
                item.id,
                item.collection_id,
                item.vault_id,
                serde_json::to_string(&item)?
            ],
        )? > 0;
    }
    if added {
        transaction.execute(
            "UPDATE workspace_meta SET revision=revision+1 WHERE id=1",
            [],
        )?;
    }
    transaction.commit()?;
    read(connection)
}

fn read_json<T: serde::de::DeserializeOwned>(
    connection: &Connection,
    sql: &str,
) -> AppResult<Vec<T>> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
}
fn read(connection: &Connection) -> AppResult<Workspace> {
    Ok(Workspace {
        revision: connection.query_row(
            "SELECT revision FROM workspace_meta WHERE id=1",
            [],
            |r| r.get(0),
        )?,
        collections: read_json(connection, "SELECT data FROM collections ORDER BY rowid")?,
        items: read_json(
            connection,
            "SELECT data FROM workspace_items ORDER BY rowid",
        )?,
        views: read_json(connection, "SELECT data FROM database_views ORDER BY rowid")?,
    })
}

fn require(condition: bool, text: &str) -> AppResult<()> {
    if condition {
        Ok(())
    } else {
        Err(message(text))
    }
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 120
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_:".contains(c))
}
fn unique_ids<'a>(ids: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = HashSet::new();
    ids.into_iter().all(|id| valid_id(id) && seen.insert(id))
}
fn short(text: &str, max: usize) -> bool {
    !text.trim().is_empty() && text.len() <= max
}

fn validate_cover(data: &str) -> AppResult<()> {
    require(data.len() <= 512 * 1024, "封面图片超过容量上限")?;
    let (prefix, content) = data
        .split_once(',')
        .ok_or_else(|| message("封面格式无效"))?;
    let format = match prefix {
        "data:image/png;base64" => image::ImageFormat::Png,
        "data:image/jpeg;base64" => image::ImageFormat::Jpeg,
        "data:image/webp;base64" => image::ImageFormat::WebP,
        _ => return Err(message("仅允许本地 PNG、JPEG、WebP 封面")),
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content)
        .map_err(|_| message("图片编码无效"))?;
    let (width, height) = image::ImageReader::with_format(std::io::Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|_| message("无法识别图片尺寸"))?;
    require(
        width > 0 && height > 0 && width <= 1600 && height <= 1600,
        "封面尺寸超过 1600 像素",
    )
}

pub fn validate(workspace: &Workspace) -> AppResult<()> {
    require(
        workspace.collections.len() <= 100
            && workspace.items.len() <= 5000
            && workspace.views.len() <= 500,
        "已达到本地工作台容量上限",
    )?;
    require(
        serde_json::to_vec(workspace)?.len() <= 16 * 1024 * 1024,
        "工作台数据超过 16 MB",
    )?;
    require(
        unique_ids(workspace.collections.iter().map(|c| c.id.as_str()))
            && unique_ids(workspace.items.iter().map(|c| c.id.as_str()))
            && unique_ids(workspace.views.iter().map(|c| c.id.as_str())),
        "数据库标识重复或无效",
    )?;
    for collection in &workspace.collections {
        require(
            workspace
                .views
                .iter()
                .any(|view| view.collection_id == collection.id),
            "每个数据库至少需要一个视图",
        )?;
        require(
            short(&collection.name, 120)
                && collection.icon.len() <= 32
                && collection.description.len() <= 2000,
            "数据库名称或描述无效",
        )?;
        require(
            collection.properties.len() <= 30
                && unique_ids(collection.properties.iter().map(|p| p.id.as_str())),
            "属性标识重复或超限",
        )?;
        for property in &collection.properties {
            require(
                short(&property.name, 80)
                    && ["text", "number", "select", "date", "checkbox", "url"]
                        .contains(&property.kind.as_str()),
                "属性类型或名称无效",
            )?;
            require(
                property.options.len() <= 50 && property.options.iter().all(|o| short(o, 120)),
                "选项无效或过多",
            )?;
        }
    }
    for item in &workspace.items {
        if let Some(image) = &item.cover_image {
            validate_cover(image)?;
        }
        let collection = workspace
            .collections
            .iter()
            .find(|c| c.id == item.collection_id)
            .ok_or_else(|| message("页面所属数据库不存在"))?;
        require(
            short(&item.title, 300)
                && item.icon.len() <= 32
                && item.description.len() <= 2000
                && item.body.len() <= 100_000,
            "页面内容长度无效",
        )?;
        require(
            ["idea", "active", "done"].contains(&item.status.as_str())
                && ["paper", "sage", "sand", "ink", "blue", "clay"].contains(&item.cover.as_str()),
            "页面状态或封面无效",
        )?;
        require(
            item.tags.len() <= 30 && item.tags.iter().all(|tag| short(tag, 120)),
            "标签无效或过多",
        )?;
        require(
            item.vault_id.is_none() || item.collection_id == "vaults",
            "仓库卡片只能放在仓库画廊",
        )?;
        for (key, value) in &item.values {
            let property = collection
                .properties
                .iter()
                .find(|p| &p.id == key)
                .ok_or_else(|| message("页面引用了未知属性"))?;
            if value.is_null() || value.as_str() == Some("") {
                continue;
            }
            let valid = match property.kind.as_str() {
                "number" => value.is_number(),
                "checkbox" => value.is_boolean(),
                "select" => value
                    .as_str()
                    .is_some_and(|s| property.options.iter().any(|o| o == s)),
                "date" => value.as_str().is_some_and(|s| {
                    s.len() == 10 && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
                }),
                "url" => value.as_str().is_some_and(|s| {
                    s.len() <= 2000 && (s.starts_with("https://") || s.starts_with("http://"))
                }),
                _ => value.as_str().is_some_and(|s| s.len() <= 2000),
            };
            require(valid, "属性值与类型不匹配（链接仅支持 http/https）")?;
        }
    }
    for view in &workspace.views {
        let collection = workspace
            .collections
            .iter()
            .find(|c| c.id == view.collection_id)
            .ok_or_else(|| message("视图所属数据库不存在"))?;
        require(
            short(&view.name, 120)
                && ["gallery", "table", "board"].contains(&view.layout.as_str())
                && ["manual", "title", "updated", "created"].contains(&view.sort.as_str())
                && ["small", "medium", "large"].contains(&view.card_size.as_str())
                && ["cover", "content", "none"].contains(&view.preview.as_str()),
            "视图设置无效",
        )?;
        require(
            ["", "idea", "active", "done"].contains(&view.status.as_str())
                && view.search.len() <= 300
                && view.tag.len() <= 120
                && view
                    .visible_properties
                    .iter()
                    .all(|id| collection.properties.iter().any(|p| &p.id == id)),
            "视图筛选或属性无效",
        )?;
    }
    Ok(())
}

pub fn save(connection: &mut Connection, mut workspace: Workspace) -> AppResult<Workspace> {
    validate(&workspace)?;
    let transaction = connection.transaction()?;
    let previous = read(&transaction)?;
    require(
        previous.revision == workspace.revision,
        "WORKSPACE_CONFLICT：数据已在其他窗口更新，请重新加载后再编辑",
    )?;
    // Deletion is deliberately unavailable. Archiving is reversible; missing
    // records indicate stale/incomplete client state, never a request to wipe data.
    require(
        previous
            .collections
            .iter()
            .all(|old| workspace.collections.iter().any(|c| c.id == old.id))
            && previous.items.iter().all(|old| {
                workspace.items.iter().any(|i| {
                    i.id == old.id
                        && i.vault_id == old.vault_id
                        && i.collection_id == old.collection_id
                })
            })
            && previous.views.iter().all(|old| {
                workspace
                    .views
                    .iter()
                    .any(|v| v.id == old.id && v.collection_id == old.collection_id)
            }),
        "拒绝删除或重新绑定已有记录，请使用归档",
    )?;
    for collection in &workspace.collections {
        transaction.execute("INSERT INTO collections VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![collection.id, serde_json::to_string(collection)?])?;
    }
    for item in &mut workspace.items {
        if let Some(vault_id) = &item.vault_id {
            require(
                previous
                    .items
                    .iter()
                    .any(|old| old.id == item.id && old.vault_id.as_ref() == Some(vault_id)),
                "仓库关联只能由扫描创建",
            )?;
            transaction.execute("UPDATE vaults SET display_name=?1,tags_json=?2,favorite=?3,archived=?4,hidden=0 WHERE id=?5", params![item.title, serde_json::to_string(&item.tags)?, item.favorite, item.archived, vault_id])?;
        }
        if let Some(old) = previous.items.iter().find(|old| old.id == item.id) {
            item.created_at = old.created_at;
            if serde_json::to_value(&*item)? != serde_json::to_value(old)? {
                item.updated_at = now_millis();
            }
        } else {
            item.created_at = now_millis();
            item.updated_at = item.created_at;
        }
        transaction.execute("INSERT INTO workspace_items VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![item.id,item.collection_id,item.vault_id,serde_json::to_string(item)?])?;
    }
    for view in &workspace.views {
        transaction.execute("INSERT INTO database_views VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![view.id,view.collection_id,serde_json::to_string(view)?])?;
    }
    transaction.execute(
        "UPDATE workspace_meta SET revision=revision+1 WHERE id=1",
        [],
    )?;
    transaction.commit()?;
    workspace.revision += 1;
    Ok(workspace)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn page() -> Item {
        Item {
            id: "page-test".into(),
            collection_id: "library".into(),
            vault_id: None,
            title: "测试页面".into(),
            icon: "✳".into(),
            cover: "paper".into(),
            cover_image: None,
            description: "描述".into(),
            body: "正文".into(),
            status: "idea".into(),
            tags: vec!["研究".into()],
            favorite: false,
            archived: false,
            values: BTreeMap::new(),
            created_at: 0,
            updated_at: 0,
        }
    }
    fn database() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE vaults(id TEXT PRIMARY KEY);")
            .unwrap();
        migrate(&c).unwrap();
        c.execute("UPDATE workspace_meta SET revision=1", [])
            .unwrap();
        let _ = &mut c;
        c
    }
    #[test]
    fn migration_is_additive_and_repeatable() {
        let c = database();
        migrate(&c).unwrap();
        assert_eq!(read(&c).unwrap().collections.len(), 2);
        assert_eq!(read(&c).unwrap().views.len(), 6);
    }
    #[test]
    fn rejects_stale_writes_and_keeps_committed_data() {
        let mut c = database();
        let mut w = read(&c).unwrap();
        let stale = w.clone();
        w.collections[0].name = "新名称".into();
        save(&mut c, w).unwrap();
        assert!(
            save(&mut c, stale)
                .unwrap_err()
                .to_string()
                .contains("WORKSPACE_CONFLICT")
        );
        assert_eq!(read(&c).unwrap().collections[0].name, "新名称");
    }
    #[test]
    fn rejects_record_loss_and_invalid_properties() {
        let mut c = database();
        let mut w = read(&c).unwrap();
        w.collections.clear();
        assert!(save(&mut c, w).is_err());
        let mut w = read(&c).unwrap();
        w.collections[0].properties.push(Property {
            id: "a".into(),
            name: "命令".into(),
            kind: "execute".into(),
            options: vec![],
        });
        assert!(save(&mut c, w).is_err());
        assert_eq!(read(&c).unwrap().revision, 1);
    }

    #[test]
    fn typed_properties_archive_and_restore_round_trip() {
        let mut c = database();
        let mut w = read(&c).unwrap();
        for (id, kind, options) in [
            ("rating", "number", vec![]),
            ("ready", "checkbox", vec![]),
            ("link", "url", vec![]),
            ("due", "date", vec![]),
            ("priority", "select", vec!["高".into()]),
        ] {
            w.collections[1].properties.push(Property {
                id: id.into(),
                name: id.into(),
                kind: kind.into(),
                options,
            });
        }
        let mut item = page();
        item.values = BTreeMap::from([
            ("rating".into(), serde_json::json!(9.5)),
            ("ready".into(), serde_json::json!(true)),
            ("link".into(), serde_json::json!("https://example.com")),
            ("due".into(), serde_json::json!("2026-09-16")),
            ("priority".into(), serde_json::json!("高")),
        ]);
        w.items.push(item);
        let mut saved = save(&mut c, w).unwrap();
        assert_eq!(
            read(&c).unwrap().items[0].values["rating"],
            serde_json::json!(9.5)
        );
        saved.items[0].archived = true;
        let mut saved = save(&mut c, saved).unwrap();
        assert!(read(&c).unwrap().items[0].archived);
        saved.items[0].archived = false;
        save(&mut c, saved).unwrap();
        assert_eq!(read(&c).unwrap().items[0].body, "正文");
        assert!(!read(&c).unwrap().items[0].archived);
    }

    #[test]
    fn invalid_values_or_links_abort_the_entire_transaction() {
        let mut c = database();
        let mut w = read(&c).unwrap();
        w.collections[1].properties.push(Property {
            id: "url".into(),
            name: "URL".into(),
            kind: "url".into(),
            options: vec![],
        });
        let mut item = page();
        item.values
            .insert("url".into(), serde_json::json!("javascript:alert(1)"));
        w.items.push(item);
        assert!(save(&mut c, w).is_err());
        assert!(read(&c).unwrap().items.is_empty());
        assert!(read(&c).unwrap().collections[1].properties.is_empty());
    }

    #[test]
    fn cover_validation_rejects_remote_svg_malformed_and_oversized_images() {
        assert!(validate_cover("https://example.com/cover.png").is_err());
        assert!(validate_cover("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(validate_cover("data:image/png;base64,YWJj").is_err());
        assert!(validate_cover(&"x".repeat(512 * 1024 + 1)).is_err());
        let data = include_bytes!("../icons/32x32.png");
        let uri = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(data)
        );
        assert!(validate_cover(&uri).is_ok());
    }

    #[test]
    #[ignore = "Set CHATOBSIDIAN_TEST_CATALOG to a temporary, copied catalog; never the live database"]
    fn copied_legacy_catalog_preserves_vaults_and_operations() {
        let path = std::path::PathBuf::from(
            std::env::var("CHATOBSIDIAN_TEST_CATALOG").expect("temporary catalog required"),
        );
        let canonical = path.canonicalize().unwrap();
        assert!(canonical.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        let previous = Connection::open(&path).unwrap();
        let before_vaults = db::list_vaults(&previous).unwrap();
        let before_ops = db::list_operations(&previous, usize::MAX.min(10_000)).unwrap();
        drop(previous);
        let mut c = db::open(&path).unwrap();
        let w = load(&mut c).unwrap();
        assert_eq!(
            w.items.len(),
            before_vaults.iter().filter(|v| !v.is_template).count()
        );
        let w = save(&mut c, w).expect("migrated legacy metadata must remain editable");
        assert_eq!(read(&c).unwrap().items.len(), w.items.len());
        assert_eq!(db::list_vaults(&c).unwrap().len(), before_vaults.len());
        assert_eq!(
            db::list_operations(&c, 10_000).unwrap().len(),
            before_ops.len()
        );
        assert_eq!(
            c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        assert!(
            std::fs::read_dir(path.parent().unwrap())
                .unwrap()
                .flatten()
                .any(|e| e
                    .file_name()
                    .to_string_lossy()
                    .starts_with("catalog-before-workspace-v1-"))
        );
        println!(
            "Migrated copy: {} vaults, {} operations, {} pages; integrity ok",
            before_vaults.len(),
            before_ops.len(),
            w.items.len()
        );
    }
}
