// Tasks module, part 2 (R38): checklist items, reminder rules and attachments. Isolation between
// firms, and the rules of migration r38_tasks_parts. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let documentA: string; // a document of firm A's client
let internalA: string; // an INTERNAL one
let documentB: string; // a document of firm B's client
const A = () => db.forBusiness(f.firmA);
const task = (data: Record<string, unknown> = {}) =>
  A().task.create({
    data: { businessId: f.firmA, clientId: f.clientA, title: 'Plan (fake)', ...data },
  });
const item = (taskId: string, data: Record<string, unknown> = {}) =>
  A().taskChecklistItem.create({
    data: { businessId: f.firmA, taskId, label: 'Step (fake)', position: 0, ...data },
  });

/** A document of the client, through its engagement (the owner role, as the seed does). */
async function makeDocument(businessId: string, clientId: string, direction = 'FIRM_TO_CLIENT') {
  return runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: `Tax ${randomUUID()}` },
    });
    const engagement = await tx.engagement.create({
      data: { businessId, clientId, serviceId: service.id, title: '2025 Tax (fake)' },
    });
    const doc = await tx.document.create({
      data: {
        businessId,
        clientId,
        engagementId: engagement.id,
        direction: direction as 'FIRM_TO_CLIENT',
        fileName: 'file.pdf',
        contentType: 'application/pdf',
        sizeBytes: 100,
        sha256: 'a'.repeat(64),
        s3Key: `tenant/${businessId}/documents/${randomUUID()}`,
      },
    });
    return doc.id;
  });
}

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38tp');
  documentA = await makeDocument(f.firmA, f.clientA);
  internalA = await makeDocument(f.firmA, f.clientA, 'INTERNAL');
  documentB = await makeDocument(f.firmB, f.clientB);
});

describe('isolation', () => {
  it("another firm sees none of a task's checklist, reminders or attachments", async () => {
    const t = await task();
    await item(t.id);
    await A().taskReminder.create({ data: { businessId: f.firmA, taskId: t.id, daysBefore: 1 } });
    await A().taskAttachment.create({
      data: { businessId: f.firmA, taskId: t.id, documentId: documentA },
    });
    const B = db.forBusiness(f.firmB);
    expect(await B.taskChecklistItem.findMany()).toEqual([]);
    expect(await B.taskReminder.findMany()).toEqual([]);
    expect(await B.taskAttachment.findMany()).toEqual([]);
    expect(
      await failure(
        B.taskChecklistItem.create({
          data: { businessId: f.firmA, taskId: t.id, label: 'x', position: 0 },
        }),
      ),
    ).toMatch(/row-level security|violates/i);
  });

  it('refuses a checklist assignee from another firm and a document of another firm', async () => {
    const t = await task();
    expect(await failure(item(t.id, { assignedUserId: f.memberB }))).toMatch(/foreign key/i);
    expect(
      await failure(
        A().taskAttachment.create({
          data: { businessId: f.firmA, taskId: t.id, documentId: documentB },
        }),
      ),
    ).toMatch(/foreign key/i);
  });
});

describe('checklist', () => {
  it('keeps the label, position and completion shape', async () => {
    const t = await task();
    for (const data of [
      { label: ' ' },
      { label: 'x'.repeat(301) },
      { position: -1 },
      { completedByUserId: f.memberA },
    ]) {
      expect(await failure(item(t.id, data))).toMatch(/check constraint/i);
    }
    await expect(
      item(t.id, { completedAt: new Date(), completedByUserId: f.memberA }),
    ).resolves.toMatchObject({ required: false });
  });

  it('a task with an open required item cannot be completed', async () => {
    const t = await task();
    const required = await item(t.id, { required: true });
    await item(t.id, { position: 1 }); // optional: never blocks
    const complete = () =>
      A().task.update({ where: { id: t.id }, data: { status: 'DONE', completedAt: new Date() } });
    expect(await failure(complete())).toMatch(/required checklist items/);
    await A().taskChecklistItem.update({
      where: { id: required.id },
      data: { completedAt: new Date() },
    });
    await expect(complete()).resolves.toMatchObject({ status: 'DONE' });
  });

  it('goes with its task when a draft task is deleted, and is never orphaned', async () => {
    const t = await task();
    await item(t.id);
    await A().task.delete({ where: { id: t.id } });
    expect(await A().taskChecklistItem.count({ where: { taskId: t.id } })).toBe(0);
  });
});

describe('reminders', () => {
  it('are 0 to 365 days before, with a channel, and not duplicated', async () => {
    const t = await task();
    const add = (data: Record<string, unknown>) =>
      A().taskReminder.create({
        data: { businessId: f.firmA, taskId: t.id, daysBefore: 7, ...data },
      });
    for (const data of [
      { daysBefore: -1 },
      { daysBefore: 366 },
      { inApp: false },
      { channels: ['EMAIL', 'SMS', 'EMAIL'] },
    ]) {
      expect(await failure(add(data))).toMatch(/check constraint/i);
    }
    await expect(add({ channels: ['EMAIL', 'SMS'] })).resolves.toMatchObject({ inApp: true });
    await expect(add({ inApp: false, channels: ['SMS'], daysBefore: 3 })).resolves.toBeTruthy();
    const nine = new Date('1970-01-01T09:00:00Z');
    await add({ daysBefore: 0, timeOfDay: nine });
    expect(await failure(add({ daysBefore: 0, timeOfDay: nine }))).toMatch(/unique/i);
  });
});

describe('attachments', () => {
  it("must be the task's own client's document", async () => {
    const otherClient = await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.client.create({ data: { businessId: f.firmA, displayName: 'Another (fake)' } }),
    );
    const otherDoc = await makeDocument(f.firmA, otherClient.id);
    const t = await task();
    const attach = (documentId: string, extra: Record<string, unknown> = {}) =>
      A().taskAttachment.create({
        data: { businessId: f.firmA, taskId: t.id, documentId, ...extra },
      });
    expect(await failure(attach(otherDoc))).toMatch(/task client's documents/);
    await expect(attach(documentA)).resolves.toMatchObject({ clientVisible: false });
    expect(await failure(attach(documentA))).toMatch(/unique/i);
  });

  it('an INTERNAL document is never client-visible, at insert or later', async () => {
    const t = await task();
    const attach = (clientVisible: boolean) =>
      A().taskAttachment.create({
        data: { businessId: f.firmA, taskId: t.id, documentId: internalA, clientVisible },
      });
    expect(await failure(attach(true))).toMatch(/never client-visible/);
    const a = await attach(false);
    expect(
      await failure(
        A().taskAttachment.update({ where: { id: a.id }, data: { clientVisible: true } }),
      ),
    ).toMatch(/never client-visible/);
  });

  it('cannot move to another task or document, and goes when its document is deleted', async () => {
    const t = await task();
    const t2 = await task();
    const a = await A().taskAttachment.create({
      data: { businessId: f.firmA, taskId: t.id, documentId: documentA },
    });
    expect(
      await failure(A().taskAttachment.update({ where: { id: a.id }, data: { taskId: t2.id } })),
    ).toMatch(/cannot move/);
    const doc = await makeDocument(f.firmA, f.clientA);
    const b = await A().taskAttachment.create({
      data: { businessId: f.firmA, taskId: t.id, documentId: doc },
    });
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.document.delete({ where: { id: doc } }),
    );
    expect(await A().taskAttachment.findUnique({ where: { id: b.id } })).toBeNull();
  });
});
