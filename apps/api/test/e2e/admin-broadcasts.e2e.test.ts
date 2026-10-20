// End-to-end: Super Admin broadcasts, audiences and files (R56 on R0's B6; contract in
// packages/types/src/admin-communications/broadcasts.ts). Audiences of firm owners, sales leads
// and the team (never a firm's clients) and their counts; a broadcast drafted in steps, tested,
// sent (NotifyService faked: an address starting "fail" is refused), partly sent, retried,
// scheduled, cancelled, duplicated, archived and deleted; in-app to the team's bells; the file
// library's upload ticket. Firm sessions get 401.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AdminCommBroadcast,
  AdminCommMediaTicket,
  AdminCommSegment,
  AdminCommSegmentCount,
  ListAdminCommBroadcastRecipientsResponse,
  ListAdminCommSegmentsResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const me = { id: randomUUID(), email: `r56ab-me-${run}@r56ab.test` };
const owner = { id: randomUUID(), email: `r56ab-owner-${run}@r56ab.test` };
let firmId = '';
const leads = { good: '', bad: '' };
const BASE = '/api/v1/admin/communications';

const sent: NotifyMessage[] = [];
let failEverything = false;
const fakeNotify = {
  send: (m: NotifyMessage) => {
    if (failEverything || m.to.startsWith('fail'))
      return Promise.reject(Object.assign(new Error('refused'), { reason: 'InvalidRecipient' }));
    sent.push(m);
    return Promise.resolve();
  },
};

let app: INestApplication;
const tokens = new Map<string, string>();
let viewerSeq = 0;
const newViewer = () => `198.21.${(viewerSeq >> 8) & 255}.${viewerSeq++ & 255}`;
async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}
type Method = 'get' | 'post' | 'patch' | 'delete';
async function call(
  method: Method,
  path: string,
  body?: object,
  who: { email: string } | null = me,
) {
  let req = request(app.getHttpServer())
    [method](`${BASE}${path}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
async function ok<T>(method: Method, path: string, body?: object): Promise<T> {
  const res = await call(method, path, body);
  expect(res.status, `${method} ${path} ${JSON.stringify(res.body)}`).toBe(200);
  return res.body as T;
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const later = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
const key = () => ({ idempotencyKey: randomUUID() });
const db = () => createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);

async function segment(name: string, definition: object) {
  return AdminCommSegment.parse(
    await ok('post', '/segments', { name: `${name} ${run}`, definition }),
  );
}
async function broadcast(segmentId: string, channels: object[]) {
  const b = AdminCommBroadcast.parse(
    await ok('post', '/broadcasts', { name: `Fake broadcast ${run}` }),
  );
  return AdminCommBroadcast.parse(
    await ok('patch', `/broadcasts/${b.id}`, { segmentId, channels }),
  );
}

beforeAll(async () => {
  const c = db();
  await runInScope(c, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: { id: me.id, cognitoSub: me.id, pool: 'ADMIN', email: me.email, name: 'Fake R56 me' },
    });
    await tx.platformAdmin.create({ data: { userId: me.id } });
    await tx.user.create({
      data: {
        id: owner.id,
        cognitoSub: owner.id,
        pool: 'STAFF',
        email: owner.email,
        name: 'Jordan Sample',
      },
    });
    firmId = (
      await tx.business.create({
        data: { slug: `r56ab-${run}`, name: `Broadcast Firm ${run}`, status: 'ACTIVE' },
      })
    ).id;
    leads.good = (
      await tx.salesContact.create({
        data: {
          name: 'Riley Lead',
          email: `riley-${run}@lead.example.test`,
          phone: '+15125550147',
        },
      })
    ).id;
    leads.bad = (
      await tx.salesContact.create({
        data: { name: 'Casey Lead', email: `fail-${run}@lead.example.test` },
      })
    ).id;
  });
  await runInScope(c, { kind: 'business', businessId: firmId }, (tx) =>
    tx.membership.create({
      data: { businessId: firmId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
  await c.$disconnect();
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue(fakeNotify)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('who may call', () => {
  it('answers 401 signed out and to a firm session', async () => {
    for (const who of [null, fx.users.ownerA])
      expect((await call('get', '/broadcasts', undefined, who)).status).toBe(401);
  });
});

describe('audiences', () => {
  it('creates, counts per channel, refuses a duplicate name, archives', async () => {
    const s = await segment('Leads', {
      contactTypes: ['LEAD'],
      salesContactIds: [leads.good, leads.bad],
    });
    const counted = AdminCommSegmentCount.parse(await ok('post', `/segments/${s.id}/count`));
    expect(counted).toMatchObject({ total: 2, byChannel: { EMAIL: 2, SMS: 1, IN_APP: 0 } });
    const dup = await call('post', '/segments', {
      name: `Leads ${run}`,
      definition: { contactTypes: ['TEAM'] },
    });
    expect([dup.status, codeOf(dup)]).toEqual([409, 'DUPLICATE_NAME']);
    const clients = await call('post', '/segments', {
      name: `Clients ${run}`,
      definition: { contactTypes: ['CLIENT'] },
    });
    expect(clients.status).toBe(400);
    const archived = AdminCommSegment.parse(
      await ok('patch', `/segments/${s.id}`, { archived: true }),
    );
    expect(archived.archivedAt).not.toBeNull();
    const list = ListAdminCommSegmentsResponse.parse(
      await ok('get', `/segments?archived=true&search=${run}`),
    );
    expect(list.items.map((x) => x.id)).toContain(s.id);
    const b = AdminCommBroadcast.parse(
      await ok('post', '/broadcasts', { name: `Uses archived ${run}` }),
    );
    const res = await call('patch', `/broadcasts/${b.id}`, { segmentId: s.id });
    expect([res.status, codeOf(res)]).toEqual([409, 'SEGMENT_ARCHIVED']);
  });
});

describe('sending', () => {
  it('drafts in steps, tests to me, sends, records a partial send, then is fixed', async () => {
    const s = await segment('Both leads', {
      contactTypes: ['LEAD'],
      salesContactIds: [leads.good, leads.bad],
    });
    const b = await broadcast(s.id, [
      {
        channel: 'EMAIL',
        subject: 'News for {{contact.first_name}}',
        body: 'Hi {{contact.first_name}}',
      },
      { channel: 'SMS', body: 'Hi {{contact.first_name}}' },
    ]);
    expect(b.channels.map((c) => [c.channel, c.status])).toEqual([
      ['EMAIL', 'DRAFT'],
      ['SMS', 'DRAFT'],
    ]);
    expect(await ok('post', `/broadcasts/${b.id}/test`, { channels: ['EMAIL'] })).toEqual({
      sentTo: [me.email],
    });
    expect(sent.at(-1)).toMatchObject({
      to: me.email,
      data: { subject: '[Test] News for Jordan' },
    });
    const done = AdminCommBroadcast.parse(await ok('post', `/broadcasts/${b.id}/send`, key()));
    expect(done).toMatchObject({ status: 'PARTIALLY_SENT', recipientCount: 2 });
    expect(done.channels.map((c) => [c.channel, c.status, c.sentCount, c.failedCount])).toEqual([
      ['EMAIL', 'PARTIALLY_SENT', 1, 1],
      ['SMS', 'SENT', 1, 0],
    ]);
    expect(sent.find((m) => m.to === `riley-${run}@lead.example.test`)).toMatchObject({
      data: { subject: 'News for Riley', body: 'Hi Riley' },
    });
    const failed = ListAdminCommBroadcastRecipientsResponse.parse(
      await ok('get', `/broadcasts/${b.id}/recipients?status=FAILED`),
    );
    expect(failed.items).toEqual([
      expect.objectContaining({
        channel: 'EMAIL',
        name: 'Casey Lead',
        errorCode: 'invalid_recipient',
      }),
    ]);
    const again = AdminCommBroadcast.parse(await ok('post', `/broadcasts/${b.id}/send`, key()));
    expect(again.status).toBe('PARTIALLY_SENT');
    const edit = await call('patch', `/broadcasts/${b.id}`, { name: 'Changed' });
    expect([edit.status, codeOf(edit)]).toEqual([409, 'NOT_EDITABLE']);
    const retry = await call('post', `/broadcasts/${b.id}/retry`, key());
    expect([retry.status, codeOf(retry)]).toEqual([409, 'NOT_RETRYABLE']);
    expect(
      AdminCommBroadcast.parse(await ok('post', `/broadcasts/${b.id}/archive`)).archivedAt,
    ).not.toBeNull();
  });

  it('retries a failed broadcast and counts both attempts', async () => {
    const s = await segment('Good lead', { contactTypes: ['LEAD'], salesContactIds: [leads.good] });
    const b = await broadcast(s.id, [{ channel: 'SMS', body: 'Hello' }]);
    failEverything = true;
    const failed = AdminCommBroadcast.parse(await ok('post', `/broadcasts/${b.id}/send`, key()));
    failEverything = false;
    expect(failed).toMatchObject({ status: 'FAILED' });
    expect(failed.errorMessage).toContain('did not go out');
    const retried = AdminCommBroadcast.parse(await ok('post', `/broadcasts/${b.id}/retry`, key()));
    expect(retried.status).toBe('SENT');
    expect(retried.channels[0]).toMatchObject({ status: 'SENT', sentCount: 1, failedCount: 0 });
  });

  it('refuses to send without an audience, content, or anyone reachable', async () => {
    const bare = AdminCommBroadcast.parse(await ok('post', '/broadcasts', { name: `Bare ${run}` }));
    const noSeg = await call('post', `/broadcasts/${bare.id}/send`, key());
    expect([noSeg.status, codeOf(noSeg)]).toEqual([409, 'NO_SEGMENT']);
    const s = await segment('Firm owner', { contactTypes: ['FIRM'], firmIds: [firmId] });
    await ok('patch', `/broadcasts/${bare.id}`, { segmentId: s.id });
    const noChannel = await call('post', `/broadcasts/${bare.id}/send`, key());
    expect([noChannel.status, codeOf(noChannel)]).toEqual([409, 'NO_CHANNEL']);
    await ok('patch', `/broadcasts/${bare.id}`, {
      channels: [{ channel: 'SMS', body: 'No phone' }],
    });
    const empty = await call('post', `/broadcasts/${bare.id}/send`, key());
    expect([empty.status, codeOf(empty)]).toEqual([409, 'EMPTY_AUDIENCE']);
  });

  it('puts an in-app broadcast in the team’s bells', async () => {
    const s = await segment('Team', { contactTypes: ['TEAM'] });
    const b = await broadcast(s.id, [{ channel: 'IN_APP', body: 'Team update (sample)' }]);
    expect(
      AdminCommBroadcast.parse(await ok('post', `/broadcasts/${b.id}/send`, key())).status,
    ).toBe('SENT');
    const c = db();
    const bell = await runInScope(c, { kind: 'platform' }, (tx) =>
      tx.platformNotification.findMany({ where: { recipientUserId: me.id, sourceId: b.id } }),
    );
    await c.$disconnect();
    expect(bell).toEqual([
      expect.objectContaining({ type: 'communications.broadcast', body: 'Team update (sample)' }),
    ]);
  });
});

describe('schedules, copies and drafts', () => {
  it('schedules for the future, cancels, archives, never deletes it', async () => {
    const s = await segment('Scheduled', { contactTypes: ['LEAD'], salesContactIds: [leads.good] });
    const b = await broadcast(s.id, [{ channel: 'EMAIL', subject: 'Later', body: 'Later' }]);
    const past = await call('post', `/broadcasts/${b.id}/schedule`, {
      scheduledAt: '2020-01-01T00:00:00.000Z',
      scheduledTimeZone: 'America/New_York',
    });
    expect([past.status, codeOf(past)]).toEqual([409, 'SCHEDULE_IN_PAST']);
    const sch = AdminCommBroadcast.parse(
      await ok('post', `/broadcasts/${b.id}/schedule`, {
        scheduledAt: later(),
        scheduledTimeZone: 'America/New_York',
      }),
    );
    expect(sch.status).toBe('SCHEDULED');
    expect(AdminCommBroadcast.parse(await ok('post', `/broadcasts/${b.id}/cancel`)).status).toBe(
      'CANCELLED',
    );
    const del = await call('delete', `/broadcasts/${b.id}`);
    expect([del.status, codeOf(del)]).toEqual([409, 'NOT_DRAFT']);
    const again = await call('post', `/broadcasts/${b.id}/cancel`);
    expect([again.status, codeOf(again)]).toEqual([409, 'NOT_SCHEDULED']);
    expect(
      AdminCommBroadcast.parse(await ok('post', `/broadcasts/${b.id}/archive`)).archivedAt,
    ).not.toBeNull();
  });

  it('duplicates into a draft and deletes a draft', async () => {
    const s = await segment('Copy', { contactTypes: ['LEAD'], salesContactIds: [leads.good] });
    const b = await broadcast(s.id, [{ channel: 'SMS', body: 'Copy me' }]);
    const copy = AdminCommBroadcast.parse(await ok('post', `/broadcasts/${b.id}/duplicate`));
    expect(copy).toMatchObject({
      status: 'DRAFT',
      name: `Fake broadcast ${run} (copy)`,
      duplicatedFromId: b.id,
      segment: { id: s.id },
    });
    expect(copy.channels.map((c) => c.body)).toEqual(['Copy me']);
    const notDone = await call('post', `/broadcasts/${copy.id}/archive`);
    expect([notDone.status, codeOf(notDone)]).toEqual([409, 'NOT_FINISHED']);
    expect(await ok('delete', `/broadcasts/${copy.id}`)).toEqual({ ok: true });
    expect((await call('get', `/broadcasts/${copy.id}`)).status).toBe(404);
  });

  it('gives an upload ticket under the platform prefix; an unscanned file is not used', async () => {
    const t = AdminCommMediaTicket.parse(
      await ok('post', '/media', {
        kind: 'ATTACHMENT',
        fileName: 'Price list.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1200,
        sha256: 'a'.repeat(64),
      }),
    );
    expect(t.media).toMatchObject({
      scanStatus: 'PENDING',
      fileName: 'Price list.pdf',
      uploadedBy: { userId: me.id },
    });
    expect(t.uploadUrl).toContain(`platform/communications/${t.media.id}/Price_list.pdf`);
    const b = AdminCommBroadcast.parse(
      await ok('post', '/broadcasts', { name: `With file ${run}` }),
    );
    const res = await call('patch', `/broadcasts/${b.id}`, {
      channels: [{ channel: 'EMAIL', subject: 'File', body: 'See file', mediaIds: [t.media.id] }],
    });
    expect([res.status, codeOf(res)]).toEqual([409, 'MEDIA_NOT_USABLE']);
  });
});
