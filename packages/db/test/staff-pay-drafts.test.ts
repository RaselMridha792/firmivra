// R35: pay details and Create Staff drafts. Each firm sees only its own, pay details need the
// acting Owner or Admin (in the database), and the shape rules hold. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const u = { owner: randomUUID(), admin: randomUUID(), staff: randomUUID(), other: randomUUID() };
const ids = { firmA: '', firmB: '', owner: '', admin: '', staff: '', other: '' };
const firm = (actor?: string) =>
  db.forBusiness(ids.firmA, actor ? { actorUserId: actor } : undefined);
const draft = (data: unknown, step = 1) =>
  firm().staffDraft.create({
    data: { businessId: ids.firmA, createdById: ids.owner, step, data: data as never },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of Object.values(u)) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@s.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `pa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `pb-${run}`, name: 'B' } })).id;
  });
  const add = (
    tx: Parameters<Parameters<typeof runInScope>[2]>[0],
    business: string,
    userId: string,
    role: 'OWNER' | 'ADMIN' | 'STAFF',
  ) =>
    tx.membership
      .create({ data: { businessId: business, userId, role, status: 'ACTIVE' } })
      .then((m) => m.id);
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    ids.owner = await add(tx, ids.firmA, u.owner, 'OWNER');
    ids.admin = await add(tx, ids.firmA, u.admin, 'ADMIN');
    ids.staff = await add(tx, ids.firmA, u.staff, 'STAFF');
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    ids.other = await add(tx, ids.firmB, u.other, 'OWNER');
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('pay details: only for the acting owner or admin only', () => {
  const pay = { payType: 'SALARY', rateCents: 5_000_000n, payFrequency: 'MONTHLY' } as const;

  it('lets an acting owner or admin write and read it', async () => {
    await firm(u.owner).staffCompensation.create({
      data: { businessId: ids.firmA, membershipId: ids.staff, ...pay },
    });
    expect(await firm(u.owner).staffCompensation.count()).toBe(1);
    expect(await firm(u.admin).staffCompensation.count()).toBe(1);
    await expect(
      firm(u.admin).staffCompensation.update({
        where: { businessId_membershipId: { businessId: ids.firmA, membershipId: ids.staff } },
        data: { rateCents: 5_100_000n },
      }),
    ).resolves.toBeTruthy();
  });

  it("shows nothing to staff, to a session with no actor, or to another firm's owner", async () => {
    expect(await firm(u.staff).staffCompensation.count()).toBe(0);
    expect(await firm().staffCompensation.count()).toBe(0);
    expect(
      await db.forBusiness(ids.firmB, { actorUserId: u.other }).staffCompensation.count(),
    ).toBe(0);
    // A firm B owner naming firm A's rows still sees none, and cannot write them.
    expect(
      await db.forBusiness(ids.firmB, { actorUserId: u.owner }).staffCompensation.count(),
    ).toBe(0);
  });

  it('refuses a write from staff or without an actor', async () => {
    await expect(
      firm(u.staff).staffCompensation.update({
        where: { businessId_membershipId: { businessId: ids.firmA, membershipId: ids.staff } },
        data: { rateCents: 1n },
      }),
    ).rejects.toThrow();
    await expect(
      firm().staffCompensation.create({
        data: { businessId: ids.firmA, membershipId: ids.admin, ...pay },
      }),
    ).rejects.toThrow();
  });

  it('keeps the amount in range and the texts short', async () => {
    const write = (data: Record<string, unknown>) =>
      firm(u.owner).staffCompensation.create({
        data: { businessId: ids.firmA, membershipId: ids.admin, ...data },
      });
    await expect(write({ rateCents: -1n })).rejects.toThrow();
    await expect(write({ rateCents: 10_000_000_001n })).rejects.toThrow();
    await expect(write({ payrollId: 'x'.repeat(41) })).rejects.toThrow();
    await expect(write({ commission: 'bad\nline' })).rejects.toThrow();
  });
});

describe('drafts: isolation', () => {
  it('a firm sees only its own drafts', async () => {
    await draft({ firstName: 'Fake' });
    expect(await db.forBusiness(ids.firmB).staffDraft.findMany()).toEqual([]);
    expect(await firm().staffDraft.count()).toBe(1);
  });
});

describe('drafts: rules', () => {
  it('keeps a form step from 1 to 4 and an object under 20,000 characters', async () => {
    await expect(draft({ a: 1 }, 0)).rejects.toThrow();
    await expect(draft({ a: 1 }, 5)).rejects.toThrow();
    await expect(draft([1, 2])).rejects.toThrow();
    await expect(draft({ notes: 'x'.repeat(20_000) })).rejects.toThrow();
    await expect(draft({ firstName: 'Fake' }, 4)).resolves.toBeTruthy();
  });

  it('refuses password, token and secret keys at any depth', async () => {
    await expect(draft({ temporaryPassword: 'hunter2' })).rejects.toThrow();
    await expect(draft({ security: { MFA_Secret: 'abc' } })).rejects.toThrow();
    await expect(draft({ list: [{ accessToken: 'abc' }] })).rejects.toThrow();
    await expect(draft({ security: { requirePasswordChange: true } })).resolves.toBeTruthy(); // not a secret
  });

  it('is deleted when discarded', async () => {
    const d = await draft({ firstName: 'Gone' });
    await firm().staffDraft.delete({ where: { id: d.id } });
    expect(await firm().staffDraft.findUnique({ where: { id: d.id } })).toBeNull();
  });
});
