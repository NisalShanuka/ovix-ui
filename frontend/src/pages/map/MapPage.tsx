import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigProvider, Layout } from 'antd';
import { CloudDownloadOutlined, EnvironmentOutlined, GlobalOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import { fetchGeoMap, ovixKeys } from '@/api/ovix';
import { useTheme } from '@/hooks/useTheme';
import AppSidebar from '@/layouts/AppSidebar';
import PageTop from '@/ds/PageTop';
import ClientMap from '@/ds/map/ClientMap';
import { countByCountry, groupByPlace, placeKey } from '@/ds/map/groupByPlace';
import './map.css';

const POLL_MS = 10_000;

export default function MapPage() {
  const { t } = useTranslation();
  const { isDark, isUltra, antdThemeConfig } = useTheme();
  const [focus, setFocus] = useState<string | null>(null);
  const { data: view, isError } = useQuery({
    queryKey: ovixKeys.geoMap(),
    queryFn: fetchGeoMap,
    refetchInterval: (q) => (q.state.data && !q.state.data.ready ? 3000 : POLL_MS),
  });

  const points = useMemo(() => view?.points ?? [], [view]);
  const places = useMemo(() => groupByPlace(points), [points]);
  const countries = useMemo(() => countByCountry(points), [points]);
  const clients = new Set(points.map((p) => p.email)).size;

  const pageClass = ['map-page', isDark && 'is-dark', isUltra && 'is-ultra']
    .filter(Boolean)
    .join(' ');

  return (
    <ConfigProvider theme={antdThemeConfig}>
      <Layout className={pageClass}>
        <AppSidebar />
        <Layout className="content-shell">
          <Layout.Content id="content-layout" className="content-area">
            <PageTop />
            <div className="ovm-grid">
              <section className="ovm-card ovm-stage">
                <ClientMap
                  view={view}
                  isDark={isDark}
                  focus={focus}
                  serverLabel={t('pages.dashboard.server')}
                />
                <div className="ovm-overlay">
                  <span className="ovm-live">
                    <i />
                    {t('pages.dashboard.live')}
                  </span>
                  <span className="ovm-count">
                    {t('pages.map.summary', { clients, places: places.length })}
                  </span>
                </div>
                {view && !view.ready && (
                  <div className="ovm-notice" role="status">
                    <CloudDownloadOutlined />
                    {view.downloading ? t('pages.map.downloading') : t('pages.map.notReady')}
                  </div>
                )}
                {isError && (
                  <div className="ovm-notice is-bad" role="alert">
                    {t('pages.map.loadFailed')}
                  </div>
                )}
              </section>

              <aside className="ovm-side">
                <section className="ovm-card ovm-list">
                  <h2>{t('pages.map.locations')}</h2>
                  {places.length === 0 ? (
                    <p className="ovm-empty">{t('pages.map.empty')}</p>
                  ) : (
                    <ul>
                      {places.map((g) => {
                        const key = placeKey(g);
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              className={focus === key ? 'is-on' : undefined}
                              onClick={() => setFocus(key)}
                            >
                              <span className="ovm-code">{g.countryCode}</span>
                              <span className="ovm-where">
                                <b>{g.city || g.country}</b>
                                <span>{g.points.map((p) => p.email).join(', ')}</span>
                              </span>
                              <span className="ovm-n">{g.points.length}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section className="ovm-card ovm-list">
                  <h2>{t('pages.map.countries')}</h2>
                  {countries.length === 0 ? (
                    <p className="ovm-empty">—</p>
                  ) : (
                    <ul className="ovm-countries">
                      {countries.map((c) => (
                        <li key={c.code}>
                          <GlobalOutlined aria-hidden />
                          <span>{c.name}</span>
                          <b>{c.clients}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="ovm-card ovm-facts">
                  {view?.server && (
                    <p>
                      <EnvironmentOutlined aria-hidden />
                      {t('pages.map.serverAt', {
                        place: [view.server.city, view.server.country].filter(Boolean).join(', '),
                      })}
                    </p>
                  )}
                  {view && view.unlocated > 0 && (
                    <p>{t('pages.map.unlocated', { count: view.unlocated })}</p>
                  )}
                  <p className="ovm-privacy">{t('pages.map.privacy')}</p>
                  {view && view.updated > 0 && (
                    <p className="ovm-privacy">
                      {t('pages.map.updated', {
                        date: new Date(view.updated * 1000).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        }),
                      })}
                    </p>
                  )}
                </section>
              </aside>
            </div>
          </Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
