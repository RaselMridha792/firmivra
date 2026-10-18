// End-to-end: R57 part 2, the Lead Profile's tabs and Convert Lead to Client (contract in
// packages/types/src/leads/pipeline.ts): follow-ups, activity, notes, tasks, appointments,
// documents and forms, and the conversion. Responses are parsed with strict copies of the
// contract's schemas. Staff reach only their own leads; firm B never reads or changes firm A's.
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
  ConvertLeadToClientResult,
  LeadActivity,
  LeadActivityPage,
  LeadDocumentsAndForms,
  LeadNote,
  LeadProfile,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const Profile = z.strictObject(LeadProfile.shape);
const Activity = z.strictObject(LeadActivity.shape);
const ActivityPage = z.strictObject(LeadActivityPage.shape);
const Note = z.strictObject(LeadNote.shape);
const Docs = z.strictObject(LeadDocumentsAndForms.shape);
const Converted = z.strictObject(ConvertLeadToClientResult.shape);

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r57t-${key}-${run}@r57.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  supportA: person('support-a'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '', tax: '', books: '', existing: '' };

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
  method: 'get' | 'post' | 'put' | 'patch',
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
const newLead = async (extra: object = {}) => {
  n += 1;
  return Profile.parse(
    ok(
      await call(
        'post',
        '',
        people.ownerA,
        {
          firstName: 'Pat',
          lastName: `Tab${n}x${run}`,
          email: `pat-t${n}-${run}@example.test`,
          source: 'FACEBOOK_AD',
          sourceDetail: 'Spring campaign',
          serviceIds: [ids.tax],
          ...extra,
        },
        ids.firmA,
      ),
      201,
    ),
  );
};
const future = new Date(Date.now() + 3 * 86_400_000).toISOString();

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: `r57t-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r57t-b-${run}`, name: 'B', status: 'ACTIVE' } })
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
    ids.existing = (
      await tx.client.create({
        data: { ...A, displayName: 'Existing', email: `existing-${run}@example.test` },
      })
    ).id;
    await tx.tag.create({ data: { ...A, name: `Vip ${run}` } });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
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

describe('follow-up (PUT :id/follow-up, POST :id/follow-up/complete)', () => {
  it('sets the next action, completes it with an outcome and sets the next one', async () => {
    const lead = await newLead();
    const set = Profile.parse(
      ok(
        await call('put', `/${lead.id}/follow-up`, people.ownerA, {
          type: 'CALL',
          dueAt: future,
          notes: 'Ask',
        }),
      ),
    );
    expect(set.nextAction).toMatchObject({ type: 'CALL', notes: 'Ask', overdue: false });
    expect(set.recentActivity[0]!.label).toBe('Follow-up set: Call');

    const done = Profile.parse(
      ok(
        await call('post', `/${lead.id}/follow-up/complete`, people.ownerA, {
          outcome: 'Left a voicemail',
          next: { type: 'EMAIL', dueAt: future },
        }),
      ),
    );
    expect(done.nextAction).toMatchObject({ type: 'EMAIL' });
    expect(done.recentActivity.map((a) => a.label)).toContain('Follow-up completed: Call');

    const cleared = Profile.parse(
      ok(await call('post', `/${lead.id}/follow-up/complete`, people.ownerA, {})),
    );
    expect(cleared.nextAction).toBeNull();
    const none = await call('post', `/${lead.id}/follow-up/complete`, people.ownerA, {});
    expect(none.status).toBe(409);
    expect(codeOf(none)).toBe('NO_FOLLOW_UP');
  });

  it('refuses a closed lead, a bad body, and the grid', async () => {
    const closed = await newLead({ stage: 'LOST' });
    const res = await call('put', `/${closed.id}/follow-up`, people.ownerA, {
      type: 'CALL',
      dueAt: future,
    });
    expect(res.status).toBe(409);
    expect(codeOf(res)).toBe('LEAD_CLOSED');
    const open = await newLead();
    expect(
      codeOf(await call('put', `/${open.id}/follow-up`, people.ownerA, { type: 'CALL' })),
    ).toBe('VALIDATION_FAILED');
    expect(
      (await call('put', `/${open.id}/follow-up`, people.supportA, { type: 'CALL', dueAt: future }))
        .status,
    ).toBe(403);
  });
});

describe('activity and notes', () => {
  it('logs a call, pages the timeline and filters communications', async () => {
    const lead = await newLead();
    const at = new Date(Date.now() - 3600_000).toISOString();
    const logged = Activity.parse(
      ok(
        await call('post', `/${lead.id}/activity`, people.ownerA, {
          kind: 'CALL',
          at,
          summary: 'Spoke for ten minutes',
        }),
        201,
      ),
    );
    expect(logged).toMatchObject({ kind: 'CALL', at, label: 'Call: Spoke for ten minutes' });
    ok(
      await call('post', `/${lead.id}/activity`, people.ownerA, {
        kind: 'MEETING',
        summary: 'Coffee',
      }),
      201,
    );

    const all = ActivityPage.parse(
      ok(await call('get', `/${lead.id}/activity?limit=2`, people.ownerA)),
    );
    expect(all.items).toHaveLength(2);
    expect(all.nextCursor).not.toBeNull();
    const next = ActivityPage.parse(
      ok(await call('get', `/${lead.id}/activity?limit=2&cursor=${all.nextCursor}`, people.ownerA)),
    );
    expect(next.items.map((a) => a.id)).not.toContain(all.items[0]!.id);
    const comms = ActivityPage.parse(
      ok(await call('get', `/${lead.id}/activity?kind=communications`, people.ownerA)),
    );
    expect(comms.items.map((a) => a.kind)).toEqual(['CALL']);
    const profile = Profile.parse(ok(await call('get', `/${lead.id}/profile`, people.ownerA)));
    expect(profile.lastContact).toMatchObject({ channel: 'APPOINTMENT' });

    const future1 = await call('post', `/${lead.id}/activity`, people.ownerA, {
      kind: 'CALL',
      at: future,
      summary: 'Later',
    });
    expect(codeOf(future1)).toBe('VALIDATION_FAILED');
    expect(codeOf(await call('get', `/${lead.id}/activity?cursor=nope`, people.ownerA))).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await call('post', `/${lead.id}/activity`, people.supportA, { kind: 'CALL', summary: 'x' }))
        .status,
    ).toBe(403);
  });

  it('adds and lists notes, newest first, without the text in the timeline', async () => {
    const lead = await newLead();
    const a = Note.parse(
      ok(
        await call('post', `/${lead.id}/notes`, people.ownerA, { text: 'First secret note' }),
        201,
      ),
    );
    const b = Note.parse(
      ok(await call('post', `/${lead.id}/notes`, people.ownerA, { text: 'Second note' }), 201),
    );
    expect(b.by?.userId).toBe(people.ownerA.id);
    const list = ok(await call('get', `/${lead.id}/notes`, people.ownerA)) as { items: unknown[] };
    expect(
      z
        .array(Note)
        .parse(list.items)
        .map((x) => x.id),
    ).toEqual([b.id, a.id]);
    const timeline = ActivityPage.parse(
      ok(await call('get', `/${lead.id}/activity`, people.ownerA)),
    );
    expect(JSON.stringify(timeline)).not.toContain('secret');
    expect(timeline.items.map((x) => x.label)).toContain('Note added');
    expect(codeOf(await call('post', `/${lead.id}/notes`, people.ownerA, { text: '   ' }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('shows empty tasks and appointments, and the documents and forms tab', async () => {
    const lead = await newLead();
    expect(ok(await call('get', `/${lead.id}/tasks`, people.ownerA))).toEqual({ items: [] });
    expect(ok(await call('get', `/${lead.id}/appointments`, people.ownerA))).toEqual({ items: [] });
    expect(
      Docs.parse(ok(await call('get', `/${lead.id}/documents-and-forms`, people.ownerA))),
    ).toEqual({
      documents: [],
      forms: [],
    });
    expect((await call('get', `/${randomUUID()}/tasks`, people.ownerA)).status).toBe(404);
  });
});

describe('Convert Lead to Client (POST :id/convert-to-client)', () => {
  const body = (lead: { id: string; email: string }, extra: object = {}) => ({
    idempotencyKey: randomUUID(),
    accountType: 'INDIVIDUAL',
    fullName: 'Pat Convert',
    email: lead.email,
    phone: '+15550100999',
    serviceIds: [ids.tax, ids.books],
    primaryStaffUserId: people.staffA.id,
    ...extra,
  });

  it('makes the client and one engagement per service, carries notes and tags, and is retry-safe', async () => {
    outbox.length = 0;
    const lead = await newLead({ taxYear: undefined });
    ok(await call('post', `/${lead.id}/notes`, people.ownerA, { text: 'Carry me' }), 201);
    await call('patch', `/${lead.id}`, people.ownerA, { tags: [`Vip ${run}`] });
    ok(await call('put', `/${lead.id}/follow-up`, people.ownerA, { type: 'CALL', dueAt: future }));

    const req = body(lead, { address: '1 Example Street' });
    const result = Converted.parse(
      ok(await call('post', `/${lead.id}/convert-to-client`, people.ownerA, req)),
    );
    expect(result.engagementIds).toHaveLength(2);
    expect(result).toMatchObject({
      inviteSent: true,
      carried: {
        notes: 1,
        communications: 0,
        appointments: 0,
        tasks: 0,
        documents: 0,
        intakeForms: 0,
      },
    });
    expect(outbox.map((m) => m.template)).toEqual(['client.portal-invite']);

    const after = Profile.parse(ok(await call('get', `/${lead.id}/profile`, people.ownerA)));
    expect(after).toMatchObject({
      stage: 'CONVERTED',
      nextAction: null,
      client: { id: result.clientId },
    });

    const rows = await runInScope(
      createPrismaClient(testDatabaseUrls('test_api').owner),
      { kind: 'business', businessId: ids.firmA },
      async (tx) => ({
        client: await tx.client.findUniqueOrThrow({
          where: { businessId_id: { businessId: ids.firmA, id: result.clientId } },
          select: {
            displayName: true,
            assignedUserId: true,
            source: true,
            sourceDetail: true,
            phone: true,
          },
        }),
        notes: await tx.note.count({ where: { clientId: result.clientId } }),
        tags: await tx.clientTag.count({ where: { clientId: result.clientId } }),
        engagements: await tx.engagement.count({
          where: { clientId: result.clientId, status: 'ACTIVE' },
        }),
      }),
    );
    expect(rows).toEqual({
      client: {
        displayName: 'Pat Convert',
        assignedUserId: people.staffA.id,
        source: 'FACEBOOK_AD',
        sourceDetail: 'Spring campaign',
        phone: '+15550100999',
      },
      notes: 1,
      tags: 1,
      engagements: 2,
    });

    // The same key again: the first answer, no second client, no second invitation.
    outbox.length = 0;
    const again = Converted.parse(
      ok(await call('post', `/${lead.id}/convert-to-client`, people.ownerA, req)),
    );
    expect(again).toEqual({ ...result, inviteSent: false });
    expect(outbox).toHaveLength(0);
    // A different key on a converted lead is a conflict.
    const other = await call('post', `/${lead.id}/convert-to-client`, people.ownerA, body(lead));
    expect(other.status).toBe(409);
    expect(codeOf(other)).toBe('ALREADY_CONVERTED');
    expect((await call('patch', `/${lead.id}`, people.ownerA, { stage: 'LOST' })).status).toBe(409);
  });

  it('answers DUPLICATE_EMAIL and converts into the existing client with clientId', async () => {
    const lead = await newLead({ email: `existing-${run}@example.test`, allowDuplicate: true });
    const dup = await call(
      'post',
      `/${lead.id}/convert-to-client`,
      people.ownerA,
      body(lead, { serviceIds: [ids.tax, ids.books] }),
    );
    expect(dup.status).toBe(409);
    expect(codeOf(dup)).toBe('DUPLICATE_EMAIL');
    expect((dup.body as { error: { details: { clientId: string } } }).error.details.clientId).toBe(
      ids.existing,
    );
    const done = Converted.parse(
      ok(
        await call(
          'post',
          `/${lead.id}/convert-to-client`,
          people.ownerA,
          body(lead, { serviceIds: [ids.tax, ids.books], clientId: ids.existing }),
        ),
      ),
    );
    expect(done.clientId).toBe(ids.existing);
    expect(done.inviteSent).toBe(false);
  });

  it('checks references, Staff reach, the grid and the input', async () => {
    const lead = await newLead({ assignedUserId: people.staffA.id });
    const other = await newLead({ assignedUserId: people.ownerA.id });
    expect(
      (
        await call(
          'post',
          `/${lead.id}/convert-to-client`,
          people.ownerA,
          body(lead, { serviceIds: [randomUUID()] }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          'post',
          `/${lead.id}/convert-to-client`,
          people.ownerA,
          body(lead, { primaryStaffUserId: people.ownerB.id }),
        )
      ).status,
    ).toBe(404);
    expect(
      codeOf(
        await call(
          'post',
          `/${lead.id}/convert-to-client`,
          people.ownerA,
          body(lead, { serviceIds: [] }),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    const noPrimary = await call(
      'post',
      `/${lead.id}/convert-to-client`,
      people.ownerA,
      body(lead, { serviceIds: [ids.books] }),
    );
    expect(codeOf(noPrimary)).toBe('LEAD_SERVICE_REQUIRED');
    expect(
      (await call('post', `/${lead.id}/convert-to-client`, people.supportA, body(lead))).status,
    ).toBe(403);
    // Staff convert only their own leads, naming themselves as the primary member.
    expect(
      (
        await call(
          'post',
          `/${other.id}/convert-to-client`,
          people.staffA,
          body(other, { primaryStaffUserId: people.staffA.id }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          'post',
          `/${lead.id}/convert-to-client`,
          people.staffA,
          body(lead, { primaryStaffUserId: people.ownerA.id }),
        )
      ).status,
    ).toBe(403);
    ok(
      await call(
        'post',
        `/${lead.id}/convert-to-client`,
        people.staffA,
        body(lead, {
          primaryStaffUserId: people.staffA.id,
          carryOver: { notes: false, tags: false },
        }),
      ),
    );
  });
});

describe('firm isolation', () => {
  it("firm B reads and changes none of firm A's leads through these routes", async () => {
    const lead = await newLead();
    const b = (method: 'get' | 'post' | 'put', path: string, extra?: object) =>
      call(method, `/${lead.id}${path}`, people.ownerB, extra, ids.firmB);
    for (const res of [
      await b('get', '/activity'),
      await b('get', '/notes'),
      await b('get', '/tasks'),
      await b('get', '/appointments'),
      await b('get', '/documents-and-forms'),
      await b('post', '/activity', { kind: 'CALL', summary: 'x' }),
      await b('post', '/notes', { text: 'x' }),
      await b('put', '/follow-up', { type: 'CALL', dueAt: future }),
      await b('post', '/follow-up/complete', {}),
      await b('post', '/convert-to-client', {
        idempotencyKey: randomUUID(),
        fullName: 'Pat',
        email: lead.email,
        phone: '+15550100999',
        serviceIds: [ids.tax],
        primaryStaffUserId: people.ownerB.id,
      }),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(Profile.parse(ok(await call('get', `/${lead.id}/profile`, people.ownerA))).stage).toBe(
      'SUBMITTED',
    );
  });

  it('audits the changes without any text', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      const rows = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.auditLog.findMany({ where: { businessId: ids.firmA, action: { startsWith: 'lead.' } } }),
      );
      const actions = new Set(rows.map((r) => r.action));
      for (const a of [
        'lead.follow_up_set',
        'lead.follow_up_completed',
        'lead.activity_logged',
        'lead.note_added',
        'lead.converted',
      ]) {
        expect(actions.has(a), a).toBe(true);
      }
      const text = JSON.stringify(rows.map((r) => r.metadata));
      expect(text).not.toContain('Carry me');
      expect(text).not.toContain('secret');
    } finally {
      await owner.$disconnect();
    }
  });
});
