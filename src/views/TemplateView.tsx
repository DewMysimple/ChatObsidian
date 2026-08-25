import {
  Check,
  Database,
  FolderSimple,
  Keyboard,
  Palette,
  Plugs,
  ShieldWarning,
  SlidersHorizontal,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { SyncCategory, TemplatePlugin } from '../contracts/desktop';
import { desktop } from '../lib/desktop';
import { useAppStore } from '../store/appStore';
import { ConfirmDialog } from '../components/ConfirmDialog';

const categories: Array<{ id: SyncCategory; name: string; files: string; icon: typeof Keyboard; defaultOn: boolean }> = [
  { id: 'shortcuts', name: '快捷键', files: 'hotkeys.json, command-palette.json', icon: Keyboard, defaultOn: true },
  { id: 'appearance', name: '外观资源', files: 'appearance.json, themes, icons, snippets', icon: Palette, defaultOn: true },
  { id: 'core', name: '核心配置', files: 'app.json, core-plugins.json 与其他顶层 JSON', icon: SlidersHorizontal, defaultOn: true },
  { id: 'community_plugins', name: '社区插件', files: '启用列表、main.js、manifest.json、styles.css', icon: Plugs, defaultOn: true },
  { id: 'plugin_data', name: '插件设置', files: 'plugins/*/data.json，按插件单独启用', icon: Database, defaultOn: false },
  { id: 'workspace', name: '工作区状态', files: 'workspace.json, workspaces.json', icon: ShieldWarning, defaultOn: false },
];

export function TemplateView() {
  const preferences = useAppStore((state) => state.preferences);
  const setPreferences = useAppStore((state) => state.setPreferences);
  const vaults = useAppStore((state) => state.vaults).filter((vault) => !vault.isTemplate && !vault.archived);
  const selectedVaultId = useAppStore((state) => state.selectedVaultId);
  const selectedVault = vaults.find((vault) => vault.id === selectedVaultId) ?? vaults[0];
  const pending = useAppStore((state) => state.pendingChange);
  const setPending = useAppStore((state) => state.setPendingChange);
  const patchVault = useAppStore((state) => state.patchVault);
  const showToast = useAppStore((state) => state.showToast);
  const [plugins, setPlugins] = useState<TemplatePlugin[]>([]);
  const [adoptOpen, setAdoptOpen] = useState(false);

  useEffect(() => { void desktop.listTemplatePlugins().then(setPlugins); }, [preferences.templatePath]);

  const togglePluginData = (id: string) => {
    const current = preferences.enabledPluginDataIds;
    const next = { ...preferences, enabledPluginDataIds: current.includes(id) ? current.filter((item) => item !== id) : [...current, id] };
    setPreferences(next);
    void desktop.savePreferences(next);
  };

  const adopt = async () => {
    if (!pending) return;
    try {
      const result = await desktop.adoptVaultConfig(pending.vaultId, ['shortcuts', 'appearance', 'core', 'community_plugins']);
      showToast({ tone: 'success', message: result.detail });
      setPending(null);
    } catch (error) {
      showToast({ tone: 'danger', message: `更新模板失败：${String(error)}` });
    }
  };

  return (
    <div className="template-page page-stack">
      <section className="template-master panel">
        <div className="template-identity"><span className="master-icon"><FolderSimple size={25} weight="duotone" /></span><div><small>MASTER TEMPLATE</small><h2>全局配置模板</h2><p>{preferences.templatePath}</p></div></div>
        <div className="template-status"><Check size={17} weight="bold" /><span>默认配置真源</span></div>
        {pending ? <button className="button primary" type="button" onClick={() => setAdoptOpen(true)}>吸收 {pending.vaultName} 的变化</button> : <span className="muted-copy">当前没有等待处理的配置变化</span>}
      </section>

      <div className="template-grid">
        <section className="panel category-policy">
          <header className="section-heading"><div><small>SYNC POLICY</small><h2>类别策略</h2></div><span>日常默认</span></header>
          <div className="policy-list">
            {categories.map(({ id, name, files, icon: CategoryIcon, defaultOn }) => (
              <div className="policy-row" key={id}>
                <span className={`policy-icon ${defaultOn ? 'active' : ''}`}><CategoryIcon size={19} /></span>
                <span><strong>{name}</strong><small>{files}</small></span>
                <span className={`policy-state ${defaultOn ? 'on' : 'off'}`}>{defaultOn ? '默认同步' : '默认排除'}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel exception-panel">
          <header className="section-heading"><div><small>VAULT OVERRIDES</small><h2>仓库例外</h2></div></header>
          <label className="field"><span>选择仓库</span><select value={selectedVault?.id ?? ''} onChange={(event) => useAppStore.getState().selectVault(event.target.value)}>{vaults.map((vault) => <option value={vault.id} key={vault.id}>{vault.displayName} / {vault.groupName}</option>)}</select></label>
          {selectedVault ? <div className="exception-list">{categories.filter((category) => category.id !== 'workspace').map((category) => {
            const excluded = selectedVault.excludedCategories.includes(category.id);
            return <label key={category.id}><input type="checkbox" checked={!excluded} onChange={(event) => void patchVault(selectedVault.id, { excludedCategories: event.target.checked ? selectedVault.excludedCategories.filter((id) => id !== category.id) : [...selectedVault.excludedCategories, category.id] })} /><span><strong>{category.name}</strong><small>{excluded ? '此仓库保留自己的配置' : '继承全局模板'}</small></span></label>;
          })}</div> : null}
        </section>
      </div>

      <section className="panel plugin-policy">
        <header className="section-heading"><div><small>PLUGIN DATA</small><h2>插件设置同步</h2><p>插件程序默认同步；data.json 可能包含仓库路径或凭据，必须逐项启用。</p></div><span>{preferences.enabledPluginDataIds.length} 项已启用</span></header>
        <div className="plugin-grid">
          {plugins.map((plugin) => {
            const enabled = preferences.enabledPluginDataIds.includes(plugin.id);
            return <label className={`plugin-item ${enabled ? 'is-enabled' : ''}`} key={plugin.id}><input type="checkbox" checked={enabled} disabled={!plugin.hasData} onChange={() => togglePluginData(plugin.id)} /><span className="plugin-mark"><Plugs size={18} /></span><span><strong>{plugin.name}</strong><small>{plugin.id} · {plugin.version}</small></span><em>{!plugin.hasData ? '无设置文件' : enabled ? '参与同步' : '保持独立'}</em></label>;
          })}
        </div>
      </section>

      <ConfirmDialog open={adoptOpen} onOpenChange={setAdoptOpen} title="更新全局模板" description={`将从 ${pending?.vaultName ?? '当前仓库'} 吸收快捷键、外观、核心配置和插件程序。模板会先建立备份，其他仓库不会自动写入。`} confirmLabel="备份并更新模板" onConfirm={() => void adopt()} />
    </div>
  );
}
