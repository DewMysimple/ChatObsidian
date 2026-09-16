import { useRef, useState } from "react";
import {
  Archive,
  ArrowSquareOut,
  Check,
  FolderOpen,
  Star,
} from "@phosphor-icons/react";
import {
  covers,
  coverLabels,
  statusLabels,
  type Collection,
  type Property,
  type WorkspaceItem,
} from "../contracts/workspace";
import type { OpenMode, VaultRecord } from "../contracts/desktop";
import { useAppStore } from "../store/appStore";
import { desktop, isTauri } from "../lib/desktop";
import { readableError } from "../lib/workspace";
import { prepareCover } from "../lib/coverImage";
import { displayWindowsPath } from "../lib/pathDisplay";
import { CoverArt } from "./CoverArt";
import { Modal } from "./Modal";

export function ItemEditor({
  item,
  collection,
  vault,
  isNew,
  onClose,
}: {
  item: WorkspaceItem;
  collection: Collection;
  vault?: VaultRecord;
  isNew?: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(item));
  const [busy, setBusy] = useState(false);
  const [tagsText, setTagsText] = useState(item.tags.join(", "));
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const lock = useRef(false);
  const mutate = useAppStore((s) => s.mutate);
  const dirty =
    isNew ||
    JSON.stringify(draft) !== JSON.stringify(item) ||
    tagsText !== item.tags.join(", ");
  const update = (patch: Partial<WorkspaceItem>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const close = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  async function save(archived = draft.archived) {
    if (lock.current) return;
    if (!draft.title.trim()) {
      setError("请填写页面标题。");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await mutate((w) => {
        const next = {
          ...draft,
          title: draft.title.trim(),
          tags: [
            ...new Set(
              tagsText
                .split(/[,，]/)
                .map((v) => v.trim())
                .filter(Boolean),
            ),
          ],
          archived,
          updatedAt: Date.now(),
        };
        if (isNew) w.items.push(next);
        else
          w.items = w.items.map((record) =>
            record.id === item.id ? next : record,
          );
      });
      onClose();
    } catch (err) {
      setError(readableError(err));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function open(mode: OpenMode) {
    if (!vault || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await desktop.openVault(vault.id, undefined, mode);
      useAppStore.getState().showToast({
        tone: "success",
        message: isTauri()
          ? "已发送打开请求"
          : "演示模式：桌面版会在这里打开 Obsidian",
      });
    } catch (err) {
      setError(readableError(err));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={collection.name}
      description="编辑页面与属性，保存到本地工作台。"
      onClose={close}
      className="page-editor"
    >
      <CoverArt cover={draft.cover} image={draft.coverImage} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy} className="editor-fields">
          <div className="editor-icon-row">
            <input
              aria-label="页面图标"
              className="page-icon-input"
              value={draft.icon}
              maxLength={8}
              onChange={(e) => update({ icon: e.target.value })}
            />
            <label className="cover-upload">
              上传封面
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="上传封面图片"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file || lock.current) return;
                  setBusy(true);
                  lock.current = true;
                  setError("");
                  void prepareCover(file)
                    .then((coverImage) => update({ coverImage }))
                    .catch((err) => setError(readableError(err)))
                    .finally(() => {
                      lock.current = false;
                      setBusy(false);
                    });
                  event.target.value = "";
                }}
              />
            </label>
            <div className="cover-swatches" aria-label="选择封面">
              {covers.map((cover) => (
                <button
                  key={cover}
                  type="button"
                  aria-label={`${coverLabels[cover]}封面`}
                  aria-pressed={draft.cover === cover}
                  className={`cover-swatch cover-${cover}`}
                  onClick={() => update({ cover, coverImage: null })}
                >
                  {draft.cover === cover && <Check size={13} />}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label={draft.favorite ? "取消收藏页面" : "收藏页面"}
              className="icon-button"
              onClick={() => update({ favorite: !draft.favorite })}
            >
              <Star size={20} weight={draft.favorite ? "fill" : "regular"} />
            </button>
          </div>
          <input
            className="page-title-input"
            aria-label="页面标题"
            value={draft.title}
            maxLength={100}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="未命名页面"
          />
          <input
            className="page-description-input"
            aria-label="页面描述"
            value={draft.description}
            maxLength={650}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="添加一段简短描述…"
          />
          <div className="property-list">
            <label>
              <span>◉　状态</span>
              <select
                aria-label="页面状态"
                value={draft.status}
                onChange={(e) =>
                  update({ status: e.target.value as WorkspaceItem["status"] })
                }
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>≡　标签</span>
              <input
                aria-label="页面标签"
                value={tagsText}
                placeholder="用逗号分隔标签"
                maxLength={500}
                onChange={(e) => setTagsText(e.target.value)}
              />
            </label>
            {collection.properties.map((property) => (
              <label key={property.id}>
                <span>{property.name}</span>
                <PropertyInput
                  property={property}
                  value={draft.values[property.id]}
                  onChange={(value) =>
                    update({
                      values: { ...draft.values, [property.id]: value },
                    })
                  }
                />
              </label>
            ))}
            {vault && (
              <>
                <div>
                  <span>▤　笔记</span>
                  <span>{vault.noteCount.toLocaleString()} 篇</span>
                </div>
                <div>
                  <span>↗　位置</span>
                  <code title={displayWindowsPath(vault.path)}>
                    {displayWindowsPath(vault.path)}
                  </code>
                </div>
              </>
            )}
            <div>
              <span>◷　创建时间</span>
              <span>
                {new Date(draft.createdAt).toLocaleDateString("zh-CN")}
              </span>
            </div>
          </div>
          {vault && (
            <div className="vault-open-panel">
              <div className="button-row">
                <button
                  type="button"
                  className="button primary"
                  disabled={vault.health !== "healthy"}
                  onClick={() => void open("additive")}
                >
                  <ArrowSquareOut size={16} />
                  增量打开
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={vault.health !== "healthy"}
                  onClick={() => void open("single")}
                >
                  单量打开
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="打开仓库目录"
                  onClick={() =>
                    void desktop
                      .openLocalPath(vault.path)
                      .catch((err) => setError(readableError(err)))
                  }
                >
                  <FolderOpen size={19} />
                </button>
              </div>
              <small>
                {vault.health !== "healthy"
                  ? "仓库目录不可用，请检查路径并重新扫描。"
                  : "增量保留其他仓库；单量会请求正常关闭其他 Obsidian 窗口。"}
              </small>
            </div>
          )}
          <label className="body-label" htmlFor="page-body">
            笔记与想法
          </label>
          <textarea
            id="page-body"
            className="page-body-input"
            value={draft.body}
            maxLength={30000}
            onChange={(e) => update({ body: e.target.value })}
            placeholder="在这里记录想法、计划或说明…"
          />
        </fieldset>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {discard && (
          <div className="discard-prompt" role="alert">
            有尚未保存的修改。
            <button type="button" onClick={() => setDiscard(false)}>
              继续编辑
            </button>
            <button type="button" onClick={onClose}>
              放弃修改
            </button>
          </div>
        )}
        <footer className="editor-footer">
          <button
            type="button"
            className="button quiet"
            disabled={busy || isNew}
            onClick={() => void save(!draft.archived)}
          >
            <Archive size={16} />
            {draft.archived ? "恢复页面" : "归档页面"}
          </button>
          <span>仅保存到 ChatObsidian</span>
          <button className="button primary" disabled={busy}>
            {busy ? "处理中…" : "保存页面"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function PropertyInput({
  property,
  value,
  onChange,
}: {
  property: Property;
  value: WorkspaceItem["values"][string] | undefined;
  onChange: (value: WorkspaceItem["values"][string]) => void;
}) {
  if (property.kind === "checkbox")
    return (
      <input
        type="checkbox"
        aria-label={property.name}
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  if (property.kind === "select")
    return (
      <select
        aria-label={property.name}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">未设置</option>
        {property.options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  return (
    <input
      aria-label={property.name}
      type={
        property.kind === "number"
          ? "number"
          : property.kind === "date"
            ? "date"
            : property.kind === "url"
              ? "url"
              : "text"
      }
      step="any"
      maxLength={650}
      placeholder="未设置"
      value={typeof value === "boolean" ? "" : (value ?? "")}
      onChange={(e) =>
        onChange(
          property.kind === "number" && e.target.value
            ? Number(e.target.value)
            : e.target.value,
        )
      }
    />
  );
}
