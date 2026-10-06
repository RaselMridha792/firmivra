// R0 step 9 rules: each side of a thread is who it claims to be, messages never change except
// their read state, attachments are the thread client's documents, and a client's private notes
// are visible only to that client login acting for itself. Runs as the app role.
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
  staff: randomUUID(),
  formerStaff: randomUUID(),
  login1: randomUUID(),
  login2: randomUUID(),
  client1: '',
  client2: '',
  engagement1: '',
  engagement2: '',
  doc1: '',
  doc2: '',
};

const firmA = () => db.forBusiness(ids.firmA);
const as = (actorUserId: string) => db.forBusiness(ids.firmA, { actorUserId });
const A = () => ({ businessId: ids.firmA });
const newThread = (
  data: { clientId?: string; engagementId?: string; repliesEnabled?: boolean } = {},
) =>
  firmA().messageThread.create({
    data: { ...A(), clientId: data.clientId ?? ids.client1, subject: 'Question', ...data },
  });
const send = (
  threadId: string,
  senderUserId: string,
  direction: 'FIRM_TO_CLIENT' | 'CLIENT_TO_FIRM',
) =>
  firmA().message.create({
    data: { ...A(), threadId, senderUserId, direction, body: 'Hello' },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.staff, 'STAFF'],
      [ids.formerStaff, 'STAFF'],
      [ids.login1, 'CLIENT'],
      [ids.login2, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@m.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `ma-${run}`, name: 'A' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const firm = { businessId: ids.firmA };
    await tx.membership.create({
      data: { ...firm, userId: ids.staff, role: 'STAFF', status: 'ACTIVE' },
    });
    await tx.membership.create({
      data: { ...firm, userId: ids.formerStaff, role: 'STAFF', status: 'DEACTIVATED' },
    });
    const service = await tx.service.create({
      data: { ...firm, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
    });
    const setUp = async (displayName: string, userId: string) => {
      const client = await tx.client.create({ data: { ...firm, displayName } });
      await tx.clientAccount.create({
        data: { ...firm, userId, clientId: client.id, email: `${userId}@m.test`, status: 'ACTIVE' },
      });
      const engagement = await tx.engagement.create({
        data: { ...firm, clientId: client.id, serviceId: service.id, title: '2025' },
      });
      const doc = await tx.document.create({
        data: {
          ...firm,
          clientId: client.id,
          engagementId: engagement.id,
          direction: 'CLIENT_TO_FIRM',
          fileName: 'w2.pdf',
          contentType: 'application/pdf',
          sizeBytes: 10,
          sha256: 'a'.repeat(64),
          s3Key: `tenant/${ids.firmA}/documents/${randomUUID()}`,
        },
      });
      return { client: client.id, engagement: engagement.id, doc: doc.id };
    };
    const one = await setUp('One', ids.login1);
    const two = await setUp('Two', ids.login2);
    Object.assign(ids, {
      client1: one.client,
      engagement1: one.engagement,
      doc1: one.doc,
      client2: two.client,
      engagement2: two.engagement,
      doc2: two.doc,
    });
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('messages', () => {
  it("a client writes only in their own client's threads", async () => {
    const t = await newThread();
    await expect(send(t.id, ids.login1, 'CLIENT_TO_FIRM')).resolves.toMatchObject({
      readAt: null,
    });
    await expect(send(t.id, ids.login2, 'CLIENT_TO_FIRM')).rejects.toThrow(/this thread's client/);
    // A staff member cannot pose as the client side, nor a client as the firm side.
    await expect(send(t.id, ids.staff, 'CLIENT_TO_FIRM')).rejects.toThrow(/this thread's client/);
    await expect(send(t.id, ids.login1, 'FIRM_TO_CLIENT')).rejects.toThrow(/active member/);
  });

  it('the firm side must be an active member; closed threads take no client replies', async () => {
    const t = await newThread({ repliesEnabled: false });
    await expect(send(t.id, ids.formerStaff, 'FIRM_TO_CLIENT')).rejects.toThrow(/active member/);
    await expect(send(t.id, ids.staff, 'FIRM_TO_CLIENT')).resolves.toBeDefined();
    await expect(send(t.id, ids.login1, 'CLIENT_TO_FIRM')).rejects.toThrow(/replies are closed/);
  });

  it('only the read state changes; nothing is deleted', async () => {
    const m = await send((await newThread()).id, ids.staff, 'FIRM_TO_CLIENT');
    await firmA().message.update({ where: { id: m.id }, data: { readAt: new Date() } });
    await expect(
      firmA().message.update({ where: { id: m.id }, data: { readAt: null } }),
    ).resolves.toMatchObject({ readAt: null });
    await expect(
      firmA().message.update({ where: { id: m.id }, data: { body: 'Edited' } }),
    ).rejects.toThrow(/cannot change, only its read state/);
    await expect(firmA().message.deleteMany({ where: { id: m.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('the database keeps last_message_at; the thread keeps its client', async () => {
    const t = await newThread();
    const m = await send(t.id, ids.staff, 'FIRM_TO_CLIENT');
    const after = await firmA().messageThread.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.lastMessageAt).toEqual(m.createdAt);
    await expect(
      firmA().messageThread.update({ where: { id: t.id }, data: { lastMessageAt: new Date() } }),
    ).rejects.toThrow(/set by the database/);
    await expect(
      firmA().messageThread.update({ where: { id: t.id }, data: { clientId: ids.client2 } }),
    ).rejects.toThrow(/cannot change/);
    await expect(newThread({ engagementId: ids.engagement2 })).rejects.toThrow(/foreign key/i);
  });

  it("attachments are documents of the thread's client", async () => {
    const m = await send((await newThread()).id, ids.login1, 'CLIENT_TO_FIRM');
    const attach = (documentId: string) =>
      firmA().messageAttachment.create({ data: { ...A(), messageId: m.id, documentId } });
    await expect(attach(ids.doc2)).rejects.toThrow(/thread's client/);
    await expect(attach(ids.doc1)).resolves.toMatchObject({ documentId: ids.doc1 });
  });
});

describe("a client's private notes", () => {
  const note = (actor: string, userId: string) =>
    as(actor).clientPrivateNote.create({ data: { ...A(), userId, body: 'Gather my 1099s' } });

  it('only the owner, acting for itself, sees or writes them', async () => {
    const n = await note(ids.login1, ids.login1);
    expect((await as(ids.login1).clientPrivateNote.findMany()).map((x) => x.id)).toContain(n.id);
    for (const viewer of [as(ids.login2), as(ids.staff), firmA()]) {
      expect(await viewer.clientPrivateNote.findMany()).toEqual([]);
    }
    // Nobody can write a note for someone else, staff included.
    await expect(note(ids.login2, ids.login1)).rejects.toThrow(/row-level security/i);
    await expect(note(ids.staff, ids.staff)).rejects.toThrow();
  });

  it('a note never changes and is never deleted: each save is a new version', async () => {
    const n = await note(ids.login1, ids.login1);
    await expect(
      as(ids.login1).clientPrivateNote.update({ where: { id: n.id }, data: { body: 'Edited' } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      as(ids.login1).clientPrivateNote.deleteMany({ where: { id: n.id } }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('reminders: set by the owner, re-armed by a new date, sent without reading the note', async () => {
    const n = await note(ids.login1, ids.login1);
    const reminder = { ...A(), noteId: n.id, userId: ids.login1, remindAt: new Date() };
    await expect(firmA().clientNoteReminder.create({ data: reminder })).rejects.toThrow(
      /only the note's owner/,
    );
    const r = await as(ids.login1).clientNoteReminder.create({ data: reminder });

    // The reminder sender works without an actor: it sees the reminder, never the note.
    const due = await firmA().clientNoteReminder.findMany({ where: { id: r.id } });
    expect(due).toHaveLength(1);
    expect(await firmA().clientPrivateNote.findMany({ where: { id: n.id } })).toEqual([]);
    await firmA().clientNoteReminder.update({
      where: { id: r.id },
      data: { remindedAt: new Date() },
    });

    const moved = await as(ids.login1).clientNoteReminder.update({
      where: { id: r.id },
      data: { remindAt: new Date(Date.now() + 86_400_000) },
    });
    expect(moved.remindedAt).toBeNull();
  });

  it('rejects a malformed actor id before touching the database', () => {
    expect(() => db.forBusiness(ids.firmA, { actorUserId: "x' OR 1=1 --" })).toThrow(
      /invalid actor id/i,
    );
  });
});
