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
// contract has the read side (the grid, its search and filters, and the categories) and, below,
// the engines that change a line.

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
export const ListBookkeepingTransactionsQuery = z
  .strictObject({
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
    /** Review 2 (T01a): where a line came from: a sync, an import or entered by hand. */
    source: z.enum(['SYNC', 'IMPORT', 'MANUAL']).optional(),
    /** Review 2 (T01a): the amount, in cents, both ends included (the amount is never negative). */
    amountMin: z.coerce.number().int().min(0).max(1_000_000_000_00).optional(),
    amountMax: z.coerce.number().int().min(0).max(1_000_000_000_00).optional(),
    page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
  })
  .refine(
    (q) => q.amountMin === undefined || q.amountMax === undefined || q.amountMin <= q.amountMax,
    {
      message: 'The smallest amount is more than the largest',
      path: ['amountMax'],
    },
  );
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

// ---------- BK-T01 engines (Octavia, Oct 25 review; built Nov 7) ----------
// Categorize, split, transfer match, exclude and include, a receipt, and bulk actions, on the
// ledger's own rules (R1): a split's parts add up to the amount and the split has no category of
// its own; a transfer's two sides are the same amount the other way on another account and name
// each other; nothing changes in a closed period. Staff work on their clients' lines; each change
// is audited with ids only. Errors: 404 NOT_FOUND (a line, category or document that is not the
// client's), 409 SPLIT_TOTAL, NOT_A_TRANSFER, PERIOD_LOCKED, CATEGORY_INACTIVE.

const Reason = z.string().trim().min(1, 'Say why').max(200);

/** PATCH .../clients/{id}/transactions/{txnId}/category: one category (any split or transfer goes). */
export const CategorizeBookkeepingTransactionRequest = z.strictObject({ categoryId: z.uuid() });
export type CategorizeBookkeepingTransactionRequest = z.input<
  typeof CategorizeBookkeepingTransactionRequest
>;

/** PUT .../split: two to twenty parts that add up to the line's amount. */
export const SplitBookkeepingTransactionRequest = z.strictObject({
  parts: z
    .array(
      z.strictObject({
        categoryId: z.uuid(),
        amountCents: Int.min(1, 'Each part is more than zero'),
        memo: z.string().trim().max(200).optional(),
      }),
    )
    .min(2, 'A split has at least two parts')
    .max(20),
});
export type SplitBookkeepingTransactionRequest = z.input<typeof SplitBookkeepingTransactionRequest>;

/** POST .../transfer: this line and its other side (from the candidates) become one transfer. */
export const MatchBookkeepingTransferRequest = z.strictObject({ pairId: z.uuid() });
export type MatchBookkeepingTransferRequest = z.input<typeof MatchBookkeepingTransferRequest>;

/** POST .../exclude: left out of the books, with the reason; POST .../include brings it back. */
export const ExcludeBookkeepingTransactionRequest = z.strictObject({ reason: Reason });
export type ExcludeBookkeepingTransactionRequest = z.input<
  typeof ExcludeBookkeepingTransactionRequest
>;

/** PUT .../receipt: one of the client's own documents, or null to take it off. */
export const AttachBookkeepingReceiptRequest = z.strictObject({ documentId: z.uuid().nullable() });
export type AttachBookkeepingReceiptRequest = z.input<typeof AttachBookkeepingReceiptRequest>;

/** POST .../transactions/bulk: one action on up to 100 lines; each line that cannot is named. */
export const BulkBookkeepingTransactionsRequest = z
  .strictObject({
    ids: z.array(z.uuid()).min(1).max(100),
    action: z.enum(['CATEGORIZE', 'EXCLUDE', 'INCLUDE']),
    categoryId: z.uuid().optional(),
    reason: Reason.optional(),
  })
  .superRefine((b, ctx) => {
    if (b.action === 'CATEGORIZE' && !b.categoryId) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Choose a category' });
    }
    if (b.action === 'EXCLUDE' && !b.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Say why' });
    }
  });
export type BulkBookkeepingTransactionsRequest = z.input<typeof BulkBookkeepingTransactionsRequest>;
export const BulkBookkeepingTransactionsResult = z.object({
  done: Int,
  refused: z.array(z.object({ id: z.uuid(), code: z.string() })),
});
export type BulkBookkeepingTransactionsResult = z.infer<typeof BulkBookkeepingTransactionsResult>;

/** GET .../transfer-candidates: lines that can be this one's other side, closest date first. */
export const BookkeepingTransferCandidates = z.object({
  items: z.array(BookkeepingTransactionRow),
});
export type BookkeepingTransferCandidates = z.infer<typeof BookkeepingTransferCandidates>;

/** The ledger's refusals in the firm's words (the screens and the bulk result use them). */
export const BOOKKEEPING_TXN_ERRORS: Record<string, string> = {
  SPLIT_TOTAL: 'The parts must add up to the transaction amount.',
  NOT_A_TRANSFER:
    "A transfer's other side is the same amount, the other way, on another of the client's accounts.",
  PERIOD_LOCKED: 'This date is in a closed period. Reopen the period first.',
  CATEGORY_INACTIVE: 'That category is inactive. Choose an active one.',
  NOT_FOUND: "That transaction, category or document is not this client's.",
};
