import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ArrowRightOutlined, ExportOutlined } from '@ant-design/icons';

import { SizeFormatter } from '@/utils';
import type { ClientRecord, InboundOption } from '@/schemas/client';
import type { ClientSpeedEntry } from '@/hooks/useClients';
import { clientState } from './clientState';
import { useNow } from './useNow';
import type { ClientStateKind } from './clientState';

export const CLIENT_FILTERS = ['', 'online', 'expiring', 'depleted', 'deactive'] as const;
export type ClientFilter = (typeof CLIENT_FILTERS)[number];

const FILTER_LABEL: Record<ClientFilter, string> = {
  '': 'pages.dashboard.filters.all',
  online: 'pages.dashboard.filters.online',
  expiring: 'pages.dashboard.filters.expiring',
  depleted: 'pages.dashboard.filters.ended',
  deactive: 'pages.dashboard.filters.disabled',
};

const PILL: Record<ClientStateKind, string> = {
  online: 'is-ok',
  expiring: 'is-exp',
  ended: 'is-bad',
  disabled: 'is-mu',
  active: 'is-mu',
};

interface ClientsPanelProps {
  filter: ClientFilter;
  onFilter: (f: ClientFilter) => void;
  clients: readonly ClientRecord[];
  total: number;
  onlineCount: number;
  onlines: readonly string[];
  speeds: Record<string, ClientSpeedEntry>;
  inbounds: readonly InboundOption[];
  expireDiffMs: number;
  trafficDiffBytes: number;
  loaded: boolean;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function ClientsPanel({
  filter,
  onFilter,
  clients,
  total,
  onlineCount,
  onlines,
  speeds,
  inbounds,
  expireDiffMs,
  trafficDiffBytes,
  loaded,
}: ClientsPanelProps) {
  const { t } = useTranslation();
  const online = new Set(onlines);
  const inboundLabel = new Map(
    inbounds.map((ib) => [ib.id, `${(ib.protocol || '').toUpperCase()} ${ib.port ?? ''}`.trim()]),
  );
  const now = useNow(60_000);

  return (
    <section className="ovd-card ovd-clients">
      <header className="ovd-head">
        <h2>{t('pages.dashboard.clients')}</h2>
        <span>{t('pages.dashboard.clientsSub', { total, online: onlineCount })}</span>
        <Link className="ovd-link" to="/clients">
          {t('pages.dashboard.viewAll')} <ArrowRightOutlined />
        </Link>
      </header>
      <div className="ovd-chips" role="tablist" aria-label={t('pages.dashboard.clients')}>
        {CLIENT_FILTERS.map((f) => (
          <button
            key={f || 'all'}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className={filter === f ? 'is-on' : undefined}
            onClick={() => onFilter(f)}
          >
            {t(FILTER_LABEL[f])}
          </button>
        ))}
      </div>
      <div className="ovd-table-wrap">
        <table className="ovd-table">
          <thead>
            <tr>
              <th>{t('pages.dashboard.col.client')}</th>
              <th>{t('pages.dashboard.col.status')}</th>
              <th>{t('pages.dashboard.col.live')}</th>
              <th>{t('pages.dashboard.col.usage')}</th>
              <th className="ovd-hide-sm">{t('pages.dashboard.col.expires')}</th>
              <th className="ovd-hide-sm">
                <span className="ovd-sr">{t('pages.dashboard.col.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const state = clientState(c, online.has(c.email), {
                now,
                expireDiffMs,
                trafficDiffBytes,
              });
              const speed = speeds[c.email];
              const rate = speed ? speed.up + speed.down : 0;
              const used = (c.traffic?.up ?? 0) + (c.traffic?.down ?? 0);
              const totalBytes = c.totalGB ?? 0;
              const pct = totalBytes > 0 ? Math.min(100, (used / totalBytes) * 100) : 0;
              const expiry = c.expiryTime ?? 0;
              const where = (c.inboundIds ?? [])
                .map((id) => inboundLabel.get(id))
                .filter(Boolean)
                .join(', ');
              const live =
                state.kind === 'online' || state.kind === 'active' || state.kind === 'expiring';
              return (
                <tr key={c.email}>
                  <td className="ovd-who">
                    <span className={`ovd-avatar${live ? '' : ' is-muted'}`} aria-hidden>
                      {c.email.slice(0, 1).toUpperCase()}
                    </span>
                    <b>{c.email}</b>
                    <span>{where || c.comment || '—'}</span>
                  </td>
                  <td>
                    <span className={`ovd-pill ${PILL[state.kind]}`}>
                      <i />
                      {state.daysLeft
                        ? t('pages.dashboard.daysLeft', { days: state.daysLeft })
                        : t(`pages.dashboard.state.${state.kind}`)}
                    </span>
                  </td>
                  <td>
                    <span className="ovd-mono ovd-live">
                      {rate > 0 ? SizeFormatter.speedFormat(rate) : '—'}
                    </span>
                  </td>
                  <td className="ovd-use">
                    <span className="ovd-meter" aria-hidden>
                      <i style={{ width: `${totalBytes > 0 ? pct : 0}%` }} />
                    </span>
                    <span className="ovd-num">
                      {totalBytes > 0
                        ? `${SizeFormatter.sizeFormat(used)} / ${SizeFormatter.sizeFormat(totalBytes)}`
                        : `${SizeFormatter.sizeFormat(used)} · ${t('pages.dashboard.unlimited')}`}
                    </span>
                  </td>
                  <td className="ovd-hide-sm ovd-num">
                    {expiry > 0
                      ? formatDate(expiry)
                      : expiry < 0
                        ? t('pages.dashboard.firstUse')
                        : t('pages.dashboard.never')}
                  </td>
                  <td className="ovd-hide-sm">
                    <Link
                      className="ovd-icon-btn"
                      to={`/clients?search=${encodeURIComponent(c.email)}`}
                      aria-label={t('pages.dashboard.openClient', { name: c.email })}
                    >
                      <ExportOutlined />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loaded && clients.length === 0 && (
          <p className="ovd-empty">{t('pages.dashboard.noClients')}</p>
        )}
      </div>
    </section>
  );
}
