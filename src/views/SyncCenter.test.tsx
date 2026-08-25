import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDashboard } from '../lib/mockData';
import { useAppStore } from '../store/appStore';
import { SyncCenter } from './SyncCenter';

describe('SyncCenter safety defaults', () => {
  beforeEach(() => {
    useAppStore.setState({
      vaults: structuredClone(mockDashboard.vaults),
      preferences: structuredClone(mockDashboard.preferences),
      loading: false,
    });
  });

  it('excludes workspace state and full mirror by default', () => {
    render(<SyncCenter />);
    const workspace = screen.getByText('工作区状态').closest('label')?.querySelector('input');
    const mirror = screen.getByText('高级完整镜像').closest('label')?.querySelector('input');
    expect(workspace).not.toBeChecked();
    expect(mirror).not.toBeChecked();
  });

  it('keeps the interface responsive while a diff is computed', async () => {
    const user = userEvent.setup();
    render(<SyncCenter />);
    await user.click(screen.getByRole('button', { name: '生成差异' }));
    expect(screen.getByRole('button', { name: '后台比较中…' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('安全同步模式')).toBeVisible();
    expect(await screen.findByText('47.2 KB')).toBeVisible();
  });
});
