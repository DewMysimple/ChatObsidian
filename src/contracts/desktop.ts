export type ThemeMode = 'system' | 'light' | 'dark';
export type SwitchPolicy = 'single' | 'additive' | 'native';
export type OpenMode = 'configured' | 'single' | 'additive' | 'native';

export interface ShortcutBindings {
  showVaultCenter: string;
  singleOpen: string;
  additiveOpen: string;
}

export interface OpenVaultResult {
  action: 'focused' | 'moved' | 'opened' | 'dispatched' | 'reopened';
  effectiveMode: Exclude<OpenMode, 'configured'>;
  movedWindowCount: number;
  closedVaultIds: string[];
}
export type VaultHealth = 'healthy' | 'missing' | 'invalid';
export type ConfigState = 'synced' | 'drifted' | 'missing' | 'unchecked';
export type OperationStatus = 'running' | 'success' | 'failed' | 'rolled_back';
export type OperationKind = 'scan' | 'open' | 'sync' | 'rollback' | 'script' | 'index';
export type DiffStatus = 'added' | 'modified' | 'deleted' | 'unchanged';
export type SyncCategory =
  | 'shortcuts'
  | 'appearance'
  | 'core'
  | 'community_plugins'
  | 'plugin_data'
  | 'workspace';

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

export interface JsonChange {
  path: string;
  before: string | null;
  after: string | null;
}

export interface ConfigDiffEntry {
  targetVaultId: string;
  targetVaultName: string;
  relativePath: string;
  category: SyncCategory;
  status: DiffStatus;
  sourceSize: number;
  targetSize: number;
  jsonChanges: JsonChange[];
}

export interface ConfigDiff {
  sourcePath: string;
  targetCount: number;
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
  estimatedBackupBytes: number;
  entries: ConfigDiffEntry[];
}

export interface SyncPlan {
  sourcePath: string;
  targetVaultIds: string[];
  categories: SyncCategory[];
  pluginDataIds: string[];
  fullMirror: boolean;
  confirmWorkspace: boolean;
  confirmDeletions: boolean;
}

export interface BackupItem {
  vaultId: string;
  relativePath: string;
  existedBefore: boolean;
  size: number;
  hash: string | null;
}

export interface BackupManifest {
  operationId: string;
  createdAt: number;
  sourcePath: string;
  items: BackupItem[];
  targetPaths?: Record<string, string>;
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

export interface ScriptTool {
  id: string;
  name: string;
  description: string;
  path: string;
  exists: boolean;
  lastRun: OperationRecord | null;
}

export interface ScriptRunPreview {
  scriptId: string;
  name: string;
  description: string;
  scriptPath: string;
  pythonPath: string | null;
  pythonVersion: string | null;
  workingDirectory: string;
  terminal: string;
  logDirectory: string;
  interactive: boolean;
  ready: boolean;
  issues: string[];
}

export interface TemplatePlugin {
  id: string;
  name: string;
  version: string;
  hasData: boolean;
  enabled: boolean;
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

export interface ConfigChangeNotice {
  vaultId: string;
  vaultName: string;
  changedPaths: string[];
  checkedAt: number;
}

export interface DashboardData {
  vaults: VaultRecord[];
  groups: VaultGroup[];
  operations: OperationRecord[];
  preferences: AppPreferences;
  pendingChange: ConfigChangeNotice | null;
}

export interface UpdateVaultInput {
  id: string;
  displayName?: string;
  groupName?: string;
  tags?: string[];
  favorite?: boolean;
  hidden?: boolean;
  archived?: boolean;
  orderIndex?: number;
  excludedCategories?: SyncCategory[];
}

export interface ReorderVaultsInput {
  groupName: string;
  vaultIds: string[];
}

export interface ReorderGroupsInput {
  groupIds: string[];
}
