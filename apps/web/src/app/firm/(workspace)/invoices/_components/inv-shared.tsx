'use client';

import { DUE_SOON_DAYS, type InvoiceListItem } from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

/** Every query of the Invoices module starts here, as on the client record's Invoices tab. */
export const INV_KEY = ['invoices'] as const;

/** At most this many pages of 100 are read for the KPIs, charts and the table. */
const MAX_PAGES = 20;

/**
 * Every invoice of the firm (Staff: their clients'), read page by page: the KPIs, the charts and
 * the table all come from it, so they never disagree. `capped`: there were more than we read.
 */
export function useAllInvoices() {
  return useApiQuery([...INV_KEY, 'all'], async () => {
    const items: InvoiceListItem[] = [];
    let cursor: string | undefined;
    let paymentsEnabled = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await api.invoices.list({ limit: 100, cursor });
      items.push(...res.items);
      paymentsEnabled = res.paymentsEnabled;
      if (!res.nextCursor) return { items, paymentsEnabled, capped: false };
      cursor = res.nextCursor;
    }
    return { items, paymentsEnabled, capped: true };
  });
}

/** What the table, tabs and the status chart show: the stored status, split as the firm reads it. */
export type InvoiceView =
  'DRAFT' | 'SCHEDULED' | 'SENT' | 'PARTIALLY_PAID' | 'DUE_SOON' | 'OVERDUE' | 'PAID' | 'CANCELED';

export const VIEW_LABEL: Record<InvoiceView, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  SENT: 'Sent',
  PARTIALLY_PAID: 'Partially Paid',
  DUE_SOON: 'Due Soon',
  OVERDUE: 'Overdue',
  PAID: 'Paid',
  CANCELED: 'Canceled',
};
export const VIEW_ORDER: InvoiceView[] = [
  'DRAFT',
  'SCHEDULED',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'DUE_SOON',
  'OVERDUE',
  'CANCELED',
];
const VIEW_TONE: Record<InvoiceView, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  SENT: 'info',
  PARTIALLY_PAID: 'warning',
  DUE_SOON: 'warning',
  OVERDUE: 'danger',
  PAID: 'success',
  CANCELED: 'neutral',
};
/** The donut's colour for each view (the design: green paid, red overdue, amber due soon). */
export const VIEW_CHART: Record<
  InvoiceView,
  'green' | 'blue' | 'yellow' | 'grey' | 'red' | 'purple' | 'navy'
> = {
  PAID: 'green',
  PARTIALLY_PAID: 'purple',
  OVERDUE: 'red',
  DUE_SOON: 'yellow',
  SENT: 'blue',
  SCHEDULED: 'navy',
  DRAFT: 'grey',
  CANCELED: 'grey',
};

/** Money received so far: the whole total once paid, the total less the balance while open. */
export const paidCents = (i: InvoiceListItem) =>
  i.status === 'PAID'
    ? i.totalCents
    : i.status === 'OPEN'
      ? Math.max(0, i.totalCents - i.balanceDueCents)
      : 0;

export function viewOf(i: InvoiceListItem): InvoiceView {
  if (i.status !== 'OPEN') return i.status;
  if (i.overdue) return 'OVERDUE';
  if (paidCents(i) > 0) return 'PARTIALLY_PAID';
  if (i.clientStatus === 'DUE_SOON') return 'DUE_SOON';
  return 'SENT';
}

export function ViewPill({ invoice }: { invoice: InvoiceListItem }) {
  const v = viewOf(invoice);
  return (
    <span className="whitespace-nowrap">
      <Badge tone={VIEW_TONE[v]}>{VIEW_LABEL[v]}</Badge>
    </span>
  );
}

export const money = (cents: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
export const moneyWhole = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'usd',
    maximumFractionDigits: 0,
  }).format(cents / 100);

/** "09/15/2026" from a calendar date or an instant. */
export const dayText = (value: string | null | undefined) => {
  if (!value) return '—';
  const d = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(d);
};

/** Today on this computer, YYYY-MM-DD. */
export const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** The day an invoice counts from: when it was issued, else when it was made. */
export const invoiceDay = (i: InvoiceListItem) => (i.issuedAt ?? i.createdAt).slice(0, 10);

/** "125.50" or "$1,250" typed in a money field, as cents; NaN when it is not an amount. */
export const toCents = (input: string) => {
  const value = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return NaN;
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
};

export { DUE_SOON_DAYS };

export const OFFLINE_METHOD: Record<string, string> = {
  CHECK: 'Check',
  CASH: 'Cash',
  ACH: 'ACH Bank Transfer',
  CARD: 'Card (terminal)',
  OTHER: 'Other',
};

export const primary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-5 text-sm font-semibold text-on-action hover:opacity-90 disabled:opacity-50';
export const outlined =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-semibold text-heading hover:bg-canvas disabled:opacity-50';
export const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
export const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
export const linkBtn =
  'inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-link';
