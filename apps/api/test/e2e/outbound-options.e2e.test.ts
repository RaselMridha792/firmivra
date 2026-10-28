// End-to-end: New Message's Related To and Assign Staff (R60, MSG-F13, F16; Octavia's review of
// Oct 27). Related To lists one client's own records and is kept on the message; the conversation
// it opens takes the record (so it shows under its view in Messages) and the owner. The owner is an
// active member who reaches everyone chosen. Another client's or another firm's record or member is
// 404. The notify service is replaced: nothing leaves. Synthetic data only.
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
  OutboundAssigneeList,
  OutboundMessage as MessageShape,
  OutboundRelatedOptions,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const Outbound = z.strictObject({ ...MessageShape.shape });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60r-${key}-${run}@r60.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  otherStaffA: person('other-staff-a'),
  portalOne: person('portal-one'),
  ownerB: person('owner-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  one: '',
  two: '',
  lead: '',
  engagement: '',
  request: '',
  task: '',
  otherRequest: '',
  requestB: '',
};

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
const save = (body: object, who = people.ownerA) => call('post', '/outbound-messages', who, body);
const draft = async (body: object, who = people.ownerA) =>
  Outbound.parse(ok(await save(body, who), 201).body);
const send = async (m: { id: string; updatedAt: string }) =>
  Outbound.parse(
    ok(
      await call('post', `/outbound-messages/${m.id}/send`, people.ownerA, {
        version: m.updatedAt,
      }),
    ).body,
  );
async function threadRow(id: string) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.messageThread.findUniqueOrThrow({
        where: { id },
        select: { entityType: true, entityId: true, engagementId: true, assignedUserId: true },
      }),
    );
  } finally {
    await owner.$disconnect();
  }
}

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
      await tx.business.create({ data: { slug: `r60r-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r60r-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [p, role] of [
      [people.ownerA, 'OWNER'],
      [people.staffA, 'STAFF'],
      [people.otherStaffA, 'STAFF'],
    ] as const)
      await tx.membership.create({ data: { ...A, userId: p.id, role, status: 'ACTIVE' } });
    ids.one = (
      await tx.client.create({
        data: {
          ...A,
          displayName: 'Fake One',
          email: `one-${run}@example.test`,
          assignedUserId: people.staffA.id,
        },
      })
    ).id;
    ids.two = (await tx.client.create({ data: { ...A, displayName: 'Fake Two' } })).id;
    await tx.clientAccount.create({
      data: {
        ...A,
        userId: people.portalOne.id,
        clientId: ids.one,
        email: people.portalOne.email,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
      },
    });
    const service = await tx.service.create({ data: { ...A, kind: 'OTHER', name: `O ${run}` } });
    ids.engagement = (
      await tx.engagement.create({
        data: { ...A, clientId: ids.one, serviceId: service.id, title: '2025 Bookkeeping' },
      })
    ).id;
    ids.request = (
      await tx.documentRequest.create({
        data: { ...A, clientId: ids.one, engagementId: ids.engagement, title: 'Bank statements' },
      })
    ).id;
    ids.task = (
      await tx.task.create({ data: { ...A, clientId: ids.one, title: 'Review the organizer' } })
    ).id;
    const twoService = await tx.engagement.create({
      data: { ...A, clientId: ids.two, serviceId: service.id, title: 'Two' },
    });
    ids.otherRequest = (
      await tx.documentRequest.create({
        data: { ...A, clientId: ids.two, engagementId: twoService.id, title: 'Not One' },
      })
    ).id;
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
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const client = await tx.client.create({ data: { ...B, displayName: 'B one' } });
    const service = await tx.service.create({ data: { ...B, kind: 'OTHER', name: `O ${run}` } });
    const e = await tx.engagement.create({
      data: { ...B, clientId: client.id, serviceId: service.id, title: 'B' },
    });
    ids.requestB = (
      await tx.documentRequest.create({
        data: { ...B, clientId: client.id, engagementId: e.id, title: 'B request' },
      })
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

describe('MSG-F13: Related To', () => {
  it("lists one client's own records, in words; another client's reach or firm is 404", async () => {
    const list = OutboundRelatedOptions.parse(
      ok(await call('get', `/outbound-messages/related-options?clientId=${ids.one}`)).body,
    );
    expect(list.items).toEqual(
      expect.arrayContaining([
        { type: 'document_request', id: ids.request, label: 'Bank statements' },
        { type: 'task', id: ids.task, label: 'Review the organizer' },
        { type: 'engagement', id: ids.engagement, label: '2025 Bookkeeping' },
      ]),
    );
    expect(list.items.map((i) => i.id)).not.toContain(ids.otherRequest);
    const path = `/outbound-messages/related-options?clientId=${ids.two}`;
    expect((await call('get', path, people.staffA)).status).toBe(404);
    expect((await call('get', path, people.ownerB, undefined, ids.firmB)).status).toBe(404);
  });

  it('is kept on the message, and the conversation it opens takes it', async () => {
    const d = await draft({
      channel: 'PORTAL',
      subject: 'Bank statements',
      body: `Related ${run}`,
      clientIds: [ids.one],
      related: { type: 'document_request', id: ids.request },
    });
    expect(d.related).toEqual({
      type: 'document_request',
      id: ids.request,
      label: 'Bank statements',
    });
    const sent = await send(d);
    const thread = await threadRow(sent.recipients[0]!.threadId!);
    expect(thread).toMatchObject({ entityType: 'document_request', entityId: ids.request });
    // A service also files the conversation under it.
    const s = await send(
      await draft({
        channel: 'PORTAL',
        body: `Service ${run}`,
        clientIds: [ids.one],
        related: { type: 'engagement', id: ids.engagement },
      }),
    );
    expect(await threadRow(s.recipients[0]!.threadId!)).toMatchObject({
      entityType: 'engagement',
      engagementId: ids.engagement,
    });
  });

  it("only for one client, and only that client's own record", async () => {
    const base = { channel: 'PORTAL', body: 'x' };
    const related = { type: 'document_request', id: ids.request };
    expect(codeOf(await save({ ...base, clientIds: [ids.one, ids.two], related }))).toBe(
      'RELATED_NEEDS_ONE_CLIENT',
    );
    // A lead in the same message is fine: only the client's conversation takes the record.
    expect(
      (await save({ ...base, clientIds: [ids.one], leadIds: [ids.lead], related })).status,
    ).toBe(201);
    for (const id of [ids.otherRequest, ids.requestB, randomUUID()])
      expect(
        (await save({ ...base, clientIds: [ids.one], related: { type: 'document_request', id } }))
          .status,
      ).toBe(404);
    expect(
      codeOf(
        await save({ ...base, clientIds: [ids.one], related: { type: 'note', id: ids.request } }),
      ),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('MSG-F16: Assign Staff', () => {
  it('lists the active members; the conversation a message opens takes its owner', async () => {
    const members = OutboundAssigneeList.parse(
      ok(await call('get', '/outbound-messages/assignees', people.staffA)).body,
    );
    expect(members.items.map((m) => m.userId).sort()).toEqual(
      [people.ownerA.id, people.staffA.id, people.otherStaffA.id].sort(),
    );
    const d = await draft({
      channel: 'PORTAL',
      body: `Owned ${run}`,
      clientIds: [ids.one],
      assignedUserId: people.staffA.id,
    });
    expect(d.assignedTo).toEqual({ userId: people.staffA.id, name: 'Fake staffA' });
    const sent = await send(d);
    expect(await threadRow(sent.recipients[0]!.threadId!)).toMatchObject({
      assignedUserId: people.staffA.id,
    });
    // A lead's thread takes it too.
    const toLead = await send(
      await draft({
        channel: 'EMAIL',
        subject: `Owned ${run}`,
        body: 'Hello',
        leadIds: [ids.lead],
        assignedUserId: people.ownerA.id,
      }),
    );
    expect(await threadRow(toLead.recipients[0]!.threadId!)).toMatchObject({
      assignedUserId: people.ownerA.id,
    });
  });

  it('a Staff member owns only conversations with their own clients; another firm’s member is 404', async () => {
    expect(
      codeOf(
        await save({
          channel: 'PORTAL',
          body: 'x',
          clientIds: [ids.one],
          assignedUserId: people.otherStaffA.id,
        }),
      ),
    ).toBe('ASSIGNEE_CANNOT_REACH');
    expect(
      codeOf(
        await save({
          channel: 'PORTAL',
          body: 'x',
          clientIds: [ids.one, ids.two],
          assignedUserId: people.staffA.id,
        }),
      ),
    ).toBe('ASSIGNEE_CANNOT_REACH');
    expect(
      (
        await save({
          channel: 'PORTAL',
          body: 'x',
          clientIds: [ids.one],
          assignedUserId: people.ownerB.id,
        })
      ).status,
    ).toBe(404);
    // Changed in place on a draft: the owner and the record go too.
    const d = await draft({ channel: 'PORTAL', body: 'x', clientIds: [ids.one] });
    const changed = Outbound.parse(
      ok(
        await call('put', `/outbound-messages/${d.id}`, people.ownerA, {
          version: d.updatedAt,
          channel: 'PORTAL',
          body: 'x',
          clientIds: [ids.one],
          assignedUserId: people.staffA.id,
          related: { type: 'task', id: ids.task },
        }),
      ).body,
    );
    expect(changed.id).toBe(d.id);
    expect(changed).toMatchObject({
      assignedTo: { userId: people.staffA.id },
      related: { type: 'task', id: ids.task, label: 'Review the organizer' },
    });
  });
});
