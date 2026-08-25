import { invoke } from '@tauri-apps/api/core';
import type {
  AppPreferences,
  OpenMode,
  OpenVaultResult,
  ConfigChangeNotice,
  ConfigDiff,
  DashboardData,
  NoteIndexEntry,
  OperationRecord,
  ReorderVaultsInput,
  ReorderGroupsInput,
  ScanResult,
  ScriptTool,
  ScriptRunPreview,
  SyncCategory,
  SyncPlan,
  TemplatePlugin,
  UpdateVaultInput,
} from '../contracts/desktop';
import { mockDashboard, mockNotes, mockOperations, mockPlugins, mockScripts } from './mockData';

export const isTauri = () => '__TAURI_INTERNALS__' in window;

async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) return mockCall<T>(command, args);
  return invoke<T>(command, args);
}

async function mockCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, command === 'scan_vaults' ? 420 : 90));
  switch (command) {
    case 'get_dashboard':
      return structuredClone(mockDashboard) as T;
    case 'scan_vaults':
      return {
        vaults: mockDashboard.vaults,
        groups: mockDashboard.groups,
        indexedNotes: 6127,
        warnings: ['当前为浏览器演示模式，桌面文件系统未连接'],
      } as T;
    case 'search_notes': {
      const query = String(args.query ?? '').toLowerCase();
      return mockNotes.filter((note) => `${note.title} ${note.relativePath}`.toLowerCase().includes(query)) as T;
    }
    case 'list_scripts':
      return mockScripts as T;
    case 'preview_script_run': {
      const script = mockScripts.find((item) => item.id === args.scriptId) ?? mockScripts[0];
      return {
        scriptId: script.id,
        name: script.name,
        description: script.description,
        scriptPath: script.path,
        pythonPath: 'D:\\03_Python\\Python\\python.exe',
        pythonVersion: 'Python 3.14.2',
        workingDirectory: 'C:\\Users\\Administrator\\Desktop\\Obsidian仓库',
        terminal: 'Windows Terminal',
        logDirectory: 'C:\\Users\\Administrator\\AppData\\Local\\ChatObsidian\\logs',
        interactive: true,
        ready: true,
        issues: [],
      } as T;
    }
    case 'list_template_plugins':
      return mockPlugins as T;
    case 'list_operations':
    case 'refresh_script_runs':
      return mockOperations as T;
    case 'compute_config_diff':
      return {
        sourcePath: String((args.plan as SyncPlan)?.sourcePath ?? mockDashboard.preferences.templatePath),
        targetCount: (args.plan as SyncPlan)?.targetVaultIds.length ?? 0,
        added: 3,
        modified: 9,
        deleted: 0,
        unchanged: 124,
        estimatedBackupBytes: 48320,
        entries: [],
      } as T;
    case 'check_active_config_change':
      return null as T;
    case 'save_preferences':
      return structuredClone(args.preferences) as T;
    case 'apply_sync':
    case 'rollback_operation':
    case 'adopt_vault_config':
    case 'run_script':
      return structuredClone(mockOperations[0]) as T;
    case 'select_directory':
      return null as T;
    default:
      return undefined as T;
  }
}

export const desktop = {
  getDashboard: () => call<DashboardData>('get_dashboard'),
  scanVaults: () => call<ScanResult>('scan_vaults'),
  updateVault: (input: UpdateVaultInput) => call<void>('update_vault', { input }),
  reorderVaults: (input: ReorderVaultsInput) => call<void>('reorder_vaults', { input }),
  reorderGroups: (input: ReorderGroupsInput) => call<void>('reorder_groups', { input }),
  openVault: (vaultId: string, relativePath?: string, mode: OpenMode = 'configured') =>
    call<OpenVaultResult>('open_vault', { vaultId, relativePath: relativePath ?? null, mode }),
  forceCloseAndOpen: (vaultId: string, relativePath?: string, mode: OpenMode = 'configured') =>
    call<OpenVaultResult>('force_close_and_open', { vaultId, relativePath: relativePath ?? null, mode }),
  searchNotes: (query: string, limit = 40) => call<NoteIndexEntry[]>('search_notes', { query, limit }),
  computeConfigDiff: (plan: SyncPlan) => call<ConfigDiff>('compute_config_diff', { plan }),
  applySync: (plan: SyncPlan) => call<OperationRecord>('apply_sync', { plan }),
  rollbackOperation: (operationId: string) => call<OperationRecord>('rollback_operation', { operationId }),
  adoptVaultConfig: (vaultId: string, categories: SyncCategory[]) =>
    call<OperationRecord>('adopt_vault_config', { vaultId, categories }),
  checkActiveConfigChange: () => call<ConfigChangeNotice | null>('check_active_config_change'),
  dismissConfigChange: (vaultId: string) => call<void>('dismiss_config_change', { vaultId }),
  listScripts: () => call<ScriptTool[]>('list_scripts'),
  previewScriptRun: (scriptId: string) => call<ScriptRunPreview>('preview_script_run', { scriptId }),
  listTemplatePlugins: () => call<TemplatePlugin[]>('list_template_plugins'),
  runScript: (scriptId: string) => call<OperationRecord>('run_script', { scriptId }),
  refreshScriptRuns: () => call<OperationRecord[]>('refresh_script_runs'),
  listOperations: () => call<OperationRecord[]>('list_operations'),
  openLocalPath: (path: string) => call<void>('open_local_path', { path }),
  savePreferences: (preferences: AppPreferences) =>
    call<AppPreferences>('save_preferences', { preferences }),
  selectDirectory: () => call<string | null>('select_directory'),
  showQuickSwitcher: (mode?: OpenMode) => call<void>('show_quick_switcher', { mode: mode ?? null }),
  hideQuickSwitcher: () => call<void>('hide_quick_switcher'),
  beginShortcutCapture: () => call<void>('begin_shortcut_capture'),
  cancelShortcutCapture: () => call<void>('cancel_shortcut_capture'),
};
