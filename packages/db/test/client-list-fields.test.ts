// R37, Clients: the client number, status and its history, priority, source, client-since date
// and last-activity time. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', staffA: randomUUID(), staffB: randomUUID(), service: '' };
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);
const days = (d: number) => new Date(Date.now() + d * 86_400_000);

const newClient = (data: Record<string, unknown> = {}) =>
  A().client.create({
    data: { businessId: ids.firmA, displayName: `Client ${randomUUID().slice(0, 6)}`, ...data },
  });
const history = (id: string) =>
  A().clientStatusHistory.findMany({ where: { clientId: id }, orderBy: { seq: 'asc' } });
const fresh = (id: string) => A().client.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@cl.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `cla-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `clb-${run}`, name: 'B' } })).id;
  });
  const setup = (businessId: string, userId: string) =>
    runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      await tx.membership.create({ data: { businessId, userId, role: 'OWNER', status: 'ACTIVE' } });
      return (
        await tx.service.create({ data: { businessId, kind: 'ANNUAL_TAX', name: 'Annual Tax' } })
      ).id;
    });
  ids.service = await setup(ids.firmA, ids.staffA);
  await setup(ids.firmB, ids.staffB);
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows another firm's status history, and refuses an author from another firm", async () => {
    const c = await newClient({ updatedByUserId: ids.staffA });
    expect(await history(c.id)).toHaveLength(1);
    expect(await B().clientStatusHistory.count({ where: { clientId: c.id } })).toBe(0);
    await expect(newClient({ updatedByUserId: ids.staffB })).rejects.toThrow(/foreign key/i);
    await expect(
      B().clientStatusHistory.create({
        data: { businessId: ids.firmB, clientId: c.id, status: 'ACTIVE' },
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('client number', () => {
  it('is the firm’s next, from 10001, in order; a caller’s number is ignored and it never changes', async () => {
    const firm = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.business.create({ data: { slug: `cln-${run}`, name: 'N' } }),
    );
    const make = (n: number) =>
      runInScope(owner, { kind: 'business', businessId: firm.id }, (tx) =>
        tx.client.create({ data: { businessId: firm.id, displayName: `C${n}`, clientNumber: 77 } }),
      );
    const first = await make(1);
    const second = await make(2);
    expect(first.clientNumber).toBe(10001);
    expect(second.clientNumber).toBe(10002);
    await expect(
      A().client.update({ where: { id: (await newClient()).id }, data: { clientNumber: 5 } }),
    ).rejects.toThrow(/never changes/);
    const other = await B().client.create({ data: { businessId: ids.firmB, displayName: 'B' } });
    expect(other.clientNumber).toBe(10001);
  });

  it('is unique per firm', async () => {
    const a = await newClient();
    const b = await newClient();
    expect(b.clientNumber).toBe(a.clientNumber + 1);
  });
});

describe('status and its history', () => {
  it('a new client is NEW; each change of status adds a history row with its author', async () => {
    const c = await newClient({ updatedByUserId: ids.staffA });
    expect(c.status).toBe('NEW');
    await A().client.update({
      where: { id: c.id },
      data: { status: 'ACTIVE', updatedByUserId: ids.staffA },
    });
    // A change of something else adds nothing.
    await A().client.update({ where: { id: c.id }, data: { phone: '+15555550100' } });
    await A().client.update({ where: { id: c.id }, data: { status: 'INACTIVE' } });
    const rows = await history(c.id);
    expect(rows.map((h) => h.status)).toEqual(['NEW', 'ACTIVE', 'INACTIVE']);
    expect(rows[1]).toMatchObject({ changedByUserId: ids.staffA });
    expect(rows[2]!.changedAt.getTime()).toBeGreaterThanOrEqual(rows[1]!.changedAt.getTime());
    await expect(
      A().clientStatusHistory.update({ where: { id: rows[0]!.id }, data: { status: 'ON_HOLD' } }),
    ).rejects.toThrow(/permission denied/);
  });

  it('archiving does not touch the status (Inactive stays listed)', async () => {
    const c = await newClient({ status: 'INACTIVE' });
    const archived = await A().client.update({
      where: { id: c.id },
      data: { archivedAt: new Date() },
    });
    expect(archived.status).toBe('INACTIVE');
    expect(await history(c.id)).toHaveLength(1);
  });
});

describe('source, priority and client since', () => {
  it('keeps the source short on one line, and client since out of the future', async () => {
    for (const data of [
      { source: ' ' },
      { source: 'x'.repeat(51) },
      { sourceDetail: 'x'.repeat(201) },
      { source: 'a\nb' },
    ]) {
      await expect(newClient(data)).rejects.toThrow(/clients_source_text/);
    }
    await expect(newClient({ clientSince: days(10) })).rejects.toThrow(/cannot be in the future/);
    await expect(
      newClient({
        source: 'FACEBOOK_AD',
        sourceDetail: 'Back Taxes Campaign',
        priority: 'HIGH',
        clientSince: new Date('2019-05-01'),
      }),
    ).resolves.toMatchObject({ source: 'FACEBOOK_AD', priority: 'HIGH' });
  });
});

describe('last activity', () => {
  it('moves forward with a client’s documents, requests, appointments and tax returns, never back', async () => {
    const c = await newClient();
    expect(c.lastActivityAt).toBeNull();
    const { engagement } = await runInScope(
      owner,
      { kind: 'business', businessId: ids.firmA },
      async (tx) => ({
        engagement: await tx.engagement.create({
          data: { businessId: ids.firmA, clientId: c.id, serviceId: ids.service, title: '2025' },
        }),
      }),
    );
    const stamps: Date[] = [];
    const touched = async () => {
      const at = (await fresh(c.id)).lastActivityAt;
      expect(at).not.toBeNull();
      stamps.push(at!);
    };
    await A().documentRequest.create({
      data: { businessId: ids.firmA, clientId: c.id, engagementId: engagement.id, title: 'W-2' },
    });
    await touched();
    await A().document.create({
      data: {
        businessId: ids.firmA,
        clientId: c.id,
        engagementId: engagement.id,
        direction: 'INTERNAL',
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'e'.repeat(64),
        s3Key: `tenant/${ids.firmA}/documents/${randomUUID()}`,
      },
    });
    await touched();
    await A().taxReturn.create({
      data: { businessId: ids.firmA, clientId: c.id, taxYear: 2025, filingType: 'INDIVIDUAL' },
    });
    await touched();
    await A().appointment.create({
      data: {
        businessId: ids.firmA,
        clientId: c.id,
        staffUserId: ids.staffA,
        locationKind: 'PHONE',
        startsAt: new Date('2034-01-01T10:00:00Z'),
        endsAt: new Date('2034-01-01T11:00:00Z'),
      },
    });
    await touched();
    expect(stamps.map((d) => d.getTime())).toEqual(
      [...stamps].map((d) => d.getTime()).sort((a, b) => a - b),
    );
    // A caller can move it forward, but not back or clear it.
    const later = days(1);
    await A().client.update({ where: { id: c.id }, data: { lastActivityAt: later } });
    expect((await fresh(c.id)).lastActivityAt).toEqual(later);
    await A().client.update({ where: { id: c.id }, data: { lastActivityAt: days(-5) } });
    expect((await fresh(c.id)).lastActivityAt).toEqual(later);
    await A().client.update({ where: { id: c.id }, data: { lastActivityAt: null } });
    expect((await fresh(c.id)).lastActivityAt).toEqual(later);
  });
});
