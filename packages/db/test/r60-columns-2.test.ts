// R60's column requests 7 to 11 (R1, Oct 24): firm licenses (only the admin or platform scope
// writes them, the firm reads its own), a verified staff phone, the work start date and the
// firm's saved work schedules. A firm never sees another firm's rows, and the rules hold. Runs as
// the app role under RLS. (Request 8, the staff email data fix, changes rows only once, in its
// migration; it was checked by hand on a seeded database.)
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const superAdmin = randomUUID();
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const admin = () => db.forAdmin(superAdmin);

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1rc');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: superAdmin,
        cognitoSub: superAdmin,
        pool: 'ADMIN',
        email: `${superAdmin}@r1rc.test`,
        name: 'Fake Admin',
      },
    });
    await tx.platformAdmin.create({ data: { userId: superAdmin } });
  });
});

const license = (businessId: string, data: Record<string, unknown> = {}) => ({
  businessId,
  regulatoryBody: 'State Board of Accountancy (fake)',
  licenseType: 'CPA Firm Permit',
  licenseNumber: `FAKE-${randomUUID().slice(0, 8)}`,
  ...data,
});

describe('firm licenses (request 7)', () => {
  it('a Super Admin or the platform writes them; the firm reads only its own', async () => {
    const a = await admin().firmLicense.create({
      data: license(f.firmA, { verifiedByUserId: superAdmin, verifiedAt: new Date() }),
    });
    expect(a.status).toBe('ACTIVE');
    await db.forPlatform().firmLicense.create({ data: license(f.firmA) });
    expect((await A().firmLicense.findMany()).length).toBe(2);
    expect(await B().firmLicense.findMany()).toEqual([]);
    expect((await admin().firmLicense.findMany({ where: { businessId: f.firmA } })).length).toBe(2);
    await admin().firmLicense.update({ where: { id: a.id }, data: { status: 'SUSPENDED' } });
    expect((await A().firmLicense.findUnique({ where: { id: a.id } }))?.status).toBe('SUSPENDED');
  });

  it('a firm cannot add, change or verify a license, its own or another firm’s', async () => {
    expect(await failure(A().firmLicense.create({ data: license(f.firmA) }))).toMatch(
      /row-level security/i,
    );
    expect(await failure(B().firmLicense.create({ data: license(f.firmA) }))).toMatch(
      /row-level security/i,
    );
    const own = await admin().firmLicense.create({ data: license(f.firmA) });
    const { count } = await A().firmLicense.updateMany({
      where: { id: own.id },
      data: { verifiedByUserId: superAdmin, verifiedAt: new Date() },
    });
    expect(count).toBe(0);
    expect(
      (await admin().firmLicense.findUnique({ where: { id: own.id } }))?.verifiedAt,
    ).toBeNull();
  });

  it('is never deleted, keeps its texts tidy, and is verified by a Super Admin, with a time', async () => {
    const one = await admin().firmLicense.create({ data: license(f.firmA) });
    expect(await failure(admin().firmLicense.delete({ where: { id: one.id } }))).toMatch(
      /permission denied/i,
    );
    for (const data of [
      { regulatoryBody: '' },
      { regulatoryBody: ' Padded ' },
      { regulatoryBody: 'x'.repeat(121) },
      { licenseType: 'x'.repeat(81) },
      { licenseNumber: 'x'.repeat(61) },
      { licenseNumber: 'A\u0007B' },
      { verifiedByUserId: superAdmin },
      { verifiedAt: new Date() },
    ]) {
      expect(await failure(admin().firmLicense.create({ data: license(f.firmA, data) }))).toMatch(
        /firm_licenses_values/,
      );
    }
    // Only a platform admin verifies: a firm member is not one.
    expect(
      await failure(
        admin().firmLicense.create({
          data: license(f.firmA, { verifiedByUserId: f.memberA, verifiedAt: new Date() }),
        }),
      ),
    ).toMatch(/foreign key/i);
  });
});

describe('a verified staff phone (request 9)', () => {
  const user = (data: Record<string, unknown>) =>
    db.forPlatform().user.update({ where: { id: f.memberA }, data });

  it('a new number is no longer verified, unless the same change verifies it', async () => {
    const at = new Date('2026-10-24T10:00:00.000Z');
    expect((await user({ phone: '+15555550101', phoneVerifiedAt: at })).phoneVerifiedAt).toEqual(
      at,
    );
    // Another change keeps it.
    expect((await user({ name: 'Fake Person Renamed' })).phoneVerifiedAt).toEqual(at);
    // The same number saved again keeps it.
    expect((await user({ phone: '+15555550101' })).phoneVerifiedAt).toEqual(at);
    // A new number clears it.
    expect((await user({ phone: '+15555550102' })).phoneVerifiedAt).toBeNull();
    // A new number verified as it is saved keeps the new time.
    const later = new Date('2026-10-24T11:00:00.000Z');
    expect((await user({ phone: '+15555550103', phoneVerifiedAt: later })).phoneVerifiedAt).toEqual(
      later,
    );
    // Removing the number clears it too.
    expect((await user({ phone: null })).phoneVerifiedAt).toBeNull();
  });

  it('is never set without a number', async () => {
    await user({ phone: null });
    expect(await failure(user({ phoneVerifiedAt: new Date() }))).toMatch(/users_phone_verified/);
  });
});

describe('the work start date (request 10)', () => {
  it('is kept on the staff record, apart from the hire date, and stays in the firm', async () => {
    const membership = await A().membership.findFirstOrThrow({ where: { userId: f.member2A } });
    const profile = await A().staffProfile.create({
      data: {
        businessId: f.firmA,
        membershipId: membership.id,
        hireDate: new Date('2026-09-01'),
        workStartDate: new Date('2026-09-15'),
      },
    });
    expect(profile.workStartDate).toEqual(new Date('2026-09-15'));
    expect(profile.hireDate).toEqual(new Date('2026-09-01'));
    expect(await B().staffProfile.findMany({ where: { membershipId: membership.id } })).toEqual([]);
  });
});

describe('saved work schedules (request 11)', () => {
  it("another firm never sees or changes a firm's schedules", async () => {
    const s = await A().staffWorkSchedule.create({
      data: { businessId: f.firmA, name: 'Mon to Fri 9-5', createdByUserId: f.memberA },
    });
    expect(await B().staffWorkSchedule.findMany()).toEqual([]);
    const { count } = await B().staffWorkSchedule.updateMany({
      where: { id: s.id },
      data: { name: 'Taken' },
    });
    expect(count).toBe(0);
    expect(
      await failure(
        B().staffWorkSchedule.create({ data: { businessId: f.firmA, name: 'Sneaky' } }),
      ),
    ).toMatch(/row-level security/i);
    expect(
      await failure(
        A().staffWorkSchedule.create({
          data: { businessId: f.firmA, name: 'Nights', createdByUserId: f.memberB },
        }),
      ),
    ).toMatch(/foreign key/i);
  });

  it('are trimmed, 1 to 80 characters, unique ignoring case while active, and never deleted', async () => {
    for (const name of ['', ' Padded ', 'x'.repeat(81)]) {
      expect(
        await failure(A().staffWorkSchedule.create({ data: { businessId: f.firmA, name } })),
      ).toMatch(/staff_work_schedules_name/);
    }
    const first = await A().staffWorkSchedule.create({
      data: { businessId: f.firmA, name: 'Weekends' },
    });
    expect(
      await failure(
        A().staffWorkSchedule.create({ data: { businessId: f.firmA, name: 'weekends' } }),
      ),
    ).toMatch(/unique/i);
    await B().staffWorkSchedule.create({ data: { businessId: f.firmB, name: 'Weekends' } });
    await A().staffWorkSchedule.update({
      where: { id: first.id },
      data: { archivedAt: new Date() },
    });
    await A().staffWorkSchedule.create({ data: { businessId: f.firmA, name: 'WEEKENDS' } });
    expect(await failure(A().staffWorkSchedule.delete({ where: { id: first.id } }))).toMatch(
      /permission denied/i,
    );
  });
});
