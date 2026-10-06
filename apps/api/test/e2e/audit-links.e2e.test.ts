import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { ForbiddenException } from '@nestjs/common';
import { runInScope, type Database, type TxClient } from '@firmivra/db';
import { ListFirmAuditLogsResponse, ListPortalExternalLinksResponse } from '@firmivra/types';
import { DATABASE } from '../../src/database/database.module.js';
import { requestContext } from '../../src/common/request-context.js';
import {
  ApprovedSupportAccess,
  type ApprovedSupportScope,
} from '../../src/audit-viewer/support.ports.js';
import { missing } from '../../src/firm-common/context.js';
import { ExternalLinksService } from '../../src/external-links/external-links.service.js';
import { firmFixtures } from '../helpers/firm-fixtures.js';
import { installDraftSchema } from '../helpers/draft-schema.js';
import { externalLinksSchema } from '../fixtures/external-links-schema.js';
let fx: Awaited<ReturnType<typeof firmFixtures>>,
  owner: string,
  admin: string,
  staff: string,
  client: string,
  individual: string,
  superAdmin: string,
  foreign: string,
  foreignClient: string,
  grantId: string,
  resourceId: string,
  foreignLink: string;
const api = () => request(fx.app.getHttpServer());
const support = {
  /** Test-only stand-in for Rasel's adapter, using the actual DB approval/revocation rules. */
  async withFirm<T>(
    businessId: string,
    adminUserId: string,
    read: (tx: TxClient, scope: ApprovedSupportScope) => Promise<T>,
  ): Promise<T> {
    return fx.app
      .get<Database>(DATABASE)
      .withScope({ kind: 'business', businessId }, async (tx) => {
        const [grant] = await tx.$queryRaw<
          { id: string; approved: boolean; live: boolean }[]
        >`SELECT id,(granted_by_user_id IS NOT NULL) AS approved,(expires_at>now() AND revoked_at IS NULL) AS live FROM support_access_grants WHERE business_id=${businessId}::uuid AND admin_user_id=${adminUserId}::uuid ORDER BY created_at DESC LIMIT 1 FOR SHARE`;
        if (!grant) throw missing();
        if (!grant.approved || !grant.live)
          throw new ForbiddenException({
            code: 'SUPPORT_GRANT_REQUIRED',
            message: 'An approved live support grant is required',
          });
        return read(tx, { businessId, adminUserId, grantId: grant.id });
      });
  },
};
const own = async <T>(work: () => Promise<T>) =>
  requestContext.run(
    {
      requestId: randomUUID(),
      auth: { userId: fx.users.ownerA.id, cognitoSub: fx.users.ownerA.id, pool: 'STAFF' },
      tenant: { businessId: fx.firmA.id, kind: 'staff', role: 'OWNER' },
    },
    work,
  );
beforeAll(async () => {
  fx = await firmFixtures('audit-links', (builder) =>
    builder.overrideProvider(ApprovedSupportAccess).useValue(support),
  );
  await installDraftSchema(fx.owner, externalLinksSchema);
  [owner, admin, staff, client, individual, superAdmin, foreign, foreignClient] = await Promise.all(
    [
      fx.token('ownerA'),
      fx.token('adminA'),
      fx.token('staffA'),
      fx.token('clientA'),
      fx.token('otherClientA'),
      fx.token('superAdmin'),
      fx.token('ownerB'),
      fx.token('clientB'),
    ],
  );
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, async (tx) => {
    for (let i = 0; i < 3; i++)
      await tx.auditLog.create({
        data: {
          businessId: fx.firmA.id,
          actorUserId: fx.users.ownerA.id,
          action: 'synthetic.changed',
          entityType: 'synthetic',
          entityId: randomUUID(),
          metadata: {
            count: i,
            newRole: 'STAFF',
            token: 'synthetic-private',
            body: 'synthetic-private',
          },
          requestId: randomUUID(),
        },
      });
  });
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmB.id }, async (tx) => {
    await tx.auditLog.create({
      data: {
        businessId: fx.firmB.id,
        actorUserId: fx.users.ownerB.id,
        action: 'foreign.changed',
        entityType: 'synthetic',
      },
    });
    foreignLink = randomUUID();
    await tx.$executeRaw`INSERT INTO external_links(id,business_id,section,title,description,url,source,sort_order,active,audience) VALUES(${foreignLink}::uuid,${fx.firmB.id}::uuid,'IRS_TAX','Foreign synthetic','Reference','https://www.irs.gov/ein','IRS',0,true,'BUSINESS')`;
  });
  grantId = (
    await runInScope(fx.owner, { kind: 'platform' }, (tx) =>
      tx.supportAccessGrant.create({
        data: {
          businessId: fx.firmA.id,
          adminUserId: fx.users.superAdmin.id,
          reason: 'Synthetic test support',
        },
      }),
    )
  ).id;
});
afterAll(async () => await fx?.close());
describe('audit viewer and external resources', () => {
  it('filters and pages owner-only audit events with safe metadata', async () => {
    const query = `action=synthetic.changed&entityType=synthetic&actorUserId=${fx.users.ownerA.id}&limit=1`;
    const first = await api()
      .get(`/api/v1/business/audit-logs?${query}`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(ListFirmAuditLogsResponse.safeParse(first.body).success).toBe(true);
    expect(first.body.nextCursor).toBeTruthy();
    expect(JSON.stringify(first.body)).not.toContain('synthetic-private');
    const next = await api()
      .get(`/api/v1/business/audit-logs?${query}&cursor=${first.body.nextCursor}`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(next.body.items[0].id).not.toBe(first.body.items[0].id);
    for (const token of [admin, staff, client])
      await api().get('/api/v1/business/audit-logs').auth(token, { type: 'bearer' }).expect(403);
    await api()
      .get('/api/v1/business/audit-logs')
      .auth(foreign, { type: 'bearer' })
      .set('x-business-id', fx.firmA.id)
      .expect(404);
    await api()
      .get('/api/v1/business/audit-logs?from=2026-10-07T00:00:00Z&to=2026-10-06T00:00:00Z')
      .auth(owner, { type: 'bearer' })
      .expect(400);
    await api()
      .get('/api/v1/business/audit-logs?businessId=forged')
      .auth(owner, { type: 'bearer' })
      .expect(400);
  });
  it('requires a live owner-approved support grant on every platform read', async () => {
    const url = `/api/v1/admin/support/businesses/${fx.firmA.id}/audit-logs?action=synthetic.changed`;
    await api().get(url).auth(superAdmin, { type: 'bearer' }).expect(403);
    await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
      tx.supportAccessGrant.update({
        where: { id: grantId },
        data: { grantedByUserId: fx.users.ownerA.id, expiresAt: new Date(Date.now() + 3600000) },
      }),
    );
    const result = await api().get(url).auth(superAdmin, { type: 'bearer' }).expect(200);
    expect(result.body.items).toHaveLength(3);
    expect(JSON.stringify(result.body)).not.toContain('synthetic-private');
    await api()
      .get(`/api/v1/admin/support/businesses/${fx.firmB.id}/audit-logs`)
      .auth(superAdmin, { type: 'bearer' })
      .expect(404);
    await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
      tx.supportAccessGrant.update({ where: { id: grantId }, data: { revokedAt: new Date() } }),
    );
    await api().get(url).auth(superAdmin, { type: 'bearer' }).expect(403);
    const logs = await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
      tx.auditLog.findMany({ where: { action: 'audit.support_viewed' } }),
    );
    expect(logs[0]?.actorUserId).toBe(fx.users.superAdmin.id);
    expect((logs[0]?.metadata as { grantId: string }).grantId).toBe(grantId);
  });
  it('initializes all eight approved resources once without overwriting firm edits', async () => {
    const service = fx.app.get(ExternalLinksService);
    expect(await own(() => service.initializeDirectory())).toEqual({ count: 8 });
    expect(await own(() => service.initializeDirectory())).toEqual({ count: 0 });
    const list = await api()
      .get('/api/v1/business/external-links')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(list.body.items).toHaveLength(8);
    resourceId = list.body.items[0].id;
    const portal = await api()
      .get(`/api/v1/portal/${fx.firmA.slug}/external-links`)
      .auth(client, { type: 'bearer' })
      .expect(200);
    expect(ListPortalExternalLinksResponse.safeParse(portal.body).success).toBe(true);
    expect(portal.body.items).toHaveLength(8);
    expect(portal.body.items[0].section).toBe('IRS_TAX');
    expect(portal.body.items[0]).not.toHaveProperty('iconKey');
  });
  it('creates, edits and deactivates own configuration without deleting history references', async () => {
    const body = {
      section: 'IRS_TAX',
      title: 'Synthetic resource',
      description: 'Official resource information',
      url: 'https://www.irs.gov/businesses',
      source: 'IRS',
      iconKey: null,
      sortOrder: 99,
      active: true,
      audience: 'BUSINESS',
    };
    const created = await api()
      .post('/api/v1/business/external-links')
      .auth(admin, { type: 'bearer' })
      .send(body)
      .expect(201);
    const id = created.body.id;
    await api()
      .patch(`/api/v1/business/external-links/${id}`)
      .auth(owner, { type: 'bearer' })
      .send({ title: 'Updated resource', active: false })
      .expect(200);
    const list = await api()
      .get('/api/v1/business/external-links')
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(list.body.items.find((row: { id: string }) => row.id === id).active).toBe(false);
    const visible = await api()
      .get(`/api/v1/portal/${fx.firmA.slug}/external-links`)
      .auth(client, { type: 'bearer' })
      .expect(200);
    expect(visible.body.items.some((row: { id: string }) => row.id === id)).toBe(false);
    await api()
      .delete(`/api/v1/business/external-links/${id}`)
      .auth(owner, { type: 'bearer' })
      .expect(404);
    await api()
      .patch(`/api/v1/business/external-links/${foreignLink}`)
      .auth(owner, { type: 'bearer' })
      .send({ active: false })
      .expect(404);
    await api()
      .post('/api/v1/business/external-links')
      .auth(owner, { type: 'bearer' })
      .send({ ...body, iconKey: 'unknown-owner-key' })
      .expect(503);
  });
  it('rejects unsafe URLs, tenant injection and business-only access by an Individual', async () => {
    const body = {
      section: 'IRS_TAX',
      title: 'Synthetic',
      description: 'Reference',
      url: 'https://www.irs.gov/ein?token=synthetic',
      source: 'IRS',
      iconKey: null,
      sortOrder: 0,
      active: true,
      audience: 'ALL',
    };
    await api()
      .post('/api/v1/business/external-links')
      .auth(owner, { type: 'bearer' })
      .send(body)
      .expect(400);
    await api()
      .post('/api/v1/business/external-links')
      .auth(owner, { type: 'bearer' })
      .send({ ...body, url: 'https://www.irs.gov/ein', businessId: fx.firmB.id })
      .expect(400);
    await api()
      .get(`/api/v1/portal/${fx.firmA.slug}/external-links`)
      .auth(individual, { type: 'bearer' })
      .expect(403);
    await api().get('/api/v1/business/external-links').auth(staff, { type: 'bearer' }).expect(403);
  });
  it('rejects wrong-firm access on every resource endpoint and enforces raw RLS', async () => {
    for (const [method, path, body] of [
      ['get', '', undefined],
      ['post', '', {}],
      ['patch', `/${resourceId}`, { active: false }],
    ] as const)
      await api()
        [method](`/api/v1/business/external-links${path}`)
        .auth(foreign, { type: 'bearer' })
        .set('x-business-id', fx.firmA.id)
        .send(body)
        .expect(404);
    await api()
      .get(`/api/v1/portal/${fx.firmA.slug}/external-links`)
      .auth(foreignClient, { type: 'bearer' })
      .expect(404);
    const rows = await fx.app
      .get<Database>(DATABASE)
      .withScope(
        { kind: 'business', businessId: fx.firmA.id },
        (tx) => tx.$queryRaw`SELECT id FROM external_links WHERE business_id=${fx.firmB.id}::uuid`,
      );
    expect(rows).toEqual([]);
  });
  it('rejects expired support approval on the next request', async () => {
    const grant = await runInScope(fx.owner, { kind: 'platform' }, (tx) =>
      tx.supportAccessGrant.create({
        data: {
          businessId: fx.firmA.id,
          adminUserId: fx.users.superAdmin.id,
          reason: 'Synthetic short support',
        },
      }),
    );
    await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
      tx.supportAccessGrant.update({
        where: { id: grant.id },
        data: { grantedByUserId: fx.users.ownerA.id, expiresAt: new Date(Date.now() + 2000) },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await api()
      .get(`/api/v1/admin/support/businesses/${fx.firmA.id}/audit-logs`)
      .auth(superAdmin, { type: 'bearer' })
      .expect(403);
  });
});
