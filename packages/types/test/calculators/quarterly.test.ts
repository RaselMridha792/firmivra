import { describe, expect, it } from 'vitest';
import { estimateQuarterlySteady } from '../../src/index.js';

const $ = (d: number) => d * 100;

// Hand-worked case (synthetic): Single, $80,000 net business income ($100,000 less $20,000), no
// wages. Net earnings 92.35% = $73,880; Social Security 12.4% = $9,161.12; Medicare 2.9% =
// $2,142.52; SE tax $11,303.64; half = $5,651.82. AGI $74,348.18, less the $16,100 standard
// deduction = $58,248.18. Tax: $1,240 + $4,560 + 22% of $7,848.18 ($1,726.60) = $7,526.60,
// rounded $7,527. Total $18,830.64, rounded $18,831. 90% = $16,947.90, rounded $16,948.
const SELF_EMPLOYED = {
  filingStatus: 'SINGLE',
  businessIncome: 100_000,
  businessExpenses: 20_000,
} as const;

describe('Quarterly estimate, income fairly steady', () => {
  it('works the self-employed case by hand', () => {
    const r = estimateQuarterlySteady(SELF_EMPLOYED);
    expect(r.taxableIncome).toBe(5_824_818);
    expect(r.incomeTax).toBe($(7_527));
    expect(r.selfEmploymentTax).toBe($(11_304));
    expect(r.projectedTotalTax).toBe($(18_831));
    expect(r.currentYearAmount).toBe($(16_948));
    expect(r.priorYearAmount).toBeNull();
    expect(r.requiredAnnualPayment).toBe($(16_948));
    expect(r.safeHarborPayment).toBe($(4_237));
    expect(r.suggestedPayment).toBe($(4_708));
    expect(r.notices).toEqual(['NOT_INCLUDED']);
  });

  it('credits withholding, and uses the smaller prior-year safe harbor', () => {
    const r = estimateQuarterlySteady({
      ...SELF_EMPLOYED,
      withholding: 2_000,
      priorYear: { totalTax: 10_000, agi: 90_000, coveredTwelveMonths: true },
    });
    expect(r.priorYearAmount).toBe($(10_000));
    expect(r.requiredAnnualPayment).toBe($(10_000));
    expect(r.requiredAfterWithholding).toBe($(8_000));
    expect(r.safeHarborPayment).toBe($(2_000));
    expect(r.suggestedPayment).toBe($(4_208));
  });

  it('uses 110% of last year above $150,000 AGI ($75,000 if married filing separately)', () => {
    const prior = { totalTax: 10_000, agi: 160_000, coveredTwelveMonths: true };
    expect(estimateQuarterlySteady({ ...SELF_EMPLOYED, priorYear: prior }).priorYearAmount).toBe(
      $(11_000),
    );
    const mfs = { ...prior, agi: 80_000 };
    expect(
      estimateQuarterlySteady({
        ...SELF_EMPLOYED,
        filingStatus: 'MARRIED_SEPARATE',
        priorYear: mfs,
      }).priorYearAmount,
    ).toBe($(11_000));
    expect(
      estimateQuarterlySteady({ ...SELF_EMPLOYED, priorYear: { ...mfs, agi: 80_000 } })
        .priorYearAmount,
    ).toBe($(10_000));
  });

  it('ignores a prior year that did not cover 12 months', () => {
    const r = estimateQuarterlySteady({
      ...SELF_EMPLOYED,
      priorYear: { totalTax: 1_000, agi: 10_000, coveredTwelveMonths: false },
    });
    expect(r.priorYearAmount).toBeNull();
    expect(r.requiredAnnualPayment).toBe($(16_948));
  });

  it('owes nothing when under $1,000 is owed after withholding', () => {
    const r = estimateQuarterlySteady({
      filingStatus: 'SINGLE',
      wages: 30_000,
      withholding: 1_500,
    });
    expect(r.projectedTotalTax).toBe($(1_420));
    expect(r.notices).toContain('NO_PAYMENT_REQUIRED');
    expect(r.requiredAfterWithholding).toBe(0);
    expect(r.safeHarborPayment).toBe(0);
  });

  it('caps Social Security tax at the wage base less W-2 wages', () => {
    const r = estimateQuarterlySteady({
      filingStatus: 'SINGLE',
      wages: 184_500,
      businessIncome: 10_000,
    });
    // $9,235 net earnings: Medicare only, 2.9% = $267.82; half is $133.91.
    expect(r.selfEmploymentTax).toBe($(268));
  });

  it('charges no SE tax under $400 of net earnings, and treats a business loss as none', () => {
    expect(
      estimateQuarterlySteady({ filingStatus: 'SINGLE', businessIncome: 430, businessExpenses: 0 })
        .selfEmploymentTax,
    ).toBe(0);
    const loss = estimateQuarterlySteady({
      filingStatus: 'SINGLE',
      businessIncome: 100,
      businessExpenses: 900,
    });
    expect(loss.selfEmploymentTax).toBe(0);
    expect(loss.notices).toContain('BUSINESS_LOSS_NOT_USED');
  });

  it('gives MFS no standard deduction when the spouse itemizes', () => {
    const r = estimateQuarterlySteady({
      filingStatus: 'MARRIED_SEPARATE',
      wages: 50_000,
      mfsSpouseItemizes: true,
    });
    expect(r.taxableIncome).toBe($(50_000));
    expect(r.notices).toContain('MFS_STANDARD_NOT_ALLOWED');
  });

  it('refuses bad input', () => {
    expect(() => estimateQuarterlySteady({ filingStatus: 'SINGLE', wages: -1 })).toThrow();
    expect(() => estimateQuarterlySteady({ filingStatus: 'SINGLE', wages: 1.234 })).toThrow();
  });
});
