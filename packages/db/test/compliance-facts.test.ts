// Stage C2 (R0, Oct 18): the Compliance follow-ups. A client's compliance facts and sales tax
// registrations (firm data, isolated), the holiday table (reference data every scope reads and only
// the Super Admin team or the platform maintains) and the task due-date sync setting.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const admin = randomUUID();
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

beforeAll(async () => {
  f = await createTwoFirms(owner, 'c2cf');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: admin,
        cognitoSub: admin,
        pool: 'ADMIN',
        email: `${admin}@sup.test`,
        name: 'Fake',
      },
    });
    await tx.platformAdmin.create({ data: { userId: admin, role: 'SUPER_ADMIN' } });
  });
});

describe('client compliance facts', () => {
  it("are the firm's own; another firm sees and writes none", async () => {
    await A().clientComplianceFacts.create({
      data: { businessId: f.firmA, clientId: f.clientA, taxClassification: 'S_CORPORATION' },
    });
    expect(await B().clientComplianceFacts.count()).toBe(0);
    expect(
      await failure(
        B().clientComplianceFacts.create({ data: { businessId: f.firmA, clientId: f.clientA } }),
      ),
    ).toMatch(/row-level security/);
    // Firm B's own client only.
    expect(
      await failure(
        B().clientComplianceFacts.create({ data: { businessId: f.firmB, clientId: f.clientA } }),
      ),
    ).toMatch(/Foreign key|foreign key/);
  });

  it('keep the shape: a real fiscal year end, two-letter states, election keys, a liability with its year', async () => {
    const set = (data: Record<string, unknown>) =>
      A().clientComplianceFacts.update({
        where: { businessId_clientId: { businessId: f.firmA, clientId: f.clientA } },
        data,
      });
    for (const data of [
      { fiscalYearEndMonth: 2, fiscalYearEndDay: 30 },
      { fiscalYearEndMonth: 6 },
      { payrollStates: ['Texas'] },
      { elections: ['S Corp'] },
      { priorYearTaxLiabilityCents: 100 },
      { isPayrollEmployer: false, payrollDepositSchedule: 'MONTHLY' },
    ]) {
      expect(await failure(set(data))).toMatch(/client_compliance_facts_shape/);
    }
    const ok = await set({
      fiscalYearEndMonth: 6,
      fiscalYearEndDay: 30,
      payrollStates: ['TX', 'OK'],
      elections: ['s_corp_2553'],
      priorYearTaxLiabilityCents: 1_200_000,
      priorYearTaxYear: 2025,
      verifiedAt: new Date('2020-01-01'),
    });
    expect(ok.verifiedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(
      await failure(A().clientComplianceFacts.deleteMany({ where: { clientId: f.clientA } })),
    ).toMatch(/permission denied/i);
  });
});

describe('sales tax registrations', () => {
  it('one open registration per state; a registration keeps its client and state; closed, never deleted', async () => {
    const reg = (state: string, extra: Record<string, unknown> = {}) =>
      A().clientSalesTaxRegistration.create({
        data: { businessId: f.firmA, clientId: f.clientA, state, frequency: 'QUARTERLY', ...extra },
      });
    const tx = await reg('TX', { registeredOn: new Date('2021-03-01') });
    expect(await failure(reg('TX'))).toMatch(/already has an open TX sales tax registration/);
    expect(await failure(reg('tx'))).toMatch(/client_sales_tax_registrations_shape/);
    expect(
      await failure(
        A().clientSalesTaxRegistration.update({ where: { id: tx.id }, data: { state: 'OK' } }),
      ),
    ).toMatch(/keeps its client and state/);
    await A().clientSalesTaxRegistration.update({
      where: { id: tx.id },
      data: { closedOn: new Date('2026-06-30') },
    });
    await expect(reg('TX', { frequency: 'MONTHLY' })).resolves.toMatchObject({
      frequency: 'MONTHLY',
    });
    expect(
      await failure(A().clientSalesTaxRegistration.deleteMany({ where: { id: tx.id } })),
    ).toMatch(/permission denied/i);
  });
});

describe('the holiday table', () => {
  it('ships 2026 and 2027; every scope reads it; only the team or the platform maintains it', async () => {
    expect(
      await A().complianceHoliday.findMany({
        where: { holidayOn: { gte: new Date('2026-07-01'), lte: new Date('2026-07-31') } },
      }),
    ).toEqual([
      expect.objectContaining({ jurisdiction: 'US', name: 'Independence Day (observed)' }),
    ]);
    expect(await A().complianceHoliday.count({ where: { jurisdiction: 'US-DC' } })).toBe(2);
    const day = {
      jurisdiction: 'US-TX',
      holidayOn: new Date('2026-03-02'),
      name: 'Texas Independence Day',
    };
    expect(await failure(A().complianceHoliday.create({ data: day }))).toMatch(
      /row-level security/,
    );
    // Holidays are reference data the test setup keeps between runs: clear a leftover first.
    await db.forAdmin(admin).complianceHoliday.deleteMany({ where: { jurisdiction: 'US-TX' } });
    await db.forAdmin(admin).complianceHoliday.create({ data: day });
    expect(await A().complianceHoliday.count({ where: { jurisdiction: 'US-TX' } })).toBe(1);
    expect(
      await failure(
        db.forAdmin(admin).complianceHoliday.create({ data: { ...day, jurisdiction: 'Texas' } }),
      ),
    ).toMatch(/compliance_holidays_shape/);
    await db.forAdmin(admin).complianceHoliday.deleteMany({ where: { jurisdiction: 'US-TX' } });
  });
});

describe('the task due-date sync setting', () => {
  it('lead days only with LEAD_DAYS, within a year', async () => {
    await A().complianceSettings.create({ data: { businessId: f.firmA } });
    const set = (data: Record<string, unknown>) =>
      A().complianceSettings.update({ where: { businessId: f.firmA }, data });
    for (const data of [
      { taskDueDateSync: 'MATCH_DEADLINE', taskDueLeadDays: 3 },
      { taskDueDateSync: 'LEAD_DAYS', taskDueLeadDays: 400 },
    ]) {
      expect(await failure(set(data))).toMatch(/compliance_settings_task_due_sync/);
    }
    await expect(set({ taskDueDateSync: 'LEAD_DAYS', taskDueLeadDays: 3 })).resolves.toMatchObject({
      taskDueDateSync: 'LEAD_DAYS',
      taskDueLeadDays: 3,
    });
  });
});
