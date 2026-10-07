import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { runInScope } from '@firmivra/db';
import {
  ListAdminApplicationsResponse,
  GetAdminApplicationResponse,
  ListAdminApplicationHistoryResponse,
} from '@firmivra/types';
import { firmFixtures } from '../helpers/firm-fixtures.js';
import { installDraftSchema, applicationHistoryFixture } from '../helpers/draft-schema.js';
let fx: Awaited<ReturnType<typeof firmFixtures>>,
  admin: string,
  owner: string,
  client: string,
  id: string;
const api = () => request(fx.app.getHttpServer());
beforeAll(async () => {
  fx = await firmFixtures('applications');
  [admin, owner, client] = await Promise.all([
    fx.token('superAdmin'),
    fx.token('ownerA'),
    fx.token('clientA'),
  ]);
  await installDraftSchema(fx.owner, applicationHistoryFixture);
  id = (
    await runInScope(fx.owner, { kind: 'platform' }, (tx) =>
      tx.firmApplication.create({
        data: {
          legalName: fx.firmA.slug,
          contactName: 'Synthetic applicant',
          contactEmail: 'applicant@synthetic.test',
          data: { city: 'Synthetic', ssn: 'synthetic-secret', website: 'javascript:alert(1)' },
        },
      }),
    )
  ).id;
  await runInScope(
    fx.owner,
    { kind: 'platform' },
    (tx) =>
      tx.$executeRaw`INSERT INTO firm_application_histories (id,application_id,to_status) VALUES (${randomUUID()}::uuid,${id}::uuid,'PENDING_REVIEW')`,
  );
});
afterAll(async () => await fx?.close());
describe('read-only Super Admin application data', () => {
  it('lists, filters, pages and validates ranges', async () => {
    const result = await api()
      .get(`/api/v1/admin/applications?search=${fx.firmA.slug}&status=PENDING_REVIEW&limit=1`)
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(ListAdminApplicationsResponse.safeParse(result.body).success).toBe(true);
    expect(result.body.items.map((row: { id: string }) => row.id)).toEqual([id]);
    await api()
      .get('/api/v1/admin/applications?from=2026-10-07T00:00:00Z&to=2026-10-06T00:00:00Z')
      .auth(admin, { type: 'bearer' })
      .expect(400);
    await api()
      .get('/api/v1/admin/applications?cursor=bad')
      .auth(admin, { type: 'bearer' })
      .expect(400);
  });
  it('reads the allowlist without raw form data or tenant content', async () => {
    const result = await api()
      .get(`/api/v1/admin/applications/${id}`)
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(GetAdminApplicationResponse.safeParse(result.body).success).toBe(true);
    expect(result.body.form.city).toBe('Synthetic');
    expect(result.body.form.website).toBeNull();
    expect(JSON.stringify(result.body)).not.toContain('synthetic-secret');
    await api()
      .get(`/api/v1/admin/applications/${randomUUID()}`)
      .auth(admin, { type: 'bearer' })
      .expect(404);
  });
  it('reads real platform history with a read-only application DB role', async () => {
    const result = await api()
      .get(`/api/v1/admin/applications/${id}/history`)
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(ListAdminApplicationHistoryResponse.safeParse(result.body).success).toBe(true);
    expect(result.body.items[0].toStatus).toBe('PENDING_REVIEW');
    await api()
      .get(`/api/v1/admin/applications/${randomUUID()}/history`)
      .auth(admin, { type: 'bearer' })
      .expect(404);
  });
  it('denies every route to firm users and clients; exposes no approval actions', async () => {
    for (const path of ['', `/${id}`, `/${id}/history`])
      for (const token of [owner, client])
        await api()
          .get(`/api/v1/admin/applications${path}`)
          .auth(token, { type: 'bearer' })
          // Existing admin routes require the ADMIN identity pool at authentication.
          .expect(401);
    await api()
      .post(`/api/v1/admin/applications/${id}/approve`)
      .auth(admin, { type: 'bearer' })
      .send({})
      .expect(404);
  });
  it('denies ADMIN identity without a PlatformAdmin link', async () => {
    await runInScope(fx.owner, { kind: 'platform' }, (tx) =>
      tx.platformAdmin.delete({ where: { userId: fx.users.superAdmin.id } }),
    );
    for (const path of ['', `/${id}`, `/${id}/history`])
      await api()
        .get(`/api/v1/admin/applications${path}`)
        .auth(admin, { type: 'bearer' })
        .expect(403);
  });
});
