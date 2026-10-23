// Task drafts (R1, Oct 24; Octavia's Tasks review A2): a DRAFT task may have no client, a firm
// never sees another firm's drafts, and the rules of migration r1_task_drafts hold. Runs as the
// app role under RLS.
import { randomUUID } from 'node:crypto';
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
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
/** A draft of firm A by member A, without a client unless `data` gives one. */
const draft = (data: Record<string, unknown> = {}) =>
  A().task.create({
    data: {
      businessId: f.firmA,
      status: 'DRAFT',
      createdByUserId: f.memberA,
      title: 'Draft plan (fake)',
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1td');
});

describe('isolation', () => {
  it("another firm never sees, changes or deletes a firm's drafts", async () => {
    const clientless = await draft();
    const withClient = await draft({ clientId: f.clientA });
    expect(await B().task.findMany({ where: { status: 'DRAFT' } })).toEqual([]);
    expect(await B().task.findUnique({ where: { id: clientless.id } })).toBeNull();
    const { count: updated } = await B().task.updateMany({
      where: { id: { in: [clientless.id, withClient.id] } },
      data: { title: 'Taken (fake)' },
    });
    expect(updated).toBe(0);
    const { count: deleted } = await B().task.deleteMany({ where: { id: clientless.id } });
    expect(deleted).toBe(0);
    expect((await A().task.findUnique({ where: { id: clientless.id } }))?.title).toBe(
      'Draft plan (fake)',
    );
  });

  it("a draft cannot be made in another firm or use another firm's client", async () => {
    expect(
      await failure(
        B().task.create({
          data: {
            businessId: f.firmA,
            status: 'DRAFT',
            createdByUserId: f.memberB,
            title: 'Sneaky (fake)',
          },
        }),
      ),
    ).toMatch(/row-level security/i);
    expect(await failure(draft({ clientId: f.clientB }))).toMatch(/foreign key/i);
  });
});

describe('a client unless a draft', () => {
  it('a draft may have no client; any other task needs one', async () => {
    const d = await draft();
    expect(d.clientId).toBeNull();
    for (const status of ['OPEN', 'DONE', 'CANCELLED'] as const) {
      const msg = await failure(
        A().task.create({
          data: {
            businessId: f.firmA,
            status,
            completedAt: status === 'DONE' ? new Date() : null,
            createdByUserId: f.memberA,
            title: 'No client (fake)',
          },
        }),
      );
      expect(msg).toMatch(/tasks_client_unless_draft/);
    }
  });

  it('a clientless draft has its creator and no engagement', async () => {
    expect(await failure(draft({ createdByUserId: null }))).toMatch(/tasks_client_unless_draft/);
    const engagementId = await createEngagement(owner, f.firmA, f.clientA);
    expect(await failure(draft({ engagementId }))).toMatch(/tasks_client_unless_draft/);
    // With its client, a draft keeps the engagement as any task does.
    const d = await draft({ clientId: f.clientA, engagementId });
    expect(d.engagementId).toBe(engagementId);
  });

  it('a draft is a GENERAL task', async () => {
    expect(await failure(draft({ clientId: f.clientA, kind: 'NAME_CHANGE' }))).toMatch(
      /tasks_draft_general/,
    );
  });

  it("a clientless draft takes no deadline and no attachment (they need the task's client)", async () => {
    const deadline = await A().complianceDeadline.create({
      data: {
        businessId: f.firmA,
        clientId: f.clientA,
        name: 'Q4 Estimated Tax (fake)',
        type: 'ESTIMATED_TAX',
        dueOn: new Date('2026-12-15'),
      },
    });
    expect(await failure(draft({ deadlineId: deadline.id }))).toMatch(/deadline's client/);

    const documentId = await runInScope(
      owner,
      { kind: 'business', businessId: f.firmA },
      async (tx) => {
        const service = await tx.service.create({
          data: { businessId: f.firmA, kind: 'ANNUAL_TAX', name: `Tax ${randomUUID()}` },
        });
        const engagement = await tx.engagement.create({
          data: {
            businessId: f.firmA,
            clientId: f.clientA,
            serviceId: service.id,
            title: '2025 Tax (fake)',
          },
        });
        const doc = await tx.document.create({
          data: {
            businessId: f.firmA,
            clientId: f.clientA,
            engagementId: engagement.id,
            direction: 'FIRM_TO_CLIENT',
            fileName: 'file.pdf',
            contentType: 'application/pdf',
            sizeBytes: 100,
            sha256: 'a'.repeat(64),
            s3Key: `tenant/${f.firmA}/documents/${randomUUID()}`,
          },
        });
        return doc.id;
      },
    );
    const d = await draft();
    expect(
      await failure(
        A().taskAttachment.create({ data: { businessId: f.firmA, taskId: d.id, documentId } }),
      ),
    ).toMatch(/task client's documents/);
  });
});

describe('publishing', () => {
  it('a draft is published as OPEN once it has a client', async () => {
    const d = await draft();
    expect(
      await failure(A().task.update({ where: { id: d.id }, data: { status: 'OPEN' } })),
    ).toMatch(/tasks_client_unless_draft/);
    const published = await A().task.update({
      where: { id: d.id },
      data: { clientId: f.clientA, status: 'OPEN' },
    });
    expect(published.status).toBe('OPEN');
  });

  it('a draft only becomes OPEN, and no task goes back to DRAFT', async () => {
    const d = await draft({ clientId: f.clientA });
    for (const data of [
      { status: 'DONE' as const, completedAt: new Date() },
      { status: 'CANCELLED' as const },
    ]) {
      expect(await failure(A().task.update({ where: { id: d.id }, data }))).toMatch(
        /published as OPEN first/,
      );
    }
    // Edits that keep it a draft are fine.
    await A().task.update({ where: { id: d.id }, data: { title: 'Draft, edited (fake)' } });

    const open = await A().task.create({
      data: { businessId: f.firmA, clientId: f.clientA, title: 'Live (fake)' },
    });
    expect(
      await failure(A().task.update({ where: { id: open.id }, data: { status: 'DRAFT' } })),
    ).toMatch(/never goes back to DRAFT/);
    await A().task.update({
      where: { id: open.id },
      data: { status: 'DONE', completedAt: new Date() },
    });
    expect(
      await failure(A().task.update({ where: { id: open.id }, data: { status: 'DRAFT' } })),
    ).toMatch(/never goes back to DRAFT/);
  });

  it('a draft can be deleted (discarded)', async () => {
    const d = await draft();
    await A().task.delete({ where: { id: d.id } });
    expect(await A().task.findUnique({ where: { id: d.id } })).toBeNull();
  });
});
