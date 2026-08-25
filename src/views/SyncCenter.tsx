import {
  ArrowRight,
  CheckCircle,
  File,
  FloppyDiskBack,
  GitDiff,
  ShieldCheck,
  Warning,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type { ConfigDiff, SyncCategory, SyncPlan } from '../contracts/desktop';
import { desktop } from '../lib/desktop';
import { useAppStore } from '../store/appStore';
import { ConfirmDialog } from '../components/ConfirmDialog';

const categoryCopy: Array<{ id: SyncCategory; label: string; detail: string; safe: boolean }> = [
  { id: 'shortcuts', label: '快捷键', detail: 'hotkeys 与命令面板', safe: true },
  { id: 'appearance', label: '外观资源', detail: '主题、图标与 CSS 片段', safe: true },
  { id: 'core', label: '核心配置', detail: '编辑、视图与核心插件', safe: true },
  { id: 'community_plugins', label: '社区插件', detail: '启用列表与插件程序', safe: true },
  { id: 'plugin_data', label: '插件设置', detail: '按插件选择 data.json', safe: false },
  { id: 'workspace', label: '工作区状态', detail: '标签页与布局，不建议同步', safe: false },
];

export function SyncCenter() {
  const vaults = useAppStore((state) => state.vaults).filter((vault) => !vault.isTemplate && !vault.hidden && !vault.archived && vault.health === 'healthy');
  const preferences = useAppStore((state) => state.preferences);
  const showToast = useAppStore((state) => state.showToast);
  const [categories, setCategories] = useState<SyncCategory[]>(['shortcuts', 'appearance', 'core', 'community_plugins']);
  const [targets, setTargets] = useState<string[]>(vaults.map((vault) => vault.id));
  const [fullMirror, setFullMirror] = useState(false);
  const [diff, setDiff] = useState<ConfigDiff | null>(null);
  const [working, setWorking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const plan: SyncPlan = useMemo(() => ({
    sourcePath: preferences.templatePath,
    targetVaultIds: targets,
    categories,
    pluginDataIds: preferences.enabledPluginDataIds,
    fullMirror,
    confirmWorkspace: categories.includes('workspace'),
    confirmDeletions: fullMirror,
  }), [preferences, targets, categories, fullMirror]);

  const preview = async () => {
    setWorking(true);
    try {
      setDiff(await desktop.computeConfigDiff(plan));
    } catch (error) {
      showToast({ tone: 'danger', message: `比较失败：${String(error)}` });
    } finally {
      setWorking(false);
    }
  };
  const apply = async () => {
    setWorking(true);
    try {
      const operation = await desktop.applySync(plan);
      showToast({ tone: operation.status === 'success' ? 'success' : 'danger', message: operation.detail });
      setDiff(null);
    } catch (error) {
      showToast({ tone: 'danger', message: `同步失败：${String(error)}` });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="sync-page page-stack">
      <div className="safety-notice">
        <ShieldCheck size={22} weight="fill" />
        <div><strong>安全同步模式</strong><span>所有目标先完成增量备份。Obsidian 运行时不会写入配置。</span></div>
      </div>
      <div className="sync-workspace">
        <section className="panel source-panel">
          <PanelTitle index="来源" title="全局配置模板" icon={<FloppyDiskBack size={20} />} />
          <div className="source-path"><span>MASTER</span><strong>.模板 / .obsidian</strong><small>{preferences.templatePath}</small></div>
          <div className="template-health"><CheckCircle size={18} weight="fill" /><div><strong>模板路径有效</strong><span>同步前会再次验证目录与文件权限</span></div></div>
        </section>

        <section className="panel categories-panel">
          <PanelTitle index="配置" title="同步类别" icon={<GitDiff size={20} />} />
          <div className="category-list">
            {categoryCopy.map((category) => (
              <label className={`category-option ${categories.includes(category.id) ? 'is-selected' : ''} ${!category.safe ? 'is-risky' : ''}`} key={category.id}>
                <input
                  type="checkbox"
                  checked={categories.includes(category.id)}
                  onChange={(event) => setCategories((current) => event.target.checked ? [...current, category.id] : current.filter((id) => id !== category.id))}
                />
                <span><strong>{category.label}</strong><small>{category.detail}</small></span>
                {!category.safe ? <Warning size={16} /> : null}
              </label>
            ))}
          </div>
          <label className="advanced-toggle">
            <input type="checkbox" checked={fullMirror} onChange={(event) => setFullMirror(event.target.checked)} />
            <span><strong>高级完整镜像</strong><small>删除模板中不存在的额外配置，需要二次确认</small></span>
          </label>
        </section>

        <section className="panel target-panel">
          <PanelTitle index="目标" title="选择仓库" icon={<File size={20} />} />
          <div className="target-tools">
            <span>已选 {targets.length} / {vaults.length}</span>
            <button type="button" onClick={() => setTargets(targets.length === vaults.length ? [] : vaults.map((vault) => vault.id))}>{targets.length === vaults.length ? '全部取消' : '选择全部'}</button>
          </div>
          <div className="target-list">
            {vaults.map((vault) => (
              <label key={vault.id}>
                <input type="checkbox" checked={targets.includes(vault.id)} onChange={(event) => setTargets((current) => event.target.checked ? [...current, vault.id] : current.filter((id) => id !== vault.id))} />
                <span><strong>{vault.displayName}</strong><small>{vault.groupName}</small></span>
                {vault.excludedCategories.length ? <em>{vault.excludedCategories.length} 项例外</em> : null}
              </label>
            ))}
          </div>
        </section>

        <section className="panel diff-panel">
          <PanelTitle index="预览" title="差异与执行" icon={<ArrowRight size={20} />} />
          {!diff ? (
            <div className="diff-empty"><GitDiff size={34} /><strong>尚未生成差异</strong><span>选择同步类别和目标仓库，然后开始只读比较。</span></div>
          ) : (
            <>
              <div className="diff-summary">
                <div><span>新增</span><strong>{diff.added}</strong></div>
                <div><span>修改</span><strong>{diff.modified}</strong></div>
                <div><span>删除</span><strong>{diff.deleted}</strong></div>
                <div><span>备份</span><strong>{formatBytes(diff.estimatedBackupBytes)}</strong></div>
              </div>
              <div className="diff-files">
                {diff.entries.slice(0, 60).map((entry, index) => (
                  <div key={`${entry.targetVaultId}-${entry.relativePath}-${index}`}>
                    <span className={`diff-status ${entry.status}`}>{statusCopy(entry.status)}</span>
                    <span><strong>{entry.relativePath}</strong><small>{entry.targetVaultName}</small></span>
                  </div>
                ))}
                {!diff.entries.length ? <p>所选配置与目标仓库完全一致。</p> : null}
              </div>
            </>
          )}
          <div className="panel-footer-actions">
            <button className="button secondary" type="button" onClick={() => void preview()} disabled={working || !targets.length || !categories.length} aria-busy={working}>{working ? '后台比较中…' : '生成差异'}</button>
            <button className="button primary" type="button" onClick={() => fullMirror || categories.includes('workspace') ? setConfirmOpen(true) : void apply()} disabled={working || !diff || diff.targetCount === 0}>备份并同步</button>
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="确认高级同步"
        description="此次操作包含工作区状态或删除额外文件。所有受影响内容会先备份，但建议确认 Obsidian 已完全关闭。"
        confirmLabel="确认备份并同步"
        tone="danger"
        onConfirm={() => void apply()}
      />
    </div>
  );
}

function PanelTitle({ index, title, icon }: { index: string; title: string; icon: React.ReactNode }) {
  return <header className="panel-title"><span>{icon}</span><div><small>{index}</small><h2>{title}</h2></div></header>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusCopy(status: string) {
  return status === 'added' ? '新增' : status === 'modified' ? '修改' : status === 'deleted' ? '删除' : '相同';
}
