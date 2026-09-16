export type ThemeMode = "system" | "light" | "dark";
export type SwitchPolicy = "single" | "additive" | "native";
export type OpenMode = "configured" | "single" | "additive" | "native";

export interface ShortcutBindings {
  showVaultCenter: string;
  singleOpen: string;
  additiveOpen: string;
}

export interface OpenVaultResult {
  action: "focused" | "moved" | "opened" | "dispatched" | "reopened";
  effectiveMode: Exclude<OpenMode, "configured">;
  movedWindowCount: number;
  closedVaultIds: string[];
}
export type VaultHealth = "healthy" | "missing" | "invalid";
export type ConfigState = "synced" | "drifted" | "missing" | "unchecked";
export type OperationStatus = "running" | "success" | "failed" | "rolled_back";
export type OperationKind =
  | "scan"
  | "open"
  | "sync"
  | "rollback"
  | "script"
  | "index";
export type DiffStatus = "added" | "modified" | "deleted" | "unchanged";
export type SyncCategory =
  | "shortcuts"
  | "appearance"
  | "core"
  | "community_plugins"
  | "plugin_data"
  | "workspace";

export interface VaultRecord {
  id: string;
  obsidianId: string | null;
  path: string;
  name: string;
  displayName: string;
  groupName: string;
  tags: string[];
  favorite: boolean;
  hidden: boolean;
  archived: boolean;
  orderIndex: number;
  noteCount: number;
  lastOpened: number | null;
  isOpen: boolean;
  health: VaultHealth;
  configState: ConfigState;
  isTemplate: boolean;
  excludedCategories: SyncCategory[];
}

export interface VaultGroup {
  id: string;
  name: string;
  orderIndex: number;
  collapsed: boolean;
  vaultCount: number;
}

export interface NoteIndexEntry {
  id: number;
  vaultId: string;
  vaultName: string;
  relativePath: string;
  title: string;
  modifiedAt: number;
}

export interface QuickSwitcherRefresh {
  vaults: VaultRecord[];
  groups: VaultGroup[];
  indexedNotes: number;
  refreshedAt: number;
}

export interface OperationRecord {
  id: string;
  kind: OperationKind;
  title: string;
  status: OperationStatus;
  detail: string;
  createdAt: number;
  finishedAt: number | null;
  canRollback: boolean;
  logPath: string | null;
}

export interface AppPreferences {
  settingsVersion: number;
  theme: ThemeMode;
  switchPolicy: SwitchPolicy;
  scanRoots: string[];
  templatePath: string;
  shortcuts: ShortcutBindings;
  backupRetentionDays: number;
  backupRetentionCount: number;
  closeToTray: boolean;
  launchAtStartup: boolean;
  enabledPluginDataIds: string[];
}

export interface ScanResult {
  vaults: VaultRecord[];
  groups: VaultGroup[];
  indexedNotes: number;
  warnings: string[];
}

export interface DashboardData {
  vaults: VaultRecord[];
  groups: VaultGroup[];
  operations: OperationRecord[];
  preferences: AppPreferences;
}
