// Review 2 (R01c and R01 review, Octavia): one approval rule wherever a reconciliation is approved,
// the Reconciliation screen and the Close Checklist alike. The statement for the account and
// period comes first, then the zero difference, then the open exceptions; the API checks the
// same, in the same order.

/** Why this reconciliation cannot be approved yet, or null when it can. */
export function approveBlocked(r: {
  statementDocumentId: string | null;
  differenceCents: number;
  exceptionsCount: number;
}): string | null {
  if (!r.statementDocumentId)
    return 'Attach the bank or credit card statement for this account and period first.';
  if (r.differenceCents !== 0) return 'The difference must be zero to approve.';
  if (r.exceptionsCount > 0) return 'Resolve the open exceptions first.';
  return null;
}
