import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { GetBusinessSettingsResponse, GetPortalSettingsResponse } from '@firmivra/types';
import { firmFixtures } from '../helpers/firm-fixtures.js';
let fx: Awaited<ReturnType<typeof firmFixtures>>;
let owner: string, admin: string, staff: string, client: string, foreign: string;
const api = () => request(fx.app.getHttpServer());
beforeAll(async () => {
  fx = await firmFixtures('settings');
  [owner, admin, staff, client, foreign] = await Promise.all([
    fx.token('ownerA'),
    fx.token('adminA'),
    fx.token('staffA'),
    fx.token('clientA'),
    fx.token('ownerB'),
  ] as const);
});
afterAll(async () => {
  await fx?.close();
});
describe('firm settings and versioned setup/legal', () => {
  it('returns only the allowlisted settings and portal projections', async () => {
    await api().post('/api/v1/business/setup/complete').auth(owner, { type: 'bearer' }).expect(409);
    const res = await api()
      .get('/api/v1/business/settings')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(GetBusinessSettingsResponse.safeParse(res.body).success).toBe(true);
    const portal = await api()
      .get(`/api/v1/portal/${fx.firmA.slug}/settings`)
      .auth(client, { type: 'bearer' })
      .expect(200);
    expect(GetPortalSettingsResponse.safeParse(portal.body).success).toBe(true);
    expect(portal.body).not.toHaveProperty('logoKey');
    expect(portal.body).not.toHaveProperty('contactEmail');
  });
  it('updates allowed profile fields; rejects context injection and unknown fields', async () => {
    const res = await api()
      .patch('/api/v1/business/settings')
      .auth(admin, { type: 'bearer' })
      .send({ name: 'Synthetic updated', brandColor: '#123abc', contactPhone: null })
      .expect(200);
    expect(res.body.profile.name).toBe('Synthetic updated');
    for (const body of [
      { businessId: fx.firmB.id },
      { legalName: 'Forged' },
      {},
      { name: '   ' },
      { timezone: 'Not/A_Zone' },
      { brandColor: 'red' },
    ])
      await api()
        .patch('/api/v1/business/settings')
        .auth(owner, { type: 'bearer' })
        .send(body)
        .expect(400);
  });
  it('fails safely for unpublished storage/portal fields and does not commit a partial profile update', async () => {
    await api()
      .patch('/api/v1/business/settings')
      .auth(owner, { type: 'bearer' })
      .send({ name: 'Must roll back', portalHeader: 'Header' })
      .expect(503);
    const res = await api()
      .get('/api/v1/business/settings')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(res.body.profile.name).toBe('Synthetic updated');
    await api()
      .patch('/api/v1/business/settings')
      .auth(owner, { type: 'bearer' })
      .send({ logoKey: 'another-firm/logo.svg' })
      .expect(503);
    await api()
      .patch('/api/v1/business/settings')
      .auth(owner, { type: 'bearer' })
      .send({ enabledModules: ['unpaid-module'] })
      .expect(503);
  });
  it('serializes concurrent legal publication and retains every version', async () => {
    const publish = () =>
      api()
        .post('/api/v1/business/legal/TERMS')
        .auth(owner, { type: 'bearer' })
        .send({ bodyMarkdown: '# Synthetic terms' })
        .expect(201);
    const results = await Promise.all([publish(), publish()]);
    expect(results.map((r) => r.body.version).sort()).toEqual([1, 2]);
    await api()
      .post('/api/v1/business/legal/PRIVACY')
      .auth(owner, { type: 'bearer' })
      .send({ bodyMarkdown: '# Synthetic privacy' })
      .expect(201);
    const latest = await api()
      .get('/api/v1/business/legal/TERMS')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(latest.body.version).toBe(2);
    const previous = await api()
      .get(`/api/v1/portal/${fx.firmA.slug}/legal/TERMS?version=1`)
      .auth(client, { type: 'bearer' })
      .expect(200);
    expect(previous.body.version).toBe(1);
    await api()
      .get('/api/v1/business/legal/TERMS?version=99')
      .auth(owner, { type: 'bearer' })
      .expect(404);
  });
  it('saves draft progress and completes idempotently without changing firm approval status', async () => {
    await api()
      .patch('/api/v1/business/setup')
      .auth(owner, { type: 'bearer' })
      .send({ completedSteps: ['branding', 'businessDetails', 'team', 'clientPortal'] })
      .expect(200);
    const draft = await api()
      .get('/api/v1/business/setup')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(draft.body.completedAt).toBeNull();
    await api()
      .patch('/api/v1/business/setup')
      .auth(owner, { type: 'bearer' })
      .send({ completedSteps: ['finish'] })
      .expect(409);
    const first = await api()
      .post('/api/v1/business/setup/complete')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    const second = await api()
      .post('/api/v1/business/setup/complete')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(second.body.completedAt).toBe(first.body.completedAt);
    expect(second.body.completedSteps).toContain('finish');
  });
  it('denies every settings/setup/legal endpoint to the wrong firm and role', async () => {
    const cases = [
      ['get', '/business/settings', undefined],
      ['patch', '/business/settings', { name: 'forged' }],
      ['get', '/business/setup', undefined],
      ['patch', '/business/setup', { completedSteps: [] }],
      ['post', '/business/setup/complete', undefined],
      ['get', '/business/legal/TERMS', undefined],
      ['post', '/business/legal/TERMS', { bodyMarkdown: 'forged' }],
    ] as const;
    for (const [method, path, body] of cases) {
      await api()
        [method](`/api/v1${path}`)
        .auth(foreign, { type: 'bearer' })
        .set('x-business-id', fx.firmA.id)
        .send(body)
        .expect(404);
      await api()[method](`/api/v1${path}`).auth(staff, { type: 'bearer' }).send(body).expect(403);
    }
    for (const path of ['settings', 'legal/TERMS'])
      await api()
        .get(`/api/v1/portal/${fx.firmA.slug}/${path}`)
        .auth(await fx.token('clientB'), { type: 'bearer' })
        .expect(404);
  });
  it('logs changes without contact values or legal bodies', async () => {
    const rows = await fx.owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.scope','business',true),set_config('app.current_business_id',${fx.firmA.id},true)`;
      return tx.auditLog.findMany({
        where: {
          businessId: fx.firmA.id,
          action: { in: ['business.settings.updated', 'business.legal.published'] },
        },
      });
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain('Synthetic terms');
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain('Synthetic updated');
  });
});
