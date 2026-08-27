import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDashboard } from '../lib/mockData';
import { useAppStore } from '../store/appStore';
import { QuickSwitcher } from './QuickSwitcher';

describe('QuickSwitcher', () => {
  beforeEach(() => {
    window.localStorage.clear();
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

  it('sorts empty-query vaults by most recent open time', () => {
    render(<QuickSwitcher />);
    const options = screen.getAllByRole('option');
    const expected = [...mockDashboard.vaults].sort((left, right) => {
      if (left.isOpen !== right.isOpen) return left.isOpen ? -1 : 1;
      return (right.lastOpened ?? -Infinity) - (left.lastOpened ?? -Infinity);
    })[0];
    expect(options[0]).toHaveTextContent(expected.displayName);
  });

  it('keeps an actually open vault above a newer closed record', () => {
    const vaults = structuredClone(mockDashboard.vaults).map((vault) => ({ ...vault, isOpen: false }));
    vaults[0] = { ...vaults[0], displayName: 'Closed but newer', lastOpened: Date.now() };
    vaults[1] = { ...vaults[1], displayName: 'Open target', isOpen: true, lastOpened: Date.now() - 86_400_000 };
    useAppStore.setState({ vaults });
    render(<QuickSwitcher />);
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Open target');
  });

  it('shows the number of available vaults beside the vault filter', () => {
    render(<QuickSwitcher />);
    expect(screen.getByRole('button', { name: `仓库，共 ${mockDashboard.vaults.length} 个` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `仓库，共 ${mockDashboard.vaults.length} 个` })).toHaveTextContent(String(mockDashboard.vaults.length));
  });

  it('shows explicit type badges and keeps vaults before notes', async () => {
    const user = userEvent.setup();
    render(<QuickSwitcher />);
    await user.type(screen.getByLabelText('搜索仓库或笔记标题'), 'Agent');
    await waitFor(() => expect(screen.getByText('Agent 设计')).toBeInTheDocument());
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('仓库');
    expect(options[1]).toHaveTextContent('笔记');
  });

  it('filters results by the two remembered type switches', async () => {
    const user = userEvent.setup();
    render(<QuickSwitcher />);
    await user.click(screen.getByRole('button', { name: /仓库，共/ }));
    expect(screen.getByRole('button', { name: /仓库，共/ })).toHaveAttribute('aria-pressed', 'false');
    await user.type(screen.getByLabelText('搜索仓库或笔记标题'), 'Agent');
    await waitFor(() => expect(screen.getByText('Agent 设计')).toBeInTheDocument());
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('笔记');
  });

  it('remembers type switches after the component is remounted', async () => {
    const user = userEvent.setup();
    const first = render(<QuickSwitcher />);
    await user.click(screen.getByRole('button', { name: '笔记' }));
    first.unmount();
    render(<QuickSwitcher />);
    expect(screen.getByRole('button', { name: '笔记' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not truncate a vault list longer than ten rows', () => {
    const vaults = [...structuredClone(mockDashboard.vaults), ...Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(mockDashboard.vaults[0]),
      id: `extra-${index}`,
      displayName: `Extra ${index}`,
      name: `Extra ${index}`,
      lastOpened: null,
    }))];
    useAppStore.setState({ vaults });
    render(<QuickSwitcher />);
    expect(screen.getAllByRole('option')).toHaveLength(15);
  });
});
