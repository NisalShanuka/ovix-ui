import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Input, Modal, Switch, Tag } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';

import { HttpUtil, PromiseUtil } from '@/utils';
import { formatPanelVersion } from '@/lib/panel-version';
import type { PanelUpdateStatus } from '@/generated/types';
import './PanelUpdateModal.css';

type UpdateOutcome = 'success' | 'failed' | 'timeout';

export interface PanelUpdateInfo {
  channel?: string;
  currentVersion: string;
  latestVersion: string;
  currentCommit?: string;
  latestCommit?: string;
  updateAvailable: boolean;
  tokenSet?: boolean;
  needsToken?: boolean;
}

interface BusyEvent {
  busy: boolean;
  tip?: string;
}

interface PanelUpdateModalProps {
  open: boolean;
  info: PanelUpdateInfo;
  devChannelEnable?: boolean;
  onChannelChange?: (dev: boolean) => void | Promise<void>;
  onTokenChange?: (token: string) => Promise<boolean>;
  onClose: () => void;
  onBusy: (e: BusyEvent) => void;
}

export default function PanelUpdateModal({
  open,
  info,
  devChannelEnable,
  onChannelChange,
  onTokenChange,
  onClose,
  onBusy,
}: PanelUpdateModalProps) {
  const { t } = useTranslation();
  const [modal, contextHolder] = Modal.useModal();
  const [channelBusy, setChannelBusy] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [savedToken, setSavedToken] = useState<boolean | null>(null);

  const isDev = info.channel === 'dev';
  const hasToken = savedToken ?? !!info.tokenSet;
  const showTokenForm = editingToken || (!hasToken && !!info.needsToken);

  async function changeToken(token: string) {
    if (!onTokenChange) return;
    setTokenBusy(true);
    try {
      if (await onTokenChange(token)) {
        setSavedToken(token !== '');
        setEditingToken(false);
        setTokenDraft('');
      }
    } finally {
      setTokenBusy(false);
    }
  }

  async function pollUpdateStatus(expectedRunId: string): Promise<UpdateOutcome> {
    await PromiseUtil.sleep(5000);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        const msg = await HttpUtil.get<PanelUpdateStatus>(
          '/panel/api/server/getUpdateStatus',
          undefined,
          { silent: true, timeout: 2000 },
        );
        const status = msg?.obj ?? undefined;
        if (status?.runId === expectedRunId) {
          if (status.state === 'success') return 'success';
          if (status.state === 'failed') return 'failed';
        }
      } catch {
        /* still restarting */
      }
      await PromiseUtil.sleep(2000);
    }
    return 'timeout';
  }

  async function handleChannel(checked: boolean) {
    if (!onChannelChange) return;
    setChannelBusy(true);
    try {
      await onChannelChange(checked);
    } finally {
      setChannelBusy(false);
    }
  }

  async function runPanelUpdate() {
    const baseTip = t('pages.index.dontRefresh');
    const tip = info.latestVersion ? `${baseTip} (${info.latestVersion})` : baseTip;
    onClose();
    onBusy({ busy: true, tip });
    const result = await HttpUtil.post<{ runId: string }>('/panel/api/server/updatePanel');
    if (!result?.success) {
      onBusy({ busy: false });
      return;
    }
    const outcome = await pollUpdateStatus(result.obj?.runId ?? '');
    onBusy({ busy: false });
    if (outcome === 'success') {
      await PromiseUtil.sleep(800);
      window.location.reload();
      return;
    }
    modal[outcome === 'failed' ? 'error' : 'warning']({
      title: t(
        outcome === 'failed'
          ? 'pages.index.panelUpdateFailedTitle'
          : 'pages.index.panelUpdateUnknownTitle',
      ),
      content: t(
        outcome === 'failed'
          ? 'pages.index.panelUpdateFailedDesc'
          : 'pages.index.panelUpdateUnknownDesc',
      ),
      okText: t('refresh'),
      onOk: () => window.location.reload(),
    });
  }

  function updatePanel() {
    modal.confirm({
      title: t('pages.index.panelUpdateDialog'),
      content: t('pages.index.panelUpdateDialogDesc').replace(
        '#version#',
        info.latestVersion || '',
      ),
      okText: t('confirm'),
      cancelText: t('cancel'),
      onOk: () => {
        void runPanelUpdate();
      },
    });
  }

  return (
    <>
      {contextHolder}
      <Modal open={open} title={t('pages.index.updatePanel')} footer={null} onCancel={onClose}>
        {info.updateAvailable && (
          <Alert
            type="warning"
            className="mb-12"
            title={t('pages.index.panelUpdateDesc')}
            showIcon
          />
        )}

        <div className="version-list">
          <div className="version-list-item">
            <span>{t('pages.index.devChannel')}</span>
            <Switch checked={!!devChannelEnable} loading={channelBusy} onChange={handleChannel} />
          </div>
        </div>

        {devChannelEnable && (
          <Alert
            type="info"
            className="mb-12"
            title={t('pages.index.devChannelWarning')}
            showIcon
          />
        )}

        <div className="version-list">
          <div className="version-list-item">
            <span>
              {isDev ? t('pages.index.currentCommit') : t('pages.index.currentPanelVersion')}
            </span>
            {isDev ? (
              <Tag color="green">{info.currentCommit || '?'}</Tag>
            ) : (
              <Tag color="green">
                {formatPanelVersion(window.X_UI_CUR_VER || info.currentVersion) || '?'}
              </Tag>
            )}
          </div>
          {info.updateAvailable ? (
            <div className="version-list-item">
              <span>
                {isDev ? t('pages.index.latestCommit') : t('pages.index.latestPanelVersion')}
              </span>
              <Tag color="purple">{(isDev ? info.latestCommit : info.latestVersion) || '-'}</Tag>
            </div>
          ) : (
            <div className="version-list-item">
              <span>{t('pages.index.panelUpToDate')}</span>
              <Tag color="green">{t('pages.index.panelUpToDate')}</Tag>
            </div>
          )}
        </div>

        {info.needsToken && !hasToken && (
          <Alert
            type="warning"
            className="mt-12"
            title={t('pages.index.updateTokenNeeded')}
            showIcon
          />
        )}

        {onTokenChange && (hasToken || showTokenForm) && (
          <div className="version-list update-token">
            <div className="version-list-item">
              <span>{t('pages.index.updateToken')}</span>
              {hasToken && !showTokenForm ? (
                <span className="update-token-actions">
                  <Tag color="green">{t('pages.index.updateTokenSet')}</Tag>
                  <Button size="small" onClick={() => setEditingToken(true)}>
                    {t('pages.index.updateTokenReplace')}
                  </Button>
                  <Button
                    size="small"
                    danger
                    loading={tokenBusy}
                    onClick={() => void changeToken('')}
                  >
                    {t('remove')}
                  </Button>
                </span>
              ) : null}
            </div>
            {showTokenForm && (
              <form
                className="update-token-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (tokenDraft.trim()) void changeToken(tokenDraft.trim());
                }}
              >
                <Input.Password
                  aria-label={t('pages.index.updateToken')}
                  placeholder="github_pat_…"
                  autoComplete="off"
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                />
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={tokenBusy}
                  disabled={!tokenDraft.trim()}
                >
                  {t('save')}
                </Button>
              </form>
            )}
          </div>
        )}

        <div className="actions-row">
          <Button
            type="primary"
            disabled={!info.updateAvailable}
            onClick={updatePanel}
            icon={<CloudDownloadOutlined />}
          >
            {t('pages.index.updatePanel')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
