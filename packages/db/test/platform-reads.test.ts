// What the Super Admin pages read that firm scope writes (R4), setup Step 2's business details
// (T02), encrypted columns and the order of a client's tax-year history (R10). Runs as the app
// role.
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
/** Bytes shaped like the field-encryption helper's output (version 1, local mode, no key). */
const sealedLike = () => Buffer.concat([Buffer.from([1, 1, 0, 0]), randomBytes(40)]);
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
const asOwner = <T>(fn: Parameters<typeof runInScope<T>>[2], businessId = ids.firmA) =>
  runInScope(owner, { kind: 'business', businessId }, fn);

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
  await asOwner(async (tx) => {
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
  it('keeps the last 4 digits and a 32-byte keyed hash, together; nothing EIN-like in data', async () => {
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
      { data: { EIN: '123456789' } },
      { data: { business: { einLast4: '6789' } } },
      { data: { credentials: [{ Ein_Hash: 'x' }] } },
    ]) {
      await expect(
        platform().firmApplication.create({ data: application(extra) }),
        JSON.stringify(extra),
      ).rejects.toThrow();
    }
    // Other keys are fine, even ones that merely contain "ein".
    await expect(
      platform().firmApplication.create({ data: application({ data: { protein: 1 } }) }),
    ).resolves.toBeDefined();
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
  it('is set the first time a firm is ACTIVE (Finish, platform or Super Admin) and never changes', async () => {
    const created = await platform().business.create({
      data: { slug: `prb-${run}`, name: 'Firm B' },
    });
    expect(created.activatedAt).toBeNull();
    // Setup Finish: the firm moves itself to ACTIVE once setup is done.
    await asOwner(
      (tx) =>
        tx.businessSettings.create({
          data: { businessId: created.id, setupCompletedAt: new Date() },
        }),
      created.id,
    );
    const finished = await db
      .forBusiness(created.id)
      .business.update({ where: { id: created.id }, data: { status: 'ACTIVE' } });
    expect(finished.activatedAt).toBeInstanceOf(Date);
    expect(finished.activatedAt!.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime());
    // The Super Admin suspends and reactivates: the first time stays.
    await admin().business.update({ where: { id: created.id }, data: { status: 'SUSPENDED' } });
    const again = await admin().business.update({
      where: { id: created.id },
      data: { status: 'ACTIVE' },
    });
    expect(again.activatedAt).toEqual(finished.activatedAt);
    await expect(
      platform().business.update({ where: { id: created.id }, data: { activatedAt: new Date() } }),
    ).rejects.toThrow(/set by the database/);
    expect((await admin().business.findUnique({ where: { id: created.id } }))?.activatedAt).toEqual(
      finished.activatedAt,
    );
  });

  it('a firm created ACTIVE gets it, never before its creation time; nobody sends their own', async () => {
    const born = await platform().business.create({
      data: { slug: `prc-${run}`, name: 'Firm C', status: 'ACTIVE' },
    });
    expect(born.activatedAt!.getTime()).toBeGreaterThanOrEqual(born.createdAt.getTime());
    await expect(
      platform().business.create({
        data: { slug: `prd-${run}`, name: 'Firm D', activatedAt: new Date() },
      }),
    ).rejects.toThrow(/set by the database/);
  });
});

describe("owner invites: Firmivra's activation links, without the token", () => {
  const invite = (extra: object = {}) => ({
    businessId: ids.firmA,
    membershipId: ids.ownerMembership,
    tokenHash: randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    ...extra,
  });

  it('the database marks an invite the platform sends; the Super Admin reads a copy without the token', async () => {
    const sent = await platform().invite.create({ data: invite() });
    expect(sent.sentByPlatform).toBe(true);
    const copies = await admin().platformOwnerInvite.findMany({
      where: { businessId: ids.firmA },
    });
    expect(copies).toEqual([
      expect.objectContaining({
        inviteId: sent.id,
        membershipId: ids.ownerMembership,
        sentAt: sent.createdAt,
        expiresAt: sent.expiresAt,
        acceptedAt: null,
      }),
    ]);
    expect(Object.keys(copies[0]!)).not.toContain('tokenHash');
    // The Super Admin never reads invites themselves.
    expect(await admin().invite.count()).toBe(0);
    // Accepting it (the activation, in the firm's scope) shows in the copy.
    await firmA().invite.update({ where: { id: sent.id }, data: { acceptedAt: new Date() } });
    const after = await admin().platformOwnerInvite.findUniqueOrThrow({
      where: { inviteId: sent.id },
    });
    expect(after.acceptedAt).toBeInstanceOf(Date);
  });

  it("a firm's own invites are never marked, even an OWNER's with no inviter", async () => {
    const own = await firmA().invite.create({ data: invite({ sentByPlatform: true }) });
    expect(own.sentByPlatform).toBe(false);
    await firmA().invite.create({
      data: invite({ membershipId: ids.staffMembership, invitedByUserId: ids.ownerA }),
    });
    const copies = await admin().platformOwnerInvite.findMany({ where: { inviteId: own.id } });
    expect(copies).toEqual([]);
    await expect(
      firmA().invite.update({ where: { id: own.id }, data: { sentByPlatform: true } }),
    ).rejects.toThrow(/set by the database/);
  });

  it('platform scope sends only links with no inviter, and reads only its own', async () => {
    await expect(
      platform().invite.create({ data: invite({ invitedByUserId: ids.ownerA }) }),
    ).rejects.toThrow();
    const all = await platform().invite.findMany({ where: { businessId: ids.firmA } });
    expect(all.every((i) => i.sentByPlatform)).toBe(true);
  });

  it('nobody writes the copies directly', async () => {
    const data = {
      inviteId: randomUUID(),
      businessId: ids.firmA,
      sentAt: new Date(),
      expiresAt: new Date(),
    };
    for (const client of [platform(), firmA(), admin()]) {
      await expect(client.platformOwnerInvite.create({ data })).rejects.toThrow();
    }
  });
});

describe('platform admins: names in decisions', () => {
  it("reads other platform admins' user rows, also after they leave; never staff or clients", async () => {
    const other = await newUser('ADMIN');
    const gone = await newUser('ADMIN');
    // Super Admins are added outside the app (platform scope only reads them).
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      await tx.platformAdmin.create({ data: { userId: other.id } });
      // A former Super Admin who decided an application keeps their name on it.
      await tx.firmApplication.create({
        data: { ...application(), reviewedByUserId: gone.id, reviewedAt: new Date() },
      });
    });
    const staff = await newUser('STAFF');
    const client = await newUser('CLIENT');
    // A staff login listed as an admin by mistake is still not an admin login.
    const listedStaff = await newUser('STAFF');
    await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.platformAdmin.create({ data: { userId: listedStaff.id } }),
    );
    const seen = await admin().user.findMany({
      where: { id: { in: [other.id, gone.id, staff.id, client.id, listedStaff.id] } },
      select: { id: true },
    });
    expect(seen.map((u) => u.id).sort()).toEqual([other.id, gone.id].sort());
  });
});

describe('dashboard: staff and client logins per day', () => {
  // Other test files add users at the same time, so compare the counts with the users table in
  // one statement (one snapshot), as the owner, rather than before and after.
  const counted = async () => {
    const [row] = await owner.$queryRaw<
      { staff: number; client: number; admin: number; staffUsers: number; clientUsers: number }[]
    >`SELECT
        (SELECT coalesce(sum(users), 0)::int FROM platform_user_signups WHERE pool = 'STAFF') AS staff,
        (SELECT coalesce(sum(users), 0)::int FROM platform_user_signups WHERE pool = 'CLIENT') AS client,
        (SELECT count(*)::int FROM platform_user_signups WHERE pool = 'ADMIN') AS admin,
        (SELECT count(*)::int FROM users WHERE pool = 'STAFF') AS "staffUsers",
        (SELECT count(*)::int FROM users WHERE pool = 'CLIENT') AS "clientUsers"`;
    return row!;
  };

  it('counts every staff and client login, never admins; a removed client login counts down', async () => {
    await newUser('STAFF');
    const client = await newUser('CLIENT');
    await newUser('ADMIN');
    const after = await counted();
    expect([after.staff, after.client, after.admin]).toEqual([
      after.staffUsers,
      after.clientUsers,
      0,
    ]);
    expect(after.client).toBeGreaterThan(0);
    await platform().user.delete({ where: { id: client.id } });
    const removed = await counted();
    expect([removed.staff, removed.client]).toEqual([removed.staffUsers, removed.clientUsers]);
    expect(await admin().platformUserSignups.count()).toBeGreaterThan(0);
  });

  it('only the admin reads it; the app writes nothing there, and a login keeps its day', async () => {
    expect(await firmA().platformUserSignups.count()).toBe(0);
    expect(await platform().platformUserSignups.count()).toBe(0);
    const day = new Date('2026-01-01T00:00:00.000Z');
    for (const client of [platform(), firmA(), admin()]) {
      await expect(
        client.platformUserSignups.create({ data: { day, pool: 'STAFF', users: 99 } }),
      ).rejects.toThrow();
      await expect(
        client.platformUserSignups.updateMany({ data: { users: 99 } }),
      ).rejects.toThrow();
    }
    const login = await newUser('STAFF');
    await expect(
      platform().user.update({ where: { id: login.id }, data: { createdAt: day } }),
    ).rejects.toThrow(/creation time of a login never changes/);
  });
});

describe('setup Step 2: business details', () => {
  const set = (data: object) =>
    firmA().businessSettings.update({ where: { businessId: ids.firmA }, data });

  it('the firm saves the application codes, team size, description and its EIN (ciphertext)', async () => {
    const saved = await set({
      entityType: 'S_CORP',
      teamSize: 4,
      services: ['TAX_PREPARATION', 'BOOKKEEPING'],
      description: 'A small firm.\nTwo lines.',
      einEnc: sealedLike(),
      einLast4: '4321',
    });
    expect(saved).toMatchObject({
      entityType: 'S_CORP',
      teamSize: 4,
      services: ['TAX_PREPARATION', 'BOOKKEEPING'],
      einLast4: '4321',
    });
  });

  it('refuses a half or plain EIN, anything but codes, a bad team size and an empty or long description', async () => {
    for (const data of [
      { einLast4: null },
      { einEnc: null },
      { einLast4: '12345' },
      { einEnc: Buffer.from('123456789'), einLast4: '6789' },
      { einEnc: randomBytes(48), einLast4: '6789' },
      { entityType: 'S-Corp' },
      { entityType: 'A'.repeat(41) },
      { teamSize: 0 },
      { teamSize: 10_001 },
      { services: Array.from({ length: 21 }, (_, i) => `SERVICE_${i}`) },
      { services: ['Tax preparation'] },
      { services: ['PAYROLL', 'PAYROLL'] },
      { services: [''] },
      { description: '   ' },
      { description: '\n\t\n' },
      { description: 'x'.repeat(2001) },
      { description: 'bell \u0007' },
      { description: 'c1 \u0085 control' },
    ]) {
      await expect(set(data), JSON.stringify(data)).rejects.toThrow();
    }
    await expect(
      asOwner(
        (tx) =>
          tx.$executeRaw`UPDATE business_settings SET services = '{{PAYROLL,BOOKKEEPING}}'
                         WHERE business_id = ${ids.firmA}::uuid`,
      ),
    ).rejects.toThrow(/business_settings_services/);
  });

  it('only the firm reads them: never the Super Admin, the platform or a signed-in user', async () => {
    expect(await admin().businessSettings.count()).toBe(0);
    expect(await platform().businessSettings.count()).toBe(0);
    expect(await db.forUser(ids.ownerA).businessSettings.count()).toBe(0);
    expect(await firmA().businessSettings.count()).toBe(1);
  });
});

describe('encrypted client columns', () => {
  it("hold only the helper's ciphertext, never plain bytes", async () => {
    const clientId = await asOwner(async (tx) => {
      const c = await tx.client.create({
        data: { businessId: ids.firmA, displayName: 'Sealed (fake)' },
      });
      await tx.clientProfile.create({ data: { businessId: ids.firmA, clientId: c.id } });
      return c.id;
    });
    const profile = (data: object) => firmA().clientProfile.update({ where: { clientId }, data });
    await expect(profile({ ssnEnc: sealedLike(), ssnLast4: '6789' })).resolves.toBeDefined();
    for (const data of [
      { ssnEnc: Buffer.from('900123456') },
      { einEnc: Buffer.from([1, 9, 0, 0, ...randomBytes(40)]) },
      { dobEnc: Buffer.from([1, 1, 1, 0, ...randomBytes(40)]) },
    ]) {
      await expect(profile(data), JSON.stringify(Object.keys(data))).rejects.toThrow();
    }
  });
});

describe('tax-year history', () => {
  it('seq follows the order rows were written in, so the newest is the current state', async () => {
    const firm = { businessId: ids.firmA };
    const { rows, a, b } = await asOwner(async (tx) => {
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
    });
    expect(rows.map((r) => r.taxStatusId)).toEqual([b, a, b, a]);
  });

  it('only the trigger writes it: the app adds no row of its own', async () => {
    const [history] = await asOwner((tx) => tx.clientTaxStatusHistory.findMany({ take: 1 }));
    await expect(
      firmA().clientTaxStatusHistory.create({
        data: {
          businessId: ids.firmA,
          clientId: history!.clientId,
          taxYear: history!.taxYear,
          taxStatusId: history!.taxStatusId,
          seq: 999_999,
        },
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});
