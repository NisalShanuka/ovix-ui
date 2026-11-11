import { lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfigProvider, Layout, Modal, Result, Spin, message } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  CloudDownloadOutlined,
  NodeIndexOutlined,
  TeamOutlined,
} from '@ant-design/icons';

import { HttpUtil, SizeFormatter, ClipboardManager, FileManager } from '@/utils';
import {
  USAGE_CRIT_COLOR,
  USAGE_CRIT_PERCENT,
  USAGE_WARN_COLOR,
  USAGE_WARN_PERCENT,
} from '@/models/status';
import { useTheme } from '@/hooks/useTheme';
import { useStatusQuery } from '@/api/queries/useStatusQuery';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import AppSidebar from '@/layouts/AppSidebar';
import { LazyMount } from '@/components/utility';
import { setMessageInstance } from '@/utils/messageBus';
import OverviewActionBar from './OverviewActionBar';
import ThroughputCard from './ThroughputCard';
import ConnectionsCard from './ConnectionsCard';
import SystemStrip from './SystemStrip';
import { useOverviewHistory } from './useOverviewHistory';
import TopBar from '@/ds/dashboard/TopBar';
import StatCard from '@/ds/dashboard/StatCard';
import LiveNetwork from '@/ds/dashboard/LiveNetwork';
import ServerCard from '@/ds/dashboard/ServerCard';
import ActivityFeed from '@/ds/dashboard/ActivityFeed';
import ClientsPanel from '@/ds/dashboard/ClientsPanel';
import { useDashboard } from '@/ds/dashboard/useDashboard';
import { useSampleSeries } from '@/ds/dashboard/useSampleSeries';
import '@/ds/dashboard/dashboard.css';
import type { PanelUpdateInfo } from './PanelUpdateModal';
const JsonEditor = lazy(() => import('@/components/form/JsonEditor'));
const PanelUpdateModal = lazy(() => import('./PanelUpdateModal'));
const LogModal = lazy(() => import('./LogModal'));
const BackupModal = lazy(() => import('./BackupModal'));
const SystemHistoryModal = lazy(() => import('./SystemHistoryModal'));
const XrayMetricsModal = lazy(() => import('./XrayMetricsModal'));
const XrayLogModal = lazy(() => import('./XrayLogModal'));
const AmneziaWGLogModal = lazy(() => import('./AmneziaWGLogModal'));
const VersionModal = lazy(() => import('./VersionModal'));
import './IndexPage.css';

function splitSpeed(bytesPerSecond: number): [string, string] {
  const [value, unit = ''] = SizeFormatter.speedFormat(bytesPerSecond).split(' ');
  return [value, unit];
}

export default function IndexPage() {
  const { t } = useTranslation();
  const { isDark, isUltra, antdThemeConfig } = useTheme();
  const { status, fetched, fetchError, refresh } = useStatusQuery();
  const { isMobile } = useMediaQuery();
  const [messageApi, messageContextHolder] = message.useMessage();
  useEffect(() => {
    setMessageInstance(messageApi);
  }, [messageApi]);

  const [accessLogEnable, setAccessLogEnable] = useState(false);
  const [devChannelEnable, setDevChannelEnable] = useState(false);
  const [panelUpdateInfo, setPanelUpdateInfo] = useState<PanelUpdateInfo>({
    currentVersion: '',
    latestVersion: '',
    updateAvailable: false,
  });

  const basePath = window.X_UI_BASE_PATH || '';

  const [showIp, setShowIp] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [panelUpdateOpen, setPanelUpdateOpen] = useState(false);
  const [sysHistoryOpen, setSysHistoryOpen] = useState(false);
  const [xrayMetricsOpen, setXrayMetricsOpen] = useState(false);
  const [xrayLogsOpen, setXrayLogsOpen] = useState(false);
  const [amneziawgLogsOpen, setAmneziawgLogsOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [configTextOpen, setConfigTextOpen] = useState(false);
  const [configText, setConfigText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingTip, setLoadingTip] = useState(t('loading'));

  const history = useOverviewHistory(status, fetched && !fetchError);
  const dash = useDashboard();
  const needAttention = dash.summary.expiringCount + dash.summary.depletedCount;
  const hasXrayVersion = !!status.xray.version && status.xray.version !== 'Unknown';
  const onlineSeries = useSampleSeries(dash.onlines.length, fetched ? status : undefined);
  const connSeries = useMemo(
    () => history.series.tcpCount.map((tcp, i) => tcp + (history.series.udpCount[i] ?? 0)),
    [history.series.tcpCount, history.series.udpCount],
  );

  useEffect(() => {
    HttpUtil.post<{ accessLogEnable?: boolean; devChannelEnable?: boolean }>(
      '/panel/api/setting/defaultSettings',
    ).then((msg) => {
      if (msg?.success && msg.obj) {
        setAccessLogEnable(!!msg.obj.accessLogEnable);
        setDevChannelEnable(!!msg.obj.devChannelEnable);
      }
    });
    HttpUtil.get<PanelUpdateInfo>('/panel/api/server/getPanelUpdateInfo').then((msg) => {
      if (msg?.success && msg.obj) setPanelUpdateInfo(msg.obj);
    });
  }, []);

  const displayVersion = useMemo(
    () => window.X_UI_CUR_VER || panelUpdateInfo.currentVersion || '?',
    [panelUpdateInfo.currentVersion],
  );

  const setBusy = useCallback(({ busy, tip }: { busy: boolean; tip?: string }) => {
    setLoading(busy);
    if (tip) setLoadingTip(tip);
  }, []);

  const stopXray = useCallback(async () => {
    await HttpUtil.post('/panel/api/server/stopXrayService');
    await refresh();
  }, [refresh]);

  const restartXray = useCallback(async () => {
    await HttpUtil.post('/panel/api/server/restartXrayService');
    await refresh();
  }, [refresh]);

  async function handleChannelChange(dev: boolean) {
    const res = await HttpUtil.post('/panel/api/server/setUpdateChannel', { dev });
    if (!res?.success) return;
    setDevChannelEnable(dev);
    const msg = await HttpUtil.get<PanelUpdateInfo>('/panel/api/server/getPanelUpdateInfo');
    if (msg?.success && msg.obj) setPanelUpdateInfo(msg.obj);
  }

  async function openConfig() {
    setLoading(true);
    try {
      const msg = await HttpUtil.get('/panel/api/server/getConfigJson');
      if (!msg?.success) return;
      setConfigText(JSON.stringify(msg.obj, null, 2));
      setConfigTextOpen(true);
    } finally {
      setLoading(false);
    }
  }

  async function copyConfig() {
    const ok = await ClipboardManager.copyText(configText || '');
    if (ok) messageApi.success(t('copied'));
  }

  function downloadConfig() {
    FileManager.downloadTextFile(configText, 'config.json');
  }

  const pageClass = `index-page ${isDark ? 'is-dark' : ''} ${isUltra ? 'is-ultra' : ''}`.trim();

  const health = useMemo(() => {
    const items = [
      { name: t('pages.index.cpu'), value: status.cpu.percent },
      { name: t('pages.index.memory'), value: status.mem.percent },
      { name: t('pages.index.swap'), value: status.swap.percent },
      { name: t('pages.index.storage'), value: status.disk.percent },
    ];
    const list = (xs: typeof items) => xs.map((i) => `${i.name} ${i.value.toFixed(0)}%`).join(', ');
    const crit = items.filter((i) => i.value >= USAGE_CRIT_PERCENT);
    if (crit.length)
      return {
        text: t('pages.index.healthCritical', { list: list(crit) }),
        color: USAGE_CRIT_COLOR,
      };
    const warm = items.filter((i) => i.value >= USAGE_WARN_PERCENT);
    if (warm.length)
      return { text: t('pages.index.healthWarm', { list: list(warm) }), color: USAGE_WARN_COLOR };
    return null;
  }, [status, t]);

  return (
    <ConfigProvider theme={antdThemeConfig}>
      {messageContextHolder}
      <Layout className={pageClass}>
        <AppSidebar />

        <Layout className="content-shell">
          <Layout.Content className="content-area">
            <Spin
              spinning={loading || !fetched}
              delay={200}
              description={loading ? loadingTip : t('loading')}
              size="large"
            >
              {!fetched ? (
                <div className="loading-spacer" />
              ) : fetchError ? (
                <Result
                  status="error"
                  title={t('somethingWentWrong')}
                  subTitle={fetchError}
                  extra={
                    <Button type="primary" onClick={refresh}>
                      {t('refresh')}
                    </Button>
                  }
                />
              ) : (
                <div className="ovd-page">
                  <TopBar title={t('menu.dashboard')} healthNote={health?.text ?? null} />

                  <OverviewActionBar
                    status={status}
                    isMobile={isMobile}
                    accessLogEnable={accessLogEnable}
                    panelVersion={displayVersion}
                    latestVersion={panelUpdateInfo.latestVersion}
                    updateAvailable={panelUpdateInfo.updateAvailable}
                    onStopXray={stopXray}
                    onRestartXray={restartXray}
                    onOpenLogs={() => setLogsOpen(true)}
                    onOpenXrayLogs={() => setXrayLogsOpen(true)}
                    onOpenAmneziaWGLogs={() => setAmneziawgLogsOpen(true)}
                    onOpenConfig={openConfig}
                    onOpenBackup={() => setBackupOpen(true)}
                    onOpenSystemHistory={() => setSysHistoryOpen(true)}
                    onOpenXrayMetrics={() => setXrayMetricsOpen(true)}
                    onOpenPanelUpdate={() => setPanelUpdateOpen(true)}
                    onOpenVersionSwitch={() => setVersionOpen(true)}
                  />

                  <section className="ovd-stats">
                    <StatCard
                      icon={<TeamOutlined />}
                      label={t('pages.dashboard.online')}
                      value={dash.onlines.length}
                      unit={`/ ${dash.summary.total}`}
                      note={
                        needAttention > 0
                          ? t('pages.dashboard.onlineNote', { count: needAttention })
                          : t('pages.dashboard.noneNeedAttention')
                      }
                      series={onlineSeries}
                      onClick={() => dash.setFilter('online')}
                    />
                    <StatCard
                      icon={<ArrowDownOutlined />}
                      label={t('pages.index.download')}
                      value={status.netIO.down}
                      format={splitSpeed}
                      note={t('pages.dashboard.liveNote')}
                      series={history.series.netDown}
                    />
                    <StatCard
                      icon={<ArrowUpOutlined />}
                      label={t('pages.index.upload')}
                      value={status.netIO.up}
                      format={splitSpeed}
                      note={t('pages.dashboard.liveNote')}
                      series={history.series.netUp}
                      accent={false}
                    />
                    <StatCard
                      icon={<NodeIndexOutlined />}
                      label={t('pages.dashboard.connections')}
                      value={status.tcpCount + status.udpCount}
                      note={`TCP ${status.tcpCount} · UDP ${status.udpCount}`}
                      series={connSeries}
                      accent={false}
                    />
                  </section>

                  <div className="ovd-grid">
                    <section className="ovd-card ovd-flow">
                      <header className="ovd-head">
                        <h2>{t('pages.dashboard.liveNetwork')}</h2>
                        <span className="ovd-hide-sm">{t('pages.dashboard.liveNetworkSub')}</span>
                        <span className="ovd-chip">
                          <i />
                          {t('pages.dashboard.live')}
                        </span>
                      </header>
                      <LiveNetwork
                        inbounds={dash.netInbounds}
                        clients={dash.netClients}
                        serverLabel={t('pages.dashboard.server')}
                        serverSub={hasXrayVersion ? `Xray ${status.xray.version}` : 'Xray'}
                        idleLabel={t('pages.dashboard.idle')}
                        formatRate={SizeFormatter.speedFormat}
                        themeKey={`${isDark}-${isUltra}`}
                        ariaLabel={t('pages.dashboard.networkAria', {
                          online: dash.onlines.length,
                          inbounds: dash.netInbounds.length,
                        })}
                      />
                      {dash.onlines.length === 0 && (
                        <p className="ovd-net-empty">{t('pages.dashboard.nobodyOnline')}</p>
                      )}
                    </section>
                    <div className="ovd-side">
                      <ServerCard status={status} onOpenHistory={() => setSysHistoryOpen(true)} />
                      <ActivityFeed events={dash.events} />
                    </div>
                  </div>

                  <ClientsPanel
                    filter={dash.filter}
                    onFilter={dash.setFilter}
                    clients={dash.clients}
                    total={dash.summary.total}
                    onlineCount={dash.onlines.length}
                    onlines={dash.onlines}
                    speeds={dash.clientSpeed}
                    inbounds={dash.inbounds}
                    expireDiffMs={dash.expireDiff}
                    trafficDiffBytes={dash.trafficDiff}
                    loaded={dash.fetched}
                  />

                  <h2 className="ovd-section">{t('pages.dashboard.serverDetails')}</h2>
                  <div className="ov-mid">
                    <ThroughputCard
                      status={status}
                      up={history.series.netUp}
                      down={history.series.netDown}
                      labels={history.labels}
                      isMobile={isMobile}
                    />
                    <ConnectionsCard
                      status={status}
                      tcp={history.series.tcpCount}
                      udp={history.series.udpCount}
                      labels={history.labels}
                      isMobile={isMobile}
                    />
                  </div>

                  <SystemStrip
                    status={status}
                    showIp={showIp}
                    onToggleIp={() => setShowIp((v) => !v)}
                  />
                </div>
              )}
            </Spin>
          </Layout.Content>
        </Layout>

        <LazyMount when={panelUpdateOpen}>
          <PanelUpdateModal
            open={panelUpdateOpen}
            info={panelUpdateInfo}
            devChannelEnable={devChannelEnable}
            onChannelChange={handleChannelChange}
            onClose={() => setPanelUpdateOpen(false)}
            onBusy={setBusy}
          />
        </LazyMount>
        <LazyMount when={logsOpen}>
          <LogModal open={logsOpen} onClose={() => setLogsOpen(false)} />
        </LazyMount>
        <LazyMount when={backupOpen}>
          <BackupModal
            open={backupOpen}
            basePath={basePath}
            onClose={() => setBackupOpen(false)}
            onBusy={setBusy}
          />
        </LazyMount>
        <LazyMount when={sysHistoryOpen}>
          <SystemHistoryModal
            open={sysHistoryOpen}
            status={status}
            onClose={() => setSysHistoryOpen(false)}
          />
        </LazyMount>
        <LazyMount when={xrayMetricsOpen}>
          <XrayMetricsModal open={xrayMetricsOpen} onClose={() => setXrayMetricsOpen(false)} />
        </LazyMount>
        <LazyMount when={xrayLogsOpen}>
          <XrayLogModal open={xrayLogsOpen} onClose={() => setXrayLogsOpen(false)} />
        </LazyMount>
        <LazyMount when={amneziawgLogsOpen}>
          <AmneziaWGLogModal open={amneziawgLogsOpen} onClose={() => setAmneziawgLogsOpen(false)} />
        </LazyMount>
        <LazyMount when={versionOpen}>
          <VersionModal
            open={versionOpen}
            status={status}
            onClose={() => setVersionOpen(false)}
            onBusy={setBusy}
          />
        </LazyMount>

        <LazyMount when={configTextOpen}>
          <Modal
            open={configTextOpen}
            title={t('pages.index.config')}
            width={isMobile ? '100%' : 900}
            style={isMobile ? { top: 20, maxWidth: 'calc(100vw - 16px)' } : { top: 20 }}
            onCancel={() => setConfigTextOpen(false)}
            footer={[
              <Button
                key="download"
                onClick={downloadConfig}
                size={isMobile ? 'small' : 'middle'}
                icon={<CloudDownloadOutlined />}
              >
                {isMobile ? 'Download' : 'config.json'}
              </Button>,
              <Button
                key="copy"
                type="primary"
                onClick={copyConfig}
                size={isMobile ? 'small' : 'middle'}
                icon={<CopyOutlined />}
              >
                Copy
              </Button>,
            ]}
          >
            <JsonEditor
              value={configText}
              onChange={setConfigText}
              minHeight={isMobile ? '300px' : 'calc(100vh - 220px)'}
              maxHeight={isMobile ? '70vh' : 'calc(100vh - 220px)'}
              readOnly
            />
          </Modal>
        </LazyMount>
      </Layout>
    </ConfigProvider>
  );
}
