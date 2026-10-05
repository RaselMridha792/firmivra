// Prepares the API's own test database (<db>_test_api) with two firms and their people.
import { randomUUID } from 'node:crypto';
import type { TestProject } from 'vitest/node';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { prepareTestDatabase } from '@firmivra/db/testing';

export interface Fixtures {
  appUrl: string;
  firmA: { id: string; slug: string };
  firmB: { id: string; slug: string };
  suspended: { id: string; slug: string };
  users: Record<
    | 'ownerA'
    | 'staffA'
    | 'clientA'
    | 'pendingClientA'
    | 'ownerB'
    | 'clientB'
    | 'ownerSuspended'
    | 'admin',
    { id: string; email: string }
  >;
}

declare module 'vitest' {
  export interface ProvidedContext {
    fixtures: Fixtures;
  }
}

export default async function setup(project: TestProject) {
  const urls = await prepareTestDatabase('test_api');
  const owner = createPrismaClient(urls.owner);

  const people = {
    ownerA: ['STAFF', 'owner-a@a.test'],
    staffA: ['STAFF', 'staff-a@a.test'],
    clientA: ['CLIENT', 'client-a@a.test'],
    pendingClientA: ['CLIENT', 'pending-a@a.test'],
    ownerB: ['STAFF', 'owner-b@b.test'],
    clientB: ['CLIENT', 'client-b@b.test'],
    ownerSuspended: ['STAFF', 'owner-s@s.test'],
    admin: ['ADMIN', 'admin@firmivra.test'],
  } as const;
  const users = Object.fromEntries(
    Object.entries(people).map(([k, [, email]]) => [k, { id: randomUUID(), email }]),
  ) as Fixtures['users'];

  const firms = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, [pool, email]] of Object.entries(people)) {
      const id = users[key as keyof Fixtures['users']].id;
      await tx.user.create({ data: { id, cognitoSub: id, pool, email, name: `Fake ${key}` } });
    }
    await tx.platformAdmin.create({ data: { userId: users.admin.id } });
    const make = (slug: string, status: 'ACTIVE' | 'SUSPENDED') =>
      tx.business.create({ data: { slug, name: slug, status }, select: { id: true, slug: true } });
    return {
      firmA: await make('e2e-firm-a', 'ACTIVE'),
      firmB: await make('e2e-firm-b', 'ACTIVE'),
      suspended: await make('e2e-suspended', 'SUSPENDED'),
    };
  });

  const link = async (
    businessId: string,
    staff: [string, 'OWNER' | 'STAFF'][],
    clients: [string, string, 'ACTIVE' | 'PENDING_APPROVAL'][],
  ) =>
    runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      for (const [userId, role] of staff) {
        await tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } });
      }
      for (const [userId, email, status] of clients) {
        await tx.clientAccount.create({ data: { businessId, userId, email, status } });
      }
    });

  await link(
    firms.firmA.id,
    [
      [users.ownerA.id, 'OWNER'],
      [users.staffA.id, 'STAFF'],
    ],
    [
      [users.clientA.id, users.clientA.email, 'ACTIVE'],
      [users.pendingClientA.id, users.pendingClientA.email, 'PENDING_APPROVAL'],
    ],
  );
  await link(
    firms.firmB.id,
    [[users.ownerB.id, 'OWNER']],
    [[users.clientB.id, users.clientB.email, 'ACTIVE']],
  );
  await link(firms.suspended.id, [[users.ownerSuspended.id, 'OWNER']], []);
  await owner.$disconnect();

  project.provide('fixtures', { appUrl: urls.app, ...firms, users });
}
