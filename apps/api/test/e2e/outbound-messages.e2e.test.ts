// End-to-end: New Message (R60, MSG-F09, F10, F14; Octavia's review of Oct 27). Who each channel
// reaches and why not; drafts saved and reopened, replaced when the people change; send once,
// never twice; a client's email is a notice with the portal link and never the text (Rasel,
// Oct 28); a lead's email carries it; schedules sent by the job, canceled before. The notify
// service is replaced: nothing leaves. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { OutboundCheck as CheckShape, OutboundMessage as MessageShape } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { OutboundMessagesJob } from '../../src/messages/outbound.job.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const Outbound = z.strictObject({ ...MessageShape.shape });
const Check = z.strictObject({ ...CheckShape.shape });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60o-${key}-${run}@r60.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  portalOne: person('portal-one'),
  portalThree: person('portal-three'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '', one: '', two: '', three: '', lead: '', clientB: '' };
const ONE_EMAIL = `one-${run}@example.test`;

let app: INestApplication;
let job: OutboundMessagesJob;
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
  method: 'get' | 'post' | 'put',
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
const check = async (body: object, who = people.ownerA) =>
  Check.parse(ok(await call('post', '/outbound-messages/check', who, body)).body);
const draft = async (body: object, who = people.ownerA) =>
  Outbound.parse(ok(await call('post', '/outbound-messages', who, body), 201).body);
const reasonOf = (c: { recipients: { id: string; reason: string | null }[] }, id: string) =>
  c.recipients.find((r) => r.id === id)?.reason;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key.startsWith('portal') ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake ${key}`,
        },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: `r60o-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r60o-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    await tx.membership.create({
      data: { ...A, userId: people.ownerA.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.membership.create({
      data: { ...A, userId: people.staffA.id, role: 'STAFF', status: 'ACTIVE' },
    });
    // One: a portal login and an email, the staff member's client.
    ids.one = (
      await tx.client.create({
        data: { ...A, displayName: 'Fake One', email: ONE_EMAIL, assignedUserId: people.staffA.id },
      })
    ).id;
    // Two: an email, no portal login.
    ids.two = (
      await tx.client.create({
        data: { ...A, displayName: 'Fake Two', email: `two-${run}@example.test` },
      })
    ).id;
    // Three: a portal login, but opted out of email.
    ids.three = (
      await tx.client.create({
        data: { ...A, displayName: 'Fake Three', email: `three-${run}@example.test` },
      })
    ).id;
    for (const [p, clientId] of [
      [people.portalOne, ids.one],
      [people.portalThree, ids.three],
    ] as const) {
      await tx.clientAccount.create({
        data: {
          ...A,
          userId: p.id,
          clientId,
          email: p.email,
          portalRole: 'PRIMARY',
          status: 'ACTIVE',
        },
      });
    }
    await tx.communicationConsent.create({
      data: { ...A, clientId: ids.three, channel: 'EMAIL', status: 'OPTED_OUT', source: 'fake' },
    });
    const service = await tx.service.create({
      data: { ...A, kind: 'OTHER', name: `Other ${run}` },
    });
    ids.lead = (
      await tx.lead.create({
        data: {
          ...A,
          serviceId: service.id,
          firstName: 'Fake',
          lastName: 'Lead',
          email: `lead-${run}@example.test`,
          taxYear: 2025,
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientB = (
      await tx.client.create({ data: { businessId: ids.firmB, displayName: 'B one' } })
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
  job = moduleRef.get(OutboundMessagesJob);
});

afterAll(async () => {
  await app.close();
});

describe('MSG-F10: who each channel reaches, and why not', () => {
  it('portal needs a portal login; email an address, no opt-out and the portal; texts only leads', async () => {
    const all = { clientIds: [ids.one, ids.two, ids.three], leadIds: [ids.lead] };
    const portal = await check({ channel: 'PORTAL', ...all });
    expect(portal.recipients.map((r) => [r.name, r.canReceive])).toEqual([
      ['Fake One', true],
      ['Fake Two', false],
      ['Fake Three', true],
      ['Fake Lead', false],
    ]);
    expect(reasonOf(portal, ids.two)).toBe('NO_PORTAL_ACCESS');
    expect(reasonOf(portal, ids.lead)).toBe('NO_PORTAL_ACCESS');
    const email = await check({ channel: 'EMAIL', ...all });
    expect(reasonOf(email, ids.one)).toBeNull();
    expect(reasonOf(email, ids.two)).toBe('NO_PORTAL_ACCESS');
    expect(reasonOf(email, ids.three)).toBe('NO_CONSENT');
    expect(reasonOf(email, ids.lead)).toBeNull();
    const sms = await check({ channel: 'SMS', ...all });
    expect(sms.recipients.every((r) => r.reason === 'PROVIDER_UNAVAILABLE')).toBe(true);
    expect(sms.channels.find((c) => c.channel === 'SMS')?.unavailable).toBe('TURNED_OFF');
  });

  it('only within reach: Staff their own clients; never another firm', async () => {
    expect(
      (
        await call('post', '/outbound-messages/check', people.staffA, {
          channel: 'PORTAL',
          clientIds: [ids.two],
        })
      ).status,
    ).toBe(404);
    expect(
      (await check({ channel: 'PORTAL', clientIds: [ids.one] }, people.staffA)).recipients,
    ).toHaveLength(1);
    expect(
      (
        await call('post', '/outbound-messages/check', people.ownerA, {
          channel: 'PORTAL',
          clientIds: [ids.clientB],
        })
      ).status,
    ).toBe(404);
  });
});

describe('MSG-F09, F14: drafts, sending once, schedules', () => {
  it('a draft reopens as saved; new people make a new draft and cancel the old one', async () => {
    const d = await draft({
      channel: 'PORTAL',
      subject: 'Hello',
      body: `Draft ${run}`,
      clientIds: [ids.one, ids.two],
    });
    expect(d).toMatchObject({
      status: 'DRAFT',
      editable: true,
      counts: { total: 2, canReceive: 1, cannotReceive: 1 },
    });
    const same = Outbound.parse(
      ok(
        await call('put', `/outbound-messages/${d.id}`, people.ownerA, {
          version: d.updatedAt,
          channel: 'PORTAL',
          subject: 'Hello again',
          body: `Draft ${run} edited`,
          clientIds: [ids.two, ids.one],
        }),
      ).body,
    );
    expect(same.id).toBe(d.id);
    expect(same.subject).toBe('Hello again');
    const stale = await call('put', `/outbound-messages/${d.id}`, people.ownerA, {
      version: d.updatedAt,
      channel: 'PORTAL',
      body: 'x',
      clientIds: [ids.one],
    });
    expect(codeOf(stale)).toBe('STALE_VERSION');
    const replaced = Outbound.parse(
      ok(
        await call('put', `/outbound-messages/${d.id}`, people.ownerA, {
          version: same.updatedAt,
          channel: 'PORTAL',
          body: `Draft ${run} edited`,
          clientIds: [ids.one],
        }),
      ).body,
    );
    expect(replaced.id).not.toBe(d.id);
    expect(Outbound.parse(ok(await call('get', `/outbound-messages/${d.id}`)).body).status).toBe(
      'CANCELED',
    );
    const list = ok(await call('get', '/outbound-messages?status=DRAFT')).body as {
      items: { id: string }[];
    };
    expect(list.items.map((i) => i.id)).toContain(replaced.id);
    expect(list.items.map((i) => i.id)).not.toContain(d.id);
    // Staff see only their own drafts.
    expect((await call('get', `/outbound-messages/${replaced.id}`, people.staffA)).status).toBe(
      404,
    );
  });

  it('sends once: the portal conversation for those who can, the others skipped with the reason', async () => {
    const d = await draft({
      channel: 'PORTAL',
      subject: 'Year-end',
      body: `Portal ${run}`,
      clientIds: [ids.one, ids.two],
    });
    const sent = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
          version: d.updatedAt,
        }),
      ).body,
    );
    expect(sent.status).toBe('SENT');
    const one = sent.recipients.find((r) => r.id === ids.one);
    const two = sent.recipients.find((r) => r.id === ids.two);
    expect(one).toMatchObject({ status: 'SENT', canReceive: true });
    expect(one?.threadId).toBeTruthy();
    expect(two).toMatchObject({ status: 'SKIPPED', reason: 'NO_PORTAL_ACCESS' });
    // Again (a double click): the same answer, no second message.
    const again = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
          version: d.updatedAt,
        }),
      ).body,
    );
    expect(again.recipients.find((r) => r.id === ids.one)?.threadId).toBe(one?.threadId);
    const threads = ok(
      await call(
        'get',
        `/clients/${ids.one}/message-threads?search=${encodeURIComponent(`Portal ${run}`)}`,
      ),
    ).body as { items: unknown[] };
    expect(threads.items).toHaveLength(1);
  });

  it("a client's email is the notice with the portal link, never the text; a lead's email carries it", async () => {
    outbox.length = 0;
    const d = await draft({
      channel: 'EMAIL',
      subject: 'Your documents',
      body: `Secret text ${run}`,
      clientIds: [ids.one],
      leadIds: [ids.lead],
    });
    const sent = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
          version: d.updatedAt,
        }),
      ).body,
    );
    expect(sent.status).toBe('SENT');
    const toClient = outbox.filter((m) => m.to === ONE_EMAIL);
    expect(toClient.map((m) => m.template)).toEqual(['message.received']);
    expect(JSON.stringify(toClient)).not.toContain(`Secret text ${run}`);
    expect(JSON.stringify(toClient)).toContain('/messages');
    const toLead = outbox.filter((m) => m.template === 'lead.message-email');
    expect(toLead).toHaveLength(1);
    expect(JSON.stringify(toLead[0]?.data)).toContain(`Secret text ${run}`);
    // The portal login's own notice email was not sent twice.
    expect(outbox.filter((m) => m.to === people.portalOne.email)).toHaveLength(0);
  });

  it('refuses what cannot go: no one who can receive, an email with no subject, a past schedule', async () => {
    const nobody = await draft({ channel: 'PORTAL', body: 'x', clientIds: [ids.two] });
    expect(
      codeOf(
        await call('post', `/outbound-messages/${nobody.id}/send`, people.ownerA, {
          version: nobody.updatedAt,
        }),
      ),
    ).toBe('NO_RECIPIENTS');
    const noSubject = await draft({ channel: 'EMAIL', body: 'x', clientIds: [ids.one] });
    expect(
      codeOf(
        await call('post', `/outbound-messages/${noSubject.id}/send`, people.ownerA, {
          version: noSubject.updatedAt,
        }),
      ),
    ).toBe('SUBJECT_REQUIRED');
    expect(
      codeOf(
        await call('post', `/outbound-messages/${noSubject.id}/schedule`, people.ownerA, {
          version: noSubject.updatedAt,
          scheduledFor: '2020-01-01T00:00:00.000Z',
        }),
      ),
    ).toBe('SCHEDULE_IN_PAST');
  });

  it('a schedule waits, can be canceled, and the job sends it when its time comes', async () => {
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const a = await draft({
      channel: 'PORTAL',
      subject: 'Later',
      body: `Scheduled ${run}`,
      clientIds: [ids.one],
    });
    const scheduled = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${a.id}/schedule`, people.ownerA, {
          version: a.updatedAt,
          scheduledFor: later,
        }),
      ).body,
    );
    expect(scheduled).toMatchObject({ status: 'SCHEDULED', scheduledFor: later, editable: true });
    const b = await draft({ channel: 'PORTAL', body: `Canceled ${run}`, clientIds: [ids.one] });
    const bs = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${b.id}/schedule`, people.ownerA, {
          version: b.updatedAt,
          scheduledFor: later,
        }),
      ).body,
    );
    const canceled = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${b.id}/cancel`, people.ownerA, {
          version: bs.updatedAt,
        }),
      ).body,
    );
    expect(canceled).toMatchObject({ status: 'CANCELED', editable: false });
    // Not yet due: nothing goes.
    await job.run({ businessIds: [ids.firmA] });
    expect(Outbound.parse(ok(await call('get', `/outbound-messages/${a.id}`)).body).status).toBe(
      'SCHEDULED',
    );
    await job.run({ now: new Date(Date.now() + 7_200_000), businessIds: [ids.firmA] });
    expect(Outbound.parse(ok(await call('get', `/outbound-messages/${a.id}`)).body).status).toBe(
      'SENT',
    );
    expect(Outbound.parse(ok(await call('get', `/outbound-messages/${b.id}`)).body).status).toBe(
      'CANCELED',
    );
  });

  it('audits ids and counts only, never a subject or a text', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      const rows = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.auditLog.findMany({
          where: { businessId: ids.firmA, action: { startsWith: 'outbound_message.' } },
        }),
      );
      expect(rows.length).toBeGreaterThan(5);
      expect(JSON.stringify(rows)).not.toContain(run);
    } finally {
      await owner.$disconnect();
    }
  });
});
