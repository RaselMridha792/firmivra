// R1 step 13: the one-off "link dev users" command. It writes through the app's scopes as the
// owner role, is safe to run again, and a linked staff member is visible only in their firm.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { linkUsers, parseLinkUsers, type LinkUser } from '../src/link-users.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner);
const db = createDatabase(urls.app);

const run = randomUUID().slice(0, 8);
const firm = {
  slug: `link-${run}`,
  name: `Link Firm ${run}`,
  contactEmail: `office-${run}@link.test`,
};
const admin: LinkUser = {
  sub: randomUUID(),
  email: `admin-${run}@link.test`,
  name: 'Fake Admin',
  role: 'SUPER_ADMIN',
};
const staff: LinkUser = {
  sub: randomUUID(),
  email: `staff-${run}@link.test`,
  name: 'Fake Staff',
  role: 'OWNER',
};
let otherFirmId = '';

const platform = () => db.forPlatform();

beforeAll(async () => {
  otherFirmId = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const other = await tx.business.create({
      data: { slug: `link-other-${run}`, name: 'Other', status: 'ACTIVE' },
    });
    return other.id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('parseLinkUsers', () => {
  const entry = { sub: randomUUID(), email: 'a@link.test', name: 'A', role: 'STAFF' };
  const parse = (value: unknown) => () => parseLinkUsers(JSON.stringify(value));

  it('accepts a valid list', () => {
    expect(parseLinkUsers(JSON.stringify([entry]))).toEqual([entry]);
  });

  it('refuses bad input without echoing emails', () => {
    expect(() => parseLinkUsers('not json')).toThrow(/not valid JSON/);
    expect(parse([])).toThrow(/non-empty/);
    expect(parse([{ ...entry, sub: 'nope' }])).toThrow(/\[0\]\.sub/);
    expect(parse([{ ...entry, email: 'Upper@link.test' }])).toThrow(/\[0\]\.email/);
    expect(parse([{ ...entry, name: ' ' }])).toThrow(/\[0\]\.name/);
    expect(parse([{ ...entry, role: 'CLIENT' }])).toThrow(/\[0\]\.role/);
    expect(parse([entry, { ...entry, email: 'b@link.test' }])).toThrow(/same sub twice/);
    expect(parse([{ ...entry, email: 'Upper@link.test' }])).not.toThrow(/Upper@link\.test/);
  });
});

describe('linkUsers', () => {
  it('creates the firm, the users, the Super Admin row and the membership', async () => {
    const result = await linkUsers(owner, firm, [admin, staff]);
    expect(result.businessCreated).toBe(true);
    expect(result.users.map((u) => [u.role, u.created])).toEqual([
      ['SUPER_ADMIN', true],
      ['OWNER', true],
    ]);

    const business = await platform().business.findUniqueOrThrow({ where: { slug: firm.slug } });
    expect(business.status).toBe('ACTIVE');
    const adminRow = await platform().user.findUniqueOrThrow({ where: { cognitoSub: admin.sub } });
    expect(adminRow.pool).toBe('ADMIN');
    expect(await platform().platformAdmin.count({ where: { userId: adminRow.id } })).toBe(1);
    const staffRow = await platform().user.findUniqueOrThrow({ where: { cognitoSub: staff.sub } });
    expect(staffRow.pool).toBe('STAFF');

    const inFirm = db.forBusiness(business.id);
    expect(
      await inFirm.businessSettings.findUnique({ where: { businessId: business.id } }),
    ).toMatchObject({ contactEmail: firm.contactEmail });
    expect(await inFirm.membership.findMany({ where: { businessId: business.id } })).toEqual([
      expect.objectContaining({ userId: staffRow.id, role: 'OWNER', status: 'ACTIVE' }),
    ]);
    expect(
      await inFirm.auditLog.count({
        where: { action: 'dev.membership_linked', businessId: business.id },
      }),
    ).toBe(1);
    expect(
      await platform().auditLog.count({
        where: { action: 'dev.user_linked', entityId: { in: [adminRow.id, staffRow.id] } },
      }),
    ).toBe(2);
  });

  it('is safe to run again and applies a changed staff role', async () => {
    const again = await linkUsers(owner, firm, [admin, { ...staff, role: 'ADMIN' }]);
    expect(again.businessCreated).toBe(false);
    expect(again.users.every((u) => !u.created)).toBe(true);
    expect(
      await platform().user.count({ where: { cognitoSub: { in: [admin.sub, staff.sub] } } }),
    ).toBe(2);
    expect(await platform().business.count({ where: { slug: firm.slug } })).toBe(1);
    const memberships = await db.forBusiness(again.businessId).membership.findMany({
      where: { businessId: again.businessId },
    });
    expect(memberships).toEqual([expect.objectContaining({ role: 'ADMIN', status: 'ACTIVE' })]);
  });

  it('never moves a user to another pool, and writes nothing on that run', async () => {
    const newcomer: LinkUser = { ...staff, sub: randomUUID(), email: `new-${run}@link.test` };
    await expect(linkUsers(owner, firm, [newcomer, { ...admin, role: 'STAFF' }])).rejects.toThrow(
      /pool ADMIN; role STAFF needs pool STAFF/,
    );
    expect(await platform().user.count({ where: { cognitoSub: newcomer.sub } })).toBe(0);
  });

  it('keeps the membership inside its firm', async () => {
    const other = db.forBusiness(otherFirmId);
    expect(await other.membership.count()).toBe(0);
    expect(await other.businessSettings.count()).toBe(0);
  });
});
