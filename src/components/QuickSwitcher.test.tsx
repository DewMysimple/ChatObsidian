import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDashboard } from '../lib/mockData';
import { useAppStore } from '../store/appStore';
import { QuickSwitcher } from './QuickSwitcher';

describe('QuickSwitcher', () => {
  beforeEach(() => {
    useAppStore.setState({
      vaults: structuredClone(mockDashboard.vaults),
      groups: structuredClone(mockDashboard.groups),
      loading: false,
    });
  });

  it('searches note titles and shows their vault context', async () => {
    const user = userEvent.setup();
    render(<QuickSwitcher />);
    await user.type(screen.getByLabelText('搜索仓库或笔记标题'), 'Agent');
    await waitFor(() => expect(screen.getByText('Agent 设计')).toBeInTheDocument());
    expect(screen.getByText(/ChatAgent \/ 项目\/Agent 设计\.md/)).toBeInTheDocument();
  });

  it('keeps favorites first for an empty query', () => {
    render(<QuickSwitcher />);
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent(mockDashboard.vaults.find((vault) => vault.favorite)!.displayName);
  });
});
