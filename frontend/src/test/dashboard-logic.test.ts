import { describe, expect, test } from 'vitest';

import { onlineChanges, prependEvents } from '@/ds/dashboard/activity';
import { layoutNetwork } from '@/ds/dashboard/network';
import { sparkPoints } from '@/ds/dashboard/sparkPoints';
import { greetingKey } from '@/ds/dashboard/greeting';
import { clientState } from '@/ds/dashboard/clientState';

describe('onlineChanges', () => {
  test('the first snapshot is a baseline, not a burst of "came online" events', () => {
    expect(onlineChanges(null, ['a', 'b'], 1000)).toEqual([]);
  });

  test('reports who came online and who went offline between snapshots', () => {
    const events = onlineChanges(['a', 'b'], ['b', 'c'], 5000);
    expect(events.map((e) => [e.kind, e.subject, e.at])).toEqual([
      ['online', 'c', 5000],
      ['offline', 'a', 5000],
    ]);
  });

  test('ids stay unique when the same client reconnects later', () => {
    const first = onlineChanges([], ['a'], 1000);
    const again = onlineChanges([], ['a'], 2000);
    expect(first[0].id).not.toBe(again[0].id);
  });
});

describe('prependEvents', () => {
  test('puts the newest first and drops the oldest past the cap', () => {
    const list = onlineChanges([], ['a', 'b'], 1);
    const next = prependEvents(list, onlineChanges([], ['c'], 2), 2);
    expect(next.map((e) => e.subject)).toEqual(['c', 'a']);
  });
});

describe('layoutNetwork', () => {
  const inbounds = [
    { id: 1, label: 'VLESS 443' },
    { id: 2, label: 'Trojan 8443' },
  ];

  test('links each client to the inbound it is on', () => {
    const net = layoutNetwork(800, 300, inbounds, [{ email: 'k', inboundIds: [2], rate: 10 }], 8);
    expect(net.clients[0].inboundId).toBe(2);
    expect(net.inbounds.map((i) => i.id)).toEqual([2]);
  });

  test('a client on an inbound the panel does not list falls back to the first one', () => {
    const net = layoutNetwork(800, 300, inbounds, [{ email: 'k', inboundIds: [99], rate: 0 }], 8);
    expect(net.clients[0].inboundId).toBe(1);
  });

  test('keeps the fastest clients when there are more than fit', () => {
    const clients = [
      { email: 'slow', inboundIds: [1], rate: 1 },
      { email: 'fast', inboundIds: [1], rate: 90 },
      { email: 'mid', inboundIds: [1], rate: 40 },
    ];
    const net = layoutNetwork(800, 300, inbounds, clients, 2);
    expect(net.clients.map((c) => c.email)).toEqual(['fast', 'mid']);
  });

  test('every node stays inside the canvas, also on a phone', () => {
    const clients = Array.from({ length: 10 }, (_, i) => ({
      email: `c${i}`,
      inboundIds: [1 + (i % 2)],
      rate: i,
    }));
    for (const [w, h] of [
      [900, 300],
      [340, 230],
    ]) {
      const net = layoutNetwork(w, h, inbounds, clients, 10);
      for (const p of [net.server, ...net.inbounds, ...net.clients]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(w);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(h);
      }
    }
  });

  test('on a phone the server box, inbound pill and client dots do not overlap', () => {
    const net = layoutNetwork(340, 230, inbounds, [{ email: 'k', inboundIds: [1], rate: 1 }], 8);
    const serverRight = net.server.x + 34;
    const pillLeft = net.inbounds[0].x - 32;
    const pillRight = net.inbounds[0].x + 32;
    expect(pillLeft).toBeGreaterThan(serverRight);
    expect(net.clients[0].x - 12).toBeGreaterThan(pillRight);
  });

  test('with no clients online it still shows the inbounds', () => {
    const net = layoutNetwork(800, 300, inbounds, [], 8);
    expect(net.inbounds.map((i) => i.id)).toEqual([1, 2]);
  });
});

describe('sparkPoints', () => {
  test('scales the peak to the top edge and zero to the bottom', () => {
    expect(sparkPoints([0, 5, 10], 100, 40)).toBe('0.0,40.0 50.0,20.0 100.0,0.0');
  });

  test('a flat zero line sits on the bottom instead of dividing by zero', () => {
    expect(sparkPoints([0, 0], 100, 40)).toBe('0.0,40.0 100.0,40.0');
  });

  test('a single sample draws a flat line across', () => {
    expect(sparkPoints([3], 100, 40)).toBe('0.0,0.0 100.0,0.0');
  });
});

describe('greetingKey', () => {
  test.each([
    [4, 'night'],
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [16, 'afternoon'],
    [17, 'evening'],
    [21, 'evening'],
    [22, 'night'],
  ])('hour %i greets with %s', (hour, key) => {
    expect(greetingKey(hour)).toBe(key);
  });
});

describe('clientState', () => {
  const now = Date.UTC(2026, 10, 12);
  const day = 86_400_000;
  const rules = { now, expireDiffMs: 3 * day, trafficDiffBytes: 1e9 };
  const base = { email: 'k', enable: true, totalGB: 100e9, expiryTime: now + 30 * day };
  const used = (bytes: number) => ({ traffic: { up: 0, down: bytes } });

  test('used-up data ends a client even while it is still connected', () => {
    expect(clientState({ ...base, ...used(100e9) }, true, rules)).toEqual({ kind: 'ended' });
  });

  test('a past expiry ends a disabled client instead of calling it disabled', () => {
    expect(clientState({ ...base, enable: false, expiryTime: now - day }, false, rules)).toEqual({
      kind: 'ended',
    });
  });

  test('a disabled client that has time and data left is disabled', () => {
    expect(clientState({ ...base, enable: false }, false, rules)).toEqual({ kind: 'disabled' });
  });

  test('online wins over expiring so live clients read as live', () => {
    expect(clientState({ ...base, expiryTime: now + day }, true, rules)).toEqual({
      kind: 'online',
    });
  });

  test('expiring inside the warning window reports whole days left, at least one', () => {
    expect(clientState({ ...base, expiryTime: now + 2 * day }, false, rules)).toEqual({
      kind: 'expiring',
      daysLeft: 2,
    });
    expect(clientState({ ...base, expiryTime: now + 3_600_000 }, false, rules)).toEqual({
      kind: 'expiring',
      daysLeft: 1,
    });
  });

  test('nearly used-up data is expiring without a day count', () => {
    expect(clientState({ ...base, ...used(99.5e9) }, false, rules)).toEqual({ kind: 'expiring' });
  });

  test('a start-on-first-use expiry (negative) and unlimited data are just active', () => {
    expect(clientState({ ...base, totalGB: 0, expiryTime: -30 * day }, false, rules)).toEqual({
      kind: 'active',
    });
  });
});
