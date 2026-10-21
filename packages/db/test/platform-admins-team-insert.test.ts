// R60's Team invitations (Oct 21): the app adds a new team member's platform_admins row
// (TEAM_MEMBER) in platform scope. It can never add a SUPER_ADMIN row, write in any other scope,
// or change or remove an admin row; the owner still adds Super Admins.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const ids = {
  ceo: randomUUID(),
  invited: randomUUID(),
  promoted: randomUUID(),
  fromAdminScope: randomUUID(),
  ownerAdded: randomUUID(),
};

/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
const refused = /row-level security|permission denied/;

const insertAs = (
  scope: Parameters<typeof runInScope>[1],
  userId: string,
  role: 'TEAM_MEMBER' | 'SUPER_ADMIN',
) => runInScope(app, scope, (tx) => tx.platformAdmin.create({ data: { userId, role } }));

beforeAll(async () => {
  // Their ADMIN logins, made by the owner (users are not under test here).
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of Object.values(ids)) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'ADMIN', email: `${id}@team.test`, name: 'Fake Person' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.ceo, role: 'SUPER_ADMIN' } });
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect()]);
});

describe('platform_admins inserts by the app', () => {
  it('adds a TEAM_MEMBER row in platform scope', async () => {
    const row = await insertAs({ kind: 'platform' }, ids.invited, 'TEAM_MEMBER');
    expect(row).toMatchObject({ userId: ids.invited, role: 'TEAM_MEMBER' });
  });

  it('never adds a SUPER_ADMIN row, even in platform scope', async () => {
    expect(await outcome(insertAs({ kind: 'platform' }, ids.promoted, 'SUPER_ADMIN'))).toMatch(
      refused,
    );
  });

  it('adds nothing in admin scope, even for the CEO', async () => {
    expect(
      await outcome(
        insertAs({ kind: 'admin', adminUserId: ids.ceo }, ids.fromAdminScope, 'TEAM_MEMBER'),
      ),
    ).toMatch(refused);
  });

  it('never promotes or removes an admin row', async () => {
    const promote = runInScope(app, { kind: 'platform' }, (tx) =>
      tx.platformAdmin.update({ where: { userId: ids.invited }, data: { role: 'SUPER_ADMIN' } }),
    );
    expect(await outcome(promote)).toMatch(refused);
    const remove = runInScope(app, { kind: 'platform' }, (tx) =>
      tx.platformAdmin.delete({ where: { userId: ids.invited } }),
    );
    expect(await outcome(remove)).toMatch(refused);
  });

  it('leaves the owner free to add a Super Admin', async () => {
    const row = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.platformAdmin.create({ data: { userId: ids.ownerAdded, role: 'SUPER_ADMIN' } }),
    );
    expect(row.role).toBe('SUPER_ADMIN');
  });

  it('keeps only the rows the rules allow', async () => {
    const rows = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.platformAdmin.findMany({
        where: { userId: { in: Object.values(ids) } },
        select: { userId: true, role: true },
      }),
    );
    expect(Object.fromEntries(rows.map((row) => [row.userId, row.role]))).toEqual({
      [ids.ceo]: 'SUPER_ADMIN',
      [ids.invited]: 'TEAM_MEMBER',
      [ids.ownerAdded]: 'SUPER_ADMIN',
    });
  });
});
