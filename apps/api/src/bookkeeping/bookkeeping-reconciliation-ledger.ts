import type { Prisma, TxClient } from '@firmivra/db';
import type { ReconciliationException } from '@firmivra/types';

// BK-R01: a reconciliation's figures from the ledger. A line counts toward the cleared balance by
// its effect on what the statement shows: money in the bank, or owed on a card or loan.

type AccountType = 'BANK' | 'CREDIT_CARD' | 'LOAN' | 'OTHER';
type Direction = 'DEBIT' | 'CREDIT';

export interface ReconForLedger {
  id: string;
  statementEnd: Date;
  beginningBalanceCents: number;
  endingBalanceCents: number;
  account: { id: string; type: AccountType };
}

/** A credit adds to a bank balance; a debit adds to what is owed on a card or loan. */
export function effectOf(type: AccountType, direction: Direction, amountCents: number): number {
  const owed = type === 'CREDIT_CARD' || type === 'LOAN';
  return owed === (direction === 'DEBIT') ? amountCents : -amountCents;
}

/** A probable duplicate is an exception; categorizing (Needs Review) is not reconciling. */
export function exceptionOf(t: { duplicateOfId: string | null }): ReconciliationException | null {
  return t.duplicateOfId ? 'DUPLICATE' : null;
}

/**
 * The lines a reconciliation sees: its account's, dated up to the statement end, not excluded,
 * not a feed item matched to another line (that line is the same money), and not cleared in
 * another reconciliation.
 */
export function reconScope(
  businessId: string,
  engagementId: string,
  r: ReconForLedger,
): Prisma.BookkeepingTransactionWhereInput {
  return {
    businessId,
    engagementId,
    accountId: r.account.id,
    transactionDate: { lte: r.statementEnd },
    status: { not: 'EXCLUDED' },
    matchedToId: null,
    OR: [{ clearedReconciliationId: null }, { clearedReconciliationId: r.id }],
  };
}

export interface LedgerFigures {
  clearedCount: number;
  clearedBalanceCents: number;
  differenceCents: number;
  exceptionsCount: number;
}

/** The account has ledger lines: its reconciliation's figures come from them. */
export async function hasLedger(
  tx: TxClient,
  businessId: string,
  engagementId: string,
  accountId: string,
): Promise<boolean> {
  const line = await tx.bookkeepingTransaction.findFirst({
    where: { businessId, engagementId, accountId },
    select: { id: true },
  });
  return line !== null;
}

/** The cleared count and balance, the difference and the open exceptions, from the ledger. */
export async function ledgerFigures(
  tx: TxClient,
  businessId: string,
  engagementId: string,
  r: ReconForLedger,
): Promise<LedgerFigures> {
  const cleared = await tx.bookkeepingTransaction.findMany({
    where: { businessId, engagementId, clearedReconciliationId: r.id },
    select: { amountCents: true, direction: true },
  });
  const effect = cleared.reduce(
    (sum, t) => sum + effectOf(r.account.type, t.direction, t.amountCents),
    0,
  );
  const exceptionsCount = await tx.bookkeepingTransaction.count({
    where: {
      AND: [reconScope(businessId, engagementId, r), { duplicateOfId: { not: null } }],
    },
  });
  const clearedBalanceCents = r.beginningBalanceCents + effect;
  return {
    clearedCount: cleared.length,
    clearedBalanceCents,
    differenceCents: r.endingBalanceCents - clearedBalanceCents,
    exceptionsCount,
  };
}
