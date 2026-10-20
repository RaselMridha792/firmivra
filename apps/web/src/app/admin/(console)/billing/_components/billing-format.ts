import type { BillingAddress, BillingFile, Currency } from '../../../../../mocks/admin-billing';

/** Formatting and date helpers for every Billing page (money in cents, dates as YYYY-MM-DD). */

const pad = (value: number) => String(value).padStart(2, '0');
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** "$2,450.00" from cents. */
export function formatMoney(cents: number, currency: Currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/** "10/05/2026" from YYYY-MM-DD (Billing Settings' MM/DD/YYYY), with no time-zone shift. */
export function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return year && month && day ? `${month}/${day}/${year}` : date;
}

/** "Oct 5, 2026" from YYYY-MM-DD. */
export function formatLongDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc(date));
}

/** "Oct 5, 2026 at 10:24 AM" from an ISO time, in the platform time zone. */
export function formatDateTime(iso: string): string {
  const at = new Date(iso);
  const zone = 'America/New_York';
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: zone,
  }).format(at);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
  }).format(at);
  return `${date} at ${time}`;
}

/** "Oct 5, 2026" from an ISO time, in the platform time zone. */
export function formatDayOf(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  }).format(new Date(iso));
}

/** Today as YYYY-MM-DD in the browser's time zone. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A YYYY-MM-DD date moved by whole days. */
export function addDays(date: string, days: number): string {
  const at = utc(date);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Whole days from today to `date` (negative when it has passed). */
export function daysFromToday(date: string): number {
  return Math.round((utc(date).getTime() - utc(todayIso()).getTime()) / 86_400_000);
}

/** "1 invoice", "12 invoices". */
export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

/** Dollars typed in a field ("1,250.5", "$99") to cents; null when it isn't an amount. */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Cents to a field's value: 125050 → "1250.50". */
export function moneyInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** A quantity typed in a field to a number; NaN when it isn't one. */
export function parseQuantity(text: string): number {
  const clean = text.trim();
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Number(clean) : Number.NaN;
}

/** "182 KB", "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The address as lines: street, suite, "City, ST 12345". */
export function addressLines(address: BillingAddress): string[] {
  const place = [address.city, [address.state, address.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [address.line1, address.line2, place].filter(Boolean);
}

/** Hands a downloaded file to the browser. */
export function saveFile(file: BillingFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The "All Dates" filter's choices. */
export const PERIODS = [
  { value: 'all', label: 'All Dates' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'last-30', label: 'Last 30 Days' },
  { value: 'last-90', label: 'Last 90 Days' },
  { value: 'this-year', label: 'This Year' },
] as const;
export type Period = (typeof PERIODS)[number]['value'];

/** A period as the `from` / `to` (YYYY-MM-DD) of a list query; empty for All Dates. */
export function periodRange(period: Period): { from?: string; to?: string } {
  const today = todayIso();
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (period) {
    case 'all':
      return {};
    case 'this-month':
      return { from: monthStart, to: today };
    case 'last-month': {
      const end = addDays(monthStart, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    }
    case 'last-30':
      return { from: addDays(today, -29), to: today };
    case 'last-90':
      return { from: addDays(today, -89), to: today };
    case 'this-year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}
