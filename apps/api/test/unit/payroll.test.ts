// The payroll module's logic (R39 Payroll API): run figures from lines, the firm's run checks,
// overview periods and percentages, sync status, CSV cells and the database rule mapping.
import { describe, expect, it } from 'vitest';
import {
  changePercent,
  checkLines,
  csvCell,
  csvRow,
  dollars,
  figuresFrom,
  linePay,
  mapPayrollDbError,
  payrollDbRule,
  periodRange,
  providerLabel,
  providerRef,
  sharePercent,
  syncStatusOf,
  type CheckLine,
  type LineAmounts,
} from '../../src/payroll/payroll.shared.js';

const line = (over: Partial<LineAmounts> = {}): LineAmounts => ({
  hours: 80,
  regularPayCents: 144_000,
  overtimePayCents: 0,
  otherEarningsCents: 5_000,
  deductionsCents: 22_045,
  status: 'READY',
  workerType: 'FULL_TIME',
  ...over,
});
const noTaxes = { employeeTaxesCents: null, employerTaxesCents: null, employerBenefitsCents: null };

describe('linePay', () => {
  it('is earnings less deductions, as the database checks it', () => {
    expect(linePay(line())).toBe(126_955);
  });
});

describe('figuresFrom', () => {
  it('leaves every figure empty when nothing is entered', () => {
    const f = figuresFrom(
      [line({ hours: 0, regularPayCents: 0, otherEarningsCents: 0, deductionsCents: 0 })],
      true,
      noTaxes,
    );
    expect(f.grossCents).toBeNull();
    expect(f.employeeCount).toBeNull();
    expect(f.totalCostCents).toBeNull();
    expect(figuresFrom([], true, noTaxes).grossCents).toBeNull();
  });

  it('sums the lines but invents no tax: net and costs stay empty until taxes are supplied', () => {
    const f = figuresFrom([line(), line({ overtimePayCents: 12_000 })], true, noTaxes);
    expect(f).toMatchObject({
      employeeCount: 2,
      regularPayCents: 288_000,
      overtimePayCents: 12_000,
      otherEarningsCents: 10_000,
      grossCents: 310_000,
      deductionsCents: 44_090,
      netCents: null,
      employerCostsCents: null,
      totalCostCents: null,
    });
  });

  it('works out net, employer costs and total cost from the supplied figures', () => {
    const f = figuresFrom([line({ deductionsCents: 3_000 })], true, {
      employeeTaxesCents: 10_000,
      employerTaxesCents: 5_000,
      employerBenefitsCents: 2_000,
    });
    // gross 149000: net = 149000 - 10000 - 3000; costs = 7000; total = 149000 + 7000
    expect(f.grossCents).toBe(149_000);
    expect(f.netCents).toBe(136_000);
    expect(f.employerCostsCents).toBe(7_000);
    expect(f.totalCostCents).toBe(156_000);
  });

  it('needs both employer figures for the employer costs', () => {
    const f = figuresFrom([line()], true, {
      employeeTaxesCents: 1_000,
      employerTaxesCents: 5_000,
      employerBenefitsCents: null,
    });
    expect(f.employerCostsCents).toBeNull();
    expect(f.totalCostCents).toBeNull();
  });

  it('skips excluded lines and, when asked, contractors', () => {
    const lines = [
      line(),
      line({ status: 'EXCLUDED' }),
      line({ workerType: 'CONTRACTOR', regularPayCents: 50_000, otherEarningsCents: 0 }),
    ];
    expect(figuresFrom(lines, true, noTaxes).employeeCount).toBe(2);
    expect(figuresFrom(lines, false, noTaxes)).toMatchObject({
      employeeCount: 1,
      grossCents: 149_000,
    });
  });

  it('refuses taxes and deductions above the gross pay', () => {
    expect(() => figuresFrom([line()], true, { ...noTaxes, employeeTaxesCents: 500_000 })).toThrow(
      RangeError,
    );
  });
});

describe('checkLines', () => {
  const base: CheckLine = {
    workerId: 'w1',
    hours: 80,
    regularPayCents: 100_000,
    overtimePayCents: 0,
    otherEarningsCents: 0,
    status: 'READY',
    totalPayCents: 100_000,
    workerStatus: 'ACTIVE',
    payType: 'HOURLY',
    directDepositReady: true,
  };
  const codes = (l: Partial<CheckLine>) => checkLines([{ ...base, ...l }]).map((i) => i.code);

  it('finds nothing wrong with a clean line', () => {
    expect(codes({})).toEqual([]);
  });

  it('blocks only a paid worker who is not active', () => {
    const found = checkLines([{ ...base, workerStatus: 'INACTIVE' }]);
    expect(found).toEqual([
      expect.objectContaining({ code: 'worker_not_active', severity: 'ERROR' }),
    ]);
    expect(codes({ workerStatus: 'INACTIVE', regularPayCents: 0, hours: 0 })).toEqual([]);
  });

  it('warns about overtime, unvalidated direct deposit, hours without pay and pay without hours', () => {
    expect(codes({ overtimePayCents: 1_000 })).toEqual(['overtime_review']);
    expect(codes({ directDepositReady: false })).toEqual(['bank_validation_missing']);
    expect(codes({ directDepositReady: null })).toEqual([]);
    expect(codes({ regularPayCents: 0 })).toEqual(['hours_without_pay']);
    expect(codes({ hours: 0 })).toEqual(['pay_without_hours']);
    expect(codes({ hours: 0, payType: 'SALARY' })).toEqual([]);
  });

  it('notes a pending change and skips excluded lines', () => {
    expect(checkLines([{ ...base, status: 'PENDING_CHANGE' }])[0]).toMatchObject({
      code: 'pending_change',
      severity: 'INFO',
    });
    expect(codes({ status: 'EXCLUDED', overtimePayCents: 1_000 })).toEqual([]);
  });

  it('writes messages the database accepts: no long digit runs', () => {
    const all = checkLines([
      {
        ...base,
        workerStatus: 'INACTIVE',
        overtimePayCents: 5,
        directDepositReady: false,
        status: 'PENDING_CHANGE',
      },
    ]);
    for (const issue of all) {
      expect(issue.message).not.toMatch(/[0-9]{6,}/);
      expect(issue.code).toMatch(/^[a-z][a-z0-9_]{0,59}$/);
    }
  });
});

describe('periodRange', () => {
  const today = new Date('2026-10-17T12:00:00Z');
  it('gives the period and the one before it', () => {
    expect(periodRange('THIS_MONTH', today)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      previousFrom: '2026-09-01',
      previousTo: '2026-09-30',
    });
    expect(periodRange('LAST_MONTH', today)).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      previousFrom: '2026-08-01',
    });
    expect(periodRange('THIS_QUARTER', today)).toEqual({
      from: '2026-10-01',
      to: '2026-12-31',
      previousFrom: '2026-07-01',
      previousTo: '2026-09-30',
    });
    expect(periodRange('THIS_YEAR', today)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
      previousFrom: '2025-01-01',
      previousTo: '2025-12-31',
    });
  });

  it('crosses a year boundary', () => {
    expect(periodRange('THIS_MONTH', new Date('2026-01-15T00:00:00Z'))).toMatchObject({
      previousFrom: '2025-12-01',
      previousTo: '2025-12-31',
    });
    expect(periodRange('LAST_MONTH', new Date('2026-01-15T00:00:00Z'))).toMatchObject({
      from: '2025-12-01',
      previousFrom: '2025-11-01',
    });
  });
});

describe('percentages', () => {
  it('changePercent is null when there is nothing to compare, else one decimal', () => {
    expect(changePercent(10, null)).toBeNull();
    expect(changePercent(10, 0)).toBeNull();
    expect(changePercent(112, 100)).toBe(12);
    expect(changePercent(90, 100)).toBe(-10);
    expect(changePercent(1, 3)).toBe(-66.7);
  });
  it('sharePercent is zero for an empty total', () => {
    expect(sharePercent(1, 0)).toBe(0);
    expect(sharePercent(42, 100)).toBe(42);
  });
});

describe('providers and sync status', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  it('names known providers and falls back to the key', () => {
    expect(providerLabel('gusto')).toBe('Gusto');
    expect(providerLabel('some_new_one')).toBe('some_new_one');
    expect(providerLabel(null)).toBe('Not connected');
    expect(providerRef(null, null)).toBeNull();
    expect(providerRef('adp', { status: 'CONNECTED' })).toEqual({
      key: 'adp',
      label: 'ADP',
      connected: true,
    });
    expect(providerRef('adp', { status: 'EXPIRED' })?.connected).toBe(false);
  });

  it("is never synced without a connection, stale after the firm's hours", () => {
    const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
    expect(syncStatusOf({ connected: false, lastSyncedAt: at(1) }, 48, now)).toBe('NOT_CONNECTED');
    expect(syncStatusOf({ connected: true, lastSyncedAt: null }, 48, now)).toBe('NEVER');
    expect(syncStatusOf({ connected: true, lastSyncedAt: at(47) }, 48, now)).toBe('SYNCED');
    expect(syncStatusOf({ connected: true, lastSyncedAt: at(49) }, 48, now)).toBe('STALE');
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Smith, Jo')).toBe('"Smith, Jo"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell(null)).toBe('');
  });
  it('neutralises spreadsheet formulas', () => {
    for (const bad of ['=SUM(A1)', '+1', '-1+2', '@cmd', '\tx']) {
      expect(csvCell(bad).startsWith("'") || csvCell(bad).startsWith('"\'')).toBe(true);
    }
    expect(csvCell(-5)).toBe('-5');
  });
  it('formats cents as dollars', () => {
    expect(dollars(null)).toBe('');
    expect(dollars(0)).toBe('0.00');
    expect(dollars(126_955)).toBe('1269.55');
    expect(dollars(5)).toBe('0.05');
    expect(dollars(-1_050)).toBe('-10.50');
    expect(csvRow(['a', 1, null])).toBe('a,1,');
  });
});

describe('the database rules', () => {
  const raised = (name: string) => ({ message: `PAYROLL_${name}: something`, meta: {} });
  it('finds the named rule in the error', () => {
    expect(payrollDbRule(raised('RUN_BLOCKED'))).toBe('PAYROLL_RUN_BLOCKED');
    expect(
      payrollDbRule({
        message: 'nothing',
        meta: { driverAdapterError: { cause: { message: 'PAYROLL_RUN_LOCKED: x' } } },
      }),
    ).toBe('PAYROLL_RUN_LOCKED');
    expect(payrollDbRule(new Error('boom'))).toBeUndefined();
    expect(payrollDbRule(null)).toBeUndefined();
  });

  const codeOf = (e: unknown) => {
    try {
      mapPayrollDbError(e);
    } catch (err) {
      return (err as { getResponse?: () => { code?: string } }).getResponse?.().code ?? err;
    }
    return undefined;
  };
  it("maps them to the contract's 409 codes and rethrows anything else", () => {
    expect(codeOf(raised('RUN_BLOCKED'))).toBe('RUN_BLOCKED');
    expect(codeOf(raised('RUN_STATUS'))).toBe('RUN_STATE');
    expect(codeOf(raised('RUN_LOCKED'))).toBe('RUN_STATE');
    expect(codeOf(raised('RUN_COMPLETED'))).toBe('RUN_STATE');
    expect(codeOf(raised('LINE_WORKER'))).toBe('NOT_THIS_CLIENTS');
    expect(codeOf(raised('REPORT_DOCUMENT'))).toBe('NOT_THIS_CLIENTS');
    expect(codeOf(raised('CONNECTION'))).toBe('PROVIDER_NOT_CONNECTED');
    const other = new Error('boom');
    expect(codeOf(other)).toBe(other);
  });
});
