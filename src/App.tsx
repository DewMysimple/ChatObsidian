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
    const timer = window.setInterval(() => {
      void desktop.checkActiveConfigChange().then((notice) => {
        if (notice) setPendingChange(notice);
      });
    }, 4000);
    return () => window.clearInterval(timer);
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
