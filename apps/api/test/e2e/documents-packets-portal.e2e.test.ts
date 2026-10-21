// End-to-end: R55, request packets in the client portal (contract
// packages/types/src/documents/portal-packets.ts; Frame 7, Document Request & Upload): the list,
// one packet with its items, files, progress and activity, answering items through the ordinary
// upload, Submit for Review, expiry, and who sees what (household and AUTHORIZED logins,
// another client, a draft, a cancelled packet).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  MyDocument,
  MyDocumentRequestList,
  MyRequestPacket,
  MyRequestPacketList,
  UploadPutTicket,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  type FileFacts,
} from '../../src/storage/document-storage.js';
import { pdf, sha256 } from '../office-files.js';
import { MemoryUploads } from '../memory-uploads.js';

/** Storage in memory: `objects.set(key, bytes)` is the browser's PUT. */
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  readonly uploads = new MemoryUploads(this.objects);
  presignUpload(file: FileFacts) {
    return this.uploads.presign(file);
  }
  completeUpload(key: string, uploadId: string, sizeBytes: number) {
    return this.uploads.complete(key, uploadId, sizeBytes);
  }
  abortUpload(key: string, uploadId: string) {
    return this.uploads.abort(key, uploadId);
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
}
const storage = new MemoryStorage();
const config: DocumentsConfig = {
  bucket: 'unused',
  region: 'us-east-1',
  forcePathStyle: true,
  scanMode: 'local',
};

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string, pool: 'STAFF' | 'CLIENT') => ({
  id: randomUUID(),
  email: `r55k-${key}-${run}@r55.test`,
  pool,
});
const people = {
  owner: person('owner', 'STAFF'),
  primary: person('primary', 'CLIENT'),
  authorized: person('authorized', 'CLIENT'),
  other: person('other', 'CLIENT'),
};
type Who = (typeof people)[keyof typeof people];
const firm = { id: '', slug: `r55k-${run}` };
const ids = {} as Record<string, string>;
const tokens = new Map<string, string>();
let app: INestApplication;
const DAY = 86_400_000;
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function asOwner<T>(work: Parameters<typeof runInScope<T>>[2]): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'business', businessId: firm.id }, work);
  } finally {
    await owner.$disconnect();
  }
}
async function tokenFor(who: Who) {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email })
      .expect(200);
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  return token;
}
async function portal(method: 'get' | 'post', path: string, who: Who, body?: object) {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${firm.slug}/me${path}`)
    .set('authorization', `Bearer ${await tokenFor(who)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = <T>(res: Response, schema: { parse: (v: unknown) => T }): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return schema.parse(res.body);
};
const packets = async (who: Who) =>
  ok(await portal('get', '/request-packets', who), MyRequestPacketList).items;
const packet = async (id: string, who: Who = people.primary) =>
  ok(await portal('get', `/request-packets/${id}`, who), MyRequestPacket);

/** The portal's three upload steps for one item; or step 1's or step 3's error. */
async function uploadFor(requestId: string, who: Who = people.primary, name = 'W-2.pdf') {
  const bytes = pdf(randomUUID());
  const start = await portal('post', '/documents/uploads', who, {
    serviceId: ids.e1,
    requestId,
    fileName: name,
    contentType: 'application/pdf',
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
  });
  if (start.status !== 200) return start;
  const ticket = UploadPutTicket.parse(start.body);
  storage.objects.set(ticket.url.slice('memory:'.length), bytes);
  return portal('post', '/documents/uploads/confirm', who, { uploadToken: ticket.uploadToken });
}

/** A packet sent to a client: made as a draft with its items, then sent (the database's rule). */
async function seedPacket(
  key: string,
  opts: {
    clientId?: string;
    engagementId?: string;
    items: { title: string; required?: boolean }[];
    then?: 'DRAFT' | 'OPEN' | 'CANCELLED' | 'COMPLETED';
    dueOn?: string;
    expiresAt?: Date | null;
  },
) {
  await asOwner(async (tx) => {
    const clientId = opts.clientId ?? ids.c1!;
    const engagementId = opts.engagementId ?? ids.e1!;
    const p = await tx.documentRequestPacket.create({
      data: {
        businessId: firm.id,
        clientId,
        engagementId,
        title: `Fake ${key} documents`,
        requestedByUserId: people.owner.id,
      },
      select: { id: true },
    });
    ids[key] = p.id;
    let n = 0;
    for (const item of opts.items) {
      const r = await tx.documentRequest.create({
        data: {
          businessId: firm.id,
          clientId,
          engagementId,
          packetId: p.id,
          title: item.title,
          required: item.required ?? true,
          sortOrder: n++,
        },
        select: { id: true },
      });
      ids[`${key}.${item.title}`] = r.id;
    }
    if (opts.then === 'DRAFT') return;
    await tx.documentRequestPacket.update({
      where: { id: p.id },
      data: {
        status: 'OPEN',
        dueOn: new Date(`${opts.dueOn ?? dateIn(10)}T00:00:00Z`),
        messageSubject: 'Fake documents for your return',
        messageBody: 'Hello {Client Name}, please upload these by {Due Date}.',
        expiresAt: opts.expiresAt ?? null,
      },
    });
    if (opts.then === 'CANCELLED' || opts.then === 'COMPLETED') {
      await tx.documentRequestPacket.update({ where: { id: p.id }, data: { status: opts.then } });
    }
  });
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      for (const [key, p] of Object.entries(people)) {
        await tx.user.create({
          data: { id: p.id, cognitoSub: p.id, pool: p.pool, email: p.email, name: `Fake ${key}` },
        });
      }
      firm.id = (
        await tx.business.create({
          data: { slug: firm.slug, name: `Fake Firm ${run}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    });
  } finally {
    await owner.$disconnect();
  }
  await asOwner(async (tx) => {
    const businessId = firm.id;
    await tx.membership.create({
      data: { businessId, userId: people.owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: `Tax ${run}`, status: 'ACTIVE' },
    });
    for (const [key, name] of [
      ['c1', 'Dana Sample (fake)'],
      ['c2', 'Other Sample (fake)'],
    ] as const) {
      const c = await tx.client.create({
        data: { businessId, displayName: name, email: `${key}-${run}@c.test` },
      });
      ids[key] = c.id;
      const e = await tx.engagement.create({
        data: {
          businessId,
          clientId: c.id,
          serviceId: service.id,
          title: `Personal Tax ${key}`,
          taxYear: 2024,
        },
      });
      ids[key === 'c1' ? 'e1' : 'e2'] = e.id;
    }
    for (const [who, clientId, portalRole] of [
      [people.primary, ids.c1, 'PRIMARY'],
      [people.authorized, ids.c1, 'AUTHORIZED'],
      [people.other, ids.c2, 'PRIMARY'],
    ] as const) {
      await tx.clientAccount.create({
        data: {
          businessId,
          userId: who.id,
          clientId: clientId!,
          email: who.email,
          portalRole,
          status: 'ACTIVE',
        },
      });
    }
  });
  await seedPacket('tax', {
    items: [
      { title: 'W-2 forms' },
      { title: 'Bank statements' },
      { title: 'Prior return', required: false },
    ],
  });
  await seedPacket('draft', { items: [{ title: 'Draft item' }], then: 'DRAFT' });
  await seedPacket('cancelled', { items: [{ title: 'Gone' }], then: 'CANCELLED' });
  await seedPacket('done', { items: [{ title: 'Old item', required: false }], then: 'COMPLETED' });
  await seedPacket('late', {
    items: [{ title: 'Late item' }],
    dueOn: dateIn(-10),
    expiresAt: new Date(Date.now() - 5 * DAY),
  });
  await seedPacket('theirs', {
    clientId: ids.c2,
    engagementId: ids.e2,
    items: [{ title: 'Not yours' }],
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
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

describe('who sees which packets', () => {
  it('lists the sent ones, open first; never a draft, a cancelled one or another client’s', async () => {
    const mine = await packets(people.primary);
    expect(mine.map((p) => p.id)).toEqual([ids.late, ids.tax, ids.done]);
    const tax = mine.find((p) => p.id === ids.tax)!;
    expect(tax).toMatchObject({
      reference: expect.stringMatching(/^DR-\d{4}$/),
      status: 'OPEN',
      view: 'NOT_STARTED',
      overdue: false,
      progress: { requiredTotal: 2, requiredAnswered: 0, itemsTotal: 3, itemsAnswered: 0 },
    });
    expect(mine.find((p) => p.id === ids.late)).toMatchObject({ view: 'EXPIRED', overdue: true });
    expectError(
      await portal('get', `/request-packets/${ids.draft}`, people.primary),
      404,
      'NOT_FOUND',
    );
    expectError(
      await portal('get', `/request-packets/${ids.cancelled}`, people.primary),
      404,
      'NOT_FOUND',
    );
    expectError(
      await portal('get', `/request-packets/${ids.theirs}`, people.primary),
      404,
      'NOT_FOUND',
    );
    expect((await packets(people.other)).map((p) => p.id)).toEqual([ids.theirs]);
  });

  it('shows an AUTHORIZED login the open ones only', async () => {
    expect((await packets(people.authorized)).map((p) => p.id)).toEqual([ids.late, ids.tax]);
    expectError(
      await portal('get', `/request-packets/${ids.done}`, people.authorized),
      404,
      'NOT_FOUND',
    );
  });

  it('names the packet on its items in the request list', async () => {
    const list = ok(
      await portal('get', '/document-requests', people.primary),
      MyDocumentRequestList,
    );
    const item = list.items.find((r) => r.id === ids['tax.W-2 forms']);
    expect(item?.packet).toMatchObject({ id: ids.tax, title: 'Fake tax documents' });
    expect(list.items.some((r) => r.id === ids['draft.Draft item'])).toBe(false);
  });
});

describe('Document Request & Upload', () => {
  it('shows the packet with its message, details, items and activity', async () => {
    const p = await packet(ids.tax!);
    expect(p).toMatchObject({
      message: expect.stringMatching(
        /^Hello Dana Sample \(fake\), please upload these by \w+ \d+, \d{4}\.$/,
      ),
      requestedBy: 'Fake owner',
      taxYear: 2024,
      allowMultipleFiles: true,
      canSubmit: false,
    });
    expect(p.items.map((i) => [i.title, i.required, i.canUpload])).toEqual([
      ['W-2 forms', true, true],
      ['Bank statements', true, true],
      ['Prior return', false, true],
    ]);
    expect(p.activity).toEqual([expect.objectContaining({ kind: 'SENT', by: 'FIRM' })]);
  });

  it('refuses Submit until every required item is answered', async () => {
    expectError(
      await portal('post', `/request-packets/${ids.tax}/submit`, people.primary, {}),
      409,
      'PACKET_INCOMPLETE',
    );
  });

  it('takes uploads (another file for an answered item too) and "I don\'t have this"', async () => {
    const w2 = ids['tax.W-2 forms']!;
    ok(await uploadFor(w2), MyDocument);
    ok(await uploadFor(w2, people.primary, 'W-2 corrected.pdf'), MyDocument);
    const bank = ids['tax.Bank statements']!;
    expect(
      (
        await portal('post', `/document-requests/${bank}/not-available`, people.primary, {
          reason: 'Fake: no account',
        })
      ).status,
    ).toBe(200);
    const p = await packet(ids.tax!);
    expect(p).toMatchObject({
      view: 'READY',
      canSubmit: true,
      progress: { requiredTotal: 2, requiredAnswered: 2, itemsTotal: 3, itemsAnswered: 2 },
    });
    expect(p.items[0]?.files.map((f) => f.fileName)).toEqual(['W-2 corrected.pdf', 'W-2.pdf']);
    expect(p.activity.map((e) => e.kind)).toEqual([
      'SENT',
      'UPLOADED',
      'UPLOADED',
      'NOT_AVAILABLE',
    ]);
    // An AUTHORIZED login sees only its own files and can't submit.
    const theirView = await packet(ids.tax!, people.authorized);
    expect(theirView.items[0]?.files).toEqual([]);
    expect(theirView.canSubmit).toBe(false);
    expectError(
      await portal('post', `/request-packets/${ids.tax}/submit`, people.authorized, {}),
      403,
      'FORBIDDEN',
    );
  });

  it('submits once, audited; then the packet takes no more files', async () => {
    const p = ok(
      await portal('post', `/request-packets/${ids.tax}/submit`, people.primary, {}),
      MyRequestPacket,
    );
    expect(p).toMatchObject({ status: 'SUBMITTED', view: 'SUBMITTED', canSubmit: false });
    expect(p.submittedAt).toBeTruthy();
    expect(p.items.every((i) => !i.canUpload)).toBe(true);
    expect(p.activity.at(-1)).toMatchObject({ kind: 'SUBMITTED', by: 'YOU' });
    expectError(
      await portal('post', `/request-packets/${ids.tax}/submit`, people.primary, {}),
      409,
      'PACKET_CLOSED',
    );
    expectError(await uploadFor(ids['tax.Prior return']!), 409, 'REQUEST_CLOSED');
    const audited = await asOwner((tx) =>
      tx.auditLog.count({ where: { action: 'request_packet.submitted', entityId: ids.tax } }),
    );
    expect(audited).toBe(1);
  });

  it('closes an expired packet to uploads and Submit', async () => {
    const p = await packet(ids.late!);
    expect(p).toMatchObject({ view: 'EXPIRED', canSubmit: false });
    expect(p.items[0]?.canUpload).toBe(false);
    expectError(await uploadFor(ids['late.Late item']!), 409, 'REQUEST_CLOSED');
    expectError(
      await portal('post', `/request-packets/${ids.late}/submit`, people.primary, {}),
      409,
      'PACKET_CLOSED',
    );
  });

  it('refuses a bad id and another client’s packet', async () => {
    expectError(
      await portal('get', '/request-packets/not-a-uuid', people.primary),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await portal('post', `/request-packets/${ids.theirs}/submit`, people.primary, {}),
      404,
      'NOT_FOUND',
    );
  });
});
