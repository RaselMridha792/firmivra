import { z } from 'zod';

// BK-RPT part 1 (Octavia's Oct 25 Bookkeeping review): a report's figures, worked out from the
// client's ledger for its period, previewed, then generated as an immutable numbered version and
// downloaded as CSV. Part 1 covers Profit & Loss, Trial Balance, Transaction Detail and
// Uncategorized; the ledger is bank and card lines, so figures are on the cash basis (an accrual
// report says so). Errors: 404 NOT_FOUND; 409 REPORT_NOT_SUPPORTED (another type, for now) and
// NO_PERIOD (a report with no bookkeeping period to cover).

const Int = z.number().int();

export const BookkeepingFigureRow = z.object({
  label: z.string(),
  debitCents: Int.optional(),
  creditCents: Int.optional(),
  amountCents: Int.optional(),
  count: Int.optional(),
});
export const BookkeepingReportFigures = z.object({
  type: z.enum(['PROFIT_LOSS', 'TRIAL_BALANCE', 'TRANSACTION_DETAIL', 'UNCATEGORIZED']),
  basis: z.literal('CASH'),
  basisNote: z.string().nullable(),
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
  /** Why there are no figures (another report type for now, or no period). */
  reason: z.string().nullable(),
  period: z.object({ start: z.iso.date(), end: z.iso.date() }).nullable(),
  figures: BookkeepingReportFigures.nullable(),
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
