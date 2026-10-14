// Integration requests (r39_integration_requests): a firm adds and reads its own; only Super
// Admin changes the status and the internal note, and nothing else about a request.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome, owner, db } = r39Fixtures(inject('dbUrls'));
const admin = randomUUID();
let req = '';

beforeAll(async () => {
  await setup();
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const email = `admin-${admin}@firmivra.test`;
    const data = { id: admin, cognitoSub: admin, pool: 'ADMIN' as const, email, name: 'Admin' };
    await tx.user.create({ data });
    await tx.platformAdmin.create({ data: { userId: admin } });
  });
  const data = {
    businessId: A.id,
    requestedByUserId: A.owner,
    providerName: 'Acme Books',
    connectTo: 'Invoices',
  };
  req = (await as(A).integrationRequest.create({ data })).id;
});
afterAll(close);

describe('integration requests', () => {
  it("are the firm's own, and firm B sees nothing", async () => {
    expect(await as(B).integrationRequest.findMany()).toEqual([]);
    const data = {
      businessId: A.id,
      requestedByUserId: B.owner,
      providerName: 'X',
      connectTo: 'Y',
    };
    expect(await outcome(as(B).integrationRequest.create({ data }))).toMatch(/row-level security/);
  });
  it('are not changed by the firm, only reviewed by Super Admin', async () => {
    expect((await as(A).integrationRequest.updateMany({ data: { status: 'PLANNED' } })).count).toBe(
      0,
    );
    expect(await db.forAdmin(admin).integrationRequest.count()).toBeGreaterThan(0);
    const review = { status: 'PLANNED' as const, internalNote: 'Next quarter' };
    const done = await db
      .forAdmin(admin)
      .integrationRequest.update({ where: { id: req }, data: review });
    expect(done.statusChangedAt).not.toBeNull();
    const other = db
      .forAdmin(admin)
      .integrationRequest.update({ where: { id: req }, data: { providerName: 'Other' } });
    expect(await outcome(other)).toMatch(/REQUEST_FROZEN/);
  });
  it('check names, URLs and text', async () => {
    const make = (d: object) =>
      outcome(
        as(A).integrationRequest.create({
          data: {
            businessId: A.id,
            requestedByUserId: A.owner,
            providerName: 'P',
            connectTo: 'C',
            ...d,
          },
        }),
      );
    expect(await make({ websiteUrl: 'javascript:alert(1)' })).toMatch(/requests_values/);
    expect(await make({ providerName: '   ' })).toMatch(/requests_values/);
    expect(await make({ websiteUrl: 'https://example.test' })).toBe('ok');
  });
});
