// R0 step 4 rules: engagements keep their lifecycle rules and status history in the database,
// tasks and notes stay with their own client's engagements, and published reports stay.
// Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  staffA: randomUUID(),
  ownerB: randomUUID(),
  client1: '',
  client2: '',
  taxService: '',
  bookkeeping: '',
  clientB: '',
  serviceB: '',
};
const days = (d: number) => new Date(Date.now() + d * 86_400_000);

const firmA = () => db.forBusiness(ids.firmA);
/** A fresh tax engagement for client 1 of firm A. */
const engagement = (data: { stage?: string } = {}) =>
  firmA().engagement.create({
    data: {
      businessId: ids.firmA,
      clientId: ids.client1,
      serviceId: ids.taxService,
      title: '2025 Personal Tax',
      taxYear: 2025,
      updatedByUserId: ids.staffA,
      ...data,
    },
  });
const history = (engagementId: string) =>
  firmA().engagementStatusHistory.findMany({ where: { engagementId } });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.ownerB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@e.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `ea-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `eb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmA, userId: ids.staffA, role: 'STAFF', status: 'ACTIVE' },
    });
    const client = (displayName: string) =>
      tx.client.create({ data: { businessId: ids.firmA, displayName } });
    ids.client1 = (await client('One')).id;
    ids.client2 = (await client('Two')).id;
    ids.taxService = (
      await tx.service.create({
        data: {
          businessId: ids.firmA,
          kind: 'ANNUAL_TAX',
          name: 'Annual Tax',
          stages: ['New', 'Preparation', 'Review'],
        },
      })
    ).id;
    ids.bookkeeping = (
      await tx.service.create({
        data: {
          businessId: ids.firmA,
          kind: 'BOOKKEEPING',
          name: 'Bookkeeping',
          billingInterval: 'MONTHLY',
        },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: ids.ownerB, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientB = (
      await tx.client.create({ data: { businessId: ids.firmB, displayName: 'B' } })
    ).id;
    ids.serviceB = (
      await tx.service.create({ data: { businessId: ids.firmB, kind: 'OTHER', name: 'Other' } })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('same-firm links', () => {
  it("an engagement cannot use another firm's client, service or staff member", async () => {
    const base = {
      businessId: ids.firmA,
      clientId: ids.client1,
      serviceId: ids.taxService,
      title: 'X',
    };
    for (const data of [
      { ...base, clientId: ids.clientB },
      { ...base, serviceId: ids.serviceB },
      { ...base, assignedUserId: ids.ownerB },
    ]) {
      await expect(firmA().engagement.create({ data })).rejects.toThrow(/foreign key/i);
    }
  });

  it("a task or note cannot name another client's engagement", async () => {
    const e = await engagement();
    const other = { businessId: ids.firmA, clientId: ids.client2, engagementId: e.id };
    await expect(firmA().task.create({ data: { ...other, title: 'X' } })).rejects.toThrow(
      /foreign key/i,
    );
    await expect(
      firmA().note.create({ data: { ...other, body: 'X', authorUserId: ids.staffA } }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      firmA().task.create({ data: { ...other, clientId: ids.client1, title: 'Fine' } }),
    ).resolves.toMatchObject({ engagementId: e.id });
  });
});

describe('engagement status tracker', () => {
  it('records the start and every change of status or stage, not other edits', async () => {
    const e = await engagement({ stage: 'New' });
    await firmA().engagement.update({ where: { id: e.id }, data: { stage: 'Preparation' } });
    await firmA().engagement.update({ where: { id: e.id }, data: { title: 'Renamed' } });
    await firmA().engagement.update({
      where: { id: e.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    const rows = (await history(e.id)).map((r) => `${r.status}/${r.stage}/${r.changedByUserId}`);
    expect(rows.sort()).toEqual(
      [
        `ACTIVE/New/${ids.staffA}`,
        `ACTIVE/Preparation/${ids.staffA}`,
        `COMPLETED/Preparation/${ids.staffA}`,
      ].sort(),
    );
  });

  it("the stage must be one of the service's stages", async () => {
    await expect(engagement({ stage: 'Made up' })).rejects.toThrow(/service's stages/);
    const e = await engagement({ stage: 'New' });
    await expect(
      firmA().engagement.update({ where: { id: e.id }, data: { stage: 'Made up' } }),
    ).rejects.toThrow(/service's stages/);
  });

  it('history cannot be edited or deleted by the app', async () => {
    await expect(
      firmA().engagementStatusHistory.updateMany({ data: { stage: 'rewritten' } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(firmA().engagementStatusHistory.deleteMany({})).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('engagement lifecycle', () => {
  it('stays with its client and service, and is never deleted', async () => {
    const e = await engagement();
    for (const data of [{ clientId: ids.client2 }, { serviceId: ids.bookkeeping }]) {
      await expect(firmA().engagement.update({ where: { id: e.id }, data })).rejects.toThrow(
        /cannot change/,
      );
    }
    await expect(firmA().engagement.deleteMany({ where: { id: e.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('completed and cancelled need their timestamps', async () => {
    const e = await engagement();
    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      await expect(
        firmA().engagement.update({ where: { id: e.id }, data: { status } }),
      ).rejects.toThrow(/check constraint/i);
    }
  });

  it('a cancelled engagement can be reactivated within 90 days, not after', async () => {
    const recent = await engagement();
    await firmA().engagement.update({
      where: { id: recent.id },
      data: { status: 'CANCELLED', cancelledAt: days(-30) },
    });
    await expect(
      firmA().engagement.update({ where: { id: recent.id }, data: { status: 'ACTIVE' } }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });

    const old = await engagement();
    await firmA().engagement.update({
      where: { id: old.id },
      data: { status: 'CANCELLED', cancelledAt: days(-91) },
    });
    await expect(
      firmA().engagement.update({ where: { id: old.id }, data: { status: 'ACTIVE' } }),
    ).rejects.toThrow(/within 90 days/);
  });

  it('only a recurring engagement has a next billing date', async () => {
    const base = { businessId: ids.firmA, clientId: ids.client1, nextBillingOn: days(30) };
    await expect(
      firmA().engagement.create({
        data: { ...base, serviceId: ids.taxService, title: 'One-time' },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      firmA().engagement.create({
        data: {
          ...base,
          serviceId: ids.bookkeeping,
          title: 'Monthly',
          billingInterval: 'MONTHLY',
        },
      }),
    ).resolves.toMatchObject({ billingInterval: 'MONTHLY' });
  });
});

describe('workspace tasks, notes and reports', () => {
  it('a done task needs completed_at; tasks and notes can be deleted', async () => {
    const t = await firmA().task.create({
      data: { businessId: ids.firmA, clientId: ids.client1, title: 'Call the client' },
    });
    await expect(
      firmA().task.update({ where: { id: t.id }, data: { status: 'DONE' } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(firmA().task.delete({ where: { id: t.id } })).resolves.toMatchObject({
      id: t.id,
    });
  });

  it('a published report needs published_at and is never deleted; a draft can be', async () => {
    const e = await engagement();
    const report = (status: 'DRAFT' | 'PUBLISHED', publishedAt?: Date) =>
      firmA().engagementReport.create({
        data: {
          businessId: ids.firmA,
          engagementId: e.id,
          kind: 'ESTIMATE',
          title: '2026 estimate',
          status,
          publishedAt,
        },
      });
    await expect(report('PUBLISHED')).rejects.toThrow(/check constraint/i);
    const published = await report('PUBLISHED', new Date());
    const draft = await report('DRAFT');

    expect((await firmA().engagementReport.deleteMany({ where: { id: published.id } })).count).toBe(
      0,
    );
    expect((await firmA().engagementReport.deleteMany({ where: { id: draft.id } })).count).toBe(1);
    expect(await firmA().engagementReport.findUnique({ where: { id: published.id } })).not.toBe(
      null,
    );
  });

  it('a report that was ever published is never deleted, even after unpublishing', async () => {
    const e = await engagement();
    const publishedAt = new Date();
    const r = await firmA().engagementReport.create({
      data: {
        businessId: ids.firmA,
        engagementId: e.id,
        kind: 'PROJECTION',
        title: '2026 projection',
        status: 'PUBLISHED',
        publishedAt,
      },
    });
    expect(r.firstPublishedAt).toEqual(publishedAt);

    // Unpublishing is allowed; the record that it was published stays.
    const unpublished = await firmA().engagementReport.update({
      where: { id: r.id },
      data: { status: 'DRAFT', publishedAt: null },
    });
    expect(unpublished).toMatchObject({ status: 'DRAFT', firstPublishedAt: publishedAt });
    expect((await firmA().engagementReport.deleteMany({ where: { id: r.id } })).count).toBe(0);

    // Republishing keeps the first date.
    const republished = await firmA().engagementReport.update({
      where: { id: r.id },
      data: { status: 'PUBLISHED', publishedAt: new Date(Date.now() + 60_000) },
    });
    expect(republished.firstPublishedAt).toEqual(publishedAt);
  });

  it('first_published_at is set only by the database and never cleared or changed', async () => {
    const e = await engagement();
    const base = { businessId: ids.firmA, engagementId: e.id, kind: 'REPORT' as const, title: 'X' };
    await expect(
      firmA().engagementReport.create({ data: { ...base, firstPublishedAt: new Date() } }),
    ).rejects.toThrow(/set by the database/);

    const r = await firmA().engagementReport.create({
      data: { ...base, status: 'PUBLISHED', publishedAt: new Date() },
    });
    for (const firstPublishedAt of [null, new Date(Date.now() - 86_400_000)]) {
      await expect(
        firmA().engagementReport.update({ where: { id: r.id }, data: { firstPublishedAt } }),
      ).rejects.toThrow(/cannot change or be cleared/);
    }
  });
});
