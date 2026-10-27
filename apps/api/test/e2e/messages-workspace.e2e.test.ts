// End-to-end: the Messages workspace (R60, Octavia's review of Oct 27, section B). MSG-F01: the
// inbox finds a conversation by the client's full email and by a full phone number in any format,
// only within the caller's reach. MSG-F03: archived threads leave the active inbox for the
// Archived view, and a thread an automation opened says so. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { MessageThread as ThreadShape } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const Thread = z.strictObject({ ...ThreadShape.shape });
const ThreadList = z.strictObject({ items: z.array(Thread), nextCursor: z.string().nullable() });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60m-${key}-${run}@r60.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  one: '',
  two: '',
  threadOne: '',
  threadTwo: '',
  archived: '',
  automated: '',
};
const EMAIL = `Dana.Fake-${run}@Example.test`;

let app: INestApplication;
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
  path: string,
  who: { email: string },
  businessId = ids.firmA,
): Promise<Response> {
  return request(app.getHttpServer())
    .get(`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
}
const inbox = async (query: string, who = people.ownerA, businessId = ids.firmA) => {
  const res = await firm(`/message-threads?${query}`, who, businessId);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ThreadList.parse(res.body).items;
};
const found = async (search: string, who = people.ownerA) =>
  (await inbox(`search=${encodeURIComponent(search)}`, who)).map((t) => t.id);

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: `r60m-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r60m-b-${run}`, name: 'B', status: 'ACTIVE' } })
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
    // One: the staff member's client, a number typed with punctuation and the country code.
    ids.one = (
      await tx.client.create({
        data: {
          ...A,
          displayName: `Dana Fake ${run}`,
          email: EMAIL.toLowerCase(),
          phone: '+1 (404) 555-0187',
          assignedUserId: people.staffA.id,
        },
      })
    ).id;
    // Two: nobody's, a ten-digit number with dots.
    ids.two = (
      await tx.client.create({
        data: {
          ...A,
          displayName: `Lee Sample ${run}`,
          email: `lee-${run}@example.test`,
          phone: '678.555.0142',
        },
      })
    ).id;
    const thread = async (clientId: string, subject: string, archivedAt: Date | null = null) => {
      const t = await tx.messageThread.create({
        data: { ...A, clientId, subject, archivedAt, createdByUserId: people.ownerA.id },
      });
      await tx.message.create({
        data: {
          ...A,
          threadId: t.id,
          senderUserId: people.ownerA.id,
          direction: 'FIRM_TO_CLIENT',
          body: 'A synthetic message.',
        },
      });
      return t.id;
    };
    ids.threadOne = await thread(ids.one, 'Hello');
    ids.threadTwo = await thread(ids.two, 'Hi');
    ids.archived = await thread(ids.two, 'Last year', new Date('2026-01-05T10:00:00Z'));
    ids.automated = await thread(ids.two, 'Welcome');
    // The automation's Send client message that opened "Welcome".
    const rule = await tx.automationRule.create({
      data: {
        ...A,
        name: `Fake rule ${run}`,
        category: 'CLIENTS',
        ownerUserId: people.ownerA.id,
        createdByUserId: people.ownerA.id,
      },
    });
    const version = await tx.automationRuleVersion.create({
      data: {
        ...A,
        ruleId: rule.id,
        version: 1,
        triggerModule: 'CLIENTS',
        triggerEvent: 'client.created',
        conditions: [],
        actions: [
          {
            id: 'a1',
            type: 'SEND_CLIENT_MESSAGE',
            config: { subject: 'Welcome', body: 'Fake welcome' },
            delayMinutes: 0,
            dependsOn: null,
          },
        ],
        settings: {
          preventDuplicatesDays: 7,
          logAll: true,
          notifyOnFailureUserIds: [],
          addToCalendar: false,
          quietHours: null,
          safetyThreshold: null,
        },
        createdByUserId: people.ownerA.id,
      },
    });
    const automationRun = await tx.automationRun.create({
      data: {
        ...A,
        ruleId: rule.id,
        ruleVersionId: version.id,
        status: 'SUCCESS',
        sourceModule: 'CLIENTS',
        sourceEventKey: `client.created:${ids.two}:created`,
        clientId: ids.two,
        correlationId: randomUUID(),
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 5,
      },
    });
    await tx.automationActionExecution.create({
      data: {
        ...A,
        runId: automationRun.id,
        actionKey: 'a1',
        position: 0,
        actionType: 'SEND_CLIENT_MESSAGE',
        status: 'SUCCESS',
        idempotencyKey: `r60m-${run}`,
        finishedAt: new Date(),
        resultKind: 'message_thread',
        resultId: ids.automated,
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    // The same email and number at another firm: never found from firm A, and the reverse.
    const other = await tx.client.create({
      data: { ...B, displayName: 'B Dana', email: EMAIL.toLowerCase(), phone: '4045550187' },
    });
    await tx.messageThread.create({ data: { ...B, clientId: other.id, subject: 'B thread' } });
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
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('MSG-F01: search by email and phone', () => {
  it('finds the conversation by the full email in any case, and by the name', async () => {
    expect(await found(EMAIL)).toEqual([ids.threadOne]);
    expect(await found(EMAIL.toUpperCase())).toEqual([ids.threadOne]);
    expect(await found(`Dana Fake ${run}`)).toEqual([ids.threadOne]);
  });

  it('finds a phone number whatever its format, with or without the country code', async () => {
    for (const typed of ['(404) 555-0187', '404.555.0187', '4045550187', '+1 404 555 0187']) {
      expect(await found(typed), typed).toEqual([ids.threadOne]);
    }
    // Two's number was saved with dots; typed with dashes or the country code it is the same.
    expect((await found('678-555-0142')).sort()).toEqual([ids.threadTwo, ids.automated].sort());
    expect((await found('+16785550142')).sort()).toEqual([ids.threadTwo, ids.automated].sort());
    // Seven digits: the local number.
    expect(await found('555-0187')).toEqual([ids.threadOne]);
    expect(await found('(212) 555-0100')).toEqual([]);
  });

  it('stays within reach: Staff only their clients, never another firm', async () => {
    expect(await found('4045550187', people.staffA)).toEqual([ids.threadOne]);
    expect(await found('678.555.0142', people.staffA)).toEqual([]);
    expect(await found(`lee-${run}@example.test`, people.staffA)).toEqual([]);
    const b = (await inbox(`search=${encodeURIComponent(EMAIL)}`, people.ownerB, ids.firmB)).map(
      (t) => t.subject,
    );
    expect(b).toEqual(['B thread']);
  });
});

describe('MSG-F03: Archived and Automations views', () => {
  it('an archived thread leaves the active inbox and is listed with archived=true', async () => {
    const active = await inbox('');
    expect(active.map((t) => t.id)).not.toContain(ids.archived);
    expect(active.every((t) => t.archivedAt === null)).toBe(true);
    const archived = await inbox('archived=true');
    expect(archived.map((t) => t.id)).toEqual([ids.archived]);
    expect(archived[0]?.archivedAt).toBe('2026-01-05T10:00:00.000Z');
    // The client's own list follows the same rule.
    const client = await firm(`/clients/${ids.two}/message-threads?archived=true`, people.ownerA);
    expect(ThreadList.parse(client.body).items.map((t) => t.id)).toEqual([ids.archived]);
  });

  it('says which thread an automation opened', async () => {
    const active = await inbox('');
    expect(active.find((t) => t.id === ids.automated)?.automated).toBe(true);
    expect(active.find((t) => t.id === ids.threadTwo)?.automated).toBe(false);
    const detail = await firm(`/message-threads/${ids.automated}`, people.ownerA);
    expect((detail.body as { automated: boolean }).automated).toBe(true);
  });
});
