import { z } from 'zod';
import { CalendarDate } from '../clients/schemas.js';
import { BillingFrequency, RecurringIntervalUnit, RecurringInvoiceStatus } from '../db-enums.js';

// IP-F05 (Octavia's review of Oct 27, IP-010): Create Invoice can make the invoice recurring.
// Off keeps a one-time invoice. On, the invoice is the first of a schedule (`recurring_invoices`):
// while it is a draft the schedule waits PAUSED (nothing is made or sent); sending the invoice
// starts it ACTIVE from the day the invoice opens. Recurrence never turns on auto-send or AutoPay:
// both stay off until the firm turns them on for the schedule.

/** How often a recurring invoice comes round; ONE_TIME is never a schedule's. */
export const RecurringFrequency = BillingFrequency.exclude(['ONE_TIME']);
export type RecurringFrequency = z.infer<typeof RecurringFrequency>;

export const RECURRING_FREQUENCY_LABELS: Readonly<Record<RecurringFrequency, string>> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Biweekly (every two weeks)',
  SEMI_MONTHLY: 'Semi-monthly (twice a month)',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMIANNUAL: 'Semiannual (every six months)',
  ANNUAL: 'Annual',
  CUSTOM: 'Custom',
};

/** Singular and plural, for "Every 3 weeks". */
export const RECURRING_UNIT_LABELS: Readonly<
  Record<RecurringIntervalUnit, readonly [string, string]>
> = {
  WEEK: ['week', 'weeks'],
  MONTH: ['month', 'months'],
  YEAR: ['year', 'years'],
};

export const RECURRING_LIMITS = {
  /** A custom interval: every 1 to 52 weeks, months or years (the database's check). */
  minInterval: 1,
  maxInterval: 52,
  /** "After N invoices" counts the first one, so it is at least 2. */
  minOccurrences: 2,
  maxOccurrences: 120,
} as const;

/** The rule a schedule repeats by: a named frequency, or every N weeks, months or years. */
export interface RecurrenceRule {
  frequency: RecurringFrequency;
  intervalCount?: number | null;
  intervalUnit?: RecurringIntervalUnit | null;
}

/**
 * The repeat settings a draft carries (`recurring` on create and update). `intervalCount` and
 * `intervalUnit` go with CUSTOM only, both set. The end rule is never (both empty), a date, or a
 * number of invoices counting the first; never both.
 */
export const InvoiceRecurrenceInput = z
  .strictObject({
    frequency: RecurringFrequency,
    intervalCount: z
      .number()
      .int('Use a whole number')
      .min(RECURRING_LIMITS.minInterval, 'Repeat at least every 1')
      .max(RECURRING_LIMITS.maxInterval, 'Repeat at most every 52')
      .nullable()
      .optional(),
    intervalUnit: RecurringIntervalUnit.nullable().optional(),
    endOn: CalendarDate.nullable().optional(),
    maxOccurrences: z
      .number()
      .int('Use a whole number')
      .min(RECURRING_LIMITS.minOccurrences, 'End after at least 2 invoices')
      .max(RECURRING_LIMITS.maxOccurrences, 'End after at most 120 invoices')
      .nullable()
      .optional(),
  })
  .superRefine((r, ctx) => {
    if (r.frequency === 'CUSTOM') {
      if (r.intervalCount == null) {
        ctx.addIssue({ code: 'custom', path: ['intervalCount'], message: 'Enter how often' });
      }
      if (r.intervalUnit == null) {
        ctx.addIssue({
          code: 'custom',
          path: ['intervalUnit'],
          message: 'Choose weeks, months or years',
        });
      }
    } else if (r.intervalCount != null || r.intervalUnit != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['intervalCount'],
        message: 'Only a custom frequency takes an interval',
      });
    }
    if (r.endOn && r.maxOccurrences != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['endOn'],
        message: 'End on a date or after a number of invoices, not both',
      });
    }
  });
export type InvoiceRecurrenceInput = z.input<typeof InvoiceRecurrenceInput>;

/** The schedule an invoice belongs to, as the firm's invoice answer carries it. */
export const InvoiceRecurrence = z.object({
  id: z.uuid(),
  frequency: RecurringFrequency,
  intervalCount: z.number().int().nullable(),
  intervalUnit: RecurringIntervalUnit.nullable(),
  /** The first period: the day the invoice opens (while a draft: its Send On, or today). */
  startOn: CalendarDate,
  /** The next invoice's day; null once COMPLETED or ENDED. */
  nextSendOn: CalendarDate.nullable(),
  endOn: CalendarDate.nullable(),
  maxOccurrences: z.number().int().nullable(),
  /** Invoices made so far, the first included once it is sent. */
  occurrences: z.number().int(),
  /** PAUSED while the invoice it starts from is a draft. */
  status: RecurringInvoiceStatus,
  /** Off unless the firm turns it on for the schedule; recurrence alone never sends. */
  autoSend: z.boolean(),
  autopay: z.boolean(),
});
export type InvoiceRecurrence = z.infer<typeof InvoiceRecurrence>;

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (date: string, days: number) => {
  const [y, m, d] = parts(date);
  return iso(new Date(Date.UTC(y, m - 1, d + days)));
};
/** Months later on the same day, or the month's last day when it is shorter (Jan 31 -> Feb 28). */
const plusMonths = (date: string, months: number) => {
  const [y, m, d] = parts(date);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))));
};

/**
 * The day of the schedule's `k`th invoice (0 is the first, on `startOn`), always counted from the
 * start so a short month never shifts the days after it. Semi-monthly is twice a month: the start
 * day and 15 days later, each month.
 */
export function recurringPeriodOn(startOn: string, rule: RecurrenceRule, k: number): string {
  switch (rule.frequency) {
    case 'WEEKLY':
      return plusDays(startOn, 7 * k);
    case 'BIWEEKLY':
      return plusDays(startOn, 14 * k);
    case 'SEMI_MONTHLY': {
      const month = plusMonths(startOn, Math.floor(k / 2));
      return k % 2 === 0 ? month : plusDays(month, 15);
    }
    case 'MONTHLY':
      return plusMonths(startOn, k);
    case 'QUARTERLY':
      return plusMonths(startOn, 3 * k);
    case 'SEMIANNUAL':
      return plusMonths(startOn, 6 * k);
    case 'ANNUAL':
      return plusMonths(startOn, 12 * k);
    case 'CUSTOM': {
      const n = (rule.intervalCount ?? 1) * k;
      if (rule.intervalUnit === 'WEEK') return plusDays(startOn, 7 * n);
      return plusMonths(startOn, rule.intervalUnit === 'YEAR' ? 12 * n : n);
    }
  }
}

/** "Monthly", or for a custom rule "Every 3 weeks" ("Every month" for 1). */
export function recurrenceLabel(rule: RecurrenceRule): string {
  if (rule.frequency !== 'CUSTOM') return RECURRING_FREQUENCY_LABELS[rule.frequency];
  const n = rule.intervalCount ?? 1;
  const [one, many] = RECURRING_UNIT_LABELS[rule.intervalUnit ?? 'MONTH'];
  return n === 1 ? `Every ${one}` : `Every ${n} ${many}`;
}
