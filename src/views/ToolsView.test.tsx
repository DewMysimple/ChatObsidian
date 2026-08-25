import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktop } from '../lib/desktop';
import { mockOperations, mockScripts } from '../lib/mockData';
import { ToolsView } from './ToolsView';

const preview = {
  scriptId: 'sync',
  name: '.Synchronize.py',
  description: '同步模板内容',
  scriptPath: 'C:\\Users\\Administrator\\Desktop\\Obsidian仓库\\.Synchronize.py',
  pythonPath: 'D:\\03_Python\\Python\\python.exe',
  pythonVersion: 'Python 3.14.2',
  workingDirectory: 'C:\\Users\\Administrator\\Desktop\\Obsidian仓库',
  terminal: 'Windows Terminal',
  logDirectory: 'C:\\Users\\Administrator\\AppData\\Local\\ChatObsidian\\logs',
  interactive: true,
  ready: true,
  issues: [],
};

describe('ToolsView confirmation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not run before confirmation and runs once after confirmation', async () => {
    const user = userEvent.setup();
    vi.spyOn(desktop, 'listScripts').mockResolvedValue(mockScripts);
    vi.spyOn(desktop, 'previewScriptRun').mockResolvedValue(preview);
    const run = vi.spyOn(desktop, 'runScript').mockResolvedValue(mockOperations[0]);
    render(<ToolsView />);
    const row = (await screen.findByText('.Synchronize.py')).closest('.script-row')!;
    await user.click(row.querySelector<HTMLButtonElement>('.button.primary')!);
    expect(await screen.findByText('确认运行工具')).toBeVisible();
    expect(screen.getByText('D:\\03_Python\\Python\\python.exe')).toBeVisible();
    expect(run).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /确认并在终端运行/ }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it('cancel closes the preview without running', async () => {
    const user = userEvent.setup();
    vi.spyOn(desktop, 'listScripts').mockResolvedValue(mockScripts);
    vi.spyOn(desktop, 'previewScriptRun').mockResolvedValue(preview);
    const run = vi.spyOn(desktop, 'runScript').mockResolvedValue(mockOperations[0]);
    render(<ToolsView />);
    const row = (await screen.findByText('.Synchronize.py')).closest('.script-row')!;
    await user.click(row.querySelector<HTMLButtonElement>('.button.primary')!);
    await screen.findByText('确认运行工具');
    await user.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByText('确认运行工具')).not.toBeInTheDocument());
    expect(run).not.toHaveBeenCalled();
  });
});
