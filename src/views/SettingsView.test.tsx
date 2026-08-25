import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktop } from '../lib/desktop';
import { mockPreferences } from '../lib/mockData';
import { useAppStore } from '../store/appStore';
import { SettingsView } from './SettingsView';

describe('SettingsView autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({ preferences: structuredClone(mockPreferences), loading: false, toast: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('saves switches immediately', async () => {
    const save = vi.spyOn(desktop, 'savePreferences').mockImplementation(async (preferences) => preferences);
    render(<SettingsView />);
    fireEvent.click(screen.getByText('深色').closest('label')!.querySelector('input')!);
    await act(async () => { await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].theme).toBe('dark');
  });

  it('saves the Windows startup preference immediately', async () => {
    const save = vi.spyOn(desktop, 'savePreferences').mockImplementation(async (preferences) => preferences);
    render(<SettingsView />);
    fireEvent.click(screen.getByText('登录 Windows 时自动启动').closest('label')!.querySelector('input')!);
    await act(async () => { await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].launchAtStartup).toBe(true);
  });

  it('records and saves a shortcut immediately', async () => {
    const save = vi.spyOn(desktop, 'savePreferences').mockImplementation(async (preferences) => preferences);
    vi.spyOn(desktop, 'beginShortcutCapture').mockResolvedValue(undefined);
    render(<SettingsView />);
    fireEvent.click(screen.getAllByText('录制')[0]);
    await act(async () => { await Promise.resolve(); });
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', ctrlKey: true, altKey: true });
    await act(async () => { await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].shortcuts.showVaultCenter).toBe('Ctrl+Alt+P');
  });

  it('rejects a shortcut already used by another action', async () => {
    const save = vi.spyOn(desktop, 'savePreferences').mockImplementation(async (preferences) => preferences);
    vi.spyOn(desktop, 'beginShortcutCapture').mockResolvedValue(undefined);
    vi.spyOn(desktop, 'cancelShortcutCapture').mockResolvedValue(undefined);
    render(<SettingsView />);
    fireEvent.click(screen.getAllByText('录制')[0]);
    await act(async () => { await Promise.resolve(); });
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', ctrlKey: true, altKey: true });
    await act(async () => { await Promise.resolve(); });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getAllByText(/已用于其他动作/).length).toBeGreaterThan(0);
  });
});
