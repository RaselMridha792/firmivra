// End-to-end: L4 of Octavia's Leads review, the lead email's saved signature and inline images
// (contract in packages/types/src/leads/email.ts) and a formatted Send Email. The HTML is cleaned
// to the composer's rules with this firm's images only; an image is served publicly only for its
// own firm's address and only while its bytes are the image its name says. Each member has their
// own signature, and firm B never reads firm A's.
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
  EmailImage,
  LeadBulkResult,
  LeadProfile,
  MessageSignature,
  UploadPutTicket,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';

const Signature = z.strictObject(MessageSignature.shape);
const Image = z.strictObject(EmailImage.shape);
const Ticket = z.strictObject(UploadPutTicket.shape);
const Result = z.strictObject(LeadBulkResult.shape);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const GIF = Buffer.from('GIF89a synthetic');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

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
  head(key: string) {
    const b = this.objects.get(key);
    return Promise.resolve(b ? { sizeBytes: b.length, sha256: null, contentEncoding: null } : null);
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
  put(ticket: { url: string }, bytes: Buffer) {
    this.objects.set(ticket.url.slice('memory:'.length), bytes);
  }
}
const storage = new MemoryStorage();

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `l4-${key}-${run}@l4.test` });
const people = { ownerA: person('owner-a'), staffA: person('staff-a'), ownerB: person('owner-b') };
const firms = {
  a: { id: '', slug: `l4-a-${run}` },
  b: { id: '', slug: `l4-b-${run}` },
};

let app: INestApplication;
let portal = '';
let tax = '';
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
  who: { email: string },
  body?: object,
  businessId = firms.a.id,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const publicImage = (slug: string, file: string) =>
  request(app.getHttpServer()).get(`/api/v1/portal/${slug}/email-images/${file}`);

/** Uploads `bytes` announced as `contentType` and confirms it. */
async function upload(
  bytes: Buffer,
  contentType = 'image/png',
  announced = bytes,
  who = people.ownerA,
): Promise<Response> {
  const ticket = Ticket.parse(
    ok(
      await call('post', '/leads/messages/images', who, {
        contentType,
        sizeBytes: announced.length,
        sha256: sha(announced),
      }),
      201,
    ),
  );
  storage.put(ticket, bytes);
  return call('post', '/leads/messages/images/confirm', who, { uploadToken: ticket.uploadToken });
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    for (const f of Object.values(firms)) {
      f.id = (
        await tx.business.create({ data: { slug: f.slug, name: 'Firm', status: 'ACTIVE' } })
      ).id;
    }
  });
  await runInScope(owner, { kind: 'business', businessId: firms.a.id }, async (tx) => {
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({
        data: { businessId: firms.a.id, userId, role, status: 'ACTIVE' },
      });
    }
    tax = (
      await tx.service.create({
        data: { businessId: firms.a.id, kind: 'ANNUAL_TAX', name: `Tax ${run}` },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: firms.b.id }, async (tx) => {
    await tx.membership.create({
      data: { businessId: firms.b.id, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
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
  portal = new URL(env.PORTAL_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue({ bucket: 'test', region: 'us-east-1', forcePathStyle: true, scanMode: 'local' })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        outbox.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

const imageOf = (slug: string, id: string, ext = 'png') =>
  `${portal}/api/v1/portal/${slug}/email-images/${id}.${ext}`;

describe('Inline images (POST /business/leads/messages/images, confirm, the public address)', () => {
  it('confirms a PNG and a GIF, serves each at its firm address only', async () => {
    const png = Image.parse(ok(await upload(PNG)));
    expect(png).toMatchObject({ contentType: 'image/png', sizeBytes: PNG.length });
    expect(png.url).toBe(imageOf(firms.a.slug, png.id));
    const got = await publicImage(firms.a.slug, `${png.id}.png`).buffer(true);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['cache-control']).toContain('immutable');
    expect(Buffer.from(got.body as Buffer)).toEqual(PNG);

    const gif = Image.parse(ok(await upload(GIF, 'image/gif')));
    expect(gif.url).toBe(imageOf(firms.a.slug, gif.id, 'gif'));
    expect((await publicImage(firms.a.slug, `${gif.id}.gif`)).status).toBe(200);

    // Another firm's address, another extension, an unknown id, a made-up name: 404.
    expect((await publicImage(firms.b.slug, `${png.id}.png`)).status).toBe(404);
    expect((await publicImage(firms.a.slug, `${png.id}.gif`)).status).toBe(404);
    expect((await publicImage(firms.a.slug, `${randomUUID()}.png`)).status).toBe(404);
    expect((await publicImage(firms.a.slug, 'logo.svg')).status).toBe(404);
    expect((await publicImage(`nope-${run}`, `${png.id}.png`)).status).toBe(404);
  });

  it('refuses other bytes (409, deleted), other types (400) and another member’s ticket (410)', async () => {
    const before = storage.objects.size;
    const svg = await upload(SVG, 'image/png', PNG);
    expect(svg.status).toBe(409);
    expect(codeOf(svg)).toBe('UPLOAD_MISMATCH');
    expect(storage.objects.size).toBe(before);

    const webp = await call('post', '/leads/messages/images', people.ownerA, {
      contentType: 'image/webp',
      sizeBytes: 10,
      sha256: sha(PNG),
    });
    expect(webp.status).toBe(400);
    const big = await call('post', '/leads/messages/images', people.ownerA, {
      contentType: 'image/png',
      sizeBytes: 2 * 1024 * 1024 + 1,
      sha256: sha(PNG),
    });
    expect(big.status).toBe(400);

    const ticket = Ticket.parse(
      ok(
        await call('post', '/leads/messages/images', people.ownerA, {
          contentType: 'image/png',
          sizeBytes: PNG.length,
          sha256: sha(PNG),
        }),
        201,
      ),
    );
    storage.put(ticket, PNG);
    for (const [who, firm] of [
      [people.staffA, firms.a.id],
      [people.ownerB, firms.b.id],
    ] as const) {
      const res = await call(
        'post',
        '/leads/messages/images/confirm',
        who,
        { uploadToken: ticket.uploadToken },
        firm,
      );
      expect(res.status).toBe(410);
      expect(codeOf(res)).toBe('UPLOAD_EXPIRED');
    }
  });
});

describe('Saved signature (GET and PUT /business/me/message-signature)', () => {
  it('saves the member’s own, cleaned to the email’s rules', async () => {
    const none = Signature.parse(ok(await call('get', '/me/message-signature', people.ownerA)));
    expect(none).toEqual({ html: null, updatedAt: null, logoUrl: null });

    const png = Image.parse(ok(await upload(PNG)));
    const saved = Signature.parse(
      ok(
        await call('put', '/me/message-signature', people.ownerA, {
          html:
            '<p><b>Pat Sample</b><script>alert(1)</script> <a href="https://example.test">site</a></p>' +
            '<p><span style="font-family: Georgia, serif; font-size: 18px; color: red">Tax Associate</span></p>' +
            `<p style="text-align:center"><img src="${png.url}" width="900" onerror="x()"></p>` +
            `<p><img src="https://example.test/track.png"><img src="${imageOf(firms.b.slug, png.id)}"></p>`,
        }),
      ),
    );
    expect(saved.html).toContain('<b>Pat Sample</b>');
    expect(saved.html).toContain('site');
    expect(saved.html).toContain('font-family:Georgia, serif');
    expect(saved.html).toContain('font-size:18px');
    expect(saved.html).toContain(`src="${png.url}"`);
    expect(saved.html).toContain('width="600"');
    expect(saved.html).toContain('text-align:center');
    for (const gone of [
      'script',
      'alert',
      '<a',
      'color',
      'onerror',
      'example.test/track',
      firms.b.slug,
    ]) {
      expect(saved.html).not.toContain(gone);
    }
    expect(saved.updatedAt).not.toBeNull();
    expect(Signature.parse(ok(await call('get', '/me/message-signature', people.ownerA)))).toEqual(
      saved,
    );

    // Another member, another firm: their own (none yet).
    expect(
      Signature.parse(ok(await call('get', '/me/message-signature', people.staffA))).html,
    ).toBeNull();
    expect(
      Signature.parse(
        ok(await call('get', '/me/message-signature', people.ownerB, undefined, firms.b.id)),
      ).html,
    ).toBeNull();

    // Replaced, not added.
    const again = Signature.parse(
      ok(await call('put', '/me/message-signature', people.ownerA, { html: '<p>Pat</p>' })),
    );
    expect(again.html).toBe('<p>Pat</p>');
  });

  it('400 SIGNATURE_EMPTY when nothing would show, SIGNATURE_TOO_LONG over 1000 characters', async () => {
    const empty = await call('put', '/me/message-signature', people.staffA, {
      html: '<script>x</script><p> </p>',
    });
    expect(empty.status).toBe(400);
    expect(codeOf(empty)).toBe('SIGNATURE_EMPTY');
    const long = await call('put', '/me/message-signature', people.staffA, {
      html: `<p>${'a'.repeat(1000)}</p>`,
    });
    expect(long.status).toBe(400);
    expect(codeOf(long)).toBe('SIGNATURE_TOO_LONG');
  });
});

describe('Formatted Send Email (POST /business/leads/messages with html)', () => {
  it('sends the cleaned HTML with this firm’s images and the text as given', async () => {
    const lead = LeadProfile.parse(
      ok(
        await call('post', '/leads', people.ownerA, {
          firstName: 'Robin',
          lastName: `Sample${run}`,
          email: `robin-${run}@example.test`,
          source: 'REFERRAL',
          serviceIds: [tax],
        }),
        201,
      ),
    );
    const png = Image.parse(ok(await upload(PNG)));
    outbox.length = 0;
    const sent = Result.parse(
      ok(
        await call('post', '/leads/messages', people.ownerA, {
          ids: [lead.id],
          channel: 'EMAIL',
          subject: 'Welcome',
          body: 'Hello Robin, see below.',
          html:
            '<p><b>Hello</b> <i>Robin</i><script>x()</script></p>' +
            `<p><img src="${png.url}" style="width: 240px"><img src="https://example.test/x.png"></p>`,
        }),
      ),
    );
    expect(sent).toEqual({ changed: 1, skipped: 0 });
    const data = outbox[0]?.data as { body: string; html: string | null };
    expect(data.body).toBe('Hello Robin, see below.');
    expect(data.html).toContain('<b>Hello</b> <i>Robin</i>');
    expect(data.html).toContain(`<img src="${png.url}" alt="" width="240"`);
    expect(data.html).not.toContain('script');
    expect(data.html).not.toContain('example.test/x.png');

    // Nothing left to show: the plain text goes out.
    outbox.length = 0;
    ok(
      await call('post', '/leads/messages', people.ownerA, {
        ids: [lead.id],
        channel: 'EMAIL',
        body: 'Plain',
        html: '<script>x()</script>',
      }),
    );
    expect((outbox[0]?.data as { html: string | null }).html).toBeNull();

    const sms = await call('post', '/leads/messages', people.ownerA, {
      ids: [lead.id],
      channel: 'SMS',
      body: 'Hi',
      html: '<b>Hi</b>',
    });
    expect(sms.status).toBe(400);
  });
});
