import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';

import { keys } from '@/api/queryKeys';
import { fetchClientPage, useClients } from '@/hooks/useClients';
import type { ClientQueryParams } from '@/hooks/useClients';
import { useWebSocket } from '@/hooks/useWebSocket';
import { nextEventId, onlineChanges, prependEvents } from './activity';
import type { ActivityEvent } from './activity';
import type { ClientFilter } from './ClientsPanel';
import type { NetClient, NetInbound } from './network';

const TABLE_ROWS = 8;
const FEED_LENGTH = 6;
const ONLINE_QUERY: ClientQueryParams = { page: 1, pageSize: 24, filter: 'online' };

const SORT_FOR: Record<ClientFilter, Pick<ClientQueryParams, 'sort' | 'order'>> = {
  '': { sort: 'lastOnline', order: 'descend' },
  online: { sort: 'lastOnline', order: 'descend' },
  expiring: { sort: 'expiryTime', order: 'ascend' },
  depleted: { sort: 'updatedAt', order: 'descend' },
  deactive: { sort: 'updatedAt', order: 'descend' },
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function useDashboard() {
  const clientsApi = useClients();
  const {
    setQuery,
    onlines,
    clientSpeed,
    summary,
    inbounds,
    applyTrafficEvent,
    applyClientStatsEvent,
  } = clientsApi;
  const [filter, setFilter] = useState<ClientFilter>('');
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    setQuery({ page: 1, pageSize: TABLE_ROWS, filter: filter || undefined, ...SORT_FOR[filter] });
  }, [filter, setQuery]);

  const onlineRows = useQuery({
    queryKey: keys.clients.list(ONLINE_QUERY),
    queryFn: () => fetchClientPage(ONLINE_QUERY),
    refetchInterval: 5000,
  });

  // Read-only view of the onlines cache: undefined until the first answer,
  // which is what keeps the first list from counting as "came online".
  const { data: onlineSnapshot } = useQuery({
    queryKey: keys.clients.onlines(),
    queryFn: skipToken,
  });
  const lastOnlines = useRef<readonly string[] | null>(null);
  useEffect(() => {
    if (!onlineSnapshot) return;
    const changes = onlineChanges(lastOnlines.current, onlineSnapshot as string[], Date.now());
    lastOnlines.current = onlineSnapshot as string[];
    if (changes.length) setEvents((list) => prependEvents(list, changes, FEED_LENGTH));
  }, [onlineSnapshot]);

  // Clients that need action are standing items, kept under the live events.
  const attention = useMemo<ActivityEvent[]>(
    () =>
      [
        ...summary.depleted.slice(0, 2).map((email) => ({ kind: 'depleted' as const, email })),
        ...summary.expiring.slice(0, 3).map((email) => ({ kind: 'expiring' as const, email })),
      ].map(({ kind, email }) => ({ id: `${kind}-${email}`, kind, subject: email, at: 0 })),
    [summary.depleted, summary.expiring],
  );
  const feed = useMemo(() => [...events, ...attention].slice(0, FEED_LENGTH), [events, attention]);

  const onNotice = useCallback((payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const title = str(p.title);
    if (!title) return;
    const notice: ActivityEvent = {
      id: nextEventId(),
      kind: 'notice',
      subject: title,
      detail: str(p.message),
      at: Date.now(),
    };
    setEvents((list) => prependEvents(list, [notice], FEED_LENGTH));
  }, []);

  const onXrayState = useCallback((payload: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (str(p.state) !== 'error') return;
    const failure: ActivityEvent = {
      id: nextEventId(),
      kind: 'xray',
      subject: 'Xray',
      detail: str(p.errorMsg),
      at: Date.now(),
    };
    setEvents((list) => prependEvents(list, [failure], FEED_LENGTH));
  }, []);

  useWebSocket({
    traffic: applyTrafficEvent,
    client_stats: applyClientStatsEvent,
    notification: onNotice,
    xray_state: onXrayState,
  });

  const netInbounds = useMemo<NetInbound[]>(
    () =>
      inbounds.map((ib) => ({
        id: ib.id,
        label: `${(ib.protocol || 'inbound').toUpperCase()} ${ib.port ?? ''}`.trim(),
      })),
    [inbounds],
  );

  const netClients = useMemo<NetClient[]>(() => {
    const inboundOf = new Map(
      (onlineRows.data?.items ?? []).map((c) => [c.email, c.inboundIds ?? []] as const),
    );
    return onlines.map((email) => {
      const speed = clientSpeed[email];
      return {
        email,
        inboundIds: inboundOf.get(email) ?? [],
        rate: speed ? speed.up + speed.down : 0,
      };
    });
  }, [onlines, clientSpeed, onlineRows.data]);

  return { ...clientsApi, filter, setFilter, events: feed, netInbounds, netClients };
}
