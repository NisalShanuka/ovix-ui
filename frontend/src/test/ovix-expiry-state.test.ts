import { describe, expect, it } from 'vitest';

import { expiryState } from '@/pages/resellers/format';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

describe('expiryState (reseller portal expiry column)', () => {
  it('reads 0 as never expiring', () => {
    expect(expiryState(0, NOW)).toEqual({ kind: 'unlimited' });
  });

  it('reads a negative value as a start-on-first-use duration', () => {
    expect(expiryState(-30 * DAY, NOW)).toEqual({ kind: 'firstUse', days: 30 });
  });

  it('marks a past expiry as expired', () => {
    expect(expiryState(NOW - 1, NOW)).toEqual({ kind: 'expired', at: NOW - 1 });
  });

  it('shows a fresh 30-day client as 30 days even when the browser clock trails the server', () => {
    expect(expiryState(NOW + 30 * DAY + 40, NOW)).toEqual({
      kind: 'active',
      at: NOW + 30 * DAY + 40,
      daysLeft: 30,
    });
  });

  it('never shows an active client as 0 days left', () => {
    expect(expiryState(NOW + 60_000, NOW)).toMatchObject({ kind: 'active', daysLeft: 1 });
  });
});
