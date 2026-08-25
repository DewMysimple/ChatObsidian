import { ArrowClockwise, CheckCircle, FolderOpen, Keyboard, Moon, ShieldCheck, Sun, WarningCircle, WindowsLogo } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { AppPreferences, ShortcutBindings, SwitchPolicy, ThemeMode } from '../contracts/desktop';
import { desktop } from '../lib/desktop';
import { useAppStore } from '../store/appStore';

type SaveState = { kind: 'saved' | 'saving' | 'error'; message: string };
type ValidationErrors = Partial<Record<'scanRoots' | 'templatePath' | 'shortcuts' | 'backupRetentionDays' | 'backupRetentionCount', string>>;
type ShortcutAction = keyof ShortcutBindings;

export function SettingsView() {
  const stored = useAppStore((state) => state.preferences);
  const setStored = useAppStore((state) => state.setPreferences);
  const showToast = useAppStore((state) => state.showToast);
  const [form, setForm] = useState<AppPreferences>(stored);
  const [validation, setValidation] = useState<ValidationErrors>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'saved', message: '已自动保存' });
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const formRef = useRef(form);
  const lastSavedRef = useRef(stored);
  const revisionRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<{ preferences: AppPreferences; revision: number } | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const recordingRef = useRef<ShortcutAction | null>(null);

  useEffect(() => { recordingRef.current = recording; }, [recording]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (recordingRef.current) void desktop.cancelShortcutCapture();
      const pending = pendingRef.current;
      if (pending) {
        void desktop.savePreferences(pending.preferences).then(setStored).catch((error) => {
          showToast({ tone: 'danger', message: `偏好设置未保存：${String(error)}` });
        });
      }
    };
  }, [setStored, showToast]);

  const persist = (next: AppPreferences, revision: number) => {
    if (pendingRef.current?.revision === revision) pendingRef.current = null;
    queueRef.current = queueRef.current.catch(() => undefined).then(async () => {
      if (!mountedRef.current) return;
      if (revision === revisionRef.current) setSaveState({ kind: 'saving', message: '保存中…' });
      try {
        const saved = await desktop.savePreferences(next);
        lastSavedRef.current = saved;
        if (revision === revisionRef.current && mountedRef.current) {
          setStored(saved);
          setSaveState({ kind: 'saved', message: '已自动保存' });
        }
      } catch (error) {
        if (revision === revisionRef.current && mountedRef.current) {
          const message = String(error);
          setStored(lastSavedRef.current);
          formRef.current = lastSavedRef.current;
          setForm(lastSavedRef.current);
          setSaveState({ kind: 'error', message: `未保存：${message}` });
          showToast({ tone: 'danger', message: `偏好设置未保存：${message}` });
        }
      }
    });
  };

  const cancelRecording = async () => {
    if (!recording) return;
    setRecording(null);
    try { await desktop.cancelShortcutCapture(); } catch (error) {
      showToast({ tone: 'danger', message: `无法恢复全局快捷键：${String(error)}` });
    }
  };

  const startRecording = async (action: ShortcutAction) => {
    if (recording) await cancelRecording();
    setShortcutError(null);
    try {
      await desktop.beginShortcutCapture();
      setRecording(action);
    } catch (error) {
      setShortcutError(String(error));
    }
  };

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        void cancelRecording();
        return;
      }
      const shortcut = shortcutFromEvent(event);
      if (!shortcut) return;
      const other = Object.entries(formRef.current.shortcuts).find(([key, value]) => key !== recording && value.toLocaleLowerCase() === shortcut.toLocaleLowerCase());
      if (other) {
        setShortcutError(`快捷键 ${shortcut} 已用于其他动作`);
        void cancelRecording();
        return;
      }
      const action = recording;
      setRecording(null);
      update((current) => ({ ...current, shortcuts: { ...current.shortcuts, [action]: shortcut } }), true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording]);

  const update = (change: (current: AppPreferences) => AppPreferences, immediate = false) => {
    const next = change(formRef.current);
    formRef.current = next;
    setForm(next);
    const errors = validatePreferences(next);
    setValidation(errors);
    const revision = ++revisionRef.current;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (Object.keys(errors).length) {
      pendingRef.current = null;
      const first = Object.values(errors)[0]!;
      setSaveState({ kind: 'error', message: `未保存：${first}` });
      return;
    }
    setStored(next);
    if (immediate) {
      pendingRef.current = null;
      persist(next, revision);
    } else {
      setSaveState({ kind: 'saving', message: '等待输入完成…' });
      pendingRef.current = { preferences: next, revision };
      timerRef.current = window.setTimeout(() => persist(next, revision), 600);
    }
  };

  const selectPath = async (kind: 'root' | 'template') => {
    const path = await desktop.selectDirectory();
    if (!path) return;
    if (kind === 'root') update((current) => ({ ...current, scanRoots: [...new Set([...current.scanRoots, path])] }), true);
    else update((current) => ({ ...current, templatePath: path.toLowerCase().endsWith('.obsidian') ? path : `${path}\\.obsidian` }), true);
  };

  return (
    <div className="settings-page page-stack">
      <div className="settings-grid">
        <section className="panel settings-section">
          <header><span><WindowsLogo size={21} /></span><div><h2>窗口与切换</h2><p>决定点击仓库时如何处理现有 Obsidian 窗口。</p></div></header>
          <div className="choice-grid three">
            {([['single', '单量打开', '关闭其他仓库；跨桌面关闭并重开目标'], ['additive', '增量打开', '保留其他仓库；跨桌面关闭并重开目标'], ['native', 'Obsidian 原生', '不处理窗口，可能切换到原桌面']] as const).map(([id, label, detail]) => <label className={form.switchPolicy === id ? 'is-selected' : ''} key={id}><input type="radio" name="policy" value={id} checked={form.switchPolicy === id} onChange={() => update((current) => ({ ...current, switchPolicy: id as SwitchPolicy }), true)} /><strong>{label}</strong><span>{detail}</span></label>)}
          </div>
          <label className="toggle-row"><input type="checkbox" checked={form.closeToTray} onChange={(event) => update((current) => ({ ...current, closeToTray: event.target.checked }), true)} /><span><strong>关闭主窗口时隐藏到托盘</strong><small>从托盘菜单选择“完全退出”才会结束程序。</small></span></label>
          <label className="toggle-row"><input type="checkbox" checked={form.launchAtStartup} onChange={(event) => update((current) => ({ ...current, launchAtStartup: event.target.checked }), true)} /><span><strong>登录 Windows 时自动启动</strong><small>开机后静默驻留托盘，不自动弹出主窗口。</small></span></label>
        </section>

        <section className="panel settings-section">
          <header><span><Sun size={21} /></span><div><h2>界面主题</h2><p>使用 Obsidian 官方紫色与中性表面。</p></div></header>
          <div className="choice-grid three theme-choices">
            {([['system', WindowsLogo, '跟随系统'], ['light', Sun, '浅色'], ['dark', Moon, '深色']] as const).map(([id, ThemeIcon, label]) => <label className={form.theme === id ? 'is-selected' : ''} key={id}><input type="radio" name="theme" value={id} checked={form.theme === id} onChange={() => update((current) => ({ ...current, theme: id as ThemeMode }), true)} /><ThemeIcon size={22} /><strong>{label}</strong></label>)}
          </div>
          <div className={`shortcut-settings ${validation.shortcuts || shortcutError ? 'has-error' : ''}`}>
            <span className="shortcut-title"><Keyboard size={17} />全局快捷键</span>
            <ShortcutRecorder label="显示仓库中心" value={form.shortcuts.showVaultCenter} recording={recording === 'showVaultCenter'} onRecord={() => void startRecording('showVaultCenter')} onReset={() => update((current) => ({ ...current, shortcuts: { ...current.shortcuts, showVaultCenter: 'Ctrl+Alt+O' } }), true)} />
            <ShortcutRecorder label="单量打开" value={form.shortcuts.singleOpen} recording={recording === 'singleOpen'} onRecord={() => void startRecording('singleOpen')} onReset={() => update((current) => ({ ...current, shortcuts: { ...current.shortcuts, singleOpen: 'Ctrl+Alt+1' } }), true)} />
            <ShortcutRecorder label="增量打开" value={form.shortcuts.additiveOpen} recording={recording === 'additiveOpen'} onRecord={() => void startRecording('additiveOpen')} onReset={() => update((current) => ({ ...current, shortcuts: { ...current.shortcuts, additiveOpen: 'Ctrl+Alt+2' } }), true)} />
            <small>{shortcutError ?? validation.shortcuts ?? (recording ? '请直接按下新的组合键，Esc 取消。' : '点击录制后按组合键；成功后立即自动保存。')}</small>
          </div>
        </section>

        <section className="panel settings-section wide-section">
          <header><span><FolderOpen size={21} /></span><div><h2>仓库与模板路径</h2><p>合并 Obsidian 已登记列表和以下扫描根目录。</p></div></header>
          <div className="path-settings">
            <div><span>扫描根目录</span><div className="root-list">{form.scanRoots.map((root) => <div key={root}><code>{root}</code><button type="button" disabled={form.scanRoots.length === 1} title={form.scanRoots.length === 1 ? '至少保留一个扫描根目录' : undefined} onClick={() => update((current) => ({ ...current, scanRoots: current.scanRoots.filter((item) => item !== root) }), true)}>移除</button></div>)}</div>{validation.scanRoots ? <small className="field-error">{validation.scanRoots}</small> : null}<button className="button secondary" type="button" onClick={() => void selectPath('root')}><FolderOpen size={17} />添加根目录</button></div>
            <div><label className={`field ${validation.templatePath ? 'has-error' : ''}`}><span>全局模板 .obsidian</span><div className="path-input"><input value={form.templatePath} onChange={(event) => update((current) => ({ ...current, templatePath: event.target.value }))} /><button type="button" onClick={() => void selectPath('template')}><FolderOpen size={18} /></button></div>{validation.templatePath ? <small>{validation.templatePath}</small> : null}</label></div>
          </div>
        </section>

        <section className="panel settings-section wide-section">
          <header><span><ShieldCheck size={21} /></span><div><h2>备份保留</h2><p>仅保留同步前会被覆盖或删除的内容。</p></div></header>
          <div className="retention-grid"><label className={`field ${validation.backupRetentionDays ? 'has-error' : ''}`}><span>保留天数</span><input type="number" min={1} max={365} value={form.backupRetentionDays} onChange={(event) => update((current) => ({ ...current, backupRetentionDays: Number(event.target.value) }))} />{validation.backupRetentionDays ? <small>{validation.backupRetentionDays}</small> : null}</label><label className={`field ${validation.backupRetentionCount ? 'has-error' : ''}`}><span>最多成功操作数</span><input type="number" min={1} max={200} value={form.backupRetentionCount} onChange={(event) => update((current) => ({ ...current, backupRetentionCount: Number(event.target.value) }))} />{validation.backupRetentionCount ? <small>{validation.backupRetentionCount}</small> : null}</label><div className="retention-note"><ShieldCheck size={18} /><span>回滚清单与备份文件位于本机 LocalAppData，不会写入任何仓库。</span></div></div>
        </section>
      </div>
      <div className={`settings-autosave ${saveState.kind}`} role="status" aria-live="polite">
        {saveState.kind === 'saved' ? <CheckCircle size={17} weight="fill" /> : saveState.kind === 'saving' ? <ArrowClockwise className="spin" size={17} /> : <WarningCircle size={17} weight="fill" />}
        <span>{saveState.message}</span>
        <small>开机自启由上方开关控制；ChatObsidian 不连接网络服务。</small>
      </div>
    </div>
  );
}

function validatePreferences(preferences: AppPreferences): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!preferences.scanRoots.length) errors.scanRoots = '至少保留一个扫描根目录';
  if (!preferences.templatePath.trim()) errors.templatePath = '模板路径不能为空';
  const shortcuts = Object.values(preferences.shortcuts).map((value) => value.trim().toLocaleLowerCase());
  if (shortcuts.some((value) => !value) || new Set(shortcuts).size !== shortcuts.length) errors.shortcuts = '三个全局快捷键必须完整且不能重复';
  if (!Number.isInteger(preferences.backupRetentionDays) || preferences.backupRetentionDays < 1 || preferences.backupRetentionDays > 365) errors.backupRetentionDays = '保留天数必须是 1–365 的整数';
  if (!Number.isInteger(preferences.backupRetentionCount) || preferences.backupRetentionCount < 1 || preferences.backupRetentionCount > 200) errors.backupRetentionCount = '操作数必须是 1–200 的整数';
  return errors;
}

function ShortcutRecorder({ label, value, recording, onRecord, onReset }: { label: string; value: string; recording: boolean; onRecord: () => void; onReset: () => void }) {
  return (
    <div className={`shortcut-row ${recording ? 'is-recording' : ''}`}>
      <span>{label}</span>
      <kbd>{recording ? '等待按键…' : value.replaceAll('+', ' + ')}</kbd>
      <button type="button" onClick={onRecord}>{recording ? '录制中' : '录制'}</button>
      <button type="button" onClick={onReset}>默认</button>
    </div>
  );
}

function shortcutFromEvent(event: KeyboardEvent) {
  const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean) as string[];
  if (!modifiers.length) return null;
  let key = '';
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code;
  else {
    const keys: Record<string, string> = { Space: 'Space', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete' };
    key = keys[event.code] ?? '';
  }
  return key ? [...modifiers, key].join('+') : null;
}
