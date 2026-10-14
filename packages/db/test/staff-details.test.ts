// R35: staff details and security settings. Each firm sees only its own, and the shape rules
// hold. Runs as the app role.
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
const firm = () => db.forBusiness(ids.firmA);
const profile = (data: Record<string, unknown> = {}, membershipId = ids.staff) =>
  firm().staffProfile.create({ data: { businessId: ids.firmA, membershipId, ...data } });
const security = (data: Record<string, unknown>, membershipId = ids.staff) =>
  firm().staffSecuritySettings.create({ data: { businessId: ids.firmA, membershipId, ...data } });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of Object.values(u)) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@s.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `da-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `db-${run}`, name: 'B' } })).id;
  });
  const add = (
    tx: Parameters<Parameters<typeof runInScope>[2]>[0],
    b: string,
    userId: string,
    role: 'OWNER' | 'ADMIN' | 'STAFF',
  ) =>
    tx.membership
      .create({ data: { businessId: b, userId, role, status: 'ACTIVE' } })
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

describe('staff details: isolation', () => {
  it('a firm sees only its own profiles and security settings', async () => {
    await profile({ employeeId: 'A-1' });
    await security({});
    const other = db.forBusiness(ids.firmB);
    expect(await other.staffProfile.findMany()).toEqual([]);
    expect(await other.staffSecuritySettings.findMany()).toEqual([]);
    expect(await firm().staffProfile.count()).toBe(1);
  });

  it("refuses a row for another firm, or one that points at another firm's member", async () => {
    await expect(
      db.forBusiness(ids.firmB).staffProfile.create({
        data: { businessId: ids.firmA, membershipId: ids.other },
      }),
    ).rejects.toThrow();
    await expect(
      firm().staffProfile.create({
        data: { businessId: ids.firmA, membershipId: ids.admin, supervisorId: ids.other },
      }),
    ).rejects.toThrow();
  });
});

describe('staff details: profile rules', () => {
  it('refuses a self supervisor, an end before the start and a bad time zone', async () => {
    const update = (data: Record<string, unknown>) =>
      firm().staffProfile.update({
        where: { businessId_membershipId: { businessId: ids.firmA, membershipId: ids.staff } },
        data,
      });
    await expect(update({ supervisorId: ids.staff })).rejects.toThrow();
    await expect(
      update({ hireDate: new Date('2026-05-02'), endDate: new Date('2026-05-01') }),
    ).rejects.toThrow();
    await expect(update({ timeZone: 'Eastern' })).rejects.toThrow();
    await expect(
      update({ timeZone: 'America/New_York', supervisorId: ids.owner }),
    ).resolves.toBeTruthy();
  });

  it('keeps employee ids unique per firm, ignoring case', async () => {
    await expect(profile({ employeeId: ' a-1 ' }, ids.admin)).rejects.toThrow();
    await expect(profile({ employeeId: 'A-2' }, ids.admin)).resolves.toBeTruthy();
  });

  it('bounds the workload, notes and codes', async () => {
    const update = (data: Record<string, unknown>) =>
      firm().staffProfile.update({
        where: { businessId_membershipId: { businessId: ids.firmA, membershipId: ids.admin } },
        data,
      });
    await expect(update({ maxWorkload: 0 })).rejects.toThrow();
    await expect(update({ maxWorkload: 10_001 })).rejects.toThrow();
    await expect(update({ notes: 'x'.repeat(501) })).rejects.toThrow();
    await expect(update({ notes: 'a note', notesUpdatedAt: new Date() })).rejects.toThrow(); // who?
    await expect(update({ serviceAreas: ['tax prep'] })).rejects.toThrow();
    await expect(update({ serviceAreas: ['PAYROLL', 'PAYROLL'] })).rejects.toThrow();
    await expect(update({ serviceAreas: ['PAYROLL', 'BOOKKEEPING'] })).resolves.toBeTruthy();
  });
});

describe('staff details: security rules', () => {
  const put = (data: Record<string, unknown>) =>
    firm().staffSecuritySettings.update({
      where: { businessId_membershipId: { businessId: ids.firmA, membershipId: ids.staff } },
      data,
    });

  it('bounds the logout time and the session limit', async () => {
    await expect(put({ autoLogoutMinutes: 4 })).rejects.toThrow();
    await expect(put({ autoLogoutMinutes: 481 })).rejects.toThrow();
    await expect(put({ maxConcurrentSessions: 0 })).rejects.toThrow();
    await expect(put({ maxConcurrentSessions: 11 })).rejects.toThrow();
    await expect(put({ autoLogoutMinutes: 30, maxConcurrentSessions: 3 })).resolves.toBeTruthy();
  });

  it('needs at least one sign-in method, each once', async () => {
    await expect(put({ allowedAuthMethods: [] })).rejects.toThrow();
    await expect(put({ allowedAuthMethods: ['SMS', 'SMS'] })).rejects.toThrow();
  });

  it('keeps the location rule and its list together, and checks the list', async () => {
    await expect(put({ accessLocation: 'ALLOWED_IPS' })).rejects.toThrow();
    await expect(put({ allowedIps: ['203.0.113.7'] })).rejects.toThrow(); // location says ANYWHERE
    await expect(
      put({ accessLocation: 'ALLOWED_IPS', allowedIps: ['not an ip'] }),
    ).rejects.toThrow();
    await expect(
      put({ accessLocation: 'ALLOWED_IPS', allowedIps: ['203.0.113.7', '198.51.100.0/24'] }),
    ).resolves.toBeTruthy();
    await expect(
      put({ accessLocation: 'ALLOWED_COUNTRIES', allowedIps: [], allowedCountries: ['us', 'CA'] }),
    ).rejects.toThrow();
    await expect(
      put({ accessLocation: 'ALLOWED_COUNTRIES', allowedIps: [], allowedCountries: ['US', 'CA'] }),
    ).resolves.toBeTruthy();
    await expect(
      put({ accessLocation: 'ANYWHERE', allowedIps: [], allowedCountries: [] }),
    ).resolves.toBeTruthy();
  });

  it('allows a lock reason only while locked, and checks the recovery email', async () => {
    await expect(put({ lockedReason: 'because' })).rejects.toThrow();
    await expect(
      put({ lockedAt: new Date(), lockedReason: 'Too many failed sign-ins' }),
    ).resolves.toBeTruthy();
    await expect(put({ recoveryEmail: 'not an email' })).rejects.toThrow();
    await expect(put({ recoveryEmailVerifiedAt: new Date() })).rejects.toThrow();
    await expect(put({ recoveryEmail: 'me@home.test' })).resolves.toBeTruthy();
  });
});
