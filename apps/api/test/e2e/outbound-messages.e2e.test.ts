// End-to-end: New Message (R60, MSG-F09, F10, F14; Octavia's review of Oct 27). Who each channel
// reaches and why not; drafts saved and reopened, replaced when the people change; send once,
// never twice; a client's email is a notice with the portal link and never the text (Rasel,
// Oct 28); a lead's email carries it; schedules sent by the job, canceled before. The notify
// service is replaced: nothing leaves. MSG-F11, F15: a template kept on the draft, merge fields
// filled per person in the review, and unfilled ones blocking until confirmed. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
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
  method: 'get' | 'post' | 'put' | 'delete',
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

describe('MSG-F11, F15: templates, merge fields and the review', () => {
  it('a template of the firm is kept on the draft; another one is 404', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const templateId = await runInScope(
      owner,
      { kind: 'business', businessId: ids.firmA },
      async (tx) =>
        (
          await tx.messageTemplate.create({
            data: {
              businessId: ids.firmA,
              kind: 'PORTAL_MESSAGE',
              name: `Fake template ${run}`,
              body: 'Hello [Client First Name]',
              status: 'ACTIVE',
              ownerUserId: people.ownerA.id,
            },
          })
        ).id,
    ).finally(() => owner.$disconnect());
    const d = await draft({
      channel: 'PORTAL',
      body: 'Hello [Client First Name]',
      templateId,
      clientIds: [ids.one],
    });
    expect(d.templateId).toBe(templateId);
    const missing = await call('post', '/outbound-messages', people.ownerA, {
      channel: 'PORTAL',
      body: 'x',
      templateId: randomUUID(),
      clientIds: [ids.one],
    });
    expect(missing.status).toBe(404);
  });

  it('a send records the template’s use once: its version, by whom (Y04, Y09)', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const inA = <T>(work: (tx: TxClient) => Promise<T>) =>
      runInScope(owner, { kind: 'business', businessId: ids.firmA }, work);
    try {
      const templateId = (
        await inA((tx) =>
          tx.messageTemplate.create({
            data: {
              businessId: ids.firmA,
              kind: 'PORTAL_MESSAGE',
              name: `Fake used template ${run}`,
              body: 'Hello',
              status: 'ACTIVE',
              version: 3,
              ownerUserId: people.ownerA.id,
            },
          }),
        )
      ).id;
      const d = await draft({
        channel: 'PORTAL',
        subject: 'Used',
        body: `Used ${run}`,
        templateId,
        clientIds: [ids.one],
      });
      const uses = () =>
        inA((tx) =>
          tx.messageTemplateUse.findMany({
            where: { templateId },
            select: {
              version: true,
              purpose: true,
              entityType: true,
              entityId: true,
              usedByUserId: true,
            },
          }),
        );
      expect(await uses()).toEqual([]);
      for (let i = 0; i < 2; i++)
        ok(
          await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
            version: d.updatedAt,
          }),
        );
      expect(await uses()).toEqual([
        {
          version: 3,
          purpose: 'message',
          entityType: 'outbound_message',
          entityId: d.id,
          usedByUserId: people.ownerA.id,
        },
      ]);
    } finally {
      await owner.$disconnect();
    }
  });

  it('an email from a template carries the firm’s footer and disclaimer once; an email written from scratch does not (Y10)', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const inA = <T>(work: (tx: TxClient) => Promise<T>) =>
      runInScope(owner, { kind: 'business', businessId: ids.firmA }, work);
    const footer = `Fake footer ${run}`;
    const disclaimer = `Fake disclaimer ${run}`;
    const times = (s: string, part: string) => s.split(part).length - 1;
    try {
      await inA((tx) =>
        tx.templateBranding.upsert({
          where: { businessId: ids.firmA },
          create: { businessId: ids.firmA, footerText: footer, disclaimer },
          update: { footerText: footer, disclaimer },
        }),
      );
      const templateId = (
        await inA((tx) =>
          tx.messageTemplate.create({
            data: {
              businessId: ids.firmA,
              kind: 'EMAIL',
              name: `Fake branded template ${run}`,
              subject: 'Branded',
              body: 'Hello',
              status: 'ACTIVE',
              ownerUserId: people.ownerA.id,
            },
          }),
        )
      ).id;
      const send = async (save: object) => {
        outbox.length = 0;
        const d = await draft(save);
        ok(
          await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
            version: d.updatedAt,
          }),
        );
        return JSON.stringify(outbox.filter((m) => m.template === 'lead.message-email'));
      };
      // The body already has the disclaimer: only the footer is added.
      const branded = await send({
        channel: 'EMAIL',
        subject: 'Branded',
        body: `Branded ${run}\n\n${disclaimer}`,
        templateId,
        leadIds: [ids.lead],
      });
      expect([times(branded, footer), times(branded, disclaimer)]).toEqual([1, 1]);
      const plain = await send({
        channel: 'EMAIL',
        subject: 'Plain',
        body: `Plain ${run}`,
        leadIds: [ids.lead],
      });
      expect(plain).toContain(`Plain ${run}`);
      expect(plain).not.toContain(footer);
    } finally {
      await inA((tx) => tx.templateBranding.deleteMany({ where: { businessId: ids.firmA } }));
      await owner.$disconnect();
    }
  });

  it('the review fills each person’s fields; unfilled ones block the send until confirmed', async () => {
    const d = await draft({
      channel: 'EMAIL',
      subject: 'For [Client Full Name]',
      body: `Hi [Client First Name], your code is [Fake Field] (${run}).`,
      clientIds: [ids.one],
      leadIds: [ids.lead],
    });
    const review = ok(await call('get', `/outbound-messages/${d.id}/review`)).body as {
      recipients: { id: string; subject: string | null; body: string; unresolved: string[] }[];
      unresolved: string[];
      checks: { code: string; severity: string }[];
    };
    const one = review.recipients.find((r) => r.id === ids.one);
    const lead = review.recipients.find((r) => r.id === ids.lead);
    expect(one?.subject).toBe('For Fake One');
    expect(one?.body).toContain('Hi Fake,');
    expect(lead?.body).toContain('Hi Fake,');
    expect(review.unresolved).toEqual(['Fake Field']);
    expect(review.checks.map((c) => c.code)).toContain('UNRESOLVED_FIELDS');
    const blocked = await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
      version: d.updatedAt,
    });
    expect(codeOf(blocked)).toBe('UNRESOLVED_FIELDS');
    outbox.length = 0;
    const sent = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
          version: d.updatedAt,
          confirmUnresolved: true,
        }),
      ).body,
    );
    expect(sent.status).toBe('SENT');
    // The lead's email carries the filled text; the field nobody could fill goes as written.
    const toLead = outbox.find((m) => m.template === 'lead.message-email');
    expect(JSON.stringify(toLead?.data)).toContain('Hi Fake,');
    expect(JSON.stringify(toLead?.data)).toContain('[Fake Field]');
  });
});

describe('MSG-F16: Add to Client Timeline', () => {
  const Timeline = z.object({
    items: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        title: z.string(),
        summary: z.string().nullable(),
        occurredAt: z.string(),
        href: z.string().nullable(),
        createdBy: z.object({ userId: z.string(), name: z.string() }).nullable(),
      }),
    ),
    nextCursor: z.string().nullable(),
  });
  const timeline = async (clientId: string, who: { email: string } = people.ownerA) =>
    Timeline.parse(ok(await call('get', `/clients/${clientId}/timeline`, who)).body);

  it('a sent message adds one entry per client who got it: the subject, channel and date, never the text', async () => {
    const secret = `Timeline ${run} secret text`;
    const d = await draft({
      channel: 'PORTAL',
      subject: `Timeline ${run}`,
      body: secret,
      clientIds: [ids.one, ids.two],
      leadIds: [ids.lead],
      addToTimeline: true,
    });
    expect(d.addToTimeline).toBe(true);
    const before = (await timeline(ids.one)).items.length;
    const sent = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
          version: d.updatedAt,
        }),
      ).body,
    );
    const one = sent.recipients.find((r) => r.id === ids.one);
    expect(one?.status).toBe('SENT');
    const after = await timeline(ids.one);
    expect(after.items).toHaveLength(before + 1);
    expect(after.items[0]).toMatchObject({
      kind: 'MESSAGE',
      title: `Timeline ${run}`,
      summary: expect.stringContaining('through the client portal') as string,
      href: `/messages?thread=${one?.threadId}`,
      createdBy: { userId: people.ownerA.id },
    });
    expect(JSON.stringify(after)).not.toContain(secret);
    // Two had no portal login (skipped): nothing on their timeline from this message.
    expect(JSON.stringify(await timeline(ids.two))).not.toContain(`Timeline ${run}`);
    // A second send (a double click) adds nothing.
    ok(
      await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
        version: d.updatedAt,
      }),
    );
    expect((await timeline(ids.one)).items).toHaveLength(before + 1);
    // Reading it is audited with the client's id only.
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      const rows = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.auditLog.findMany({
          where: { businessId: ids.firmA, action: 'client_timeline.viewed', entityId: ids.one },
          select: { metadata: true },
        }),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toContain(secret);
    } finally {
      await owner.$disconnect();
    }
  });

  it('left unchecked, nothing is added', async () => {
    const before = (await timeline(ids.one)).items.length;
    const d = await draft({
      channel: 'PORTAL',
      subject: `No timeline ${run}`,
      body: 'Not on the timeline',
      clientIds: [ids.one],
    });
    expect(d.addToTimeline).toBe(false);
    ok(
      await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
        version: d.updatedAt,
      }),
    );
    expect((await timeline(ids.one)).items).toHaveLength(before);
  });

  it("Staff read their own client's timeline only; another firm's is 404", async () => {
    expect((await timeline(ids.one, people.staffA)).items.length).toBeGreaterThan(0);
    const theirs = await call('get', `/clients/${ids.two}/timeline`, people.staffA);
    expect(theirs.status).toBe(404);
    const other = await call(
      'get',
      `/clients/${ids.one}/timeline`,
      people.ownerB,
      undefined,
      ids.firmB,
    );
    expect(other.status).toBe(404);
  });
});

describe("M24 (Messaging Review 2): a client's drafts and scheduled messages", () => {
  it('lists only those to the client, by status; a client out of reach is 404', async () => {
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const two = await draft({ channel: 'PORTAL', body: `M24 two ${run}`, clientIds: [ids.two] });
    const three = await draft({
      channel: 'PORTAL',
      body: `M24 three ${run}`,
      clientIds: [ids.three],
    });
    const both = await draft({
      channel: 'PORTAL',
      body: `M24 both ${run}`,
      clientIds: [ids.two, ids.three],
    });
    const planned = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${both.id}/schedule`, people.ownerA, {
          version: both.updatedAt,
          scheduledFor: later,
        }),
      ).body,
    );
    const listed = async (query: string, who = people.ownerA) =>
      (
        ok(await call('get', `/outbound-messages?${query}`, who)).body as {
          items: { id: string }[];
        }
      ).items.map((i) => i.id);
    const forTwo = await listed(`clientId=${ids.two}`);
    expect(forTwo).toEqual(expect.arrayContaining([two.id, planned.id]));
    expect(forTwo).not.toContain(three.id);
    const scheduled = await listed(`clientId=${ids.two}&status=SCHEDULED`);
    expect(scheduled).toContain(planned.id);
    expect(scheduled).not.toContain(two.id);
    // Staff reach only their own clients; another firm's client is never reached.
    expect(
      (await call('get', `/outbound-messages?clientId=${ids.two}`, people.staffA)).status,
    ).toBe(404);
    expect((await call('get', `/outbound-messages?clientId=${ids.clientB}`)).status).toBe(404);
    for (const m of [two, three]) {
      ok(
        await call('post', `/outbound-messages/${m.id}/cancel`, people.ownerA, {
          version: m.updatedAt,
        }),
      );
    }
    ok(
      await call('post', `/outbound-messages/${planned.id}/cancel`, people.ownerA, {
        version: planned.updatedAt,
      }),
    );
  });
});

describe('M22 (Messaging Review 2): New Message sends files with no text, by portal only', () => {
  /** A file on the message, clean, as the browser's upload and the scanner leave it. */
  async function fileOn(outboundMessageId: string, fileName: string): Promise<string> {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const fileId = await runInScope(
      owner,
      { kind: 'business', businessId: ids.firmA },
      async (tx) => {
        const f = await tx.outboundMessageFile.create({
          data: {
            businessId: ids.firmA,
            outboundMessageId,
            fileName,
            contentType: 'application/pdf',
            sizeBytes: 64,
            sha256: 'a'.repeat(64),
            s3Key: `tenant/${ids.firmA}/messages/${randomUUID()}`,
            uploadedByUserId: people.ownerA.id,
          },
          select: { id: true },
        });
        await tx.outboundMessageFile.update({
          where: { id: f.id },
          data: { scanStatus: 'CLEAN', scannedAt: new Date() },
        });
        return f.id;
      },
    );
    await owner.$disconnect();
    return fileId;
  }
  const later = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
  const versionOf = async (id: string) =>
    Outbound.parse(ok(await call('get', `/outbound-messages/${id}`)).body).updatedAt;

  it('files and no text: saved with none, sent with the files line of a reply', async () => {
    const d = await draft({ channel: 'PORTAL', subject: `Files ${run}`, clientIds: [ids.one] });
    expect(d.body).toBe('');
    // Nothing yet: no text and no file is refused at Send and Schedule, and the review says so.
    const empty = ok(await call('get', `/outbound-messages/${d.id}/review`)).body as {
      checks: { code: string; severity: string }[];
    };
    expect(empty.checks).toContainEqual(
      expect.objectContaining({ code: 'BODY_REQUIRED', severity: 'BLOCK' }),
    );
    const refused = await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
      version: d.updatedAt,
    });
    expect(refused.status).toBe(400);
    expect(codeOf(refused)).toBe('BODY_REQUIRED');
    const notPlanned = await call('post', `/outbound-messages/${d.id}/schedule`, people.ownerA, {
      version: d.updatedAt,
      scheduledFor: later(),
    });
    expect(notPlanned.status).toBe(400);
    expect(codeOf(notPlanned)).toBe('BODY_REQUIRED');

    await fileOn(d.id, 'Fake W-2.pdf');
    const withFile = Outbound.parse(ok(await call('get', `/outbound-messages/${d.id}`)).body);
    expect(withFile.body).toBe('');
    const review = ok(await call('get', `/outbound-messages/${d.id}/review`)).body as {
      recipients: { id: string; body: string }[];
      checks: { code: string }[];
    };
    expect(review.recipients.find((r) => r.id === ids.one)?.body).toBe('Sent 1 file: Fake W-2.pdf');
    expect(review.checks.map((c) => c.code)).toEqual(['READY']);
    const sent = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${d.id}/send`, people.ownerA, {
          version: withFile.updatedAt,
        }),
      ).body,
    );
    expect(sent.status).toBe('SENT');
    expect(sent.body).toBe('');
    const threadId = sent.recipients.find((r) => r.id === ids.one)?.threadId;
    expect(threadId).toBeTruthy();
    // The conversation (its preview and notices) says what was sent, with the file.
    const thread = ok(await call('get', `/message-threads/${threadId ?? ''}`)).body as {
      messages: { body: string; attachments: { fileName: string }[] }[];
    };
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]?.body).toBe('Sent 1 file: Fake W-2.pdf');
    expect(thread.messages[0]?.attachments.map((a) => a.fileName)).toEqual(['Fake W-2.pdf']);
  });

  it('a scheduled message of files only keeps its last file; Save keeps a text or a file', async () => {
    const d = await draft({ channel: 'PORTAL', clientIds: [ids.one] });
    const fileId = await fileOn(d.id, 'Fake 1099.pdf');
    const planned = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${d.id}/schedule`, people.ownerA, {
          version: await versionOf(d.id),
          scheduledFor: later(),
        }),
      ).body,
    );
    expect(planned.status).toBe('SCHEDULED');
    const lastFile = await call('delete', `/outbound-messages/${d.id}/files/${fileId}`);
    expect(lastFile.status).toBe(400);
    expect(codeOf(lastFile)).toBe('BODY_REQUIRED');
    expect((await call('get', `/outbound-messages/${d.id}`)).body).toMatchObject({
      files: [expect.objectContaining({ id: fileId })],
    });
    // Save on a scheduled message with neither a text nor a file is refused too.
    const fileless = await draft({ channel: 'PORTAL', body: 'Hello', clientIds: [ids.one] });
    const scheduled = Outbound.parse(
      ok(
        await call('post', `/outbound-messages/${fileless.id}/schedule`, people.ownerA, {
          version: fileless.updatedAt,
          scheduledFor: later(),
        }),
      ).body,
    );
    const bare = await call('put', `/outbound-messages/${fileless.id}`, people.ownerA, {
      version: scheduled.updatedAt,
      channel: 'PORTAL',
      clientIds: [ids.one],
    });
    expect(bare.status).toBe(400);
    expect(codeOf(bare)).toBe('BODY_REQUIRED');
    for (const id of [d.id, fileless.id])
      ok(
        await call('post', `/outbound-messages/${id}/cancel`, people.ownerA, {
          version: await versionOf(id),
        }),
      );
  });

  it('email and text still need a body (400); a body present works as before', async () => {
    const email = await call('post', '/outbound-messages', people.ownerA, {
      channel: 'EMAIL',
      subject: 'No text',
      clientIds: [ids.one],
    });
    expect(email.status).toBe(400);
    expect(codeOf(email)).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(email.body)).toContain('Only a portal message can go with files alone');
    const text = await call('post', '/outbound-messages', people.ownerA, {
      channel: 'SMS',
      leadIds: [ids.lead],
    });
    expect(text.status).toBe(400);
    expect(codeOf(text)).toBe('VALIDATION_FAILED');
    // A blank text is still refused as before, on every channel.
    const blank = await call('post', '/outbound-messages', people.ownerA, {
      channel: 'PORTAL',
      body: '   ',
      clientIds: [ids.one],
    });
    expect(blank.status).toBe(400);
    const withText = await draft({
      channel: 'EMAIL',
      subject: 'Hi',
      body: 'Hello',
      clientIds: [ids.one],
    });
    expect(withText.body).toBe('Hello');
    ok(
      await call('post', `/outbound-messages/${withText.id}/cancel`, people.ownerA, {
        version: withText.updatedAt,
      }),
    );
  });
});
