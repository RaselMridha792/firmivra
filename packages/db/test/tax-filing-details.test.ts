// Octavia's Tax Returns review, TX-F22 and TX-F26 (R1, Oct 26; migrations r1_tax_filing_details
// and r1_tax_attempt_agency): a paper filing's mail tracking number, where a jurisdiction's amount
// came from and its version, and the agency that rejected an attempt. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let returnId = '';
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

const newFiling = (jurisdiction: string, data: Record<string, unknown> = {}) =>
  A().taxReturnFiling.create({
    data: { businessId: f.firmA, taxReturnId: returnId, jurisdiction, ...data },
  });
const saveFiling = (id: string, data: Record<string, unknown>) =>
  A().taxReturnFiling.update({ where: { id }, data });
const newAttempt = (filingId: string) =>
  A().taxReturnFilingAttempt.create({
    data: {
      businessId: f.firmA,
      filingId,
      submissionId: `SUB-${randomUUID().slice(0, 8)}`,
      transmittedAt: new Date(Date.now() - 30 * 60_000),
      recordedByUserId: f.memberA,
    },
  });
const saveAttempt = (id: string, data: Record<string, unknown>) =>
  A().taxReturnFilingAttempt.update({ where: { id }, data });
const rejected = { ackStatus: 'REJECTED', acknowledgedAt: new Date(), rejectCode: 'R0000-500' };

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1tfd');
  returnId = (
    await A().taxReturn.create({
      data: { businessId: f.firmA, clientId: f.clientA, taxYear: 2025, filingType: 'INDIVIDUAL' },
    })
  ).id;
});

describe('mail tracking number', () => {
  it('is kept on a paper filing, one line of up to 100 characters', async () => {
    const paper = await newFiling('GA', { filingMethod: 'PAPER' });
    expect(paper.mailTrackingNumber).toBeNull();
    await expect(
      saveFiling(paper.id, {
        mailTrackingNumber: '9400 1000 0000 0000 0000 00',
        status: 'PAPER_FILED',
        paperFiledOn: new Date('2026-03-01'),
      }),
    ).resolves.toMatchObject({ mailTrackingNumber: '9400 1000 0000 0000 0000 00' });
    for (const bad of [' ', 'x'.repeat(101), 'one\ntwo']) {
      expect(await failure(saveFiling(paper.id, { mailTrackingNumber: bad }))).toMatch(
        /check constraint/i,
      );
    }
  });

  it('is never on an e-file filing', async () => {
    expect(await failure(newFiling('NY', { mailTrackingNumber: 'TRACK-1' }))).toMatch(
      /check constraint/i,
    );
  });
});

describe('amount source and version', () => {
  it('are set together, only with an amount, from version 1', async () => {
    const filing = await newFiling('US');
    const estimate = { refundCents: 120_000, amountStatus: 'ESTIMATED' };
    expect(
      await failure(saveFiling(filing.id, { ...estimate, amountSource: 'STAFF_ESTIMATE' })),
    ).toMatch(/check constraint/i);
    expect(await failure(saveFiling(filing.id, { ...estimate, amountVersion: 1 }))).toMatch(
      /check constraint/i,
    );
    expect(
      await failure(saveFiling(filing.id, { amountSource: 'TAX_SOFTWARE', amountVersion: 1 })),
    ).toMatch(/check constraint/i);
    expect(
      await failure(
        saveFiling(filing.id, { ...estimate, amountSource: 'TAX_SOFTWARE', amountVersion: 0 }),
      ),
    ).toMatch(/check constraint/i);
    await expect(
      saveFiling(filing.id, { ...estimate, amountSource: 'STAFF_ESTIMATE', amountVersion: 1 }),
    ).resolves.toMatchObject({ amountSource: 'STAFF_ESTIMATE', amountVersion: 1 });
    await expect(
      saveFiling(filing.id, {
        refundCents: 118_500,
        amountStatus: 'FINAL',
        amountSource: 'TAX_SOFTWARE',
        amountVersion: 2,
      }),
    ).resolves.toMatchObject({ amountSource: 'TAX_SOFTWARE', amountVersion: 2 });
  });
});

describe('rejecting agency', () => {
  it('is only on a rejection, and kept once recorded', async () => {
    const filing = await newFiling('CA');
    const first = await newAttempt(filing.id);
    expect(await failure(saveAttempt(first.id, { rejectingAgency: 'IRS' }))).toMatch(
      /check constraint/i,
    );
    await expect(
      saveAttempt(first.id, { ...rejected, rejectingAgency: 'California FTB' }),
    ).resolves.toMatchObject({ ackStatus: 'REJECTED', rejectingAgency: 'California FTB' });
    expect(await failure(saveAttempt(first.id, { rejectingAgency: 'IRS' }))).toMatch(
      /keeps its answer/,
    );
    expect(await failure(saveAttempt(first.id, { rejectingAgency: null }))).toMatch(
      /keeps its answer/,
    );
    await expect(
      saveAttempt(first.id, { correctiveAction: 'Fix the name control and send again.' }),
    ).resolves.toMatchObject({ rejectingAgency: 'California FTB' });
  });

  it('may be added once to an earlier rejection that has none', async () => {
    const filing = await newFiling('TX');
    const attempt = await newAttempt(filing.id);
    await saveAttempt(attempt.id, rejected);
    await expect(saveAttempt(attempt.id, { rejectingAgency: 'IRS' })).resolves.toMatchObject({
      rejectingAgency: 'IRS',
    });
  });
});

describe('isolation', () => {
  it("firm B cannot see or change firm A's filing details", async () => {
    const filing = await newFiling('OR', { filingMethod: 'PAPER' });
    expect(await B().taxReturnFiling.findMany({ where: { id: filing.id } })).toEqual([]);
    const { count } = await B().taxReturnFiling.updateMany({
      where: { id: filing.id },
      data: { mailTrackingNumber: 'TRACK-B' },
    });
    expect(count).toBe(0);
    expect(
      await B().taxReturnFilingAttempt.updateMany({
        where: { filing: { taxReturnId: returnId } },
        data: { rejectingAgency: 'IRS' },
      }),
    ).toEqual({ count: 0 });
  });
});
