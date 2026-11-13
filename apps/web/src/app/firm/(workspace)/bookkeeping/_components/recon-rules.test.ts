import { describe, expect, it } from 'vitest';
import { approveBlocked } from './recon-rules';

// Review 2 (R01c, R01 review): the statement, then the zero difference, then exceptions.

describe('approveBlocked', () => {
  const ok = { statementDocumentId: 'doc', differenceCents: 0, exceptionsCount: 0 };

  it('allows a reconciliation with its statement, no difference and no open exceptions', () => {
    expect(approveBlocked(ok)).toBeNull();
  });

  it('asks for the statement first, even at a zero difference', () => {
    expect(approveBlocked({ ...ok, statementDocumentId: null })).toMatch(/^Attach the bank/);
    expect(approveBlocked({ ...ok, statementDocumentId: null, differenceCents: 1000 })).toMatch(
      /^Attach the bank/,
    );
  });

  it('then the zero difference, then the exceptions', () => {
    expect(approveBlocked({ ...ok, differenceCents: -1 })).toBe(
      'The difference must be zero to approve.',
    );
    expect(approveBlocked({ ...ok, exceptionsCount: 2 })).toBe(
      'Resolve the open exceptions first.',
    );
  });
});
