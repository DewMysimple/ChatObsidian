import { ArrowRight, FileText, MagnifyingGlass, Note, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { NoteIndexEntry, OpenMode, VaultRecord } from '../contracts/desktop';
import { desktop, isTauri } from '../lib/desktop';
import { useAppStore } from '../store/appStore';
import { ConfirmDialog } from './ConfirmDialog';

type ResultItem =
  | { kind: 'vault'; key: string; vault: VaultRecord }
  | { kind: 'note'; key: string; note: NoteIndexEntry; vault: VaultRecord };

type QuickFilters = {
  vaults: boolean;
  notes: boolean;
};

const QUICK_FILTER_STORAGE_KEY = 'chatobsidian.quick-filters';
const QUICK_ROW_HEIGHT = 53;
const QUICK_VIRTUALIZATION_THRESHOLD = 120;

function readQuickFilters(): QuickFilters {
  if (typeof window === 'undefined') return { vaults: true, notes: true };
  try {
    const value = JSON.parse(window.localStorage.getItem(QUICK_FILTER_STORAGE_KEY) ?? 'null') as Partial<QuickFilters> | null;
    if (value && typeof value.vaults === 'boolean' && typeof value.notes === 'boolean') {
      return { vaults: value.vaults, notes: value.notes };
    }
  } catch {
    // A corrupt browser storage entry should never prevent the switcher from opening.
  }
  return { vaults: true, notes: true };
}

function persistQuickFilters(filters: QuickFilters) {
  try {
    window.localStorage.setItem(QUICK_FILTER_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Storage can be unavailable in private/browser test contexts; memory state still works.
  }
}

function compareRecent(left: VaultRecord, right: VaultRecord) {
  // A vault that is actually open is the most useful target in a quick
  // switcher. Among open vaults (and then among closed vaults), retain the
  // most-recently-opened ordering. The backend keeps this timestamp monotonic
  // across registry refreshes.
  if (left.isOpen !== right.isOpen) return left.isOpen ? -1 : 1;
  const leftOpened = left.lastOpened ?? Number.NEGATIVE_INFINITY;
  const rightOpened = right.lastOpened ?? Number.NEGATIVE_INFINITY;
  if (rightOpened !== leftOpened) return rightOpened - leftOpened;
  return left.displayName.localeCompare(right.displayName, 'zh-CN') || left.id.localeCompare(right.id);
}

export function QuickSwitcher({ standalone = false }: { standalone?: boolean }) {
  const vaults = useAppStore((state) => state.vaults);
  const loading = useAppStore((state) => state.loading);
  const refreshQuickSwitcher = useAppStore((state) => state.refreshQuickSwitcher);
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<NoteIndexEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<OpenMode>('additive');
  const [filters, setFilters] = useState<QuickFilters>(() => readQuickFilters());
  const [visible, setVisible] = useState(standalone);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [timeoutItem, setTimeoutItem] = useState<ResultItem | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const visibleRef = useRef(standalone);
  const refreshInFlightRef = useRef(false);

  const refreshNow = useCallback(async (refreshNotes: boolean) => {
    if (!standalone || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      await refreshQuickSwitcher(refreshNotes);
      if (visibleRef.current) setRefreshError(null);
    } catch (error) {
      if (visibleRef.current) setRefreshError(String(error));
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [refreshQuickSwitcher, standalone]);

  useEffect(() => {
    if (!standalone) return;
    void refreshNow(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [refreshNow, standalone]);

  useEffect(() => {
    if (!standalone || !isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>('quick-switcher-opened', (event) => {
      visibleRef.current = true;
      setVisible(true);
      setMode(event.payload === 'single' ? 'single' : event.payload === 'native' ? 'native' : 'additive');
      setQuery('');
      setActiveIndex(0);
      void refreshNow(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; });
    return () => { disposed = true; unlisten?.(); };
  }, [refreshNow, standalone]);

  useEffect(() => {
    if (!standalone) return;
    const onFocus = () => {
      visibleRef.current = true;
      setVisible(true);
    };
    const onBlur = () => {
      visibleRef.current = false;
      setVisible(false);
    };
    const onVisibilityChange = () => {
      const isVisible = document.visibilityState !== 'hidden';
      visibleRef.current = isVisible;
      setVisible(isVisible);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [standalone]);

  useEffect(() => {
    if (!standalone || !visible) return;
    const timer = window.setInterval(() => {
      if (visibleRef.current) void refreshNow(false);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refreshNow, standalone, visible]);

  useEffect(() => {
    if (!standalone || !visible) return;
    const timer = window.setInterval(() => {
      if (visibleRef.current) void refreshNow(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshNow, standalone, visible]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !filters.notes) {
      setNotes([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void desktop.searchNotes(trimmed, 10_000).then((result) => {
        if (!cancelled) setNotes(result);
      }).catch(() => {
        if (!cancelled) setNotes([]);
      });
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filters.notes, query]);

  const vaultResults = useMemo(() => {
    if (!filters.vaults) return [];
    const q = query.trim().toLocaleLowerCase('zh-CN');
    return vaults
      .filter((vault) => !vault.isTemplate && !vault.hidden && !vault.archived && vault.health === 'healthy')
      .filter((vault) => !q || `${vault.displayName} ${vault.groupName} ${vault.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(q))
      .sort(compareRecent);
  }, [filters.vaults, query, vaults]);

  const availableVaultCount = useMemo(
    () => vaults.filter((vault) => !vault.isTemplate && !vault.hidden && !vault.archived && vault.health === 'healthy').length,
    [vaults],
  );

  const results = useMemo<ResultItem[]>(() => {
    const noteResults = filters.notes
      ? notes.map((note) => {
        const vault = vaults.find((item) => item.id === note.vaultId);
        return vault && !vault.isTemplate && !vault.hidden && !vault.archived && vault.health === 'healthy'
          ? { kind: 'note' as const, key: `n-${note.id}`, note, vault }
          : null;
      }).filter((item): item is Extract<ResultItem, { kind: 'note' }> => item !== null)
      : [];
    return [
      ...vaultResults.map((vault) => ({ kind: 'vault' as const, key: `v-${vault.id}`, vault })),
      ...noteResults,
    ];
  }, [filters.notes, notes, vaultResults, vaults]);

  useEffect(() => setActiveIndex(0), [filters.notes, filters.vaults, query]);

  const toggleFilter = (key: keyof QuickFilters) => {
    setFilters((current) => {
      const next = { ...current, [key]: !current[key] };
      persistQuickFilters(next);
      return next;
    });
  };

  const close = () => {
    setQuery('');
    visibleRef.current = false;
    setVisible(false);
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
      setActiveIndex((index) => Math.min(Math.max(0, results.length - 1), index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void openResult(results[activeIndex]);
    } else if (event.key === 'Escape') close();
  };

  const noFilters = !filters.vaults && !filters.notes;
  const emptyText = noFilters
    ? '请至少开启“仓库”或“笔记”'
    : query.trim()
      ? '没有找到匹配结果'
      : '没有可显示的仓库';

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
        <div className="quick-filters" aria-label="搜索类型">
          <button type="button" className={`quick-filter-button ${filters.vaults ? 'is-active' : ''}`} aria-pressed={filters.vaults} onClick={() => toggleFilter('vaults')} aria-label={`仓库，共 ${availableVaultCount} 个`}>仓库 <span className="quick-filter-count">{availableVaultCount}</span></button>
          <button type="button" className={`quick-filter-button ${filters.notes ? 'is-active' : ''}`} aria-pressed={filters.notes} onClick={() => toggleFilter('notes')}>笔记</button>
        </div>
        <button type="button" onClick={close} aria-label="关闭"><X size={17} /></button>
      </div>
      {loading ? <QuickLoading /> : results.length ? (
        <QuickResultList
          results={results}
          activeIndex={activeIndex}
          onActiveIndex={setActiveIndex}
          onOpen={openResult}
        />
      ) : (
        <div className="quick-empty">
          <MagnifyingGlass size={29} />
          <strong>{emptyText}</strong>
          <span>{noFilters ? '打开对应开关后即可搜索。' : '可以输入仓库名、分组或 Markdown 文件标题。'}</span>
        </div>
      )}
      <footer className="quick-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>ENTER</kbd> 打开</span>
        <span><kbd>ESC</kbd> 关闭</span>
        <span className="quick-local">LOCAL INDEX</span>
      </footer>
      {refreshError ? <div className="quick-error" role="alert">刷新失败：{refreshError}</div> : null}
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

function QuickResultList({
  results,
  activeIndex,
  onActiveIndex,
  onOpen,
}: {
  results: ResultItem[];
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  onOpen: (item: ResultItem) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const virtualized = results.length > QUICK_VIRTUALIZATION_THRESHOLD;
  const viewportHeight = viewportRef.current?.clientHeight || 440;
  const start = virtualized ? Math.max(0, Math.floor(scrollTop / QUICK_ROW_HEIGHT) - 8) : 0;
  const end = virtualized ? Math.min(results.length, Math.ceil((scrollTop + viewportHeight) / QUICK_ROW_HEIGHT) + 8) : results.length;
  const visibleResults = results.slice(start, end);

  useEffect(() => {
    if (!viewportRef.current) return;
    if (virtualized) {
      const viewport = viewportRef.current;
      const top = activeIndex * QUICK_ROW_HEIGHT;
      const bottom = top + QUICK_ROW_HEIGHT;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = bottom - viewport.clientHeight;
      return;
    }
    const node = viewportRef.current.querySelector<HTMLElement>(`[data-quick-index="${activeIndex}"]`);
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, virtualized]);

  const renderItem = (item: ResultItem, index: number) => (
    <button
      type="button"
      role="option"
      aria-selected={activeIndex === index}
      aria-setsize={results.length}
      aria-posinset={index + 1}
      className={`quick-result ${activeIndex === index ? 'is-active' : ''}`}
      data-quick-index={index}
      key={item.key}
      onMouseEnter={() => onActiveIndex(index)}
      onClick={() => onOpen(item)}
    >
      <span className="quick-icon">{item.kind === 'vault' ? <Note size={19} weight="duotone" /> : <FileText size={19} />}</span>
      <span className="quick-copy">
        <strong>{item.kind === 'vault' ? item.vault.displayName : item.note.title}</strong>
        <small>{item.kind === 'vault' ? `${item.vault.groupName} · ${item.vault.noteCount.toLocaleString()} 篇笔记` : `${item.vault.displayName} / ${item.note.relativePath}`}</small>
      </span>
      <span className={`quick-kind-badge ${item.kind}`}>{item.kind === 'vault' ? '仓库' : '笔记'}</span>
      {item.kind === 'vault' && item.vault.isOpen ? <span className="open-label">已打开</span> : <span />}
      <ArrowRight size={16} />
    </button>
  );

  return (
    <div
      ref={viewportRef}
      className="quick-results"
      role="listbox"
      aria-label="搜索结果"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {virtualized ? (
        <div className="quick-results-virtual" style={{ height: results.length * QUICK_ROW_HEIGHT }}>
          <div style={{ transform: `translateY(${start * QUICK_ROW_HEIGHT}px)` }}>
            {visibleResults.map((item, offset) => renderItem(item, start + offset))}
          </div>
        </div>
      ) : visibleResults.map((item, index) => renderItem(item, index))}
    </div>
  );
}

function QuickLoading() {
  return <div className="quick-results quick-loading" aria-label="正在刷新快速切换列表"><span /><span /><span /><span /></div>;
}
