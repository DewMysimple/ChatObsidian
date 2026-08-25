import type {
  AppPreferences,
  DashboardData,
  NoteIndexEntry,
  OperationRecord,
  ScriptTool,
  TemplatePlugin,
  VaultGroup,
  VaultRecord,
} from '../contracts/desktop';

export const mockPreferences: AppPreferences = {
  settingsVersion: 3,
  theme: 'system',
  switchPolicy: 'additive',
  scanRoots: ['C:\\Users\\Administrator\\Desktop\\Obsidian仓库'],
  templatePath: 'C:\\Users\\Administrator\\Desktop\\Obsidian仓库\\.模板\\.obsidian',
  shortcuts: {
    showVaultCenter: 'Ctrl+Alt+O',
    singleOpen: 'Ctrl+Alt+1',
    additiveOpen: 'Ctrl+Alt+2',
  },
  backupRetentionDays: 30,
  backupRetentionCount: 20,
  closeToTray: true,
  launchAtStartup: false,
  enabledPluginDataIds: [],
};

const seedVaults = [
  ['chat-agent', 'ChatAgent', 'ChatAI', 2140, true, true],
  ['chat-stack', 'ChatTechStack', 'ChatAI', 416, true, false],
  ['python', 'Python', 'ChatAI', 128, false, false],
  ['deep-learning', 'DeepLearning', 'ChatMysimple', 675, true, false],
  ['diary', 'Diary', 'ChatMysimple', 352, false, false],
  ['unreal', 'ChatUnreal', 'ChatTechArt', 564, true, false],
  ['blender', 'ChatBlender', 'ChatTechArt', 285, false, false],
  ['linear', '线性代数', 'ChatAcademic', 380, false, false],
  ['math', '高等数学', 'ChatAcademic', 194, false, false],
  ['game-design', '《游戏设计艺术》', 'ChatBook', 184, false, false],
] as const;

export const mockVaults: VaultRecord[] = seedVaults.map(
  ([id, name, group, noteCount, favorite, isOpen], index) => ({
    id,
    obsidianId: id.padEnd(16, '0').slice(0, 16),
    path: `C:\\Users\\Administrator\\Desktop\\Obsidian仓库\\${group}\\${name}`,
    name,
    displayName: name,
    groupName: group,
    tags: index % 3 === 0 ? ['常用'] : [],
    favorite,
    hidden: false,
    archived: false,
    orderIndex: index,
    noteCount,
    lastOpened: Date.now() - index * 3_600_000,
    isOpen,
    health: 'healthy',
    configState: index === 4 ? 'drifted' : 'synced',
    isTemplate: false,
    excludedCategories: [],
  }),
);

export const mockGroups: VaultGroup[] = [...new Set(mockVaults.map((vault) => vault.groupName))].map(
  (name, index) => ({
    id: name.toLowerCase(),
    name,
    orderIndex: index,
    collapsed: false,
    vaultCount: mockVaults.filter((vault) => vault.groupName === name).length,
  }),
);

export const mockOperations: OperationRecord[] = [
  {
    id: 'op-scan',
    kind: 'scan',
    title: '仓库扫描完成',
    status: 'success',
    detail: '发现 39 个仓库，索引 6,127 篇笔记标题',
    createdAt: Date.now() - 120_000,
    finishedAt: Date.now() - 119_200,
    canRollback: false,
    logPath: null,
  },
  {
    id: 'op-sync',
    kind: 'sync',
    title: '快捷键配置同步',
    status: 'success',
    detail: '已同步到 38 个仓库，可回滚',
    createdAt: Date.now() - 86_400_000,
    finishedAt: Date.now() - 86_390_000,
    canRollback: true,
    logPath: null,
  },
];

export const mockDashboard: DashboardData = {
  vaults: mockVaults,
  groups: mockGroups,
  operations: mockOperations,
  preferences: mockPreferences,
  pendingChange: null,
};

export const mockNotes: NoteIndexEntry[] = [
  { id: 1, vaultId: 'chat-agent', vaultName: 'ChatAgent', relativePath: '项目/Agent 设计.md', title: 'Agent 设计', modifiedAt: Date.now() },
  { id: 2, vaultId: 'linear', vaultName: '线性代数', relativePath: '第二章/矩阵.md', title: '矩阵', modifiedAt: Date.now() - 2000 },
  { id: 3, vaultId: 'unreal', vaultName: 'ChatUnreal', relativePath: '材质/Shader 入门.md', title: 'Shader 入门', modifiedAt: Date.now() - 3000 },
];

export const mockScripts: ScriptTool[] = [
  ['backup', '.Backup删除.py', '清理历史备份目录'],
  ['claude', '.Claude替换.py', '同步 Claude 配置'],
  ['convert', '.Convert_txt.py', '批量转换 TXT 文件'],
  ['number', '.Number统计.py', '统计仓库编号与数量'],
  ['obsidian', '.Obsidian替换.py', '完整同步 Obsidian 配置'],
  ['sync', '.Synchronize.py', '同步模板内容'],
  ['templater', '.Templater替换.py', '同步 Templater 配置'],
  ['trash', '.Trash删除.py', '清理仓库废纸篓'],
  ['web', '.Web替换.py', '同步 Web 插件配置'],
].map(([id, name, description]) => ({
  id,
  name,
  description,
  path: `C:\\Users\\Administrator\\Desktop\\Obsidian仓库\\${name}`,
  exists: true,
  lastRun: null,
}));

export const mockPlugins: TemplatePlugin[] = [
  { id: 'copilot', name: 'Copilot', version: '2.8.15', hasData: true, enabled: true },
  { id: 'dataview', name: 'Dataview', version: '0.5.68', hasData: false, enabled: true },
  { id: 'file-explorer-note-count', name: 'File Explorer Note Count', version: '1.2.2', hasData: false, enabled: true },
  { id: 'multi-properties', name: 'Multi Properties', version: '1.3.0', hasData: true, enabled: true },
  { id: 'obsidian-icon-folder', name: 'Icon Folder', version: '2.7.4', hasData: true, enabled: true },
  { id: 'recent-files-obsidian', name: 'Recent Files', version: '1.7.1', hasData: true, enabled: true },
  { id: 'realclaudian', name: 'RealClaudian', version: '1.1.0', hasData: true, enabled: true },
];
