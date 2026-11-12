import { fireEvent, screen } from '@testing-library/react';
import { Modal } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PanelUpdateModal from '@/pages/index/PanelUpdateModal';
import { HttpUtil } from '@/utils';
import { renderWithProviders } from './test-utils';

let restoreUseModal = () => {};

describe('panel update modal', () => {
  afterEach(() => {
    restoreUseModal();
    restoreUseModal = () => {};
    vi.mocked(HttpUtil.post).mockReset();
  });

  it('lets the confirmation close before the update request finishes', () => {
    const confirm = vi.fn();
    const useModal = vi.spyOn(Modal, 'useModal').mockReturnValue([
      {
        confirm,
        error: vi.fn(),
        warning: vi.fn(),
      } as unknown as ReturnType<typeof Modal.useModal>[0],
      <span key="modal-context" />,
    ]);
    restoreUseModal = () => useModal.mockRestore();
    vi.mocked(HttpUtil.post).mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    const onBusy = vi.fn();
    renderWithProviders(
      <PanelUpdateModal
        open
        info={{
          channel: 'dev',
          currentVersion: 'dev+old',
          latestVersion: 'dev+new',
          currentCommit: 'old',
          latestCommit: 'new',
          updateAvailable: true,
        }}
        devChannelEnable
        onClose={onClose}
        onBusy={onBusy}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Update Panel/ }));
    expect(confirm).toHaveBeenCalledOnce();
    const config = confirm.mock.calls[0]?.[0];
    if (!config?.onOk) throw new Error('Confirmation onOk handler was not registered');

    expect(config.onOk()).toBeUndefined();
    expect(onClose).toHaveBeenCalledOnce();
    expect(HttpUtil.post).toHaveBeenCalledWith('/panel/api/server/updatePanel');
    expect(onBusy).toHaveBeenCalledWith({
      busy: true,
      tip: 'Installation is in progress, please do not refresh this page (dev+new)',
    });
  });
});

describe('panel update access token', () => {
  const base = { currentVersion: '3.11.0', latestVersion: '3.11.0', updateAvailable: false };

  it('asks for a token when the private release repo is hidden, and saves it', async () => {
    const onTokenChange = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <PanelUpdateModal
        open
        info={{ ...base, needsToken: true, tokenSet: false }}
        onTokenChange={onTokenChange}
        onClose={vi.fn()}
        onBusy={vi.fn()}
      />,
    );

    screen.getByText(/private GitHub repository/);
    const save = screen.getByRole('button', { name: /Save/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('GitHub access token'), {
      target: { value: 'github_pat_abc' },
    });
    fireEvent.click(save);
    expect(onTokenChange).toHaveBeenCalledWith('github_pat_abc');
    await screen.findByText('Saved');
    expect(screen.queryByLabelText('GitHub access token')).toBeNull();
  });

  it('keeps the typed token when the server refuses it', async () => {
    const onTokenChange = vi.fn().mockResolvedValue(false);
    renderWithProviders(
      <PanelUpdateModal
        open
        info={{ ...base, needsToken: true, tokenSet: false }}
        onTokenChange={onTokenChange}
        onClose={vi.fn()}
        onBusy={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('GitHub access token');
    fireEvent.change(input, { target: { value: 'github_pat_bad' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await vi.waitFor(() => expect(onTokenChange).toHaveBeenCalledOnce());
    expect((screen.getByLabelText('GitHub access token') as HTMLInputElement).value).toBe('github_pat_bad');
  });

  it('removes a saved token', () => {
    const onTokenChange = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <PanelUpdateModal
        open
        info={{ ...base, tokenSet: true }}
        onTokenChange={onTokenChange}
        onClose={vi.fn()}
        onBusy={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('GitHub access token')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(onTokenChange).toHaveBeenCalledWith('');
  });
});
