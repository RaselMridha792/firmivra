import type { PayrollFrequency } from './schemas.js';

/**
 * Payroll Review 2 (F01): one wording for a client's payroll provider, wherever it shows (the
 * Connected Payroll Providers panel, the client's Overview, its Upcoming Payroll Runs and Sync
 * Details):
 * - none chosen: "Not connected";
 * - chosen, but the firm has not authorized it in Integrations: "Pending setup";
 * - authorized, no data yet: "Connected · waiting for first sync";
 * - data came: "Connected · last sync <time>".
 */
export type PayrollConnectionState =
  'NOT_CONNECTED' | 'PENDING_SETUP' | 'WAITING_FIRST_SYNC' | 'SYNCED';

export interface PayrollConnectionFacts {
  /** A provider is chosen for the client. */
  chosen: boolean;
  /** The firm authorized that provider (its Integrations connection is connected). */
  authorized: boolean;
  /** The last successful sync, or null. */
  lastSyncedAt: string | null;
}

export function payrollConnectionState(f: PayrollConnectionFacts): PayrollConnectionState {
  if (!f.chosen) return 'NOT_CONNECTED';
  if (!f.authorized) return 'PENDING_SETUP';
  return f.lastSyncedAt ? 'SYNCED' : 'WAITING_FIRST_SYNC';
}

const at = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** The state in words, the same everywhere. */
export function payrollConnectionLabel(
  f: PayrollConnectionFacts,
  time: (iso: string) => string = at,
): string {
  const state = payrollConnectionState(f);
  if (state === 'NOT_CONNECTED') return 'Not connected';
  if (state === 'PENDING_SETUP') return 'Pending setup';
  if (state === 'WAITING_FIRST_SYNC') return 'Connected · waiting for first sync';
  return `Connected · last sync ${time(f.lastSyncedAt!)}`;
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plus = (date: string, days: number) => iso(Date.parse(`${date}T12:00:00Z`) + days * DAY);
const eom = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => iso(Date.UTC(y, m, d, 12));

/**
 * The pay period that holds `date` (offset 0), or the ones before or after it, for a frequency;
 * pay comes 4 days after the period ends. Weekly and biweekly periods count from Monday Jan 5 2026.
 */
export function payrollPeriodAt(freq: PayrollFrequency, date: string, offset: number) {
  const d = new Date(`${date}T12:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  let start: string;
  let end: string;
  if (freq === 'WEEKLY' || freq === 'BIWEEKLY') {
    const len = freq === 'WEEKLY' ? 7 : 14;
    const anchor = Date.parse('2026-01-05T12:00:00Z');
    const n = Math.floor((d.getTime() - anchor) / DAY / len) + offset;
    start = iso(anchor + n * len * DAY);
    end = plus(start, len - 1);
  } else if (freq === 'MONTHLY') {
    const t = new Date(Date.UTC(y, m + offset, 1));
    start = ymd(t.getUTCFullYear(), t.getUTCMonth(), 1);
    end = ymd(t.getUTCFullYear(), t.getUTCMonth(), eom(t.getUTCFullYear(), t.getUTCMonth()));
  } else {
    const half = (day <= 15 ? 0 : 1) + offset;
    const t = new Date(Date.UTC(y, m + Math.floor(half / 2), 1));
    const ty = t.getUTCFullYear();
    const tm = t.getUTCMonth();
    const second = ((half % 2) + 2) % 2 === 1;
    start = ymd(ty, tm, second ? 16 : 1);
    end = ymd(ty, tm, second ? eom(ty, tm) : 15);
  }
  return { start, end, pay: plus(end, 4) };
}

/** F01: the next pay date the frequency gives, on or after `today`. */
export function scheduledPayDate(freq: PayrollFrequency, today: string): string {
  const current = payrollPeriodAt(freq, today, 0);
  return current.pay >= today ? current.pay : payrollPeriodAt(freq, today, 1).pay;
}
