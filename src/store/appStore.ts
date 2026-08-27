import { create } from 'zustand';
import type {
  AppPreferences,
  ConfigChangeNotice,
  OperationRecord,
  VaultGroup,
  VaultRecord,
} from '../contracts/desktop';
import { desktop } from '../lib/desktop';
import { mockPreferences } from '../lib/mockData';

export type ViewId = 'vaults' | 'sync' | 'template' | 'tools' | 'history' | 'settings';
export type VaultSort = 'custom' | 'name' | 'recent' | 'notes';

interface ToastState {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  message: string;
}

interface AppState {
  view: ViewId;
  vaults: VaultRecord[];
  groups: VaultGroup[];
  operations: OperationRecord[];
  preferences: AppPreferences;
  pendingChange: ConfigChangeNotice | null;
  selectedVaultId: string | null;
  loading: boolean;
  scanning: boolean;
  search: string;
  sort: VaultSort;
  toast: ToastState | null;
  setView: (view: ViewId) => void;
  setSearch: (search: string) => void;
  setSort: (sort: VaultSort) => void;
  selectVault: (id: string | null) => void;
  setPreferences: (preferences: AppPreferences) => void;
  showToast: (toast: ToastState | null) => void;
  load: () => Promise<void>;
  refreshQuickSwitcher: (refreshNotes?: boolean) => Promise<void>;
  scan: () => Promise<void>;
  patchVault: (id: string, patch: Partial<VaultRecord>) => Promise<void>;
  reorderGroup: (groupName: string, vaultIds: string[]) => Promise<void>;
  reorderGroups: (groupIds: string[]) => Promise<void>;
  setPendingChange: (notice: ConfigChangeNotice | null) => void;
}

export const useAppStore = create<AppState>((set, get) => {
  let quickRefreshRevision = 0;
  return ({
  view: 'vaults',
  vaults: [],
  groups: [],
  operations: [],
  preferences: mockPreferences,
  pendingChange: null,
  selectedVaultId: null,
  loading: true,
  scanning: false,
  search: '',
  sort: 'custom',
  toast: null,
  setView: (view) => set({ view }),
  setSearch: (search) => set({ search }),
  setSort: (sort) => set({ sort }),
  selectVault: (selectedVaultId) => set({ selectedVaultId }),
  setPreferences: (preferences) => set({ preferences }),
  showToast: (toast) => set({ toast }),
  setPendingChange: (pendingChange) => set({ pendingChange }),
  load: async () => {
    set({ loading: true });
    try {
      const data = await desktop.getDashboard();
      set({ ...data, loading: false });
    } catch (error) {
      set({
        loading: false,
        toast: { tone: 'danger', message: `无法加载本地数据：${String(error)}` },
      });
    }
  },
  refreshQuickSwitcher: async (refreshNotes = false) => {
    const revision = ++quickRefreshRevision;
    const result = await desktop.refreshQuickSwitcher(refreshNotes);
    if (revision !== quickRefreshRevision) return;
    set({ vaults: result.vaults, groups: result.groups, loading: false });
  },
  scan: async () => {
    set({ scanning: true });
    try {
      const result = await desktop.scanVaults();
      set({ vaults: result.vaults, groups: result.groups, scanning: false });
      get().showToast({
        tone: result.warnings.length ? 'warning' : 'success',
        message: `扫描完成：${result.vaults.filter((vault) => !vault.isTemplate).length} 个仓库，${result.indexedNotes.toLocaleString()} 篇笔记标题`,
      });
    } catch (error) {
      set({ scanning: false, toast: { tone: 'danger', message: `扫描失败：${String(error)}` } });
    }
  },
  patchVault: async (id, patch) => {
    const before = get().vaults;
    set({ vaults: before.map((vault) => (vault.id === id ? { ...vault, ...patch } : vault)) });
    try {
      await desktop.updateVault({ id, ...patch });
    } catch (error) {
      set({ vaults: before, toast: { tone: 'danger', message: `保存仓库设置失败：${String(error)}` } });
    }
  },
  reorderGroup: async (groupName, vaultIds) => {
    const before = get().vaults;
    const order = new Map(vaultIds.map((id, index) => [id, index]));
    set({
      vaults: before.map((vault) =>
        vault.groupName === groupName && order.has(vault.id)
          ? { ...vault, orderIndex: order.get(vault.id)! }
          : vault,
      ),
    });
    try {
      await desktop.reorderVaults({ groupName, vaultIds });
    } catch (error) {
      set({ vaults: before, toast: { tone: 'danger', message: `保存排序失败：${String(error)}` } });
    }
  },
  reorderGroups: async (groupIds) => {
    const before = get().groups;
    const order = new Map(groupIds.map((id, index) => [id, index]));
    set({
      groups: [...before]
        .sort((a, b) => (order.get(a.id) ?? a.orderIndex) - (order.get(b.id) ?? b.orderIndex))
        .map((group, index) => ({ ...group, orderIndex: index })),
    });
    try {
      await desktop.reorderGroups({ groupIds });
    } catch (error) {
      set({ groups: before, toast: { tone: 'danger', message: `保存分组排序失败：${String(error)}` } });
    }
  },
  });
});
