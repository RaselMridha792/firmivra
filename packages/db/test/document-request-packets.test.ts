// R37, Documents: requests (packets) with a checklist, and the firm's request types. The
// database numbers a request, stamps each step, freezes it when sent and keeps its items to the
// draft. Runs as the app role.
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
  engagement: '',
  engagement2: '',
  category: '',
  engagementB: '',
  clientB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);
const days = (d: number) => new Date(Date.now() + d * 86_400_000);

type Packet = Partial<{
  engagementId: string;
  recipientKind: 'CLIENT' | 'MEMBER';
  recipientUserId: string;
  title: string;
  status: 'DRAFT' | 'OPEN' | 'SUBMITTED' | 'COMPLETED' | 'CANCELLED';
  dueOn: Date;
  messageSubject: string;
  messageBody: string;
  reminderDaysBefore: number;
  expiresAt: Date;
  assignedUserId: string;
  number: number;
}>;
const sendable = { dueOn: days(10), messageSubject: 'Documents please', messageBody: 'Hello' };
const newPacket = (data: Packet = {}) =>
  A().documentRequestPacket.create({
    data: {
      businessId: ids.firmA,
      clientId: ids.client,
      engagementId: ids.engagement,
      title: '2025 Personal Tax documents',
      ...data,
    },
  });
const newItem = (packetId: string | null, data: Record<string, unknown> = {}) =>
  A().documentRequest.create({
    data: {
      businessId: ids.firmA,
      clientId: ids.client,
      engagementId: ids.engagement,
      title: 'W-2',
      ...(packetId ? { packetId } : {}),
      ...data,
    },
  });
const setStatus = (id: string, status: Packet['status'], data: Packet = {}) =>
  A().documentRequestPacket.update({ where: { id }, data: { status, ...data } });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@dr.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `dra-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `drb-${run}`, name: 'B' } })).id;
  });
  const setup = (businessId: string, userId: string) =>
    runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      await tx.membership.create({ data: { businessId, userId, role: 'OWNER', status: 'ACTIVE' } });
      const client = await tx.client.create({ data: { businessId, displayName: 'Client (fake)' } });
      const service = await tx.service.create({
        data: { businessId, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
      });
      const engagement = await tx.engagement.create({
        data: { businessId, clientId: client.id, serviceId: service.id, title: '2025' },
      });
      const second = await tx.engagement.create({
        data: { businessId, clientId: client.id, serviceId: service.id, title: '2024' },
      });
      const category = await tx.documentCategory.create({ data: { businessId, name: 'Income' } });
      return {
        client: client.id,
        engagement: engagement.id,
        second: second.id,
        category: category.id,
      };
    });
  const a = await setup(ids.firmA, ids.staffA);
  Object.assign(ids, {
    client: a.client,
    engagement: a.engagement,
    engagement2: a.second,
    category: a.category,
  });
  const b = await setup(ids.firmB, ids.staffB);
  Object.assign(ids, { clientB: b.client, engagementB: b.engagement, categoryB: b.category });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows or changes another firm's requests", async () => {
    const packet = await newPacket();
    expect(await B().documentRequestPacket.findUnique({ where: { id: packet.id } })).toBeNull();
    expect(
      (
        await B().documentRequestPacket.updateMany({
          where: { id: packet.id },
          data: { title: 'x' },
        })
      ).count,
    ).toBe(0);
    await expect(
      B().documentRequestPacket.create({
        data: {
          businessId: ids.firmA,
          clientId: ids.client,
          engagementId: ids.engagement,
          title: 'x',
        },
      }),
    ).rejects.toThrow(/row-level security/i);
    // Firm B's own request naming firm A's engagement or member: the same-firm foreign keys.
    await expect(
      B().documentRequestPacket.create({
        data: {
          businessId: ids.firmB,
          clientId: ids.client,
          engagementId: ids.engagement,
          title: 'x',
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    for (const data of [
      { assignedUserId: ids.staffA },
      { recipientKind: 'MEMBER' as const, recipientUserId: ids.staffA },
    ]) {
      await expect(
        B().documentRequestPacket.create({
          data: {
            businessId: ids.firmB,
            clientId: ids.clientB,
            engagementId: ids.engagementB,
            title: 'x',
            ...data,
          },
        }),
      ).rejects.toThrow(/foreign key/i);
    }
  });
});

describe('the request', () => {
  it('is numbered by the database, in order, per firm', async () => {
    const one = await newPacket({ number: 99 });
    const two = await newPacket();
    expect(two.number).toBe(one.number + 1);
    expect(one.number).not.toBe(99);
    await expect(
      A().documentRequestPacket.update({ where: { id: two.id }, data: { number: 1 } }),
    ).rejects.toThrow(/cannot change/);
    const other = await B().documentRequestPacket.create({
      data: {
        businessId: ids.firmB,
        clientId: ids.clientB,
        engagementId: ids.engagementB,
        title: 'B',
      },
    });
    expect(other.number).toBe(1);
  });

  it('a member recipient is named, a client recipient is not; sent needs a due date and message', async () => {
    await expect(newPacket({ recipientKind: 'MEMBER' })).rejects.toThrow(/_recipient/);
    await expect(newPacket({ recipientUserId: ids.staffA })).rejects.toThrow(/_recipient/);
    await expect(
      newPacket({ recipientKind: 'MEMBER', recipientUserId: ids.staffA }),
    ).resolves.toBeTruthy();
    await expect(newPacket({ status: 'OPEN' })).rejects.toThrow(/_sent/);
    await expect(newPacket({ status: 'OPEN', ...sendable })).resolves.toMatchObject({
      status: 'OPEN',
    });
  });

  it('keeps text, reminder and expiry in range', async () => {
    for (const data of [
      { title: ' ' },
      { title: 'x'.repeat(201) },
      { messageSubject: 'a\nb' },
      { messageBody: 'x'.repeat(1001) },
      { reminderDaysBefore: 0 },
      { reminderDaysBefore: 31 },
      { dueOn: days(5), expiresAt: days(3) },
    ]) {
      await expect(newPacket(data)).rejects.toThrow(/document_request_packets_/);
    }
    await expect(
      newPacket({ dueOn: days(5), expiresAt: days(20), reminderDaysBefore: 3 }),
    ).resolves.toBeTruthy();
  });

  it('is stamped by the database at each step and moves forward only', async () => {
    const packet = await newPacket(sendable);
    expect(packet.sentAt).toBeNull();
    const open = await setStatus(packet.id, 'OPEN');
    expect(open.sentAt).not.toBeNull();
    const submitted = await setStatus(packet.id, 'SUBMITTED');
    expect(submitted.submittedAt).not.toBeNull();
    // Returned to the client, then completed; a caller's own timestamps are ignored.
    await setStatus(packet.id, 'OPEN');
    const done = await setStatus(packet.id, 'COMPLETED', {});
    expect(done.completedAt).not.toBeNull();
    expect(done.sentAt).toEqual(open.sentAt);
    for (const to of ['OPEN', 'DRAFT', 'CANCELLED'] as const) {
      await expect(setStatus(packet.id, to)).rejects.toThrow(/cannot go from COMPLETED/);
    }
    const draft = await newPacket();
    await expect(setStatus(draft.id, 'SUBMITTED')).rejects.toThrow(/cannot go from DRAFT/);
    const cancelled = await setStatus(draft.id, 'CANCELLED');
    expect(cancelled).toMatchObject({ sentAt: null });
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it('is frozen when sent, except the due date, assignee, reminder and expiry', async () => {
    const packet = await newPacket({ status: 'OPEN', ...sendable });
    for (const data of [
      { title: 'New title' },
      { messageBody: 'Changed' },
      { notifySms: true },
      { allowMultipleFiles: false },
    ]) {
      await expect(
        A().documentRequestPacket.update({ where: { id: packet.id }, data }),
      ).rejects.toThrow(/keeps its title, message/);
    }
    await expect(
      A().documentRequestPacket.update({
        where: { id: packet.id },
        data: {
          dueOn: days(20),
          assignedUserId: ids.staffA,
          reminderDaysBefore: 2,
          expiresAt: days(40),
        },
      }),
    ).resolves.toBeTruthy();
    await expect(
      A().documentRequestPacket.update({
        where: { id: packet.id },
        data: { engagementId: ids.engagement2 },
      }),
    ).rejects.toThrow(/cannot change/);
    await expect(A().documentRequestPacket.delete({ where: { id: packet.id } })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('items', () => {
  it('belong to a request of the same engagement and change only while it is a draft', async () => {
    const packet = await newPacket(sendable);
    const item = await newItem(packet.id, {
      required: false,
      sortOrder: 2,
      categoryId: ids.category,
    });
    expect(item).toMatchObject({ packetId: packet.id, required: false, sortOrder: 2 });
    await expect(newItem(packet.id, { engagementId: ids.engagement2 })).rejects.toThrow(
      /foreign key/i,
    );
    await setStatus(packet.id, 'OPEN');
    await expect(newItem(packet.id)).rejects.toThrow(/change only while it is a draft/);
    await expect(
      A().documentRequest.update({ where: { id: item.id }, data: { required: true } }),
    ).rejects.toThrow(/change only while it is a draft/);
    await expect(
      A().documentRequest.update({ where: { id: item.id }, data: { packetId: null } }),
    ).rejects.toThrow(/change only while it is a draft/);
    // The item's own workflow is untouched: the firm can still accept or reject it.
    await expect(
      A().documentRequest.update({
        where: { id: item.id },
        data: { status: 'REJECTED', statusNote: 'Blurry' },
      }),
    ).resolves.toMatchObject({ status: 'REJECTED' });
  });

  it('a single request made on its own still works', async () => {
    await expect(newItem(null)).resolves.toMatchObject({ packetId: null, required: true });
  });
});
