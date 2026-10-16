// R37, Tax Returns: the firm's workflow on a return, its history, people, dates, amendments and
// quarterly estimates. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  staffA: randomUUID(),
  staffA2: randomUUID(),
  staffB: randomUUID(),
  client1: '',
  client2: '',
  clientB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);
const days = (d: number) => new Date(Date.now() + d * 86_400_000);

type Step =
  | 'IN_PREPARATION'
  | 'WAITING_ON_CLIENT'
  | 'READY_FOR_REVIEW'
  | 'READY_FOR_SIGNATURE'
  | 'READY_TO_FILE'
  | 'TRANSMITTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'CLOSED';
const newReturn = (data: Record<string, unknown> = {}) =>
  A().taxReturn.create({
    data: {
      businessId: ids.firmA,
      clientId: ids.client1,
      taxYear: 2025,
      filingType: 'INDIVIDUAL',
      ...data,
    },
  });
const move = (id: string, workflowStatus: Step, data: Record<string, unknown> = {}) =>
  A().taxReturn.update({ where: { id }, data: { workflowStatus, ...data } });
const filed = { filedOn: days(-1) };

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.staffA2, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@tw.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `twa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `twb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    for (const userId of [ids.staffA, ids.staffA2]) {
      await tx.membership.create({
        data: { businessId: ids.firmA, userId, role: 'STAFF', status: 'ACTIVE' },
      });
    }
    ids.client1 = (
      await tx.client.create({ data: { businessId: ids.firmA, displayName: 'One' } })
    ).id;
    ids.client2 = (
      await tx.client.create({ data: { businessId: ids.firmA, displayName: 'Two' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: ids.staffB, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientB = (
      await tx.client.create({ data: { businessId: ids.firmB, displayName: 'B' } })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows another firm's history, and refuses people from another firm", async () => {
    const r = await newReturn({ preparerUserId: ids.staffA, updatedByUserId: ids.staffA });
    expect(await A().taxReturnHistory.count({ where: { taxReturnId: r.id } })).toBe(1);
    expect(await B().taxReturnHistory.count({ where: { taxReturnId: r.id } })).toBe(0);
    for (const data of [
      { preparerUserId: ids.staffB },
      { reviewerUserId: ids.staffB },
      { finalValidatedAt: new Date(), finalValidatedByUserId: ids.staffB },
      { updatedByUserId: ids.staffB },
    ]) {
      await expect(newReturn(data)).rejects.toThrow(/foreign key/i);
    }
    // Firm B cannot write history, and cannot amend firm A's return.
    await expect(
      B().taxReturnHistory.create({
        data: {
          businessId: ids.firmB,
          taxReturnId: r.id,
          workflowStatus: 'CLOSED',
        },
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      B().taxReturn.create({
        data: {
          businessId: ids.firmB,
          clientId: ids.clientB,
          taxYear: 2025,
          filingType: 'INDIVIDUAL',
          amendsReturnId: r.id,
          amendReason: 'x',
        },
      }),
    ).rejects.toThrow(/foreign key|amended return amends/i);
  });
});

describe('the step and what the client sees', () => {
  it('a step gives its client status; filed and accepted still say when', async () => {
    const r = await newReturn();
    expect(r).toMatchObject({ workflowStatus: 'IN_PREPARATION', status: 'IN_PROGRESS' });
    for (const step of ['WAITING_ON_CLIENT', 'READY_FOR_REVIEW', 'READY_TO_FILE'] as const) {
      expect(await move(r.id, step)).toMatchObject({ status: 'IN_PROGRESS' });
    }
    await expect(move(r.id, 'TRANSMITTED')).rejects.toThrow(/tax_returns_filed_on/);
    const sent = await move(r.id, 'TRANSMITTED', filed);
    expect(sent).toMatchObject({ status: 'FILED', workflowStatus: 'TRANSMITTED' });
    expect(sent.firstFiledAt).not.toBeNull();
    expect(await move(r.id, 'ACCEPTED')).toMatchObject({ status: 'ACCEPTED' });
    expect(await move(r.id, 'CLOSED')).toMatchObject({ status: 'COMPLETED' });
  });

  it('a client status written alone (today’s API) moves the step with it', async () => {
    const filedOnly = await newReturn({ status: 'FILED', ...filed });
    expect(filedOnly.workflowStatus).toBe('TRANSMITTED');
    const r = await newReturn();
    await A().taxReturn.update({ where: { id: r.id }, data: { status: 'COMPLETED' } });
    expect(await A().taxReturn.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({
      workflowStatus: 'CLOSED',
    });
    const mid = await newReturn();
    await move(mid.id, 'READY_FOR_REVIEW');
    await A().taxReturn.update({ where: { id: mid.id }, data: { status: 'IN_PROGRESS' } });
    expect((await A().taxReturn.findUniqueOrThrow({ where: { id: mid.id } })).workflowStatus).toBe(
      'READY_FOR_REVIEW',
    );
  });

  it('a filed return only moves forward; a rejected one may go back with a reason', async () => {
    const r = await newReturn();
    await move(r.id, 'TRANSMITTED', filed);
    for (const to of ['IN_PREPARATION', 'READY_TO_FILE', 'WAITING_ON_CLIENT'] as const) {
      await expect(move(r.id, to, { statusReason: 'Oops' })).rejects.toThrow(
        /cannot go from TRANSMITTED/,
      );
    }
    await move(r.id, 'REJECTED');
    await expect(move(r.id, 'IN_PREPARATION')).rejects.toThrow(/needs a reason/);
    await expect(
      move(r.id, 'IN_PREPARATION', { statusReason: 'Fix the SSN typo' }),
    ).resolves.toMatchObject({ status: 'IN_PROGRESS', statusReason: 'Fix the SSN typo' });
    const done = await newReturn();
    await move(done.id, 'TRANSMITTED', filed);
    await move(done.id, 'ACCEPTED');
    await move(done.id, 'CLOSED');
    await expect(move(done.id, 'TRANSMITTED')).rejects.toThrow(/cannot go from CLOSED/);
  });

  it('moving back a step needs a new reason, the side state needs none', async () => {
    const r = await newReturn();
    await move(r.id, 'READY_FOR_SIGNATURE');
    await expect(move(r.id, 'IN_PREPARATION')).rejects.toThrow(/needs a reason/);
    await expect(move(r.id, 'READY_FOR_REVIEW', { statusReason: ' ' })).rejects.toThrow(
      /tax_returns_status_reason/,
    );
    await expect(
      move(r.id, 'READY_FOR_REVIEW', { statusReason: 'Missing 1099' }),
    ).resolves.toBeTruthy();
    await move(r.id, 'READY_FOR_SIGNATURE');
    await expect(move(r.id, 'READY_FOR_REVIEW')).rejects.toThrow(/needs a reason/);
    await expect(move(r.id, 'WAITING_ON_CLIENT')).resolves.toBeTruthy();
  });
});

describe('history', () => {
  it('records a new return and each change of step, preparer or reviewer, with its author', async () => {
    const r = await newReturn({ updatedByUserId: ids.staffA });
    await move(r.id, 'READY_FOR_REVIEW', { updatedByUserId: ids.staffA });
    await A().taxReturn.update({
      where: { id: r.id },
      data: { reviewerUserId: ids.staffA2, updatedByUserId: ids.staffA },
    });
    // A change of nothing the history tracks adds no row.
    await A().taxReturn.update({ where: { id: r.id }, data: { dueOn: days(30) } });
    await move(r.id, 'IN_PREPARATION', { statusReason: 'Reviewer found an error' });
    const rows = await A().taxReturnHistory.findMany({
      where: { taxReturnId: r.id },
      orderBy: { seq: 'asc' },
    });
    expect(rows.map((h) => h.workflowStatus)).toEqual([
      'IN_PREPARATION',
      'READY_FOR_REVIEW',
      'READY_FOR_REVIEW',
      'IN_PREPARATION',
    ]);
    expect(rows[2]).toMatchObject({ reviewerUserId: ids.staffA2, reason: null });
    expect(rows[3]).toMatchObject({ reason: 'Reviewer found an error' });
    expect(rows[0]!.changedByUserId).toBe(ids.staffA);
    await expect(
      A().taxReturnHistory.update({ where: { id: rows[0]!.id }, data: { reason: 'x' } }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('amendments, estimates and the rest', () => {
  it('an amended return amends a filed return of the same client, with a reason', async () => {
    const original = await newReturn();
    await expect(
      newReturn({ amendsReturnId: original.id, amendReason: 'Missed 1099' }),
    ).rejects.toThrow(/amends a return that was filed/);
    await move(original.id, 'TRANSMITTED', filed);
    await expect(newReturn({ amendsReturnId: original.id })).rejects.toThrow(
      /tax_returns_amendment/,
    );
    await expect(newReturn({ amendReason: 'Missed 1099' })).rejects.toThrow(
      /tax_returns_amendment/,
    );
    await expect(
      newReturn({ clientId: ids.client2, amendsReturnId: original.id, amendReason: 'x' }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      newReturn({ amendsReturnId: original.id, amendReason: 'Missed 1099', formType: '1040-X' }),
    ).resolves.toMatchObject({ amendsReturnId: original.id });
  });

  it('a quarterly estimate has an amount, a status and, once paid, a date', async () => {
    await expect(newReturn({ estimateAmountCents: 1000 })).rejects.toThrow(/tax_returns_estimate/);
    await expect(newReturn({ quarter: 2, estimateAmountCents: -1 })).rejects.toThrow(
      /tax_returns_estimate/,
    );
    await expect(newReturn({ quarter: 2, estimateStatus: 'PAID' })).rejects.toThrow(
      /tax_returns_estimate/,
    );
    await expect(
      newReturn({
        quarter: 2,
        estimateAmountCents: 125_000,
        estimateStatus: 'PAID',
        estimatePaidOn: days(-2),
        dueOn: days(-1),
      }),
    ).resolves.toMatchObject({ estimateAmountCents: 125_000 });
  });

  it('a filing status is for individual returns; validation, import and archive keep their pairs', async () => {
    await expect(newReturn({ filingType: 'BUSINESS', filingStatus: 'SINGLE' })).rejects.toThrow(
      /tax_returns_filing_status/,
    );
    await expect(newReturn({ filingStatus: 'MARRIED_FILING_JOINTLY' })).resolves.toBeTruthy();
    await expect(newReturn({ finalValidatedAt: new Date() })).rejects.toThrow(
      /tax_returns_final_validation/,
    );
    await expect(newReturn({ importSource: 'UltraTax' })).rejects.toThrow(/tax_returns_import/);
    await expect(
      newReturn({ importSource: 'UltraTax', importedAt: new Date(), archivedAt: new Date() }),
    ).resolves.toBeTruthy();
  });
});
