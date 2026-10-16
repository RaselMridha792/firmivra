// R36 (Messages, r36_message_workspace): the inbox's thread state (owner, archived), mute and tags.
// Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms, expectInvisibleToOtherFirm } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
const u = {
  staff: randomUUID(),
  other: randomUUID(),
  invited: randomUUID(),
  deactivated: randomUUID(),
};
let count = 0;
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const thread = (data: Record<string, unknown> = {}) =>
  firmA().messageThread.create({
    data: { ...A(), clientId: f.client, subject: `Thread ${++count}`, ...data },
  });

beforeAll(async () => {
  f = await createFirms(owner, 'mw');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of Object.values(u)) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@mw.test`, name: 'Fake Staff' },
      });
    }
  });
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    for (const [userId, status] of [
      [u.staff, 'ACTIVE'],
      [u.other, 'ACTIVE'],
      [u.invited, 'INVITED'],
      [u.deactivated, 'DEACTIVATED'],
    ] as const) {
      await tx.membership.create({ data: { ...A(), userId, role: 'STAFF', status } });
    }
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('thread owner and archive', () => {
  it('a thread starts active and unassigned', async () => {
    expect(await thread()).toMatchObject({ assignedUserId: null, archivedAt: null });
  });

  it('is assigned to an active member of the firm, and can be reassigned or cleared', async () => {
    const t = await thread();
    const set = (data: Record<string, unknown>) =>
      firmA().messageThread.update({ where: { id: t.id }, data });
    await expect(set({ assignedUserId: u.staff })).resolves.toMatchObject({
      assignedUserId: u.staff,
    });
    await expect(set({ assignedUserId: u.invited })).rejects.toThrow(/active member/);
    await expect(set({ assignedUserId: u.deactivated })).rejects.toThrow(/active member/);
    await expect(set({ assignedUserId: randomUUID() })).rejects.toThrow(
      /foreign key|active member/i,
    );
    await expect(set({ assignedUserId: u.other })).resolves.toBeTruthy();
    await expect(set({ assignedUserId: null })).resolves.toMatchObject({ assignedUserId: null });
    await expect(thread({ assignedUserId: u.invited })).rejects.toThrow(/active member/);
    // A member deactivated later keeps the threads they had; only a new assignment is refused.
    const kept = await thread({ assignedUserId: u.other });
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.membership.update({
        where: { businessId_userId: { businessId: f.firmA, userId: u.other } },
        data: { status: 'DEACTIVATED' },
      }),
    );
    await expect(
      firmA().messageThread.update({ where: { id: kept.id }, data: { archivedAt: new Date() } }),
    ).resolves.toBeTruthy();
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.membership.update({
        where: { businessId_userId: { businessId: f.firmA, userId: u.other } },
        data: { status: 'ACTIVE' },
      }),
    );
  });

  it('archives and restores with its history kept', async () => {
    const t = await thread();
    await firmA().message.create({
      data: {
        ...A(),
        threadId: t.id,
        senderUserId: u.staff,
        direction: 'FIRM_TO_CLIENT',
        body: 'Hello',
      },
    });
    const archived = await firmA().messageThread.update({
      where: { id: t.id },
      data: { archivedAt: new Date() },
    });
    expect(archived.archivedAt).not.toBeNull();
    await expect(firmA().message.count({ where: { threadId: t.id } })).resolves.toBe(1);
    await expect(
      firmA().messageThread.update({ where: { id: t.id }, data: { archivedAt: null } }),
    ).resolves.toMatchObject({ archivedAt: null });
  });
});

describe('mute', () => {
  it('silences alerts for one member on one thread, until a time or until unmuted', async () => {
    const t = await thread();
    const mute = (userId: string, data: Record<string, unknown> = {}) =>
      firmA().messageThreadMute.create({ data: { ...A(), threadId: t.id, userId, ...data } });
    const forever = await mute(u.staff);
    expect(forever.mutedUntil).toBeNull();
    await expect(mute(u.staff)).rejects.toThrow(/unique/i);
    await expect(
      mute(u.other, { mutedUntil: new Date(Date.now() + 3_600_000) }),
    ).resolves.toBeTruthy();
    await expect(mute(randomUUID())).rejects.toThrow(/foreign key/i);
    await firmA().messageThreadMute.update({
      where: { id: forever.id },
      data: { mutedUntil: new Date(Date.now() + 86_400_000) },
    });
    await firmA().messageThreadMute.delete({ where: { id: forever.id } }); // unmute
    await expect(firmA().messageThreadMute.count({ where: { threadId: t.id } })).resolves.toBe(1);
    // Muting never touches the thread: it still receives messages.
    await expect(
      firmA().message.create({
        data: {
          ...A(),
          threadId: t.id,
          senderUserId: u.staff,
          direction: 'FIRM_TO_CLIENT',
          body: 'Still arrives',
        },
      }),
    ).resolves.toBeTruthy();
  });
});

describe('tags', () => {
  it('are on a thread once, whatever the case, and removable', async () => {
    const t = await thread();
    const tag = (text: string) =>
      firmA().messageThreadTag.create({ data: { ...A(), threadId: t.id, tag: text } });
    const first = await tag('Tax Prep');
    await expect(tag('tax prep')).rejects.toThrow(/unique/i);
    await expect(tag('Individual')).resolves.toBeTruthy();
    await expect(tag('  ')).rejects.toThrow(/check constraint/i);
    await expect(tag('x'.repeat(41))).rejects.toThrow(/check constraint/i);
    await firmA().messageThreadTag.delete({ where: { id: first.id } });
    await expect(tag('tax prep')).resolves.toBeTruthy();
    await expect(firmB().messageThread.findUnique({ where: { id: t.id } })).resolves.toBeNull();
  });
});

describe('isolation between firms', () => {
  it('mutes and tags are invisible to another firm; threads cannot be crossed', async () => {
    const t = await thread();
    await firmA().messageThreadMute.create({ data: { ...A(), threadId: t.id, userId: u.staff } });
    await firmA().messageThreadTag.create({ data: { ...A(), threadId: t.id, tag: 'a' } });
    await runInScope(owner, { kind: 'business', businessId: f.firmB }, async (tx) => {
      const client = await tx.client.create({ data: { businessId: f.firmB, displayName: 'B' } });
      const bt = await tx.messageThread.create({
        data: { businessId: f.firmB, clientId: client.id, subject: 'B' },
      });
      await tx.messageThreadTag.create({
        data: { businessId: f.firmB, threadId: bt.id, tag: 'b' },
      });
    });
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, ['message_thread_tags']);
    const seen = await runInScope(app, { kind: 'business', businessId: f.firmB }, (tx) =>
      tx.$queryRawUnsafe<{ n: number }[]>('SELECT count(*)::int AS n FROM message_thread_mutes'),
    );
    expect(seen[0]?.n).toBe(0);
    await expect(
      firmB().messageThreadTag.create({
        data: { businessId: f.firmB, threadId: t.id, tag: 'sneaky' },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});
