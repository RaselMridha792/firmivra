// R0 step 11: the Super Admin scope (db.forAdmin). It reviews firm applications, changes a
// firm's status and slug, requests support access, reads firm owners' contact and platform audit
// events, and never reaches firm data or user identities. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  admin: randomUUID(),
  otherAdmin: randomUUID(),
  notAdmin: randomUUID(),
  ownerA: randomUUID(),
  staffA: randomUUID(),
  clientA: randomUUID(),
  firmA: '',
  application: '',
  client: '',
};

const admin = () => db.forAdmin(ids.admin);

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.admin, 'ADMIN'],
      [ids.otherAdmin, 'ADMIN'],
      [ids.notAdmin, 'ADMIN'],
      [ids.ownerA, 'STAFF'],
      [ids.staffA, 'STAFF'],
      [ids.clientA, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: {
          id,
          cognitoSub: id,
          pool,
          email: `${id}@ad.test`,
          name: 'Fake',
          phone: '+15555550199',
        },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.admin } });
    await tx.platformAdmin.create({ data: { userId: ids.otherAdmin } });
    ids.firmA = (await tx.business.create({ data: { slug: `ada-${run}`, name: 'Firm A' } })).id;
    ids.application = (
      await tx.firmApplication.create({
        data: {
          legalName: 'Applicant LLC (fake)',
          contactName: 'Applicant',
          contactEmail: `apply-${run}@ad.test`,
          data: {},
        },
      })
    ).id;
    await tx.auditLog.create({ data: { action: 'admin.signed_in', entityType: 'login' } });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const firm = { businessId: ids.firmA };
    await tx.membership.create({
      data: { ...firm, userId: ids.ownerA, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.membership.create({
      data: { ...firm, userId: ids.staffA, role: 'STAFF', status: 'ACTIVE' },
    });
    const client = await tx.client.create({ data: { ...firm, displayName: 'Client (fake)' } });
    ids.client = client.id;
    await tx.clientProfile.create({ data: { ...firm, clientId: client.id, firstName: 'Fake' } });
    await tx.clientAccount.create({
      data: { ...firm, userId: ids.clientA, clientId: client.id, email: `${ids.clientA}@ad.test` },
    });
    const service = await tx.service.create({ data: { ...firm, kind: 'ANNUAL_TAX', name: 'Tax' } });
    const engagement = await tx.engagement.create({
      data: { ...firm, clientId: client.id, serviceId: service.id, title: '2025' },
    });
    await tx.document.create({
      data: {
        ...firm,
        clientId: client.id,
        engagementId: engagement.id,
        direction: 'FIRM_TO_CLIENT',
        fileName: 'x.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
        s3Key: `tenant/${ids.firmA}/documents/${randomUUID()}`,
      },
    });
    await tx.messageThread.create({ data: { ...firm, clientId: client.id, subject: 'Hi' } });
    await tx.invoice.create({ data: { ...firm, clientId: client.id, number: 'INV-1' } });
    await tx.auditLog.create({ data: { ...firm, action: 'client.created', entityType: 'client' } });
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('who is an admin', () => {
  it('a user who is not a Super Admin sees nothing but the list of admins', async () => {
    const notAdmin = db.forAdmin(ids.notAdmin);
    expect(await notAdmin.firmApplication.findMany()).toEqual([]);
    expect(await notAdmin.business.findMany()).toEqual([]);
    expect(await notAdmin.user.findMany()).toEqual([]);
    expect(await notAdmin.supportAccessGrant.findMany()).toEqual([]);
    expect(await notAdmin.auditLog.findMany()).toEqual([]);
    const admins = (await notAdmin.platformAdmin.findMany()).map((a) => a.userId);
    expect(admins).toEqual(expect.arrayContaining([ids.admin, ids.otherAdmin]));
  });

  it('rejects a malformed admin id before touching the database', () => {
    expect(() => db.forAdmin("x' OR 1=1 --")).toThrow(/invalid admin id/i);
  });
});

describe('firm applications', () => {
  it('a review is recorded as the acting admin; the database writes the history', async () => {
    await expect(
      admin().firmApplication.update({
        where: { id: ids.application },
        data: {
          status: 'INFO_REQUESTED',
          reviewedByUserId: ids.otherAdmin,
          reviewedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/acting admin/);
    await admin().firmApplication.update({
      where: { id: ids.application },
      data: {
        status: 'INFO_REQUESTED',
        reviewedByUserId: ids.admin,
        reviewedAt: new Date(),
        decisionReason: 'Please send your EIN letter.',
        internalNotes: 'Looks fine otherwise.',
      },
    });
    const history = await admin().firmApplicationStatusHistory.findMany({
      where: { applicationId: ids.application },
    });
    expect(
      history
        .map((h) => `${h.fromStatus}>${h.toStatus} by ${h.changedByUserId}: ${h.reason}`)
        .sort(),
    ).toEqual(
      [
        'null>PENDING_REVIEW by null: null',
        `PENDING_REVIEW>INFO_REQUESTED by ${ids.admin}: Please send your EIN letter.`,
      ].sort(),
    );
    expect(
      (
        await db.forPlatform().firmApplicationStatusHistory.findMany({
          where: { applicationId: ids.application },
        })
      ).length,
    ).toBe(2);
  });

  it('history records who decided and the message from that change only', async () => {
    const { id } = await db.forPlatform().firmApplication.create({
      data: {
        legalName: 'History LLC (fake)',
        contactName: 'Applicant',
        contactEmail: `history-${run}@ad.test`,
        data: {},
      },
    });
    const decide = (
      adminId: string,
      status: 'INFO_REQUESTED' | 'APPROVED' | 'DECLINED',
      decisionReason?: string | null,
    ) =>
      db.forAdmin(adminId).firmApplication.update({
        where: { id },
        data: { status, reviewedByUserId: adminId, reviewedAt: new Date(), decisionReason },
      });
    // The applicant answers in platform scope (R4): no admin, and the old message is not repeated.
    const resubmit = () =>
      db
        .forPlatform()
        .firmApplication.update({ where: { id }, data: { status: 'PENDING_REVIEW' } });

    for (const reason of [undefined, ' ']) {
      await expect(decide(ids.admin, 'DECLINED', reason)).rejects.toThrow(/needs a message/);
      await expect(decide(ids.admin, 'INFO_REQUESTED', reason)).rejects.toThrow(/needs a message/);
    }
    await decide(ids.admin, 'INFO_REQUESTED', 'Please send your EIN letter.');
    await resubmit();
    await decide(ids.otherAdmin, 'INFO_REQUESTED', 'Please also send a photo ID.');
    // A new message on the same status is a history row too.
    await db.forAdmin(ids.admin).firmApplication.update({
      where: { id },
      data: { decisionReason: 'Reminder: photo ID.' },
    });
    await resubmit();
    await decide(ids.admin, 'APPROVED');

    const history = await admin().firmApplicationStatusHistory.findMany({
      where: { applicationId: id },
    });
    expect(
      history
        .map((h) => `${h.fromStatus}>${h.toStatus} by ${h.changedByUserId}: ${h.reason}`)
        .sort(),
    ).toEqual(
      [
        'null>PENDING_REVIEW by null: null',
        `PENDING_REVIEW>INFO_REQUESTED by ${ids.admin}: Please send your EIN letter.`,
        'INFO_REQUESTED>PENDING_REVIEW by null: null',
        `PENDING_REVIEW>INFO_REQUESTED by ${ids.otherAdmin}: Please also send a photo ID.`,
        `INFO_REQUESTED>INFO_REQUESTED by ${ids.admin}: Reminder: photo ID.`,
        'INFO_REQUESTED>PENDING_REVIEW by null: null',
        `PENDING_REVIEW>APPROVED by ${ids.admin}: null`,
      ].sort(),
    );
  });

  it('a review never changes the application itself, and history is never written by hand', async () => {
    for (const data of [{ legalName: 'Edited LLC' }, { businessId: ids.firmA }]) {
      await expect(
        admin().firmApplication.update({ where: { id: ids.application }, data }),
      ).rejects.toThrow(/never the application/);
    }
    await expect(
      admin().firmApplicationStatusHistory.create({
        data: { applicationId: ids.application, toStatus: 'APPROVED' },
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('firms', () => {
  it("changes only a firm's status and slug", async () => {
    await expect(
      admin().business.update({ where: { id: ids.firmA }, data: { status: 'SUSPENDED' } }),
    ).resolves.toMatchObject({ status: 'SUSPENDED' });
    for (const data of [{ name: 'Renamed' }, { kmsKeyId: 'alias/other' }]) {
      await expect(admin().business.update({ where: { id: ids.firmA }, data })).rejects.toThrow(
        /only status and slug/,
      );
    }
    await expect(admin().business.deleteMany({ where: { id: ids.firmA } })).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("reads firm owners' contact, never other staff or clients, and never edits users", async () => {
    const users = await admin().user.findMany({
      where: { id: { in: [ids.ownerA, ids.staffA, ids.clientA, ids.admin] } },
    });
    expect(users.map((u) => u.id).sort()).toEqual([ids.admin, ids.ownerA].sort());
    expect(users.find((u) => u.id === ids.ownerA)).toMatchObject({ phone: '+15555550199' });
    const roles = (await admin().membership.findMany({ where: { businessId: ids.firmA } })).map(
      (m) => m.role,
    );
    expect(roles).toEqual(['OWNER']);
    expect(
      (await admin().user.updateMany({ where: { id: ids.ownerA }, data: { name: 'x' } })).count,
    ).toBe(0);
  });
});

describe('support access', () => {
  it('requests access only as itself and cannot approve it', async () => {
    const request = (adminUserId: string) =>
      admin().supportAccessGrant.create({
        data: { businessId: ids.firmA, adminUserId, reason: 'Customer asked for help' },
      });
    await expect(request(ids.otherAdmin)).rejects.toThrow(/row-level security/i);
    const g = await request(ids.admin);
    expect(
      (
        await admin().supportAccessGrant.updateMany({
          where: { id: g.id },
          data: { grantedByUserId: ids.ownerA, expiresAt: new Date(Date.now() + 3_600_000) },
        })
      ).count,
    ).toBe(0);
  });

  it("Super Admin can't read firm A's clients or any firm data, with or without a grant", async () => {
    const firmData = async () => {
      const a = admin();
      return [
        await a.client.findMany(),
        await a.clientAccount.findMany(),
        await a.clientProfile.findMany(),
        await a.engagement.findMany(),
        await a.document.findMany(),
        await a.messageThread.findMany(),
        await a.invoice.findMany(),
        await a.auditLog.findMany({ where: { businessId: ids.firmA } }),
      ].flat();
    };
    expect(await firmData()).toEqual([]);

    // The owner approves a grant: admin scope still sees no firm data. Support work happens in
    // firm scope, after the API checks the approved, unexpired grant.
    const g = await admin().supportAccessGrant.create({
      data: { businessId: ids.firmA, adminUserId: ids.admin, reason: 'Approved help' },
    });
    await db.forBusiness(ids.firmA).supportAccessGrant.update({
      where: { id: g.id },
      data: { grantedByUserId: ids.ownerA, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    expect(await firmData()).toEqual([]);
  });
});

describe('audit log', () => {
  it('reads and writes platform events only, as itself', async () => {
    const events = await admin().auditLog.findMany();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.businessId === null)).toBe(true);
    await expect(
      admin().auditLog.create({
        data: {
          actorUserId: ids.admin,
          action: 'application.reviewed',
          entityType: 'firm_application',
        },
      }),
    ).resolves.toBeDefined();
    for (const data of [
      { actorUserId: ids.admin, businessId: ids.firmA },
      { actorUserId: ids.otherAdmin },
    ]) {
      await expect(
        admin().auditLog.create({ data: { ...data, action: 'x.y', entityType: 'x' } }),
      ).rejects.toThrow(/row-level security/i);
    }
  });
});
