// End-to-end: R6 step 7, the notification center (docs/api/notifications.yaml) on both sites, the
// Notifier helper other features call, and step 5 (NotifyService reads the preferences). Firm
// routes answer the member's own items in the acting firm; portal routes the client login's own.
// Another person's item is 404, also in the same firm; firm B never sees firm A's.
import { randomUUID } from 'node:crypto';
import { type INestApplication, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createDatabase, createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  MarkAllNotificationsReadResponse,
  NotificationItem,
  NotificationList,
  NotificationPreferences,
  UnreadNotificationCount,
} from '@firmivra/types';
import type { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NotificationInputError, Notifier } from '../../src/notifications/notifier.js';
import { BrandingSource } from '../../src/notify/branding.js';
import { SendingNotifyService } from '../../src/notify/notify.service.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { PreferenceSource } from '../../src/notify/preferences.js';
import type { OutgoingEmail } from '../../src/notify/transports.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string, pool: 'STAFF' | 'CLIENT') => ({
  id: randomUUID(),
  email: `r6n-${key}-${run}@r6.test`,
  name: `Fake R6n ${key}`,
  pool,
});
const people = {
  ownerA: person('owner-a', 'STAFF'),
  adminA: person('admin-a', 'STAFF'),
  /** Assigned to client c1. */
  staff1: person('staff-1', 'STAFF'),
  /** Assigned to nobody. */
  staff2: person('staff-2', 'STAFF'),
  /** c1's PRIMARY login. */
  primary1: person('primary-1', 'CLIENT'),
  /** c1's SPOUSE login. */
  spouse1: person('spouse-1', 'CLIENT'),
  /** c2's PRIMARY login (c2 has no assignee). */
  primary2: person('primary-2', 'CLIENT'),
  ownerB: person('owner-b', 'STAFF'),
  clientB: person('client-b', 'CLIENT'),
};
type Who = (typeof people)[keyof typeof people];
const ids = {
  firmA: '',
  firmB: '',
  inactive: '',
  slugA: `r6n-a-${run}`,
  slugB: `r6n-b-${run}`,
  c1: '',
  c2: '',
  invoice1: '',
  invoice2: '',
  invoiceB: '',
  thread1: '',
  thread2: '',
  account2: '',
  membershipAdmin: '',
  reminder: '',
};

let app: INestApplication;
let notifier: Notifier;
const outbox: NotifyMessage[] = [];
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => {
  viewers += 1;
  return `198.51.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
};

async function tokenFor(who: Who): Promise<string> {
  const cached = tokens.get(who.email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email: who.email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(who.email, token);
  return token;
}

type Method = 'get' | 'post' | 'patch';
/** A firm route under /api/v1/business/me (x-business-id: firm A unless given). */
async function firm(
  method: Method,
  path: string,
  who: Who,
  body?: object,
  businessId: string | null = ids.firmA,
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business/me${path}`)
    .set('authorization', `Bearer ${await tokenFor(who)}`)
    .set('x-forwarded-for', viewer());
  if (businessId) req = req.set('x-business-id', businessId);
  return body === undefined ? req : req.send(body);
}
/** A portal route under /api/v1/portal/{slug}/me. */
async function portal(
  method: Method,
  path: string,
  who: Who,
  body?: object,
  slug = ids.slugA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${slug}/me${path}`)
    .set('authorization', `Bearer ${await tokenFor(who)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
function exact<S extends z.ZodType>(schema: S, res: Response, status = 200): z.output<S> {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = schema.parse(res.body);
  expect(parsed).toEqual(res.body);
  return parsed;
}

async function asOwner<T>(businessId: string, work: (tx: TxClient) => Promise<T>, actor?: string) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(
      owner,
      actor
        ? { kind: 'business', businessId, actorUserId: actor }
        : { kind: 'business', businessId },
      work,
    );
  } finally {
    await owner.$disconnect();
  }
}

/** Bell items in the database for one person (owner client, firm A). */
const rowsOf = (who: Who, businessId = ids.firmA) =>
  asOwner(businessId, (tx) =>
    tx.notification.findMany({
      where: { recipientUserId: who.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
  );

const logs = { log: vi.spyOn(Logger.prototype, 'log'), warn: vi.spyOn(Logger.prototype, 'warn') };
const logged = () => JSON.stringify([...logs.log.mock.calls, ...logs.warn.mock.calls]);

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const p of Object.values(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: p.pool, email: p.email, name: p.name },
      });
    }
    const make = (slug: string, status: 'ACTIVE' | 'SUSPENDED') =>
      tx.business.create({ data: { slug, name: `Fake ${slug}`, status } });
    ids.firmA = (await make(ids.slugA, 'ACTIVE')).id;
    ids.firmB = (await make(ids.slugB, 'ACTIVE')).id;
    ids.inactive = (await make(`r6n-s-${run}`, 'SUSPENDED')).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [who, role] of [
      [people.ownerA, 'OWNER'],
      [people.adminA, 'ADMIN'],
      [people.staff1, 'STAFF'],
      [people.staff2, 'STAFF'],
    ] as const) {
      const m = await tx.membership.create({
        data: { ...A, userId: who.id, role, status: 'ACTIVE' },
      });
      if (who === people.adminA) ids.membershipAdmin = m.id;
    }
    ids.c1 = (
      await tx.client.create({
        data: { ...A, displayName: 'Jamie Sample (fake)', assignedUserId: people.staff1.id },
      })
    ).id;
    ids.c2 = (await tx.client.create({ data: { ...A, displayName: 'Riley Example (fake)' } })).id;
    const login = (who: Who, clientId: string, portalRole: 'PRIMARY' | 'SPOUSE') =>
      tx.clientAccount.create({
        data: { ...A, userId: who.id, clientId, email: who.email, portalRole, status: 'ACTIVE' },
      });
    await login(people.primary1, ids.c1, 'PRIMARY');
    await login(people.spouse1, ids.c1, 'SPOUSE');
    ids.account2 = (await login(people.primary2, ids.c2, 'PRIMARY')).id;
    ids.invoice1 = (
      await tx.invoice.create({ data: { ...A, clientId: ids.c1, number: 'R6-1' } })
    ).id;
    ids.invoice2 = (
      await tx.invoice.create({ data: { ...A, clientId: ids.c2, number: 'R6-2' } })
    ).id;
    const thread = (clientId: string) =>
      tx.messageThread.create({ data: { ...A, clientId, subject: 'Private subject (fake)' } });
    ids.thread1 = (await thread(ids.c1)).id;
    ids.thread2 = (await thread(ids.c2)).id;
  });
  // The spouse's own private note, with a reminder that is due (only its owner may make it).
  await runInScope(
    owner,
    { kind: 'business', businessId: ids.firmA, actorUserId: people.spouse1.id },
    async (tx) => {
      const note = await tx.clientPrivateNote.create({
        data: { businessId: ids.firmA, userId: people.spouse1.id, body: 'Secret note text' },
      });
      ids.reminder = (
        await tx.clientNoteReminder.create({
          data: {
            businessId: ids.firmA,
            noteId: note.id,
            userId: people.spouse1.id,
            remindAt: new Date(Date.now() - 60_000),
          },
        })
      ).id;
    },
  );
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const cB = await tx.client.create({ data: { ...B, displayName: 'B Client (fake)' } });
    await tx.clientAccount.create({
      data: {
        ...B,
        userId: people.clientB.id,
        clientId: cB.id,
        email: people.clientB.email,
        status: 'ACTIVE',
      },
    });
    ids.invoiceB = (
      await tx.invoice.create({ data: { ...B, clientId: cB.id, number: 'R6-B' } })
    ).id;
  });
  // The owner of firm A is also a member of a suspended firm (403 after the place check).
  await runInScope(owner, { kind: 'business', businessId: ids.inactive }, (tx) =>
    tx.membership.create({
      data: { businessId: ids.inactive, userId: people.ownerA.id, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
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
  notifier = nest.get(Notifier);
});

afterAll(async () => {
  await app?.close();
});

const A = () => ({ businessId: ids.firmA });

describe('Notifier: who gets an event', () => {
  it('a client event reaches the ACTIVE PRIMARY login only, with its email copy', async () => {
    outbox.length = 0;
    const result = await notifier.notify({ ...A(), event: 'invoice.sent', recordId: ids.invoice1 });
    expect(result).toEqual({ written: 1 });
    const [row] = await rowsOf(people.primary1);
    expect(row).toMatchObject({
      type: 'invoice.sent',
      category: 'BILLING',
      entityType: 'invoice',
      entityId: ids.invoice1,
      payload: { number: 'R6-1' },
    });
    expect(await rowsOf(people.spouse1)).toEqual([]);
    expect(outbox).toEqual([
      {
        template: 'invoice.sent',
        to: people.primary1.email,
        businessId: ids.firmA,
        recipient: { userId: people.primary1.id },
        data: {
          name: people.primary1.name,
          invoiceNumber: 'R6-1',
          link: `${process.env['PORTAL_BASE_URL']!.replace(/\/+$/, '')}/${ids.slugA}/invoices`,
        },
      },
    ]);
  });

  it("a staff event reaches the client's assigned member only, never another Staff member", async () => {
    await notifier.notify({
      ...A(),
      event: 'message.received',
      recordId: ids.thread1,
      audience: 'staff',
      actorUserId: people.primary1.id,
    });
    const [row] = await rowsOf(people.staff1);
    expect(row).toMatchObject({ type: 'message.received', entityType: 'message_thread' });
    expect(row?.payload).toEqual({ client: 'Jamie Sample (fake)' });
    for (const who of [people.ownerA, people.adminA, people.staff2, people.primary1]) {
      expect((await rowsOf(who)).filter((r) => r.type === 'message.received')).toEqual([]);
    }
  });

  it('a client without an assignee: the Owners and Admins, never a Staff member', async () => {
    await notifier.notify({
      ...A(),
      event: 'message.received',
      recordId: ids.thread2,
      audience: 'staff',
    });
    const got = async (who: Who) =>
      (await rowsOf(who)).filter((r) => r.entityId === ids.thread2).length;
    expect(await got(people.ownerA)).toBe(1);
    expect(await got(people.adminA)).toBe(1);
    expect(await got(people.staff1)).toBe(0);
    expect(await got(people.staff2)).toBe(0);
    expect(await got(people.primary2)).toBe(0);
  });

  it('both sides; the actor is never told of their own action', async () => {
    outbox.length = 0;
    await notifier.notify({
      ...A(),
      event: 'payment.received',
      recordId: ids.invoice2,
      audience: 'both',
      actorUserId: people.adminA.id,
    });
    const got = async (who: Who) =>
      (await rowsOf(who)).filter((r) => r.type === 'payment.received').length;
    expect([
      await got(people.primary2),
      await got(people.ownerA),
      await got(people.adminA),
    ]).toEqual([1, 1, 0]);
    expect(outbox.map((m) => [m.template, m.to])).toEqual([
      ['payment.received', people.primary2.email],
    ]);
  });

  it("a note reminder reaches only the note's owner; staff.joined and the person's own account", async () => {
    await notifier.notify({ ...A(), event: 'client-note.reminder', recordId: ids.reminder });
    const [reminder] = await rowsOf(people.spouse1);
    expect(reminder).toMatchObject({ type: 'client_note.reminder', payload: {} });
    expect(JSON.stringify(reminder)).not.toContain('Secret note');
    expect((await rowsOf(people.primary1)).filter((r) => r.entityId === ids.reminder)).toEqual([]);

    await notifier.notify({
      ...A(),
      event: 'staff.joined',
      recordId: ids.membershipAdmin,
      actorUserId: people.adminA.id,
    });
    const joined = async (who: Who) =>
      (await rowsOf(who)).filter((r) => r.type === 'staff.joined').length;
    expect([await joined(people.ownerA), await joined(people.adminA)]).toEqual([1, 0]);
    expect([await joined(people.staff1), await joined(people.staff2)]).toEqual([0, 0]);

    await notifier.notify({
      ...A(),
      event: 'account.password-changed',
      recordId: people.staff2.id,
      audience: 'staff',
    });
    expect((await rowsOf(people.staff2)).map((r) => r.type)).toEqual(['account.password_changed']);
    // Someone with no place in the firm gets nothing.
    expect(
      await notifier.notify({
        ...A(),
        event: 'account.password-changed',
        recordId: people.ownerB.id,
        audience: 'staff',
      }),
    ).toEqual({ written: 0 });
  });

  it('an event key writes once; another firm’s record writes nothing; bad calls reject', async () => {
    outbox.length = 0;
    const once = {
      ...A(),
      event: 'invoice.sent' as const,
      recordId: ids.invoice2,
      eventKey: `k-${run}`,
    };
    expect(await notifier.notify(once)).toEqual({ written: 1 });
    expect(await notifier.notify(once)).toEqual({ written: 0 });
    expect(outbox).toHaveLength(1);
    expect(
      await notifier.notify({ ...A(), event: 'invoice.sent', recordId: ids.invoiceB }),
    ).toEqual({ written: 0 });
    await expect(
      notifier.notify({ ...A(), event: 'invoice.sent', recordId: ids.invoice1, audience: 'staff' }),
    ).rejects.toBeInstanceOf(NotificationInputError);
    await expect(
      notifier.notify({ ...A(), event: 'nope' as 'invoice.sent', recordId: ids.invoice1 }),
    ).rejects.toBeInstanceOf(NotificationInputError);
    await expect(
      notifier.notify({ ...A(), event: 'invoice.sent', recordId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(NotificationInputError);
  });

  it('never logs an address, a name or a record text', () => {
    const text = logged();
    for (const p of Object.values(people)) {
      expect(text).not.toContain(p.email);
      expect(text).not.toContain(p.name);
    }
    for (const value of ['Jamie Sample', 'Private subject', 'Secret note']) {
      expect(text).not.toContain(value);
    }
  });
});

describe('firm routes: the member’s own', () => {
  it('lists newest first with the unread count, pages with an opaque cursor, and filters unread', async () => {
    const all = exact(NotificationList, await firm('get', '/notifications', people.ownerA));
    expect(all.unreadCount).toBe(all.items.length);
    expect(all.items.length).toBeGreaterThanOrEqual(3);
    const thread2 = all.items.find((i) => i.target.id === ids.thread2);
    expect(thread2).toMatchObject({
      category: 'MESSAGES',
      title: 'New message',
      body: 'Riley Example (fake) sent a message.',
      target: { kind: 'message_thread', clientId: ids.c2 },
      readAt: null,
    });
    const first = exact(
      NotificationList,
      await firm('get', '/notifications?limit=1', people.ownerA),
    );
    expect(first.items.map((i) => i.id)).toEqual([all.items[0]!.id]);
    const next = exact(
      NotificationList,
      await firm('get', `/notifications?limit=1&cursor=${first.nextCursor}`, people.ownerA),
    );
    expect(next.items.map((i) => i.id)).toEqual([all.items[1]!.id]);
    expect(
      exact(
        UnreadNotificationCount,
        await firm('get', '/notifications/unread-count', people.ownerA),
      ),
    ).toEqual({ count: all.unreadCount });
  });

  it('marks one read (a repeat keeps the first readAt), then all; Staff see only their own', async () => {
    const [mine] = (await rowsOf(people.staff1)).filter((r) => r.entityId === ids.thread1);
    const read = exact(
      NotificationItem,
      await firm('post', `/notifications/${mine!.id}/read`, people.staff1, {}),
    );
    expect(read.readAt).not.toBeNull();
    expect(read.target).toEqual({ kind: 'message_thread', id: ids.thread1, clientId: ids.c1 });
    const again = exact(
      NotificationItem,
      await firm('post', `/notifications/${mine!.id.toUpperCase()}/read`, people.staff1, {}),
    );
    expect(again.readAt).toBe(read.readAt);
    // Another member of the same firm: 404, and nothing changes.
    expectError(
      await firm('post', `/notifications/${mine!.id}/read`, people.staff2, {}),
      404,
      'NOT_FOUND',
    );
    const unread = exact(
      NotificationList,
      await firm('get', '/notifications?unreadOnly=true', people.ownerA),
    );
    expect(unread.items.every((i) => i.readAt === null)).toBe(true);
    expect(
      exact(
        MarkAllNotificationsReadResponse,
        await firm('post', '/notifications/read-all', people.ownerA, {}),
      ),
    ).toEqual({ marked: unread.unreadCount });
    expect(
      exact(
        UnreadNotificationCount,
        await firm('get', '/notifications/unread-count', people.ownerA),
      ),
    ).toEqual({ count: 0 });
    // Only the owner's were marked.
    expect((await rowsOf(people.adminA)).some((r) => r.readAt === null)).toBe(true);
  });

  it('preferences: defaults, a change (audited: categories and switches only), ACCOUNT and SMS refused', async () => {
    const before = exact(
      NotificationPreferences,
      await firm('get', '/notification-preferences', people.staff1),
    );
    expect(before.channels).toEqual(['EMAIL']);
    expect(before.items[0]).toEqual({ category: 'ACCOUNT', email: true, sms: false, locked: true });
    expect(before.items.every((i) => i.email && !i.sms)).toBe(true);
    const after = exact(
      NotificationPreferences,
      await firm('patch', '/notification-preferences', people.staff1, {
        items: [{ category: 'MESSAGES', email: false }],
      }),
    );
    expect(after.items.find((i) => i.category === 'MESSAGES')).toMatchObject({ email: false });
    expectError(
      await firm('patch', '/notification-preferences', people.staff1, {
        items: [{ category: 'ACCOUNT', email: false }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await firm('patch', '/notification-preferences', people.staff1, {
        items: [{ category: 'DOCUMENTS', sms: true }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    const audit = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { action: { startsWith: 'notification' } } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'notification_preferences.updated',
      actorUserId: people.staff1.id,
      entityId: people.staff1.id,
      metadata: { items: [{ category: 'MESSAGES', email: false }] },
    });
  });
});

describe('portal routes: the client login’s own', () => {
  it('lists, reads and marks the login’s own; no clientId in the portal', async () => {
    const list = exact(NotificationList, await portal('get', '/notifications', people.primary1));
    expect(list.items.length).toBeGreaterThan(0);
    const invoice = list.items.find((i) => i.target.kind === 'invoice')!;
    expect(invoice).toMatchObject({
      title: 'New invoice',
      body: 'Invoice R6-1',
      target: { id: ids.invoice1, clientId: null },
    });
    exact(
      NotificationItem,
      await portal('post', `/notifications/${invoice.id}/read`, people.primary1, {}),
    );
    // Client A's item is not client B's (same firm) and never the other firm's.
    expectError(
      await portal('post', `/notifications/${invoice.id}/read`, people.primary2, {}),
      404,
      'NOT_FOUND',
    );
    const other = exact(NotificationList, await portal('get', '/notifications', people.primary2));
    expect(other.items.some((i) => i.id === invoice.id)).toBe(false);
    expect(
      exact(
        MarkAllNotificationsReadResponse,
        await portal('post', '/notifications/read-all', people.primary1, {}),
      ),
    ).toEqual({ marked: list.unreadCount - 1 });
    expect(
      exact(
        UnreadNotificationCount,
        await portal('get', '/notifications/unread-count', people.primary1),
      ),
    ).toEqual({ count: 0 });
  });

  it('preferences on the portal', async () => {
    const prefs = exact(
      NotificationPreferences,
      await portal('patch', '/notification-preferences', people.primary2, {
        items: [{ category: 'BILLING', email: false, sms: false }],
      }),
    );
    expect(prefs.items.find((i) => i.category === 'BILLING')).toEqual({
      category: 'BILLING',
      email: false,
      sms: false,
      locked: false,
    });
    expect(
      exact(
        NotificationPreferences,
        await portal('get', '/notification-preferences', people.primary2),
      ),
    ).toEqual(prefs);
  });
});

describe('tenant isolation and the error order', () => {
  it("firm B never sees firm A's notifications", async () => {
    const [aItem] = await rowsOf(people.ownerA);
    expectError(
      await firm('post', `/notifications/${aItem!.id}/read`, people.ownerB, {}, ids.firmB),
      404,
      'NOT_FOUND',
    );
    expectError(
      await firm('get', '/notifications', people.ownerB, undefined, ids.firmA),
      404,
      'NOT_FOUND',
    );
    const b = exact(
      NotificationList,
      await firm('get', '/notifications', people.ownerB, undefined, ids.firmB),
    );
    expect(b).toEqual({ items: [], nextCursor: null, unreadCount: 0 });
    // A client of firm B at firm A's portal: no place there.
    expectError(await portal('get', '/notifications', people.clientB), 404, 'NOT_FOUND');
    expectError(
      await portal('get', '/notifications', people.primary1, undefined, ids.slugB),
      404,
      'NOT_FOUND',
    );
  });

  it('answers 415, 403 (origin), 401, 400, 404, 403 (status), 400 (validation), 404 in that order', async () => {
    const server = () => request(app.getHttpServer());
    const [anItem] = await rowsOf(people.adminA);
    const read = `/api/v1/business/me/notifications/${anItem!.id}/read`;
    const res415 = await server()
      .post(read)
      .set('x-forwarded-for', viewer())
      .set('content-type', 'text/plain')
      .send('x');
    expectError(res415, 415, 'UNSUPPORTED_MEDIA_TYPE');
    const res403 = await server()
      .post(read)
      .set('x-forwarded-for', viewer())
      .set('origin', 'https://attacker.example')
      .send({});
    expectError(res403, 403, 'ORIGIN_NOT_ALLOWED');
    expectError(
      await server().get('/api/v1/business/me/notifications').set('x-forwarded-for', viewer()),
      401,
      'UNAUTHENTICATED',
    );
    expectError(
      await firm('get', '/notifications', people.ownerA, undefined, null),
      400,
      'BUSINESS_REQUIRED',
    );
    expectError(
      await firm('get', '/notifications', people.staff1, undefined, ids.inactive),
      404,
      'NOT_FOUND',
    );
    expectError(
      await firm('get', '/notifications?limit=0', people.ownerA, undefined, ids.inactive),
      403,
      'BUSINESS_INACTIVE',
    );
    for (const path of ['?limit=51', '?cursor=bm9wZQ', '?unreadOnly=maybe', '?businessId=x']) {
      expectError(
        await firm('get', `/notifications${path}`, people.ownerA),
        400,
        'VALIDATION_FAILED',
      );
    }
    expectError(
      await firm('post', '/notifications/not-a-uuid/read', people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    // The body is checked before whose the item is.
    expectError(
      await firm('post', `/notifications/${anItem!.id}/read`, people.staff2, { x: 1 }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await firm('post', `/notifications/${randomUUID()}/read`, people.ownerA, {}),
      404,
      'NOT_FOUND',
    );
  });
});

describe('NotifyService reads the preferences (step 5)', () => {
  it('skips a channel the person switched off; ALWAYS_SENT and no-recipient messages always go', async () => {
    const db = createDatabase(fx.appUrl, TEST_CLIENT_OPTIONS);
    const mails: OutgoingEmail[] = [];
    const service = new SendingNotifyService({
      branding: new BrandingSource(db),
      preferences: new PreferenceSource(db),
      email: {
        from: { name: null, address: 'no-reply@r6.test' },
        transport: { send: (m) => (mails.push(m), Promise.resolve()) },
      },
      sms: null,
      linkOrigins: ['https://portal.r6.test'],
      logger: { log: () => undefined, warn: () => undefined },
    });
    const link = 'https://portal.r6.test/x/invoices';
    const base = { to: people.primary2.email, businessId: ids.firmA } as const;
    const invoice = { name: 'Riley', invoiceNumber: 'R6-2', link };
    try {
      // primary2 switched BILLING email off above (portal PATCH).
      await service.send({
        ...base,
        template: 'invoice.sent',
        recipient: { userId: people.primary2.id },
        data: invoice,
      });
      await service.send({
        ...base,
        template: 'invoice.sent',
        recipient: { clientAccountId: ids.account2 },
        data: invoice,
      });
      expect(mails).toHaveLength(0);
      await service.send({ ...base, template: 'invoice.sent', data: invoice });
      await service.send({
        ...base,
        template: 'document.requested',
        recipient: { userId: people.primary2.id },
        data: { name: 'Riley', title: 'W-2', dueOn: null, link },
      });
      await service.send({
        ...base,
        template: 'client.signup-approved',
        recipient: { userId: people.primary2.id },
        data: { name: 'Riley', signInLink: link },
      });
      expect(mails.map((m) => m.subject)).toEqual([
        `New invoice from Fake ${ids.slugA}`,
        `Fake ${ids.slugA} requested a document`,
        expect.any(String) as string,
      ]);
    } finally {
      await db.disconnect();
    }
  });

  it('a new or removed phone number clears every stored SMS choice', async () => {
    await asOwner(ids.firmA, (tx) =>
      tx.notificationPreference.create({
        data: {
          businessId: ids.firmA,
          userId: people.primary1.id,
          category: 'DOCUMENTS',
          sms: true,
        },
      }),
    );
    expect(await notifier.phoneChanged(ids.firmA, people.primary1.id)).toEqual({ cleared: 1 });
    const rows = await asOwner(ids.firmA, (tx) =>
      tx.notificationPreference.findMany({ where: { userId: people.primary1.id } }),
    );
    expect(rows.map((r) => [r.category, r.email, r.sms])).toEqual([['DOCUMENTS', true, false]]);
  });
});
