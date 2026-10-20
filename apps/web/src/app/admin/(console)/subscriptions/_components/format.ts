import { ApiRequestError } from '@firmivra/types';
import {
  CYCLE_LABELS,
  PLANS,
  SubscriptionInputError,
  type BillingCycle,
  type PlanId,
  type SubscriptionListItem,
  type SubscriptionStatus,
} from '../../../../../mocks/admin-subscriptions';

/** Whole dollars without cents ("$199"), cents when there are some ("$88.50"). */
export function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

/** A calendar date (YYYY-MM-DD) as "Jan 15, 2027"; the date is the same in every time zone. */
export function dayText(day: string | null | undefined): string {
  if (!day) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00.000Z`),
  );
}

/** "January 15, 2027", for the dates a dialog asks the admin to check. */
export function longDayText(day: string | null | undefined): string {
  if (!day) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00.000Z`),
  );
}

export const seatText = (seats: number) => `${seats} ${seats === 1 ? 'seat' : 'seats'}`;

/** A moment on the viewer's clock: "Oct 18, 2026, 10:24 AM". */
export function timeText(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

/** Only the time of day: "3:45 PM". */
export function clockText(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(new Date(iso));
}

export const planText = (plan: PlanId, cycle: BillingCycle) =>
  `${PLANS[plan].name} (${CYCLE_LABELS[cycle]})`;

/** "$199/mo" or, billed yearly, "$199/mo ($2,388/yr)". */
export const priceText = (monthlyCents: number, cycle: BillingCycle) =>
  cycle === 'ANNUAL'
    ? `${money(monthlyCents)}/mo (${money(monthlyCents * 12)}/yr)`
    : `${money(monthlyCents)}/mo`;

export const statusTone: Record<
  SubscriptionStatus,
  'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'purple'
> = {
  TRIAL: 'info',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  SUSPENDED: 'danger',
  NON_RENEWING: 'purple',
  EXPIRED: 'neutral',
  CANCELLED: 'danger',
  CLOSED: 'neutral',
};

/** Statuses whose Auto-Renew switch is shown (ended ones show a dash). */
export const LIVE: readonly SubscriptionStatus[] = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'NON_RENEWING'];

/** The switch opens a workflow: turning off (Active or Trial) or reversing (Non-Renewing). */
export const autoRenewEditable = (row: Pick<SubscriptionListItem, 'autoRenew' | 'status'>) =>
  row.autoRenew
    ? row.status === 'ACTIVE' || row.status === 'TRIAL'
    : row.status === 'NON_RENEWING' || row.status === 'TRIAL';

/** Why a switch is locked, for its tooltip. */
export function autoRenewLock(row: Pick<SubscriptionListItem, 'autoRenew' | 'status'>) {
  if (autoRenewEditable(row)) return undefined;
  return row.status === 'PAST_DUE'
    ? 'Resolve the past-due balance before changing renewal'
    : 'Renewal can’t change in this status';
}

/** The quiet line a frame shows when its data could not load. */
export function loadErrorText(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === 'FORBIDDEN')
    return 'You don’t have permission to see this.';
  return 'Could not load this right now. Try again in a moment.';
}

/** The field messages of a failed action (empty for other errors). */
export const fieldErrors = (error: unknown): Record<string, string> =>
  error instanceof SubscriptionInputError ? error.fields : {};

/** Whole dollars typed in a field ("1,250.50") as cents, or NaN. */
export function centsFrom(value: string): number {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}
