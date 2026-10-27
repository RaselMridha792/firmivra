import { z } from 'zod';
import { BookkeepingTxnDirection, BookkeepingTxnKind, BookkeepingTxnStatus } from '../db-enums.js';

// Bookkeeping Reconciliation (Octavia's BK-R01, Oct 25 review): the ledger lines a reconciliation
// clears. When the account has ledger lines, the cleared balance, the cleared count, the
// difference and the open exceptions are worked out from them, never typed. Matching, duplicate
// detection and the refund and settlement models are the engines.

const CalendarDate = z.iso.date();
const Int = z.number().int();

/**
 * Why a line needs a look before the account can be approved: a probable duplicate. Unmatched
 * statement lines, refunds and settlements join this list with the engines.
 */
export const ReconciliationException = z.enum(['DUPLICATE']);
export type ReconciliationException = z.infer<typeof ReconciliationException>;

export const BookkeepingReconciliationItem = z.object({
  id: z.uuid(),
  transactionDate: CalendarDate,
  description: z.string(),
  payee: z.string().nullable(),
  /** Positive cents; `direction` says which side. */
  amountCents: Int,
  direction: BookkeepingTxnDirection,
  kind: BookkeepingTxnKind,
  status: BookkeepingTxnStatus,
  /**
   * The line's effect on the balance the statement shows: money in the bank (a credit adds), or
   * owed on a card or loan (a debit adds).
   */
  effectCents: Int,
  /** Cleared in this reconciliation. */
  cleared: z.boolean(),
  exception: ReconciliationException.nullable(),
});
export type BookkeepingReconciliationItem = z.infer<typeof BookkeepingReconciliationItem>;

/**
 * GET /business/bookkeeping/reconciliations/{id}/items: the account's lines dated up to the
 * statement end that are not excluded, not a feed item matched to another line, and not cleared
 * in another reconciliation; oldest first, at most 500.
 */
export const BookkeepingReconciliationItems = z.object({
  items: z.array(BookkeepingReconciliationItem),
  /** More lines than the list shows. */
  truncated: z.boolean(),
  /** The account has ledger lines: the figures below come from them. */
  fromLedger: z.boolean(),
  clearedCount: Int,
  clearedBalanceCents: Int,
  differenceCents: Int,
  exceptionsCount: Int,
});
export type BookkeepingReconciliationItems = z.infer<typeof BookkeepingReconciliationItems>;

/** POST /business/bookkeeping/reconciliations/{id}/items: mark lines cleared, or not. */
export const ClearBookkeepingReconciliationItemsRequest = z.strictObject({
  transactionIds: z
    .array(z.uuid())
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Each line once'),
  cleared: z.boolean(),
});
export type ClearBookkeepingReconciliationItemsRequest = z.input<
  typeof ClearBookkeepingReconciliationItemsRequest
>;
