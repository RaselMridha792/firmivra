// R1 step 13: the one-off "link dev users" command. Its input holds only subs and roles (emails
// and names come from Cognito), it writes through the app's scopes as the owner role, it is safe
// to run again, and a linked staff member is visible only in their firm.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import {
  linkClientAccount,
  linkUsers,
  parseLinkClient,
  parseLinkUsers,
  resolveLinkUsers,
  type LinkUser,
  type LookupUser,
} from '../src/link-users.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const firm = { slug: `link-${run}`, name: `Link Firm ${run}` };
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
  const entry = { sub: randomUUID(), role: 'STAFF' };
  const parse = (value: unknown) => () => parseLinkUsers(JSON.stringify(value));

  it('accepts subs and roles', () => {
    expect(parseLinkUsers(JSON.stringify([entry]))).toEqual([entry]);
  });

  it('refuses emails and names, so they never reach the task overrides', () => {
    expect(parse([{ ...entry, email: 'a@link.test' }])).toThrow(/only sub and role, not email/);
    expect(parse([{ ...entry, name: 'A' }])).toThrow(/only sub and role, not name/);
    expect(parse([{ ...entry, email: 'a@link.test' }])).not.toThrow(/a@link\.test/);
  });

  it('refuses bad input', () => {
    expect(() => parseLinkUsers('not json')).toThrow(/not valid JSON/);
    expect(parse([])).toThrow(/non-empty/);
    expect(parse(['x'])).toThrow(/\[0\] must be an object/);
    expect(parse([{ ...entry, sub: 'nope' }])).toThrow(/\[0\]\.sub/);
    expect(parse([{ ...entry, role: 'CLIENT' }])).toThrow(/\[0\]\.role/);
    expect(parse([entry, entry])).toThrow(/same sub twice/);
  });
});

describe('resolveLinkUsers', () => {
  const sub = randomUUID();
  const asks: [string, string][] = [];
  const cognito =
    (found: { email?: string; name?: string }): LookupUser =>
    async (pool, s) => {
      asks.push([pool, s]);
      return found;
    };

  it('reads email and name from the pool that matches the role, email in lower case', async () => {
    const users = await resolveLinkUsers(
      [
        { sub, role: 'SUPER_ADMIN' },
        { sub, role: 'STAFF' },
      ],
      cognito({ email: ' Fake.Person@Link.TEST ', name: ' Fake Person ' }),
    );
    expect(asks).toEqual([
      ['ADMIN', sub],
      ['STAFF', sub],
    ]);
    expect(users[0]).toEqual({
      sub,
      role: 'SUPER_ADMIN',
      email: 'fake.person@link.test',
      name: 'Fake Person',
    });
  });

  it('refuses a Cognito user without email or name, naming only the sub', async () => {
    const one = [{ sub, role: 'OWNER' as const }];
    await expect(resolveLinkUsers(one, cognito({ name: 'X' }))).rejects.toThrow(
      `Cognito user ${sub} (STAFF) has no valid email`,
    );
    await expect(resolveLinkUsers(one, cognito({ email: 'x@link.test' }))).rejects.toThrow(
      /has no name attribute/,
    );
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
    expect(adminRow).toMatchObject({ pool: 'ADMIN', email: admin.email, name: admin.name });
    expect(await platform().platformAdmin.count({ where: { userId: adminRow.id } })).toBe(1);
    const staffRow = await platform().user.findUniqueOrThrow({ where: { cognitoSub: staff.sub } });
    expect(staffRow.pool).toBe('STAFF');

    const inFirm = db.forBusiness(business.id);
    // Contact details come from the setup wizard, not from this command.
    expect(
      await inFirm.businessSettings.findUnique({ where: { businessId: business.id } }),
    ).toMatchObject({ contactEmail: null });
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
    // The firm's only owner cannot be demoted (R0: a firm keeps an active owner).
    await expect(linkUsers(owner, firm, [admin, { ...staff, role: 'ADMIN' }])).rejects.toThrow(
      /LAST_ACTIVE_OWNER/,
    );

    // With another owner linked first, the change applies.
    const newOwner: LinkUser = { ...staff, sub: randomUUID(), email: `owner-${run}@link.test` };
    const again = await linkUsers(owner, firm, [admin, newOwner, { ...staff, role: 'ADMIN' }]);
    expect(again.businessCreated).toBe(false);
    expect(again.users.map((u) => u.created)).toEqual([false, true, false]);
    expect(
      await platform().user.count({ where: { cognitoSub: { in: [admin.sub, staff.sub] } } }),
    ).toBe(2);
    expect(await platform().business.count({ where: { slug: firm.slug } })).toBe(1);
    const memberships = await db.forBusiness(again.businessId).membership.findMany({
      where: { businessId: again.businessId },
    });
    expect(memberships.map((m) => m.role).sort()).toEqual(['ADMIN', 'OWNER']);
    expect(memberships.every((m) => m.status === 'ACTIVE')).toBe(true);
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

// Client mode: a seeded demo client gets a real clients-pool login (Rasel, Oct 18, demo only).
describe('parseLinkClient', () => {
  const entry = { sub: randomUUID(), firmSlug: 'demo', accountEmail: 'harper.coleman@demo.test' };
  const parse = (value: unknown) => () => parseLinkClient(JSON.stringify(value));

  it('accepts the sub, the demo firm and a seeded address, in lower case', () => {
    expect(
      parseLinkClient(JSON.stringify({ ...entry, accountEmail: ' Harper.Coleman@Demo.TEST ' })),
    ).toEqual(entry);
  });

  it('refuses another firm, a real address and any other key', () => {
    expect(parse({ ...entry, firmSlug: 'lvp' })).toThrow(/firmSlug must be demo/);
    expect(parse({ ...entry, firmSlug: 'demo-north' })).toThrow(/firmSlug must be demo/);
    expect(parse({ ...entry, accountEmail: 'someone@example.com' })).toThrow(/seeded @demo\.test/);
    expect(parse({ ...entry, name: 'Harper' })).toThrow(/not name/);
    expect(parse({ ...entry, sub: 'nope' })).toThrow(/sub must be a UUID/);
    expect(() => parseLinkClient('[]')).toThrow(/must be an object/);
  });
});

describe('linkClientAccount', () => {
  const accountEmail = `harper.coleman.${run}@demo.test`;
  const firms = { a: '', b: '' };
  const seeded = { a: { userId: '', sub: '' }, b: { userId: '', sub: '' } };
  const slugs = { a: `link-demo-${run}`, b: `link-demo-other-${run}` };

  beforeAll(async () => {
    for (const key of ['a', 'b'] as const) {
      const sub = `seed-${key}-${randomUUID()}`;
      const ids = await runInScope(owner, { kind: 'platform' }, async (tx) => {
        const business = await tx.business.create({
          data: { slug: slugs[key], name: `Demo ${key}`, status: 'ACTIVE' },
        });
        const user = await tx.user.create({
          data: { cognitoSub: sub, pool: 'CLIENT', email: accountEmail, name: 'Fake Harper' },
        });
        return { businessId: business.id, userId: user.id };
      });
      firms[key] = ids.businessId;
      seeded[key] = { userId: ids.userId, sub };
      // The same seeded email in both firms: only firm A's account may change.
      await runInScope(owner, { kind: 'business', businessId: ids.businessId }, (tx) =>
        tx.clientAccount.create({
          data: {
            businessId: ids.businessId,
            userId: ids.userId,
            email: accountEmail,
            status: 'ACTIVE',
          },
        }),
      );
    }
  });

  const userOf = (key: 'a' | 'b') =>
    platform().user.findUniqueOrThrow({ where: { id: seeded[key].userId } });

  it('gives firm A account its new login, and leaves the same email in firm B alone', async () => {
    const sub = randomUUID();
    const result = await linkClientAccount(owner, { sub, firmSlug: slugs.a, accountEmail });
    expect(result).toMatchObject({ businessId: firms.a, userId: seeded.a.userId, changed: true });
    expect((await userOf('a')).cognitoSub).toBe(sub);
    expect((await userOf('b')).cognitoSub).toBe(seeded.b.sub);

    const inA = db.forBusiness(firms.a);
    expect(
      await inA.auditLog.findMany({
        where: { businessId: firms.a, action: 'dev.client_login_linked' },
        select: { entityId: true, metadata: true },
      }),
    ).toEqual([{ entityId: result.clientAccountId, metadata: { userId: seeded.a.userId } }]);
    expect(
      await db.forBusiness(firms.b).auditLog.count({
        where: { businessId: firms.b, action: 'dev.client_login_linked' },
      }),
    ).toBe(0);
    // The account itself is unchanged: the same user, so every row it owns stays with it.
    expect(
      await inA.clientAccount.findUniqueOrThrow({ where: { id: result.clientAccountId } }),
    ).toMatchObject({ userId: seeded.a.userId, email: accountEmail, status: 'ACTIVE' });

    // Again: nothing to do.
    expect(await linkClientAccount(owner, { sub, firmSlug: slugs.a, accountEmail })).toMatchObject({
      changed: false,
    });
  });

  it('refuses a missing firm, no matching account, and a sub that is already someone else', async () => {
    const sub = randomUUID();
    await expect(
      linkClientAccount(owner, { sub, firmSlug: `missing-${run}`, accountEmail }),
    ).rejects.toThrow(/not found/);
    await expect(
      linkClientAccount(owner, {
        sub,
        firmSlug: slugs.a,
        accountEmail: `nobody.${run}@demo.test`,
      }),
    ).rejects.toThrow(/has 0 client accounts with that email; expected 1/);
    // Firm B's seeded sub belongs to firm B's user: firm A's account cannot take it.
    const before = (await userOf('a')).cognitoSub;
    await expect(
      linkClientAccount(owner, { sub: seeded.b.sub, firmSlug: slugs.a, accountEmail }),
    ).rejects.toThrow(`is already linked to user ${seeded.b.userId}`);
    expect((await userOf('a')).cognitoSub).toBe(before);
    expect((await userOf('b')).cognitoSub).toBe(seeded.b.sub);
  });
});
