import { create } from "zustand";
import type {
  AppPreferences,
  OperationRecord,
  VaultGroup,
  VaultRecord,
} from "../contracts/desktop";
import type { Workspace } from "../contracts/workspace";
import { desktop } from "../lib/desktop";
import { mockPreferences } from "../lib/mockData";
import { readableError } from "../lib/workspace";

export type ViewId = "database" | "history" | "settings";
interface ToastState {
  tone: "success" | "warning" | "danger" | "neutral";
  message: string;
}
interface AppState {
  view: ViewId;
  collectionId: string;
  scope: "all" | "favorites" | "archive";
  workspace: Workspace | null;
  vaults: VaultRecord[];
  groups: VaultGroup[];
  operations: OperationRecord[];
  preferences: AppPreferences;
  loading: boolean;
  scanning: boolean;
  saving: boolean;
  error: string | null;
  toast: ToastState | null;
  setView: (view: ViewId) => void;
  navigate: (collectionId: string, scope?: AppState["scope"]) => void;
  setPreferences: (preferences: AppPreferences) => void;
  showToast: (toast: ToastState | null) => void;
  load: () => Promise<void>;
  refreshQuickSwitcher: (refreshNotes?: boolean) => Promise<void>;
  scan: () => Promise<void>;
  mutate: (change: (workspace: Workspace) => void) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => {
  let queue: Promise<void> = Promise.resolve();
  let quickRevision = 0;
  let pending = 0;
  let loadPromise: Promise<void> | null = null;
  return {
    view: "database",
    collectionId: "vaults",
    scope: "all",
    workspace: null,
    vaults: [],
    groups: [],
    operations: [],
    preferences: mockPreferences,
    loading: true,
    scanning: false,
    saving: false,
    error: null,
    toast: null,
    setView: (view) => set({ view }),
    navigate: (collectionId, scope = "all") =>
      set({ view: "database", collectionId, scope }),
    setPreferences: (preferences) => set({ preferences }),
    showToast: (toast) => set({ toast }),
    load: () => {
      if (loadPromise) return loadPromise;
      loadPromise = (async () => {
        set({ loading: true, error: null });
        try {
          await queue;
          const data = await desktop.getDashboard();
          const workspace = await desktop.getWorkspace();
          set({
            vaults: data.vaults,
            groups: data.groups,
            operations: data.operations,
            preferences: data.preferences,
            workspace,
            loading: false,
          });
          if (!data.vaults.length) void get().scan();
        } catch (error) {
          set({ loading: false, error: readableError(error) });
        }
      })().finally(() => {
        loadPromise = null;
      });
      return loadPromise;
    },
    refreshQuickSwitcher: async (refreshNotes = false) => {
      const revision = ++quickRevision;
      const result = await desktop.refreshQuickSwitcher(refreshNotes);
      if (revision === quickRevision)
        set({ vaults: result.vaults, groups: result.groups, loading: false });
    },
    scan: async () => {
      if (get().scanning || get().saving) return;
      set({ scanning: true });
      try {
        const result = await desktop.scanVaults();
        const workspace = await desktop.getWorkspace();
        set({
          vaults: result.vaults,
          groups: result.groups,
          workspace,
          scanning: false,
        });
        get().showToast({
          tone: result.warnings.length ? "warning" : "success",
          message: `找到 ${result.vaults.filter((v) => !v.isTemplate).length} 个仓库 · ${result.indexedNotes.toLocaleString()} 篇笔记${result.warnings.length ? `。${result.warnings.join("；")}` : ""}`,
        });
      } catch (error) {
        set({
          scanning: false,
          toast: { tone: "danger", message: readableError(error) },
        });
      }
    },
    mutate: (change) => {
      pending++;
      set({ saving: true });
      const task = queue.then(async () => {
        if (get().scanning) throw new Error("扫描正在进行，请完成后再编辑");
        const current = get().workspace;
        if (!current) throw new Error("数据库尚未加载");
        const next = structuredClone(current);
        change(next);
        const saved = await desktop.saveWorkspace(next);
        set({
          workspace: saved,
          vaults: get().vaults.map((vault) => {
            const item = saved.items.find((item) => item.vaultId === vault.id);
            return item
              ? {
                  ...vault,
                  displayName: item.title,
                  tags: item.tags,
                  favorite: item.favorite,
                  archived: item.archived,
                  hidden: false,
                }
              : vault;
          }),
        });
      });
      queue = task.catch(() => undefined);
      return task
        .catch((error) => {
          get().showToast({ tone: "danger", message: readableError(error) });
          throw error;
        })
        .finally(() => {
          pending--;
          set({ saving: pending > 0 });
        });
    },
  };
});
