// End-to-end: R20 steps 2 and 3, message threads (contract in packages/types/src/messages).
// The firm and the client exchange messages; read state is one per receiving side and changes
// only by its own POSTs; unread counts on both sides; replies can be closed; Staff reach only
// their clients; nothing crosses to another client or another firm; the audit log has no text.
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
  Message as MessageShape,
  MessageThread as ThreadShape,
  MyMessage as MyMessageShape,
  MyMessageThread as MyThreadShape,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

// Strict copies of the contract's shapes: a leaked field fails the parse.
const Message = z.strictObject({
  ...MessageShape.shape,
  sender: z.strictObject(MessageShape.shape.sender.shape),
});
const Thread = z.strictObject({ ...ThreadShape.shape });
const ThreadDetail = Thread.extend({ messages: z.array(Message) });
const ThreadList = z.strictObject({ items: z.array(Thread), nextCursor: z.string().nullable() });
const MyMessage = z.strictObject({ ...MyMessageShape.shape });
const MyThread = z.strictObject({ ...MyThreadShape.shape });
const MyDetail = MyThread.extend({ messages: z.array(MyMessage) });
const MyList = z.strictObject({ items: z.array(MyThread), nextCursor: z.string().nullable() });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r20m-${key}-${run}@r20.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  adminA: person('admin-a'),
  goneOwnerA: person('gone-owner-a'),
  primary: person('primary'),
  spouse: person('spouse'),
  other: person('other'),
  disabledPrimary: person('disabled-primary'),
  spouseThree: person('spouse-three'),
  ownerB: person('owner-b'),
  clientB: person('client-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r20m-a-${run}`,
  slugB: `r20m-b-${run}`,
  one: '',
  two: '',
  three: '',
  old: '',
  engagementTwo: '',
};

let app: INestApplication;
const outbox: NotifyMessage[] = [];
/** Addresses the mail sender refuses, to show a refused email never fails the request. */
const refused: string[] = [];
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

async function firm(
  method: 'get' | 'post' | 'patch',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

async function portal(
  method: 'get' | 'post',
  path: string,
  who: { email: string },
  body?: object,
  slug = ids.slugA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${slug}/me/messages${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectOk = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const startThread = async (body: object, clientId = ids.one, who = people.ownerA) =>
  ThreadDetail.parse(
    expectOk(await firm('post', `/clients/${clientId}/message-threads`, who, body), 201).body,
  );
const firmCounts = async (who = people.staffA) => {
  const body = expectOk(await firm('get', '/message-threads/unread-count', who)).body as {
    total: number;
    byClient: { clientId: string; count: number }[];
  };
  expect(body.total).toBe(body.byClient.reduce((sum, c) => sum + c.count, 0));
  return body.byClient.find((c) => c.clientId === ids.one)?.count ?? 0;
};
const badge = async (who = people.primary) =>
  (expectOk(await portal('get', '/unread-count', who)).body as { count: number }).count;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = [
        'primary',
        'spouse',
        'other',
        'disabledPrimary',
        'spouseThree',
        'clientB',
      ].includes(key)
        ? 'CLIENT'
        : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R20 ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: ids.slugB, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [userId, role, status] of [
      [people.ownerA.id, 'OWNER', 'ACTIVE'],
      [people.staffA.id, 'STAFF', 'ACTIVE'],
      [people.staffA2.id, 'STAFF', 'ACTIVE'],
      [people.adminA.id, 'ADMIN', 'ACTIVE'],
      [people.goneOwnerA.id, 'OWNER', 'DEACTIVATED'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status } });
    }
    ids.one = (
      await tx.client.create({
        data: { ...A, displayName: 'One', assignedUserId: people.staffA.id },
      })
    ).id;
    ids.two = (await tx.client.create({ data: { ...A, displayName: 'Two' } })).id;
    ids.three = (await tx.client.create({ data: { ...A, displayName: 'Three' } })).id;
    ids.old = (
      await tx.client.create({ data: { ...A, displayName: 'Old', archivedAt: new Date() } })
    ).id;
    for (const [p, clientId, portalRole, status] of [
      [people.primary, ids.one, 'PRIMARY', 'ACTIVE'],
      [people.spouse, ids.one, 'SPOUSE', 'ACTIVE'],
      [people.other, ids.two, 'PRIMARY', 'ACTIVE'],
      [people.disabledPrimary, ids.three, 'PRIMARY', 'DISABLED'],
      [people.spouseThree, ids.three, 'SPOUSE', 'ACTIVE'],
    ] as const) {
      await tx.clientAccount.create({
        data: { ...A, userId: p.id, clientId, email: p.email, portalRole, status },
      });
    }
    const service = await tx.service.create({
      data: { ...A, kind: 'OTHER', name: `Other ${run}` },
    });
    ids.engagementTwo = (
      await tx.engagement.create({
        data: { ...A, clientId: ids.two, serviceId: service.id, title: 'Two' },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const clientB = await tx.client.create({ data: { ...B, displayName: 'B one' } });
    await tx.clientAccount.create({
      data: {
        ...B,
        userId: people.clientB.id,
        clientId: clientB.id,
        email: people.clientB.email,
        status: 'ACTIVE',
      },
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
        if (refused.includes(message.to)) return Promise.reject(new Error('refused'));
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

describe('both ways, with read state', () => {
  it('the firm writes; the client reads; GET marks nothing; read and unread are POSTs', async () => {
    const before = await badge();
    const t = await startThread({ subject: 'Welcome', body: 'Hello from the firm' });
    expect(t).toMatchObject({
      client: { id: ids.one, displayName: 'One' },
      repliesEnabled: true,
      startedBy: { kind: 'STAFF', userId: people.ownerA.id, name: 'Fake R20 ownerA' },
      unreadCount: 0,
    });
    expect(t.messages).toHaveLength(1);
    expect(await badge()).toBe(before + 1);

    const list = MyList.parse(expectOk(await portal('get', '', people.primary)).body);
    const row = list.items.find((x) => x.id === t.id);
    expect(row).toMatchObject({ from: 'FIRM', senderName: null, unreadCount: 1 });

    const seen = MyDetail.parse(expectOk(await portal('get', `/${t.id}`, people.primary)).body);
    expect(seen.messages[0]).toMatchObject({
      from: 'FIRM',
      unread: true,
      body: 'Hello from the firm',
    });
    // No staff name or id reaches the portal.
    expect(JSON.stringify(seen)).not.toContain(people.ownerA.id);
    expect(JSON.stringify(seen)).not.toContain('ownerA');
    expect(await badge()).toBe(before + 1);

    // The spouse's read counts for the whole client.
    expectOk(await portal('post', `/${t.id}/read`, people.spouse, {}));
    expect(await badge()).toBe(before);
    const receipt = ThreadDetail.parse(
      expectOk(await firm('get', `/message-threads/${t.id}`, people.ownerA)).body,
    );
    expect(receipt.messages[0]?.readAt).not.toBeNull();

    const back = MyThread.parse(
      expectOk(await portal('post', `/${t.id}/unread`, people.primary, {})).body,
    );
    expect(back.unreadCount).toBe(1);
    expect(await badge()).toBe(before + 1);
  });

  it('the client replies; the firm counts, reads and marks unread', async () => {
    const t = await startThread({ subject: 'Docs', body: 'Please send' });
    const before = await firmCounts();
    const reply = MyMessage.parse(
      expectOk(
        await portal('post', `/${t.id}/messages`, people.spouse, { body: 'Sent today' }),
        201,
      ).body,
    );
    expect(reply).toMatchObject({ from: 'ME', unread: false });
    const spouseView = MyDetail.parse(
      expectOk(await portal('get', `/${t.id}`, people.primary)).body,
    );
    expect(spouseView.messages[1]).toMatchObject({
      from: 'HOUSEHOLD',
      senderName: 'Fake R20 spouse',
    });

    expect(await firmCounts()).toBe(before + 1);

    const unreadOnly = ThreadList.parse(
      expectOk(await firm('get', '/message-threads?unread=true', people.ownerA)).body,
    );
    const row = unreadOnly.items.find((x) => x.id === t.id);
    expect(row).toMatchObject({
      unreadCount: 1,
      lastMessage: {
        direction: 'CLIENT_TO_FIRM',
        senderName: 'Fake R20 spouse',
        excerpt: 'Sent today',
      },
    });

    const read = Thread.parse(
      expectOk(await firm('post', `/message-threads/${t.id}/read`, people.staffA, {})).body,
    );
    expect(read.unreadCount).toBe(0);
    expect(await firmCounts(people.ownerA)).toBe(before);
    const again = Thread.parse(
      expectOk(await firm('post', `/message-threads/${t.id}/unread`, people.ownerA, {})).body,
    );
    expect(again.unreadCount).toBe(1);
    expect(await firmCounts()).toBe(before + 1);
  });

  it('two replies at once on one thread both land', async () => {
    const t = await startThread({ subject: 'Both at once', body: 'Reply any time' });
    const results = await Promise.all(
      [people.primary, people.spouse, people.primary, people.spouse].map((who, n) =>
        portal('post', `/${t.id}/messages`, who, { body: `Parallel ${n}` }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const detail = ThreadDetail.parse(
      expectOk(await firm('get', `/message-threads/${t.id}`, people.ownerA)).body,
    );
    expect(detail.messages).toHaveLength(5);
  });

  it('the client starts a thread; filters and search; nothing to mark unread is 409', async () => {
    const subject = `Deduction ${run}`;
    const mine = MyDetail.parse(
      expectOk(
        await portal('post', '', people.primary, { subject, body: 'Home office question' }),
        201,
      ).body,
    );
    expect(mine).toMatchObject({ from: 'ME', unreadCount: 0 });
    const ids_ = (res: Response) => MyList.parse(res.body).items.map((x) => x.id);
    expect(ids_(await portal('get', '?filter=sent', people.primary))).toContain(mine.id);
    expect(ids_(await portal('get', '?filter=sent', people.spouse))).not.toContain(mine.id);
    expect(ids_(await portal('get', '?filter=from-firm', people.primary))).not.toContain(mine.id);
    expect(ids_(await portal('get', '?search=home%20office', people.spouse))).toEqual([mine.id]);

    const firmSide = ThreadDetail.parse(
      expectOk(await firm('get', `/message-threads/${mine.id}`, people.staffA)).body,
    );
    expect(firmSide.startedBy).toMatchObject({ kind: 'CLIENT', userId: people.primary.id });
    const res = await portal('post', `/${mine.id}/unread`, people.primary, {});
    expect([res.status, codeOf(res)]).toEqual([409, 'NOTHING_TO_MARK']);
  });

  it('closed replies refuse the client but not the firm', async () => {
    const t = await startThread({ subject: 'Final', body: 'Done', repliesEnabled: false });
    const closed = await portal('post', `/${t.id}/messages`, people.primary, { body: 'One more' });
    expect([closed.status, codeOf(closed)]).toEqual([409, 'REPLIES_CLOSED']);
    Message.parse(
      expectOk(
        await firm('post', `/message-threads/${t.id}/messages`, people.staffA, { body: 'P.S.' }),
        201,
      ).body,
    );
    const open = Thread.parse(
      expectOk(
        await firm('patch', `/message-threads/${t.id}`, people.ownerA, { repliesEnabled: true }),
      ).body,
    );
    expect(open.repliesEnabled).toBe(true);
    expectOk(await portal('post', `/${t.id}/messages`, people.primary, { body: 'Thanks' }), 201);
  });
});

describe('reach and isolation', () => {
  it('Staff reach only their clients; another firm reaches nothing', async () => {
    const t = await startThread({ subject: 'Private', body: 'For One' });
    for (const [method, path, body] of [
      ['get', `/message-threads/${t.id}`, undefined],
      ['post', `/message-threads/${t.id}/messages`, { body: 'x' }],
      ['post', `/message-threads/${t.id}/read`, {}],
      ['patch', `/message-threads/${t.id}`, { repliesEnabled: false }],
      ['get', `/clients/${ids.one}/message-threads`, undefined],
      ['post', `/clients/${ids.one}/message-threads`, { subject: 's', body: 'b' }],
    ] as const) {
      const unassigned = await firm(method, path, people.staffA2, body);
      expect([path, unassigned.status]).toEqual([path, 404]);
    }
    const inbox = ThreadList.parse(
      expectOk(await firm('get', '/message-threads', people.staffA2)).body,
    );
    expect(inbox.items.map((x) => x.client.id)).not.toContain(ids.one);
    const counts = expectOk(await firm('get', '/message-threads/unread-count', people.staffA2))
      .body as {
      byClient: { clientId: string }[];
    };
    expect(counts.byClient.map((c) => c.clientId)).not.toContain(ids.one);

    // Firm B's owner, acting in firm B, by thread id and by client id.
    for (const path of [`/message-threads/${t.id}`, `/clients/${ids.one}/message-threads`]) {
      const res = await firm('get', path, people.ownerB, undefined, ids.firmB);
      expect([path, res.status]).toEqual([path, 404]);
    }
    // Firm B's owner naming firm A: no place there.
    expect((await firm('get', '/message-threads', people.ownerB)).status).toBe(404);
  });

  it("a client never reaches another client's thread, nor another firm's portal", async () => {
    const t = await startThread({ subject: 'Only One', body: 'Hi' });
    for (const [method, path, body] of [
      ['get', `/${t.id}`, undefined],
      ['post', `/${t.id}/messages`, { body: 'x' }],
      ['post', `/${t.id}/read`, {}],
    ] as const) {
      const res = await portal(method, path, people.other, body);
      expect([path, res.status]).toEqual([path, 404]);
    }
    const list = MyList.parse(expectOk(await portal('get', '', people.other)).body);
    expect(list.items.map((x) => x.id)).not.toContain(t.id);
    const elsewhere = await portal('get', `/${t.id}`, people.primary, undefined, ids.slugB);
    // A session that has no place at firm B: 404 (in the browser, no firm B cookie at all: 401).
    expect(elsewhere.status).toBe(404);
    const bClient = await portal('get', `/${t.id}`, people.clientB, undefined, ids.slugB);
    expect(bClient.status).toBe(404);
  });

  it("refuses an archived client and another client's engagement; no client id in the portal body", async () => {
    const archived = await firm('post', `/clients/${ids.old}/message-threads`, people.ownerA, {
      subject: 's',
      body: 'b',
    });
    expect([archived.status, codeOf(archived)]).toEqual([409, 'CLIENT_ARCHIVED']);
    const wrong = await firm('post', `/clients/${ids.one}/message-threads`, people.ownerA, {
      subject: 's',
      body: 'b',
      engagementId: ids.engagementTwo,
    });
    expect(wrong.status).toBe(404);
    const injected = await portal('post', '', people.primary, {
      subject: 's',
      body: 'b',
      clientId: ids.two,
    });
    expect([injected.status, codeOf(injected)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('audits ids only, never a subject or a message', async () => {
    const t = await startThread({ subject: `Secret subject ${run}`, body: `Secret body ${run}` });
    expectOk(
      await portal('post', `/${t.id}/messages`, people.primary, { body: `Reply ${run}` }),
      201,
    );
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      const rows = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.auditLog.findMany({
          where: {
            businessId: ids.firmA,
            action: { in: ['message_thread.created', 'message.sent'] },
          },
        }),
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(rows)).not.toContain(run);
    } finally {
      await owner.$disconnect();
    }
  });
});

describe('notices', () => {
  const secret = randomUUID();
  const mail = () => outbox.splice(0).filter((m) => m.template === 'message.received');

  it('emails the primary login, with no text and once per unread run; a bell item too', async () => {
    mail();
    const t = await startThread({ subject: `Notice ${secret}`, body: `Body ${secret}` });
    const first = mail();
    expect(first.map((m) => m.to)).toEqual([people.primary.email]);
    expect(first[0]).toMatchObject({
      businessId: ids.firmA,
      data: {
        name: 'Fake R20 primary',
        link: expect.stringMatching(new RegExp(`/${ids.slugA}/messages$`)),
      },
    });
    expect(JSON.stringify(first)).not.toContain(secret);
    // Still unread: no second email for the thread.
    expectOk(
      await firm('post', `/message-threads/${t.id}/messages`, people.ownerA, { body: 'More' }),
      201,
    );
    expect(mail()).toEqual([]);
    expectOk(await portal('post', `/${t.id}/read`, people.primary, {}));
    expectOk(
      await firm('post', `/message-threads/${t.id}/messages`, people.ownerA, { body: 'Again' }),
      201,
    );
    expect(mail()).toHaveLength(1);

    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      const bell = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.notification.findMany({
          where: { businessId: ids.firmA, entityId: t.id },
          select: { recipientUserId: true },
        }),
      );
      const to = new Set(bell.map((b) => b.recipientUserId));
      expect(to.has(people.primary.id)).toBe(true);
      expect(to.has(people.ownerA.id)).toBe(false);
      expect(to.has(people.spouse.id)).toBe(false);
    } finally {
      await owner.$disconnect();
    }
  });

  it("emails the client's assigned member and every active Owner and Admin, nobody else", async () => {
    const t = await startThread({ subject: 'Ask', body: 'Question?' });
    mail();
    expectOk(
      await portal('post', `/${t.id}/messages`, people.spouse, { body: `Answer ${secret}` }),
      201,
    );
    const sent = mail();
    expect(sent.map((m) => m.to).sort()).toEqual(
      [people.ownerA.email, people.adminA.email, people.staffA.email].sort(),
    );
    expect(sent[0]?.data).toMatchObject({
      link: expect.stringMatching(new RegExp(`/clients/${ids.one}/messages$`)),
    });
    expect(JSON.stringify(sent)).not.toContain(secret);
  });
  it('emails no one at a client whose primary login is disabled, not even the spouse', async () => {
    mail();
    const t = await startThread({ subject: 'Three', body: 'Hello' }, ids.three);
    expect(mail()).toEqual([]);
    // The spouse may still reply; the firm side is emailed as usual.
    expectOk(await portal('post', `/${t.id}/messages`, people.spouseThree, { body: 'Hi' }), 201);
    expect(mail().map((m) => m.to)).not.toContain(people.spouseThree.email);
  });

  it('the firm side is emailed once per unread run, and again after the firm reads', async () => {
    const t = await startThread({ subject: 'Run', body: 'Start' });
    expectOk(await portal('post', `/${t.id}/read`, people.primary, {}));
    mail();
    const reply = async (body: string) =>
      expectOk(await portal('post', `/${t.id}/messages`, people.primary, { body }), 201);
    await reply('One');
    expect(mail()).toHaveLength(3);
    await reply('Two');
    expect(mail()).toEqual([]);
    expectOk(await firm('post', `/message-threads/${t.id}/read`, people.staffA, {}));
    await reply('Three');
    expect(mail()).toHaveLength(3);
  });

  it('two staff writing at once start one run: one email', async () => {
    for (let round = 0; round < 5; round += 1) {
      const t = await startThread({ subject: `Race ${round}`, body: 'Start' });
      expectOk(await portal('post', `/${t.id}/read`, people.primary, {}));
      mail();
      const results = await Promise.all(
        [people.ownerA, people.staffA, people.adminA].map((who) =>
          firm('post', `/message-threads/${t.id}/messages`, who, { body: 'Same time' }),
        ),
      );
      for (const res of results) expectOk(res, 201);
      expect(mail()).toHaveLength(1);
    }
  });

  it('a refused email still saves the message on both sides', async () => {
    refused.push(people.primary.email, people.ownerA.email);
    try {
      mail();
      const t = await startThread({ subject: 'Refused', body: 'Hello' });
      expect(mail()).toEqual([]);
      expectOk(await portal('post', `/${t.id}/messages`, people.primary, { body: 'Hi' }), 201);
      // The others are still emailed.
      expect(
        mail()
          .map((m) => m.to)
          .sort(),
      ).toEqual([people.adminA.email, people.staffA.email].sort());
    } finally {
      refused.length = 0;
    }
  });

  it('a reply refused for closed replies sends nothing', async () => {
    const t = await startThread({ subject: 'Closed', body: 'No replies', repliesEnabled: false });
    mail();
    const res = await portal('post', `/${t.id}/messages`, people.primary, { body: 'Hi' });
    expect(res.status).toBe(409);
    expect(codeOf(res)).toBe('REPLIES_CLOSED');
    expect(mail()).toEqual([]);
  });
});
