// R37, Tax Returns: filings per jurisdiction and the recorded transmissions. Status tracking
// only. Runs as the app role.
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
  staffB: randomUUID(),
  client: '',
  clientB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);
const minutes = (m: number) => new Date(Date.now() + m * 60_000);

const newReturn = () =>
  A().taxReturn.create({
    data: { businessId: ids.firmA, clientId: ids.client, taxYear: 2025, filingType: 'INDIVIDUAL' },
  });
const newFiling = (taxReturnId: string, data: Record<string, unknown> = {}) =>
  A().taxReturnFiling.create({
    data: { businessId: ids.firmA, taxReturnId, jurisdiction: 'US', ...data },
  });
const newAttempt = (filingId: string, data: Record<string, unknown> = {}) =>
  A().taxReturnFilingAttempt.create({
    data: {
      businessId: ids.firmA,
      filingId,
      submissionId: `SUB-${randomUUID().slice(0, 8)}`,
      transmittedAt: minutes(-30),
      recordedByUserId: ids.staffA,
      ...data,
    },
  });
const answer = (id: string, data: Record<string, unknown>) =>
  A().taxReturnFilingAttempt.update({ where: { id }, data });
const filingStatus = async (id: string) =>
  (await A().taxReturnFiling.findUniqueOrThrow({ where: { id } })).status;
const step = (id: string, workflowStatus: string, data: Record<string, unknown> = {}) =>
  A().taxReturn.update({
    where: { id },
    data: { workflowStatus: workflowStatus as 'CLOSED', ...data },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@tf.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `tfa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `tfb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmA, userId: ids.staffA, role: 'STAFF', status: 'ACTIVE' },
    });
    ids.client = (
      await tx.client.create({ data: { businessId: ids.firmA, displayName: 'One' } })
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
  it("never shows or changes another firm's filings or attempts, and refuses to point at them", async () => {
    const r = await newReturn();
    const filing = await newFiling(r.id);
    const attempt = await newAttempt(filing.id);
    expect(await B().taxReturnFiling.findUnique({ where: { id: filing.id } })).toBeNull();
    expect(await B().taxReturnFilingAttempt.findUnique({ where: { id: attempt.id } })).toBeNull();
    expect(
      (
        await B().taxReturnFiling.updateMany({
          where: { id: filing.id },
          data: { required: false },
        })
      ).count,
    ).toBe(0);
    await expect(
      B().taxReturnFiling.create({
        data: { businessId: ids.firmB, taxReturnId: r.id, jurisdiction: 'US' },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      B().taxReturnFilingAttempt.create({
        data: {
          businessId: ids.firmB,
          filingId: filing.id,
          submissionId: 'X',
          transmittedAt: minutes(-1),
          recordedByUserId: ids.staffB,
        },
      }),
    ).rejects.toThrow(/e-file filing|foreign key/i);
    await expect(
      newAttempt(filing.id, { recordedByUserId: ids.staffB, submissionId: 'Y' }),
    ).rejects.toThrow(/foreign key|new attempt follows/i);
  });
});

describe('filings', () => {
  it('one per jurisdiction, federal or a state', async () => {
    const r = await newReturn();
    await newFiling(r.id);
    await expect(newFiling(r.id)).rejects.toThrow(/Unique/i);
    await expect(newFiling(r.id, { jurisdiction: 'GA' })).resolves.toBeTruthy();
    for (const jurisdiction of ['ga', 'USA', 'G', '']) {
      await expect(newFiling(r.id, { jurisdiction })).rejects.toThrow(
        /tax_return_filings_jurisdiction/,
      );
    }
  });

  it('a refund or an amount due, in cents, never both, with an estimate or final mark', async () => {
    const r = await newReturn();
    const bad = [
      { refundCents: -1, amountStatus: 'ESTIMATED' },
      { refundCents: 100, amountDueCents: 100, amountStatus: 'FINAL' },
      { refundCents: 100 },
      { amountStatus: 'FINAL' },
    ];
    let n = 0;
    for (const data of bad) {
      await expect(
        newFiling(r.id, { jurisdiction: ['GA', 'FL', 'TX', 'NY'][n++], ...data }),
      ).rejects.toThrow(/tax_return_filings_amounts/);
    }
    await expect(
      newFiling(r.id, { jurisdiction: 'US', refundCents: 284_200, amountStatus: 'ESTIMATED' }),
    ).resolves.toMatchObject({ refundCents: 284_200 });
    await expect(
      newFiling(r.id, {
        jurisdiction: 'GA',
        refundCents: 0,
        amountDueCents: 12_000,
        amountStatus: 'FINAL',
      }),
    ).resolves.toBeTruthy();
  });

  it('a paper filing says when; an e-file one is never filed on paper', async () => {
    const r = await newReturn();
    await expect(newFiling(r.id, { filingMethod: 'PAPER', status: 'PAPER_FILED' })).rejects.toThrow(
      /tax_return_filings_paper/,
    );
    await expect(
      newFiling(r.id, { filingMethod: 'PAPER', status: 'PAPER_FILED', paperFiledOn: new Date() }),
    ).resolves.toBeTruthy();
    await expect(newFiling(r.id, { jurisdiction: 'GA', status: 'ACCEPTED' })).rejects.toThrow(
      /follows its attempts/,
    );
  });
});

describe('attempts', () => {
  it('the filing follows the newest attempt, and a rejection stays when the next is made', async () => {
    const r = await newReturn();
    const filing = await newFiling(r.id);
    expect(await filingStatus(filing.id)).toBe('NOT_FILED');
    const first = await newAttempt(filing.id);
    expect(await filingStatus(filing.id)).toBe('TRANSMITTED');
    await expect(newAttempt(filing.id)).rejects.toThrow(/new attempt follows a rejection/);
    await answer(first.id, {
      ackStatus: 'REJECTED',
      acknowledgedAt: minutes(-10),
      rejectCode: 'IND-031',
      rejectDescription: 'Name does not match',
    });
    expect(await filingStatus(filing.id)).toBe('REJECTED');
    const second = await newAttempt(filing.id);
    await answer(second.id, { ackStatus: 'ACCEPTED', acknowledgedAt: minutes(-1) });
    expect(await filingStatus(filing.id)).toBe('ACCEPTED');
    expect(await A().taxReturnFilingAttempt.count({ where: { filingId: filing.id } })).toBe(2);
    await expect(newAttempt(filing.id)).rejects.toThrow(/new attempt follows a rejection/);
  });

  it('an e-file status cannot be set by hand, a paper filing is not transmitted', async () => {
    const r = await newReturn();
    const filing = await newFiling(r.id);
    await expect(
      A().taxReturnFiling.update({ where: { id: filing.id }, data: { status: 'ACCEPTED' } }),
    ).rejects.toThrow(/follows its attempts/);
    const paper = await newFiling(r.id, { jurisdiction: 'GA', filingMethod: 'PAPER' });
    await expect(newAttempt(paper.id)).rejects.toThrow(/e-file filing/);
    await expect(
      A().taxReturnFiling.update({
        where: { id: paper.id },
        data: { status: 'PAPER_FILED', paperFiledOn: new Date() },
      }),
    ).resolves.toBeTruthy();
    await newAttempt(filing.id);
    await expect(
      A().taxReturnFiling.update({ where: { id: filing.id }, data: { filingMethod: 'PAPER' } }),
    ).rejects.toThrow(/method cannot change after an attempt/);
  });

  it('keeps the answer’s facts together, and an answered attempt keeps its answer', async () => {
    const filing = await newFiling((await newReturn()).id);
    const bad = [
      { ackStatus: 'ACCEPTED' },
      { acknowledgedAt: minutes(-1) },
      { ackStatus: 'REJECTED', acknowledgedAt: minutes(-1) },
      { rejectCode: 'X' },
      { ackStatus: 'ACCEPTED', acknowledgedAt: minutes(-60) },
      { submissionId: ' ' },
      { submissionId: 'x'.repeat(51) },
    ];
    for (const data of bad) {
      await expect(newAttempt(filing.id, data)).rejects.toThrow(/tax_return_filing_attempts_/);
    }
    await expect(newAttempt(filing.id, { transmittedAt: minutes(10) })).rejects.toThrow(
      /cannot be in the future/,
    );
    const attempt = await newAttempt(filing.id);
    const rejected = await answer(attempt.id, {
      ackStatus: 'REJECTED',
      acknowledgedAt: minutes(-5),
      rejectCode: 'R1',
    });
    await expect(answer(attempt.id, { ackStatus: 'ACCEPTED', rejectCode: null })).rejects.toThrow(
      /keeps its answer/,
    );
    await expect(answer(attempt.id, { correctiveAction: 'Fix the name' })).resolves.toMatchObject({
      correctiveAction: 'Fix the name',
      ackStatus: rejected.ackStatus,
    });
    await expect(answer(attempt.id, { submissionId: 'OTHER' })).rejects.toThrow(/cannot change/);
    await expect(A().taxReturnFilingAttempt.delete({ where: { id: attempt.id } })).rejects.toThrow(
      /permission denied/,
    );
  });

  it('two attempts of a filing never share a submission id', async () => {
    const filing = await newFiling((await newReturn()).id);
    const first = await newAttempt(filing.id, { submissionId: 'SAME' });
    await answer(first.id, { ackStatus: 'REJECTED', acknowledgedAt: minutes(-1), rejectCode: 'R' });
    await expect(newAttempt(filing.id, { submissionId: 'SAME' })).rejects.toThrow(/Unique/i);
  });
});

describe('the return follows its filings', () => {
  it('is marked transmitted after a transmission, accepted when every required jurisdiction is', async () => {
    const r = await newReturn();
    const federal = await newFiling(r.id);
    const state = await newFiling(r.id, { jurisdiction: 'GA' });
    const optional = await newFiling(r.id, { jurisdiction: 'FL', required: false });
    await step(r.id, 'READY_TO_FILE');
    await expect(step(r.id, 'TRANSMITTED', { filedOn: new Date() })).rejects.toThrow(
      /record a transmission/,
    );
    const a1 = await newAttempt(federal.id);
    await expect(step(r.id, 'TRANSMITTED', { filedOn: new Date() })).resolves.toMatchObject({
      status: 'FILED',
    });
    await expect(step(r.id, 'ACCEPTED')).rejects.toThrow(/every required jurisdiction/);
    await answer(a1.id, { ackStatus: 'ACCEPTED', acknowledgedAt: minutes(-1) });
    const a2 = await newAttempt(state.id);
    await answer(a2.id, { ackStatus: 'ACCEPTED', acknowledgedAt: minutes(-1) });
    expect(await filingStatus(optional.id)).toBe('NOT_FILED');
    await expect(step(r.id, 'ACCEPTED')).resolves.toMatchObject({ status: 'ACCEPTED' });
    await expect(step(r.id, 'CLOSED')).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('a return without filings behaves as before', async () => {
    const r = await newReturn();
    await expect(step(r.id, 'TRANSMITTED', { filedOn: new Date() })).resolves.toBeTruthy();
    await expect(step(r.id, 'CLOSED')).resolves.toBeTruthy();
  });
});
