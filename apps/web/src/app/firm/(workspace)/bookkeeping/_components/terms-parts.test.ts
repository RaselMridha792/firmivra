import { describe, expect, it } from 'vitest';
import { changedFields, eventText, paymentTermsText, termsTabOf } from './terms-parts';

describe('Terms parts (BK-E01)', () => {
  it('reads the tab, and Terms by default', () => {
    expect(termsTabOf('history')).toBe('history');
    expect(termsTabOf('nope')).toBe('terms');
    expect(termsTabOf(undefined)).toBe('terms');
  });

  it('words payment terms and a price change', () => {
    expect(paymentTermsText({ paymentTerms: 'NET_7', paymentTermsDays: null })).toBe('Net 7');
    expect(paymentTermsText({ paymentTerms: 'CUSTOM', paymentTermsDays: 45 })).toBe(
      'Due in 45 days',
    );
    expect(
      eventText({
        id: 'e',
        termsId: 't',
        version: 2,
        kind: 'PRICE_CHANGE_NOTICE',
        effectiveDate: null,
        noticeSentAt: null,
        reason: null,
        details: { monthlyFeeCents: { from: 29000, to: 31000 } },
        actorName: null,
        at: '2026-10-26T12:00:00.000Z',
      }),
    ).toBe('Version 2 · Price change notice: monthly fee $290.00 → $310.00');
  });

  it('sends only the fields that changed', () => {
    expect(
      changedFields(
        { monthlyFeeCents: 29000, includedServices: ['A'], autopay: true },
        { monthlyFeeCents: 31000, includedServices: ['A'], autopay: true },
      ),
    ).toEqual({ monthlyFeeCents: 31000 });
  });
});
