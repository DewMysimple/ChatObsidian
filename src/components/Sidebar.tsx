import {
  ArrowsClockwise,
  ClockCounterClockwise,
  GearSix,
  SquaresFour,
  TerminalWindow,
  Tray,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppStore, type ViewId } from '../store/appStore';

const nav: Array<{ id: ViewId; label: string; icon: Icon }> = [
  { id: 'vaults', label: '仓库中心', icon: SquaresFour },
  { id: 'sync', label: '同步中心', icon: ArrowsClockwise },
  { id: 'template', label: '配置模板', icon: Tray },
  { id: 'tools', label: '工具箱', icon: TerminalWindow },
  { id: 'history', label: '任务记录', icon: ClockCounterClockwise },
  { id: 'settings', label: '偏好设置', icon: GearSix },
];

export function Sidebar() {
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const vaults = useAppStore((state) => state.vaults);
  const pending = useAppStore((state) => state.pendingChange);
  const active = vaults.find((vault) => vault.isOpen);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="brand-copy">
          <strong>ChatObsidian</strong>
          <small>VAULT DESK</small>
        </div>
      </div>

      <p className="nav-label">LOCAL VAULTS</p>
      <nav className="nav-list" aria-label="主要导航">
        {nav.map(({ id, label, icon: NavIcon }) => (
          <button
            className={`nav-item ${view === id ? 'is-active' : ''}`}
            key={id}
            onClick={() => setView(id)}
            type="button"
          >
            <NavIcon size={18} weight={view === id ? 'fill' : 'regular'} />
            <span>{label}</span>
            {id === 'sync' && pending ? <span className="nav-count">1</span> : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />
      <section className="active-vault-card" aria-label="当前仓库">
        <div className="status-line">
          <span className={`semantic-dot ${active ? 'is-online' : ''}`} />
          <span>{active ? 'OBSIDIAN 已连接' : 'OBSIDIAN 空闲'}</span>
        </div>
        <strong>{active?.displayName ?? '没有打开的仓库'}</strong>
        <small>{active ? active.groupName : '从仓库中心开始工作'}</small>
        <div className="engine-rule" />
        <div className="status-line muted">
          <span>标题索引</span>
          <span>{vaults.reduce((sum, vault) => sum + vault.noteCount, 0).toLocaleString()} 条</span>
        </div>
      </section>
      <p className="build-label">LOCAL ONLY · WINDOWS</p>
    </aside>
  );
}
