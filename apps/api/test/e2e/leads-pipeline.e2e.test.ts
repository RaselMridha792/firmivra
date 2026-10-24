// End-to-end: R57 part 1, the Leads page and Lead Profile (contract in
// packages/types/src/leads/pipeline.ts): the table, the cards, the dropdowns, Add New Lead, the
// profile, Edit, the bulk bar and Send Email / Send SMS. Responses are parsed with strict copies of
// the contract's schemas, so a leaked field fails. Staff reach only their own leads, a member's
// grid decides the bulk actions, and firm B never reads or changes firm A's leads.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  LeadBulkResult,
  LeadOptions,
  LeadPipelinePage,
  LeadPipelineSummary,
  LeadProfile,
  LeadRow,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NotifyDeliveryError } from '../../src/notify/notify.service.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const Row = z.strictObject(LeadRow.shape);
const Profile = z.strictObject(LeadProfile.shape);
const Page = z.strictObject({ ...LeadPipelinePage.shape, items: z.array(Row) });
const Summary = z.strictObject(LeadPipelineSummary.shape);
const Options = z.strictObject(LeadOptions.shape);
const Result = z.strictObject(LeadBulkResult.shape);

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r57-${key}-${run}@r57.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  supportA: person('support-a'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '', tax: '', books: '', taxB: '' };

let app: INestApplication;
const outbox: NotifyMessage[] = [];
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

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};

let n = 0;
const lead = (extra: object = {}) => {
  n += 1;
  return {
    firstName: 'Pat',
    lastName: `Sample${n}x${run}`,
    email: `pat-${n}-${run}@example.test`,
    phone: `+1555010${String(n).padStart(4, '0')}`,
    source: 'REFERRAL',
    serviceIds: [ids.tax],
    ...extra,
  };
};
const create = async (who: { email: string }, extra: object = {}) =>
  Profile.parse(ok(await call('post', '', who, lead(extra)), 201));
const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
const future = new Date(Date.now() + 3 * 86_400_000).toISOString();

const made: Record<string, z.infer<typeof Profile>> = {};

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: `r57-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r57-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
      [people.supportA.id, 'CLIENT_SUPPORT'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    ids.tax = (
      await tx.service.create({ data: { ...A, kind: 'ANNUAL_TAX', name: `Tax ${run}` } })
    ).id;
    ids.books = (
      await tx.service.create({ data: { ...A, kind: 'BOOKKEEPING', name: `Books ${run}` } })
    ).id;
    await tx.tag.create({ data: { ...A, name: `Hot ${run}` } });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.taxB = (
      await tx.service.create({
        data: { businessId: ids.firmB, kind: 'ANNUAL_TAX', name: `Tax B ${run}` },
      })
    ).id;
  });
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        if (message.to.includes('-refuse-')) {
          return Promise.reject(new NotifyDeliveryError(message.template, 'email', 'synthetic'));
        }
        outbox.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('Add New Lead (POST /business/leads)', () => {
  it('creates leads in several stages with the lead number, services and first follow-up', async () => {
    made.hot = await create(people.ownerA, {
      priority: 'HOT',
      assignedUserId: people.staffA.id,
      preferredContact: ['EMAIL', 'SMS'],
    });
    expect(made.hot).toMatchObject({
      number: 'LD-10001',
      stage: 'SUBMITTED',
      priority: 'HOT',
      source: 'REFERRAL',
      lastContact: null,
      nextAction: null,
      campaign: null,
      client: null,
      beginOnline: false,
      archivedAt: null,
      upcomingAppointments: [],
      openTasks: [],
      preferredContact: ['EMAIL', 'SMS'],
      assignedTo: { userId: people.staffA.id },
    });
    expect(made.hot.recentActivity.map((a) => a.label)).toEqual(['Lead created from Referral']);

    made.overdue = await create(people.ownerA, {
      stage: 'CONTACTED',
      source: 'FACEBOOK_AD',
      priority: 'WARM',
      serviceIds: [ids.tax, ids.books],
      nextAction: { type: 'CALL', dueAt: past, notes: 'Ask about 2025' },
    });
    expect(made.overdue.services).toHaveLength(2);
    expect(made.overdue.nextAction).toMatchObject({
      type: 'CALL',
      overdue: true,
      notes: 'Ask about 2025',
    });

    made.follow = await create(people.ownerA, {
      stage: 'IN_FOLLOW_UP',
      source: 'GOOGLE_AD',
      priority: 'COLD',
      assignedUserId: people.ownerA.id,
      nextAction: { type: 'EMAIL', dueAt: future },
    });
    expect(made.follow.nextAction).toMatchObject({ type: 'EMAIL', overdue: false });

    made.declined = await create(people.ownerA, { stage: 'DECLINED' });
    expect(made.declined.stage).toBe('DECLINED');
    made.lost = await create(people.ownerA, { stage: 'LOST', source: 'WALK_IN' });

    // Staff create into their own list, assigned to themselves.
    made.staffs = await create(people.staffA);
    expect(made.staffs.assignedTo?.userId).toBe(people.staffA.id);
  });

  it('refuses a repeat email or phone with POSSIBLE_DUPLICATE unless it is allowed', async () => {
    const body = lead({ email: made.hot!.email });
    const res = await call('post', '', people.ownerA, body);
    expect(res.status).toBe(409);
    expect(codeOf(res)).toBe('POSSIBLE_DUPLICATE');
    const again = await call('post', '', people.ownerA, lead({ phone: made.hot!.phone }));
    expect(codeOf(again)).toBe('POSSIBLE_DUPLICATE');
    ok(await call('post', '', people.ownerA, { ...body, allowDuplicate: true }), 201);
  });

  it('checks the input, the grid and the references', async () => {
    expect(codeOf(await call('post', '', people.ownerA, lead({ serviceIds: [] })))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(await call('post', '', people.ownerA, lead({ campaignId: randomUUID() })))).toBe(
      'FIELD_UNAVAILABLE',
    );
    expect(
      codeOf(
        await call(
          'post',
          '',
          people.ownerA,
          lead({ stage: 'LOST', nextAction: { type: 'CALL', dueAt: future } }),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(codeOf(await call('post', '', people.ownerA, { ...lead(), extra: 1 }))).toBe(
      'VALIDATION_FAILED',
    );
    // Another firm's service and an unknown member are 404, never a hint they exist elsewhere.
    expect((await call('post', '', people.ownerA, lead({ serviceIds: [ids.taxB] }))).status).toBe(
      404,
    );
    expect(
      (await call('post', '', people.ownerA, lead({ assignedUserId: randomUUID() }))).status,
    ).toBe(404);
    expect(
      (await call('post', '', people.ownerA, lead({ assignedUserId: people.ownerB.id }))).status,
    ).toBe(404);
    // Staff assign only to themselves; Client Support can view but not create.
    expect(
      (await call('post', '', people.staffA, lead({ assignedUserId: people.ownerA.id }))).status,
    ).toBe(403);
    expect((await call('post', '', people.supportA, lead())).status).toBe(403);
  });
});

describe('the table, the cards and the dropdowns', () => {
  const list = async (query: string, who = people.ownerA) =>
    Page.parse(ok(await call('get', `/pipeline${query}`, who)));

  it('is not swallowed by the :id routes and pages newest first', async () => {
    const page = await list('?pageSize=2');
    expect(page).toMatchObject({ total: 7, page: 1, pageSize: 2 });
    expect(page.items).toHaveLength(2);
    const second = await list('?pageSize=2&page=2');
    expect(second.items.map((i) => i.id)).not.toContain(page.items[0]!.id);
    expect(page.items[0]!.createdAt >= page.items[1]!.createdAt).toBe(true);
    expect((await call('get', '/pipeline?pageSize=500', people.ownerA)).status).toBe(400);
  });

  it('filters by stage, source, priority, staff, service, overdue, tag, date and search', async () => {
    expect((await list('?stage=DECLINED')).items.map((i) => i.id)).toEqual([made.declined!.id]);
    expect((await list('?source=WALK_IN')).items.map((i) => i.id)).toEqual([made.lost!.id]);
    expect((await list('?priority=HOT')).items.map((i) => i.id)).toEqual([made.hot!.id]);
    expect((await list(`?assignedUserId=${people.ownerA.id}`)).items.map((i) => i.id)).toEqual([
      made.follow!.id,
    ]);
    expect((await list(`?serviceId=${ids.books}`)).items.map((i) => i.id)).toEqual([
      made.overdue!.id,
    ]);
    expect((await list('?overdue=true')).items.map((i) => i.id)).toEqual([made.overdue!.id]);
    expect((await list(`?search=${made.hot!.lastName}`)).items.map((i) => i.id)).toEqual([
      made.hot!.id,
    ]);
    expect((await list('?search=facebook')).items.map((i) => i.id)).toEqual([made.overdue!.id]);
    expect((await list('?tag=nothing')).total).toBe(0);
    // The firm's day (New York, the default zone), not the UTC one: they differ for 4 to 5 hours.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
      new Date(),
    );
    expect((await list(`?from=${today}&to=${today}`)).total).toBe(7);
    expect((await list('?from=2001-01-01&to=2001-01-02')).total).toBe(0);
    expect((await list(`?campaignId=${randomUUID()}`)).total).toBe(0);
    expect((await call('get', '/pipeline?stage=DRAFT', people.ownerA)).status).toBe(400);
  });

  it('shows Staff only the leads assigned to them', async () => {
    const mine = await list('', people.staffA);
    expect(mine.items.map((i) => i.id).sort()).toEqual([made.hot!.id, made.staffs!.id].sort());
    expect((await call('get', `/${made.follow!.id}/profile`, people.staffA)).status).toBe(404);
  });

  it('counts the six cards', async () => {
    const owner = Summary.parse(ok(await call('get', '/pipeline/summary', people.ownerA)));
    expect(owner).toEqual({
      total: { value: 7, previous: null },
      new: { value: 3, previous: null },
      inFollowUp: { value: 1, previous: null },
      converted: { value: 0, previous: null },
      notQualified: { value: 1, previous: null },
      overdueFollowUps: { value: 1, previous: null },
    });
    const staff = Summary.parse(ok(await call('get', '/pipeline/summary', people.staffA)));
    expect(staff.total.value).toBe(2);
  });

  it('lists the dropdowns of this firm only', async () => {
    const options = Options.parse(ok(await call('get', '/options', people.ownerA)));
    expect(options.services.map((s) => s.id).sort()).toEqual([ids.tax, ids.books].sort());
    expect(options.staff.map((s) => s.userId).sort()).toEqual(
      [people.ownerA.id, people.staffA.id, people.supportA.id].sort(),
    );
    expect(options.tags).toEqual([`Hot ${run}`]);
    const b = Options.parse(ok(await call('get', '/options', people.ownerB, undefined, ids.firmB)));
    expect(b.services.map((s) => s.id)).toEqual([ids.taxB]);
    expect(b.tags).toEqual([]);
  });
});

describe('profile and Edit (GET :id/profile, PATCH :id)', () => {
  it('returns the profile and the same lead after an edit', async () => {
    const id = made.follow!.id;
    const profile = Profile.parse(ok(await call('get', `/${id}/profile`, people.ownerA)));
    expect(profile).toEqual(made.follow);
    const edited = Profile.parse(
      ok(
        await call('patch', `/${id}`, people.ownerA, {
          firstName: 'Quinn',
          businessName: 'Sample Co',
          phone: null,
          address: '1 Example Street, Sample City',
          bestTimeToContact: 'Evenings',
          priority: 'HOT',
          source: 'EVENT',
          sourceDetail: 'Spring expo',
          preferredContact: ['PHONE'],
          serviceIds: [ids.tax, ids.books],
          tags: [`Hot ${run}`],
          version: profile.version,
        }),
      ),
    );
    expect(edited).toMatchObject({
      firstName: 'Quinn',
      businessName: 'Sample Co',
      phone: null,
      address: '1 Example Street, Sample City',
      bestTimeToContact: 'Evenings',
      priority: 'HOT',
      source: 'EVENT',
      sourceDetail: 'Spring expo',
      preferredContact: ['PHONE'],
      services: [{ id: ids.tax }, { id: ids.books }],
      tags: [`Hot ${run}`],
    });
    expect(edited.version).not.toBe(profile.version);
    expect(edited.recentActivity[0]!.label).toBe(`Tag added: Hot ${run}`);
    made.follow = edited;
  });

  it('answers SAVE_CONFLICT for a stale version', async () => {
    const res = await call('patch', `/${made.follow!.id}`, people.ownerA, {
      lastName: 'Stale',
      version: '2020-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(409);
    expect(codeOf(res)).toBe('SAVE_CONFLICT');
  });

  it('closes the follow-up with a closed stage, reassigns, logs the status and keeps the reason', async () => {
    const id = made.overdue!.id;
    const closed = Profile.parse(
      ok(
        await call('patch', `/${id}`, people.ownerA, {
          stage: 'DECLINED',
          assignedUserId: people.staffA.id,
        }),
      ),
    );
    expect(closed).toMatchObject({
      stage: 'DECLINED',
      nextAction: null,
      assignedTo: { userId: people.staffA.id },
    });
    const labels = closed.recentActivity.map((a) => a.label);
    expect(labels).toContain('Status changed to Not Qualified');
    expect(labels).toContain('Lead assigned');
    // Staff lose the lead they assigned away from themselves on the next read.
    const back = Profile.parse(
      ok(await call('patch', `/${id}`, people.ownerA, { stage: 'QUALIFIED' })),
    );
    expect(back.stage).toBe('QUALIFIED');
  });

  it('checks the input; staff apply only existing tags; clearing and unknown references', async () => {
    const id = made.hot!.id;
    expect(codeOf(await call('patch', `/${id}`, people.ownerA, {}))).toBe('VALIDATION_FAILED');
    expect(codeOf(await call('patch', `/${id}`, people.ownerA, { stage: 'CONVERTED' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(await call('patch', `/${id}`, people.ownerA, { campaignId: randomUUID() }))).toBe(
      'FIELD_UNAVAILABLE',
    );
    expect(
      codeOf(await call('patch', `/${id}`, people.ownerA, { dateOfBirth: '1990-01-01' })),
    ).toBe('FIELD_UNAVAILABLE');
    expect(codeOf(await call('patch', `/${id}`, people.ownerA, { serviceIds: [] }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await call('patch', `/${id}`, people.ownerA, { serviceIds: [ids.tax, ids.taxB] })).status,
    ).toBe(404);
    expect(codeOf(await call('patch', `/${id}`, people.ownerA, { serviceIds: [ids.books] }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await call('patch', `/${id}`, people.ownerA, { assignedUserId: people.ownerB.id })).status,
    ).toBe(404);
    expect(codeOf(await call('patch', `/${id}`, people.staffA, { tags: ['Brand new'] }))).toBe(
      'UNKNOWN_TAG',
    );
    const made2 = Profile.parse(
      ok(await call('patch', `/${id}`, people.ownerA, { tags: ['Brand new'] })),
    );
    expect(made2.tags).toEqual(['Brand new']);
    expect(
      Profile.parse(ok(await call('patch', `/${id}`, people.staffA, { tags: ['brand new'] }))).tags,
    ).toEqual(['Brand new']);
    // The grid: Client Support may not edit.
    expect((await call('patch', `/${id}`, people.supportA, { priority: 'COLD' })).status).toBe(403);
    // Like Staff, Client Support reach only the leads assigned to them (none here).
    expect(Page.parse(ok(await call('get', '/pipeline', people.supportA))).total).toBe(0);
    expect((await call('get', `/${id}/profile`, people.supportA)).status).toBe(404);
  });
});

describe('bulk bar (POST bulk)', () => {
  it('assigns, changes the stage and adds tags to the leads the member reaches', async () => {
    const [a, b] = [made.staffs!.id, made.lost!.id];
    const assign = Result.parse(
      ok(
        await call('post', '/bulk', people.ownerA, {
          action: 'ASSIGN',
          ids: [a, b, randomUUID()],
          assignedUserId: people.ownerA.id,
        }),
        200,
      ),
    );
    expect(assign).toEqual({ changed: 2, skipped: 1 });
    const stage = Result.parse(
      ok(
        await call('post', '/bulk', people.ownerA, {
          action: 'STAGE',
          ids: [a, b],
          stage: 'CONTACTED',
        }),
      ),
    );
    expect(stage).toEqual({ changed: 2, skipped: 0 });
    const again = Result.parse(
      ok(
        await call('post', '/bulk', people.ownerA, {
          action: 'STAGE',
          ids: [a, b],
          stage: 'CONTACTED',
        }),
      ),
    );
    expect(again).toEqual({ changed: 0, skipped: 2 });
    const tags = Result.parse(
      ok(
        await call('post', '/bulk', people.ownerA, {
          action: 'TAGS',
          ids: [a, b],
          add: [`Hot ${run}`],
        }),
      ),
    );
    expect(tags).toEqual({ changed: 2, skipped: 0 });
    const profile = Profile.parse(ok(await call('get', `/${a}/profile`, people.ownerA)));
    expect(profile).toMatchObject({
      stage: 'CONTACTED',
      tags: [`Hot ${run}`],
      assignedTo: { userId: people.ownerA.id },
    });
    expect(
      codeOf(
        await call('post', '/bulk', people.ownerA, {
          action: 'ASSIGN',
          ids: [a],
          assignedUserId: people.ownerB.id,
        }),
      ),
    ).toBe('NOT_FOUND');
    expect(codeOf(await call('post', '/bulk', people.ownerA, { action: 'ARCHIVE', ids: [] }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('skips a campaign (leads have none yet) and follows the grid per action', async () => {
    const campaign = Result.parse(
      ok(
        await call('post', '/bulk', people.ownerA, {
          action: 'CAMPAIGN',
          ids: [made.hot!.id],
          campaignId: randomUUID(),
        }),
      ),
    );
    expect(campaign).toEqual({ changed: 0, skipped: 1 });
    // Staff may change stage and assign but not tag or archive (the grid's Manage and Delete).
    const mine = [made.hot!.id];
    expect(
      Result.parse(
        ok(
          await call('post', '/bulk', people.staffA, {
            action: 'STAGE',
            ids: mine,
            stage: 'QUALIFIED',
          }),
        ),
      ).changed,
    ).toBe(1);
    expect(
      (await call('post', '/bulk', people.staffA, { action: 'TAGS', ids: mine, add: ['x'] }))
        .status,
    ).toBe(403);
    expect(
      (await call('post', '/bulk', people.staffA, { action: 'ARCHIVE', ids: mine })).status,
    ).toBe(403);
    // And only the leads assigned to them.
    expect(
      Result.parse(
        ok(
          await call('post', '/bulk', people.staffA, {
            action: 'STAGE',
            ids: [made.follow!.id],
            stage: 'LOST',
          }),
        ),
      ),
    ).toEqual({ changed: 0, skipped: 1 });
  });

  it('archives: the lead leaves the table, the cards and the profile, but is kept', async () => {
    const id = made.declined!.id;
    expect(
      Result.parse(
        ok(await call('post', '/bulk', people.ownerA, { action: 'ARCHIVE', ids: [id] })),
      ),
    ).toEqual({
      changed: 1,
      skipped: 0,
    });
    expect(
      Result.parse(
        ok(await call('post', '/bulk', people.ownerA, { action: 'ARCHIVE', ids: [id] })),
      ),
    ).toEqual({
      changed: 0,
      skipped: 1,
    });
    expect(Page.parse(ok(await call('get', '/pipeline?stage=DECLINED', people.ownerA))).total).toBe(
      0,
    );
    expect((await call('get', `/${id}/profile`, people.ownerA)).status).toBe(404);
    expect(
      Summary.parse(ok(await call('get', '/pipeline/summary', people.ownerA))).total.value,
    ).toBe(6);
  });
});

describe('Send Email and Send SMS (POST messages)', () => {
  it('sends through NotifyService and logs each on the lead without the text', async () => {
    outbox.length = 0;
    const ids2 = [made.hot!.id, made.staffs!.id];
    const email = Result.parse(
      ok(
        await call('post', '/messages', people.ownerA, {
          ids: ids2,
          channel: 'EMAIL',
          subject: 'Welcome',
          body: 'Secret body text',
        }),
      ),
    );
    expect(email).toEqual({ changed: 2, skipped: 0 });
    expect(outbox.map((m) => m.template)).toEqual(['lead.message-email', 'lead.message-email']);
    const sms = Result.parse(
      ok(
        await call('post', '/messages', people.ownerA, {
          ids: [made.hot!.id],
          channel: 'SMS',
          body: 'Hello there',
        }),
      ),
    );
    expect(sms).toEqual({ changed: 1, skipped: 0 });
    expect(outbox.at(-1)).toMatchObject({ template: 'lead.message-sms', to: made.hot!.phone });

    const profile = Profile.parse(ok(await call('get', `/${made.hot!.id}/profile`, people.ownerA)));
    expect(profile.lastContact?.channel).toBe('SMS');
    const labels = profile.recentActivity.map((a) => a.label);
    expect(labels).toContain('Email sent: Welcome');
    expect(labels).toContain('Text message sent');
    expect(JSON.stringify(profile)).not.toContain('Secret body text');
  });

  it('skips leads that cannot be reached and refuses a send nobody can receive', async () => {
    const refuse = await create(people.ownerA, {
      email: `pat-refuse-${run}@example.test`,
      phone: null,
    });
    const res = Result.parse(
      ok(
        await call('post', '/messages', people.ownerA, {
          ids: [refuse.id, made.hot!.id],
          channel: 'EMAIL',
          body: 'Hi',
        }),
      ),
    );
    expect(res).toEqual({ changed: 1, skipped: 1 });
    const noPhone = await call('post', '/messages', people.ownerA, {
      ids: [refuse.id],
      channel: 'SMS',
      body: 'Hi',
    });
    expect(noPhone.status).toBe(400);
    expect(codeOf(noPhone)).toBe('SMS_UNAVAILABLE');
    const mixed = Result.parse(
      ok(
        await call('post', '/messages', people.ownerA, {
          ids: [refuse.id, made.hot!.id],
          channel: 'SMS',
          body: 'Hi',
        }),
      ),
    );
    expect(mixed).toEqual({ changed: 1, skipped: 1 });
    expect(
      codeOf(
        await call('post', '/messages', people.ownerA, { ids: [made.hot!.id], channel: 'EMAIL' }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      (
        await call('post', '/messages', people.supportA, {
          ids: [made.hot!.id],
          channel: 'EMAIL',
          body: 'Hi',
        })
      ).status,
    ).toBe(403);
  });
});

describe('firm isolation', () => {
  it("firm B reads, changes, messages and bulk-edits none of firm A's leads", async () => {
    const id = made.hot!.id;
    const b = (method: 'get' | 'post' | 'patch', path: string, body?: object) =>
      call(method, path, people.ownerB, body, ids.firmB);
    expect(Page.parse(ok(await b('get', '/pipeline'))).total).toBe(0);
    expect((await b('get', `/${id}/profile`)).status).toBe(404);
    expect((await b('patch', `/${id}`, { priority: 'COLD' })).status).toBe(404);
    expect(Result.parse(ok(await b('post', '/bulk', { action: 'ARCHIVE', ids: [id] })))).toEqual({
      changed: 0,
      skipped: 1,
    });
    expect(
      Result.parse(ok(await b('post', '/messages', { ids: [id], channel: 'EMAIL', body: 'Hi' }))),
    ).toEqual({
      changed: 0,
      skipped: 1,
    });
    expect(Summary.parse(ok(await b('get', '/pipeline/summary'))).total.value).toBe(0);
    // A's lead is untouched, and B's own lead is numbered from B's own sequence.
    expect(
      Profile.parse(ok(await call('get', `/${id}/profile`, people.ownerA))).archivedAt,
    ).toBeNull();
    const own = Profile.parse(
      ok(await b('post', '', { ...lead({ serviceIds: [ids.taxB] }) }), 201),
    );
    expect(own.number).toBe('LD-10001');
    // The signed-in firm's member cannot act in a firm they do not belong to.
    expect((await call('get', '/pipeline', people.ownerB, undefined, ids.firmA)).status).toBe(404);
  });

  it('writes audit rows without personal data', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      const rows = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.auditLog.findMany({ where: { businessId: ids.firmA, action: { startsWith: 'lead.' } } }),
      );
      const actions = new Set(rows.map((r) => r.action));
      for (const a of [
        'lead.created',
        'lead.updated',
        'lead.viewed',
        'lead.bulk_archive',
        'lead.message_sent',
      ]) {
        expect(actions.has(a), a).toBe(true);
      }
      const text = JSON.stringify(rows.map((r) => r.metadata));
      expect(text).not.toContain('Secret body text');
      expect(text).not.toContain('@example.test');
    } finally {
      await owner.$disconnect();
    }
  });
});

describe('Archived Leads and Restore (L10)', () => {
  const page = async (query: string, who = people.ownerA) =>
    Page.parse(ok(await call('get', `/pipeline${query}`, who)));
  const bulk = (action: 'ARCHIVE' | 'RESTORE', leadIds: string[], who = people.ownerA) =>
    call('post', '/bulk', who, { action, ids: leadIds });

  it('archived leads show only under Archived Leads, and Restore brings one back as it was', async () => {
    const lead = await create(people.ownerA, { stage: 'IN_FOLLOW_UP', priority: 'HOT' });
    const open = await create(people.ownerA);
    expect(Result.parse(ok(await bulk('ARCHIVE', [lead.id])))).toEqual({ changed: 1, skipped: 0 });
    expect((await page('?pageSize=100')).items.map((r) => r.id)).not.toContain(lead.id);
    const archived = await page('?archived=true&pageSize=100');
    expect(archived.items.map((r) => r.id)).toContain(lead.id);
    expect(archived.items.map((r) => r.id)).not.toContain(open.id);

    // Restore: a lead that is not archived is skipped.
    expect(Result.parse(ok(await bulk('RESTORE', [lead.id, open.id])))).toEqual({
      changed: 1,
      skipped: 1,
    });
    const back = (await page('?pageSize=100')).items.find((r) => r.id === lead.id);
    expect(back).toMatchObject({ stage: 'IN_FOLLOW_UP', priority: 'HOT' });
    expect((await page('?archived=true&pageSize=100')).items.map((r) => r.id)).not.toContain(
      lead.id,
    );
    const profile = Profile.parse(ok(await call('get', `/${lead.id}/profile`, people.ownerA)));
    expect(profile.recentActivity.map((a) => a.label)[0]).toMatch(/^Lead created/);
  });

  it('Staff cannot restore (the grid’s Delete), and firm B restores none of firm A’s', async () => {
    const lead = await create(people.ownerA, { assignedUserId: people.staffA.id });
    ok(await bulk('ARCHIVE', [lead.id]));
    expect((await bulk('RESTORE', [lead.id], people.staffA)).status).toBe(403);
    const other = await call(
      'post',
      '/bulk',
      people.ownerB,
      { action: 'RESTORE', ids: [lead.id] },
      ids.firmB,
    );
    expect(Result.parse(ok(other))).toEqual({ changed: 0, skipped: 1 });
    expect((await page('?archived=true&pageSize=100')).items.map((r) => r.id)).toContain(lead.id);
  });
});
