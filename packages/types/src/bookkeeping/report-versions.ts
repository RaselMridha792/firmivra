import { z } from 'zod';

// BK-RPT part 1 (Octavia's Oct 25 Bookkeeping review): a report's figures, worked out from the
// client's ledger for its period, previewed, then generated as an immutable numbered version and
// downloaded as CSV. Part 1 covers Profit & Loss, Trial Balance, Transaction Detail and
// Uncategorized; part 2 the General Ledger, Balance Sheet and Cash Flow (from the period's
// statements), Reconciliation (with refunds and settlements), Bookkeeping Status and Missing
// Documents. The ledger is bank and card lines, so figures are on the cash basis (an accrual
// report says so). Errors: 404 NOT_FOUND; 409 REPORT_NOT_SUPPORTED (Quarterly Review, Year to
// Date Summary and Custom, for now), NO_PERIOD (a report with no bookkeeping period to cover) and
// STATEMENTS_MISSING (a Balance Sheet or Cash Flow with a reconciled account that has no
// statement for the period).

const Int = z.number().int();

export const BookkeepingFigureRow = z.object({
  label: z.string(),
  debitCents: Int.optional(),
  creditCents: Int.optional(),
  amountCents: Int.optional(),
  count: Int.optional(),
});
export const BookkeepingReportFigures = z.object({
  type: z.enum([
    'PROFIT_LOSS',
    'TRIAL_BALANCE',
    'TRANSACTION_DETAIL',
    'UNCATEGORIZED',
    'GENERAL_LEDGER',
    'BALANCE_SHEET',
    'CASH_FLOW',
    'RECONCILIATION',
    'BOOKKEEPING_STATUS',
    'MISSING_DOCUMENTS',
  ]),
  basis: z.literal('CASH'),
  basisNote: z.string().nullable(),
  /** What the figures leave out or rest on (part 2; a part-1 version has none). */
  notes: z.array(z.string()).default([]),
  sections: z.array(
    z.object({ title: z.string(), rows: z.array(BookkeepingFigureRow), totalCents: Int }),
  ),
  totals: z.record(z.string(), Int),
  lineCount: Int,
});
export type BookkeepingReportFigures = z.infer<typeof BookkeepingReportFigures>;

/** GET /business/bookkeeping/reports/{id}/preview: what generating would store, not stored. */
export const BookkeepingReportPreview = z.object({
  supported: z.boolean(),
  /** Why there are no figures (a type not worked out yet, or no period). */
  reason: z.string().nullable(),
  period: z.object({ start: z.iso.date(), end: z.iso.date() }).nullable(),
  figures: BookkeepingReportFigures.nullable(),
  /** Part 2: the accounts a Balance Sheet or Cash Flow has no statement for; generating waits. */
  missingStatements: z.array(z.string()).default([]),
});
export type BookkeepingReportPreview = z.infer<typeof BookkeepingReportPreview>;

/** One generated version: never changed after; a new one is generated instead. */
export const BookkeepingReportVersionRow = z.object({
  version: Int,
  generatedAt: z.iso.datetime({ offset: true }),
  generatedBy: z.string().nullable(),
  deliveryStatus: z.enum(['NOT_SENT', 'SENT', 'FAILED']),
  period: z.object({ start: z.iso.date(), end: z.iso.date() }),
  figures: BookkeepingReportFigures,
});
export type BookkeepingReportVersionRow = z.infer<typeof BookkeepingReportVersionRow>;
export const BookkeepingReportVersionList = z.object({
  items: z.array(BookkeepingReportVersionRow),
});
export type BookkeepingReportVersionList = z.infer<typeof BookkeepingReportVersionList>;
