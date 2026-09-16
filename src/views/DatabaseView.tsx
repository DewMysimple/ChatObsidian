import { useMemo, useState } from "react";
import {
  Archive,
  ArrowClockwise,
  ArrowDown,
  ArrowSquareOut,
  Check,
  DotsThree,
  FunnelSimple,
  MagnifyingGlass,
  Plus,
  SlidersHorizontal,
  SquaresFour,
  Star,
  Table,
  Kanban,
} from "@phosphor-icons/react";
import { useAppStore } from "../store/appStore";
import {
  newItem,
  statusLabels,
  type DatabaseView as View,
  type WorkspaceItem,
  type ItemStatus,
} from "../contracts/workspace";
import { selectItems, readableError } from "../lib/workspace";
import { desktop, isTauri } from "../lib/desktop";
import { CoverArt } from "../components/CoverArt";
import { ItemEditor } from "../components/ItemEditor";
import {
  CollectionDialog,
  PropertyDialog,
  ViewDialog,
} from "../components/DatabaseDialogs";

const layoutIcons = { gallery: SquaresFour, table: Table, board: Kanban };
export function DatabaseView() {
  const {
    workspace,
    collectionId,
    scope,
    vaults,
    scanning,
    saving,
    scan,
    mutate,
  } = useAppStore();
  const collection =
    workspace!.collections.find((c) => c.id === collectionId) ??
    workspace!.collections[0];
  const views = workspace!.views.filter(
    (v) => v.collectionId === collection.id,
  );
  const [activeId, setActiveId] = useState(() => {
    try {
      return localStorage.getItem(`view:${collection.id}`) ?? "";
    } catch {
      return "";
    }
  });
  const selected = views.find((v) => v.id === activeId) ?? views[0];
  const [search, setSearch] = useState(selected.search);
  const view = { ...selected, search };
  const [editing, setEditing] = useState<WorkspaceItem | null>(null);
  const [newPage, setNewPage] = useState(false);
  const [dialog, setDialog] = useState<
    "collection" | "property" | "view" | null
  >(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const items = useMemo(
    () => selectItems(workspace!.items, view, scope),
    [workspace, selected, search, scope],
  );
  const allItems = workspace!.items.filter(
    (i) => i.collectionId === collection.id && !i.archived,
  );
  const tags = [...new Set(allItems.flatMap((i) => i.tags))].sort();
  const updateView = (patch: Partial<View>) => {
    void mutate((w) => {
      Object.assign(w.views.find((v) => v.id === selected.id)!, patch);
    }).catch(() => undefined);
  };
  const activate = (id: string) => {
    setActiveId(id);
    setSearch(views.find((v) => v.id === id)?.search ?? "");
    try {
      localStorage.setItem(`view:${collection.id}`, id);
    } catch {
      /* View still works without storage. */
    }
  };
  const edit = (item: WorkspaceItem) => {
    setNewPage(false);
    setEditing(item);
  };
  const create = (status: ItemStatus = "idea") => {
    setNewPage(true);
    setEditing({ ...newItem(collection.id), status });
  };
  const favorite = (item: WorkspaceItem) => {
    void mutate((w) => {
      const target = w.items.find((i) => i.id === item.id)!;
      target.favorite = !target.favorite;
    }).catch(() => undefined);
  };
  async function openVault(item: WorkspaceItem) {
    if (!item.vaultId || opening) return;
    setOpening(item.id);
    try {
      await desktop.openVault(item.vaultId, undefined, "additive");
      useAppStore.getState().showToast({
        tone: "success",
        message: isTauri()
          ? "已发送打开请求"
          : "演示模式：桌面版会在这里打开 Obsidian",
      });
    } catch (error) {
      useAppStore
        .getState()
        .showToast({ tone: "danger", message: readableError(error) });
    } finally {
      setOpening(null);
    }
  }
  const card = (item: WorkspaceItem) => {
    const vault = vaults.find((v) => v.id === item.vaultId);
    return (
      <article
        key={item.id}
        className="database-card"
        draggable={!saving && !scanning && selected.layout === "board"}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", item.id);
          setDragId(item.id);
        }}
        onDragEnd={() => setDragId(null)}
      >
        <button
          className="card-main"
          onClick={() => edit(item)}
          aria-label={`编辑 ${item.title}`}
        >
          {view.preview === "cover" && (
            <CoverArt
              cover={item.cover}
              image={item.coverImage}
              fit={view.fitImage}
            />
          )}
          {view.preview === "content" && (
            <div className="content-preview">
              {item.body || item.description || "留一处空白，给下一个想法。"}
            </div>
          )}
          <div className="card-copy">
            <h3>
              <span className="item-symbol">{item.icon}</span>
              {item.title}
            </h3>
            {view.showDescription && (
              <p>
                {item.description ||
                  (vault
                    ? `${vault.groupName} · ${vault.noteCount.toLocaleString()} 篇笔记`
                    : "点击打开页面，添加你的想法。")}
              </p>
            )}
            <div className="card-properties">
              {view.showStatus && <Status status={item.status} />}
              {view.showTags &&
                item.tags.slice(0, 2).map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
            </div>
            {view.visibleProperties.length > 0 && (
              <div className="custom-properties">
                {collection.properties
                  .filter(
                    (p) =>
                      view.visibleProperties.includes(p.id) &&
                      item.values[p.id] !== undefined &&
                      item.values[p.id] !== "",
                  )
                  .map((p) => (
                    <span key={p.id}>
                      {p.name} <strong>{valueText(item.values[p.id])}</strong>
                    </span>
                  ))}
              </div>
            )}
          </div>
        </button>
        <footer className="card-footer">
          <span>
            {vault ? (
              <>
                <span
                  className={`status-dot ${vault.isOpen ? "online" : ""}`}
                />
                {vault.health !== "healthy"
                  ? "路径不可用"
                  : vault.isOpen
                    ? "已打开"
                    : `${vault.noteCount.toLocaleString()} 篇笔记`}
              </>
            ) : (
              `更新于 ${new Date(item.updatedAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}`
            )}
          </span>
          <div>
            <button
              className={`icon-button favorite-button ${item.favorite ? "is-favorite" : ""}`}
              aria-label={`${item.favorite ? "取消收藏" : "收藏"} ${item.title}`}
              disabled={saving || scanning}
              onClick={() => favorite(item)}
            >
              <Star size={16} weight={item.favorite ? "fill" : "regular"} />
            </button>
            {vault && (
              <button
                className="icon-button"
                disabled={!!opening || vault.health !== "healthy"}
                aria-label={`增量打开 ${item.title}`}
                onClick={() => void openVault(item)}
              >
                <ArrowSquareOut size={16} />
              </button>
            )}
          </div>
        </footer>
      </article>
    );
  };
  return (
    <div className="database-page">
      <header className="page-heading">
        <div className="page-emblem">
          {scope === "archive" ? (
            <Archive size={42} weight="light" />
          ) : scope === "favorites" ? (
            <Star size={42} weight="light" />
          ) : (
            collection.icon
          )}
        </div>
        <div className="page-heading-line">
          <h1>
            {collection.name}
            {scope === "favorites"
              ? " · 收藏"
              : scope === "archive"
                ? " · 归档"
                : ""}
          </h1>
          <button
            className="icon-button"
            aria-label="编辑数据库"
            onClick={() => setDialog("collection")}
          >
            <DotsThree size={25} />
          </button>
        </div>
        <p>
          {scope === "archive"
            ? "暂时收起来的页面，随时可以恢复。"
            : collection.description}
        </p>
      </header>
      <div className="database-toolbar">
        <div className="view-tabs" role="tablist" aria-label="数据库视图">
          {views.map((v) => {
            const Icon = layoutIcons[v.layout];
            return (
              <button
                role="tab"
                aria-selected={v.id === selected.id}
                key={v.id}
                onClick={() => activate(v.id)}
              >
                <Icon size={17} />
                {v.name}
              </button>
            );
          })}
          <button
            className="icon-button"
            aria-label="添加视图"
            onClick={() => setDialog("view")}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="toolbar-actions">
          <details className="popover">
            <summary
              aria-label="筛选"
              className={view.status || view.tag ? "active-filter" : ""}
            >
              <FunnelSimple size={17} />
              <span>筛选</span>
            </summary>
            <div className="popover-panel">
              <strong>筛选页面</strong>
              <label>
                状态
                <select
                  aria-label="筛选状态"
                  value={view.status}
                  onChange={(e) =>
                    updateView({ status: e.target.value as View["status"] })
                  }
                >
                  <option value="">全部状态</option>
                  {Object.entries(statusLabels).map(([id, label]) => (
                    <option value={id} key={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                标签
                <select
                  aria-label="筛选标签"
                  value={view.tag}
                  onChange={(e) => updateView({ tag: e.target.value })}
                >
                  <option value="">全部标签</option>
                  {tags.map((tag) => (
                    <option key={tag}>{tag}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => {
                  setSearch("");
                  updateView({ search: "", status: "", tag: "" });
                }}
              >
                清除筛选
              </button>
            </div>
          </details>
          <details className="popover">
            <summary aria-label="排序">
              <ArrowDown size={16} />
              <span>排序</span>
            </summary>
            <div className="popover-panel">
              <strong>排序方式</strong>
              {(
                [
                  ["manual", "默认顺序"],
                  ["title", "名称 A → Z"],
                  ["updated", "最近更新"],
                  ["created", "最近创建"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} onClick={() => updateView({ sort: id })}>
                  {label}
                  {view.sort === id && <Check size={15} />}
                </button>
              ))}
            </div>
          </details>
          <details className="popover">
            <summary aria-label="视图设置">
              <SlidersHorizontal size={18} />
            </summary>
            <div className="popover-panel">
              <strong>视图设置</strong>
              <label>
                卡片大小
                <select
                  aria-label="卡片大小"
                  value={view.cardSize}
                  onChange={(e) =>
                    updateView({ cardSize: e.target.value as View["cardSize"] })
                  }
                >
                  <option value="small">小</option>
                  <option value="medium">中</option>
                  <option value="large">大</option>
                </select>
              </label>
              <label>
                卡片预览
                <select
                  aria-label="卡片预览"
                  value={view.preview}
                  onChange={(e) =>
                    updateView({ preview: e.target.value as View["preview"] })
                  }
                >
                  <option value="cover">页面封面</option>
                  <option value="content">页面内容</option>
                  <option value="none">无预览</option>
                </select>
              </label>
              {(
                [
                  ["fitImage", "完整显示封面"],
                  ["showDescription", "描述"],
                  ["showStatus", "状态"],
                  ["showTags", "标签"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={!!view[key]}
                    onChange={(e) => updateView({ [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
              {collection.properties.map((p) => (
                <label className="checkbox-row" key={p.id}>
                  <input
                    type="checkbox"
                    checked={view.visibleProperties.includes(p.id)}
                    onChange={(e) =>
                      updateView({
                        visibleProperties: e.target.checked
                          ? [...view.visibleProperties, p.id]
                          : view.visibleProperties.filter((id) => id !== p.id),
                      })
                    }
                  />
                  {p.name}
                </label>
              ))}
              <button onClick={() => setDialog("property")}>
                <Plus size={16} />
                添加属性
              </button>
            </div>
          </details>
          <button
            className="button primary new-page-button"
            disabled={saving || scanning}
            onClick={() => create()}
          >
            <Plus size={15} />
            新建页面
          </button>
        </div>
      </div>
      <div className="database-subbar">
        <span>
          {items.length} 个{collection.id === "vaults" ? "条目" : "页面"}
          {scope === "all" &&
            ` · ${allItems.filter((i) => i.favorite).length} 个收藏`}
        </span>
        <div>
          {collection.id === "vaults" && (
            <button
              className="text-button"
              disabled={scanning || saving}
              onClick={() => void scan()}
            >
              <ArrowClockwise size={14} className={scanning ? "spin" : ""} />
              {scanning ? "扫描中…" : "扫描仓库"}
            </button>
          )}
          <label className="database-search">
            <MagnifyingGlass size={16} />
            <input
              aria-label="搜索当前数据库"
              placeholder="搜索页面…"
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => {
                if (search !== selected.search) updateView({ search });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </label>
        </div>
      </div>
      {(view.status || view.tag) && (
        <div className="filter-chips">
          {view.status && (
            <button onClick={() => updateView({ status: "" })}>
              状态：{statusLabels[view.status]} ×
            </button>
          )}
          {view.tag && (
            <button onClick={() => updateView({ tag: "" })}>
              标签：{view.tag} ×
            </button>
          )}
        </div>
      )}
      {!items.length ? (
        <div className="empty-state">
          <SquaresFour size={40} weight="light" />
          <h2>
            {search || view.status || view.tag
              ? "没有匹配的页面"
              : scope === "archive"
                ? "归档里还没有页面"
                : scope === "favorites"
                  ? "把常用页面收藏到这里"
                  : "从第一个页面开始"}
          </h2>
          <p>
            {search || view.status || view.tag
              ? "试试其他关键词，或清除筛选。"
              : "每个想法，都值得有一个自己的位置。"}
          </p>
          <button
            className="button"
            onClick={() => {
              if (search || view.status || view.tag) {
                setSearch("");
                updateView({ search: "", status: "", tag: "" });
              } else create();
            }}
          >
            {search || view.status || view.tag ? "清除筛选" : "新建页面"}
          </button>
        </div>
      ) : selected.layout === "table" ? (
        <div className="database-table-wrap">
          <table className="database-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>状态</th>
                <th>标签</th>
                {collection.properties
                  .filter((p) => view.visibleProperties.includes(p.id))
                  .map((p) => (
                    <th key={p.id}>{p.name}</th>
                  ))}
                <th>最近更新</th>
                <th>
                  <button
                    className="text-button"
                    onClick={() => setDialog("property")}
                  >
                    <Plus size={14} />
                    属性
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button onClick={() => edit(item)}>
                      <span className="item-symbol">{item.icon}</span>
                      <strong>{item.title}</strong>
                      {item.favorite && <Star size={13} weight="fill" />}
                    </button>
                  </td>
                  <td>
                    <Status status={item.status} />
                  </td>
                  <td>
                    {item.tags.map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </td>
                  {collection.properties
                    .filter((p) => view.visibleProperties.includes(p.id))
                    .map((p) => (
                      <td key={p.id}>{valueText(item.values[p.id])}</td>
                    ))}
                  <td className="muted">
                    {new Date(item.updatedAt).toLocaleDateString("zh-CN")}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`编辑 ${item.title}`}
                      onClick={() => edit(item)}
                    >
                      <ArrowSquareOut size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : selected.layout === "board" ? (
        <div className="database-board">
          {(Object.entries(statusLabels) as [ItemStatus, string][]).map(
            ([status, label]) => (
              <section
                className={`board-column ${dragId ? "accepts-drop" : ""}`}
                key={status}
                aria-label={label}
                onDragOver={(e) => {
                  if (dragId) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragId;
                  setDragId(null);
                  if (id)
                    void mutate((w) => {
                      const target = w.items.find(
                        (i) => i.id === id && i.collectionId === collection.id,
                      );
                      if (target) target.status = status;
                    }).catch(() => undefined);
                }}
              >
                <header>
                  <Status status={status} />
                  <span>{items.filter((i) => i.status === status).length}</span>
                  <button
                    className="icon-button"
                    aria-label={`在${label}中新建页面`}
                    onClick={() => create(status)}
                  >
                    <Plus size={16} />
                  </button>
                </header>
                {items.filter((i) => i.status === status).map(card)}
                <button className="board-new" onClick={() => create(status)}>
                  <Plus size={16} />
                  新建
                </button>
              </section>
            ),
          )}
        </div>
      ) : (
        <div className={`gallery-grid size-${view.cardSize}`}>
          {items.map(card)}
          {scope === "all" && (
            <button className="gallery-new" onClick={() => create()}>
              <Plus size={22} />
              <span>新建页面</span>
            </button>
          )}
        </div>
      )}
      <footer className="database-footnote">
        总计 {items.length} 个条目
        <span className="save-indicator">
          {saving ? "正在保存…" : "已保存到本地"}
        </span>
      </footer>
      {editing && (
        <ItemEditor
          key={editing.id}
          item={editing}
          collection={collection}
          vault={vaults.find((v) => v.id === editing.vaultId)}
          isNew={newPage}
          onClose={() => setEditing(null)}
        />
      )}
      {dialog === "collection" && (
        <CollectionDialog
          collection={collection}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "property" && (
        <PropertyDialog
          collection={collection}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "view" && (
        <ViewDialog
          view={view}
          onClose={() => setDialog(null)}
          onCreated={(id) => activate(id)}
        />
      )}
    </div>
  );
}

export function Status({ status }: { status: ItemStatus }) {
  return (
    <span className={`status-pill status-${status}`}>
      <span />
      {statusLabels[status]}
    </span>
  );
}
function valueText(value: WorkspaceItem["values"][string] | undefined) {
  return value === true ? "✓" : value === false ? "—" : (value ?? "—");
}
