// QA seed part 2 (R1, Nov 7; R56's fixture list): LVP's business clients, a state calendar's two
// versions, a clean document under an open service, revenue-summary schedules and runs, five
// invoices whose totals the reports must reproduce, and the Super Admin's applications and sales
// records. Runs twice without a second row, leaves nothing sendable, and another firm never sees
// LVP's rows. Seeds the test database as the owner role.
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { qaExtraId, qaFixturePdf, seedQaExtra } from '../prisma/seed-qa-extra.js';
import { connect } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
const id = qaExtraId;
let lvp = '';
let other = '';

/** A firm by slug, made if the test database has none yet. */
const firm = (slug: string) =>
  runInScope(owner, { kind: 'platform' }, async (tx) => {
    const found = await tx.business.findUnique({ where: { slug }, select: { id: true } });
    return (
      found ??
      (await tx.business.create({
        data: { slug, name: `${slug} (test)`, status: 'ACTIVE' },
        select: { id: true },
      }))
    ).id;
  });

beforeAll(async () => {
  lvp = await firm('lvp');
  other = await firm('test-firm-b');
  const stamp = Date.now();
  // An active Owner for LVP and a Super Admin, as dev has.
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const user = await tx.user.create({
      data: {
        cognitoSub: `qa2-owner-${stamp}`,
        pool: 'STAFF',
        email: `qa2-owner-${stamp}@example.test`,
        name: 'QA2 Owner (fake)',
      },
    });
    if (!(await tx.platformAdmin.findFirst({ where: { role: 'SUPER_ADMIN' } }))) {
      const admin = await tx.user.create({
        data: {
          cognitoSub: `qa2-admin-${stamp}`,
          pool: 'ADMIN',
          email: `qa2-admin-${stamp}@example.test`,
          name: 'QA2 Admin (fake)',
        },
      });
      await tx.platformAdmin.create({ data: { userId: admin.id, role: 'SUPER_ADMIN' } });
    }
    return user.id;
  }).then((userId) =>
    runInScope(owner, { kind: 'business', businessId: lvp }, async (tx) => {
      if (
        !(await tx.membership.findFirst({
          where: { businessId: lvp, role: 'OWNER', status: 'ACTIVE' },
        }))
      ) {
        await tx.membership.create({
          data: { businessId: lvp, userId, role: 'OWNER', status: 'ACTIVE' },
        });
      }
    }),
  );
});

describe('QA seed part 2', () => {
  it('seeds LVP and the platform once; a second run adds nothing', async () => {
    const first = await seedQaExtra(owner);
    expect(first.lvp).toMatch(/seeded|already/);
    expect(first.platform).toMatch(/seeded|already/);
    expect(first.documentKey).toBe(`tenant/${lvp}/documents/${id(300)}`);
    await expect(seedQaExtra(owner)).resolves.toMatchObject({
      lvp: 'already',
      platform: 'already',
    });
  });

  it("holds R56's fixtures", async () => {
    const t = db.forBusiness(lvp);
    const clients = await t.client.findMany({
      where: { id: { in: Array.from({ length: 8 }, (_, i) => id(i + 1)) } },
      include: { profile: true },
      orderBy: { id: 'asc' },
    });
    expect(
      clients.map((c) => [c.accountType, c.status, c.profile?.entityType, c.profile?.state]),
    ).toEqual([
      ['BUSINESS', 'ACTIVE', 'Single-member LLC', 'NY'],
      ['BUSINESS', 'ACTIVE', 'Multi-member LLC', 'NJ'],
      ['BUSINESS', 'ACTIVE', 'LLC electing S corporation', 'NY'],
      ['BUSINESS', 'ACTIVE', 'C corporation', 'DE'],
      ['BUSINESS', 'ACTIVE', 'Partnership', 'NY'],
      ['BUSINESS', 'ACTIVE', 'LLC', 'NY'],
      ['BUSINESS', 'ACTIVE', null, null],
      ['BUSINESS', 'INACTIVE', 'S corporation', 'NY'],
    ]);

    const calendars = await t.complianceCalendar.findMany({
      where: { id: { in: [id(100), id(110)] } },
      include: { entries: { orderBy: { name: 'asc' } } },
      orderBy: { version: 'asc' },
    });
    expect(calendars.map((c) => [c.version, c.status, c.verifiedAt !== null])).toEqual([
      [1, 'PUBLISHED', true],
      [2, 'DRAFT', false],
    ]);
    expect(
      calendars[1]!.entries.map((e) => [e.name, e.ruleKind, e.dueOn?.toISOString() ?? null]),
    ).toEqual([
      ['QA Form 100 Annual Return', 'FIXED_DATE', '2027-04-16T00:00:00.000Z'],
      ['QA Form 200 Q1 Estimate', 'FIXED_DATE', '2027-04-15T00:00:00.000Z'],
      ['QA Form 400 Annual Report', 'FIXED_DATE', '2027-05-01T00:00:00.000Z'],
      ['QA Form 500 Unknown Date', 'NEEDS_VERIFICATION', null],
    ]);

    const pdf = qaFixturePdf();
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    await expect(t.document.findUniqueOrThrow({ where: { id: id(300) } })).resolves.toMatchObject({
      scanStatus: 'PENDING',
      engagementId: id(201),
      sizeBytes: pdf.byteLength,
      sha256: createHash('sha256').update(pdf).digest('hex'),
    });

    // Totals the reports must reproduce: this year collected $450, last year $1,000.
    const live = await t.offlinePayment.findMany({
      where: { invoiceId: { in: [500, 501, 502, 503].map(id) }, voidedAt: null },
      select: { amountCents: true, receivedOn: true },
    });
    const sum = (year: number) =>
      live
        .filter((p) => p.receivedOn.getUTCFullYear() === year)
        .reduce((s, p) => s + p.amountCents, 0);
    expect([sum(2026), sum(2025)]).toEqual([45_000, 100_000]);
    const invoices = await t.invoice.findMany({
      where: { id: { in: [500, 501, 502, 503, 504].map(id) } },
      select: { number: true, status: true, totalCents: true },
      orderBy: { number: 'asc' },
    });
    expect(invoices.map((i) => [i.number, i.status, i.totalCents])).toEqual([
      ['QA-1001', 'PAID', 100_000],
      ['QA-1002', 'OPEN', 50_000],
      ['QA-1003', 'PAID', 25_000],
      ['QA-1004', 'OPEN', 15_000],
      ['QA-1005', 'DRAFT', 0],
    ]);
    await expect(
      t.offlinePayment.findUniqueOrThrow({ where: { id: id(513) } }),
    ).resolves.toMatchObject({ voidReason: 'Entered twice', voidedAt: expect.any(Date) });

    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      const apps = await tx.firmApplication.findMany({
        where: { id: { in: [600, 601, 602, 603].map(id) } },
        select: { status: true },
      });
      expect(apps.map((a) => a.status).sort()).toEqual([
        'INFO_REQUESTED',
        'PENDING_REVIEW',
        'PENDING_REVIEW',
        'PENDING_REVIEW',
      ]);
    });
  });

  it('leaves nothing sendable', async () => {
    const t = db.forBusiness(lvp);
    expect(
      await t.reportSchedule.count({
        where: { id: { in: [400, 401, 402].map(id) }, deliverEmail: true },
      }),
    ).toBe(0);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    expect(
      await t.invoice.count({
        where: {
          id: { in: [500, 501, 502, 503, 504].map(id) },
          status: 'OPEN',
          dueOn: { lt: today },
        },
      }),
    ).toBe(0);
    expect(
      await t.client.count({
        where: {
          id: { in: Array.from({ length: 8 }, (_, i) => id(i + 1)) },
          createdAt: { gte: new Date('2026-10-01T00:00:00Z') },
        },
      }),
    ).toBe(0);
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      expect(
        await tx.salesFollowUp.count({
          where: { id: { in: [id(730), id(731)] }, dueAt: { lt: new Date('2098-01-01') } },
        }),
      ).toBe(0);
    });
  });
});

describe('isolation', () => {
  it("another firm never sees or changes LVP's part-2 rows", async () => {
    const b = db.forBusiness(other);
    expect(await b.client.findMany({ where: { id: { in: [id(1), id(4)] } } })).toEqual([]);
    expect(await b.invoice.findMany({ where: { id: { in: [500, 501].map(id) } } })).toEqual([]);
    expect(await b.document.findMany({ where: { id: id(300) } })).toEqual([]);
    expect(await b.reportSchedule.findMany({ where: { id: id(400) } })).toEqual([]);
    const { count } = await b.client.updateMany({
      where: { id: id(1) },
      data: { displayName: 'Changed by firm B' },
    });
    expect(count).toBe(0);
  });
});
