// Octavia's Tax Returns review, TX-F19 (R1, Oct 26; migration r1_tax_validation_issues): a
// reviewer's validation issue with its severity, who must resolve it, the draft it was found in
// and its review step, both of the same return. Resolved, never deleted. Runs as the app role.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import {
  connect,
  createEngagement,
  createTwoFirms,
  failure,
  type TwoFirms,
} from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const ids = { returnA: '', otherReturnA: '', draftA: '', stepA: '', otherStepA: '' };
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

const raise = (data: Record<string, unknown> = {}) =>
  A().taxReturnValidationIssue.create({
    data: {
      businessId: f.firmA,
      taxReturnId: ids.returnA,
      severity: 'ERROR',
      note: 'Schedule C income does not match the 1099-NEC.',
      createdByUserId: f.member2A,
      ...data,
    },
  });
const save = (id: string, data: Record<string, unknown>) =>
  A().taxReturnValidationIssue.update({ where: { id }, data });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1tvi');
  const engagementId = await createEngagement(owner, f.firmA, f.clientA, 'ANNUAL_TAX');
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    const newReturn = () =>
      tx.taxReturn.create({
        data: { businessId: f.firmA, clientId: f.clientA, taxYear: 2025, filingType: 'INDIVIDUAL' },
      });
    ids.returnA = (await newReturn()).id;
    ids.otherReturnA = (await newReturn()).id;
    const document = await tx.document.create({
      data: {
        businessId: f.firmA,
        clientId: f.clientA,
        engagementId,
        direction: 'INTERNAL',
        fileName: 'draft-1040.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        sha256: 'd'.repeat(64),
        s3Key: `tenant/${f.firmA}/documents/${Math.random().toString(36).slice(2)}`,
      },
    });
    ids.draftA = document.id;
    await tx.taxReturnDocument.create({
      data: {
        businessId: f.firmA,
        taxReturnId: ids.returnA,
        documentId: document.id,
        kind: 'DRAFT_RETURN',
      },
    });
    const step = (taxReturnId: string) =>
      tx.taxReturnChecklistItem.create({
        data: { businessId: f.firmA, taxReturnId, section: 'REVIEW', label: 'Income ties out' },
      });
    ids.stepA = (await step(ids.returnA)).id;
    ids.otherStepA = (await step(ids.otherReturnA)).id;
  });
});

describe('validation issues', () => {
  it('keep the severity, the responsible member, the draft and the review step', async () => {
    for (const severity of ['ERROR', 'MANUAL_WARNING', 'INFO']) {
      await expect(
        raise({
          severity,
          responsibleUserId: f.memberA,
          draftDocumentId: ids.draftA,
          checklistItemId: ids.stepA,
        }),
      ).resolves.toMatchObject({ severity, responsibleUserId: f.memberA, resolvedAt: null });
    }
  });

  it("link only the same return's draft and review step", async () => {
    expect(
      await failure(raise({ taxReturnId: ids.otherReturnA, draftDocumentId: ids.draftA })),
    ).toMatch(/foreign key/i);
    expect(await failure(raise({ checklistItemId: ids.otherStepA }))).toMatch(/foreign key/i);
    expect(await failure(raise({ responsibleUserId: f.memberB }))).toMatch(/foreign key/i);
  });

  it('take a note of 1 to 2,000 characters', async () => {
    for (const note of ['  ', 'x'.repeat(2001)]) {
      expect(await failure(raise({ note }))).toMatch(/check constraint/i);
    }
  });

  it('are resolved with when and by whom together, and keep their return and author', async () => {
    const issue = await raise();
    expect(await failure(save(issue.id, { resolvedAt: new Date() }))).toMatch(/check constraint/i);
    await expect(
      save(issue.id, { resolvedAt: new Date(), resolvedByUserId: f.memberA }),
    ).resolves.toMatchObject({ resolvedByUserId: f.memberA });
    expect(await failure(save(issue.id, { taxReturnId: ids.otherReturnA }))).toMatch(
      /cannot change/,
    );
    expect(await failure(save(issue.id, { createdByUserId: f.memberA }))).toMatch(/cannot change/);
  });

  it('are never deleted by the app', async () => {
    const issue = await raise();
    expect(await failure(A().taxReturnValidationIssue.delete({ where: { id: issue.id } }))).toMatch(
      /permission denied/i,
    );
  });
});

describe('an unfiled return', () => {
  it('is still deleted with its issue, draft link and review step', async () => {
    const taxReturn = await A().taxReturn.create({
      data: { businessId: f.firmA, clientId: f.clientA, taxYear: 2024, filingType: 'INDIVIDUAL' },
    });
    await A().taxReturnDocument.create({
      data: {
        businessId: f.firmA,
        taxReturnId: taxReturn.id,
        documentId: ids.draftA,
        kind: 'DRAFT_RETURN',
      },
    });
    const step = await A().taxReturnChecklistItem.create({
      data: { businessId: f.firmA, taxReturnId: taxReturn.id, section: 'REVIEW', label: 'Ties' },
    });
    await raise({
      taxReturnId: taxReturn.id,
      draftDocumentId: ids.draftA,
      checklistItemId: step.id,
    });
    await A().taxReturn.delete({ where: { id: taxReturn.id } });
    expect(
      await A().taxReturnValidationIssue.findMany({ where: { taxReturnId: taxReturn.id } }),
    ).toEqual([]);
  });
});

describe('isolation', () => {
  it("firm B cannot see, change or raise firm A's issues", async () => {
    const issue = await raise();
    expect(await B().taxReturnValidationIssue.findMany({ where: { id: issue.id } })).toEqual([]);
    const { count } = await B().taxReturnValidationIssue.updateMany({
      where: { id: issue.id },
      data: { severity: 'INFO' },
    });
    expect(count).toBe(0);
    expect(
      await failure(
        B().taxReturnValidationIssue.create({
          data: {
            businessId: f.firmA,
            taxReturnId: ids.returnA,
            severity: 'ERROR',
            note: 'Not mine.',
            createdByUserId: f.memberA,
          },
        }),
      ),
    ).not.toBe('');
  });
});
