import {
  BILLING_INVOICE_STATUS_LABELS,
  type BillingInvoiceStatus,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionBillingCycle,
  type SubscriptionStatus,
} from '@firmivra/types';

/** "$1,234.56". */
export const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** "/month" or "/year". */
export const per = (cycle: SubscriptionBillingCycle) => (cycle === 'ANNUAL' ? '/year' : '/month');

/** "Oct 18, 2026" from a UTC day. */
export const day = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** "Nov 1 – Nov 30, 2026". */
export const period = (from: string, to: string) => {
  const short = (v: string) =>
    new Date(`${v}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  return `${short(from)} – ${day(to)}`;
};

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export const SUBSCRIPTION_TONES: Record<SubscriptionStatus, Tone> = {
  TRIAL: 'info',
  ACTIVE: 'success',
  PAST_DUE: 'danger',
  SUSPENDED: 'danger',
  NON_RENEWING: 'warning',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
};
export const subscriptionLabel = (s: SubscriptionStatus) => SUBSCRIPTION_STATUS_LABELS[s];

export const INVOICE_TONES: Record<BillingInvoiceStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  VOIDED: 'neutral',
  PARTIALLY_REFUNDED: 'warning',
  REFUNDED: 'neutral',
};
export const invoiceLabel = (s: BillingInvoiceStatus) => BILLING_INVOICE_STATUS_LABELS[s];
