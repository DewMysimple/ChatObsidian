import { ArrowRight, GitDiff, X } from '@phosphor-icons/react';
import { desktop } from '../lib/desktop';
import { useAppStore } from '../store/appStore';

export function ConfigChangeBanner() {
  const notice = useAppStore((state) => state.pendingChange);
  const setPending = useAppStore((state) => state.setPendingChange);
  const setView = useAppStore((state) => state.setView);
  const selectVault = useAppStore((state) => state.selectVault);

  if (!notice) return null;
  const dismiss = () => {
    void desktop.dismissConfigChange(notice.vaultId);
    setPending(null);
  };
  return (
    <div className="change-banner" role="status">
      <GitDiff size={21} weight="fill" />
      <div>
        <strong>{notice.vaultName} 的配置发生变化</strong>
        <span>检测到 {notice.changedPaths.length} 个受管理项目，可吸收到全局模板。</span>
      </div>
      <button
        className="text-button"
        type="button"
        onClick={() => {
          selectVault(notice.vaultId);
          setView('template');
        }}
      >
        查看变化 <ArrowRight size={15} />
      </button>
      <button className="icon-button compact" type="button" aria-label="忽略变化" onClick={dismiss}>
        <X size={16} />
      </button>
    </div>
  );
}
