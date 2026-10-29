// End-to-end: conversations with leads (R60, MSG-F03's Leads tab, on R1's message_threads.lead_id).
// New Message's email to a lead keeps a copy in the lead's own thread (one per subject); the
// Leads list, the thread with each message's channel and delivery, and the next email sent from
// the thread through New Message's own path. Staff reach only their own leads; another firm's are
// 404; the client inbox never lists a lead's thread. The notify service is replaced: nothing
// leaves. Synthetic data only.
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
  LeadMessage as LeadMessageShape,
  LeadMessageThread as ThreadShape,
  LeadMessageThreadDetail as DetailShape,
  OutboundMessage as OutboundShape,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const Thread = z.strictObject({ ...ThreadShape.shape });
const List = z.strictObject({ items: z.array(Thread), nextCursor: z.string().nullable() });
const Detail = z.strictObject({
  ...DetailShape.shape,
  messages: z.array(z.strictObject({ ...LeadMessageShape.shape })),
});
const Sent = z.strictObject({ ...LeadMessageShape.shape });
const Outbound = z.strictObject({ ...OutboundShape.shape });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60l-${key}-${run}@r60.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '', mine: '', other: '', optedOut: '', leadB: '', client: '' };
const MINE_EMAIL = `mine-${run}@example.test`;

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
  method: 'get' | 'post',
  path: string,
  who: { email: string } = people.ownerA,
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const list = async (query = '', who = people.ownerA) =>
  List.parse(ok(await call('get', `/lead-message-threads${query}`, who)).body);
const detail = async (id: string, who = people.ownerA) =>
  Detail.parse(ok(await call('get', `/lead-message-threads/${id}`, who)).body);
/** New Message's email to the leads, sent now. */
async function email(subject: string, body: string, leadIds: string[]) {
  const d = Outbound.parse(
    ok(
      await call('post', '/outbound-messages', people.ownerA, {
        channel: 'EMAIL',
        subject,
        body,
        leadIds,
      }),
      201,
    ).body,
  );
  return Outbound.parse(
    ok(
      await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
        version: d.updatedAt,
      }),
    ).body,
  );
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: `r60l-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r60l-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  const lead = (businessId: string, serviceId: string, first: string, data: object = {}) => ({
    businessId,
    serviceId,
    firstName: first,
    lastName: 'Lead',
    email: `${first.toLowerCase()}-${run}@example.test`,
    taxYear: 2025,
    status: 'SUBMITTED' as const,
    submittedAt: new Date(),
    ...data,
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    await tx.membership.create({
      data: { ...A, userId: people.ownerA.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.membership.create({
      data: { ...A, userId: people.staffA.id, role: 'STAFF', status: 'ACTIVE' },
    });
    const service = await tx.service.create({ data: { ...A, kind: 'OTHER', name: `O ${run}` } });
    // Mine: the staff member's lead, with a phone number.
    ids.mine = (
      await tx.lead.create({
        data: lead(ids.firmA, service.id, 'Mine', {
          email: MINE_EMAIL,
          phone: '(404) 555-0187',
          assignedUserId: people.staffA.id,
        }),
      })
    ).id;
    ids.other = (await tx.lead.create({ data: lead(ids.firmA, service.id, 'Other') })).id;
    ids.optedOut = (await tx.lead.create({ data: lead(ids.firmA, service.id, 'Optout') })).id;
    await tx.communicationConsent.create({
      data: { ...A, leadId: ids.optedOut, channel: 'EMAIL', status: 'OPTED_OUT', source: 'fake' },
    });
    ids.client = (await tx.client.create({ data: { ...A, displayName: 'Fake Client' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const service = await tx.service.create({
      data: { businessId: ids.firmB, kind: 'OTHER', name: `O ${run}` },
    });
    ids.leadB = (await tx.lead.create({ data: lead(ids.firmB, service.id, 'Bee') })).id;
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
      send: (m: NotifyMessage) => {
        outbox.push(m);
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

describe("New Message's email to a lead is kept in the lead's own thread", () => {
  it('one thread per lead and subject; the delivery links it; the Leads list shows it', async () => {
    const first = await email('Your consultation', `Hello ${run}`, [ids.mine, ids.other]);
    expect(first.status).toBe('SENT');
    const mine = first.recipients.find((r) => r.id === ids.mine)?.threadId;
    const other = first.recipients.find((r) => r.id === ids.other)?.threadId;
    expect(mine).toEqual(expect.any(String));
    expect(other).toEqual(expect.any(String));
    expect(mine).not.toBe(other);
    // The same subject again: the same thread. Another subject: a new one.
    const again = await email('Your consultation', `Again ${run}`, [ids.mine]);
    expect(again.recipients[0]?.threadId).toBe(mine);
    const another = await email('Your documents', `Docs ${run}`, [ids.mine]);
    expect(another.recipients[0]?.threadId).not.toBe(mine);

    const all = await list();
    expect(all.items.map((t) => t.id)).toEqual(
      expect.arrayContaining([mine, other, another.recipients[0]?.threadId]),
    );
    const row = all.items.find((t) => t.id === mine);
    expect(row).toMatchObject({
      lead: { id: ids.mine, displayName: 'Mine Lead', email: MINE_EMAIL, phone: '(404) 555-0187' },
      subject: 'Your consultation',
      startedBy: { kind: 'STAFF', userId: people.ownerA.id, name: 'Fake ownerA' },
      lastMessage: { excerpt: `Again ${run}`, senderName: 'Fake ownerA' },
      archivedAt: null,
    });
    const d = await detail(mine!);
    expect(d.messages.map((m) => [m.body, m.channel, m.status, m.sender.kind])).toEqual([
      [`Hello ${run}`, 'EMAIL', 'SENT', 'STAFF'],
      [`Again ${run}`, 'EMAIL', 'SENT', 'STAFF'],
    ]);
  });

  it("never in the client inbox, and a lead's thread is not a client thread", async () => {
    const [t] = (await list(`?search=${encodeURIComponent('Your consultation')}`)).items;
    const inbox = ok(await call('get', '/message-threads?limit=100')).body as {
      items: { id: string }[];
    };
    expect(inbox.items.map((i) => i.id)).not.toContain(t?.id);
    expect((await call('get', `/message-threads/${t?.id}`)).status).toBe(404);
  });

  it("search finds a thread by subject, text, the lead's name, email and phone in any format", async () => {
    const found = async (q: string) =>
      (await list(`?search=${encodeURIComponent(q)}`)).items.map((t) => t.lead.id);
    expect(await found(`Again ${run}`)).toEqual([ids.mine]);
    expect(await found('Mine Lead')).toEqual([ids.mine, ids.mine]);
    expect(await found(MINE_EMAIL)).toEqual([ids.mine, ids.mine]);
    expect(await found('+1 404 555 0187')).toEqual([ids.mine, ids.mine]);
    expect(await found('404.555.0187')).toEqual([ids.mine, ids.mine]);
    expect(await found(`Nothing ${run}`)).toEqual([]);
  });
});

describe('the next email from the thread', () => {
  it("goes through New Message with the thread's subject and lands in the same thread", async () => {
    const [t] = (await list(`?search=${encodeURIComponent(`Hello ${run}`)}`)).items;
    outbox.length = 0;
    const sent = Sent.parse(
      ok(
        await call('post', `/lead-message-threads/${t!.id}/messages`, people.ownerA, {
          body: `Reply ${run}`,
          channel: 'EMAIL',
        }),
        201,
      ).body,
    );
    expect(sent).toMatchObject({ threadId: t!.id, channel: 'EMAIL', status: 'SENT' });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ template: 'lead.message-email' });
    expect(JSON.stringify(outbox[0]?.data)).toContain('Your consultation');
    expect(JSON.stringify(outbox[0]?.data)).toContain(`Reply ${run}`);
    expect((await detail(t!.id)).messages.at(-1)?.body).toBe(`Reply ${run}`);
  });

  it('refuses a lead the channel cannot reach, and writes nothing', async () => {
    const out = await email('Opt out', `To optout ${run}`, [ids.other, ids.optedOut]);
    expect(out.recipients.find((r) => r.id === ids.optedOut)).toMatchObject({
      reason: 'NO_CONSENT',
      threadId: null,
    });
    // An opted-out lead has no thread from it; one opened another way still refuses the email.
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const thread = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.messageThread.create({
        data: { businessId: ids.firmA, leadId: ids.optedOut, subject: 'Earlier' },
      }),
    );
    await owner.$disconnect();
    outbox.length = 0;
    const res = await call('post', `/lead-message-threads/${thread.id}/messages`, people.ownerA, {
      body: 'No',
      channel: 'EMAIL',
    });
    expect(res.status).toBe(409);
    expect(codeOf(res)).toBe('NO_CONSENT');
    const sms = await call('post', `/lead-message-threads/${thread.id}/messages`, people.ownerA, {
      body: 'No',
      channel: 'SMS',
    });
    expect(codeOf(sms)).toBe('PROVIDER_UNAVAILABLE');
    expect(outbox).toHaveLength(0);
    expect((await detail(thread.id)).messages).toEqual([]);
  });

  it('checks the body: empty, too long for a text, unknown fields', async () => {
    const [t] = (await list(`?search=${encodeURIComponent(`Hello ${run}`)}`)).items;
    const bad = async (body: object) =>
      codeOf(await call('post', `/lead-message-threads/${t!.id}/messages`, people.ownerA, body));
    expect(await bad({ body: ' ', channel: 'EMAIL' })).toBe('VALIDATION_FAILED');
    expect(await bad({ body: 'x'.repeat(1601), channel: 'SMS' })).toBe('VALIDATION_FAILED');
    expect(await bad({ body: 'x', channel: 'PORTAL' })).toBe('VALIDATION_FAILED');
    expect(await bad({ body: 'x', channel: 'EMAIL', leadId: ids.other })).toBe('VALIDATION_FAILED');
  });
});

describe('reach', () => {
  it("Staff see only their own leads' threads; another lead's is 404", async () => {
    const theirs = await list('', people.staffA);
    expect(theirs.items.length).toBeGreaterThan(0);
    expect(theirs.items.every((t) => t.lead.id === ids.mine)).toBe(true);
    const [other] = (await list(`?search=${encodeURIComponent('Other Lead')}`)).items;
    expect((await call('get', `/lead-message-threads/${other!.id}`, people.staffA)).status).toBe(
      404,
    );
    expect(
      (
        await call('post', `/lead-message-threads/${other!.id}/messages`, people.staffA, {
          body: 'x',
          channel: 'EMAIL',
        })
      ).status,
    ).toBe(404);
  });

  it("another firm never lists, reads or writes in this firm's lead threads", async () => {
    const [t] = (await list()).items;
    expect(
      (
        ok(await call('get', '/lead-message-threads', people.ownerB, undefined, ids.firmB))
          .body as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);
    for (const res of [
      await call('get', `/lead-message-threads/${t!.id}`, people.ownerB, undefined, ids.firmB),
      await call(
        'post',
        `/lead-message-threads/${t!.id}/messages`,
        people.ownerB,
        { body: 'x', channel: 'EMAIL' },
        ids.firmB,
      ),
    ])
      expect(res.status).toBe(404);
    // Firm A cannot write to firm B's lead through New Message either.
    expect(
      (
        await call('post', '/outbound-messages', people.ownerA, {
          channel: 'EMAIL',
          subject: 'x',
          body: 'x',
          leadIds: [ids.leadB],
        })
      ).status,
    ).toBe(404);
  });
});
