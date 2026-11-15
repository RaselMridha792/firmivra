// End-to-end: R55, Leads Review Two row 14. Firmivra Mail, the built-in email channel: email is
// ready for every firm with no outside account; the firm's connection is made by its first email
// campaign (a write, never a read), once, and is the campaign's sender in the firm's own name.
// On a test site (COMMUNICATIONS_MAIL is not "live") an email goes only to the firm's own team (an
// ACTIVE member's login email, exactly) or to an exact address in COMMUNICATIONS_TEST_RECIPIENTS;
// everyone else is held: recorded as not sent, never handed to the mailer. Text messages say why
// they are not available yet. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { CommunicationDetail, CommunicationsOverview } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { CommunicationDelivery } from '../../src/communications/communications-delivery.service.js';
import { CAMPAIGN_MAILER, HOLD_NOTE } from '../../src/communications/firmivra-mail.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import type { OutgoingEmail } from '../../src/notify/transports.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55fm-${key}-${run}@firm.test` });
const people = { ownerA: person('owner-a'), staffA: person('staff-a'), ownerB: person('owner-b') };
type Who = { email: string };
const firms = {} as Record<'a' | 'b', string>;
const clients = {} as Record<'team' | 'gmail' | 'listed' | 'otherFirm' | 'clientB', string>;
const LISTED = `listed-${run}@example.test`;
const GMAIL = `real.client.${run}@gmail.com`;
const sent: OutgoingEmail[] = [];
let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.81.${Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

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
async function call(
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  who: Who,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  const token = await tokenFor(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/communications${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const detail = async (id: string) =>
  CommunicationDetail.parse(ok(await call('get', `/${id}`, people.ownerA)));
const overview = async (who: Who = people.ownerA, firm: 'a' | 'b' = 'a') =>
  CommunicationsOverview.parse(ok(await call('get', '/overview', who, undefined, firm)));
const mailConnections = (firm: 'a' | 'b') =>
  inFirm(firm, (tx) =>
    tx.integrationConnection.findMany({
      where: { businessId: firms[firm], provider: 'firmivra_mail' },
    }),
  );

beforeAll(async () => {
  // A test site: holding, with one listed address and two domain entries that must be ignored.
  delete process.env['COMMUNICATIONS_MAIL'];
  process.env['COMMUNICATIONS_TEST_RECIPIENTS'] = `${LISTED.toUpperCase()}, @gmail.com, gmail.com`;
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55fm-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${key.toUpperCase()} ${run}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, p, role] of [
    ['a', people.ownerA, 'OWNER'],
    ['a', people.staffA, 'STAFF'],
    ['b', people.ownerB, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({
        data: { businessId: firms[firm], userId: p.id, role, status: 'ACTIVE' },
      }),
    );
  }
  await inFirm('a', async (tx) => {
    const client = async (key: keyof typeof clients, email: string) => {
      clients[key] = (
        await tx.client.create({
          data: { businessId: firms.a, displayName: `Fake ${key}`, email, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    };
    // The firm's own Owner; a real-looking gmail client; a listed address; and
    // a member of another firm (never firm A's team).
    await client('team', people.ownerA.email);
    await client('gmail', GMAIL);
    await client('listed', LISTED);
    await client('otherFirm', people.ownerB.email);
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(CAMPAIGN_MAILER)
    .useValue({
      transport: {
        send: (mail: OutgoingEmail) => {
          sent.push(mail);
          return Promise.resolve();
        },
      },
      from: { name: 'Firmivra', address: `campaigns-${run}@firmivra.test` },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  delete process.env['COMMUNICATIONS_TEST_RECIPIENTS'];
  await app.close();
});

describe('Firmivra Mail (Leads row 14)', () => {
  it('email is ready with no outside account, says where it goes, and a read makes nothing', async () => {
    const o = await overview();
    const email = o.channels.find((c) => c.channel === 'EMAIL');
    expect(email).toMatchObject({ ready: true, reason: null, note: HOLD_NOTE });
    // Text messages: not available yet, and why, with nothing to connect.
    const sms = o.channels.find((c) => c.channel === 'SMS');
    expect(sms).toMatchObject({ ready: false, route: null });
    expect(sms?.reason).toMatch(/toll-free number .* being registered/);
    expect(await mailConnections('a')).toHaveLength(0);
  });

  it('the first email campaign makes the firm’s connection, once, in the firm’s own name', async () => {
    const make = async () =>
      CommunicationDetail.parse(
        ok(
          await call('post', '', people.ownerA, {
            channel: 'EMAIL',
            name: `Spring ${run} ${randomUUID().slice(0, 4)}`,
          }),
          201,
        ),
      );
    const [one, two] = await Promise.all([make(), make()]);
    const rows = await mailConnections('a');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'CONNECTED', accountLabel: 'Firmivra Mail' });
    for (const c of [one, two]) {
      const stored = await inFirm('a', (tx) =>
        tx.communication.findUniqueOrThrow({
          where: { id: c.id },
          select: { connectionId: true, fromName: true },
        }),
      );
      expect(stored).toEqual({ connectionId: rows[0]!.id, fromName: `Firm A ${run}` });
    }
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a, action: 'integration.connected' },
        select: { metadata: true },
      }),
    );
    expect(audit.map((a) => a.metadata)).toEqual([{ provider: 'firmivra_mail', builtIn: true }]);
    // Creating a campaign sends nothing and adds nobody.
    expect(sent).toHaveLength(0);
    expect((await detail(one.id)).audience?.finalCount ?? 0).toBe(0);
    // Firm B has none until its own first campaign, and sees nothing of firm A's.
    expect(await mailConnections('b')).toHaveLength(0);
  });

  it('on a test site only the team and listed addresses get it; a gmail client and another firm’s member are held', async () => {
    const d = CommunicationDetail.parse(
      ok(await call('post', '', people.ownerA, { channel: 'EMAIL', name: `Held ${run}` }), 201),
    );
    let etag = (await detail(d.id)).etag;
    ok(
      await call('patch', `/${d.id}`, people.ownerA, {
        etag,
        subject: 'Spring check-in',
        body: '<p>Hello from the firm.</p>',
      }),
    );
    etag = (await detail(d.id)).etag;
    ok(
      await call('put', `/${d.id}/audience`, people.ownerA, {
        etag,
        clientIds: [clients.team, clients.gmail, clients.listed, clients.otherFirm],
      }),
    );
    const fresh = await detail(d.id);
    ok(
      await call('post', `/${d.id}/send`, people.ownerA, {
        idempotencyKey: randomUUID(),
        etag: fresh.etag,
      }),
    );
    sent.length = 0;
    const result = await app
      .get(CommunicationDelivery, { strict: false })
      .run({ businessIds: [firms.a] });
    expect(result).toMatchObject({ skipped: false, sent: 2, failed: 0 });
    // Only the firm's own Owner and the listed address were handed to the mailer.
    expect(sent.map((m) => m.to.toLowerCase()).sort()).toEqual(
      [people.ownerA.email, LISTED].sort(),
    );
    expect(sent[0]).toMatchObject({
      from: { name: `Firm A ${run}`, address: `campaigns-${run}@firmivra.test` },
      subject: 'Spring check-in',
    });
    expect(sent[0]!.text).toBe('Hello from the firm.');
    const rows = await inFirm('a', (tx) =>
      tx.communicationRecipient.findMany({
        where: { communicationId: d.id },
        select: { clientId: true, status: true, failureCode: true },
      }),
    );
    const by = new Map(rows.map((r) => [r.clientId, r]));
    expect(by.get(clients.team)).toMatchObject({ status: 'SENT', failureCode: null });
    expect(by.get(clients.listed)).toMatchObject({ status: 'SENT' });
    expect(by.get(clients.gmail)).toMatchObject({ status: 'NOT_SENT', failureCode: 'held_on_dev' });
    expect(by.get(clients.otherFirm)).toMatchObject({
      status: 'NOT_SENT',
      failureCode: 'held_on_dev',
    });
    // Held is not a failure: the campaign finishes as sent.
    expect((await detail(d.id)).status).toBe('SENT');
  });

  it('a firm that disconnected Firmivra Mail is not connected again behind its back', async () => {
    const [row] = await mailConnections('a');
    await inFirm('a', (tx) =>
      tx.integrationConnection.update({
        where: { id: row!.id },
        data: { status: 'DISCONNECTED', disconnectedAt: new Date() },
      }),
    );
    const res = await call('post', '', people.ownerA, { channel: 'EMAIL', name: `After ${run}` });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((await mailConnections('a')).map((r) => r.status)).toEqual(['DISCONNECTED']);
    const email = (await overview()).channels.find((c) => c.channel === 'EMAIL');
    expect(email?.ready).toBe(false);
  });
});
