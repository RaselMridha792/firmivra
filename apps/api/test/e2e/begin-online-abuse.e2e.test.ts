// End-to-end: abuse of the public Begin Online routes (R11). Per-IP rate limits per route, body and
// answer size limits, file caps per slot and per draft, the per-firm resume link limit, the per-firm
// and per-IP daily draft start limits, forged and
// foreign draft cookies, unknown and suspended firms, and that no response or audit row holds
// answers, SSN digits or draft keys. Setup as in begin-online.e2e.test.ts. Synthetic data only.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { BeginDraft, beginOnlineCookie, INTAKE_LIMITS } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { BEGIN_ONLINE_THROTTLE } from '../../src/begin-online/begin-online.controller.js';
import { DRAFT_START_LIMITS } from '../../src/begin-online/begin-online.service.js';
import { RESUME_LINK_LIMITS } from '../../src/begin-online/resume-links.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
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
const newViewer = () => `198.20.${Math.floor(++lastViewer / 250)}.${lastViewer % 250}`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const forgedKey = () => randomBytes(32).toString('base64url');

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
  const name = beginOnlineCookie(slug).name;
  const keep = (res: Response) => {
    const raw = res.headers['set-cookie'] as unknown;
    const set = (Array.isArray(raw) ? (raw as string[]) : []).find((c) => c.startsWith(`${name}=`));
    if (set) cookie = set.split(';')[0] ?? '';
    const value = cookie.split('=')[1];
    if (value) keysSeen.add(value);
    return res;
  };
  const send = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    body?: object | string,
  ) => {
    let req = request(app.getHttpServer())
      [method](`/api/v1/portal/${slug}/begin-online${path}`)
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
const start = (firm: FirmKey, answers: Record<string, unknown> = {}) => ({
  serviceId: services[firm],
  step: 'personal',
  answers: {
    firstName: 'Avery',
    lastName: 'Sample',
    email: email('start'),
    phone: '(770) 555-0142',
    ssn: SSN,
    ...answers,
  },
});
const signature = { printedName: 'Avery Sample', typedSignature: 'Avery Sample' };
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
  ['current', (v) => v.get('/drafts/current')],
  ['save', (v) => v.put('/drafts/current/steps/personal', { answers: {} })],
  ['resume-link', (v) => v.post('/drafts/current/resume-link', {})],
  ['upload', (v) => v.post('/drafts/current/uploads', file(pdf()))],
  ['confirm', (v) => v.post('/drafts/current/uploads/confirm', { uploadToken: 'x'.repeat(40) })],
  ['delete', (v) => v.del(`/drafts/current/uploads/${randomUUID()}`)],
  ['submit', (v) => v.post('/drafts/current/submit', signature)],
];

async function startDraft(firm: FirmKey, answers: Record<string, unknown> = {}) {
  const v = visitor(firms[firm].slug);
  const res = await v.post('/drafts', start(firm, answers));
  expect(res.status).toBe(201);
  return { v, draft: BeginDraft.parse(res.body) };
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
  await app.close();
});

describe('Begin Online rate limits (per IP, per route)', () => {
  const limit = (key: keyof typeof BEGIN_ONLINE_THROTTLE) =>
    BEGIN_ONLINE_THROTTLE[key].default.limit;
  const draftLimit = { save: 'save', 'resume-link': 'resumeLink', submit: 'submit' } as const;
  const routes: [string, number, (v: ReturnType<typeof visitor>) => Promise<Response>][] = [
    ['start', limit('start'), (v) => v.post('/drafts', {})],
    ['resume', limit('resume'), (v) => v.post('/drafts/resume', { token: forgedKey() })],
    ...DRAFT_ROUTES.filter(([route]) => route !== 'current').map(
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
      expect((await a.post('/drafts', start('a', { email: null }))).status).toBe(400);
    }
    // The counter is the route's, not the firm's: firm B's start from this IP is refused too.
    const b = visitor(firms.b.slug, viewer);
    const refused = await b.post('/drafts', start('b', { email: email('ratelimit') }));
    expect(codeOf(refused)).toBe('RATE_LIMITED');
    expect(await leadsByEmail('b', email('ratelimit'))).toBe(0);
    expect(b.cookie).toBe('');
    expect(codeOf(await a.get('/drafts/current'))).toBe('DRAFT_NOT_FOUND');
    expect(codeOf(await a.put('/drafts/current/steps/personal', { answers: {} }))).toBe(
      'DRAFT_NOT_FOUND',
    );
    expect(codeOf(await a.post('/drafts/resume', { token: forgedKey() }))).toBe(
      'RESUME_LINK_EXPIRED',
    );
  });

  it('a made-up left-hand X-Forwarded-For address does not reset the count', async () => {
    const viewer = newViewer();
    const codes: number[] = [];
    for (let i = 0; i <= limit('submit'); i++) {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/portal/${firms.a.slug}/begin-online/drafts/current/submit`)
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
    ['a body over the JSON limit (100 kB)', { notes: [long(9_000)], ...bigBody() }, 413],
  ];
  function bigBody() {
    return Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`big${i}`, long(9_999)]));
  }

  it.each(refused)('start: %s is refused and stores nothing', async (_n, answers, status) => {
    const v = visitor(firms.a.slug);
    const address = email(`size${status}${Object.keys(answers).length}`);
    const res = await v.post('/drafts', start('a', { email: address, ...answers }));
    expect(res.status).toBe(status);
    expect(codeOf(res)).toBe(status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED');
    expectClean(res);
    expect(v.cookie).toBe('');
    expect(await leadsByEmail('a', address)).toBe(0);
  });

  it('start: unknown fields (a businessId), a __proto__ key and broken JSON are 400', async () => {
    const address = email('strict');
    const bodies: [object | string, string][] = [
      [{ ...start('a', { email: address }), businessId: firms.b.id }, 'VALIDATION_FAILED'],
      [
        JSON.stringify(start('a', { email: address })).replace(
          '"answers":{',
          '"answers":{"__proto__":{"x":1},',
        ),
        'VALIDATION_FAILED',
      ],
      ['{"serviceId":', 'BAD_REQUEST'],
    ];
    for (const [body, code] of bodies) {
      const res = await visitor(firms.a.slug).post('/drafts', body);
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
      const res = await v.put('/drafts/current/steps/personal', {
        answers: { ...start('a').answers, ssn: { last4: '6789' }, ...answers },
      });
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
    expect((await v.get('/drafts/current')).status).toBe(200);
  });
});

describe('Begin Online caps', () => {
  it('a slot takes at most its maxFiles (20), at the ticket and again at confirm', async () => {
    const { v, draft } = await startDraft('a');
    await addFiles('a', draft.leadId, 'governmentId', INTAKE_LIMITS.maxFilesPerSlot - 1);
    const bytes = pdf('the last one');
    const ticket = await v.post('/drafts/current/uploads', file(bytes));
    expect(ticket.status).toBe(200);
    // Meanwhile the slot fills up (another tab).
    await addFiles('a', draft.leadId, 'governmentId', 1);
    const full = await v.post('/drafts/current/uploads', file(bytes));
    expect([full.status, codeOf(full)]).toEqual([409, 'TOO_MANY_FILES']);

    storage.put(ticket.body as { url: string }, bytes);
    const key = (ticket.body as { url: string }).url.slice('memory:'.length);
    const confirm = await v.post('/drafts/current/uploads/confirm', {
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
    expect(
      (await v.post('/drafts/current/uploads', file(bytes, 'socialSecurityCard'))).status,
    ).toBe(200);
  });

  it('a draft takes at most maxFiles (50) across its slots', async () => {
    const { v, draft } = await startDraft('a');
    await addFiles('a', draft.leadId, 'governmentId', 20);
    await addFiles('a', draft.leadId, 'socialSecurityCard', 20);
    await addFiles('a', draft.leadId, 'incomeDocuments', INTAKE_LIMITS.maxFiles - 40);
    const res = await v.post('/drafts/current/uploads', file(pdf(), 'deductionDocuments'));
    expect([res.status, codeOf(res)]).toEqual([409, 'TOO_MANY_FILES']);
  });

  it('a ticket refuses an empty, negative, fractional or over 10 MB size (400)', async () => {
    const { v } = await startDraft('a');
    for (const sizeBytes of [0, -1, 1.5, 10 * 1024 * 1024 + 1]) {
      const res = await v.post(
        '/drafts/current/uploads',
        file(pdf(), 'governmentId', { sizeBytes }),
      );
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it(`resume links: at most ${RESUME_LINK_LIMITS.perFirm} a day per firm; a refused send keeps the key`, async () => {
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
          sent(new Date(Date.now() - RESUME_LINK_LIMITS.windowMs - 60_000)),
        ],
      }),
    );
    const first = await startDraft('c');
    expect((await first.v.post('/drafts/current/resume-link', {})).status).toBe(200);

    const second = await startDraft('c');
    const cookie = second.v.cookie;
    const mails = outbox.length;
    const res = await second.v.post('/drafts/current/resume-link', {});
    expect([res.status, codeOf(res)]).toEqual([429, 'RATE_LIMITED']);
    expect(second.v.cookie).toBe(cookie);
    expect(outbox.length).toBe(mails);
    expect((await second.v.get('/drafts/current')).status).toBe(200);
  });
});

describe('Begin Online daily start limits (audit log, rolling 24 h)', () => {
  const { perFirm, perIp, windowMs } = DRAFT_START_LIMITS;
  /** `count` start rows in the window from `ip` and one older than the window that never counts. */
  const seedStarts = (firm: FirmKey, count: number, ip: string | null) => {
    const businessId = firms[firm].id;
    const row = (createdAt: Date) => ({
      businessId,
      action: 'begin_online.draft_started',
      entityType: 'lead',
      entityId: randomUUID(),
      metadata: {},
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
    const res = await v.post('/drafts', start(firm, { email: email(tag) }));
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
    expect((await v.post('/drafts', start('e'))).status).toBe(201);
    await expectRefused('e', newViewer(), 'firmcap');
    // Another firm is not limited.
    expect((await visitor(firms.f.slug).post('/drafts', start('f'))).status).toBe(201);
  });

  it(`at most ${perIp} a day per IP on a firm's site; another IP still starts`, async () => {
    const viewer = newViewer();
    await seedStarts('f', perIp - 1, viewer);
    const v = visitor(firms.f.slug, viewer);
    expect((await v.post('/drafts', start('f'))).status).toBe(201);
    const stored = await asOwner(firms.f.id, (tx) =>
      tx.auditLog.count({ where: { action: 'begin_online.draft_started', ip: viewer } }),
    );
    expect(stored).toBe(perIp + 1); // the start row records the viewer's IP
    await expectRefused('f', viewer, 'ipcap');
    expect((await visitor(firms.f.slug).post('/drafts', start('f'))).status).toBe(201);
  });
});

describe('Begin Online draft cookies', () => {
  const name = () => beginOnlineCookie(firms.a.slug).name;

  it('forged, tampered and malformed cookies are 404 DRAFT_NOT_FOUND on every route, never 500', async () => {
    const { v, draft } = await startDraft('a');
    const real = v.cookie.split('=')[1]!;
    const flipped = real.slice(0, 20) + (real[20] === 'A' ? 'B' : 'A') + real.slice(21);
    const values = [
      forgedKey(),
      flipped,
      real.slice(0, 42),
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
        expect([route, res.status, codeOf(res)]).toEqual([route, 404, 'DRAFT_NOT_FOUND']);
        expectClean(res);
      }
    }
    const lead = await asOwner(firms.a.id, (tx) =>
      tx.lead.findUniqueOrThrow({ where: { id: draft.leadId } }),
    );
    expect(lead.status).toBe('DRAFT');
    expect((await v.get('/drafts/current')).status).toBe(200);
  });

  it("firm A's cookie on firm B's site is 404 on every route; A's draft is untouched", async () => {
    const { v, draft } = await startDraft('a');
    await startDraft('b');
    const ticket = await v.post('/drafts/current/uploads', file(pdf()));
    expect(ticket.status).toBe(200);
    const renamed = visitor(firms.b.slug);
    renamed.cookie = v.cookie.replace(name(), beginOnlineCookie(firms.b.slug).name);
    const asIs = visitor(firms.b.slug);
    asIs.cookie = v.cookie; // A's cookie name on B's path: B's name is not there
    for (const b of [renamed, asIs]) {
      for (const [route, call] of DRAFT_ROUTES) {
        const res = await call(b);
        expect([route, res.status, codeOf(res)]).toEqual([route, 404, 'DRAFT_NOT_FOUND']);
      }
    }
    // A's upload ticket confirmed with a draft of firm B.
    const own = await startDraft('b');
    storage.put(ticket.body as { url: string }, pdf());
    const cross = await own.v.post('/drafts/current/uploads/confirm', {
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

  it('an expired draft is 410 DRAFT_EXPIRED on every route; a lapsed key is 404', async () => {
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
    const lapsed = await startDraft('a');
    await asOwner(
      firms.a.id,
      (tx) =>
        tx.$executeRaw`UPDATE leads SET resume_expires_at = now() - interval '1 minute'
                      WHERE id = ${lapsed.draft.leadId}::uuid`,
    );
    for (const [route, call] of DRAFT_ROUTES) {
      const res = await call(lapsed.v);
      expect([route, res.status, codeOf(res)]).toEqual([route, 404, 'DRAFT_NOT_FOUND']);
    }
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
      v.cookie = `${beginOnlineCookie(firms.a.slug).name}=${forgedKey()}`;
      const calls: [string, () => Promise<Response>][] = [
        ['services', () => v.get('/services')],
        ['form', () => v.get(`/services/${services.a}/form`)],
        ['start', () => v.post('/drafts', start('a', { email: address }))],
        ['resume', () => v.post('/drafts/resume', { token: forgedKey() })],
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
    const { v, draft } = await startDraft('d');
    const token = v.cookie.split('=')[1]!;
    await asOwner(null, (tx) =>
      tx.business.update({ where: { id: firms.d.id }, data: { status: 'SUSPENDED' } }),
    );
    for (const [route, call] of DRAFT_ROUTES) {
      const res = await call(v);
      expect([route, res.status, codeOf(res)]).toEqual([route, 404, 'NOT_FOUND']);
    }
    const resume = await visitor(firms.d.slug).post('/drafts/resume', { token });
    expect([resume.status, codeOf(resume)]).toEqual([404, 'NOT_FOUND']);
    const actions = await asOwner(firms.d.id, (tx) =>
      tx.auditLog.findMany({ where: { entityId: draft.leadId }, select: { action: true } }),
    );
    expect(actions.map((a) => a.action)).toEqual(['begin_online.draft_started']);
  });
});

describe('Begin Online keeps secrets out', () => {
  it('no audit row of these firms holds answers, SSN digits, emails or draft keys', async () => {
    // The visitor's own answers come back to its own draft (SSNs masked); never into the audit.
    const answer = `street${run}`;
    const { v } = await startDraft('a', { street: answer });
    const saved = await v.put('/drafts/current/steps/personal', {
      answers: { ...start('a').answers, ssn: SSN, street: answer },
    });
    expect(BeginDraft.parse(saved.body).answers).toMatchObject({ ssn: { last4: '6789' } });
    expectClean(saved);
    expectClean(await v.post('/drafts/current/resume-link', {}));
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
