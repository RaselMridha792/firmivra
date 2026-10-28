/**
 * Files on the firm's reply (R60, MSG-F12): the thread client's own documents that the client can
 * see, within the firm's Messages Settings; each portal login sees what My Documents lets it open.
 */
import { createHash, randomUUID } from 'node:crypto';
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
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

// Strict copies of the contract's shapes: a leaked field fails the parse.
const Message = z.strictObject({
  ...MessageShape.shape,
  sender: z.strictObject(MessageShape.shape.sender.shape),
});
const ThreadDetail = z
  .strictObject({ ...ThreadShape.shape })
  .extend({ messages: z.array(Message) });
const MyDetail = z
  .strictObject({ ...MyThreadShape.shape })
  .extend({ messages: z.array(z.strictObject({ ...MyMessageShape.shape })) });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60f-${key}-${run}@r60.test` });
const people = {
  owner: person('owner'),
  staff: person('staff'),
  otherStaff: person('other-staff'),
  primary: person('primary'),
  authorized: person('authorized'),
  ownerB: person('owner-b'),
};
const ids = {
  firm: '',
  firmB: '',
  slug: `r60f-${run}`,
  one: '',
  two: '',
  thread: '',
  docB: '',
};
/** Client One's documents, by what each one is. */
const docs: Record<string, string> = {};

let app: INestApplication;
const tokens = new Map<string, string>();

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key === 'primary' || key === 'authorized' ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R60 ${key}` },
      });
    }
    ids.firm = (
      await tx.business.create({ data: { slug: ids.slug, name: 'F', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `${ids.slug}-b`, name: 'G', status: 'ACTIVE' } })
    ).id;
  });
  const file = async (
    tx: Parameters<Parameters<typeof runInScope>[2]>[0],
    businessId: string,
    clientId: string,
    engagementId: string,
    f: {
      direction: 'FIRM_TO_CLIENT' | 'CLIENT_TO_FIRM' | 'INTERNAL';
      fileName: string;
      sizeBytes?: number;
      scan?: 'CLEAN' | 'INFECTED' | 'PENDING';
      by?: string;
    },
  ) => {
    const tag = randomUUID();
    const row = await tx.document.create({
      data: {
        businessId,
        clientId,
        engagementId,
        direction: f.direction,
        fileName: f.fileName,
        contentType: 'application/octet-stream',
        sizeBytes: f.sizeBytes ?? 100,
        sha256: createHash('sha256').update(tag).digest('hex'),
        s3Key: `tenant/${businessId}/documents/${tag}`,
        uploadedByUserId: f.by ?? null,
      },
    });
    if ((f.scan ?? 'CLEAN') !== 'PENDING')
      await tx.document.update({
        where: { id: row.id },
        data: { scanStatus: f.scan ?? 'CLEAN', scannedAt: new Date() },
      });
    return row.id;
  };
  await runInScope(owner, { kind: 'business', businessId: ids.firm }, async (tx) => {
    const F = { businessId: ids.firm };
    for (const [userId, role] of [
      [people.owner.id, 'OWNER'],
      [people.staff.id, 'STAFF'],
      [people.otherStaff.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...F, userId, role, status: 'ACTIVE' } });
    }
    ids.one = (
      await tx.client.create({
        data: { ...F, displayName: 'One', assignedUserId: people.staff.id },
      })
    ).id;
    ids.two = (await tx.client.create({ data: { ...F, displayName: 'Two' } })).id;
    for (const [p, portalRole] of [
      [people.primary, 'PRIMARY'],
      [people.authorized, 'AUTHORIZED'],
    ] as const) {
      await tx.clientAccount.create({
        data: {
          ...F,
          userId: p.id,
          clientId: ids.one,
          email: p.email,
          portalRole,
          status: 'ACTIVE',
        },
      });
    }
    const service = await tx.service.create({
      data: { ...F, kind: 'OTHER', name: `Other ${run}` },
    });
    const one = await tx.engagement.create({
      data: { ...F, clientId: ids.one, serviceId: service.id, title: 'One' },
    });
    const two = await tx.engagement.create({
      data: { ...F, clientId: ids.two, serviceId: service.id, title: 'Two' },
    });
    const of = (f: Parameters<typeof file>[4]) => file(tx, ids.firm, ids.one, one.id, f);
    docs.shared = await of({ direction: 'FIRM_TO_CLIENT', fileName: 'Engagement letter.pdf' });
    docs.household = await of({
      direction: 'CLIENT_TO_FIRM',
      fileName: 'W-2.docx',
      by: people.primary.id,
    });
    docs.authorized = await of({
      direction: 'CLIENT_TO_FIRM',
      fileName: 'Receipt.png',
      by: people.authorized.id,
    });
    docs.checking = await of({
      direction: 'FIRM_TO_CLIENT',
      fileName: 'Draft return.pdf',
      scan: 'PENDING',
    });
    docs.internal = await of({ direction: 'INTERNAL', fileName: 'Workpaper.pdf' });
    docs.infected = await of({
      direction: 'FIRM_TO_CLIENT',
      fileName: 'Bad.pdf',
      scan: 'INFECTED',
    });
    docs.text = await of({ direction: 'FIRM_TO_CLIENT', fileName: 'Notes.txt' });
    docs.large = await of({
      direction: 'FIRM_TO_CLIENT',
      fileName: 'Scan.pdf',
      sizeBytes: 11 * 1024 * 1024,
    });
    docs.otherClient = await file(tx, ids.firm, ids.two, two.id, {
      direction: 'FIRM_TO_CLIENT',
      fileName: 'Two.pdf',
    });
    const thread = await tx.messageThread.create({
      data: { ...F, clientId: ids.one, subject: 'Fake files', createdByUserId: people.owner.id },
    });
    ids.thread = thread.id;
    await tx.message.create({
      data: {
        ...F,
        threadId: thread.id,
        senderUserId: people.owner.id,
        direction: 'FIRM_TO_CLIENT',
        body: 'Fake first message',
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const G = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...G, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const client = await tx.client.create({ data: { ...G, displayName: 'B' } });
    const service = await tx.service.create({ data: { ...G, kind: 'OTHER', name: `B ${run}` } });
    const e = await tx.engagement.create({
      data: { ...G, clientId: client.id, serviceId: service.id, title: 'B' },
    });
    ids.docB = await file(tx, ids.firmB, client.id, e.id, {
      direction: 'FIRM_TO_CLIENT',
      fileName: 'B.pdf',
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

const reply = async (
  documentIds: string[] | undefined,
  who: { email: string } = people.staff,
  businessId = ids.firm,
) =>
  request(app.getHttpServer())
    .post(`/api/v1/business/message-threads/${ids.thread}/messages`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .send({ body: 'Fake reply with files', ...(documentIds ? { documentIds } : {}) });

const portal = async (
  method: 'get' | 'post',
  path: string,
  who: { email: string },
  body?: object,
) => {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${ids.slug}/me/messages${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
};

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectOk = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const messageCount = async () => {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/business/message-threads/${ids.thread}`)
    .set('x-business-id', ids.firm)
    .set('authorization', `Bearer ${await tokenFor(people.owner.email)}`);
  return ThreadDetail.parse(expectOk(res).body).messages.length;
};

describe('files on the firm reply (MSG-F12)', () => {
  it('carries the client’s shared files and uploads; each portal login sees what it may open', async () => {
    const sent = Message.parse(
      expectOk(await reply([docs.shared!, docs.household!, docs.authorized!, docs.checking!]), 201)
        .body,
    );
    const byName = (list: { fileName: string; status: string }[]) =>
      Object.fromEntries(list.map((a) => [a.fileName, a.status]));
    expect(byName(sent.attachments)).toEqual({
      'Engagement letter.pdf': 'READY',
      'W-2.docx': 'READY',
      'Receipt.png': 'READY',
      'Draft return.pdf': 'CHECKING',
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/business/message-threads/${ids.thread}`)
      .set('x-business-id', ids.firm)
      .set('authorization', `Bearer ${await tokenFor(people.owner.email)}`);
    const firmSide = ThreadDetail.parse(expectOk(res).body).messages.at(-1);
    expect(firmSide?.attachments).toHaveLength(4);

    // The household sees the firm's shared files and every household upload.
    const primary = MyDetail.parse(
      expectOk(await portal('get', `/${ids.thread}`, people.primary)).body,
    );
    expect(byName(primary.messages.at(-1)?.attachments ?? [])).toEqual({
      'Engagement letter.pdf': 'READY',
      'W-2.docx': 'READY',
      'Receipt.png': 'READY',
      'Draft return.pdf': 'CHECKING',
    });
    // An authorized login sees only its own upload, as in My Documents.
    const authorized = MyDetail.parse(
      expectOk(await portal('get', `/${ids.thread}`, people.authorized)).body,
    );
    expect(byName(authorized.messages.at(-1)?.attachments ?? [])).toEqual({
      'Receipt.png': 'READY',
    });
    // Earlier messages carry none.
    expect(primary.messages[0]?.attachments).toEqual([]);
  });

  it('refuses an internal, blocked, disallowed or oversized file, and sends nothing', async () => {
    const before = await messageCount();
    const refused = async (documentIds: string[], status: number, code: string) => {
      const res = await reply(documentIds);
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      expect(codeOf(res)).toBe(code);
    };
    await refused([docs.shared!, docs.internal!], 409, 'ATTACHMENT_NOT_SHARED');
    await refused([docs.infected!], 409, 'FILE_BLOCKED');
    await refused([docs.text!], 400, 'ATTACHMENT_TYPE');
    await refused([docs.large!], 400, 'ATTACHMENT_TOO_LARGE');
    await refused([docs.shared!, docs.shared!], 400, 'VALIDATION_FAILED');
    await refused(
      Array.from({ length: 11 }, () => randomUUID()),
      400,
      'VALIDATION_FAILED',
    );
    expect(await messageCount()).toBe(before);
  });

  it('another client’s or firm’s document is 404; Staff reach only their clients; clients cannot attach', async () => {
    expect((await reply([docs.otherClient!])).status).toBe(404);
    expect((await reply([ids.docB])).status).toBe(404);
    expect((await reply([docs.shared!], people.otherStaff)).status).toBe(404);
    expect((await reply([ids.docB], people.ownerB, ids.firmB)).status).toBe(404);
    // The portal's reply takes text only.
    const res = await portal('post', `/${ids.thread}/messages`, people.primary, {
      body: 'Fake client reply',
      documentIds: [docs.shared],
    });
    expect(res.status).toBe(400);
    expect(codeOf(res)).toBe('VALIDATION_FAILED');
  });

  it('audits the document ids, never a file name or the text', async () => {
    const sent = Message.parse(expectOk(await reply([docs.shared!]), 201).body);
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const row = await runInScope(owner, { kind: 'business', businessId: ids.firm }, (tx) =>
      tx.auditLog.findFirst({
        where: { businessId: ids.firm, action: 'message.sent', entityId: sent.id },
        select: { metadata: true },
      }),
    ).finally(() => owner.$disconnect());
    expect(row?.metadata).toEqual({
      threadId: ids.thread,
      clientId: ids.one,
      documentIds: [docs.shared],
    });
  });
});
