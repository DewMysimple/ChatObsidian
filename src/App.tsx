import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowClockwise,
  ArrowSquareOut,
  SidebarSimple,
} from "@phosphor-icons/react";
import { Sidebar } from "./components/Sidebar";
import { Toast } from "./components/Toast";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { DatabaseView } from "./views/DatabaseView";
import { SettingsView } from "./views/SettingsView";
import { HistoryView } from "./views/HistoryView";
import { useAppStore } from "./store/appStore";
import { desktop, isTauri } from "./lib/desktop";
import { Modal } from "./components/Modal";

export function App() {
  const {
    view,
    collectionId,
    scope,
    workspace,
    loading,
    error,
    preferences,
    load,
    saving,
  } = useAppStore();
  const [collapsed, setCollapsed] = useState(false);
  const [quick, setQuick] = useState<string | null>(null);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);
  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as Element;
      document.querySelectorAll("details[open]").forEach((menu) => {
        if (!menu.contains(target)) menu.removeAttribute("open");
      });
    };
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listen("navigate-to-vaults", () =>
      useAppStore.getState().navigate("vaults"),
    ).then((unlisten) => {
      if (disposed) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    const show = (event: Event) =>
      setQuick((event as CustomEvent<string>).detail ?? "additive");
    const hide = () => setQuick(null);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        void desktop.showQuickSwitcher("additive");
      }
    };
    window.addEventListener("demo-quick-open", show);
    window.addEventListener("demo-quick-close", hide);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("demo-quick-open", show);
      window.removeEventListener("demo-quick-close", hide);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
  const title =
    view === "settings"
      ? "设置"
      : view === "history"
        ? "活动记录"
        : (workspace?.collections.find((c) => c.id === collectionId)?.name ??
          "仓库画廊");
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      {!collapsed && <Sidebar />}
      <main className="main-canvas">
        <header className="topbar">
          <div>
            <button
              className="icon-button"
              aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
              onClick={() => setCollapsed(!collapsed)}
            >
              <SidebarSimple size={20} />
            </button>
            <span className="breadcrumb-root">工作空间</span>
            <span className="breadcrumb-separator">/</span>
            <span>{title}</span>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span />
              {isTauri() ? "本地工作空间" : "浏览器演示"}
            </span>
            <button
              className="text-button"
              disabled={saving || loading}
              onClick={() => void load()}
              title="重新加载本地数据"
            >
              <ArrowClockwise size={15} />
              <span>刷新</span>
            </button>
            <button
              className="text-button"
              onClick={() => void desktop.showQuickSwitcher("additive")}
            >
              <ArrowSquareOut size={15} />
              <span>快速打开</span>
            </button>
          </div>
        </header>
        <section className="view-content" aria-busy={loading}>
          {loading ? (
            <div className="loading-shell">
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton-cards">
                {[0, 1, 2].map((i) => (
                  <div className="skeleton" key={i} />
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="empty-state" role="alert">
              <h1>暂时无法打开工作空间</h1>
              <p>{error}</p>
              <button className="button" onClick={() => void load()}>
                重新加载
              </button>
            </div>
          ) : view === "settings" ? (
            <SettingsView />
          ) : view === "history" ? (
            <HistoryView />
          ) : (
            workspace && <DatabaseView key={`${collectionId}:${scope}`} />
          )}
        </section>
      </main>
      <Toast />
      {quick && (
        <Modal
          title="快速打开"
          description="搜索仓库和笔记标题。"
          className="quick-preview-modal"
          onClose={() => setQuick(null)}
        >
          <QuickSwitcher
            initialMode={quick === "single" ? "single" : "additive"}
          />
        </Modal>
      )}
    </div>
  );
}
