// R36 (Client portal tab, r36_messages_portal_branding): per-client portal visibility, lock, the
// activity feed and recent clients. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
const staff = randomUUID();
const ids = { other: '', account: '', otherAccount: '', clientB: '' };
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);

beforeAll(async () => {
  f = await createFirms(owner, 'pt');
  const loginUser = randomUUID();
  const otherUser = randomUUID();
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [staff, 'STAFF'],
      [loginUser, 'CLIENT'],
      [otherUser, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@pt.test`, name: 'Fake Person' },
      });
    }
  });
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    await tx.membership.create({
      data: { ...A(), userId: staff, role: 'STAFF', status: 'ACTIVE' },
    });
    ids.other = (await tx.client.create({ data: { ...A(), displayName: 'Other' } })).id;
    ids.account = (
      await tx.clientAccount.create({
        data: {
          ...A(),
          userId: loginUser,
          clientId: f.client,
          email: `${loginUser}@pt.test`,
          status: 'ACTIVE',
        },
      })
    ).id;
    ids.otherAccount = (
      await tx.clientAccount.create({
        data: {
          ...A(),
          userId: otherUser,
          clientId: ids.other,
          email: `${otherUser}@pt.test`,
          status: 'ACTIVE',
        },
      })
    ).id;
  });
  ids.clientB = (
    await runInScope(owner, { kind: 'business', businessId: f.firmB }, (tx) =>
      tx.client.create({ data: { businessId: f.firmB, displayName: 'B' } }),
    )
  ).id;
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('portal module visibility', () => {
  const vis = (data: Record<string, unknown>) =>
    firmA().portalModuleVisibility.create({
      data: { ...A(), module: 'REPORTS', visible: false, ...data },
    });

  it("is the firm's default or a client's own override, one row per module in each", async () => {
    await expect(vis({})).resolves.toMatchObject({ clientId: null, visible: false });
    await expect(vis({ visible: true })).rejects.toThrow(/unique/i);
    await expect(vis({ module: 'DOCUMENTS', visible: true })).resolves.toBeTruthy();
    await expect(
      vis({ clientId: f.client, visible: true, changedByUserId: staff }),
    ).resolves.toBeTruthy();
    await expect(vis({ clientId: f.client })).rejects.toThrow(/unique/i);
    await expect(vis({ clientId: ids.other })).resolves.toBeTruthy();
  });

  it('changes by update and returns to the default by deleting the override', async () => {
    const row = await vis({ clientId: f.client, module: 'MESSAGES', visible: true });
    await expect(
      firmA().portalModuleVisibility.update({ where: { id: row.id }, data: { visible: false } }),
    ).resolves.toMatchObject({ visible: false });
    await expect(
      firmA().portalModuleVisibility.delete({ where: { id: row.id } }),
    ).resolves.toBeTruthy();
  });

  it("uses the firm's own client and member", async () => {
    await expect(vis({ clientId: ids.clientB, module: 'TAX_RETURNS' })).rejects.toThrow(
      /foreign key/i,
    );
    await expect(vis({ module: 'TASKS_REQUESTS', changedByUserId: randomUUID() })).rejects.toThrow(
      /foreign key/i,
    );
  });
});

describe('portal lock', () => {
  it('locks a client once, with a bounded reason, and unlocking deletes it', async () => {
    const lock = await firmA().clientPortalLock.create({
      data: { ...A(), clientId: ids.other, lockedByUserId: staff, reason: 'Suspicious sign-ins' },
    });
    await expect(
      firmA().clientPortalLock.create({
        data: { ...A(), clientId: ids.other, lockedByUserId: staff },
      }),
    ).rejects.toThrow(/unique/i);
    await expect(
      firmA().clientPortalLock.create({
        data: { ...A(), clientId: f.client, lockedByUserId: staff, reason: 'x'.repeat(201) },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      firmA().clientPortalLock.create({
        data: { ...A(), clientId: f.client, lockedByUserId: randomUUID() },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(firmA().clientPortalLock.delete({ where: { id: lock.id } })).resolves.toBeTruthy();
    await expect(firmA().client.findUnique({ where: { id: ids.other } })).resolves.toBeTruthy(); // nothing else changed
  });
});

describe('portal activity', () => {
  const act = (data: Record<string, unknown> = {}) =>
    firmA().clientPortalActivity.create({
      data: { ...A(), clientId: f.client, type: 'document.uploaded', ...data },
    });

  it('is insert-only and records client, staff and system events', async () => {
    const row = await act({
      clientAccountId: ids.account,
      entityType: 'document',
      entityId: randomUUID(),
      ip: '203.0.113.9',
    });
    expect(row.actorKind).toBe('CLIENT');
    await expect(
      act({ type: 'portal.invitation_sent', actorKind: 'STAFF', actorUserId: staff }),
    ).resolves.toBeTruthy();
    await expect(act({ type: 'portal.sign_in', actorKind: 'SYSTEM' })).resolves.toBeTruthy();
    await expect(
      firmA().clientPortalActivity.update({ where: { id: row.id }, data: { type: 'x.y' } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      firmA().clientPortalActivity.deleteMany({ where: { id: row.id } }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('keeps its code, record and actor consistent, and the login belongs to the client', async () => {
    await expect(act({ type: 'Document Uploaded' })).rejects.toThrow(/check constraint/i);
    await expect(act({ entityType: 'document' })).rejects.toThrow(/check constraint/i);
    await expect(act({ actorKind: 'STAFF' })).rejects.toThrow(/check constraint/i);
    await expect(act({ actorUserId: staff })).rejects.toThrow(/check constraint/i);
    await expect(act({ clientAccountId: ids.otherAccount })).rejects.toThrow(
      /belong to this client/,
    );
    await expect(act({ ip: 'not an address' })).rejects.toThrow();
  });
});

describe('recent clients', () => {
  it('are one row per member and client, moved forward on each open', async () => {
    const make = (clientId: string) =>
      firmA().portalRecentClient.create({ data: { ...A(), userId: staff, clientId } });
    const row = await make(f.client);
    await expect(make(f.client)).rejects.toThrow(/unique/i);
    await expect(make(ids.other)).resolves.toBeTruthy();
    await expect(
      firmA().portalRecentClient.update({
        where: { id: row.id },
        data: { lastViewedAt: new Date() },
      }),
    ).resolves.toBeTruthy();
    await expect(make(ids.clientB)).rejects.toThrow(/foreign key/i);
  });
});

describe('isolation between firms', () => {
  it('visibility, locks, activity and recent clients are invisible to another firm', async () => {
    await firmA().portalModuleVisibility.create({
      data: { ...A(), module: 'APPOINTMENTS', visible: true },
    });
    await firmA().clientPortalLock.create({
      data: { ...A(), clientId: f.client, lockedByUserId: staff },
    });
    await firmA().clientPortalActivity.create({
      data: { ...A(), clientId: f.client, type: 'portal.sign_in' },
    });
    for (const table of [
      'portal_module_visibility',
      'client_portal_locks',
      'client_portal_activity',
      'portal_recent_clients',
    ]) {
      const seen = await runInScope(app, { kind: 'business', businessId: f.firmB }, (tx) =>
        tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table}`),
      );
      expect(seen[0]?.n, table).toBe(0);
    }
    await expect(
      firmB().clientPortalLock.create({
        data: { businessId: f.firmB, clientId: f.client, lockedByUserId: staff },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      firmB().clientPortalActivity.create({ data: { ...A(), clientId: f.client, type: 'a.b' } }),
    ).rejects.toThrow(/row-level security/i);
  });
});
