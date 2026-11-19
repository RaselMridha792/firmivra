// End-to-end: SA-FRM-F06 and Y09, Request Information. A Super Admin asks a firm's owner for
// information from the firm's page; it becomes a Support ticket to the owner (Waiting on
// Customer), an Account History entry and an email. The owner answers in Settings > Requests
// from Firmivra with text and files; the answer moves the request back to Open in Firmivra's
// queue (the one platform-scope write), and only on the answering firm's own request.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  FirmivraRequestList,
  FirmivraRequestThread,
  FirmRecord,
  SupportTicketDetail,
  type UploadPutTicket,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({
      method: 'PUT' as const,
      url: `memory:${file.key}`,
      headers: { 'content-type': file.contentType },
    });
  }
  completeUpload() {
    return Promise.resolve('MISSING' as const);
  }
  abortUpload() {
    return Promise.resolve();
  }
  head(key: string, { checksum = false } = {}) {
    const b = this.objects.get(key);
    return Promise.resolve(
      b
        ? { sizeBytes: b.length, sha256: checksum ? sha256(b) : null, contentEncoding: null }
        : null,
    );
  }
  read(key: string) {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
  presignDownload(file: { key: string }) {
    return Promise.resolve(`memory:${file.key}?download`);
  }
  put(ticket: UploadPutTicket, bytes: Buffer) {
    this.objects.set(ticket.url.slice('memory:'.length), bytes);
  }
}
const storage = new MemoryStorage();
// Locally a new file is clean at once (SCAN_MODE=local), so the answer's file opens.
const config: DocumentsConfig = {
  bucket: 'unused',
  region: 'us-east-1',
  forcePathStyle: true,
  scanMode: 'local',
};
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

const fx = inject('fixtures');
const tag = `inforeq${randomUUID().slice(0, 8)}`;
const people = {
  owner: { id: randomUUID(), email: `${tag}-owner@inforeq.example.test` },
  staff: { id: randomUUID(), email: `${tag}-staff@inforeq.example.test` },
  team: { id: randomUUID(), email: `${tag}-team@inforeq.example.test` },
};
/** An Active firm with an owner and a staff member, and an Active firm with no owner yet. */
const firm = { id: randomUUID(), slug: `${tag}-firm`, name: `Sample Answer Firm ${tag}` };
const ownerless = { id: randomUUID(), slug: `${tag}-none`, name: `Sample Ownerless ${tag}` };

const sent: NotifyMessage[] = [];
let app: INestApplication;
const tokens = new Map<string, string>();
async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const { token } = res.body as { token: string };
  tokens.set(email, token);
  return token;
}
const code = (res: Response) => (res.body as { error?: { code?: string } }).error?.code;

/** As a Super Admin (or another admin-pool login). */
async function admin(
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: object,
  email?: string,
) {
  const req = request(app.getHttpServer())
    [method](`/api/v1/admin${path}`)
    .set('authorization', `Bearer ${await tokenFor(email ?? fx.users.admin.email)}`);
  return body === undefined ? req : req.send(body);
}
/** As a member of a firm, on its Requests from Firmivra. */
async function member(
  method: 'get' | 'post',
  path: string,
  {
    email = people.owner.email,
    firmId = firm.id,
    body,
  }: { email?: string; firmId?: string; body?: object } = {},
) {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/firmivra-requests${path}`)
    .set('authorization', `Bearer ${await tokenFor(email)}`)
    .set('x-business-id', firmId);
  return body === undefined ? req : req.send(body);
}
const ask = (over: Record<string, unknown> = {}, id = firm.id) =>
  admin('post', `/firms/${id}/request-info`, {
    requestId: randomUUID(),
    subject: 'Your business licence',
    message: 'Fake: please send your current business licence.',
    ...over,
  });
/** What Ticket Detail shows as the request's own message: the text and its answer-by line. */
const REQUEST_TEXT = expect.stringMatching(
  /^Fake: please send your current business licence\.\n\nPlease answer by /,
) as unknown as string;
const easternDay = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
const ticketOf = async (id: string) =>
  SupportTicketDetail.parse((await admin('get', `/support/tickets/${id}`)).body);

async function upload(ticketId: string, bytes = PDF, fileName = 'licence.pdf') {
  const res = await member('post', `/${ticketId}/uploads`, {
    body: {
      fileName,
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const ticket = res.body as UploadPutTicket;
  storage.put(ticket, bytes);
  return ticket.uploadToken;
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, pool, name] of [
      ['owner', 'STAFF', 'Fake Answer Owner'],
      ['staff', 'STAFF', 'Fake Answer Staff'],
      ['team', 'ADMIN', 'Fake Team Member'],
    ] as const) {
      const p = people[key];
      await tx.user.create({ data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name } });
    }
    await tx.platformAdmin.create({ data: { userId: people.team.id, role: 'TEAM_MEMBER' } });
    await tx.business.create({ data: { ...firm, status: 'ACTIVE' } });
    await tx.business.create({ data: { ...ownerless, status: 'ACTIVE' } });
  });
  await runInScope(owner, { kind: 'business', businessId: firm.id }, async (tx) => {
    await tx.membership.create({
      data: { businessId: firm.id, userId: people.owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.membership.create({
      data: { businessId: firm.id, userId: people.staff.id, role: 'STAFF', status: 'ACTIVE' },
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
    .useValue({
      send: (m: NotifyMessage) => {
        sent.push(m);
        return Promise.resolve();
      },
    })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue(config)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('SA-FRM-F06: Request Information', () => {
  let ticketId = '';

  it('files a ticket to the owner, emails them once, and shows in the firm’s Account History', async () => {
    const before = FirmRecord.parse((await admin('get', `/firms/${firm.id}`)).body);
    expect(before.can?.requestInfo).toBe(true);
    const requestId = randomUUID();
    const res = await ask({ requestId, replyBy: easternDay(7) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const f = FirmRecord.parse(res.body);
    const entry = f.accountHistory?.[0];
    expect(entry).toMatchObject({
      type: 'INFO_REQUESTED',
      reason: 'Your business licence',
      by: { userId: fx.users.admin.id },
    });
    ticketId = entry?.ticket?.id ?? '';
    expect(ticketId).not.toBe('');

    const t = await ticketOf(ticketId);
    expect(t.subject).toBe('Information request: Your business licence');
    expect(t.status).toBe('WAITING_ON_CUSTOMER');
    expect(t.source).toBe('INTERNAL');
    expect(t.contact.id).toBe(people.owner.id);
    expect(t.description).toContain('Fake: please send your current business licence.');
    expect(t.description).toContain('Please answer by');

    const mails = sent.filter((m) => m.template === 'platform.firm-info-request');
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: people.owner.email, businessId: null });
    expect((mails[0]!.data as { link: string }).link).toMatch(
      new RegExp(`/settings/firmivra-requests/${ticketId}$`),
    );
    expect((mails[0]!.data as { reference: string }).reference).toBe(`#${t.number}`);

    // The same request again (a retry): the same ticket, no second entry or email.
    const again = FirmRecord.parse((await ask({ requestId, replyBy: easternDay(7) })).body);
    expect(again.accountHistory?.filter((e) => e.type === 'INFO_REQUESTED')).toHaveLength(1);
    expect(sent.filter((m) => m.template === 'platform.firm-info-request')).toHaveLength(1);
  });

  it('refuses a firm with no owner to answer, a past day and anyone but a Super Admin', async () => {
    const none = await ask({}, ownerless.id);
    expect(none.status).toBe(409);
    expect(code(none)).toBe('FIRM_CANNOT_ANSWER');
    expect(
      FirmRecord.parse((await admin('get', `/firms/${ownerless.id}`)).body).can?.requestInfo,
    ).toBe(false);
    const past = await ask({ replyBy: easternDay(-2) });
    expect(past.status).toBe(400);
    expect(code(past)).toBe('VALIDATION_FAILED');
    expect((await ask({ subject: '  ' })).status).toBe(400);
    expect((await ask({}, randomUUID())).status).toBe(404);
    const team = await admin(
      'post',
      `/firms/${firm.id}/request-info`,
      { requestId: randomUUID(), subject: 'Fake', message: 'Fake' },
      people.team.email,
    );
    expect(team.status).toBe(403);
  });

  it('the owner reads it; staff and another firm’s owner can’t', async () => {
    const list = FirmivraRequestList.parse((await member('get', '')).body);
    expect(list.items.map((i) => [i.id, i.subject, i.awaitingAnswer])).toEqual([
      [ticketId, 'Your business licence', true],
    ]);
    const thread = FirmivraRequestThread.parse((await member('get', `/${ticketId}`)).body);
    expect(thread.request).toContain('Fake: please send your current business licence.');
    expect(thread.messages).toEqual([]);
    expect(thread.canReply).toBe(true);

    expect((await member('get', '', { email: people.staff.email })).status).toBe(403);
    expect((await member('get', `/${ticketId}`, { email: people.staff.email })).status).toBe(403);
    // Firm B's owner, in firm B, naming this firm's request: 404, and nothing changes.
    const other = { email: fx.users.ownerB.email, firmId: fx.firmB.id };
    expect((await member('get', `/${ticketId}`, other)).status).toBe(404);
    const reply = await member('post', `/${ticketId}/replies`, {
      ...other,
      body: { requestId: randomUUID(), body: 'Fake answer from another firm', uploadTokens: [] },
    });
    expect(reply.status).toBe(404);
    expect(
      (
        await member('post', `/${ticketId}/uploads`, {
          ...other,
          body: {
            fileName: 'x.pdf',
            contentType: 'application/pdf',
            sizeBytes: 10,
            sha256: sha256(PDF),
          },
        })
      ).status,
    ).toBe(404);
    const t = await ticketOf(ticketId);
    expect(t.status).toBe('WAITING_ON_CUSTOMER');
    // Ticket Detail shows the request itself as its first message; no answer was added.
    expect(t.messages.map((m) => m.body)).toEqual([REQUEST_TEXT]);
    expect(FirmivraRequestList.parse((await member('get', '', other)).body).items).toEqual([]);
  });

  it('the answer, with a file, moves the request back to Open; a retry and a second answer don’t again', async () => {
    const token = await upload(ticketId);
    const requestId = randomUUID();
    const res = await member('post', `/${ticketId}/replies`, {
      body: { requestId, body: 'Here is our licence.', uploadTokens: [token] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const thread = FirmivraRequestThread.parse(res.body);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({
      from: 'FIRM',
      authorName: 'Fake Answer Owner',
      body: 'Here is our licence.',
    });
    expect(thread.messages[0]?.files.map((f) => [f.fileName, f.scanStatus])).toEqual([
      ['licence.pdf', 'CLEAN'],
    ]);
    expect(thread.awaitingAnswer).toBe(false);

    const t = await ticketOf(ticketId);
    expect(t.status).toBe('OPEN');
    expect(t.messages.map((m) => m.body)).toEqual([REQUEST_TEXT, 'Here is our licence.']);
    expect(t.activity.map((a) => a.type)).toEqual(
      expect.arrayContaining(['CLIENT_REPLY', 'STATUS_CHANGED']),
    );

    // The same answer again: no second message.
    const again = await member('post', `/${ticketId}/replies`, {
      body: { requestId, body: 'Here is our licence.', uploadTokens: [] },
    });
    expect(FirmivraRequestThread.parse(again.body).messages).toHaveLength(1);
    // A second answer while Open: kept, and the request stays Open.
    const second = await member('post', `/${ticketId}/replies`, {
      body: { requestId: randomUUID(), body: 'And our PTIN.', uploadTokens: [] },
    });
    expect(FirmivraRequestThread.parse(second.body).messages).toHaveLength(2);
    expect((await ticketOf(ticketId)).status).toBe('OPEN');

    const fileId = thread.messages[0]!.files[0]!.id;
    const link = await member('get', `/${ticketId}/files/${fileId}`);
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    expect((link.body as { url: string }).url).toContain(`tenant/${firm.id}/support/`);
    expect(
      (
        await member('get', `/${ticketId}/files/${fileId}`, {
          email: fx.users.ownerB.email,
          firmId: fx.firmB.id,
        })
      ).status,
    ).toBe(404);
  });

  it('shows Firmivra’s sent replies, never a reply kept back or a note, and refuses an answer once resolved', async () => {
    const reply = (body: string, sendToClient: boolean) =>
      admin('post', `/support/tickets/${ticketId}/replies`, { mode: 'REPLY', body, sendToClient });
    expect((await reply('Fake: thanks, all received.', true)).status).toBeLessThan(300);
    expect((await reply('Fake: kept back.', false)).status).toBeLessThan(300);
    expect(
      (
        await admin('post', `/support/tickets/${ticketId}/replies`, {
          mode: 'NOTE',
          body: 'Fake note',
        })
      ).status,
    ).toBeLessThan(300);
    const thread = FirmivraRequestThread.parse((await member('get', `/${ticketId}`)).body);
    expect(thread.messages.map((m) => [m.from, m.body])).toEqual([
      ['FIRM', 'Here is our licence.'],
      ['FIRM', 'And our PTIN.'],
      ['FIRMIVRA', 'Fake: thanks, all received.'],
    ]);

    const t = await ticketOf(ticketId);
    const resolved = await admin('patch', `/support/tickets/${ticketId}`, {
      version: t.version,
      status: 'RESOLVED',
    });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    const closed = await member('post', `/${ticketId}/replies`, {
      body: { requestId: randomUUID(), body: 'One more thing.', uploadTokens: [] },
    });
    expect(closed.status).toBe(409);
    expect(code(closed)).toBe('REQUEST_CLOSED');
    const noUpload = await member('post', `/${ticketId}/uploads`, {
      body: {
        fileName: 'x.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
        sha256: sha256(PDF),
      },
    });
    expect(noUpload.status).toBe(409);
    expect(FirmivraRequestThread.parse((await member('get', `/${ticketId}`)).body).canReply).toBe(
      false,
    );
  });
});
