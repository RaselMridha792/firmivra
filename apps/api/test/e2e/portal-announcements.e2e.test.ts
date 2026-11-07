// End-to-end: announcements in the portal (R55; Client Portal guide 3, Rasel, Oct 24: the parts
// without schema). Communications publishes them; GET /portal/{slug}/me/announcements shows the
// signed-in client the ones published to them, inside their window and not expired, newest first,
// as plain text. Another client, a left-out recipient and another firm's client see none of them.
// Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { MyAnnouncementList } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
const run = randomUUID().slice(0, 8);
const slug = `r55-ann-${run}`;
const person = (key: string) => ({ id: randomUUID(), email: `r55-ann-${key}-${run}@r55.test` });
const owner = person('owner');
const reader = person('reader');
const other = person('other');
const left = person('left');
const pending = person('pending');
const ids = { a: '', b: '', c: '', d: '' };
const DAY = 86_400_000;

let portal = '';
const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  AUTH_MODE: 'local',
  LOG_LEVEL: 'silent',
  DATABASE_URL_APP: fx.appUrl,
});
const IMAGE_ID = '0199d2b0-6c00-7000-8000-0000000000aa';

beforeAll(async () => {
  portal = new URL(env.PORTAL_BASE_URL).origin;
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const firm = await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [u, pool] of [
      [owner, 'STAFF'],
      [reader, 'CLIENT'],
      [other, 'CLIENT'],
      [left, 'CLIENT'],
      [pending, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id: u.id, cognitoSub: u.id, pool, email: u.email, name: 'Fake R55 announcements' },
      });
    }
    return tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } });
  });
  const businessId = firm.id;
  await runInScope(db, { kind: 'business', businessId }, async (tx) => {
    await tx.membership.create({
      data: { businessId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const clients: Record<string, string> = {};
    for (const [key, u] of [
      ['reader', reader],
      ['other', other],
      ['left', left],
    ] as const) {
      const c = await tx.client.create({ data: { businessId, displayName: `Fake ${key}` } });
      clients[key] = c.id;
      await tx.clientAccount.create({
        data: { businessId, userId: u.id, clientId: c.id, email: u.email, status: 'ACTIVE' },
      });
    }
    // A login with no client record yet sees nothing.
    await tx.clientAccount.create({
      data: { businessId, userId: pending.id, email: pending.email, status: 'ACTIVE' },
    });
    const now = Date.now();
    /** As Communications does: sending, its recipients, then published (or expired after). */
    const announce = async (
      name: string,
      data: { archivedAt?: Date; channel?: 'EMAIL' } & Record<string, unknown>,
      to: [string, 'DELIVERED' | 'NOT_SENT'][] = [
        [clients.reader!, 'DELIVERED'],
        [clients.left!, 'NOT_SENT'],
      ],
    ) => {
      const { archivedAt, ...rest } = data;
      const c = await tx.communication.create({
        data: {
          businessId,
          channel: 'ANNOUNCEMENT',
          name,
          status: 'SENDING',
          createdByUserId: owner.id,
          body: 'A fake announcement.',
          // What a launched one carries (the communications_status check).
          startedAt: new Date(now - DAY),
          selectedCount: 1,
          autoExcludedCount: 0,
          manualExcludedCount: 0,
          finalCount: 1,
          ...rest,
        },
      });
      for (const [clientId, status] of to) {
        await tx.communicationRecipient.create({
          data: {
            businessId,
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
        data: { status: 'SENT', sentAt: new Date(now - DAY), archivedAt: archivedAt ?? null },
      });
      return c.id;
    };
    ids.a = await announce('Hours (fake)', {
      subject: 'Extended Office Hours',
      body: '<p>We are open <strong>late</strong>.</p><p>See you &amp; yours.</p>',
      publishStartsAt: new Date(now - 2 * DAY),
      publishEndsAt: new Date(now + DAY),
      visibility: 'dashboard',
    });
    ids.b = await announce('Billing (fake)', {
      body: 'Pay online now.',
      publishStartsAt: new Date(now - DAY),
      visibility: 'billing',
    });
    // CM-F08: formatted, with what the portal must never show (a script, an outside image,
    // another firm's image, an http link), published before the others.
    ids.d = await announce('Formatted (fake)', {
      subject: 'Formatted',
      body:
        '<p style="text-align:center"><span style="font-family:Georgia, serif">Hello</span><script>alert(1)</script></p>' +
        `<p><img src="${portal}/api/v1/portal/${slug}/email-images/${IMAGE_ID}.png" onerror="x()"></p>` +
        '<p><img src="https://evil.example/pixel.png"></p>' +
        `<p><img src="${portal}/api/v1/portal/${fx.firmA.slug}/email-images/${IMAGE_ID}.png"></p>` +
        '<p><a class="fv-button" href="https://pay.example.test/x">Pay now</a> <a href="http://plain.example.test">plain</a></p>',
      publishStartsAt: new Date(now - 3 * DAY),
      visibility: 'dashboard',
    });
    // Not shown: ended, not started, expired (archived), a draft, an email, someone else's.
    await announce('Ended (fake)', { subject: 'Ended', publishEndsAt: new Date(now - 1) });
    await announce('Later (fake)', { subject: 'Later', publishStartsAt: new Date(now + DAY) });
    await announce('Expired (fake)', { subject: 'Expired', archivedAt: new Date(now - 1) });
    // A draft never had recipients.
    await tx.communication.create({
      data: {
        businessId,
        channel: 'ANNOUNCEMENT',
        name: 'Draft (fake)',
        subject: 'Draft',
        createdByUserId: owner.id,
      },
    });
    await announce('Email (fake)', { subject: 'Email', channel: 'EMAIL' });
    ids.c = await announce('Other (fake)', { subject: 'Only other', visibility: 'unknown' }, [
      [clients.other!, 'DELIVERED'],
    ]);
  });
  await db.$disconnect();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

async function mine(who: { email: string }, firmSlug = slug) {
  const token = (
    (await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email: who.email }))
      .body as { token: string }
  ).token;
  return request(app.getHttpServer())
    .get(`/api/v1/portal/${firmSlug}/me/announcements`)
    .set('authorization', `Bearer ${token}`);
}

describe('GET /portal/{firmSlug}/me/announcements', () => {
  it('shows the client the announcements published to them, live now, newest first, as text', async () => {
    const res = await mine(reader);
    expect(res.status).toBe(200);
    const items = MyAnnouncementList.parse(res.body).items;
    expect(items.map((i) => i.id)).toEqual([ids.b, ids.a, ids.d]);
    expect(items.slice(0, 2)).toEqual([
      {
        id: ids.b,
        title: null,
        body: 'Pay online now.',
        html: 'Pay online now.',
        where: 'billing',
        publishedAt: expect.any(String),
        endsAt: null,
      },
      {
        id: ids.a,
        title: 'Extended Office Hours',
        body: 'We are open late.\nSee you & yours.',
        html: '<p>We are open <strong>late</strong>.</p><p>See you &amp; yours.</p>',
        where: 'dashboard',
        publishedAt: expect.any(String),
        endsAt: expect.any(String),
      },
    ]);
  });

  it("shows the firm's formatting, cleaned: no script, no outside or other firm's image (CM-F08)", async () => {
    const items = MyAnnouncementList.parse((await mine(reader)).body).items;
    const d = items.find((i) => i.id === ids.d);
    // The snippet stays plain text.
    expect(d?.body).not.toContain('<');
    const html = d?.html ?? '';
    expect(html).toContain(
      '<p style="text-align:center"><span style="font-family:Georgia, serif">Hello</span></p>',
    );
    expect(html).toContain(`src="${portal}/api/v1/portal/${slug}/email-images/${IMAGE_ID}.png"`);
    expect(html).not.toContain('script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain(`/portal/${fx.firmA.slug}/`);
    expect(html).not.toContain('http://plain');
    expect(html).toMatch(/<a [^>]*class="fv-button"[^>]*>Pay now<\/a>/);
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('shows another client only theirs (an unknown place reads as the dashboard)', async () => {
    const items = MyAnnouncementList.parse((await mine(other)).body).items;
    expect(items.map((i) => [i.id, i.where])).toEqual([[ids.c, 'dashboard']]);
  });

  it('shows nothing to a left-out recipient, a login without a client record, or staff', async () => {
    expect(MyAnnouncementList.parse((await mine(left)).body).items).toEqual([]);
    expect(MyAnnouncementList.parse((await mine(pending)).body).items).toEqual([]);
    expect((await mine(owner)).status).toBe(401);
  });

  it("never shows another firm's client this firm's announcements", async () => {
    expect((await mine(fx.users.clientA)).status).toBe(404);
    const theirs = await mine(fx.users.clientA, fx.firmA.slug);
    expect(MyAnnouncementList.parse(theirs.body).items).toEqual([]);
  });
});
