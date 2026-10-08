// R0 step 3 rules: clients and their tax status history. Client records are never deleted,
// history is written by the database, and no link can point at another firm. Runs as the app role.
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
  loginA: randomUUID(),
  loginB: randomUUID(),
  filedA: '',
  reviewA: '',
  archivedA: '',
  filedB: '',
  clientB: '',
};

const firmA = () => db.forBusiness(ids.firmA);
const newClientA = () =>
  firmA().client.create({ data: { businessId: ids.firmA, displayName: `Client ${randomUUID()}` } });
const history = (clientId: string) =>
  firmA().clientTaxStatusHistory.findMany({ where: { clientId } });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.staffA, 'STAFF'],
      [ids.ownerB, 'STAFF'],
      [ids.loginA, 'CLIENT'],
      [ids.loginB, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@c.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `ca-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `cb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmA, userId: ids.staffA, role: 'STAFF', status: 'ACTIVE' },
    });
    const status = (name: string, archivedAt?: Date) =>
      tx.taxStatus.create({ data: { businessId: ids.firmA, name, archivedAt } });
    ids.filedA = (await status('Filed')).id;
    ids.reviewA = (await status('Ready for review')).id;
    ids.archivedA = (await status('Old status', new Date())).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: ids.ownerB, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.filedB = (await tx.taxStatus.create({ data: { businessId: ids.firmB, name: 'Filed' } })).id;
    ids.clientB = (
      await tx.client.create({ data: { businessId: ids.firmB, displayName: 'B1' } })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('clients', () => {
  it('a firm adds a client with no portal login, a profile, then links a login', async () => {
    const c = await firmA().client.create({
      data: {
        businessId: ids.firmA,
        accountType: 'BUSINESS',
        displayName: 'Acme Widgets LLC (fake)',
        email: 'books@acme.test',
        assignedUserId: ids.staffA,
      },
    });
    await firmA().clientProfile.create({
      data: {
        clientId: c.id,
        businessId: ids.firmA,
        businessName: 'Acme Widgets LLC',
        entityType: 'LLC',
      },
    });
    const login = await firmA().clientAccount.create({
      data: {
        businessId: ids.firmA,
        userId: ids.loginA,
        clientId: c.id,
        email: `${ids.loginA}@c.test`,
        status: 'INVITED',
      },
    });
    expect(login).toMatchObject({ portalRole: 'PRIMARY', status: 'INVITED' });
  });

  it('one email per firm, archived clients included; another firm may use it', async () => {
    const email = `same-${randomUUID()}@c.test`;
    const first = await firmA().client.create({
      data: { businessId: ids.firmA, displayName: 'First', email },
    });
    const again = () =>
      firmA().client.create({ data: { businessId: ids.firmA, displayName: 'Second', email } });
    await expect(again()).rejects.toThrow(/unique constraint/i);
    await firmA().client.update({ where: { id: first.id }, data: { archivedAt: new Date() } });
    await expect(again()).rejects.toThrow(/unique constraint/i);
    await expect(
      db.forBusiness(ids.firmB).client.create({
        data: { businessId: ids.firmB, displayName: 'Other firm', email },
      }),
    ).resolves.toMatchObject({ email });
  });

  it('can be archived but never deleted', async () => {
    const c = await newClientA();
    await expect(
      firmA().client.update({ where: { id: c.id }, data: { archivedAt: new Date() } }),
    ).resolves.toMatchObject({ id: c.id });
    await expect(firmA().client.deleteMany({ where: { id: c.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('checks email case, blank names and the SSN last 4', async () => {
    await expect(
      firmA().client.create({
        data: { businessId: ids.firmA, displayName: 'X', email: 'A@x.test' },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      firmA().client.create({ data: { businessId: ids.firmA, displayName: ' ' } }),
    ).rejects.toThrow(/check constraint/i);
    const c = await newClientA();
    await expect(
      firmA().clientProfile.create({
        data: { clientId: c.id, businessId: ids.firmA, ssnLast4: '12345' },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      firmA().clientProfile.create({
        data: { clientId: c.id, businessId: ids.firmA, einLast4: '12-34' },
      }),
    ).rejects.toThrow(/check constraint/i);
  });

  it("keeps the client's additional information short (My Profile)", async () => {
    const c = await newClientA();
    const profile = (data: object) =>
      firmA().clientProfile.create({ data: { clientId: c.id, businessId: ids.firmA, ...data } });
    for (const data of [
      { referralSource: ' ' },
      { referralSource: 'x'.repeat(201) },
      { additionalInfo: ' ' },
      { additionalInfo: 'x'.repeat(2001) },
    ]) {
      await expect(profile(data)).rejects.toThrow(/check constraint/i);
    }
    await expect(
      profile({
        preferredContactMethod: 'TEXT',
        referralSource: 'A friend',
        additionalInfo: 'Prefers mornings.',
      }),
    ).resolves.toMatchObject({ preferredContactMethod: 'TEXT' });
  });
});

describe('same-firm links (foreign keys skip RLS, so the keys include business_id)', () => {
  it('a client cannot be assigned to a staff member of another firm', async () => {
    await expect(
      firmA().client.create({
        data: { businessId: ids.firmA, displayName: 'X', assignedUserId: ids.ownerB },
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("firm A cannot attach a profile, login or tax status to firm B's client", async () => {
    await expect(
      firmA().clientProfile.create({ data: { clientId: ids.clientB, businessId: ids.firmA } }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      firmA().clientAccount.create({
        data: {
          businessId: ids.firmA,
          userId: ids.loginB,
          clientId: ids.clientB,
          email: 'b@c.test',
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      firmA().clientTaxStatus.create({
        data: {
          businessId: ids.firmA,
          clientId: ids.clientB,
          taxYear: 2025,
          taxStatusId: ids.filedA,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("firm A cannot use firm B's tax status", async () => {
    const c = await newClientA();
    await expect(
      firmA().clientTaxStatus.create({
        data: { businessId: ids.firmA, clientId: c.id, taxYear: 2025, taxStatusId: ids.filedB },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('client tax status history', () => {
  it('records the first status and every change, but not an update that changes nothing', async () => {
    const c = await newClientA();
    const row = await firmA().clientTaxStatus.create({
      data: {
        businessId: ids.firmA,
        clientId: c.id,
        taxYear: 2025,
        taxStatusId: ids.reviewA,
        updatedByUserId: ids.staffA,
      },
    });
    await firmA().clientTaxStatus.update({
      where: { id: row.id },
      data: { taxStatusId: ids.filedA, clientNote: 'Filed on time.' },
    });
    await firmA().clientTaxStatus.update({
      where: { id: row.id },
      data: { updatedByUserId: null },
    });

    // Two changes can land in the same millisecond, so compare without relying on order.
    const rows = (await history(c.id)).map((r) => [r.taxStatusId, r.clientNote, r.changedByUserId]);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        [ids.reviewA, null, ids.staffA],
        [ids.filedA, 'Filed on time.', ids.staffA],
      ]),
    );
  });

  it('keeps each row to one client and year', async () => {
    const c = await newClientA();
    const row = await firmA().clientTaxStatus.create({
      data: { businessId: ids.firmA, clientId: c.id, taxYear: 2024, taxStatusId: ids.filedA },
    });
    await expect(
      firmA().clientTaxStatus.update({ where: { id: row.id }, data: { taxYear: 2023 } }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      firmA().clientTaxStatus.create({
        data: { businessId: ids.firmA, clientId: c.id, taxYear: 2024, taxStatusId: ids.reviewA },
      }),
    ).rejects.toThrow();
    await expect(
      firmA().clientTaxStatus.create({
        data: { businessId: ids.firmA, clientId: c.id, taxYear: 1999, taxStatusId: ids.filedA },
      }),
    ).rejects.toThrow(/check constraint/i);
  });

  it('does not assign an archived tax status', async () => {
    const c = await newClientA();
    await expect(
      firmA().clientTaxStatus.create({
        data: { businessId: ids.firmA, clientId: c.id, taxYear: 2025, taxStatusId: ids.archivedA },
      }),
    ).rejects.toThrow(/archived/);
  });

  it('history cannot be edited or deleted by the app', async () => {
    await expect(
      firmA().clientTaxStatusHistory.updateMany({ data: { clientNote: 'rewritten' } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(firmA().clientTaxStatusHistory.deleteMany({})).rejects.toThrow(
      /permission denied/i,
    );
  });
});
