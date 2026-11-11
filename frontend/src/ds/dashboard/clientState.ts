export type ClientStateKind = 'online' | 'expiring' | 'ended' | 'disabled' | 'active';

export interface ClientState {
  kind: ClientStateKind;
  daysLeft?: number;
}

export interface ClientStateInput {
  enable?: boolean;
  totalGB?: number;
  expiryTime?: number;
  traffic?: { up?: number; down?: number } | null;
}

export interface ClientStateRules {
  now: number;
  expireDiffMs: number;
  trafficDiffBytes: number;
}

const DAY_MS = 86_400_000;

// Mirrors the server's buckets (client_paging.go) so a row's pill matches the
// filter chip that lists it; only "online" is layered on top.
export function clientState(
  c: ClientStateInput,
  online: boolean,
  { now, expireDiffMs, trafficDiffBytes }: ClientStateRules,
): ClientState {
  const used = (c.traffic?.up ?? 0) + (c.traffic?.down ?? 0);
  const total = c.totalGB ?? 0;
  const expiry = c.expiryTime ?? 0;

  const dataGone = total > 0 && used >= total;
  const timeGone = expiry > 0 && expiry <= now;
  if (dataGone || timeGone) return { kind: 'ended' };
  if (c.enable === false) return { kind: 'disabled' };
  if (online) return { kind: 'online' };

  if (expiry > 0 && expiry - now < expireDiffMs) {
    return { kind: 'expiring', daysLeft: Math.max(1, Math.round((expiry - now) / DAY_MS)) };
  }
  if (total > 0 && total - used < trafficDiffBytes) return { kind: 'expiring' };
  return { kind: 'active' };
}
