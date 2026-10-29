import type {
  BookkeepingBillingFrequency,
  BookkeepingPaymentTerms,
  BookkeepingRenewalType,
  BookkeepingTerms,
  BookkeepingTermsEvent,
  BookkeepingTermsStatus,
} from '@firmivra/types';

/** The six Terms areas (BK-E01), as the design names them. */
export const TERMS_TABS = [
  { id: 'terms', label: 'Terms' },
  { id: 'service', label: 'Service Details' },
  { id: 'billing', label: 'Billing & Payments' },
  { id: 'documents', label: 'Engagement Documents' },
  { id: 'renewal', label: 'Renewal & Notices' },
  { id: 'history', label: 'History' },
] as const;
export type TermsTab = (typeof TERMS_TABS)[number]['id'];

export const termsTabOf = (value: unknown): TermsTab =>
  TERMS_TABS.find((t) => t.id === value)?.id ?? 'terms';

export const TERMS_STATUS: Record<
  BookkeepingTermsStatus,
  { label: string; tone: 'success' | 'warning' | 'info' | 'neutral' | 'danger' }
> = {
  DRAFT: { label: 'Draft', tone: 'warning' },
  SENT: { label: 'Sent to client', tone: 'info' },
  ACTIVE: { label: 'In force', tone: 'success' },
  SUPERSEDED: { label: 'Superseded', tone: 'neutral' },
  TERMINATED: { label: 'Terminated', tone: 'danger' },
};

export const FREQUENCY: Record<BookkeepingBillingFrequency, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annual',
};

export const PAYMENT_TERMS: Record<BookkeepingPaymentTerms, string> = {
  DUE_ON_RECEIPT: 'Due on receipt',
  NET_7: 'Net 7',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
  CUSTOM: 'Custom',
};

export const RENEWAL: Record<BookkeepingRenewalType, string> = {
  AUTO: 'Auto-renew',
  MANUAL: 'Renew by hand',
  FIXED_TERM: 'Fixed term (ends)',
};

/** "Net 7", or "Due in 45 days" for custom terms. */
export const paymentTermsText = (t: Pick<BookkeepingTerms, 'paymentTerms' | 'paymentTermsDays'>) =>
  t.paymentTerms === 'CUSTOM' && t.paymentTermsDays
    ? `Due in ${t.paymentTermsDays} days`
    : PAYMENT_TERMS[t.paymentTerms];

const EVENT: Record<BookkeepingTermsEvent['kind'], string> = {
  CREATED: 'Created',
  SENT: 'Sent to the client',
  SIGNED: 'Signed',
  ACTIVATED: 'Came into force',
  SUPERSEDED: 'Superseded by a newer version',
  PACKAGE_CHANGED: 'Package changed',
  PRICING_CHANGED: 'Pricing changed',
  SCOPE_CHANGED: 'Scope changed',
  RENEWAL_CHANGED: 'Renewal changed',
  PRICE_CHANGE_NOTICE: 'Price change notice',
  TERMINATION_NOTICE: 'Termination notice',
  TERMINATED: 'Terminated',
  RENEWED: 'Renewed',
  NOTE: 'Note',
};

/** One History line: "Version 2 · Pricing changed: monthly fee $290.00 → $310.00". */
export function eventText(e: BookkeepingTermsEvent): string {
  const head = `Version ${e.version} · ${EVENT[e.kind]}`;
  const fee = e.details['monthlyFeeCents'] as { from?: number; to?: number } | undefined;
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const change =
    fee && typeof fee.from === 'number' && typeof fee.to === 'number'
      ? `: monthly fee ${money(fee.from)} → ${money(fee.to)}`
      : '';
  return `${head}${change}`;
}

/** The fields a draft's form sends: only what changed. */
export function changedFields<T extends Record<string, unknown>>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[key] = after[key];
  }
  return out;
}
