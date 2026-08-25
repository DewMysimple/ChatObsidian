import { ArrowRight, FileText, MagnifyingGlass, Note, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { NoteIndexEntry, OpenMode, VaultRecord } from '../contracts/desktop';
import { desktop, isTauri } from '../lib/desktop';
import { useAppStore } from '../store/appStore';
import { ConfirmDialog } from './ConfirmDialog';

type ResultItem =
  | { kind: 'vault'; key: string; vault: VaultRecord }
  | { kind: 'note'; key: string; note: NoteIndexEntry; vault: VaultRecord };

export function QuickSwitcher({ standalone = false }: { standalone?: boolean }) {
  const vaults = useAppStore((state) => state.vaults);
  const loading = useAppStore((state) => state.loading);
  const load = useAppStore((state) => state.load);
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<NoteIndexEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<OpenMode>('additive');
  const [timeoutItem, setTimeoutItem] = useState<ResultItem | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (standalone) void load();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [standalone, load]);

  useEffect(() => {
    if (!standalone || !isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>('quick-switcher-opened', (event) => {
      setMode(event.payload === 'single' ? 'single' : event.payload === 'native' ? 'native' : 'additive');
      setQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; });
    return () => { disposed = true; unlisten?.(); };
  }, [standalone]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setNotes([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void desktop.searchNotes(trimmed, 28).then(setNotes);
    }, 90);
    return () => window.clearTimeout(timer);
  }, [query]);

  const vaultResults = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('zh-CN');
    return vaults
      .filter((vault) => !vault.isTemplate && !vault.hidden && !vault.archived && vault.health === 'healthy')
      .filter((vault) => !q || `${vault.displayName} ${vault.groupName} ${vault.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(q))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
      .slice(0, q ? 8 : 10);
  }, [query, vaults]);

  const results = useMemo<ResultItem[]>(() => [
    ...vaultResults.map((vault) => ({ kind: 'vault' as const, key: `v-${vault.id}`, vault })),
    ...notes.map((note) => {
      const vault = vaults.find((item) => item.id === note.vaultId)!;
      return { kind: 'note' as const, key: `n-${note.id}`, note, vault };
    }).filter((item) => item.vault),
  ], [vaultResults, notes, vaults]);

  useEffect(() => setActiveIndex(0), [query]);

  const close = () => {
    setQuery('');
    void desktop.hideQuickSwitcher();
  };
  const openResult = async (item: ResultItem | undefined) => {
    if (!item || opening) return;
    setOpening(true);
    setOpenError(null);
    try {
      await desktop.openVault(item.vault.id, item.kind === 'note' ? item.note.relativePath : undefined, mode);
      close();
    } catch (error) {
      if (String(error).includes('OBSIDIAN_CLOSE_TIMEOUT')) setTimeoutItem(item);
      else setOpenError(String(error));
    } finally {
      setOpening(false);
    }
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void openResult(results[activeIndex]);
    } else if (event.key === 'Escape') close();
  };

  return (
    <div className={`quick-shell ${standalone ? 'standalone' : ''}`}>
      <div className={`quick-mode ${mode}`}><strong>{mode === 'single' ? '单量打开' : mode === 'native' ? '原生打开' : '增量打开'}</strong><span>{mode === 'single' ? '关闭其他仓库；跨桌面关闭并重开目标仓库' : mode === 'native' ? '不处理窗口，可能跳转到原桌面' : '保留其他仓库；跨桌面关闭并重开目标仓库'}</span></div>
      <div className="quick-search">
        <MagnifyingGlass size={21} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索仓库或笔记标题"
          aria-label="搜索仓库或笔记标题"
        />
        <button type="button" onClick={close} aria-label="关闭"><X size={17} /></button>
      </div>
      <div className="quick-results" role="listbox" aria-label="搜索结果">
        {loading ? <QuickLoading /> : results.length ? results.map((item, index) => (
          <button
            type="button"
            role="option"
            aria-selected={activeIndex === index}
            className={`quick-result ${activeIndex === index ? 'is-active' : ''}`}
            key={item.key}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => void openResult(item)}
          >
            <span className="quick-icon">{item.kind === 'vault' ? <Note size={19} weight="duotone" /> : <FileText size={19} />}</span>
            <span className="quick-copy">
              <strong>{item.kind === 'vault' ? item.vault.displayName : item.note.title}</strong>
              <small>{item.kind === 'vault' ? `${item.vault.groupName} · ${item.vault.noteCount.toLocaleString()} 篇笔记` : `${item.vault.displayName} / ${item.note.relativePath}`}</small>
            </span>
            {item.kind === 'vault' && item.vault.isOpen ? <span className="open-label">已打开</span> : null}
            <ArrowRight size={16} />
          </button>
        )) : (
          <div className="quick-empty">
            <MagnifyingGlass size={29} />
            <strong>没有找到匹配结果</strong>
            <span>可以输入仓库名、分组或 Markdown 文件名。</span>
          </div>
        )}
      </div>
      <footer className="quick-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>ENTER</kbd> 打开</span>
        <span><kbd>ESC</kbd> 关闭</span>
        <span className="quick-local">LOCAL INDEX</span>
      </footer>
      {openError ? <div className="quick-error" role="alert">{openError}</div> : null}
      <ConfirmDialog
        open={timeoutItem !== null}
        onOpenChange={(open) => { if (!open) setTimeoutItem(null); }}
        title="目标 Obsidian 窗口未能正常关闭"
        description="强制处理会结束整个 Obsidian 进程，包括其他桌面的仓库，然后在当前桌面重新打开目标仓库。"
        confirmLabel="强制关闭全部并打开"
        tone="danger"
        onConfirm={() => {
          const item = timeoutItem;
          setTimeoutItem(null);
          if (!item) return;
          void desktop.forceCloseAndOpen(item.vault.id, item.kind === 'note' ? item.note.relativePath : undefined, mode)
            .then(close)
            .catch((error) => setOpenError(String(error)));
        }}
      />
    </div>
  );
}

function QuickLoading() {
  return <div className="quick-loading"><span /><span /><span /><span /></div>;
}
