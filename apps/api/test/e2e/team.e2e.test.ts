import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { runInScope } from '@firmivra/db';
import { ListTeamMembersResponse } from '@firmivra/types';
import { firmFixtures } from '../helpers/firm-fixtures.js';
import { InviteResender } from '../../src/team/invite-resender.js';
let fx: Awaited<ReturnType<typeof firmFixtures>>;
let owner: string, admin: string, staff: string, foreign: string;
let ownerId: string, adminId: string, staffId: string, pendingId: string;
const resend = vi.fn().mockResolvedValue(undefined);
const api = () => request(fx.app.getHttpServer());
beforeAll(async () => {
  fx = await firmFixtures('team', (builder) =>
    builder.overrideProvider(InviteResender).useValue({ resend }),
  );
  [owner, admin, staff, foreign] = await Promise.all([
    fx.token('ownerA'),
    fx.token('adminA'),
    fx.token('staffA'),
    fx.token('ownerB'),
  ] as const);
  const invitedUserId = randomUUID();
  await runInScope(fx.owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: {
        id: invitedUserId,
        cognitoSub: invitedUserId,
        name: 'Synthetic invited',
        email: `invited-${invitedUserId}@synthetic.test`,
        pool: 'STAFF',
      },
    }),
  );
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, async (tx) => {
    const rows = await tx.membership.findMany({ where: { businessId: fx.firmA.id } });
    ownerId = rows.find((row) => row.userId === fx.users.ownerA.id)!.id;
    adminId = rows.find((row) => row.userId === fx.users.adminA.id)!.id;
    staffId = rows.find((row) => row.userId === fx.users.staffA.id)!.id;
    pendingId = (
      await tx.membership.create({
        data: { businessId: fx.firmA.id, userId: invitedUserId, role: 'STAFF', status: 'INVITED' },
      })
    ).id;
  });
});
afterAll(async () => {
  await fx?.close();
});
describe('team APIs', () => {
  it('lists stable scoped pages and rejects cursor replay in another filter', async () => {
    const first = await api()
      .get('/api/v1/business/team?limit=1')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(ListTeamMembersResponse.safeParse(first.body).success).toBe(true);
    expect(first.body.nextCursor).toBeTruthy();
    const next = await api()
      .get('/api/v1/business/team')
      .query({ limit: 1, cursor: first.body.nextCursor })
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(next.body.items[0].id).not.toBe(first.body.items[0].id);
    await api()
      .get('/api/v1/business/team')
      .query({ status: 'ACTIVE', cursor: first.body.nextCursor })
      .auth(owner, { type: 'bearer' })
      .expect(400);
  });
  it('protects owner/admin roles and the last active owner', async () => {
    for (const [method, path, body] of [
      ['get', '', undefined],
      ['patch', `/${pendingId}/role`, { role: 'STAFF' }],
      ['post', `/${pendingId}/deactivate`, undefined],
      ['post', `/${pendingId}/resend-invite`, undefined],
    ] as const)
      await api()
        [method](`/api/v1/business/team${path}`)
        .auth(staff, { type: 'bearer' })
        .send(body)
        .expect(403);
    await api()
      .patch(`/api/v1/business/team/${ownerId}/role`)
      .auth(admin, { type: 'bearer' })
      .send({ role: 'STAFF' })
      .expect(403);
    await api()
      .patch(`/api/v1/business/team/${staffId}/role`)
      .auth(admin, { type: 'bearer' })
      .send({ role: 'OWNER' })
      .expect(403);
    await api()
      .post(`/api/v1/business/team/${adminId}/deactivate`)
      .auth(admin, { type: 'bearer' })
      .expect(403);
    await api()
      .post(`/api/v1/business/team/${ownerId}/deactivate`)
      .auth(owner, { type: 'bearer' })
      .expect(409);
    await api()
      .patch(`/api/v1/business/team/${ownerId}/role`)
      .auth(owner, { type: 'bearer' })
      .send({ role: 'STAFF' })
      .expect(409);
    await api()
      .patch(`/api/v1/business/team/${pendingId}/role`)
      .auth(owner, { type: 'bearer' })
      .send({ role: 'ADMIN' })
      .expect(200);
    await api()
      .patch(`/api/v1/business/team/${pendingId}/role`)
      .auth(owner, { type: 'bearer' })
      .send({ role: 'STAFF' })
      .expect(200);
    await api()
      .patch(`/api/v1/business/team/${pendingId}/role`)
      .auth(owner, { type: 'bearer' })
      .send({ businessId: fx.firmB.id, role: 'STAFF' })
      .expect(400);
  });
  it('delegates invite resend without returning secret tokens or URLs', async () => {
    const res = await api()
      .post(`/api/v1/business/team/${pendingId}/resend-invite`)
      .auth(owner, { type: 'bearer' })
      .expect(202);
    expect(res.body).toEqual({ accepted: true });
    expect(resend).toHaveBeenCalledWith({
      businessId: fx.firmA.id,
      membershipId: pendingId,
      actorUserId: fx.users.ownerA.id,
    });
    await api()
      .post(`/api/v1/business/team/${ownerId}/resend-invite`)
      .auth(owner, { type: 'bearer' })
      .expect(409);
  });
  it('deactivates a membership idempotently without disabling the global identity', async () => {
    await runInScope(fx.owner, { kind: 'business', businessId: fx.firmB.id }, (tx) =>
      tx.membership.create({
        data: {
          businessId: fx.firmB.id,
          userId: fx.users.staffA.id,
          role: 'STAFF',
          status: 'ACTIVE',
        },
      }),
    );
    await api()
      .post(`/api/v1/business/team/${staffId}/deactivate`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    const again = await api()
      .post(`/api/v1/business/team/${staffId}/deactivate`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(again.body.status).toBe('DEACTIVATED');
    const user = await runInScope(fx.owner, { kind: 'platform' }, (tx) =>
      tx.user.findUnique({ where: { id: fx.users.staffA.id } }),
    );
    expect(user).toBeTruthy();
    const other = await runInScope(fx.owner, { kind: 'business', businessId: fx.firmB.id }, (tx) =>
      tx.membership.findFirst({ where: { businessId: fx.firmB.id, userId: fx.users.staffA.id } }),
    );
    expect(other?.status).toBe('ACTIVE');
  });
  it('blocks every route for a foreign firm and staff/client callers', async () => {
    const foreignId = (await runInScope(
      fx.owner,
      { kind: 'business', businessId: fx.firmB.id },
      (tx) => tx.membership.findFirst({ where: { businessId: fx.firmB.id } }),
    ))!.id;
    for (const [method, path, body] of [
      ['get', '', undefined],
      ['patch', `/${pendingId}/role`, { role: 'STAFF' }],
      ['post', `/${pendingId}/deactivate`, undefined],
      ['post', `/${pendingId}/resend-invite`, undefined],
    ] as const) {
      await api()
        [method](`/api/v1/business/team${path}`)
        .auth(foreign, { type: 'bearer' })
        .set('x-business-id', fx.firmA.id)
        .send(body)
        .expect(404);
      await api()
        [method](`/api/v1/business/team${path}`)
        .auth(await fx.token('clientA'), { type: 'bearer' })
        .send(body)
        .expect(403);
    }
    await api()
      .patch(`/api/v1/business/team/${foreignId}/role`)
      .auth(owner, { type: 'bearer' })
      .send({ role: 'OWNER' })
      .expect(404);
    await api()
      .get('/api/v1/business/team')
      .auth(staff, { type: 'bearer' })
      .set('x-business-id', fx.firmA.id)
      .expect(404);
  });
  it('serializes simultaneous owner demotions so the firm always retains an owner', async () => {
    await api()
      .patch(`/api/v1/business/team/${adminId}/role`)
      .auth(owner, { type: 'bearer' })
      .send({ role: 'OWNER' })
      .expect(200);
    const outcomes = await Promise.all([
      api()
        .patch(`/api/v1/business/team/${adminId}/role`)
        .auth(owner, { type: 'bearer' })
        .send({ role: 'STAFF' }),
      api()
        .patch(`/api/v1/business/team/${ownerId}/role`)
        .auth(admin, { type: 'bearer' })
        .send({ role: 'STAFF' }),
    ]);
    expect(outcomes.filter((res) => res.status === 200)).toHaveLength(1);
    const count = await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
      tx.membership.count({ where: { businessId: fx.firmA.id, role: 'OWNER', status: 'ACTIVE' } }),
    );
    expect(count).toBe(1);
  });
});
