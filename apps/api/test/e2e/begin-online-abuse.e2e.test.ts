// End-to-end: abuse of the public Begin Online routes (R11, contract B). Per-IP rate limits per
// route, body and answer size limits, file caps per slot and per draft, the silent per-firm resume
// link limit, the per-firm and per-network daily draft start limits, forged, lapsed and foreign draft
// cookies, unknown and suspended firms, and that no response or audit row holds answers, SSN
// digits, draft cookies or resume tokens. Setup as in begin-online.e2e.test.ts. Synthetic data
// only.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { BeginDraft, INTAKE_LIMITS } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { BEGIN_ONLINE_THROTTLE } from '../../src/begin-online/begin-online.controller.js';
import { DRAFT_START_LIMITS } from '../../src/begin-online/begin-online.service.js';
import { RESUME_LINK_LIMITS } from '../../src/begin-online/resume-links.service.js';
import { beginOnlineCookie, DraftCookies } from '../../src/begin-online/drafts.js';
import { ResumeLinksService } from '../../src/begin-online/resume-links.service.js';
import { configureApp, JSON_BODY_LIMIT_BYTES } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { signatureFor } from '../intake-signing.js';
import { pdf, sha256 } from '../office-files.js';

/** Storage in memory: `put(ticket, bytes)` is the browser's PUT. */
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({ url: `memory:${file.key}`, headers: {} });
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
const outbox: NotifyMessage[] = [];

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
let app: INestApplication;
let portalOrigin = '';
type FirmKey = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';
const firms = {} as Record<FirmKey, { id: string; slug: string }>;
const services = {} as Record<FirmKey, string>;
/** Every draft key a response set: none may show up in a body or an audit row. */
const keysSeen = new Set<string>();
const SSN = '123-45-6789';
const SSN_DIGITS = /123-?45-?6789/;
const MARKER = `zq${run}marker`;

let lastViewer = 0;
/** Each test on its own network: the start and resume limits count a /24 or /48 as one viewer. */
const newViewer = () => `198.${20 + Math.floor(++lastViewer / 250)}.${lastViewer % 250}.1`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const forgedKey = () => randomBytes(32).toString('base64url');
const linksIdle = () => app.get(ResumeLinksService).idle();
const D = '/annual-tax/draft';
const cookieName = (slug: string) => beginOnlineCookie(slug, 'ANNUAL_TAX').name;

async function asOwner<T>(businessId: string | null, work: Parameters<typeof runInScope<T>>[2]) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    const scope = businessId
      ? ({ kind: 'business', businessId } as const)
      : ({ kind: 'platform' } as const);
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

/** A response holds no SSN digits, draft key or marked answer. */
function expectClean(res: Response) {
  const text = JSON.stringify(res.body ?? null) + (res.text ?? '');
  expect(text).not.toMatch(SSN_DIGITS);
  expect(text).not.toContain(MARKER);
  for (const key of keysSeen) expect(text).not.toContain(key);
}

/** A browser on one firm's Begin Online pages: its own IP, cookie jar and the portal's origin. */
function visitor(slug: string, viewer = newViewer()) {
  let cookie = '';
  const name = cookieName(slug);
  const keep = (res: Response) => {
    const raw = res.headers['set-cookie'] as unknown;
    const set = (Array.isArray(raw) ? (raw as string[]) : []).find((c) => c.startsWith(`${name}=`));
    if (set) cookie = set.split(';')[0] ?? '';
    const value = cookie.slice(name.length + 1);
    if (value) keysSeen.add(value);
    return res;
  };
  const send = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    body?: object | string,
  ) => {
    let req = request(app.getHttpServer())
      [method](`/api/v1/portal/${slug}/begin${path}`)
      .set('x-forwarded-for', `${viewer}, 10.0.0.5`)
      .set('cookie', cookie);
    if (method !== 'get') req = req.set('origin', portalOrigin);
    if (typeof body === 'string') req = req.set('content-type', 'application/json');
    return (body === undefined ? req : req.send(body)).then(keep);
  };
  return {
    get: (path: string) => send('get', path),
    post: (path: string, body: object | string) => send('post', path, body),
    put: (path: string, body: object | string) => send('put', path, body),
    del: (path: string) => send('delete', path),
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookie = value;
    },
  };
}

const email = (tag: string) => `abuse.${tag}.${run}@example.com`;
/** A start card (contract B's StartBeginDraftRequest) with `fields` over it. */
const start = (_firm: FirmKey, fields: Record<string, unknown> = {}) => ({
  firstName: 'Avery',
  lastName: 'Sample',
  email: email(`start${++starts}`),
  phone: '(770) 555-0142',
  ...fields,
});
let starts = 0;
/** A well-formed submit body (contract B); these submits never reach the signing. */
const signature = {
  signature: signatureFor(
    { agreementId: randomUUID(), version: 1, bodySha256: 'a'.repeat(64) },
    'Avery Sample',
  ),
};
const file = (bytes: Buffer, slot = 'governmentId', fields: Record<string, unknown> = {}) => ({
  slot,
  fileName: 'id-card.pdf',
  contentType: 'application/pdf',
  sizeBytes: bytes.length,
  sha256: sha256(bytes),
  ...fields,
});

/** Every route that reads the draft cookie, with a body that passes validation. */
const DRAFT_ROUTES: [string, (v: ReturnType<typeof visitor>) => Promise<Response>][] = [
  ['get', (v) => v.get(D)],
  ['uploads', (v) => v.get(`${D}/uploads`)],
  ['save', (v) => v.put(`${D}/steps/personal`, { answers: {} })],
  ['upload', (v) => v.post(`${D}/uploads`, file(pdf()))],
  ['confirm', (v) => v.post(`${D}/uploads/confirm`, { uploadToken: 'x'.repeat(40) })],
  ['delete', (v) => v.del(`${D}/uploads/${randomUUID()}`)],
  ['submit', (v) => v.post(`${D}/submit`, signature)],
];

async function startDraft(firm: FirmKey, fields: Record<string, unknown> = {}) {
  const v = visitor(firms[firm].slug);
  const body = start(firm, fields);
  const res = await v.post(D, body);
  expect(res.status).toBe(201);
  const draft = BeginDraft.parse(res.body);
  const lead = await asOwner(firms[firm].id, (tx) =>
    tx.lead.findFirstOrThrow({ where: { email: body.email.toLowerCase() }, select: { id: true } }),
  );
  return { v, draft: { ...draft, leadId: lead.id }, email: body.email.toLowerCase() };
}

/** The token of the latest resume link emailed to `to`. */
function lastToken(to: string): string {
  const mail = outbox
    .filter((m) => m.template === 'begin-online.resume-link' && m.to === to)
    .at(-1);
  const token = (mail?.data as { link: string } | undefined)?.link.split('#token=')[1];
  if (!token) throw new Error('No resume link was sent');
  keysSeen.add(token);
  return token;
}

/** `count` CLEAN files in `slot`, inserted as confirm would. */
async function addFiles(firm: FirmKey, leadId: string, slot: string, count: number) {
  const businessId = firms[firm].id;
  await asOwner(businessId, async (tx) => {
    for (let i = 0; i < count; i++) {
      const bytes = pdf(`${slot} ${i}`);
      const row = await tx.leadUpload.create({
        data: {
          businessId,
          leadId,
          slot,
          fileName: `${slot}-${i}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: bytes.length,
          sha256: sha256(bytes),
          s3Key: `tenant/${businessId}/leads/${leadId}/${randomUUID()}`,
        },
      });
      await tx.leadUpload.update({
        where: { id: row.id },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
    }
  });
}

const leadsByEmail = (firm: FirmKey | 'suspended', address: string) => {
  const id = firm === 'suspended' ? fx.suspended.id : firms[firm].id;
  return asOwner(id, (tx) => tx.lead.count({ where: { email: address.toLowerCase() } }));
};

beforeAll(async () => {
  process.env['KMS_MODE'] ??= 'local';
  process.env['LOCAL_KMS_KEY'] ??= randomBytes(32).toString('base64');
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
    firms[key] = await asOwner(null, (tx) =>
      tx.business.create({
        data: { slug: `r11-abuse-${key}-${run}`, name: `R11 Abuse ${key}`, status: 'ACTIVE' },
        select: { id: true, slug: true },
      }),
    );
    const businessId = firms[key].id;
    services[key] = await asOwner(businessId, (tx) =>
      tx.service
        .create({ data: { businessId, kind: 'ANNUAL_TAX', name: 'Annual', beginOnline: true } })
        .then((s) => s.id),
    );
  }
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  portalOrigin = new URL(env.PORTAL_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        outbox.push(message);
        return Promise.resolve();
      },
    })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue({ bucket: 'unused', region: 'us-east-1', forcePathStyle: true, scanMode: 'local' })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await linksIdle();
  await app.close();
});

describe('Begin Online rate limits (per IP, per route)', () => {
  const limit = (key: keyof typeof BEGIN_ONLINE_THROTTLE) =>
    BEGIN_ONLINE_THROTTLE[key].default.limit;
  const draftLimit = { save: 'save', submit: 'submit' } as const;
  const routes: [string, number, (v: ReturnType<typeof visitor>) => Promise<Response>][] = [
    ['start', limit('start'), (v) => v.post(D, {})],
    ['resume', limit('resume'), (v) => v.post('/resume', { token: forgedKey() })],
    ['resume-link', limit('resumeLink'), (v) => v.post('/resume-link', { email: email('nobody') })],
    ...DRAFT_ROUTES.filter(([route]) => route !== 'get' && route !== 'uploads').map(
      ([route, call]): (typeof routes)[number] => [
        route,
        limit(draftLimit[route as keyof typeof draftLimit] ?? 'upload'),
        call,
      ],
    ),
  ];

  it.each(routes)(
    '%s: past %i requests a minute from one IP is 429 RATE_LIMITED',
    async (_n, max, call) => {
      const v = visitor(firms.a.slug);
      for (let i = 0; i < max; i++) expect((await call(v)).status).not.toBe(429);
      const over = await call(v);
      expect([over.status, codeOf(over)]).toEqual([429, 'RATE_LIMITED']);
      expect(over.headers['set-cookie']).toBeUndefined();
      // Another IP is not limited.
      expect((await call(visitor(firms.a.slug))).status).not.toBe(429);
    },
  );

  it('counts every attempt, a refused one too, across firms; other routes keep their own count', async () => {
    const viewer = newViewer();
    const a = visitor(firms.a.slug, viewer);
    for (let i = 0; i < limit('start'); i++) {
      expect((await a.post(D, start('a', { email: null }))).status).toBe(400);
    }
    // The counter is the route's, not the firm's: firm B's start from this IP is refused too.
    const b = visitor(firms.b.slug, viewer);
    const refused = await b.post(D, start('b', { email: email('ratelimit') }));
    expect(codeOf(refused)).toBe('RATE_LIMITED');
    expect(await leadsByEmail('b', email('ratelimit'))).toBe(0);
    expect(b.cookie).toBe('');
    expect(codeOf(await a.get(D))).toBe('NOT_FOUND');
    expect(codeOf(await a.put(`${D}/steps/personal`, { answers: {} }))).toBe('NOT_FOUND');
    expect(codeOf(await a.post('/resume', { token: forgedKey() }))).toBe('DRAFT_EXPIRED');
  });

  it('a made-up left-hand X-Forwarded-For address does not reset the count', async () => {
    const viewer = newViewer();
    const codes: number[] = [];
    for (let i = 0; i <= limit('submit'); i++) {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/portal/${firms.a.slug}/begin${D}/submit`)
        .set('x-forwarded-for', `203.0.113.${i}, ${viewer}, 10.0.0.5`)
        .set('origin', portalOrigin)
        .send(signature);
      codes.push(res.status);
    }
    expect(codes).toEqual([...Array<number>(limit('submit')).fill(404), 429]);
  });
});

describe('Begin Online size limits', () => {
  const long = (n: number) => MARKER + 'x'.repeat(n - MARKER.length);
  const tooManyAnswers = () =>
    Object.fromEntries(
      Array.from({ length: INTAKE_LIMITS.maxAnswers + 1 }, (_, i) => [`k${i}`, MARKER]),
    );
  const rows = (n: number, keys = 1) =>
    Array.from({ length: n }, (_, i) => ({
      id: `row-${i}`,
      ...Object.fromEntries(Array.from({ length: keys }, (_, k) => [`f${k}`, 'x'])),
    }));
  /** Answers that a start or a save must refuse, and how. */
  const refused: [string, Record<string, unknown>, number][] = [
    ['a name over its maxLength (100)', { firstName: long(101) }, 400],
    ['a text over INTAKE_LIMITS.maxText', { street: long(INTAKE_LIMITS.maxText + 1) }, 400],
    ['more than maxAnswers answers', tooManyAnswers(), 400],
    ['a group over maxRows', { dependents: rows(INTAKE_LIMITS.maxRows + 1) }, 400],
    ['a group row over maxRowKeys', { dependents: rows(1, INTAKE_LIMITS.maxRowKeys) }, 400],
    ['a body over the JSON limit', { notes: [long(9_000)], ...bigBody() }, 413],
  ];
  /** Just over the API's one JSON body limit (JSON_BODY_LIMIT_BYTES). */
  function bigBody() {
    const length = Math.ceil(JSON_BODY_LIMIT_BYTES / 9_999) + 1;
    return Object.fromEntries(Array.from({ length }, (_, i) => [`big${i}`, long(9_999)]));
  }

  /** A start card has only its own fields (a strict object): the cases that are start fields. */
  const startRefused = refused.filter(
    ([, answers]) => 'firstName' in answers || 'notes' in answers,
  );

  it.each(startRefused)('start: %s is refused and stores nothing', async (_n, answers, status) => {
    const v = visitor(firms.a.slug);
    const address = email(`size${status}${Object.keys(answers).length}`);
    const res = await v.post(D, start('a', { email: address, ...answers }));
    expect(res.status).toBe(status);
    expect(codeOf(res)).toBe(status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED');
    if (status === 400) {
      // Refused by the field's own limit, not as an unknown key.
      const details = (res.body as { error: { details: { path: string }[] } }).error.details;
      expect(details.map((d) => d.path)).toEqual(['firstName']);
    }
    expectClean(res);
    expect(v.cookie).toBe('');
    expect(await leadsByEmail('a', address)).toBe(0);
  });

  it('start: unknown fields (a businessId), a __proto__ key and broken JSON are 400', async () => {
    const address = email('strict');
    const bodies: [object | string, string][] = [
      [{ ...start('a', { email: address }), businessId: firms.b.id }, 'VALIDATION_FAILED'],
      [{ ...start('a', { email: address }), answers: { ssn: SSN } }, 'VALIDATION_FAILED'],
      [
        JSON.stringify(start('a', { email: address })).replace('{', '{"__proto__":{"x":1},'),
        'VALIDATION_FAILED',
      ],
      ['{"firstName":', 'BAD_REQUEST'],
    ];
    for (const [body, code] of bodies) {
      const res = await visitor(firms.a.slug).post(D, body);
      expect([res.status, codeOf(res)]).toEqual([400, code]);
      expectClean(res);
    }
    expect(await leadsByEmail('a', address)).toBe(0);
    expect(await leadsByEmail('b', address)).toBe(0);
  });

  it('save: the same answers are refused and the stored draft is left as it was', async () => {
    const { v, draft } = await startDraft('a');
    const before = await asOwner(firms.a.id, (tx) =>
      tx.intakeSubmission.findFirstOrThrow({ where: { intake: { leadId: draft.leadId } } }),
    );
    for (const [, answers, status] of refused) {
      const res = await v.put(`${D}/steps/personal`, { answers: { ssn: SSN, ...answers } });
      expect(res.status).toBe(status);
      expectClean(res);
    }
    const [after, saves] = await asOwner(firms.a.id, (tx) =>
      Promise.all([
        tx.intakeSubmission.findFirstOrThrow({ where: { intake: { leadId: draft.leadId } } }),
        tx.auditLog.count({ where: { entityId: draft.leadId, action: 'begin_online.step_saved' } }),
      ]),
    );
    expect(after.answers).toEqual(before.answers);
    expect(after.savedSteps).toEqual(before.savedSteps);
    expect(saves).toBe(0);
    expect((await v.get(D)).status).toBe(200);
  });
});

describe('Begin Online caps', () => {
  it('a slot takes at most its maxFiles (20), at the ticket and again at confirm', async () => {
    const { v, draft } = await startDraft('a');
    await addFiles('a', draft.leadId, 'governmentId', INTAKE_LIMITS.maxFilesPerSlot - 1);
    const bytes = pdf('the last one');
    const ticket = await v.post(`${D}/uploads`, file(bytes));
    expect(ticket.status).toBe(200);
    // Meanwhile the slot fills up (another tab).
    await addFiles('a', draft.leadId, 'governmentId', 1);
    const full = await v.post(`${D}/uploads`, file(bytes));
    expect([full.status, codeOf(full)]).toEqual([409, 'TOO_MANY_FILES']);

    storage.put(ticket.body as { url: string }, bytes);
    const key = (ticket.body as { url: string }).url.slice('memory:'.length);
    const confirm = await v.post(`${D}/uploads/confirm`, {
      uploadToken: ticket.body.uploadToken,
    });
    expect([confirm.status, codeOf(confirm)]).toEqual([409, 'TOO_MANY_FILES']);
    expect(storage.objects.has(key)).toBe(false);
    const [files, refusedRows] = await asOwner(firms.a.id, (tx) =>
      Promise.all([
        tx.leadUpload.count({ where: { leadId: draft.leadId, slot: 'governmentId' } }),
        tx.auditLog.findMany({
          where: { entityId: draft.leadId, action: 'begin_online.upload_refused' },
        }),
      ]),
    );
    expect(files).toBe(INTAKE_LIMITS.maxFilesPerSlot);
    expect(refusedRows.map((r) => (r.metadata as { code: string }).code)).toEqual([
      'TOO_MANY_FILES',
    ]);
    // The cap is per slot: another slot still takes a file.
    expect((await v.post(`${D}/uploads`, file(bytes, 'socialSecurityCard'))).status).toBe(200);
  });

  it('a draft takes at most maxFiles (50) across its slots', async () => {
    const { v, draft } = await startDraft('a');
    await addFiles('a', draft.leadId, 'governmentId', 20);
    await addFiles('a', draft.leadId, 'socialSecurityCard', 20);
    await addFiles('a', draft.leadId, 'incomeDocuments', INTAKE_LIMITS.maxFiles - 40);
    const res = await v.post(`${D}/uploads`, file(pdf(), 'deductionDocuments'));
    expect([res.status, codeOf(res)]).toEqual([409, 'TOO_MANY_FILES']);
  });

  it('tickets never confirmed count toward the slot (25 asked, 20 given) and go at expiry', async () => {
    const { v, draft } = await startDraft('a');
    const bytes = pdf('never confirmed');
    const statuses: number[] = [];
    const keys: string[] = [];
    // From two networks of this browser (the upload limit is 30 a minute per IP).
    const other = visitor(firms.a.slug);
    other.cookie = v.cookie;
    for (let i = 0; i < 25; i++) {
      const res = await (i < 13 ? v : other).post(`${D}/uploads`, file(bytes));
      statuses.push(res.status);
      if (res.status !== 200) continue;
      storage.put(res.body as { url: string }, bytes);
      keys.push((res.body as { url: string }).url.slice('memory:'.length));
    }
    const max = INTAKE_LIMITS.maxFilesPerSlot;
    expect(statuses).toEqual([
      ...Array<number>(max).fill(200),
      ...Array<number>(25 - max).fill(409),
    ]);
    expect(keys.every((k) => storage.objects.has(k))).toBe(true);
    await asOwner(
      firms.a.id,
      (tx) =>
        tx.$executeRaw`UPDATE leads SET draft_expires_at = now() - interval '1 minute'
                    WHERE id = ${draft.leadId}::uuid`,
    );
    expect(codeOf(await v.get(D))).toBe('DRAFT_EXPIRED');
    expect(keys.filter((k) => storage.objects.has(k))).toEqual([]);
  });

  it('a confirm refused because the draft ended or was replaced deletes its object', async () => {
    const keyOf = (res: Response) => (res.body as { url: string }).url.slice('memory:'.length);
    const bytes = pdf('refused confirm');
    // Replaced: a new start in this browser (410 UPLOAD_EXPIRED).
    const replaced = await startDraft('a');
    const t1 = await replaced.v.post(`${D}/uploads`, file(bytes));
    storage.put(t1.body as { url: string }, bytes);
    expect((await replaced.v.post(D, start('a'))).status).toBe(201);
    const r1 = await replaced.v.post(`${D}/uploads/confirm`, { uploadToken: t1.body.uploadToken });
    expect([r1.status, codeOf(r1)]).toEqual([410, 'UPLOAD_EXPIRED']);
    expect(storage.objects.has(keyOf(t1))).toBe(false);
    // Expired: the PUT lands after the expiry (410 DRAFT_EXPIRED).
    const expired = await startDraft('a');
    const t2 = await expired.v.post(`${D}/uploads`, file(bytes));
    await asOwner(
      firms.a.id,
      (tx) =>
        tx.$executeRaw`UPDATE leads SET draft_expires_at = now() - interval '1 minute'
                    WHERE id = ${expired.draft.leadId}::uuid`,
    );
    expect(codeOf(await expired.v.get(D))).toBe('DRAFT_EXPIRED');
    storage.put(t2.body as { url: string }, bytes);
    const r2 = await expired.v.post(`${D}/uploads/confirm`, { uploadToken: t2.body.uploadToken });
    expect([r2.status, codeOf(r2)]).toEqual([410, 'DRAFT_EXPIRED']);
    expect(storage.objects.has(keyOf(t2))).toBe(false);
    // A refused key stays refused: the token never confirms after that.
    storage.put(t2.body as { url: string }, bytes);
    const again = await expired.v.post(`${D}/uploads/confirm`, {
      uploadToken: t2.body.uploadToken,
    });
    expect(again.status).toBe(410);
  });

  it('parallel confirms at maxFiles - 1: one file is kept, the other is 409 and deleted', async () => {
    const { v, draft } = await startDraft('a');
    const max = INTAKE_LIMITS.maxFilesPerSlot;
    await addFiles('a', draft.leadId, 'governmentId', max - 2);
    const tickets = [];
    for (const name of ['one', 'two']) {
      const ticket = await v.post(`${D}/uploads`, file(pdf(name)));
      expect(ticket.status).toBe(200);
      storage.put(ticket.body as { url: string }, pdf(name));
      tickets.push(ticket);
    }
    // Another tab fills one place meanwhile: the slot is at maxFiles - 1.
    await addFiles('a', draft.leadId, 'governmentId', 1);
    const results = await Promise.all(
      tickets.map((t) => v.post(`${D}/uploads/confirm`, { uploadToken: t.body.uploadToken })),
    );
    expect(results.map((r) => [r.status, codeOf(r) ?? null]).sort()).toEqual([
      [200, null],
      [409, 'TOO_MANY_FILES'],
    ]);
    const loser = tickets[results.findIndex((r) => r.status === 409)]!;
    expect(storage.objects.has((loser.body as { url: string }).url.slice('memory:'.length))).toBe(
      false,
    );
    const files = await asOwner(firms.a.id, (tx) =>
      tx.leadUpload.count({ where: { leadId: draft.leadId, slot: 'governmentId' } }),
    );
    expect(files).toBe(max);
  });

  it('a ticket refuses an empty, negative, fractional or over 10 MB size (400)', async () => {
    const { v } = await startDraft('a');
    for (const sizeBytes of [0, -1, 1.5, 10 * 1024 * 1024 + 1]) {
      const res = await v.post(`${D}/uploads`, file(pdf(), 'governmentId', { sizeBytes }));
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it(`resume links: at most ${RESUME_LINK_LIMITS.perFirm} a day per firm, then silently none`, async () => {
    const businessId = firms.c.id;
    const sent = (createdAt: Date) => ({
      businessId,
      action: 'begin_online.resume_link_sent',
      entityType: 'lead',
      entityId: randomUUID(),
      metadata: {},
      createdAt,
    });
    await asOwner(businessId, (tx) =>
      tx.auditLog.createMany({
        data: [
          ...Array.from({ length: RESUME_LINK_LIMITS.perFirm - 1 }, () => sent(new Date())),
          sent(new Date(Date.now() - RESUME_LINK_LIMITS.firmWindowMs - 60_000)),
        ],
      }),
    );
    const first = await startDraft('c');
    const mails = outbox.length;
    const ok = await first.v.post('/resume-link', { email: first.email });
    expect([ok.status, ok.body]).toEqual([200, { received: true }]);
    await linksIdle();
    expect(outbox.length).toBe(mails + 1);

    const second = await startDraft('c');
    const res = await second.v.post('/resume-link', { email: second.email });
    // The same answer, and nothing is sent or changed.
    expect([res.status, res.body]).toEqual([200, { received: true }]);
    await linksIdle();
    expect(outbox.length).toBe(mails + 1);
    const lead = await asOwner(businessId, (tx) =>
      tx.lead.findUniqueOrThrow({ where: { id: second.draft.leadId } }),
    );
    expect(lead.resumeTokenHash).toBeNull();
    expect((await second.v.get(D)).status).toBe(200);
  });
});

describe('Begin Online daily start limits (audit log, rolling 24 h)', () => {
  const { perFirm, perNetwork, windowMs } = DRAFT_START_LIMITS;
  /**
   * `count` start rows in the window from `ip` (its network `net`, as a start records it) and one
   * older than the window that never counts.
   */
  const seedStarts = (firm: FirmKey, count: number, ip: string | null, net?: string) => {
    const businessId = firms[firm].id;
    const row = (createdAt: Date) => ({
      businessId,
      action: 'begin_online.draft_started',
      entityType: 'lead',
      entityId: randomUUID(),
      metadata: net ? { net } : {},
      ip,
      createdAt,
    });
    // The oldest counted row leaves the window in about an hour.
    const oldest = new Date(Date.now() - windowMs + 3_600_000);
    return asOwner(businessId, (tx) =>
      tx.auditLog.createMany({
        data: [
          row(oldest),
          ...Array.from({ length: count - 1 }, () => row(new Date())),
          row(new Date(Date.now() - windowMs - 60_000)),
        ],
      }),
    );
  };
  const expectRefused = async (firm: FirmKey, viewer: string, tag: string) => {
    const v = visitor(firms[firm].slug, viewer);
    const res = await v.post(D, start(firm, { email: email(tag) }));
    expect([res.status, codeOf(res)]).toEqual([429, 'RATE_LIMITED']);
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(3_500);
    expect(retryAfter).toBeLessThanOrEqual(3_600);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await leadsByEmail(firm, email(tag))).toBe(0);
  };

  it(`at most ${perFirm} a day per firm, from any IP; rows older than 24 h do not count`, async () => {
    await seedStarts('e', perFirm - 1, null);
    // One more fits (the old row is not counted); the next, from another IP, does not.
    const v = visitor(firms.e.slug);
    expect((await v.post(D, start('e'))).status).toBe(201);
    await expectRefused('e', newViewer(), 'firmcap');
    // Another firm is not limited.
    expect((await visitor(firms.f.slug).post(D, start('f'))).status).toBe(201);
  });

  it(`at most ${perNetwork} a day per network on a firm's site; another network still starts`, async () => {
    // Two addresses of one /24 are one viewer; the rows were seeded from a third.
    await seedStarts('f', perNetwork - 1, '192.0.2.7', '192.0.2.0/24');
    const v = visitor(firms.f.slug, '192.0.2.20');
    expect((await v.post(D, start('f'))).status).toBe(201);
    const stored = await asOwner(firms.f.id, (tx) =>
      tx.auditLog.count({
        where: {
          businessId: firms.f.id,
          action: 'begin_online.draft_started',
          metadata: { path: ['net'], equals: '192.0.2.0/24' },
        },
      }),
    );
    expect(stored).toBe(perNetwork + 1); // the start row records the viewer's network
    await expectRefused('f', '192.0.2.30', 'netcap');
    // Not the address: an IPv6 /48 is one network too, and a new network still starts.
    await seedStarts('f', perNetwork, '2001:db8:9:1::1', '2001:0db8:0009::/48');
    await expectRefused('f', '2001:db8:9:2::1', 'netcap6');
    expect((await visitor(firms.f.slug).post(D, start('f'))).status).toBe(201);
  });
});

describe('Begin Online draft cookies', () => {
  const name = () => cookieName(firms.a.slug);

  it('forged, tampered and malformed cookies are 404 NOT_FOUND on every route, never 500', async () => {
    const { v, draft } = await startDraft('a');
    const real = v.cookie.slice(name().length + 1);
    const flipped = real.slice(0, 20) + (real[20] === 'A' ? 'B' : 'A') + real.slice(21);
    const values = [
      forgedKey(),
      flipped,
      real.slice(0, -1),
      real + 'A',
      'A'.repeat(4000),
      '!'.repeat(43),
      'j:%7B%22a%22%3A1%7D', // cookie-parser reads j: values as JSON
      '%E0%A4%A',
      '',
    ];
    for (const value of values) {
      const forged = visitor(firms.a.slug);
      forged.cookie = `${name()}=${value}`;
      for (const [route, call] of DRAFT_ROUTES) {
        const res = await call(forged);
        expect([route, res.status, codeOf(res)]).toEqual([route, 404, 'NOT_FOUND']);
        expectClean(res);
      }
    }
    const lead = await asOwner(firms.a.id, (tx) =>
      tx.lead.findUniqueOrThrow({ where: { id: draft.leadId } }),
    );
    expect(lead.status).toBe('DRAFT');
    expect((await v.get(D)).status).toBe(200);
  });

  it("firm A's cookie on firm B's site, or on another service, is 404 on every route", async () => {
    const { v, draft } = await startDraft('a');
    await startDraft('b');
    const ticket = await v.post(`${D}/uploads`, file(pdf()));
    expect(ticket.status).toBe(200);
    const value = v.cookie.slice(name().length + 1);
    const renamed = visitor(firms.b.slug);
    renamed.cookie = `${cookieName(firms.b.slug)}=${value}`;
    const asIs = visitor(firms.b.slug);
    asIs.cookie = v.cookie; // A's cookie name on B's path: B's name is not there
    for (const b of [renamed, asIs]) {
      for (const [route, call] of DRAFT_ROUTES) {
        const res = await call(b);
        expect([route, res.status, codeOf(res)]).toEqual([route, 404, 'NOT_FOUND']);
      }
    }
    const payroll = visitor(firms.a.slug);
    payroll.cookie = `${beginOnlineCookie(firms.a.slug, 'PAYROLL').name}=${value}`;
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/${firms.a.slug}/begin/payroll/draft`)
      .set('cookie', payroll.cookie);
    expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    // A's upload ticket confirmed with a draft of firm B.
    const own = await startDraft('b');
    storage.put(ticket.body as { url: string }, pdf());
    const cross = await own.v.post(`${D}/uploads/confirm`, {
      uploadToken: ticket.body.uploadToken,
    });
    expect([cross.status, codeOf(cross)]).toEqual([410, 'UPLOAD_EXPIRED']);
    const [lead, audits] = await asOwner(firms.a.id, (tx) =>
      Promise.all([
        tx.lead.findUniqueOrThrow({ where: { id: draft.leadId } }),
        tx.auditLog.findMany({ where: { entityId: draft.leadId }, select: { action: true } }),
      ]),
    );
    expect(lead.status).toBe('DRAFT');
    expect(audits.map((a) => a.action).sort()).toEqual([
      'begin_online.draft_started',
      'begin_online.upload_started',
    ]);
  });

  it('an expired draft is 410 DRAFT_EXPIRED on every route; a lapsed cookie is 404', async () => {
    const expired = await startDraft('a');
    await asOwner(
      firms.a.id,
      (tx) =>
        tx.$executeRaw`UPDATE leads SET draft_expires_at = now() - interval '1 minute'
                      WHERE id = ${expired.draft.leadId}::uuid`,
    );
    for (const [route, call] of DRAFT_ROUTES) {
      const res = await call(expired.v);
      expect([route, res.status, codeOf(res)]).toEqual([route, 410, 'DRAFT_EXPIRED']);
    }
    // A cookie past its own expiry (a few hours) for a live draft opens nothing.
    const live = await startDraft('a');
    const lapsed = visitor(firms.a.slug);
    const value = await app
      .get(DraftCookies)
      .sealUntil(
        { pool: 'CLIENT', businessId: firms.a.id, leadId: live.draft.leadId, form: 'ANNUAL_TAX' },
        Math.floor(Date.now() / 1000) - 60,
      );
    lapsed.cookie = `${name()}=${value}`;
    for (const [route, call] of DRAFT_ROUTES) {
      const res = await call(lapsed);
      expect([route, res.status, codeOf(res)]).toEqual([route, 404, 'NOT_FOUND']);
    }
    expect((await live.v.get(D)).status).toBe(200);
  });
});

describe('Begin Online on unknown and suspended firms', () => {
  it('every route is 404 NOT_FOUND, sets no cookie and creates no draft', async () => {
    const address = email('nofirm');
    const slugs = [
      fx.suspended.slug,
      `no-such-firm-${run}`,
      'a'.repeat(64),
      encodeURIComponent('../a'),
    ];
    for (const slug of slugs) {
      const v = visitor(slug);
      v.cookie = `${cookieName(firms.a.slug)}=${forgedKey()}`;
      const calls: [string, () => Promise<Response>][] = [
        ['forms', () => v.get('/forms')],
        ['form', () => v.get('/forms/annual-tax')],
        ['start', () => v.post(D, start('a', { email: address }))],
        ['resume', () => v.post('/resume', { token: forgedKey() })],
        ['resume-link', () => v.post('/resume-link', { email: address })],
        ...DRAFT_ROUTES.map(
          ([route, call]) => [route, () => call(v)] as [string, () => Promise<Response>],
        ),
      ];
      for (const [route, call] of calls) {
        const res = await call();
        expect([slug, route, res.status, codeOf(res)]).toEqual([slug, route, 404, 'NOT_FOUND']);
        expect(res.headers['set-cookie']).toBeUndefined();
      }
    }
    expect(await leadsByEmail('suspended', address)).toBe(0);
    expect(await leadsByEmail('a', address)).toBe(0);
  });

  it('a firm suspended mid-draft: its draft cookie and resume link open nothing', async () => {
    const { v, draft, email: address } = await startDraft('d');
    expect((await v.post('/resume-link', { email: address })).status).toBe(200);
    await linksIdle();
    const token = lastToken(address);
    await asOwner(null, (tx) =>
      tx.business.update({ where: { id: firms.d.id }, data: { status: 'SUSPENDED' } }),
    );
    for (const [route, call] of DRAFT_ROUTES) {
      const res = await call(v);
      expect([route, res.status, codeOf(res)]).toEqual([route, 404, 'NOT_FOUND']);
    }
    const resume = await visitor(firms.d.slug).post('/resume', { token });
    expect([resume.status, codeOf(resume)]).toEqual([404, 'NOT_FOUND']);
    const actions = await asOwner(firms.d.id, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: draft.leadId },
        select: { action: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(actions.map((a) => a.action)).toEqual([
      'begin_online.draft_started',
      'begin_online.resume_link_sent',
    ]);
  });
});

describe('Begin Online keeps secrets out', () => {
  it('no audit row of these firms holds answers, SSN digits, emails or draft keys', async () => {
    // The visitor's own answers come back to its own draft (SSNs masked); never into the audit.
    const answer = `street${run}`;
    const { v, email: address } = await startDraft('a');
    const saved = await v.put(`${D}/steps/personal`, { answers: { ssn: SSN, street: answer } });
    expect(saved.status).toBe(200);
    expectClean(saved);
    const read = await v.get(D);
    expect(BeginDraft.parse(read.body).answers).toMatchObject({ ssn: { last4: '6789' } });
    expect(JSON.stringify(read.body)).not.toMatch(SSN_DIGITS);
    expectClean(await v.post('/resume-link', { email: address }));
    await linksIdle();
    lastToken(address);
    const ids = Object.values(firms).map((f) => f.id);
    const rows = await Promise.all(
      ids.map((id) => asOwner(id, (tx) => tx.auditLog.findMany({ where: { businessId: id } }))),
    );
    const text = JSON.stringify(rows.flat());
    expect(rows.flat().length).toBeGreaterThan(20);
    expect(text).not.toMatch(SSN_DIGITS);
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain(answer);
    expect(text).not.toMatch(/example\.com|Avery|5550142/i);
    expect(keysSeen.size).toBeGreaterThan(10);
    for (const key of keysSeen) expect(text).not.toContain(key);
  });
});
