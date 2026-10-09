// End-to-end: R11 step 6, messages and notes (contract in packages/types/src/messages). The firm
// and its clients exchange subject threads (Staff: their own clients only; a client: only their
// own client's threads), with read receipts, unread counts, closed replies and vault
// attachments; the firm keeps internal notes; each portal login keeps a private notepad the firm
// can never read. Email notices carry no content. Every action is audited with ids only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type Scope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  FirmMessage as FirmMessageShape,
  InternalNote as InternalNoteShape,
  MessageAttachment,
  MessageThread as ThreadShape,
  MyMessage as MyMessageShape,
  MyMessageThread as MyThreadShape,
  MyNotepad,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

// Strict copies of the contract's shapes: a leaked field fails the parse.
const Attachment = z.strictObject(MessageAttachment.shape);
const Thread = z.strictObject({
  ...ThreadShape.shape,
  client: z.strictObject(ThreadShape.shape.client.shape),
});
const FirmMessage = z.strictObject({
  ...FirmMessageShape.shape,
  sender: z.strictObject(FirmMessageShape.shape.sender.shape),
  attachments: z.array(Attachment),
});
const ThreadDetail = Thread.extend({ messages: z.array(FirmMessage) });
const MyThread = z.strictObject(MyThreadShape.shape);
const MyMessage = z.strictObject({ ...MyMessageShape.shape, attachments: z.array(Attachment) });
const MyThreadDetail = MyThread.extend({ messages: z.array(MyMessage) });
const Note = z.strictObject({
  ...InternalNoteShape.shape,
  author: z.strictObject(InternalNoteShape.shape.author.shape),
});
const Unread = z.strictObject({ threads: z.number(), messages: z.number() });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r11m-${key}-${run}@r11.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  primary: person('primary'),
  spouse: person('spouse'),
  other: person('other'),
  ownerB: person('owner-b'),
};
const CLIENTS = ['primary', 'spouse', 'other'];
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r11m-a-${run}`,
  one: '',
  two: '',
  clientB: '',
  engagementOne: '',
  engagementTwo: '',
  shared: '',
  pending: '',
  internal: '',
  twoDoc: '',
};
const SECRET = `Synthetic secret text ${run}`;

let app: INestApplication;
const outbox: NotifyMessage[] = [];
let failNotify = false;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => {
  viewers += 1;
  return `198.51.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
};

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

type Who = { email: string };
async function firm(
  method: 'get' | 'post' | 'patch',
  path: string,
  who: Who,
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

async function portal(
  method: 'get' | 'post' | 'put',
  path: string,
  who: Who,
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${ids.slugA}/me${path}`)
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
function ok<S extends z.ZodType>(schema: S, res: Response, status = 200): z.infer<S> {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return schema.parse(res.body);
}
const fails = (res: Response, status: number, code: string) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(codeOf(res)).toBe(code);
};
/** `asApp`: as the API's own database role, which row-level security binds (the owner may not). */
const inScope = async <T>(scope: Scope, fn: (tx: TxClient) => Promise<T>, asApp = false) => {
  const owner = createPrismaClient(asApp ? fx.appUrl : testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, scope, fn);
  } finally {
    await owner.$disconnect();
  }
};
const inA = <T>(fn: (tx: TxClient) => Promise<T>) =>
  inScope({ kind: 'business', businessId: ids.firmA }, fn);
const newThread = async (clientId: string, body: object = {}, who: Who = people.ownerA) =>
  ok(
    ThreadDetail,
    await firm('post', `/clients/${clientId}/message-threads`, who, {
      subject: 'Tax Return Update',
      body: SECRET,
      ...body,
    }),
    201,
  );

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: CLIENTS.includes(key) ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R11m ${key}`,
        },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r11m-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
      [people.staffA2.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    ids.one = (
      await tx.client.create({
        data: { ...A, displayName: 'One', assignedUserId: people.staffA.id },
      })
    ).id;
    ids.two = (await tx.client.create({ data: { ...A, displayName: 'Two' } })).id;
    for (const [p, clientId, portalRole] of [
      [people.primary, ids.one, 'PRIMARY'],
      [people.spouse, ids.one, 'SPOUSE'],
      [people.other, ids.two, 'PRIMARY'],
    ] as const) {
      await tx.clientAccount.create({
        data: { ...A, userId: p.id, clientId, email: p.email, portalRole, status: 'ACTIVE' },
      });
    }
    const service = await tx.service.create({
      data: { ...A, kind: 'ANNUAL_TAX', name: `Tax ${run}` },
    });
    const engagement = async (clientId: string) =>
      (await tx.engagement.create({ data: { ...A, clientId, serviceId: service.id, title: 'T' } }))
        .id;
    ids.engagementOne = await engagement(ids.one);
    ids.engagementTwo = await engagement(ids.two);
    const doc = async (
      clientId: string,
      engagementId: string,
      direction: 'CLIENT_TO_FIRM' | 'FIRM_TO_CLIENT' | 'INTERNAL',
      clean: boolean,
    ) => {
      const id = randomUUID();
      await tx.document.create({
        data: {
          ...A,
          id,
          clientId,
          engagementId,
          direction,
          fileName: `Synthetic-${id.slice(0, 4)}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: 1024,
          sha256: 'a'.repeat(64),
          s3Key: `tenant/${ids.firmA}/${id}`,
        },
      });
      if (clean) {
        await tx.document.update({
          where: { id },
          data: { scanStatus: 'CLEAN', scannedAt: new Date() },
        });
      }
      return id;
    };
    ids.shared = await doc(ids.one, ids.engagementOne, 'FIRM_TO_CLIENT', true);
    ids.pending = await doc(ids.one, ids.engagementOne, 'CLIENT_TO_FIRM', false);
    ids.internal = await doc(ids.one, ids.engagementOne, 'INTERNAL', true);
    ids.twoDoc = await doc(ids.two, ids.engagementTwo, 'CLIENT_TO_FIRM', true);
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientB = (await tx.client.create({ data: { ...B, displayName: 'B client' } })).id;
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
        if (failNotify) return Promise.reject(new Error('synthetic delivery failure'));
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

describe('threads', () => {
  it('the firm starts a thread with an attachment; the client gets a notice without content', async () => {
    outbox.length = 0;
    const thread = await newThread(ids.one, {
      engagementId: ids.engagementOne,
      attachmentDocumentIds: [ids.shared],
    });
    expect(thread).toMatchObject({
      client: { id: ids.one, displayName: 'One' },
      engagementId: ids.engagementOne,
      repliesEnabled: true,
      lastMessageDirection: 'FIRM_TO_CLIENT',
      unreadCount: 0,
    });
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({
      direction: 'FIRM_TO_CLIENT',
      sender: { userId: people.ownerA.id, name: 'Fake R11m ownerA' },
      body: SECRET,
      readAt: null,
      attachments: [{ id: ids.shared, contentType: 'application/pdf', sizeBytes: 1024 }],
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      template: 'message.new',
      to: people.primary.email,
      businessId: ids.firmA,
      data: { link: expect.stringMatching(new RegExp(`/${ids.slugA}/messages$`)) as unknown },
    });
    expect(JSON.stringify(outbox)).not.toContain(SECRET);
    expect(JSON.stringify(outbox)).not.toContain('Tax Return Update');
  });

  it('both logins of the client see it unread; read and unread change the counts and receipts', async () => {
    const thread = await newThread(ids.one, { subject: `Receipts ${run}` });
    for (const who of [people.primary, people.spouse]) {
      const list = ok(
        z.object({ items: z.array(MyThread), nextCursor: z.string().nullable() }),
        await portal(
          'get',
          `/message-threads?search=${encodeURIComponent(`Receipts ${run}`)}`,
          who,
        ),
      );
      expect(list.items.map((t) => [t.id, t.unreadCount])).toEqual([[thread.id, 1]]);
    }
    const before = ok(Unread, await portal('get', '/message-threads/unread-count', people.primary));
    const read = ok(
      MyThread,
      await portal('post', `/message-threads/${thread.id}/read`, people.primary, {}),
    );
    expect(read.unreadCount).toBe(0);
    const after = ok(Unread, await portal('get', '/message-threads/unread-count', people.primary));
    expect(after).toEqual({ threads: before.threads - 1, messages: before.messages - 1 });
    // The firm sees the client's read receipt.
    const seen = ok(
      ThreadDetail,
      await firm('get', `/message-threads/${thread.id}`, people.ownerA),
    );
    expect(seen.messages[0]?.readAt).not.toBeNull();
    ok(MyThread, await portal('post', `/message-threads/${thread.id}/unread`, people.primary, {}));
    expect(
      ok(Unread, await portal('get', '/message-threads/unread-count', people.primary)),
    ).toEqual(before);
    const mine = ok(
      MyThreadDetail,
      await portal('get', `/message-threads/${thread.id}`, people.spouse),
    );
    expect(mine.messages[0]).toMatchObject({ fromMe: false, senderName: 'Fake R11m ownerA' });
  });

  it('a client reply reaches the assigned staff member and counts as unread for the firm', async () => {
    const thread = await newThread(ids.one, { subject: `Reply ${run}` });
    outbox.length = 0;
    const before = ok(Unread, await firm('get', '/message-threads/unread-count', people.staffA));
    const reply = ok(
      MyMessage,
      await portal('post', `/message-threads/${thread.id}/messages`, people.spouse, {
        body: 'Thanks!',
        attachmentDocumentIds: [ids.shared],
      }),
      201,
    );
    expect(reply).toMatchObject({ direction: 'CLIENT_TO_FIRM', fromMe: true, readAt: null });
    expect(outbox.map((m) => [m.to, m.recipient])).toEqual([
      [people.staffA.email, { userId: people.staffA.id }],
    ]);
    const after = ok(Unread, await firm('get', '/message-threads/unread-count', people.staffA));
    expect(after).toEqual({ threads: before.threads + 1, messages: before.messages + 1 });
    const unread = ok(
      z.object({ items: z.array(Thread), nextCursor: z.string().nullable() }),
      await firm('get', `/message-threads?clientId=${ids.one}&unreadOnly=true`, people.staffA),
    );
    expect(unread.items.map((t) => t.id)).toContain(thread.id);
    const read = ok(
      Thread,
      await firm('post', `/message-threads/${thread.id}/read`, people.staffA, {}),
    );
    expect(read).toMatchObject({ unreadCount: 0, lastMessageDirection: 'CLIENT_TO_FIRM' });
    const detail = ok(
      MyThreadDetail,
      await portal('get', `/message-threads/${thread.id}`, people.primary),
    );
    expect(detail.messages[1]?.readAt).not.toBeNull();
    ok(Thread, await firm('post', `/message-threads/${thread.id}/unread`, people.staffA, {}));
    expect(ok(Unread, await firm('get', '/message-threads/unread-count', people.staffA))).toEqual(
      after,
    );
  });

  it('closed replies: the client gets 409 REPLIES_DISABLED, the firm can still write', async () => {
    const thread = await newThread(ids.one, { repliesEnabled: false });
    expect(thread.repliesEnabled).toBe(false);
    fails(
      await portal('post', `/message-threads/${thread.id}/messages`, people.primary, {
        body: 'Hi',
      }),
      409,
      'REPLIES_DISABLED',
    );
    ok(
      FirmMessage,
      await firm('post', `/message-threads/${thread.id}/messages`, people.ownerA, { body: 'Note' }),
      201,
    );
    ok(
      Thread,
      await firm('patch', `/message-threads/${thread.id}`, people.ownerA, { repliesEnabled: true }),
    );
    ok(
      MyMessage,
      await portal('post', `/message-threads/${thread.id}/messages`, people.primary, {
        body: 'Hi',
      }),
      201,
    );
  });

  it('a client starts a thread; with no assigned staff the owners and admins get the notice', async () => {
    outbox.length = 0;
    const started = ok(
      MyThreadDetail,
      await portal('post', '/message-threads', people.other, { subject: 'Question', body: 'Hi' }),
      201,
    );
    expect(started.messages[0]).toMatchObject({ direction: 'CLIENT_TO_FIRM', fromMe: true });
    expect(outbox.map((m) => m.to)).toEqual([people.ownerA.email]);
    expect(outbox[0]?.data).toMatchObject({
      link: expect.stringMatching(new RegExp(`/clients/${ids.two}/messages$`)) as unknown,
    });
    const owner = ok(
      ThreadDetail,
      await firm('get', `/message-threads/${started.id}`, people.ownerA),
    );
    expect(owner.client.id).toBe(ids.two);
  });

  it('a failed email never fails the message', async () => {
    failNotify = true;
    try {
      await newThread(ids.one, { subject: 'Still sent' });
    } finally {
      failNotify = false;
    }
  });

  it('pages newest activity first', async () => {
    const first = ok(
      z.object({ items: z.array(Thread), nextCursor: z.string().nullable() }),
      await firm('get', `/message-threads?clientId=${ids.one}&limit=2`, people.ownerA),
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = ok(
      z.object({ items: z.array(Thread), nextCursor: z.string().nullable() }),
      await firm(
        'get',
        `/message-threads?clientId=${ids.one}&limit=2&cursor=${first.nextCursor}`,
        people.ownerA,
      ),
    );
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    const times = all.map((t) => t.lastMessageAt ?? '');
    expect([...times].sort().reverse()).toEqual(times);
    fails(
      await firm('get', '/message-threads?cursor=nope', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('isolation', () => {
  it('another client, another firm and Staff without the client get 404 and see nothing', async () => {
    const thread = await newThread(ids.one, { subject: `Private ${run}` });
    fails(await portal('get', `/message-threads/${thread.id}`, people.other), 404, 'NOT_FOUND');
    for (const path of ['read', 'unread']) {
      fails(
        await portal('post', `/message-threads/${thread.id}/${path}`, people.other, {}),
        404,
        'NOT_FOUND',
      );
    }
    fails(
      await portal('post', `/message-threads/${thread.id}/messages`, people.other, { body: 'x' }),
      404,
      'NOT_FOUND',
    );
    const others = ok(
      z.object({ items: z.array(MyThread), nextCursor: z.string().nullable() }),
      await portal('get', '/message-threads?limit=100', people.other),
    );
    expect(others.items.map((t) => t.id)).not.toContain(thread.id);
    // Staff without the client.
    fails(await firm('get', `/message-threads/${thread.id}`, people.staffA2), 404, 'NOT_FOUND');
    fails(
      await firm('post', `/message-threads/${thread.id}/messages`, people.staffA2, { body: 'x' }),
      404,
      'NOT_FOUND',
    );
    fails(
      await firm('patch', `/message-threads/${thread.id}`, people.staffA2, {
        repliesEnabled: false,
      }),
      404,
      'NOT_FOUND',
    );
    fails(
      await firm('post', `/clients/${ids.one}/message-threads`, people.staffA2, {
        subject: 's',
        body: 'b',
      }),
      404,
      'NOT_FOUND',
    );
    const staffList = ok(
      z.object({ items: z.array(Thread), nextCursor: z.string().nullable() }),
      await firm('get', '/message-threads?limit=100', people.staffA2),
    );
    expect(staffList.items).toEqual([]);
    expect(ok(Unread, await firm('get', '/message-threads/unread-count', people.staffA2))).toEqual({
      threads: 0,
      messages: 0,
    });
    // Another firm.
    fails(
      await firm('get', `/message-threads/${thread.id}`, people.ownerB, undefined, ids.firmB),
      404,
      'NOT_FOUND',
    );
    fails(
      await firm(
        'post',
        `/clients/${ids.one}/message-threads`,
        people.ownerB,
        { subject: 's', body: 'b' },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
    fails(
      await firm('post', `/clients/${ids.clientB}/message-threads`, people.ownerA, {
        subject: 's',
        body: 'b',
      }),
      404,
      'NOT_FOUND',
    );
  });

  it("attachments: only the thread's client's clean, non-internal documents", async () => {
    const cases: [string, number, string][] = [
      [ids.pending, 409, 'ATTACHMENT_NOT_READY'],
      [ids.internal, 404, 'NOT_FOUND'],
      [ids.twoDoc, 404, 'NOT_FOUND'],
      [randomUUID(), 404, 'NOT_FOUND'],
    ];
    for (const [doc, status, code] of cases) {
      fails(
        await firm('post', `/clients/${ids.one}/message-threads`, people.ownerA, {
          subject: 's',
          body: 'b',
          attachmentDocumentIds: [doc],
        }),
        status,
        code,
      );
    }
    fails(
      await firm('post', `/clients/${ids.one}/message-threads`, people.ownerA, {
        subject: 's',
        body: 'b',
        engagementId: ids.engagementTwo,
      }),
      404,
      'NOT_FOUND',
    );
  });

  it('limits and strict bodies: 400 VALIDATION_FAILED', async () => {
    const thread = await newThread(ids.one);
    for (const body of [
      { subject: 's', body: 'x'.repeat(5001) },
      { subject: '', body: 'b' },
      { subject: 'x'.repeat(201), body: 'b' },
      { subject: 's', body: 'b', businessId: ids.firmB },
    ]) {
      fails(
        await firm('post', `/clients/${ids.one}/message-threads`, people.ownerA, body),
        400,
        'VALIDATION_FAILED',
      );
    }
    fails(
      await portal('post', `/message-threads/${thread.id}/messages`, people.primary, {
        body: 'x'.repeat(5001),
      }),
      400,
      'VALIDATION_FAILED',
    );
    fails(
      await portal('post', '/message-threads', people.primary, {
        subject: 's',
        body: 'b',
        clientId: ids.two,
      }),
      400,
      'VALIDATION_FAILED',
    );
    fails(
      await portal('get', `/message-threads?clientId=${ids.two}`, people.primary),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('internal notes', () => {
  it('the firm adds and lists notes newest first; Staff without the client get 404', async () => {
    const first = ok(
      Note,
      await firm('post', `/clients/${ids.one}/notes`, people.staffA, { body: 'First' }),
      201,
    );
    const second = ok(
      Note,
      await firm('post', `/clients/${ids.one}/notes`, people.ownerA, {
        body: 'Second',
        engagementId: ids.engagementOne,
      }),
      201,
    );
    expect(second).toMatchObject({
      author: { userId: people.ownerA.id },
      engagementId: ids.engagementOne,
    });
    const list = ok(
      z.object({ items: z.array(Note), nextCursor: z.string().nullable() }),
      await firm('get', `/clients/${ids.one}/notes`, people.staffA),
    );
    expect(list.items.map((n) => n.id)).toEqual([second.id, first.id]);
    fails(await firm('get', `/clients/${ids.one}/notes`, people.staffA2), 404, 'NOT_FOUND');
    fails(
      await firm('post', `/clients/${ids.one}/notes`, people.staffA2, { body: 'x' }),
      404,
      'NOT_FOUND',
    );
    fails(
      await firm('get', `/clients/${ids.one}/notes`, people.ownerB, undefined, ids.firmB),
      404,
      'NOT_FOUND',
    );
    fails(
      await firm('post', `/clients/${ids.one}/notes`, people.ownerA, {
        body: 'x',
        engagementId: ids.engagementTwo,
      }),
      404,
      'NOT_FOUND',
    );
    fails(
      await firm('post', `/clients/${ids.one}/notes`, people.ownerA, { body: 'x'.repeat(5001) }),
      400,
      'VALIDATION_FAILED',
    );
    // Clients have no route to them: their notes route is their own notepad.
    const pad = ok(MyNotepad, await portal('get', '/notes', people.other));
    expect(JSON.stringify(pad)).not.toContain('First');
  });
});

describe('private notes', () => {
  it('each save adds a version; the reminder is kept, moved and removed; only the owner sees it', async () => {
    expect(ok(MyNotepad, await portal('get', '/notes', people.primary))).toEqual({
      note: null,
      reminder: null,
    });
    fails(
      await portal('put', '/notes/reminder', people.primary, {
        remindAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      409,
      'NOTE_REQUIRED',
    );
    const remindAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const saved = ok(
      MyNotepad,
      await portal('put', '/notes', people.primary, { body: `Gather 1099s ${run}`, remindAt }),
    );
    expect(saved).toMatchObject({
      note: { body: `Gather 1099s ${run}` },
      reminder: { remindAt, remindedAt: null },
    });
    const again = ok(
      MyNotepad,
      await portal('put', '/notes', people.primary, { body: 'Second version' }),
    );
    expect(again.note?.body).toBe('Second version');
    expect(again.reminder?.remindAt).toBe(remindAt);
    const later = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect(
      ok(MyNotepad, await portal('put', '/notes/reminder', people.primary, { remindAt: later }))
        .reminder?.remindAt,
    ).toBe(later);
    expect(
      ok(MyNotepad, await portal('put', '/notes/reminder', people.primary, { remindAt: null }))
        .reminder,
    ).toBeNull();
    fails(
      await portal('put', '/notes', people.primary, {
        body: 'x',
        remindAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      400,
      'VALIDATION_FAILED',
    );
    fails(
      await portal('put', '/notes', people.primary, { body: 'x'.repeat(5001) }),
      400,
      'VALIDATION_FAILED',
    );
    // The spouse's login has its own (empty) notepad.
    expect(ok(MyNotepad, await portal('get', '/notes', people.spouse)).note).toBeNull();
    // Two versions are stored, readable only in the owner's own actor scope.
    const asOwner = await inScope(
      { kind: 'business', businessId: ids.firmA, actorUserId: people.primary.id },
      (tx) => tx.clientPrivateNote.count(),
      true,
    );
    expect(asOwner).toBe(2);
    for (const scope of [
      { kind: 'business' as const, businessId: ids.firmA },
      { kind: 'business' as const, businessId: ids.firmA, actorUserId: people.ownerA.id },
      { kind: 'business' as const, businessId: ids.firmA, actorUserId: people.spouse.id },
    ]) {
      expect(await inScope(scope, (tx) => tx.clientPrivateNote.count(), true)).toBe(0);
    }
  });
});

describe('audit', () => {
  it('records every action with ids only, never subjects or text', async () => {
    const rows = await inA((tx) =>
      tx.auditLog.findMany({
        where: {
          businessId: ids.firmA,
          OR: [
            { action: { startsWith: 'message' } },
            { action: { startsWith: 'note' } },
            { action: { startsWith: 'client_note' } },
          ],
        },
      }),
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const action of [
      'message_thread.created',
      'message.sent',
      'message_thread.read',
      'message_thread.unread',
      'message_thread.viewed',
      'message_thread.updated',
      'message_threads.listed',
      'note.created',
      'notes.listed',
      'client_note.saved',
      'client_note.reminder_set',
      'client_note.reminder_removed',
    ]) {
      expect(actions, action).toContain(action);
    }
    const text = JSON.stringify(rows);
    for (const secret of [SECRET, 'Tax Return Update', 'Gather 1099s', 'Thanks!', 'First']) {
      expect(text).not.toContain(secret);
    }
  });
});
