import { useState } from "react";
import {
  FolderOpen,
  GearSix,
  Keyboard,
  Moon,
  Sun,
} from "@phosphor-icons/react";
import type { AppPreferences, ShortcutBindings } from "../contracts/desktop";
import { desktop, isTauri } from "../lib/desktop";
import { readableError } from "../lib/workspace";
import { useAppStore } from "../store/appStore";

// Keep one queue across mount/unmount. Every update reads the last committed
// settings so rapid toggles cannot restore an older snapshot.
let preferenceQueue: Promise<void> = Promise.resolve();
export function savePreference(
  change: (current: AppPreferences) => AppPreferences,
): Promise<void> {
  const task = preferenceQueue.then(async () => {
    const saved = await desktop.savePreferences(
      change(useAppStore.getState().preferences),
    );
    useAppStore.getState().setPreferences(saved);
  });
  preferenceQueue = task.catch(() => undefined);
  return task;
}

export function SettingsView() {
  const preferences = useAppStore((s) => s.preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(change: (p: AppPreferences) => AppPreferences) {
    setSaving(true);
    setError("");
    try {
      await savePreference(change);
    } catch (err) {
      setError(readableError(err));
      useAppStore
        .getState()
        .showToast({ tone: "danger", message: readableError(err) });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="document-page settings-page">
      <header className="page-heading">
        <div className="page-emblem">
          <GearSix size={44} weight="light" />
        </div>
        <h1>让空间更合你意</h1>
        <p>外观、打开方式，以及你的本地仓库。</p>
      </header>
      <section className="settings-section">
        <h2>外观</h2>
        <p>纸白与墨黑，让内容成为主角。</p>
        <div className="theme-options">
          {(
            [
              ["light", "浅色", Sun],
              ["dark", "深色", Moon],
              ["system", "跟随系统", GearSix],
            ] as const
          ).map(([theme, label, Icon]) => (
            <button
              key={theme}
              className={preferences.theme === theme ? "is-selected" : ""}
              onClick={() => void save((p) => ({ ...p, theme }))}
            >
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <h2>窗口与打开</h2>
        <label className="settings-row">
          <span>
            <strong>默认打开方式</strong>
            <small>快捷弹窗未指定模式时使用。</small>
          </span>
          <select
            aria-label="默认打开方式"
            value={preferences.switchPolicy}
            onChange={(e) => {
              const switchPolicy = e.target
                .value as AppPreferences["switchPolicy"];
              void save((p) => ({ ...p, switchPolicy }));
            }}
          >
            <option value="additive">增量打开</option>
            <option value="single">单量打开</option>
            <option value="native">Obsidian 原生</option>
          </select>
        </label>
        <p className="settings-callout">
          增量打开保留其他仓库。单量打开会正常关闭其他 Obsidian
          窗口；目标在其他桌面时会正常关闭后重开。关闭超时将停止操作。
        </p>
        {(
          [
            [
              "closeToTray",
              "关闭窗口后留在托盘",
              "继续使用全局快捷键，托盘菜单可完全退出。",
            ],
            [
              "launchAtStartup",
              "登录 Windows 时启动",
              "静默驻留托盘，不自动弹出主窗口。",
            ],
          ] as const
        ).map(([key, title, detail]) => (
          <label className="settings-row" key={key}>
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
            <input
              type="checkbox"
              checked={preferences[key]}
              onChange={(e) => {
                const checked = e.target.checked;
                void save((p) => ({ ...p, [key]: checked }));
              }}
            />
          </label>
        ))}
      </section>
      <section className="settings-section">
        <h2>
          <Keyboard size={19} /> 全局快捷键
        </h2>
        <p>输入组合键名称，离开输入框时自动保存。三个快捷键不能重复。</p>
        {(
          [
            ["showVaultCenter", "显示工作空间"],
            ["singleOpen", "单量打开弹窗"],
            ["additiveOpen", "增量打开弹窗"],
          ] as [keyof ShortcutBindings, string][]
        ).map(([key, label]) => (
          <ShortcutField
            key={key}
            label={label}
            value={preferences.shortcuts[key]}
            onSave={(value) =>
              save((p) => ({
                ...p,
                shortcuts: { ...p.shortcuts, [key]: value },
              }))
            }
          />
        ))}
      </section>
      <section className="settings-section">
        <h2>仓库来源</h2>
        <p>自动读取 Obsidian 登记的仓库，也可以扫描以下目录。</p>
        <div className="root-list">
          {preferences.scanRoots.map((root) => (
            <div key={root}>
              <FolderOpen size={17} />
              <code>{root}</code>
              <button
                disabled={preferences.scanRoots.length === 1}
                onClick={() =>
                  void save((p) => ({
                    ...p,
                    scanRoots: p.scanRoots.filter((r) => r !== root),
                  }))
                }
              >
                移除
              </button>
            </div>
          ))}
        </div>
        <button
          className="button"
          onClick={() => {
            void desktop
              .selectDirectory()
              .then((path) => {
                if (path)
                  return save((p) => ({
                    ...p,
                    scanRoots: [...new Set([...p.scanRoots, path])],
                  }));
                if (!isTauri())
                  useAppStore.getState().showToast({
                    tone: "neutral",
                    message: "请在桌面版中选择本地目录",
                  });
              })
              .catch((err) => setError(readableError(err)));
          }}
        >
          <FolderOpen size={16} />
          添加扫描目录
        </button>
      </section>
      <section className="settings-section">
        <h2>数据快照</h2>
        <p>
          导出全部页面、属性和视图为 JSON
          文件，方便归档或迁移。仓库笔记正文不包含在导出中。
        </p>
        <button
          className="button"
          style={{ marginTop: 16 }}
          onClick={() =>
            void desktop
              .exportWorkspace()
              .then((path) => {
                if (path)
                  useAppStore
                    .getState()
                    .showToast({ tone: "success", message: `已导出：${path}` });
              })
              .catch((err) => setError(readableError(err)))
          }
        >
          导出工作台
        </button>
      </section>
      <section className="settings-section">
        <h2>关于这个空间</h2>
        <p>ChatObsidian 0.1.15 · React + Vite + Tauri</p>
        <p>
          页面、属性与视图保存在应用数据库中；扫描只读取仓库和笔记标题。归档可以恢复。旧版同步备份和操作记录继续保留。
        </p>
        <p className="muted">
          界面设计受到 Notion 启发。本应用独立开发，与 Notion 无隶属关系。
        </p>
      </section>
      <div
        className={`settings-save-status ${error ? "inline-error" : ""}`}
        role="status"
      >
        {error || (saving ? "正在保存…" : "所有设置已自动保存")}
      </div>
    </div>
  );
}
function ShortcutField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <label className="settings-row">
      <span>{label}</span>
      <input
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value)
            void onSave(draft.trim()).then(() =>
              setDraft(
                useAppStore.getState().preferences.shortcuts[
                  label === "显示工作空间"
                    ? "showVaultCenter"
                    : label === "单量打开弹窗"
                      ? "singleOpen"
                      : "additiveOpen"
                ],
              ),
            );
        }}
        placeholder="Ctrl+Alt+O"
      />
    </label>
  );
}
