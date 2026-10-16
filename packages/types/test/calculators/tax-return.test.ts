import { describe, expect, it } from 'vitest';
import { estimateTaxReturn } from '../../src/index.js';

const $ = (d: number) => d * 100;

describe('Tax Return Estimator (core)', () => {
  // Synthetic: Single, $75,000 wages, standard deduction $16,100: taxable $58,900, tax
  // $1,240 + $4,560 + 22% of $8,500 ($1,870) = $7,670 (the bracket guide's own case). With
  // $9,000 withheld the refund is $1,330.
  it('works a wage earner by hand', () => {
    const r = estimateTaxReturn({ filingStatus: 'SINGLE', wages: 75_000, withholding: 9_000 });
    expect(r.totalIncome).toBe($(75_000));
    expect(r.totalDeductions).toBe($(16_100));
    expect(r.taxableIncome).toBe($(58_900));
    expect(r.incomeTax).toBe($(7_670));
    expect(r.selfEmploymentTax).toBe(0);
    expect(r.totalTax).toBe($(7_670));
    expect(r.taxPayments).toBe($(9_000));
    expect(r.refundOrDue).toBe($(1_330));
    expect(r.notices).toEqual(['NOT_INCLUDED']);
  });

  it('shows an amount due as a negative number, counting estimated payments', () => {
    const r = estimateTaxReturn({
      filingStatus: 'SINGLE',
      wages: 75_000,
      withholding: 4_000,
      estimatedPayments: 1_000,
    });
    expect(r.refundOrDue).toBe(-$(2_670));
  });

  // Self-employed (the quarterly test's case): SE tax $11,303.64, half $5,651.82, AGI $74,348.18,
  // taxable $58,248.18, tax $7,527; total $7,527 + $11,303.64 = $18,830.64, rounded $18,831.
  it('adds self-employment tax and takes half of it as a deduction', () => {
    const r = estimateTaxReturn({
      filingStatus: 'SINGLE',
      businessIncome: 100_000,
      businessExpenses: 20_000,
    });
    expect(r.totalIncome).toBe($(80_000));
    expect(r.totalDeductions).toBe(565_182 + $(16_100));
    expect(r.taxableIncome).toBe(5_824_818);
    expect(r.incomeTax).toBe($(7_527));
    expect(r.selfEmploymentTax).toBe($(11_304));
    expect(r.totalTax).toBe($(18_831));
    expect(r.refundOrDue).toBe(-$(18_831));
  });

  it('uses the larger of itemized and standard, and tells the person', () => {
    const small = estimateTaxReturn({
      filingStatus: 'SINGLE',
      wages: 50_000,
      deductionType: 'ITEMIZED',
      itemizedDeductions: 10_000,
    });
    expect(small.deduction).toEqual({ type: 'STANDARD', amount: $(16_100) });
    expect(small.notices).toContain('STANDARD_LARGER');
    const big = estimateTaxReturn({
      filingStatus: 'SINGLE',
      wages: 50_000,
      deductionType: 'ITEMIZED',
      itemizedDeductions: 20_000,
    });
    expect(big.deduction).toEqual({ type: 'ITEMIZED', amount: $(20_000) });
    expect(big.taxableIncome).toBe($(30_000));
  });

  it('gives MFS no standard deduction when the spouse itemizes; income under it owes nothing', () => {
    const r = estimateTaxReturn({
      filingStatus: 'MARRIED_SEPARATE',
      wages: 50_000,
      mfsSpouseItemizes: true,
      deductionType: 'ITEMIZED',
      itemizedDeductions: 5_000,
    });
    expect(r.taxableIncome).toBe($(45_000));
    const low = estimateTaxReturn({ filingStatus: 'SINGLE', wages: 10_000, withholding: 300 });
    expect(low.taxableIncome).toBe(0);
    expect(low.totalTax).toBe(0);
    expect(low.refundOrDue).toBe($(300));
  });

  it('counts a business loss as none, and refuses bad input', () => {
    const r = estimateTaxReturn({
      filingStatus: 'SINGLE',
      businessIncome: 100,
      businessExpenses: 900,
    });
    expect(r.notices).toContain('BUSINESS_LOSS_NOT_USED');
    expect(r.totalIncome).toBe(0);
    expect(() => estimateTaxReturn({ filingStatus: 'SINGLE', wages: -5 })).toThrow();
  });
});
