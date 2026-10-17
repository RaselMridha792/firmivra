// R0, PART 1 follow-up (Oct 17): bootstrap-platform-org seeds the plan ladder and the
// department/role catalog, and maps every existing SUPER_ADMIN to a CEO-level platform_members
// row -- the three things the regular seed covers but never runs on dev. Runs against its own,
// isolated test database (not the shared `dbUrls` every other file in this suite uses): the
// function reads every SUPER_ADMIN platform_admins row in the database, and several other files
// create their own SUPER_ADMIN rows for unrelated tests, so sharing a database here would race.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { prepareTestDatabase, TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { bootstrapPlatformOrg, mapSuperAdminsToCeo } from '../prisma/bootstrap-platform-org.js';

let owner: ReturnType<typeof createPrismaClient>;

const admin1 = randomUUID();
const admin2 = randomUUID();

beforeAll(async () => {
  const urls = await prepareTestDatabase('bootstrap_platform_org');
  owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, email] of [
      [admin1, 'ceo1@sup.test'],
      [admin2, 'ceo2@sup.test'],
    ] as const) {
      await tx.user.create({ data: { id, cognitoSub: id, pool: 'ADMIN', email, name: 'Fake' } });
      await tx.platformAdmin.create({ data: { userId: id, role: 'SUPER_ADMIN' } });
    }
  });
  // Building its own database takes a while next to the rest of the suite.
}, 300_000);

afterAll(async () => {
  await owner?.$disconnect();
});

const mappedIn = (rows: { userId: string }[] | undefined) =>
  rows?.map((r) => r.userId).sort() ?? [];

describe('bootstrap-platform-org', () => {
  it('seeds the plan ladder, the department/role catalog, and maps every SUPER_ADMIN to CEO', async () => {
    const mapped = await bootstrapPlatformOrg(owner);
    expect(mappedIn(mapped)).toEqual([admin1, admin2].sort());
    expect(mapped.find((m) => m.userId === admin1)?.email).toBe('ceo1@sup.test');
    expect(mapped.find((m) => m.userId === admin2)?.email).toBe('ceo2@sup.test');

    const [plans, depts, roles, members] = await runInScope(owner, { kind: 'platform' }, (tx) =>
      Promise.all([
        tx.platformPlan.count(),
        tx.platformDepartment.count(),
        tx.platformRoleDefinition.count(),
        tx.platformMember.findMany({ where: { userId: { in: [admin1, admin2] } } }),
      ]),
    );
    expect(plans).toBe(6);
    expect(depts).toBe(13);
    expect(roles).toBeGreaterThan(0);
    expect(members).toHaveLength(2);
    for (const m of members) {
      expect(m.scopeType).toBe('COMPANY');
      expect(m.status).toBe('ACTIVE');
    }
  });

  it('running it twice changes nothing', async () => {
    const snapshot = () =>
      runInScope(owner, { kind: 'platform' }, (tx) =>
        Promise.all([
          tx.platformPlan.count(),
          tx.platformDepartment.count(),
          tx.platformRoleDefinition.count(),
          tx.platformMember.findMany({
            where: { userId: { in: [admin1, admin2] } },
            orderBy: { userId: 'asc' },
          }),
          tx.auditLog.count({ where: { actorUserId: { in: [admin1, admin2] } } }),
        ]),
      );

    const before = await snapshot();
    const mapped = await bootstrapPlatformOrg(owner);
    expect(mappedIn(mapped)).toEqual([admin1, admin2].sort());
    const after = await snapshot();

    expect(after).toEqual(before); // same counts, and the same createdAt/updatedAt on each row
  });

  it('is a no-op when there is no SUPER_ADMIN yet', async () => {
    const urls = await prepareTestDatabase('bootstrap_platform_org_empty');
    const empty = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
    try {
      await expect(mapSuperAdminsToCeo(empty)).resolves.toEqual([]);
    } finally {
      await empty.$disconnect();
    }
  });
});
