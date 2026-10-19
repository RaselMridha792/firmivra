import type { MetricUnit } from './integrations-contract';

/**
 * Shared formatters for every Integrations page: moments in the viewer's own time zone (the API
 * sends UTC), money from integer cents, provider units kept as the provider reports them, and
 * "N/A" where a provider reports nothing (docx §3: never a made-up number).
 */

/** "Oct 14, 2026". */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
/** "10:24 AM". */
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
/** "Oct 14, 2026 10:24 AM", as the designs show it. */
export const formatDateTime = (iso: string) => `${formatDate(iso)} ${formatTime(iso)}`;

/** "1,248". */
export const formatNumber = (value: number) => value.toLocaleString('en-US');
/** "$48,620.75" from 4862075 cents. */
export const formatCents = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
/** "99.98%", "83%": up to `digits` decimals, no trailing zeros. */
export const formatPercent = (value: number, digits = 2) =>
  `${Number(value.toFixed(digits)).toLocaleString('en-US')}%`;

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
/** "1.2 TB". */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${Number(value.toFixed(value < 10 && unit > 0 ? 1 : 0)).toLocaleString('en-US')} ${BYTE_UNITS[unit] ?? 'B'}`;
}

/** "180 ms", "2.4 s"; "N/A" without a value. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return 'N/A';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${Number((ms / 1000).toFixed(1))} s`;
}

/** A usage number in its provider's unit; "N/A" when the provider does not report it. */
export function formatMetric(value: number | null, unit: MetricUnit): string {
  if (value === null) return 'N/A';
  switch (unit) {
    case 'CENTS':
      return formatCents(value);
    case 'BYTES':
      return formatBytes(value);
    case 'PERCENT':
      return formatPercent(value);
    case 'MS':
      return formatDuration(value);
    default:
      return formatNumber(value);
  }
}

/** "99.98% uptime", or "Uptime N/A" for a provider that reports none (docx §3). */
export const uptimeText = (uptime: number | null) =>
  uptime === null ? 'Uptime N/A' : `${formatPercent(uptime)} uptime`;
