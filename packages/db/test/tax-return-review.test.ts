// R37, Tax Returns: review steps, the preparation and review lists, the manual final validation,
// and the gate to READY_TO_FILE. Runs as the app role.
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
  client: '',
  client2: '',
  doc: '',
  docOfClient2: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);

const newReturn = () =>
  A().taxReturn.create({
    data: { businessId: ids.firmA, clientId: ids.client, taxYear: 2025, filingType: 'INDIVIDUAL' },
  });
const approval = (taxReturnId: string, data: Record<string, unknown> = {}) =>
  A().taxReturnApproval.create({
    data: { businessId: ids.firmA, taxReturnId, step: 'Preparer Review', sortOrder: 1, ...data },
  });
const line = (
  taxReturnId: string,
  section: 'PREPARATION' | 'REVIEW' | 'VALIDATION',
  data: Record<string, unknown> = {},
) =>
  A().taxReturnChecklistItem.create({
    data: {
      businessId: ids.firmA,
      taxReturnId,
      section,
      label: 'W-2s entered',
      ...(section === 'VALIDATION' ? { result: 'VALID' } : {}),
      ...data,
    },
  });
const toReadyToFile = (id: string, data: Record<string, unknown> = {}) =>
  A().taxReturn.update({ where: { id }, data: { workflowStatus: 'READY_TO_FILE', ...data } });
const decided = { decidedAt: new Date(), decidedByUserId: ids.staffA };

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.staffA2, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@tr.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `tra-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `trb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const b = ids.firmA;
    for (const userId of [ids.staffA, ids.staffA2]) {
      await tx.membership.create({
        data: { businessId: b, userId, role: 'STAFF', status: 'ACTIVE' },
      });
    }
    const service = await tx.service.create({
      data: { businessId: b, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
    });
    const make = async (name: string) => {
      const c = await tx.client.create({ data: { businessId: b, displayName: name } });
      const e = await tx.engagement.create({
        data: { businessId: b, clientId: c.id, serviceId: service.id, title: '2025' },
      });
      const d = await tx.document.create({
        data: {
          businessId: b,
          clientId: c.id,
          engagementId: e.id,
          direction: 'INTERNAL',
          fileName: 'Draft.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'd'.repeat(64),
          s3Key: `tenant/${b}/documents/${randomUUID()}`,
        },
      });
      return { c: c.id, d: d.id };
    };
    const one = await make('One');
    const two = await make('Two');
    Object.assign(ids, { client: one.c, doc: one.d, client2: two.c, docOfClient2: two.d });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: ids.staffB, role: 'OWNER', status: 'ACTIVE' },
    });
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows or changes another firm's review rows, and refuses to point at them", async () => {
    const r = await newReturn();
    const step = await approval(r.id, { assignedUserId: ids.staffA });
    const item = await line(r.id, 'PREPARATION');
    expect(await B().taxReturnApproval.findUnique({ where: { id: step.id } })).toBeNull();
    expect(await B().taxReturnChecklistItem.findUnique({ where: { id: item.id } })).toBeNull();
    expect((await B().taxReturnChecklistItem.deleteMany({ where: { id: item.id } })).count).toBe(0);
    expect(
      (await B().taxReturnApproval.updateMany({ where: { id: step.id }, data: { note: 'x' } }))
        .count,
    ).toBe(0);
    await expect(
      B().taxReturnApproval.create({
        data: { businessId: ids.firmB, taxReturnId: r.id, step: 'x', sortOrder: 1 },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(approval(r.id, { assignedUserId: ids.staffB })).rejects.toThrow(/foreign key/i);
    await expect(line(r.id, 'REVIEW', { updatedByUserId: ids.staffB })).rejects.toThrow(
      /foreign key/i,
    );
  });
});

describe('approval steps', () => {
  it('pending has no decision, the rest keep who and when, sending back says why', async () => {
    const r = await newReturn();
    for (const data of [
      { status: 'APPROVED' },
      { status: 'APPROVED', decidedAt: new Date() },
      { decidedAt: new Date(), decidedByUserId: ids.staffA },
      { status: 'RETURNED', ...decided },
      { step: ' ' },
      { step: 'x'.repeat(101) },
    ]) {
      await expect(approval(r.id, data)).rejects.toThrow(/tax_return_approvals_/);
    }
    await expect(
      approval(r.id, { status: 'RETURNED', ...decided, note: 'Check line 8' }),
    ).resolves.toBeTruthy();
  });

  it('the reviewed draft is a document of the return’s client', async () => {
    const r = await newReturn();
    await expect(approval(r.id, { approvedDocumentId: ids.docOfClient2 })).rejects.toThrow(
      /document of the return's client/,
    );
    await expect(approval(r.id, { approvedDocumentId: ids.doc })).resolves.toBeTruthy();
  });

  it('a decided step changes only to invalidated, once, from approved; steps are never deleted', async () => {
    const r = await newReturn();
    const step = await approval(r.id);
    const approved = await A().taxReturnApproval.update({
      where: { id: step.id },
      data: { status: 'APPROVED', ...decided },
    });
    await expect(
      A().taxReturnApproval.update({ where: { id: step.id }, data: { note: 'Changed' } }),
    ).rejects.toThrow(/does not change/);
    await expect(
      A().taxReturnApproval.update({
        where: { id: step.id },
        data: { status: 'PENDING', decidedAt: null, decidedByUserId: null },
      }),
    ).rejects.toThrow(/does not change/);
    await expect(
      A().taxReturnApproval.update({ where: { id: step.id }, data: { status: 'INVALIDATED' } }),
    ).resolves.toMatchObject({ status: 'INVALIDATED', decidedAt: approved.decidedAt });
    await expect(
      A().taxReturnApproval.update({ where: { id: step.id }, data: { status: 'APPROVED' } }),
    ).rejects.toThrow(/does not change/);
    await expect(A().taxReturnApproval.delete({ where: { id: step.id } })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('the lists and the final validation', () => {
  it('the two lists are open or done, the validation has valid, info, warning or error', async () => {
    const r = await newReturn();
    await expect(line(r.id, 'PREPARATION', { result: 'ERROR' })).rejects.toThrow(
      /tax_return_checklist_items_result/,
    );
    await expect(line(r.id, 'VALIDATION', { result: 'DONE' })).rejects.toThrow(
      /tax_return_checklist_items_result/,
    );
    await expect(line(r.id, 'REVIEW', { result: 'DONE' })).resolves.toBeTruthy();
    await expect(line(r.id, 'VALIDATION', { result: 'INFO' })).resolves.toBeTruthy();
    for (const label of [' ', 'x'.repeat(201)]) {
      await expect(line(r.id, 'REVIEW', { label })).rejects.toThrow(
        /tax_return_checklist_items_text/,
      );
    }
  });

  it('only a warning is acknowledged, and a new result needs a new acknowledgment', async () => {
    const r = await newReturn();
    const ack = { acknowledgedAt: new Date(), acknowledgedByUserId: ids.staffA };
    await expect(line(r.id, 'VALIDATION', { result: 'ERROR', ...ack })).rejects.toThrow(
      /tax_return_checklist_items_ack/,
    );
    await expect(
      line(r.id, 'VALIDATION', { result: 'WARNING', acknowledgedAt: new Date() }),
    ).rejects.toThrow(/tax_return_checklist_items_ack/);
    const warning = await line(r.id, 'VALIDATION', { result: 'WARNING', ...ack });
    const fixed = await A().taxReturnChecklistItem.update({
      where: { id: warning.id },
      data: { result: 'VALID' },
    });
    expect(fixed.acknowledgedAt).toBeNull();
    await expect(
      A().taxReturnChecklistItem.update({ where: { id: warning.id }, data: { section: 'REVIEW' } }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      A().taxReturnChecklistItem.delete({ where: { id: warning.id } }),
    ).resolves.toBeTruthy();
  });
});

describe('ready to file', () => {
  it('needs the validation done, with no error and no open warning', async () => {
    const r = await newReturn();
    const warning = await line(r.id, 'VALIDATION', {
      result: 'WARNING',
      label: 'Dependent SSN missing',
    });
    await expect(toReadyToFile(r.id)).rejects.toThrow(/finish the final validation/);
    const validated = { finalValidatedAt: new Date(), finalValidatedByUserId: ids.staffA };
    await expect(toReadyToFile(r.id, validated)).rejects.toThrow(/finish the final validation/);
    await A().taxReturnChecklistItem.update({
      where: { id: warning.id },
      data: { acknowledgedAt: new Date(), acknowledgedByUserId: ids.staffA },
    });
    const error = await line(r.id, 'VALIDATION', { result: 'ERROR', label: 'Math error' });
    await expect(toReadyToFile(r.id)).rejects.toThrow(/finish the final validation/);
    await A().taxReturnChecklistItem.update({ where: { id: error.id }, data: { result: 'VALID' } });
    await expect(toReadyToFile(r.id, validated)).resolves.toMatchObject({
      workflowStatus: 'READY_TO_FILE',
    });
  });

  it('needs every review step approved', async () => {
    const r = await newReturn();
    const first = await approval(r.id);
    await approval(r.id, {
      step: 'Final Review / Approval',
      sortOrder: 2,
      status: 'RETURNED',
      ...decided,
      note: 'No',
    });
    await expect(toReadyToFile(r.id)).rejects.toThrow(/review step must be approved/);
    await A().taxReturnApproval.update({
      where: { id: first.id },
      data: { status: 'APPROVED', ...decided },
    });
    await expect(toReadyToFile(r.id)).rejects.toThrow(/review step must be approved/);
  });

  it('a return without such records is unaffected', async () => {
    const r = await newReturn();
    await expect(toReadyToFile(r.id)).resolves.toBeTruthy();
    await line(r.id, 'PREPARATION');
    const other = await newReturn();
    await line(other.id, 'PREPARATION');
    await expect(toReadyToFile(other.id)).resolves.toBeTruthy();
  });
});
