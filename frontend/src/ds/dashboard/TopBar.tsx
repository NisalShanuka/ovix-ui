import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MoonOutlined, PlusOutlined, SearchOutlined, SunOutlined } from '@ant-design/icons';

import { fetchSession, ovixKeys } from '@/api/ovix';
import { useTheme } from '@/hooks/useTheme';
import { useCommandPalette } from '@/components/command-palette/useCommandPalette';
import { greetingKey } from './greeting';
import './top-bar.css';

interface TopBarProps {
  title: string;
  healthNote?: string | null;
  sub?: string;
}

const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export default function TopBar({ title, healthNote = null, sub }: TopBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const { open: openPalette } = useCommandPalette();
  const { data: session } = useQuery({
    queryKey: ovixKeys.session(),
    queryFn: fetchSession,
    staleTime: Infinity,
  });

  const [part] = useState(() => greetingKey(new Date().getHours()));
  const greeting = t(`pages.dashboard.greeting.${part}`);
  const who = session?.username ? `${greeting}, ${session.username}` : greeting;

  return (
    <div className="ovd-top">
      <h1>
        {title}
        <small>{sub ?? `${who} · ${healthNote ?? t('pages.dashboard.allGood')}`}</small>
      </h1>
      <button type="button" className="ovd-search" onClick={openPalette}>
        <SearchOutlined />
        <span>{t('pages.dashboard.search')}</span>
        <kbd>{`${MOD_KEY} K`}</kbd>
      </button>
      <button
        type="button"
        className="ovd-icon-btn is-lg"
        onClick={toggleTheme}
        aria-label={isDark ? t('pages.dashboard.lightTheme') : t('pages.dashboard.darkTheme')}
      >
        {isDark ? <SunOutlined /> : <MoonOutlined />}
      </button>
      <button type="button" className="ovd-primary" onClick={() => navigate('/clients?new=1')}>
        <PlusOutlined />
        <span className="ovd-primary-label">{t('pages.clients.addClient')}</span>
      </button>
    </div>
  );
}
