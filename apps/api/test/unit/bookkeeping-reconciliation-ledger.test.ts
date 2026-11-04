// Bookkeeping Reconciliation (BK-R01): a ledger line's effect on the balance a statement shows,
// and which lines are exceptions.
import { describe, expect, it } from 'vitest';
import { effectOf, exceptionOf } from '../../src/bookkeeping/bookkeeping-reconciliation-ledger.js';

describe('effectOf', () => {
  it('adds a credit and takes off a debit on a bank account', () => {
    expect(effectOf('BANK', 'CREDIT', 5000)).toBe(5000);
    expect(effectOf('BANK', 'DEBIT', 5000)).toBe(-5000);
    expect(effectOf('OTHER', 'CREDIT', 1)).toBe(1);
  });

  it('adds a charge and takes off a payment on a card or loan (what is owed)', () => {
    expect(effectOf('CREDIT_CARD', 'DEBIT', 2500)).toBe(2500);
    expect(effectOf('CREDIT_CARD', 'CREDIT', 2500)).toBe(-2500);
    expect(effectOf('LOAN', 'DEBIT', 100)).toBe(100);
    expect(effectOf('LOAN', 'CREDIT', 100)).toBe(-100);
  });
});

describe('exceptionOf', () => {
  it('flags a probable duplicate; a line still to categorize is not an exception', () => {
    expect(exceptionOf({ duplicateOfId: '0199b6a0-0000-7000-8000-000000000001' })).toBe(
      'DUPLICATE',
    );
    expect(exceptionOf({ duplicateOfId: null })).toBeNull();
  });
});
