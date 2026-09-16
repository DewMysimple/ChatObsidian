import { invoke } from "@tauri-apps/api/core";
import type {
  AppPreferences,
  DashboardData,
  NoteIndexEntry,
  OpenMode,
  OpenVaultResult,
  OperationRecord,
  QuickSwitcherRefresh,
  ScanResult,
} from "../contracts/desktop";
import {
  newItem,
  newView,
  covers,
  type Workspace,
} from "../contracts/workspace";
import { mockDashboard, mockNotes } from "./mockData";

export const isTauri = () => "__TAURI_INTERNALS__" in window;
const demoKey = "chatobsidian.workspace.v1";
const preferencesKey = "chatobsidian.preferences.v1";

function demoWorkspace(): Workspace {
  const stored = localStorage.getItem(demoKey);
  if (stored) return JSON.parse(stored) as Workspace;
  const collections = [
    {
      id: "vaults",
      name: "仓库画廊",
      icon: "◈",
      description: "给知识一个井然有序的家。",
      properties: [],
    },
    {
      id: "library",
      name: "灵感与项目",
      icon: "✳",
      description: "收集想法，让值得做的事慢慢发生。",
      properties: [],
    },
  ];
  const descriptions = [
    "探索智能体、提示词与人与 AI 的协作。",
    "从一行代码开始，构建自己的技术地图。",
    "小脚本，大想法。记录每一个解题过程。",
    "理解模型背后的数学与直觉。",
    "把日常写下来，留住生活的细小回声。",
    "在虚拟世界里，创造真实的可能。",
    "形体、材质与光影的实验室。",
    "用清晰的结构理解复杂的世界。",
    "重新发现数学之美。",
    "收集让人心动的游戏与设计。",
  ];
  const items = mockDashboard.vaults.map((vault, index) => ({
    ...newItem("vaults"),
    id: `vault:${vault.id}`,
    vaultId: vault.id,
    title: vault.displayName,
    icon: ["◈", "⌘", "λ", "◎", "✎", "◇", "◉", "∑", "∞", "▦"][index],
    cover: covers[index % covers.length],
    description: descriptions[index],
    status: "active" as const,
    tags: [vault.groupName, ...(index % 3 === 0 ? ["常用"] : [])],
    favorite: vault.favorite,
  }));
  const pages = [
    ["阅读清单", "✳", "值得慢慢读的书，和读过之后的想法。"],
    ["下一次旅行", "↗", "沿着好奇心，去一个没去过的地方。"],
    ["个人网站", "⌘", "为作品和文字留一块自己的空间。"],
  ].map(([title, icon, description], index) => ({
    ...newItem("library"),
    title,
    icon,
    description,
    cover: covers[index + 1],
  }));
  const workspace = {
    revision: 0,
    collections,
    items: [...items, ...pages],
    views: collections.flatMap((collection) =>
      (
        [
          ["gallery", "画廊"],
          ["table", "表格"],
          ["board", "看板"],
        ] as const
      ).map(([layout, name]) => newView(collection.id, layout, name)),
    ),
  };
  localStorage.setItem(demoKey, JSON.stringify(workspace));
  return workspace;
}

async function call<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (isTauri()) return invoke<T>(command, args);
  switch (command) {
    case "get_dashboard": {
      const dashboard = structuredClone(mockDashboard);
      const preferences = localStorage.getItem(preferencesKey);
      if (preferences) dashboard.preferences = JSON.parse(preferences);
      return dashboard as T;
    }
    case "get_workspace":
      return structuredClone(demoWorkspace()) as T;
    case "export_workspace": {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              format: "chatobsidian.workspace.v1",
              exportedAt: Date.now(),
              workspace: demoWorkspace(),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ChatObsidian-workspace.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return "ChatObsidian-workspace.json" as T;
    }
    case "save_workspace": {
      const current = demoWorkspace();
      const next = structuredClone(args.workspace as Workspace);
      if (next.revision !== current.revision)
        throw new Error("WORKSPACE_CONFLICT：数据已更新，请重新加载");
      next.revision++;
      localStorage.setItem(demoKey, JSON.stringify(next));
      return next as T;
    }
    case "save_preferences":
      localStorage.setItem(preferencesKey, JSON.stringify(args.preferences));
      return structuredClone(args.preferences) as T;
    case "scan_vaults":
      return {
        vaults: structuredClone(mockDashboard.vaults),
        groups: structuredClone(mockDashboard.groups),
        indexedNotes: 5318,
        warnings: ["浏览器演示不会扫描本地文件"],
      } as T;
    case "refresh_quick_switcher":
      return {
        vaults: structuredClone(mockDashboard.vaults),
        groups: structuredClone(mockDashboard.groups),
        indexedNotes: 5318,
        refreshedAt: Date.now(),
      } as T;
    case "search_notes":
      return mockNotes
        .filter((note) =>
          note.title
            .toLocaleLowerCase()
            .includes(String(args.query).toLocaleLowerCase()),
        )
        .slice(0, Number(args.limit ?? 40)) as T;
    case "open_vault":
      return {
        action: "dispatched",
        effectiveMode: args.mode === "configured" ? "additive" : args.mode,
        movedWindowCount: 0,
        closedVaultIds: [],
      } as T;
    case "list_operations":
      return structuredClone(mockDashboard.operations) as T;
    case "select_directory":
      return null as T;
    case "show_quick_switcher":
      window.dispatchEvent(
        new CustomEvent("demo-quick-open", { detail: args.mode }),
      );
      return undefined as T;
    case "hide_quick_switcher":
      window.dispatchEvent(new Event("demo-quick-close"));
      return undefined as T;
    case "open_local_path":
      throw new Error("请在桌面版中打开本地目录");
    default:
      throw new Error(`未实现的桌面命令：${command}`);
  }
}

export const desktop = {
  getDashboard: () => call<DashboardData>("get_dashboard"),
  getWorkspace: () => call<Workspace>("get_workspace"),
  exportWorkspace: () => call<string | null>("export_workspace"),
  saveWorkspace: (workspace: Workspace) =>
    call<Workspace>("save_workspace", { workspace }),
  scanVaults: () => call<ScanResult>("scan_vaults"),
  openVault: (
    vaultId: string,
    relativePath?: string,
    mode: OpenMode = "configured",
  ) =>
    call<OpenVaultResult>("open_vault", {
      vaultId,
      relativePath: relativePath ?? null,
      mode,
    }),
  searchNotes: (query: string, limit = 40) =>
    call<NoteIndexEntry[]>("search_notes", { query, limit }),
  refreshQuickSwitcher: (refreshNotes = false) =>
    call<QuickSwitcherRefresh>("refresh_quick_switcher", { refreshNotes }),
  listOperations: () => call<OperationRecord[]>("list_operations"),
  openLocalPath: (path: string) => call<void>("open_local_path", { path }),
  savePreferences: (preferences: AppPreferences) =>
    call<AppPreferences>("save_preferences", { preferences }),
  selectDirectory: () => call<string | null>("select_directory"),
  showQuickSwitcher: (mode?: OpenMode) =>
    call<void>("show_quick_switcher", { mode: mode ?? null }),
  hideQuickSwitcher: () => call<void>("hide_quick_switcher"),
};
