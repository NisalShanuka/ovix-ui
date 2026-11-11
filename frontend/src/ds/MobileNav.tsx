import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import {
  ApiOutlined,
  AppstoreOutlined,
  EllipsisOutlined,
  PlusOutlined,
  TeamOutlined,
} from '@ant-design/icons';

import './mobile-nav.css';

const TABS = [
  { to: '/', label: 'menu.dashboard', icon: <AppstoreOutlined /> },
  { to: '/clients', label: 'menu.clients', icon: <TeamOutlined /> },
  { to: '/inbounds', label: 'menu.inbounds', icon: <ApiOutlined /> },
] as const;

function isActive(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}

// Phone-only tab bar (CSS shows it under 768px); More opens the sidebar drawer.
export default function MobileNav({ onMore }: { onMore: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const onTab = TABS.some((tab) => isActive(pathname, tab.to));

  const tab = ({ to, label, icon }: (typeof TABS)[number]) => {
    const active = isActive(pathname, to);
    return (
      <Link
        key={to}
        to={to}
        className={active ? 'is-on' : undefined}
        aria-current={active ? 'page' : undefined}
      >
        <span aria-hidden>{icon}</span>
        <span>{t(label)}</span>
      </Link>
    );
  };

  return (
    <nav className="ov-mnav" aria-label={t('menu.mainNav')}>
      {tab(TABS[0])}
      {tab(TABS[1])}
      <Link to="/clients?new=1" className="ov-mnav-add" aria-label={t('pages.clients.addClient')}>
        <span>
          <PlusOutlined />
        </span>
      </Link>
      {tab(TABS[2])}
      <button
        type="button"
        onClick={onMore}
        className={onTab ? undefined : 'is-on'}
        aria-current={onTab ? undefined : 'page'}
      >
        <EllipsisOutlined aria-hidden />
        <span>{t('menu.more')}</span>
      </button>
    </nav>
  );
}
