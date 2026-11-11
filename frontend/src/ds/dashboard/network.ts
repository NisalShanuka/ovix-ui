export interface NetInbound {
  id: number;
  label: string;
}

export interface NetClient {
  email: string;
  inboundIds: readonly number[];
  rate: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface NetLayout {
  compact: boolean;
  server: Point;
  inbounds: (NetInbound & Point)[];
  clients: (NetClient & Point & { inboundId: number })[];
}

const COMPACT_WIDTH = 560;

function spread(count: number, from: number, to: number): number[] {
  if (count === 1) return [(from + to) / 2];
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}

// Server, then the inbounds in use, then the busiest clients on a shallow arc;
// clients are grouped by inbound so their links do not cross.
export function layoutNetwork(
  width: number,
  height: number,
  inbounds: readonly NetInbound[],
  clients: readonly NetClient[],
  maxClients: number,
): NetLayout {
  const compact = width < COMPACT_WIDTH;
  const known = new Set(inbounds.map((i) => i.id));
  const fallback = inbounds[0]?.id ?? 0;

  const shown = [...clients]
    .sort((a, b) => b.rate - a.rate)
    .slice(0, maxClients)
    .map((c) => ({ ...c, inboundId: c.inboundIds.find((id) => known.has(id)) ?? fallback }));

  const used = new Set(shown.map((c) => c.inboundId));
  const visibleInbounds = (shown.length ? inbounds.filter((i) => used.has(i.id)) : inbounds).slice(
    0,
    4,
  );
  const order = new Map(visibleInbounds.map((ib, idx) => [ib.id, idx]));
  shown.sort(
    (a, b) => (order.get(a.inboundId) ?? 0) - (order.get(b.inboundId) ?? 0) || b.rate - a.rate,
  );

  const midY = height / 2;
  const server = { x: compact ? 36 : Math.max(48, width * 0.09), y: midY };
  // On a phone the server box ends near x=70, so the columns keep a fixed gap.
  const inboundX = compact ? Math.max(width * 0.3, 118) : width * 0.34;
  const inboundYs = spread(visibleInbounds.length, height * 0.22, height * 0.78);
  const clientYs = spread(shown.length, 20, height - 20);
  const arcX = compact ? Math.max(width * 0.58, 178) : width * 0.6;
  const arcDepth = compact ? 0 : width * 0.08;

  return {
    compact,
    server,
    inbounds: visibleInbounds.map((ib, i) => ({ ...ib, x: inboundX, y: inboundYs[i] })),
    clients: shown.map((c, i) => {
      const t = shown.length === 1 ? 0 : (i / (shown.length - 1)) * 2 - 1;
      return { ...c, x: arcX + Math.cos((t * Math.PI) / 2.4) * arcDepth, y: clientYs[i] };
    }),
  };
}
