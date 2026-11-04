import { z } from 'zod';
import { SearchText } from '../clients/text.js';
import {
  BookkeepingCategoryType,
  BookkeepingTxnDirection,
  BookkeepingTxnKind,
  BookkeepingTxnSource,
  BookkeepingTxnStatus,
} from '../db-enums.js';

// Bookkeeping Transactions (Octavia's BK-T01, Oct 25 review): the client's ledger lines as the
// accounting software's sync (or an import) brought them, on `bookkeeping_transactions`. This
// contract is the read side: the grid, its search and filters, and the categories. Categorizing,
// splitting, matching and excluding come with the engines.

const CalendarDate = z.iso.date();
const Int = z.number().int();

/** One line of the grid: date, payee, account, amount and side, category, status, type, source. */
export const BookkeepingTransactionRow = z.object({
  id: z.uuid(),
  transactionDate: CalendarDate,
  description: z.string(),
  payee: z.string().nullable(),
  /** Positive cents; `direction` says which side. */
  amountCents: Int,
  direction: BookkeepingTxnDirection,
  kind: BookkeepingTxnKind,
  status: BookkeepingTxnStatus,
  account: z.object({ id: z.uuid(), name: z.string(), mask: z.string().nullable() }),
  category: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  source: BookkeepingTxnSource,
  splitCount: Int,
  hasReceipt: z.boolean(),
  /** Cleared in a reconciliation. */
  cleared: z.boolean(),
});
export type BookkeepingTransactionRow = z.infer<typeof BookkeepingTransactionRow>;

/** GET /business/bookkeeping/clients/{id}/transactions: newest first. */
export const ListBookkeepingTransactionsQuery = z.strictObject({
  /** Description or payee. */
  search: SearchText.optional(),
  status: BookkeepingTxnStatus.optional(),
  kind: BookkeepingTxnKind.optional(),
  direction: BookkeepingTxnDirection.optional(),
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  /** Both ends included. */
  from: CalendarDate.optional(),
  to: CalendarDate.optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListBookkeepingTransactionsQuery = z.input<typeof ListBookkeepingTransactionsQuery>;

export const BookkeepingTransactionPage = z.object({
  items: z.array(BookkeepingTransactionRow),
  total: Int,
  page: Int,
  pageSize: Int,
  /** The client's lines by status, whatever the filters (the tabs' counts). */
  counts: z.object({
    all: Int,
    uncategorized: Int,
    needsReview: Int,
    categorized: Int,
    matched: Int,
    excluded: Int,
  }),
});
export type BookkeepingTransactionPage = z.infer<typeof BookkeepingTransactionPage>;

/** GET /business/bookkeeping/clients/{id}/categories: the chart of accounts' categories. */
export const BookkeepingCategoryRow = z.object({
  id: z.uuid(),
  name: z.string(),
  type: BookkeepingCategoryType,
  active: z.boolean(),
});
export type BookkeepingCategoryRow = z.infer<typeof BookkeepingCategoryRow>;

export const BookkeepingCategoryList = z.object({ items: z.array(BookkeepingCategoryRow) });
export type BookkeepingCategoryList = z.infer<typeof BookkeepingCategoryList>;
