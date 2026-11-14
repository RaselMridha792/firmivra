// Tax Returns Review 2 (R60, Nov 14; migration r60_tax_r2_corrective_task_filed_year, the lead's
// approval): a return keeps the tax year it was first filed under (TX-F16), and a rejected e-file
// attempt links its corrective task (TX-F24). Runs as the app role, the catalog as the owner.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

const newReturn = (data: Record<string, unknown> = {}) =>
  A().taxReturn.create({
    data: {
      businessId: f.firmA,
      clientId: f.clientA,
      taxYear: 2025,
      filingType: 'INDIVIDUAL',
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r60fy');
});

describe('filed_tax_year (TX-F16)', () => {
  it('is stamped the first time the return leaves IN_PROGRESS, and a corrected year keeps it', async () => {
    const r = await newReturn({ taxYear: 2024, formType: '1040' });
    expect(r.filedTaxYear).toBeNull();
    const filed = await A().taxReturn.update({
      where: { id: r.id },
      data: { status: 'FILED', filedOn: new Date('2025-04-10T00:00:00Z') },
    });
    expect(filed.filedTaxYear).toBe(2024);
    const corrected = await A().taxReturn.update({ where: { id: r.id }, data: { taxYear: 2023 } });
    expect([corrected.taxYear, corrected.filedTaxYear]).toEqual([2023, 2024]);
  });

  it('is never set or changed by the app', async () => {
    expect(await failure(newReturn({ taxYear: 2022, filedTaxYear: 2022 }))).toMatch(
      /set by the database/,
    );
    const r = await newReturn({
      taxYear: 2021,
      status: 'FILED',
      filedOn: new Date('2022-04-10T00:00:00Z'),
    });
    // Inserted as filed (an import): stamped at once.
    expect(r.filedTaxYear).toBe(2021);
    for (const filedTaxYear of [2020, null]) {
      expect(
        await failure(A().taxReturn.update({ where: { id: r.id }, data: { filedTaxYear } })),
      ).toMatch(/set by the database/);
    }
  });

  it('every filed return has it (the backfill, then the trigger)', async () => {
    const [row] = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM tax_returns
      WHERE first_filed_at IS NOT NULL AND filed_tax_year IS NULL`;
    expect(Number(row!.n)).toBe(0);
  });
});

describe('corrective_task_id (TX-F24)', () => {
  it("links a task of the same firm, never another firm's", async () => {
    const r = await newReturn({ taxYear: 2019 });
    const filing = await A().taxReturnFiling.create({
      data: { businessId: f.firmA, taxReturnId: r.id, jurisdiction: 'US' },
    });
    const attempt = await A().taxReturnFilingAttempt.create({
      data: {
        businessId: f.firmA,
        filingId: filing.id,
        submissionId: `SUB-${randomUUID().slice(0, 8)}`,
        transmittedAt: new Date(Date.now() - 30 * 60_000),
        recordedByUserId: f.memberA,
      },
    });
    const task = await A().task.create({
      data: { businessId: f.firmA, clientId: f.clientA, title: 'Correct the fake rejection' },
    });
    await expect(
      A().taxReturnFilingAttempt.update({
        where: { id: attempt.id },
        data: { correctiveTaskId: task.id },
      }),
    ).resolves.toMatchObject({ correctiveTaskId: task.id });
    const theirs = await B().task.create({
      data: { businessId: f.firmB, clientId: f.clientB, title: 'Their task (fake)' },
    });
    expect(
      await failure(
        A().taxReturnFilingAttempt.update({
          where: { id: attempt.id },
          data: { correctiveTaskId: theirs.id },
        }),
      ),
    ).toMatch(/foreign key/i);
  });

  it('keeps the task: the link is RESTRICT', async () => {
    const [fk] = await owner.$queryRaw<{ action: string }[]>`
      SELECT confdeltype::text AS action FROM pg_constraint
      WHERE conname = 'tax_return_filing_attempts_business_id_corrective_task_id_fkey'`;
    expect(fk?.action).toBe('r');
  });
});
