import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { TITLE_KEYS } from '@/hooks/usePageTitle';
import TopBar from './dashboard/TopBar';

const SUB_KEYS: Record<string, string> = {
  '/inbounds': 'pages.shell.sub.inbounds',
  '/clients': 'pages.shell.sub.clients',
  '/groups': 'pages.shell.sub.groups',
  '/nodes': 'pages.shell.sub.nodes',
  '/hosts': 'pages.shell.sub.hosts',
  '/settings': 'pages.shell.sub.settings',
  '/xray': 'pages.shell.sub.xray',
  '/outbound': 'pages.shell.sub.xray',
  '/routing': 'pages.shell.sub.xray',
  '/api-docs': 'pages.shell.sub.apiDocs',
  '/resellers': 'pages.shell.sub.resellers',
  '/map': 'pages.shell.sub.map',
};

// The Ovix top bar for every panel page; the dashboard passes its own greeting.
export default function PageTop() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const title = TITLE_KEYS[pathname] ? t(TITLE_KEYS[pathname]) : 'Ovix UI';
  const sub = SUB_KEYS[pathname] ? t(SUB_KEYS[pathname]) : '';
  return <TopBar title={title} sub={sub} />;
}
