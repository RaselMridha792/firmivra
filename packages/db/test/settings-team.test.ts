// R0 step 2 rules: Terms and Privacy versions are insert-only, invites follow their lifecycle,
// and links between firm tables cannot point at another firm. Runs as the app role.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { isDbError } from '../src/errors.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  ownerA: randomUUID(),
  invitedA: randomUUID(),
  ownerB: randomUUID(),
  membershipA: '',
  membershipB: '',
};
const days = (d: number) => new Date(Date.now() + d * 86_400_000);
let tokens = 0;
const newTokenHash = () => createHash('sha256').update(`${run}-${tokens++}`).digest('hex');

const firmA = () => db.forBusiness(ids.firmA);
/** A fresh open invite for firm A's invited staff member. */
const invite = (overrides: { expiresAt?: Date; createdAt?: Date } = {}) =>
  firmA().invite.create({
    data: {
      businessId: ids.firmA,
      membershipId: ids.membershipA,
      tokenHash: newTokenHash(),
      expiresAt: overrides.expiresAt ?? days(7),
      createdAt: overrides.createdAt,
      invitedByUserId: ids.ownerA,
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.ownerA, ids.invitedA, ids.ownerB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@s.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `sa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `sb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmA, userId: ids.ownerA, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.membershipA = (
      await tx.membership.create({
        data: { businessId: ids.firmA, userId: ids.invitedA, role: 'STAFF' },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    ids.membershipB = (
      await tx.membership.create({
        data: { businessId: ids.firmB, userId: ids.ownerB, role: 'OWNER', status: 'ACTIVE' },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('business settings and tax statuses', () => {
  it('a firm saves its own settings', async () => {
    await expect(
      firmA().businessSettings.create({
        data: { businessId: ids.firmA, contactEmail: 'hello@a.test', brandColor: '#1F4E79' },
      }),
    ).resolves.toMatchObject({ timezone: 'America/New_York', clientSignUpEnabled: true });
  });

  it('rejects a brand or accent colour that is not #rrggbb and an upper-case email', async () => {
    for (const data of [
      { brandColor: 'red' },
      { accentColor: 'blue' },
      { accentColor: '#12345' },
      { contactEmail: 'Hello@A.test' },
    ]) {
      await expect(
        firmA().businessSettings.update({ where: { businessId: ids.firmA }, data }),
      ).rejects.toThrow(/check constraint/i);
    }
  });

  it('the accent colour is optional; empty means the default', async () => {
    const save = (accentColor: string | null) =>
      firmA().businessSettings.update({ where: { businessId: ids.firmA }, data: { accentColor } });
    await expect(save('#F2A900')).resolves.toMatchObject({ accentColor: '#F2A900' });
    await expect(save(null)).resolves.toMatchObject({ accentColor: null });
  });

  it('tax status names are unique per firm and not blank', async () => {
    await firmA().taxStatus.create({ data: { businessId: ids.firmA, name: 'Filed' } });
    await expect(
      firmA().taxStatus.create({ data: { businessId: ids.firmA, name: 'Filed' } }),
    ).rejects.toThrow();
    await expect(
      firmA().taxStatus.create({ data: { businessId: ids.firmA, name: '  ' } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db
        .forBusiness(ids.firmB)
        .taxStatus.create({ data: { businessId: ids.firmB, name: 'Filed' } }),
    ).resolves.toMatchObject({ name: 'Filed' });
  });

  it('keeps the setup wizard portal text short (name, header, welcome)', async () => {
    const save = (data: object) =>
      firmA().businessSettings.update({ where: { businessId: ids.firmA }, data });
    for (const data of [
      { portalName: ' ' },
      { portalName: 'x'.repeat(121) },
      { portalHeader: 'x'.repeat(201) },
      { welcomeMessage: 'x'.repeat(2001) },
    ]) {
      await expect(save(data)).rejects.toThrow(/check constraint/i);
    }
    await expect(
      save({ portalName: 'LVP Client Portal', welcomeMessage: 'Welcome!' }),
    ).resolves.toMatchObject({ portalName: 'LVP Client Portal' });
  });
});

describe('firm Terms and Privacy', () => {
  it('versions are insert-only', async () => {
    const doc = await firmA().firmLegalDocument.create({
      data: {
        businessId: ids.firmA,
        kind: 'PRIVACY',
        version: 1,
        body: 'v1',
        publishedByUserId: ids.ownerA,
      },
    });
    await expect(
      firmA().firmLegalDocument.update({ where: { id: doc.id }, data: { body: 'edited' } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(firmA().firmLegalDocument.deleteMany({})).rejects.toThrow(/permission denied/i);
  });

  it('a version number is used once per kind', async () => {
    const data = {
      businessId: ids.firmA,
      kind: 'TERMS' as const,
      body: 'x',
      publishedByUserId: ids.ownerA,
    };
    await firmA().firmLegalDocument.create({ data: { ...data, version: 1 } });
    await expect(
      firmA().firmLegalDocument.create({ data: { ...data, version: 1 } }),
    ).rejects.toThrow();
    await expect(
      firmA().firmLegalDocument.create({ data: { ...data, version: 0 } }),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('invites', () => {
  it("cannot point at another firm's membership, even with a real id", async () => {
    await expect(
      firmA().invite.create({
        data: {
          businessId: ids.firmA,
          membershipId: ids.membershipB,
          tokenHash: newTokenHash(),
          expiresAt: days(7),
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('needs exactly one target, a SHA-256 hash and an expiry within 7 days', async () => {
    const base = { businessId: ids.firmA, tokenHash: newTokenHash(), expiresAt: days(7) };
    await expect(firmA().invite.create({ data: base })).rejects.toThrow(/check constraint/i);
    await expect(
      firmA().invite.create({
        data: { ...base, membershipId: ids.membershipA, tokenHash: 'plain-token' },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(invite({ expiresAt: days(8) })).rejects.toThrow(/check constraint/i);
  });

  it('starts open: cannot be created accepted or revoked', async () => {
    await expect(
      firmA().invite.create({
        data: {
          businessId: ids.firmA,
          membershipId: ids.membershipA,
          tokenHash: newTokenHash(),
          expiresAt: days(7),
          acceptedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/cannot be accepted or revoked already/);
  });

  it('is accepted once; then it cannot be undone, revoked or edited', async () => {
    const i = await invite();
    await firmA().invite.update({ where: { id: i.id }, data: { acceptedAt: new Date() } });
    await expect(
      firmA().invite.update({ where: { id: i.id }, data: { acceptedAt: null } }),
    ).rejects.toThrow(/cannot be undone/);
    await expect(
      firmA().invite.update({ where: { id: i.id }, data: { revokedAt: new Date() } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      firmA().invite.update({ where: { id: i.id }, data: { expiresAt: days(6) } }),
    ).rejects.toThrow(/only acceptance and revocation/);
  });

  it('a revoked or expired invite cannot be accepted', async () => {
    const revoked = await invite();
    await firmA().invite.update({ where: { id: revoked.id }, data: { revokedAt: new Date() } });
    const expired = await invite({ createdAt: days(-8), expiresAt: days(-1) });
    for (const i of [revoked, expired]) {
      await expect(
        firmA().invite.update({ where: { id: i.id }, data: { acceptedAt: new Date() } }),
      ).rejects.toThrow(/revoked or expired/);
    }
  });

  it('nobody in the app can delete an invite', async () => {
    await invite();
    await expect(firmA().invite.deleteMany({})).rejects.toThrow(/permission denied/i);
  });
});

describe('legal acceptances', () => {
  const clientA = randomUUID();
  const clientB = randomUUID();
  const setUp = async () => {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      for (const id of [clientA, clientB]) {
        await tx.user.create({
          data: { id, cognitoSub: id, pool: 'CLIENT', email: `${id}@s.test`, name: 'Fake' },
        });
      }
    });
    const login = async (businessId: string, userId: string) =>
      runInScope(owner, { kind: 'business', businessId }, (tx) =>
        tx.clientAccount.create({ data: { businessId, userId, email: `${userId}@s.test` } }),
      );
    const terms = async (businessId: string, publishedByUserId: string) =>
      runInScope(owner, { kind: 'business', businessId }, (tx) =>
        tx.firmLegalDocument.create({
          data: { businessId, kind: 'TERMS', version: 7, body: 'v7', publishedByUserId },
        }),
      );
    return {
      loginA: await login(ids.firmA, clientA),
      termsA: await terms(ids.firmA, ids.ownerA),
      termsB: await terms(ids.firmB, ids.ownerB),
    };
  };

  it("records a client's acceptance once, of its own firm's document, and never changes it", async () => {
    const { loginA, termsA, termsB } = await setUp();
    const accept = (legalDocumentId: string) =>
      firmA().legalAcceptance.create({
        data: {
          businessId: ids.firmA,
          clientAccountId: loginA.id,
          legalDocumentId,
          ip: '203.0.113.7',
          userAgent: 'Test browser',
        },
      });
    await expect(accept(termsB.id)).rejects.toThrow(/foreign key/i);
    const a = await accept(termsA.id);
    await expect(accept(termsA.id)).rejects.toThrow(/unique constraint/i);
    await expect(
      firmA().legalAcceptance.update({ where: { id: a.id }, data: { ip: null } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(firmA().legalAcceptance.deleteMany({})).rejects.toThrow(/permission denied/i);

    // The client sees their own acceptance in user scope; nobody else does.
    expect((await db.forUser(clientA).legalAcceptance.findMany()).map((x) => x.id)).toEqual([a.id]);
    expect(await db.forUser(clientB).legalAcceptance.findMany()).toEqual([]);
    expect(await db.forBusiness(ids.firmB).legalAcceptance.findMany()).toEqual([]);
  });
});

describe('a firm keeps at least one active owner', () => {
  /** A new firm with the given team; returns the firm id and the membership ids in order. */
  const newTeam = async (roles: ('OWNER' | 'STAFF')[]) => {
    let businessId = '';
    const userIds = roles.map(() => randomUUID());
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      for (const id of userIds) {
        await tx.user.create({
          data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@s.test`, name: 'Fake' },
        });
      }
      businessId = (await tx.business.create({ data: { slug: `so-${randomUUID()}`, name: 'O' } }))
        .id;
    });
    const memberships: string[] = [];
    for (const [i, role] of roles.entries()) {
      const m = await db.forBusiness(businessId).membership.create({
        data: { businessId, userId: userIds[i]!, role, status: 'ACTIVE' },
      });
      memberships.push(m.id);
    }
    return { businessId, memberships };
  };
  const activeOwners = (businessId: string) =>
    db.forBusiness(businessId).membership.count({ where: { role: 'OWNER', status: 'ACTIVE' } });
  const lastOwner = (error: unknown) => isDbError(error, 'LAST_ACTIVE_OWNER');

  it('the last active owner cannot be demoted, deactivated or removed (FV001)', async () => {
    const { businessId, memberships } = await newTeam(['OWNER', 'STAFF']);
    const [ownerId, staffId] = memberships as [string, string];
    const firm = db.forBusiness(businessId);
    for (const data of [{ role: 'ADMIN' as const }, { status: 'DEACTIVATED' as const }]) {
      const error = await firm.membership
        .update({ where: { id: ownerId }, data })
        .catch((e: unknown) => e);
      expect(lastOwner(error)).toBe(true);
      expect(String(error)).toMatch(/LAST_ACTIVE_OWNER/);
    }
    expect(
      lastOwner(await firm.membership.delete({ where: { id: ownerId } }).catch((e) => e)),
    ).toBe(true);

    // Make someone else an active owner first; then the first owner can step down.
    await firm.membership.update({ where: { id: staffId }, data: { role: 'OWNER' } });
    await expect(
      firm.membership.update({ where: { id: ownerId }, data: { role: 'STAFF' } }),
    ).resolves.toMatchObject({ role: 'STAFF' });
    expect(await activeOwners(businessId)).toBe(1);
  });

  it('demoting every owner in one statement is refused', async () => {
    const { businessId } = await newTeam(['OWNER', 'OWNER']);
    const error = await db
      .forBusiness(businessId)
      .membership.updateMany({ where: { role: 'OWNER' }, data: { role: 'ADMIN' } })
      .catch((e: unknown) => e);
    expect(lastOwner(error)).toBe(true);
    expect(await activeOwners(businessId)).toBe(2);
  });

  it('two owners demoting each other at the same moment: only the first succeeds', async () => {
    const { businessId, memberships } = await newTeam(['OWNER', 'OWNER']);
    const demote = (id: string, holdMs: number) =>
      db.withScope({ kind: 'business', businessId }, async (tx) => {
        await tx.membership.update({ where: { id }, data: { role: 'STAFF' } });
        // Keep the transaction open so the other one starts before this one commits.
        await new Promise((resolve) => setTimeout(resolve, holdMs));
      });
    const first = demote(memberships[0]!, 500);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = demote(memberships[1]!, 0);
    const [a, b] = await Promise.allSettled([first, second]);
    expect(a.status).toBe('fulfilled');
    expect(b.status === 'rejected' && lastOwner(b.reason)).toBe(true);
    expect(await activeOwners(businessId)).toBe(1);
  });

  it('an invited or deactivated owner does not count, and changes to them are free', async () => {
    const { businessId, memberships } = await newTeam(['OWNER', 'OWNER']);
    const firm = db.forBusiness(businessId);
    await firm.membership.update({
      where: { id: memberships[1]! },
      data: { status: 'DEACTIVATED' },
    });
    expect(
      lastOwner(
        await firm.membership
          .update({ where: { id: memberships[0]! }, data: { role: 'STAFF' } })
          .catch((e: unknown) => e),
      ),
    ).toBe(true);
    await expect(
      firm.membership.update({ where: { id: memberships[1]! }, data: { role: 'STAFF' } }),
    ).resolves.toMatchObject({ role: 'STAFF', status: 'DEACTIVATED' });
  });
});
