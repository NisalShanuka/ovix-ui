import { useTranslation } from 'react-i18next';

import { TimeFormatter } from '@/utils';
import type { Status } from '@/models/status';

interface ServerCardProps {
  status: Status;
  onOpenHistory: () => void;
}

const CIRC = 2 * Math.PI * 40;

function Meter({ label, percent }: { label: string; percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <>
      <span>{label}</span>
      <span className="ovd-meter" aria-hidden>
        <i style={{ width: `${clamped}%` }} />
      </span>
      <span className="ovd-num">{clamped.toFixed(0)}%</span>
    </>
  );
}

export default function ServerCard({ status, onOpenHistory }: ServerCardProps) {
  const { t } = useTranslation();
  const cpu = Math.max(0, Math.min(100, status.cpu.percent));
  const running = status.xray.state === 'running';

  return (
    <button type="button" className="ovd-card ovd-server" onClick={onOpenHistory}>
      <svg width="92" height="92" viewBox="0 0 100 100" aria-hidden className="ovd-gauge">
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--ov-track)" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="var(--ov-pr)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${((cpu / 100) * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className="ovd-server-body">
        <span className="ovd-server-value ovd-num">{`${cpu.toFixed(0)}%`}</span>
        <span className="ovd-server-sub">{t('pages.dashboard.cpuLoad')}</span>
        <span className={`ovd-pill ${running ? 'is-ok' : 'is-bad'}`}>
          <i />
          {running ? t('pages.dashboard.xrayRunning') : t('pages.dashboard.xrayDown')}
        </span>
      </span>
      <span className="ovd-meters">
        <Meter label={t('pages.index.memory')} percent={status.mem.percent} />
        <Meter label={t('pages.index.swap')} percent={status.swap.percent} />
        <Meter label={t('pages.index.storage')} percent={status.disk.percent} />
      </span>
      <span className="ovd-server-foot">
        {t('pages.dashboard.uptime', { time: TimeFormatter.formatSecond(status.uptime) })}
      </span>
    </button>
  );
}
