// R0 step 7 rules: notifications go only to people of the firm and name their record; after
// insert only read_at changes; deliveries follow their status rules; preferences belong to
// someone in the firm and never cover ACCOUNT notices. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner);
const db = createDatabase(urls.app);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  staffA: randomUUID(),
  clientA: randomUUID(),
  staffB: randomUUID(),
  stranger: randomUUID(),
};

const firmA = () => db.forBusiness(ids.firmA);
const notify = (recipientUserId: string, data: { type?: string; payload?: object } = {}) =>
  firmA().notification.create({
    data: {
      businessId: ids.firmA,
      recipientUserId,
      category: 'DOCUMENTS',
      type: data.type ?? 'document_request.created',
      entityType: 'document_request',
      entityId: randomUUID(),
      payload: data.payload ?? { dueOn: '2026-10-31' },
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.staffA, 'STAFF'],
      [ids.clientA, 'CLIENT'],
      [ids.staffB, 'STAFF'],
      [ids.stranger, 'STAFF'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@n.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `na-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `nb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmA, userId: ids.staffA, role: 'STAFF', status: 'ACTIVE' },
    });
    await tx.clientAccount.create({
      data: { businessId: ids.firmA, userId: ids.clientA, email: `${ids.clientA}@n.test` },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, (tx) =>
    tx.membership.create({
      data: { businessId: ids.firmB, userId: ids.staffB, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('notifications', () => {
  it("go to the firm's staff and clients, never to anyone else", async () => {
    await expect(notify(ids.staffA)).resolves.toMatchObject({ readAt: null });
    await expect(notify(ids.clientA)).resolves.toMatchObject({ readAt: null });
    for (const outsider of [ids.staffB, ids.stranger]) {
      await expect(notify(outsider)).rejects.toThrow(/member or client of the firm/);
    }
  });

  it('can be marked read and unread; nothing else changes; never deleted', async () => {
    const n = await notify(ids.clientA);
    await firmA().notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
    await expect(
      firmA().notification.update({ where: { id: n.id }, data: { readAt: null } }),
    ).resolves.toMatchObject({ readAt: null });
    for (const data of [
      { type: 'document_request.changed' },
      { entityId: randomUUID() },
      { payload: { dueOn: '2027-01-01' } },
      { recipientUserId: ids.staffA },
    ]) {
      await expect(firmA().notification.update({ where: { id: n.id }, data })).rejects.toThrow(
        /only read_at can change/,
      );
    }
    await expect(firmA().notification.deleteMany({ where: { id: n.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('use a dotted type key and a small flat payload', async () => {
    await expect(notify(ids.staffA, { type: 'Document Request Created' })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(notify(ids.staffA, { payload: { note: 'x'.repeat(3000) } })).rejects.toThrow(
      /check constraint/i,
    );
  });
});

describe('deliveries', () => {
  const deliver = (notificationId: string, data: object = {}) =>
    firmA().notificationDelivery.create({
      data: { businessId: ids.firmA, notificationId, channel: 'EMAIL', ...data },
    });

  it('start queued or skipped, one per channel', async () => {
    const n = await notify(ids.clientA);
    await expect(deliver(n.id, { status: 'SENT', sentAt: new Date() })).rejects.toThrow(
      /starts QUEUED or SKIPPED/,
    );
    await deliver(n.id);
    await expect(deliver(n.id)).rejects.toThrow(/unique constraint/i);
    await expect(deliver(n.id, { channel: 'SMS', status: 'SKIPPED' })).resolves.toMatchObject({
      status: 'SKIPPED',
    });
  });

  it('retry from FAILED; SENT is final and needs sent_at; attempts only go up', async () => {
    const n = await notify(ids.clientA);
    const d = await deliver(n.id);
    const update = (data: object) =>
      firmA().notificationDelivery.update({ where: { id: d.id }, data });
    await update({ status: 'FAILED', attempts: 1, lastError: 'Throttling' });
    await update({ status: 'QUEUED' });
    await expect(update({ status: 'SENT' })).rejects.toThrow(/check constraint/i);
    await update({ status: 'SENT', attempts: 2, sentAt: new Date(), providerMessageId: 'ses-1' });
    await expect(update({ status: 'QUEUED', sentAt: null })).rejects.toThrow(/final/);
    await expect(update({ attempts: 1 })).rejects.toThrow(/only go up/);
  });
});

describe('preferences', () => {
  const prefer = (userId: string, category: 'DOCUMENTS' | 'MESSAGES' | 'ACCOUNT') =>
    firmA().notificationPreference.create({
      data: { businessId: ids.firmA, userId, category, sms: true },
    });

  it('belong to someone in the firm, once per category, and never for ACCOUNT', async () => {
    await expect(prefer(ids.clientA, 'DOCUMENTS')).resolves.toMatchObject({
      email: true,
      sms: true,
    });
    await expect(prefer(ids.clientA, 'DOCUMENTS')).rejects.toThrow(/unique constraint/i);
    await expect(prefer(ids.staffB, 'DOCUMENTS')).rejects.toThrow(/member or client of the firm/);
    await expect(prefer(ids.staffA, 'ACCOUNT')).rejects.toThrow(/check constraint/i);
  });

  it('can be switched or deleted (back to defaults), not moved to someone else', async () => {
    const p = await prefer(ids.staffA, 'MESSAGES');
    await expect(
      firmA().notificationPreference.update({ where: { id: p.id }, data: { email: false } }),
    ).resolves.toMatchObject({ email: false });
    await expect(
      firmA().notificationPreference.update({
        where: { id: p.id },
        data: { userId: ids.clientA },
      }),
    ).rejects.toThrow(/cannot change/);
    expect((await firmA().notificationPreference.deleteMany({ where: { id: p.id } })).count).toBe(
      1,
    );
  });
});
