import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { keys } from '@/api/queryKeys';
import { fetchStatus } from '@/api/queries/useStatusQuery';
import './node-card.css';

function Bar({ label, percent }: { label: string; percent: number }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <>
      <span>{label}</span>
      <span className="ov-node-bar" aria-hidden>
        <i style={{ width: `${p}%` }} />
      </span>
      <span className="ov-node-num">{`${p.toFixed(0)}%`}</span>
    </>
  );
}

// Sidebar health card: shares the status cache, polling slowly off the dashboard.
export default function NodeCard() {
  const { t } = useTranslation();
  const { data: status } = useQuery({
    queryKey: keys.server.status(),
    queryFn: fetchStatus,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
  if (!status) return null;
  const running = status.xray.state === 'running';

  return (
    <div className="ov-node">
      <b>
        <span className={`ov-node-pulse${running ? '' : ' is-down'}`} aria-hidden />
        {running ? t('pages.shell.nodeOnline') : t('pages.shell.nodeDown')}
      </b>
      <span className="ov-node-host">{window.location.hostname}</span>
      <div className="ov-node-bars">
        <Bar label="CPU" percent={status.cpu.percent} />
        <Bar label="RAM" percent={status.mem.percent} />
      </div>
    </div>
  );
}
