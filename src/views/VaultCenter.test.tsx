import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktop } from '../lib/desktop';
import { mockGroups, mockVaults } from '../lib/mockData';
import { useAppStore } from '../store/appStore';
import { VaultCenter } from './VaultCenter';

describe('VaultCenter opening state', () => {
  beforeEach(() => {
    useAppStore.setState({
      vaults: mockVaults,
      groups: mockGroups,
      search: '',
      sort: 'custom',
      selectedVaultId: null,
      scanning: false,
      toast: null,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('only marks the selected vault button as busy', async () => {
    let finishOpen!: () => void;
    vi.spyOn(desktop, 'openVault').mockImplementation(
      () => new Promise((resolve) => {
        finishOpen = () => resolve({ action: 'dispatched', effectiveMode: 'additive', movedWindowCount: 0, closedVaultIds: [] });
      }),
    );
    const user = userEvent.setup();
    const { container } = render(<VaultCenter />);
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.open-action'));

    await user.click(buttons[1]);

    expect(buttons[1]).toBeDisabled();
    for (const [index, button] of buttons.entries()) {
      if (index !== 1) expect(button).not.toBeDisabled();
    }

    finishOpen();
    await waitFor(() => expect(buttons[1]).not.toBeDisabled());
  });
});
