import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowClockwise,
  ArrowsDownUp,
  CaretDown,
  DotsSixVertical,
  FolderOpen,
  Heart,
  MagnifyingGlass,
  Note,
  WarningCircle,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type { VaultRecord } from '../contracts/desktop';
import { desktop } from '../lib/desktop';
import { displayWindowsPath } from '../lib/pathDisplay';
import { useAppStore } from '../store/appStore';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { VaultDetailsDialog } from '../components/VaultDetailsDialog';

export function VaultCenter() {
  const vaults = useAppStore((state) => state.vaults);
  const groups = useAppStore((state) => state.groups);
  const search = useAppStore((state) => state.search);
  const sort = useAppStore((state) => state.sort);
  const scanning = useAppStore((state) => state.scanning);
  const selectedVaultId = useAppStore((state) => state.selectedVaultId);
  const setSearch = useAppStore((state) => state.setSearch);
  const setSort = useAppStore((state) => state.setSort);
  const scan = useAppStore((state) => state.scan);
  const patchVault = useAppStore((state) => state.patchVault);
  const reorderGroup = useAppStore((state) => state.reorderGroup);
  const reorderGroups = useAppStore((state) => state.reorderGroups);
  const showToast = useAppStore((state) => state.showToast);
  const selectVault = useAppStore((state) => state.selectVault);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [forceTarget, setForceTarget] = useState<VaultRecord | null>(null);
  const [openingVaultId, setOpeningVaultId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groupSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const orderedGroups = useMemo(() => [...groups].sort((a, b) => a.orderIndex - b.orderIndex), [groups]);

  const visibleVaults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    return vaults.filter((vault) => {
      if (vault.isTemplate || vault.hidden || vault.archived) return false;
      return !query || `${vault.displayName} ${vault.groupName} ${vault.tags.join(' ')} ${displayWindowsPath(vault.path)}`.toLocaleLowerCase('zh-CN').includes(query);
    });
  }, [vaults, search]);

  const activeCount = vaults.filter((vault) => vault.isOpen).length;
  const driftCount = vaults.filter((vault) => vault.configState === 'drifted').length;
  const missingCount = vaults.filter((vault) => vault.health !== 'healthy' && !vault.isTemplate).length;
  const notes = vaults.filter((vault) => !vault.isTemplate).reduce((sum, vault) => sum + vault.noteCount, 0);
  const selected = vaults.find((vault) => vault.id === selectedVaultId) ?? null;

  const openVault = async (vault: VaultRecord, relativePath?: string) => {
    if (openingVaultId) return;
    setOpeningVaultId(vault.id);
    showToast({ tone: 'neutral', message: `正在切换到 ${vault.displayName}…` });
    try {
      await desktop.openVault(vault.id, relativePath);
      showToast({ tone: 'success', message: `正在打开 ${vault.displayName}` });
      setDetailsOpen(false);
    } catch (error) {
      if (String(error).includes('OBSIDIAN_CLOSE_TIMEOUT')) setForceTarget(vault);
      else showToast({ tone: 'danger', message: `无法打开仓库：${String(error)}` });
    } finally {
      setOpeningVaultId(null);
    }
  };

  return (
    <div className="vault-page page-stack">
      <section className="metric-strip" aria-label="仓库概览">
        <Metric label="已管理仓库" value={vaults.filter((vault) => !vault.isTemplate).length.toString()} detail={`${groups.length} 个分组`} />
        <Metric label="笔记标题索引" value={notes.toLocaleString()} detail="只索引名称与路径" />
        <Metric label="配置差异" value={driftCount.toString()} detail={driftCount ? '等待检查' : '全部一致'} accent={driftCount > 0} />
        <Metric label="当前窗口" value={activeCount ? '工作中' : '空闲'} detail={missingCount ? `${missingCount} 个路径异常` : '所有路径有效'} />
      </section>

      <section className="control-bar">
        <label className="search-field wide">
          <MagnifyingGlass size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索仓库、分组、标签或路径" />
          {search ? <kbd>{visibleVaults.length}</kbd> : <kbd>CTRL K</kbd>}
        </label>
        <label className="select-control">
          <ArrowsDownUp size={17} />
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="排序方式">
            <option value="custom">自定义排序</option>
            <option value="name">按名称</option>
            <option value="recent">最近打开</option>
            <option value="notes">笔记数量</option>
          </select>
        </label>
        <button className="button secondary" type="button" onClick={() => void scan()} disabled={scanning}>
          <ArrowClockwise className={scanning ? 'spin' : ''} size={17} />
          {scanning ? '正在扫描' : '重新扫描'}
        </button>
      </section>

      {visibleVaults.length === 0 ? (
        <div className="empty-state">
          <MagnifyingGlass size={34} />
          <strong>没有匹配的仓库</strong>
          <span>清除搜索词，或在偏好设置中添加扫描根目录。</span>
          <button className="button secondary" type="button" onClick={() => setSearch('')}>清除搜索</button>
        </div>
      ) : (
        <DndContext
          sensors={groupSensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return;
            const oldIndex = orderedGroups.findIndex((group) => group.id === active.id);
            const newIndex = orderedGroups.findIndex((group) => group.id === over.id);
            void reorderGroups(arrayMove(orderedGroups, oldIndex, newIndex).map((group) => group.id));
          }}
        >
          <SortableContext items={orderedGroups.map((group) => group.id)} strategy={verticalListSortingStrategy}>
          <div className="vault-groups">
          {orderedGroups.map((group) => {
            let rows = visibleVaults.filter((vault) => vault.groupName === group.name);
            if (!rows.length) return null;
            rows = sortVaults(rows, sort);
            const isCollapsed = collapsed.has(group.name);
            return (
              <VaultGroupList
                key={group.id}
                groupId={group.id}
                groupName={group.name}
                vaults={rows}
                collapsed={isCollapsed}
                dragEnabled={sort === 'custom' && !search}
                groupDragEnabled={sort === 'custom' && !search}
                onToggle={() => setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(group.name)) next.delete(group.name); else next.add(group.name);
                  return next;
                })}
                onReorder={(ids) => void reorderGroup(group.name, ids)}
                onFavorite={(vault) => void patchVault(vault.id, { favorite: !vault.favorite })}
                onOpen={(vault) => void openVault(vault)}
                openingVaultId={openingVaultId}
                onDetails={(vault) => {
                  selectVault(vault.id);
                  setDetailsOpen(true);
                }}
              />
            );
          })}
          </div>
          </SortableContext>
        </DndContext>
      )}

      <VaultDetailsDialog vault={selected} open={detailsOpen} onOpenChange={setDetailsOpen} onOpenVault={(vault) => void openVault(vault)} />
      <ConfirmDialog
        open={forceTarget !== null}
        onOpenChange={(open) => { if (!open) setForceTarget(null); }}
        title="目标 Obsidian 窗口未能正常关闭"
        description="可能有插件正在保存状态。强制处理会结束整个 Obsidian 进程，包括其他桌面的仓库，并可能丢失尚未落盘的工作区状态。"
        confirmLabel="强制关闭全部并打开"
        tone="danger"
        onConfirm={() => {
          if (!forceTarget) return;
          void desktop.forceCloseAndOpen(forceTarget.id).catch((error) => showToast({ tone: 'danger', message: String(error) }));
          setForceTarget(null);
        }}
      />
    </div>
  );
}

function Metric({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return <div className={`metric ${accent ? 'accent' : ''}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function sortVaults(vaults: VaultRecord[], sort: ReturnType<typeof useAppStore.getState>['sort']) {
  return [...vaults].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    if (sort === 'name') return a.displayName.localeCompare(b.displayName, 'zh-CN');
    if (sort === 'recent') return (b.lastOpened ?? 0) - (a.lastOpened ?? 0);
    if (sort === 'notes') return b.noteCount - a.noteCount;
    return a.orderIndex - b.orderIndex;
  });
}

interface VaultGroupListProps {
  groupId: string;
  groupName: string;
  vaults: VaultRecord[];
  collapsed: boolean;
  dragEnabled: boolean;
  groupDragEnabled: boolean;
  onToggle: () => void;
  onReorder: (ids: string[]) => void;
  onOpen: (vault: VaultRecord) => void;
  onDetails: (vault: VaultRecord) => void;
  onFavorite: (vault: VaultRecord) => void;
  openingVaultId: string | null;
}

function VaultGroupList(props: VaultGroupListProps) {
  const groupSortable = useSortable({ id: props.groupId, disabled: !props.groupDragEnabled });
  const groupStyle = { transform: CSS.Transform.toString(groupSortable.transform), transition: groupSortable.transition };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = props.vaults.findIndex((vault) => vault.id === active.id);
    const newIndex = props.vaults.findIndex((vault) => vault.id === over.id);
    props.onReorder(arrayMove(props.vaults, oldIndex, newIndex).map((vault) => vault.id));
  };

  return (
    <section ref={groupSortable.setNodeRef} style={groupStyle} className="vault-group">
      <button className="group-heading" type="button" onClick={props.onToggle} aria-expanded={!props.collapsed}>
        <span
          ref={groupSortable.setActivatorNodeRef}
          className="group-drag-handle"
          aria-label={`拖动分组 ${props.groupName}`}
          onClick={(event) => event.stopPropagation()}
          {...groupSortable.attributes}
          {...groupSortable.listeners}
        ><DotsSixVertical size={16} /></span>
        <CaretDown className={props.collapsed ? 'is-collapsed' : ''} size={16} />
        <strong>{props.groupName}</strong>
        <span>{props.vaults.length} 个仓库</span>
      </button>
      {!props.collapsed ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={props.vaults.map((vault) => vault.id)} strategy={verticalListSortingStrategy}>
            <div className="vault-list">
              {props.vaults.map((vault) => <VaultRow key={vault.id} vault={vault} {...props} />)}
            </div>
          </SortableContext>
        </DndContext>
      ) : null}
    </section>
  );
}

function VaultRow({ vault, dragEnabled, onOpen, onDetails, onFavorite, openingVaultId }: VaultGroupListProps & { vault: VaultRecord }) {
  const sortable = useSortable({ id: vault.id, disabled: !dragEnabled });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  const statusLabel = vault.health !== 'healthy' ? '路径异常' : vault.configState === 'drifted' ? '配置有差异' : '配置一致';
  return (
    <div ref={sortable.setNodeRef} style={style} className={`vault-row ${vault.isOpen ? 'is-open' : ''} ${vault.health !== 'healthy' ? 'has-error' : ''}`}>
      <button className="drag-handle" type="button" aria-label={`拖动 ${vault.displayName}`} {...sortable.attributes} {...sortable.listeners} disabled={!dragEnabled}><DotsSixVertical size={17} /></button>
      <button className="vault-main" type="button" onClick={() => onDetails(vault)} onDoubleClick={() => onOpen(vault)}>
        <span className="vault-glyph"><Note size={18} weight="duotone" /></span>
        <span className="vault-copy"><strong>{vault.displayName}</strong><small>{displayWindowsPath(vault.path)}</small></span>
      </button>
      <span className="vault-notes">{vault.noteCount.toLocaleString()} 篇</span>
      <span className={`config-badge ${vault.configState}`}>{vault.health !== 'healthy' ? <WarningCircle size={14} /> : null}{statusLabel}</span>
      <span className="last-opened">{formatRelative(vault.lastOpened)}</span>
      <button className={`row-action ${vault.favorite ? 'is-favorite' : ''}`} type="button" aria-label={vault.favorite ? '取消收藏' : '收藏'} onClick={() => onFavorite(vault)}><Heart size={18} weight={vault.favorite ? 'fill' : 'regular'} /></button>
      <button className="row-action open-action" type="button" onClick={() => onOpen(vault)} disabled={vault.health !== 'healthy' || openingVaultId === vault.id}>
        {openingVaultId === vault.id ? <ArrowClockwise className="spin" size={17} /> : <FolderOpen size={17} />}
        {openingVaultId === vault.id ? '切换中' : '打开'}
      </button>
    </div>
  );
}

function formatRelative(timestamp: number | null) {
  if (!timestamp) return '从未打开';
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return `${Math.floor(delta / 86_400_000)} 天前`;
}
