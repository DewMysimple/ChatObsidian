import { useState } from "react";
import {
  newView,
  propertyLabels,
  type Collection,
  type DatabaseView,
  type PropertyKind,
} from "../contracts/workspace";
import { useAppStore } from "../store/appStore";
import { readableError } from "../lib/workspace";
import { Modal } from "./Modal";

export function CollectionDialog({
  collection,
  onClose,
}: {
  collection?: Collection;
  onClose: () => void;
}) {
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [icon, setIcon] = useState(collection?.icon ?? "▦");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mutate = useAppStore((s) => s.mutate);
  return (
    <Modal
      title={collection ? "编辑数据库" : "新建数据库"}
      description="给一组页面一个共同的家，每个数据库都有自己的属性和视图。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          const id = collection?.id ?? crypto.randomUUID();
          void mutate((w) => {
            const next = {
              id,
              name: name.trim(),
              description,
              icon,
              properties: collection?.properties ?? [],
            };
            if (collection)
              w.collections = w.collections.map((c) =>
                c.id === id ? next : c,
              );
            else {
              w.collections.push(next);
              w.views.push(
                newView(id),
                newView(id, "table", "表格"),
                newView(id, "board", "看板"),
              );
            }
          })
            .then(() => {
              useAppStore.getState().navigate(id);
              onClose();
            })
            .catch((err) => setError(readableError(err)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          <span>图标</span>
          <input
            aria-label="数据库图标"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            maxLength={8}
          />
        </label>
        <label className="field">
          <span>数据库名称</span>
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
          />
        </label>
        <label className="field">
          <span>描述</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={650}
            placeholder="你想在这里整理什么？"
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy || !name.trim()}>
          {busy ? "保存中…" : collection ? "保存数据库" : "创建数据库"}
        </button>
      </form>
    </Modal>
  );
}

export function PropertyDialog({
  collection,
  onClose,
}: {
  collection: Collection;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PropertyKind>("text");
  const [options, setOptions] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="添加属性"
      description="为这个数据库的每个页面添加一个字段。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (collection.properties.some((p) => p.name === name.trim())) {
            setError("已有同名属性。");
            return;
          }
          const values = [
            ...new Set(
              options
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ];
          if (kind === "select" && !values.length) {
            setError("请至少填写一个选项。");
            return;
          }
          setBusy(true);
          void useAppStore
            .getState()
            .mutate((w) => {
              const property = {
                id: crypto.randomUUID(),
                name: name.trim(),
                kind,
                options: values,
              };
              w.collections
                .find((c) => c.id === collection.id)!
                .properties.push(property);
              w.views
                .filter((v) => v.collectionId === collection.id)
                .forEach((v) => v.visibleProperties.push(property.id));
            })
            .then(onClose)
            .catch((err) => setError(readableError(err)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          <span>属性名称</span>
          <input
            autoFocus
            required
            maxLength={26}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：优先级、截止日期"
          />
        </label>
        <label className="field">
          <span>属性类型</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as PropertyKind)}
          >
            {Object.entries(propertyLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {kind === "select" && (
          <label className="field">
            <span>选项（逗号分隔）</span>
            <input
              value={options}
              maxLength={1000}
              onChange={(e) => setOptions(e.target.value)}
              placeholder="低, 中, 高"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy || !name.trim()}>
          添加属性
        </button>
      </form>
    </Modal>
  );
}

export function ViewDialog({
  view,
  onClose,
  onCreated,
}: {
  view: DatabaseView;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("新视图");
  const [layout, setLayout] = useState(view.layout);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="新建视图"
      description="沿用当前筛选与排序，为同一份数据保存另一种看法。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          const next = {
            ...view,
            id: crypto.randomUUID(),
            name: name.trim(),
            layout,
          };
          void useAppStore
            .getState()
            .mutate((w) => w.views.push(next))
            .then(() => {
              onCreated(next.id);
              onClose();
            })
            .catch((err) => setError(readableError(err)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          <span>视图名称</span>
          <input
            required
            autoFocus
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>布局</span>
          <select
            value={layout}
            onChange={(e) =>
              setLayout(e.target.value as DatabaseView["layout"])
            }
          >
            <option value="gallery">画廊</option>
            <option value="table">表格</option>
            <option value="board">看板</option>
          </select>
        </label>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy || !name.trim()}>
          创建视图
        </button>
      </form>
    </Modal>
  );
}
