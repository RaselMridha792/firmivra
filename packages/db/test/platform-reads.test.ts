// What the Super Admin pages read that firm scope writes (R4), setup Step 2's business details
// (T02) and the order of a client's tax-year history (R10). Runs as the app role.
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  admin: randomUUID(),
  ownerA: randomUUID(),
  staffA: randomUUID(),
  firmA: '',
  ownerMembership: '',
  staffMembership: '',
};

const admin = () => db.forAdmin(ids.admin);
const platform = () => db.forPlatform();
const firmA = () => db.forBusiness(ids.firmA);
const hash = () => randomBytes(32);
const application = (extra: object = {}) => ({
  legalName: 'Applicant LLC (fake)',
  contactName: 'Applicant',
  contactEmail: `apply-${randomUUID()}@pr.test`,
  data: {},
  ...extra,
});
const newUser = (pool: 'STAFF' | 'CLIENT' | 'ADMIN', id = randomUUID()) =>
  platform().user.create({
    data: { id, cognitoSub: id, pool, email: `${id}@pr.test`, name: 'Fake' },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.admin, 'ADMIN'],
      [ids.ownerA, 'STAFF'],
      [ids.staffA, 'STAFF'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@pr.test`, name: 'Fake' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.admin } });
    ids.firmA = (await tx.business.create({ data: { slug: `pra-${run}`, name: 'Firm A' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const firm = { businessId: ids.firmA };
    ids.ownerMembership = (
      await tx.membership.create({
        data: { ...firm, userId: ids.ownerA, role: 'OWNER', status: 'INVITED' },
      })
    ).id;
    ids.staffMembership = (
      await tx.membership.create({
        data: { ...firm, userId: ids.staffA, role: 'STAFF', status: 'INVITED' },
      })
    ).id;
    await tx.businessSettings.create({ data: firm });
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('firm applications: the EIN, never in full', () => {
  it('keeps the last 4 digits and a 32-byte keyed hash, together; never an "ein" in data', async () => {
    const ok = await platform().firmApplication.create({
      data: application({ einLast4: '6789', einHash: hash() }),
    });
    expect(ok.einLast4).toBe('6789');
    for (const extra of [
      { einLast4: '6789' },
      { einHash: hash() },
      { einLast4: '678', einHash: hash() },
      { einLast4: '6789', einHash: randomBytes(16) },
      { data: { ein: '12-3456789' } },
      { data: { business: { ein: '123456789' } } },
    ]) {
      await expect(
        platform().firmApplication.create({ data: application(extra) }),
      ).rejects.toThrow();
    }
  });

  it('two applications may share an EIN hash (the duplicate check reads it); a review never changes it', async () => {
    const same = hash();
    const first = await platform().firmApplication.create({
      data: application({ einLast4: '1111', einHash: same }),
    });
    await platform().firmApplication.create({
      data: application({ einLast4: '1111', einHash: same }),
    });
    expect(await admin().firmApplication.count({ where: { einHash: same } })).toBe(2);
    await expect(
      admin().firmApplication.update({ where: { id: first.id }, data: { einLast4: '2222' } }),
    ).rejects.toThrow(/platform scope/);
  });
});

describe('firms: activated_at', () => {
  it('is set the first time a firm is ACTIVE and never changes', async () => {
    const created = await platform().business.create({
      data: { slug: `prb-${run}`, name: 'Firm B' },
    });
    expect(created.activatedAt).toBeNull();
    const active = await platform().business.update({
      where: { id: created.id },
      data: { status: 'ACTIVE' },
    });
    expect(active.activatedAt).toBeInstanceOf(Date);
    await platform().business.update({ where: { id: created.id }, data: { status: 'SUSPENDED' } });
    const again = await platform().business.update({
      where: { id: created.id },
      data: { status: 'ACTIVE' },
    });
    expect(again.activatedAt).toEqual(active.activatedAt);
    await expect(
      platform().business.update({ where: { id: created.id }, data: { activatedAt: new Date() } }),
    ).rejects.toThrow(/set by the database/);
    expect((await admin().business.findUnique({ where: { id: created.id } }))?.activatedAt).toEqual(
      active.activatedAt,
    );
  });

  it('a firm created ACTIVE gets it; nobody sends their own', async () => {
    const born = await platform().business.create({
      data: { slug: `prc-${run}`, name: 'Firm C', status: 'ACTIVE' },
    });
    expect(born.activatedAt).toBeInstanceOf(Date);
    await expect(
      platform().business.create({
        data: { slug: `prd-${run}`, name: 'Firm D', activatedAt: new Date() },
      }),
    ).rejects.toThrow(/set by the database/);
  });
});

describe('owner invites: the Super Admin reads activation links, nothing else', () => {
  it('reads the platform-sent owner invite of any firm, not staff invites; never writes', async () => {
    const at = { businessId: ids.firmA };
    const ownerInvite = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.invite.create({
        data: {
          ...at,
          membershipId: ids.ownerMembership,
          tokenHash: randomBytes(32).toString('hex'),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      }),
    );
    await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.invite.create({
        data: {
          ...at,
          membershipId: ids.staffMembership,
          tokenHash: randomBytes(32).toString('hex'),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          invitedByUserId: ids.ownerA,
        },
      }),
    );
    const seen = await admin().invite.findMany({ where: { businessId: ids.firmA } });
    expect(seen.map((i) => i.id)).toEqual([ownerInvite.id]);
    const changed = await admin().invite.updateMany({
      where: { id: ownerInvite.id },
      data: { revokedAt: new Date() },
    });
    expect(changed.count).toBe(0);
    expect(await firmA().invite.count()).toBe(2);
  });
});

describe('dashboard: staff and client logins per day', () => {
  const today = async () => {
    const rows = await admin().platformUserSignups.findMany();
    const sum = (pool: string) =>
      rows.filter((r) => r.pool === pool).reduce((n, r) => n + r.users, 0);
    return { staff: sum('STAFF'), client: sum('CLIENT'), pools: new Set(rows.map((r) => r.pool)) };
  };

  it('counts new staff and client logins, not admins; a removed client login counts down', async () => {
    const before = await today();
    await newUser('STAFF');
    const client = await newUser('CLIENT');
    await newUser('ADMIN');
    const after = await today();
    expect([after.staff - before.staff, after.client - before.client]).toEqual([1, 1]);
    expect(after.pools.has('ADMIN')).toBe(false);
    await platform().user.delete({ where: { id: client.id } });
    expect((await today()).client).toBe(before.client);
  });

  it('only the admin reads it, and nobody writes it outside the trigger', async () => {
    expect(await firmA().platformUserSignups.count()).toBe(0);
    expect(await platform().platformUserSignups.count()).toBe(0);
    const day = new Date('2026-01-01T00:00:00.000Z');
    for (const client of [platform(), firmA(), admin()]) {
      await expect(
        client.platformUserSignups.create({ data: { day, pool: 'STAFF', users: 99 } }),
      ).rejects.toThrow();
      const bumped = await client.platformUserSignups.updateMany({ data: { users: 99 } });
      expect(bumped.count).toBe(0);
    }
  });
});

describe('setup Step 2: business details', () => {
  const set = (data: object) =>
    firmA().businessSettings.update({ where: { businessId: ids.firmA }, data });

  it('the firm saves entity type, team size, services, description and its EIN (ciphertext)', async () => {
    const saved = await set({
      entityType: 'S_CORP',
      teamSize: 'SIZE_2_5',
      services: ['Tax preparation', 'Bookkeeping'],
      description: 'A small firm.\nTwo lines.',
      einEnc: randomBytes(48),
      einLast4: '4321',
    });
    expect(saved).toMatchObject({ entityType: 'S_CORP', teamSize: 'SIZE_2_5', einLast4: '4321' });
  });

  it('refuses a half EIN, bad services and a blank or long description', async () => {
    for (const data of [
      { einLast4: null },
      { einEnc: null },
      { einLast4: '12345' },
      { services: Array.from({ length: 21 }, (_, i) => `Service ${i}`) },
      { services: ['x'.repeat(61)] },
      { services: [' Padded'] },
      { services: [''] },
      { services: ['Tax', 'tax'] },
      { services: ['Line\nbreak'] },
      { description: '   ' },
      { description: 'x'.repeat(2001) },
      { description: 'bell \u0007' },
    ]) {
      await expect(set(data)).rejects.toThrow();
    }
  });
});

describe('tax-year history order', () => {
  it('seq follows the order rows were written in, so the newest is the current state', async () => {
    const firm = { businessId: ids.firmA };
    const { rows, a, b } = await runInScope(
      owner,
      { kind: 'business', businessId: ids.firmA },
      async (tx) => {
        const client = await tx.client.create({ data: { ...firm, displayName: 'Order (fake)' } });
        const a = await tx.taxStatus.create({ data: { ...firm, name: `First ${run}` } });
        const b = await tx.taxStatus.create({ data: { ...firm, name: `Second ${run}` } });
        const key = { businessId: ids.firmA, clientId: client.id, taxYear: 2025 };
        // One transaction: now() would be the same for every row, so only seq tells them apart.
        await tx.clientTaxStatus.create({ data: { ...key, taxStatusId: a.id } });
        for (const status of [b, a, b]) {
          await tx.clientTaxStatus.update({
            where: { businessId_clientId_taxYear: key },
            data: { taxStatusId: status.id },
          });
        }
        const rows = await tx.clientTaxStatusHistory.findMany({
          where: key,
          orderBy: { seq: 'desc' },
        });
        return { rows, a: a.id, b: b.id };
      },
    );
    expect(rows.map((r) => r.taxStatusId)).toEqual([b, a, b, a]);
  });
});
