import { useTranslation } from 'react-i18next';
import {
  ClockCircleOutlined,
  ExclamationOutlined,
  PoweroffOutlined,
  ThunderboltOutlined,
  WifiOutlined,
} from '@ant-design/icons';

import type { ActivityEvent, ActivityKind } from './activity';

const TONE: Record<ActivityKind, string> = {
  online: 'is-ok',
  offline: 'is-mu',
  xray: 'is-pr',
  notice: 'is-pr',
  expiring: 'is-exp',
  depleted: 'is-bad',
};

const ICON: Record<ActivityKind, React.ReactNode> = {
  online: <WifiOutlined />,
  offline: <PoweroffOutlined />,
  xray: <ThunderboltOutlined />,
  notice: <ThunderboltOutlined />,
  expiring: <ClockCircleOutlined />,
  depleted: <ExclamationOutlined />,
};

function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ActivityFeed({ events }: { events: readonly ActivityEvent[] }) {
  const { t } = useTranslation();

  return (
    <section className="ovd-card ovd-feed" aria-live="polite">
      <header className="ovd-head">
        <h2>{t('pages.dashboard.activity')}</h2>
      </header>
      {events.length === 0 ? (
        <p className="ovd-empty">{t('pages.dashboard.activityEmpty')}</p>
      ) : (
        <ul>
          {events.map((e) => (
            <li key={e.id} className="ovd-ev">
              <span className={`ovd-ev-icon ${TONE[e.kind]}`} aria-hidden>
                {ICON[e.kind]}
              </span>
              <p>
                <b>{e.subject}</b> {e.detail || t(`pages.dashboard.events.${e.kind}`)}
                <time className="ovd-mono">
                  {e.at > 0 ? clock(e.at) : t('pages.dashboard.needsAction')}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
