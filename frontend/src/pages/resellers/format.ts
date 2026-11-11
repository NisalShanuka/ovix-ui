import type { TFunction } from 'i18next';

// Shared by the owner Resellers page and the reseller portal.
export function formatDateTime(ms: number): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function reasonLabel(t: TFunction, reason: string): string {
  switch (reason) {
    case 'topup':
      return t('pages.resellers.reasons.topup');
    case 'adjust':
      return t('pages.resellers.reasons.adjust');
    case 'client_create':
      return t('pages.resellers.reasons.clientCreate');
    case 'client_renew':
      return t('pages.resellers.reasons.clientRenew');
    case 'refund':
      return t('pages.resellers.reasons.refund');
    default:
      return reason;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type ExpiryState =
  | { kind: 'unlimited' }
  | { kind: 'firstUse'; days: number }
  | { kind: 'expired'; at: number }
  | { kind: 'active'; at: number; daysLeft: number };

// 3x-ui stores "start on first use" as a negative duration and "never" as 0.
export function expiryState(expiryTime: number, now: number = Date.now()): ExpiryState {
  if (expiryTime === 0) return { kind: 'unlimited' };
  if (expiryTime < 0) return { kind: 'firstUse', days: Math.round(-expiryTime / DAY_MS) };
  if (expiryTime <= now) return { kind: 'expired', at: expiryTime };
  // Rounded, not ceiled: a fresh 30-day client must not read 31 when the
  // browser clock trails the server by a few milliseconds.
  const daysLeft = Math.max(1, Math.round((expiryTime - now) / DAY_MS));
  return { kind: 'active', at: expiryTime, daysLeft };
}
