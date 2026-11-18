// End-to-end: CP-3d (Client Portal Review One; the lead's decision 3a). When a general announcement
// goes live in the portal, each client it was published to gets a short notice once: a bell item
// under Announcements, and email and text copies as the firm's policy for each channel and the
// client's own choice allow. The client's Notification Preferences show the Announcements row as
// the policy leaves it (locked or theirs); the firm's staff have none. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { NotificationPreferences } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { CommunicationDelivery } from '../../src/communications/communications-delivery.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { BrandingSource } from '../../src/notify/branding.js';
import { SendingNotifyService } from '../../src/notify/notify.service.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import { PreferenceSource } from '../../src/notify/preferences.js';
import type { OutgoingEmail, OutgoingSms } from '../../src/notify/transports.js';

const fx = inject('fixtures');
let app: INestApplication;
let delivery: CommunicationDelivery;
const run = randomUUID().slice(0, 8);
const slug = `r1-notice-${run}`;
const person = (key: string) => ({ id: randomUUID(), email: `r1-notice-${key}-${run}@r1.test` });
const owner = person('owner');
/** Gets every copy the policy allows; `chooser` turns announcement email off; `left` is left out. */
const reader = person('reader');
const chooser = person('chooser');
const left = person('left');
const clients = { reader: '', chooser: '', left: '' };
let firmId = '';
const mails: OutgoingEmail[] = [];
const texts: OutgoingSms[] = [];

const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  AUTH_MODE: 'local',
  LOG_LEVEL: 'silent',
  DATABASE_URL_APP: fx.appUrl,
});

async function asOwner<T>(work: Parameters<typeof runInScope<T>>[2]): Promise<T> {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(db, { kind: 'business', businessId: firmId }, work);
  } finally {
    await db.$disconnect();
  }
}

beforeAll(async () => {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const firm = await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [u, pool, phone] of [
      [owner, 'STAFF', null],
      [reader, 'CLIENT', '+14045550101'],
      [chooser, 'CLIENT', null],
      [left, 'CLIENT', null],
    ] as const) {
      await tx.user.create({
        data: { id: u.id, cognitoSub: u.id, pool, email: u.email, name: 'Fake R1 notice', phone },
      });
    }
    return tx.business.create({ data: { slug, name: `Fake Firm ${run}`, status: 'ACTIVE' } });
  });
  firmId = firm.id;
  await db.$disconnect();
  await asOwner(async (tx) => {
    await tx.membership.create({
      data: { businessId: firmId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    for (const [key, u] of [
      ['reader', reader],
      ['chooser', chooser],
      ['left', left],
    ] as const) {
      const c = await tx.client.create({
        data: { businessId: firmId, displayName: `Fake ${key}`, email: u.email },
      });
      clients[key] = c.id;
      await tx.clientAccount.create({
        data: {
          businessId: firmId,
          userId: u.id,
          clientId: c.id,
          email: u.email,
          status: 'ACTIVE',
        },
      });
    }
    // The firm sends texts (Messages settings), so a text copy can go where the policy allows.
    await tx.messageSettings.create({ data: { businessId: firmId, smsEnabled: true } });
  });
  const database = createDatabase(fx.appUrl, TEST_CLIENT_OPTIONS);
  const notify = new SendingNotifyService({
    branding: new BrandingSource(database),
    preferences: new PreferenceSource(database),
    email: {
      from: { name: null, address: 'no-reply@r1.test' },
      transport: { send: (m) => (mails.push(m), Promise.resolve()) },
    },
    sms: { send: (m) => (texts.push(m), Promise.resolve()) },
    linkOrigins: [new URL(env.PORTAL_BASE_URL).origin],
    logger: { log: () => undefined, warn: () => undefined },
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue(notify)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
  delivery = nest.get(CommunicationDelivery);
});

afterAll(async () => {
  await app.close();
});

/** One token per person: the dev token route allows 30 a minute. */
const tokens = new Map<string, string>();
async function send(
  method: 'get' | 'put' | 'patch',
  path: string,
  who: { email: string },
  body?: object,
) {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email });
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  const req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}
const code = (res: request.Response) => (res.body as { error?: { code: string } }).error?.code;
const policy = async (body: object) => {
  const res = await send('put', '/business/settings/portal-announcements', owner, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};
const prefs = async (who: { email: string }) => {
  const res = await send('get', `/portal/${slug}/me/notification-preferences`, who);
  expect(res.status).toBe(200);
  return NotificationPreferences.parse(res.body);
};
const choose = (who: { email: string }, item: object) =>
  send('patch', `/portal/${slug}/me/notification-preferences`, who, {
    items: [{ category: 'ANNOUNCEMENTS', ...item }],
  });
const rowOf = async (who: { email: string }) =>
  (await prefs(who)).items.find((i) => i.category === 'ANNOUNCEMENTS');

/** As Communications publishes one: its recipients, then SENT (the portal shows it in its window). */
async function announce(
  subject: string | null,
  data: { publishStartsAt?: Date; publishEndsAt?: Date; visibility?: string } = {},
) {
  return asOwner(async (tx) => {
    const now = Date.now();
    const c = await tx.communication.create({
      data: {
        businessId: firmId,
        channel: 'ANNOUNCEMENT',
        name: `Fake ${subject ?? 'untitled'}`,
        subject,
        status: 'SENDING',
        createdByUserId: owner.id,
        body: 'The fake announcement text, never in a notice.',
        startedAt: new Date(now - 60_000),
        selectedCount: 3,
        autoExcludedCount: 0,
        manualExcludedCount: 1,
        finalCount: 2,
        visibility: data.visibility ?? 'billing',
        publishStartsAt: data.publishStartsAt ?? null,
        publishEndsAt: data.publishEndsAt ?? null,
      },
    });
    for (const [clientId, status] of [
      [clients.reader, 'DELIVERED'],
      [clients.chooser, 'DELIVERED'],
      [clients.left, 'NOT_SENT'],
    ] as const) {
      await tx.communicationRecipient.create({
        data: {
          businessId: firmId,
          communicationId: c.id,
          clientId,
          status,
          addressMask: '***-portal',
          failureCode: status === 'NOT_SENT' ? 'missing_address' : null,
        },
      });
    }
    await tx.communication.update({
      where: { id: c.id },
      data: { status: 'SENT', sentAt: new Date(now - 30_000) },
    });
    return c.id;
  });
}
/** One delivery run for this firm (another file's run may hold the lock a moment: try again). */
const tick = async () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const r = await delivery.run({ businessIds: [firmId] });
    if (!r.skipped) return r.notices;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('the delivery lock stayed taken');
};
/** The bell items of an announcement, by recipient. */
const bellOf = (communicationId: string) =>
  asOwner((tx) =>
    tx.notification.findMany({
      where: { businessId: firmId, entityType: 'announcement', entityId: communicationId },
      select: { recipientUserId: true, category: true, payload: true },
    }),
  );
const mailsTo = (who: { email: string }) => mails.filter((m) => m.to === who.email);

describe('CP-3d: announcement notices and Notification Preferences', () => {
  it("shows a client the Announcements row as the firm's policy leaves it; staff have none", async () => {
    const staff = await send('get', '/business/me/notification-preferences', owner);
    expect(staff.status).toBe(200);
    const categories = NotificationPreferences.parse(staff.body).items.map((i) => i.category);
    expect(categories).not.toContain('ANNOUNCEMENTS');
    expect(
      code(
        await send('patch', '/business/me/notification-preferences', owner, {
          items: [{ category: 'ANNOUNCEMENTS', sms: false }],
        }),
      ),
    ).toBe('VALIDATION_FAILED');

    // The defaults: both channels the client's choice: email on and theirs to change.
    expect(await rowOf(reader)).toEqual({
      category: 'ANNOUNCEMENTS',
      email: true,
      sms: false,
      locked: false,
      emailLocked: false,
      smsLocked: false,
    });
    // Personal and service email stays on.
    expect(
      code(
        await send('patch', `/portal/${slug}/me/notification-preferences`, chooser, {
          items: [{ category: 'BILLING', email: false }],
        }),
      ),
    ).toBe('EMAIL_ALWAYS_ON');
    expect((await choose(chooser, { email: false })).status).toBe(200);
    expect(await rowOf(chooser)).toMatchObject({ email: false, emailLocked: false });
    // The reader has a phone: texts are offered, and they agree to them for announcements.
    expect((await choose(reader, { sms: true })).status).toBe(200);
    expect(await rowOf(reader)).toMatchObject({ sms: true, smsLocked: false });

    // Always sent: locked on; never sent: locked off, the text too.
    await policy({ emailPolicy: 'REQUIRED' });
    expect(await rowOf(chooser)).toMatchObject({ email: true, emailLocked: true });
    expect(code(await choose(chooser, { email: false }))).toBe('CHANNEL_LOCKED');
    await policy({ emailPolicy: 'OFF', smsPolicy: 'OFF' });
    expect(await rowOf(reader)).toMatchObject({
      email: false,
      emailLocked: true,
      sms: false,
      smsLocked: true,
    });
    expect(code(await choose(reader, { sms: true }))).toBe('CHANNEL_LOCKED');
    // Turning a text off is always allowed.
    expect((await choose(reader, { sms: false })).status).toBe(200);
    expect((await choose(reader, { sms: true })).status).toBe(400);

    // Announcements off: no row, and no choice to make.
    await policy({ enabled: false });
    expect(await rowOf(reader)).toBeUndefined();
    expect(code(await choose(reader, { sms: false }))).toBe('VALIDATION_FAILED');
    await policy({ enabled: true, emailPolicy: 'CLIENT_CHOICE', smsPolicy: 'CLIENT_CHOICE' });
    expect((await choose(reader, { sms: true })).status).toBe(200);
  });

  it('sends one notice per client it was published to, once, with its title and no text', async () => {
    mails.length = 0;
    texts.length = 0;
    const id = await announce('Office closed for [Business Name]');
    expect(await tick()).toBe(2);
    const bell = await bellOf(id);
    const title = `Office closed for Fake Firm ${run}`;
    expect(bell.map((b) => b.recipientUserId).sort()).toEqual([reader.id, chooser.id].sort());
    for (const b of bell) {
      expect(b.category).toBe('ANNOUNCEMENTS');
      expect(b.payload).toEqual({ title });
    }
    // The email: to the reader only (the chooser turned announcement email off).
    expect(mailsTo(chooser)).toEqual([]);
    const [mail] = mailsTo(reader);
    expect(mail?.subject).toBe(`New announcement from Fake Firm ${run}`);
    expect(mail?.text).toContain(title);
    expect(mail?.text).toContain(`/${slug}/announcements`);
    expect(mail?.text).not.toContain('never in a notice');
    // The text: the reader agreed to texts about announcements.
    expect(texts.map((t) => t.to)).toEqual(['+14045550101']);
    expect(texts[0]?.text).toContain(title);
    // Never to a left-out client, the firm's staff or another firm's client.
    expect(mailsTo(left)).toEqual([]);
    // Once: the next run sends nothing more.
    expect(await tick()).toBe(0);
    expect(mailsTo(reader)).toHaveLength(1);
    expect(texts).toHaveLength(1);
  });

  it('waits for its window, and skips an ended, expired or hidden one', async () => {
    mails.length = 0;
    // Its window opens in a few seconds (a sent campaign's window never changes).
    const opens = Date.now() + 4000;
    const later = await announce('Later', { publishStartsAt: new Date(opens) });
    const ended = await announce('Ended', { publishEndsAt: new Date(Date.now() - 1000) });
    const expired = await announce('Expired');
    await asOwner((tx) =>
      tx.communication.update({ where: { id: expired }, data: { archivedAt: new Date() } }),
    );
    // CP-3i: a dashboard one while the firm keeps announcements off the dashboard.
    await policy({ onDashboard: false });
    const dashboard = await announce('On the dashboard', { visibility: 'dashboard' });
    expect(await tick()).toBe(0);
    for (const id of [later, ended, expired, dashboard]) expect(await bellOf(id)).toEqual([]);
    await policy({ onDashboard: true });
    expect(await tick()).toBe(2);
    expect((await bellOf(dashboard)).length).toBe(2);
    // Its window opens: the notice goes then.
    await new Promise((done) => setTimeout(done, Math.max(0, opens - Date.now() + 200)));
    expect(await tick()).toBe(2);
    expect((await bellOf(later)).length).toBe(2);
  });

  it("follows the firm's policy: always sent reaches the chooser, never sent and off send nothing", async () => {
    mails.length = 0;
    texts.length = 0;
    await policy({ emailPolicy: 'REQUIRED', smsPolicy: 'OFF' });
    const required = await announce('Required');
    expect(await tick()).toBe(2);
    expect(mailsTo(chooser)).toHaveLength(1);
    expect(mailsTo(reader)).toHaveLength(1);
    expect(texts).toEqual([]);

    mails.length = 0;
    await policy({ emailPolicy: 'OFF' });
    const quiet = await announce('Quiet');
    expect(await tick()).toBe(2);
    // The bell item still shows in the portal; no copy goes out.
    expect((await bellOf(quiet)).length).toBe(2);
    expect(mails).toEqual([]);

    // Announcements off: no notice at all. Back on, one published meanwhile shows in the portal
    // now, so its notice goes then.
    await policy({ enabled: false, emailPolicy: 'CLIENT_CHOICE', smsPolicy: 'CLIENT_CHOICE' });
    const off = await announce('While off');
    expect(await tick()).toBe(0);
    expect(await bellOf(off)).toEqual([]);
    expect((await bellOf(required)).length).toBe(2);
    await policy({ enabled: true });
    expect(await tick()).toBe(2);
    expect((await bellOf(off)).length).toBe(2);
  });

  it("never reaches another firm's people", async () => {
    const id = await announce('Ours only');
    expect(await tick()).toBe(2);
    const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    try {
      const elsewhere = await runInScope(db, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
        tx.notification.count({
          where: { businessId: fx.firmA.id, entityType: 'announcement', entityId: id },
        }),
      );
      expect(elsewhere).toBe(0);
    } finally {
      await db.$disconnect();
    }
    // Only this firm's clients' logins.
    expect((await bellOf(id)).map((b) => b.recipientUserId).sort()).toEqual(
      [reader.id, chooser.id].sort(),
    );
  });
});
