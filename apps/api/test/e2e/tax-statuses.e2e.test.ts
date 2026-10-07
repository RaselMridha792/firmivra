import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { runInScope } from '@firmivra/db';
import { ListTaxStatusesResponse } from '@firmivra/types';
import { firmFixtures } from '../helpers/firm-fixtures.js';
let fx: Awaited<ReturnType<typeof firmFixtures>>;
let owner: string, admin: string, staff: string, client: string, foreign: string;
let openId: string, doneId: string, foreignId: string, assignmentId: string, historyId: string;
const api = () => request(fx.app.getHttpServer());
beforeAll(async () => {
  fx = await firmFixtures('tax-statuses');
  [owner, admin, staff, client, foreign] = await Promise.all([
    fx.token('ownerA'),
    fx.token('adminA'),
    fx.token('staffA'),
    fx.token('clientA'),
    fx.token('ownerB'),
  ] as const);
  foreignId = (
    await runInScope(fx.owner, { kind: 'business', businessId: fx.firmB.id }, (tx) =>
      tx.taxStatus.create({ data: { businessId: fx.firmB.id, name: 'Synthetic foreign' } }),
    )
  ).id;
});
afterAll(async () => await fx?.close());
describe('tax status configuration APIs', () => {
  it('creates trimmed, case-insensitively unique status definitions', async () => {
    const open = await api()
      .post('/api/v1/business/tax-statuses')
      .auth(owner, { type: 'bearer' })
      .send({ name: ' Open ' })
      .expect(201);
    openId = open.body.id;
    expect(open.body.name).toBe('Open');
    await api()
      .post('/api/v1/business/tax-statuses')
      .auth(admin, { type: 'bearer' })
      .send({ name: 'open' })
      .expect(409);
    doneId = (
      await api()
        .post('/api/v1/business/tax-statuses')
        .auth(admin, { type: 'bearer' })
        .send({ name: 'Done' })
        .expect(201)
    ).body.id;
    await api()
      .post('/api/v1/business/tax-statuses')
      .auth(owner, { type: 'bearer' })
      .send({ name: '   ' })
      .expect(400);
    await api()
      .post('/api/v1/business/tax-statuses')
      .auth(owner, { type: 'bearer' })
      .send({ name: 'forged', businessId: fx.firmB.id })
      .expect(400);
  });
  it('permits staff reads and atomically reorders the full active set', async () => {
    const list = await api()
      .get('/api/v1/business/tax-statuses')
      .auth(staff, { type: 'bearer' })
      .expect(200);
    expect(ListTaxStatusesResponse.safeParse(list.body).success).toBe(true);
    const sorted = await api()
      .put('/api/v1/business/tax-statuses/order')
      .auth(owner, { type: 'bearer' })
      .send({ ids: [doneId, openId] })
      .expect(200);
    expect(sorted.body.items.map((row: { id: string }) => row.id)).toEqual([doneId, openId]);
    await api()
      .put('/api/v1/business/tax-statuses/order')
      .auth(owner, { type: 'bearer' })
      .send({ ids: [doneId] })
      .expect(409);
    await api()
      .put('/api/v1/business/tax-statuses/order')
      .auth(owner, { type: 'bearer' })
      .send({ ids: [foreignId, openId] })
      .expect(404);
    await api()
      .put('/api/v1/business/tax-statuses/order')
      .auth(owner, { type: 'bearer' })
      .send({ ids: [doneId, doneId] })
      .expect(400);
  });
  it('renames configuration without rewriting existing client assignment or history', async () => {
    await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, async (tx) => {
      const account = await tx.clientAccount.findFirstOrThrow({
        where: { userId: fx.users.clientA.id },
      });
      assignmentId = (
        await tx.clientTaxStatus.create({
          data: {
            businessId: fx.firmA.id,
            clientId: account.clientId!,
            taxYear: 2025,
            taxStatusId: openId,
            updatedByUserId: fx.users.ownerA.id,
          },
        })
      ).id;
      historyId = (
        await tx.clientTaxStatusHistory.findFirstOrThrow({
          where: { businessId: fx.firmA.id, taxStatusId: openId },
        })
      ).id;
    });
    await api()
      .patch(`/api/v1/business/tax-statuses/${openId}`)
      .auth(owner, { type: 'bearer' })
      .send({ name: 'In progress' })
      .expect(200);
    await api()
      .patch(`/api/v1/business/tax-statuses/${openId}`)
      .auth(owner, { type: 'bearer' })
      .send({ name: 'Done' })
      .expect(409);
    const preserved = await runInScope(
      fx.owner,
      { kind: 'business', businessId: fx.firmA.id },
      async (tx) => ({
        assignment: await tx.clientTaxStatus.findUnique({ where: { id: assignmentId } }),
        history: await tx.clientTaxStatusHistory.findUnique({ where: { id: historyId } }),
      }),
    );
    expect(preserved.assignment?.taxStatusId).toBe(openId);
    expect(preserved.history?.taxStatusId).toBe(openId);
  });
  it('archives idempotently, filters default lists and preserves referenced records', async () => {
    const first = await api()
      .post(`/api/v1/business/tax-statuses/${openId}/archive`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    const second = await api()
      .post(`/api/v1/business/tax-statuses/${openId}/archive`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(second.body.archivedAt).toBe(first.body.archivedAt);
    const active = await api()
      .get('/api/v1/business/tax-statuses')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(active.body.items.map((row: { id: string }) => row.id)).toEqual([doneId]);
    const all = await api()
      .get('/api/v1/business/tax-statuses?includeArchived=true')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(all.body.items).toHaveLength(2);
    await api()
      .put('/api/v1/business/tax-statuses/order')
      .auth(owner, { type: 'bearer' })
      .send({ ids: [openId, doneId] })
      .expect(409);
  });
  it('denies wrong-firm and wrong-role access to every route', async () => {
    const cases = [
      ['get', '', undefined],
      ['post', '', { name: 'new' }],
      ['put', '/order', { ids: [doneId] }],
      ['patch', `/${doneId}`, { name: 'renamed' }],
      ['post', `/${doneId}/archive`, undefined],
    ] as const;
    for (const [method, path, body] of cases) {
      await api()
        [method](`/api/v1/business/tax-statuses${path}`)
        .auth(foreign, { type: 'bearer' })
        .set('x-business-id', fx.firmA.id)
        .send(body)
        .expect(404);
      await api()
        [method](`/api/v1/business/tax-statuses${path}`)
        .auth(client, { type: 'bearer' })
        .send(body)
        .expect(403);
      if (method !== 'get')
        await api()
          [method](`/api/v1/business/tax-statuses${path}`)
          .auth(staff, { type: 'bearer' })
          .send(body)
          .expect(403);
    }
    await api()
      .patch(`/api/v1/business/tax-statuses/${foreignId}`)
      .auth(owner, { type: 'bearer' })
      .send({ name: 'bad' })
      .expect(404);
    await api()
      .post(`/api/v1/business/tax-statuses/${foreignId}/archive`)
      .auth(owner, { type: 'bearer' })
      .expect(404);
  });
});
