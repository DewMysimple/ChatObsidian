import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { Toast } from './components/Toast';
import { ConfigChangeBanner } from './components/ConfigChangeBanner';
import { VaultCenter } from './views/VaultCenter';
import { SyncCenter } from './views/SyncCenter';
import { TemplateView } from './views/TemplateView';
import { ToolsView } from './views/ToolsView';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';
import { desktop } from './lib/desktop';
import { useAppStore } from './store/appStore';
import { isTauri } from './lib/desktop';

const views = {
  vaults: VaultCenter,
  sync: SyncCenter,
  template: TemplateView,
  tools: ToolsView,
  history: HistoryView,
  settings: SettingsView,
};

export function App() {
  const view = useAppStore((state) => state.view);
  const load = useAppStore((state) => state.load);
  const loading = useAppStore((state) => state.loading);
  const preferences = useAppStore((state) => state.preferences);
  const setPendingChange = useAppStore((state) => state.setPendingChange);
  const ActiveView = views[view];

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen('navigate-to-vaults', () => useAppStore.getState().setView('vaults')).then((cleanup) => {
      if (disposed) cleanup(); else unlisten = cleanup;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preferences.theme;
    if (preferences.theme === 'system') delete root.dataset.resolvedTheme;
  }, [preferences.theme]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    // Configuration checks touch the local filesystem. Keep at most one IPC
    // request in flight: if a slow disk or a large vault makes a check take
    // longer than the interval, the next tick must be skipped instead of
    // creating an unbounded spawn_blocking queue and eventually freezing the
    // WebView. Hidden tray windows also have no reason to poll.
    const check = () => {
      if (disposed || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      void desktop.checkActiveConfigChange()
        .then((notice) => {
          if (!disposed && notice) setPendingChange(notice);
        })
        .catch(() => {
          // A transient IPC/filesystem failure should not create an
          // unhandled rejection or stop future checks.
        })
        .finally(() => {
          inFlight = false;
        });
    };

    const timer = window.setInterval(check, 4000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    check();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [setPendingChange]);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-canvas">
        <Topbar />
        <ConfigChangeBanner />
        <section className="view-content" aria-busy={loading}>
          {loading ? <LoadingShell /> : <ActiveView />}
        </section>
      </main>
      <Toast />
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="loading-shell" aria-label="正在加载仓库数据">
      <div className="skeleton skeleton-summary" />
      <div className="skeleton skeleton-toolbar" />
      <div className="skeleton skeleton-list" />
    </div>
  );
}
