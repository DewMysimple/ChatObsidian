import { MagnifyingGlass, Moon, SidebarSimple, Sun } from '@phosphor-icons/react';
import { desktop } from '../lib/desktop';
import { useAppStore } from '../store/appStore';

const pageCopy = {
  vaults: ['VAULT CONTROL', '仓库中心', '整理、搜索并切换全部本地仓库'],
  sync: ['CONFIGURATION FLOW', '同步中心', '先比较，再备份，最后写入'],
  template: ['SOURCE OF TRUTH', '配置模板', '管理全局模板与仓库例外'],
  tools: ['PYTHON TOOLKIT', '工具箱', '原样运行现有维护脚本'],
  history: ['LOCAL AUDIT', '任务记录', '查看每次切换、同步与恢复'],
  settings: ['APPLICATION', '偏好设置', '调整窗口、目录与保留策略'],
} as const;

export function Topbar() {
  const view = useAppStore((state) => state.view);
  const preferences = useAppStore((state) => state.preferences);
  const setPreferences = useAppStore((state) => state.setPreferences);
  const showToast = useAppStore((state) => state.showToast);
  const [eyebrow, title, description] = pageCopy[view];
  const quickShortcut = preferences.switchPolicy === 'single' ? preferences.shortcuts.singleOpen : preferences.shortcuts.additiveOpen;

  const cycleTheme = () => {
    const theme = preferences.theme === 'system' ? 'light' : preferences.theme === 'light' ? 'dark' : 'system';
    const next = { ...preferences, theme } as typeof preferences;
    setPreferences(next);
    void desktop.savePreferences(next).then(setPreferences).catch((error) => {
      setPreferences(preferences);
      showToast({ tone: 'danger', message: `主题设置未保存：${String(error)}` });
    });
  };

  return (
    <header className="topbar">
      <div className="title-block">
        <p className="page-eyebrow">{eyebrow}</p>
        <div className="title-line">
          <h1>{title}</h1>
          <span>{description}</span>
        </div>
      </div>
      <div className="topbar-actions">
        <button className="status-chip" type="button" onClick={() => void desktop.showQuickSwitcher()}>
          <SidebarSimple size={15} />
          <span>{quickShortcut.replaceAll('+', ' + ').toUpperCase()}</span>
        </button>
        <button className="icon-button" type="button" aria-label="打开快速切换器" onClick={() => void desktop.showQuickSwitcher()}>
          <MagnifyingGlass size={19} />
        </button>
        <button className="icon-button" type="button" aria-label="切换主题" onClick={cycleTheme}>
          {preferences.theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
      </div>
    </header>
  );
}
