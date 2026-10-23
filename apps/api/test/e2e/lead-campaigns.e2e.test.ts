// End-to-end: L7 of Octavia's Leads review. A lead's campaign is a Communications campaign: the
// Leads options list the firm's email and text campaigns, Add to Campaign and Add New Lead put
// leads in the campaign's audience (nothing is sent or scheduled), the row shows the campaign and
// the filter finds its leads. Staff without the grid's Manage cannot add; firm B never reaches
// firm A's campaigns.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, type Prisma, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { LeadBulkResult, LeadOptions, LeadPipelinePage, LeadProfile } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const Result = z.strictObject(LeadBulkResult.shape);

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `l7-${key}-${run}@l7.test` });
const people = { ownerA: person('owner-a'), staffA: person('staff-a'), ownerB: person('owner-b') };
const ids = {
  firmA: '',
  firmB: '',
  service: '',
  draft: '',
  announcement: '',
  archived: '',
  campaignB: '',
};

let app: INestApplication;
const owner = () => createPrismaClient(testDatabaseUrls('test_api').owner);
const tokens = new Map<string, string>();

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

async function call(
  method: 'get' | 'post' | 'patch',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/leads${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
let n = 0;
const create = async (extra: object = {}) => {
  n += 1;
  return LeadProfile.parse(
    ok(
      await call('post', '', people.ownerA, {
        firstName: 'Pat',
        lastName: `Sample${n}x${run}`,
        email: `pat-${n}-${run}@example.test`,
        source: 'REFERRAL',
        serviceIds: [ids.service],
        assignedUserId: people.staffA.id,
        ...extra,
      }),
      201,
    ),
  );
};
/** The leads in a campaign's audience, from the database. */
async function audience(communicationId: string): Promise<string[]> {
  const db = owner();
  try {
    const rows = await runInScope(db, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.communicationAudienceEntry.findMany({
        where: { communicationId, kind: 'LEAD' },
        select: { leadId: true },
      }),
    );
    return rows.map((r) => r.leadId ?? '').sort();
  } finally {
    await db.$disconnect();
  }
}

beforeAll(async () => {
  const db = owner();
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: `l7-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `l7-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  type Extra = { name: string; channel?: 'EMAIL' | 'ANNOUNCEMENT'; archivedAt?: Date };
  const campaign = (
    businessId: string,
    createdByUserId: string,
    extra: Extra,
  ): Prisma.CommunicationUncheckedCreateInput => ({
    businessId,
    channel: 'EMAIL',
    subject: 'Fake subject',
    body: '<p>Fake body</p>',
    createdByUserId,
    ...extra,
  });
  await runInScope(db, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const businessId = ids.firmA;
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } });
    }
    ids.service = (
      await tx.service.create({ data: { businessId, kind: 'ANNUAL_TAX', name: `Tax ${run}` } })
    ).id;
    const make = async (extra: Extra) =>
      (
        await tx.communication.create({
          data: campaign(businessId, people.ownerA.id, extra),
          select: { id: true },
        })
      ).id;
    ids.draft = await make({ name: `Spring Email ${run}` });
    ids.announcement = await make({ name: `Notice ${run}`, channel: 'ANNOUNCEMENT' });
    ids.archived = await make({ name: `Old ${run}`, archivedAt: new Date() });
  });
  await runInScope(db, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.campaignB = (
      await tx.communication.create({
        data: campaign(ids.firmB, people.ownerB.id, { name: `B campaign ${run}` }),
        select: { id: true },
      })
    ).id;
  });
  await db.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('Leads campaigns are Communications campaigns (L7)', () => {
  it('the options list the firm’s email and text campaigns only', async () => {
    const options = LeadOptions.parse(ok(await call('get', '/options', people.ownerA)));
    expect(options.campaigns).toEqual([{ id: ids.draft, name: `Spring Email ${run}` }]);
  });

  it('Add to Campaign puts the leads in the audience, sends nothing, and the row shows it', async () => {
    const a = await create();
    const b = await create();
    const added = Result.parse(
      ok(
        await call('post', '/bulk', people.ownerA, {
          action: 'CAMPAIGN',
          ids: [a.id, b.id],
          campaignId: ids.draft,
        }),
      ),
    );
    expect(added).toEqual({ changed: 2, skipped: 0 });
    expect(await audience(ids.draft)).toEqual([a.id, b.id].sort());
    // Again: still once each.
    ok(
      await call('post', '/bulk', people.ownerA, {
        action: 'CAMPAIGN',
        ids: [a.id],
        campaignId: ids.draft,
      }),
    );
    expect(await audience(ids.draft)).toHaveLength(2);

    const page = LeadPipelinePage.parse(
      ok(await call('get', `/pipeline?campaignId=${ids.draft}`, people.ownerA)),
    );
    expect(page.items.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(page.items[0]?.campaign).toEqual({ id: ids.draft, name: `Spring Email ${run}` });
    const profile = LeadProfile.parse(ok(await call('get', `/${a.id}/profile`, people.ownerA)));
    expect(profile.recentActivity.map((x) => x.label)).toContain(
      `Added to a campaign: Spring Email ${run}`,
    );

    // Nothing went out: still a draft, with no recipients.
    const db = owner();
    try {
      const c = await runInScope(db, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.communication.findUniqueOrThrow({
          where: { businessId_id: { businessId: ids.firmA, id: ids.draft } },
          select: { status: true, _count: { select: { recipients: true } } },
        }),
      );
      expect(c).toEqual({ status: 'DRAFT', _count: { recipients: 0 } });
    } finally {
      await db.$disconnect();
    }
  });

  it('Add New Lead with a campaign puts the new lead in it', async () => {
    const lead = await create({ campaignId: ids.draft });
    expect(await audience(ids.draft)).toContain(lead.id);
    expect(lead.campaign).toEqual({ id: ids.draft, name: `Spring Email ${run}` });
  });

  it('refuses an announcement, an archived or unknown campaign, Staff and another firm', async () => {
    const lead = await create();
    const add = (campaignId: string, who = people.ownerA, businessId = ids.firmA) =>
      call('post', '/bulk', who, { action: 'CAMPAIGN', ids: [lead.id], campaignId }, businessId);
    expect((await add(ids.announcement)).status).toBe(400);
    expect((await add(ids.archived)).status).toBe(409);
    expect((await add(randomUUID())).status).toBe(404);
    // Staff: the grid's Manage decides Add to Campaign on Leads.
    expect((await add(ids.draft, people.staffA)).status).toBe(403);
    // Firm B names firm A's campaign, or firm A names firm B's: 404, nothing changes.
    expect((await add(ids.draft, people.ownerB, ids.firmB)).status).toBe(404);
    expect((await add(ids.campaignB)).status).toBe(404);
    expect(await audience(ids.draft)).not.toContain(lead.id);
  });
});
