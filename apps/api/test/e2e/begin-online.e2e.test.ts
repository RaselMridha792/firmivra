// End-to-end: Begin Online (R11 step 3) on a firm's portal site, signed out. Services and forms,
// starting a draft, saving steps, the draft cookie, expiry, isolation between firms, rate limits
// and the audit (ids only). Synthetic data only.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  BeginDraft,
  BeginOnlineForm,
  BeginOnlineServiceList,
  beginOnlineCookie,
  INTAKE_FORMS,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
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
    return Promise.resolve({
      url: `memory:${file.key}`,
      headers: { 'content-type': file.contentType },
    });
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
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
const services = {} as Record<'annual' | 'payroll' | 'archived' | 'b', string>;

let lastViewer = 0;
/** Each test on its own viewer IP, so the per-IP limits apply only where tested. */
const newViewer = () => `198.19.${Math.floor(++lastViewer / 250)}.${lastViewer % 250}`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

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

/** A browser on one firm's Begin Online pages: its own IP, cookie jar and the portal's origin. */
function visitor(slug: string, viewer = newViewer()) {
  let cookie = '';
  const name = beginOnlineCookie(slug).name;
  const keep = (res: Response) => {
    const raw = res.headers['set-cookie'] as unknown;
    const set = (Array.isArray(raw) ? (raw as string[]) : []).find((c) => c.startsWith(`${name}=`));
    if (set) cookie = set.split(';')[0] ?? '';
    return res;
  };
  const send = (method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object) => {
    let req = request(app.getHttpServer())
      [method](`/api/v1/portal/${slug}/begin-online${path}`)
      .set('x-forwarded-for', `${viewer}, 10.0.0.5`)
      .set('cookie', cookie);
    if (method !== 'get') req = req.set('origin', portalOrigin);
    return (body ? req.send(body) : req).then(keep);
  };
  return {
    get: (path: string) => send('get', path),
    post: (path: string, body: object) => send('post', path, body),
    put: (path: string, body: object) => send('put', path, body),
    del: (path: string) => send('delete', path),
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookie = value;
    },
  };
}

const annualStart = (fields: Record<string, unknown> = {}) => ({
  serviceId: services.annual,
  step: 'personal',
  answers: {
    firstName: 'Avery',
    lastName: 'Sample',
    email: `Avery.${run}@Example.com`,
    phone: '(770) 555-0142',
    ssn: '123-45-6789',
    ...fields,
  },
});

beforeAll(async () => {
  process.env['KMS_MODE'] ??= 'local';
  process.env['LOCAL_KMS_KEY'] ??= randomBytes(32).toString('base64');
  for (const key of ['a', 'b'] as const) {
    firms[key] = await asOwner(null, (tx) =>
      tx.business.create({
        data: { slug: `r11-bo-${key}-${run}`, name: `R11 Begin ${key}`, status: 'ACTIVE' },
        select: { id: true, slug: true },
      }),
    );
  }
  const service = (businessId: string, kind: 'ANNUAL_TAX' | 'PAYROLL', extra = {}) =>
    asOwner(businessId, (tx) =>
      tx.service
        .create({ data: { businessId, kind, name: `${kind} ${randomUUID()}`, ...extra } })
        .then((s) => s.id),
    );
  services.annual = await service(firms.a.id, 'ANNUAL_TAX', { beginOnline: true, sortOrder: 1 });
  services.payroll = await service(firms.a.id, 'PAYROLL', { beginOnline: true, sortOrder: 2 });
  services.archived = await service(firms.a.id, 'ANNUAL_TAX', { archivedAt: new Date() });
  services.b = await service(firms.b.id, 'ANNUAL_TAX', { beginOnline: true });

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

describe('Begin Online services and forms', () => {
  it("lists only the firm's live Begin Online services, in its order", async () => {
    const res = await visitor(firms.a.slug).get('/services');
    expect(res.status).toBe(200);
    const { items } = BeginOnlineServiceList.parse(res.body);
    expect(items.map((s) => [s.id, s.kind])).toEqual([
      [services.annual, 'ANNUAL_TAX'],
      [services.payroll, 'PAYROLL'],
    ]);
    const b = BeginOnlineServiceList.parse((await visitor(firms.b.slug).get('/services')).body);
    expect(b.items.map((s) => s.id)).toEqual([services.b]);
  });

  it('answers the built-in form as version 1 without writing it', async () => {
    const res = await visitor(firms.a.slug).get(`/services/${services.payroll}/form`);
    expect(res.status).toBe(200);
    const form = BeginOnlineForm.parse(res.body);
    expect(form).toMatchObject({ formId: null, version: 1 });
    expect(form.definition.title).toBe(INTAKE_FORMS.PAYROLL?.title);
    const stored = await asOwner(firms.a.id, (tx) =>
      tx.intakeForm.count({ where: { serviceId: services.payroll } }),
    );
    expect(stored).toBe(0);
  });

  it("is 404 for another firm's service, an archived one, a bad id and inactive firms", async () => {
    const a = visitor(firms.a.slug);
    for (const id of [services.b, services.archived, 'not-a-uuid']) {
      expect((await a.get(`/services/${id}/form`)).status).toBe(404);
    }
    for (const slug of [fx.suspended.slug, 'no-such-firm-here', 'BAD SLUG']) {
      const v = visitor(encodeURIComponent(slug));
      expect((await v.get('/services')).status).toBe(404);
      expect((await v.post('/drafts', annualStart())).status).toBe(404);
    }
  });
});

describe('Begin Online drafts', () => {
  it('starts a draft: the lead, the form v1, the intake and the answers; the cookie is the key', async () => {
    const v = visitor(firms.a.slug);
    const res = await v.post('/drafts', annualStart());
    expect(res.status).toBe(201);
    const draft = BeginDraft.parse(res.body);
    expect(draft).toMatchObject({
      service: { id: services.annual, kind: 'ANNUAL_TAX' },
      taxYear: new Date().getUTCFullYear(),
      savedSteps: ['personal'],
      answers: { firstName: 'Avery', ssn: { last4: '6789' }, phone: '+17705550142' },
    });
    expect(draft.definition.version).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('123456789');
    const days = (Date.parse(draft.draftExpiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    const raw = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    const { name, path } = beginOnlineCookie(firms.a.slug);
    expect(raw).toMatch(
      new RegExp(`^${name}=[A-Za-z0-9_-]{43}; .*Path=${path};.*HttpOnly.*SameSite=Strict`, 'm'),
    );
    expect(JSON.stringify(res.body)).not.toContain(v.cookie.split('=')[1]!);

    const [lead, forms, audits] = await asOwner(firms.a.id, (tx) =>
      Promise.all([
        tx.lead.findUniqueOrThrow({
          where: { id: draft.leadId },
          include: { intakes: { include: { submissions: true } } },
        }),
        tx.intakeForm.findMany({ where: { serviceId: services.annual } }),
        tx.auditLog.findMany({ where: { entityId: draft.leadId } }),
      ]),
    );
    expect(lead).toMatchObject({
      status: 'DRAFT',
      firstName: 'Avery',
      lastName: 'Sample',
      email: `avery.${run}@example.com`,
      phone: '+17705550142',
      taxYear: new Date().getUTCFullYear(),
    });
    expect(lead.resumeTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(lead.resumeTokenHash).not.toBe(v.cookie.split('=')[1]);
    expect(forms.map((f) => [f.version, f.status])).toEqual([[1, 'PUBLISHED']]);
    expect(lead.intakes[0]).toMatchObject({ status: 'IN_PROGRESS', formId: forms[0]!.id });
    const stored = JSON.stringify(lead.intakes[0]!.submissions[0]!.answers);
    expect(stored).not.toMatch(/123-?45-?6789/);
    expect(stored).toContain('"last4":"6789"');
    expect(audits.map((a) => [a.action, a.businessId, a.actorUserId])).toEqual([
      ['begin_online.draft_started', firms.a.id, null],
    ]);
    const meta = JSON.stringify(audits[0]!.metadata);
    expect(meta).not.toMatch(/avery|example|6789|0142/i);

    // The form endpoint now answers the stored version.
    const form = BeginOnlineForm.parse((await v.get(`/services/${services.annual}/form`)).body);
    expect(form).toMatchObject({ formId: forms[0]!.id, version: 1 });
  });

  it('reads and saves steps: masked numbers are kept, the step replaces its answers', async () => {
    const v = visitor(firms.a.slug);
    const started = BeginDraft.parse((await v.post('/drafts', annualStart())).body);
    expect(BeginDraft.parse((await v.get('/drafts/current')).body).leadId).toBe(started.leadId);

    const saved = await v.put('/drafts/current/steps/personal', {
      answers: { ...annualStart().answers, ssn: { last4: '6789' }, lastName: 'Example' },
    });
    expect(saved.status).toBe(200);
    expect(BeginDraft.parse(saved.body).answers).toMatchObject({
      ssn: { last4: '6789' },
      lastName: 'Example',
    });
    const wrong = await v.put('/drafts/current/steps/personal', {
      answers: { ...annualStart().answers, ssn: { last4: '0000' } },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details.issues[0]).toMatchObject({ path: ['ssn'] });

    const business = await v.put('/drafts/current/steps/businessIncome', { answers: {} });
    expect(business.status).toBe(200);
    expect(BeginDraft.parse(business.body).savedSteps).toEqual(['personal', 'businessIncome']);
    const lead = await asOwner(firms.a.id, (tx) =>
      tx.lead.findUniqueOrThrow({ where: { id: started.leadId } }),
    );
    expect(lead.lastName).toBe('Example');
  });

  it('seals a spouse SSN and SSNs in group rows', async () => {
    const v = visitor(firms.a.slug);
    const started = BeginDraft.parse((await v.post('/drafts', annualStart())).body);
    const saved = await v.put('/drafts/current/steps/personal', {
      answers: {
        ...annualStart().answers,
        ssn: { last4: '6789' },
        spouseSsn: '987-65-4321',
        dependents: [{ id: 'row-1', ssn: '111-22-3333' }],
      },
    });
    expect(saved.status).toBe(200);
    expect(BeginDraft.parse(saved.body).answers).toMatchObject({
      spouseSsn: { last4: '4321' },
      dependents: [{ id: 'row-1', ssn: { last4: '3333' } }],
    });
    const stored = await asOwner(firms.a.id, (tx) =>
      tx.intakeSubmission.findFirstOrThrow({ where: { intake: { leadId: started.leadId } } }),
    );
    expect(JSON.stringify(stored.answers)).not.toMatch(/123-?45-?6789|987-?65-?4321|111-?22-?3333/);
  });

  it('refuses a wrong step, a missing contact and a bad answer (400)', async () => {
    const v = visitor(firms.a.slug);
    expect(codeOf(await v.post('/drafts', { ...annualStart(), step: 'businessIncome' }))).toBe(
      'VALIDATION_FAILED',
    );
    const noContact = await v.post('/drafts', annualStart({ email: null, phone: '' }));
    expect(noContact.status).toBe(400);
    expect(
      (noContact.body.error.details.issues as { path: string[] }[]).map((i) => i.path[0]),
    ).toEqual(['email', 'phone']);
    const payroll = await v.post('/drafts', {
      serviceId: services.payroll,
      step: INTAKE_FORMS.PAYROLL!.steps[0]!.key,
      answers: { fullName: 'Avery', email: 'a@example.com', phone: '7705550100' },
    });
    expect(payroll.status).toBe(400);
    expect(payroll.body.error.details.issues.map((i: { path: string[] }) => i.path[0])).toContain(
      'fullName',
    );
    expect((await v.post('/drafts', annualStart({ ssn: '12345' }))).status).toBe(400);
    expect(v.cookie).toBe('');

    expect(BeginDraft.safeParse((await v.post('/drafts', annualStart())).body).success).toBe(true);
    expect(codeOf(await v.put('/drafts/current/steps/nope', { answers: {} }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await v.put('/drafts/current/steps/businessIncome', { answers: { firstName: 'X' } })).status,
    ).toBe(400);
  });

  it("never opens a draft without its cookie, on another firm's site or with a made-up key", async () => {
    const a = visitor(firms.a.slug);
    BeginDraft.parse((await a.post('/drafts', annualStart())).body);
    expect(codeOf(await visitor(firms.a.slug).get('/drafts/current'))).toBe('DRAFT_NOT_FOUND');

    const b = visitor(firms.b.slug);
    b.cookie = a.cookie.replace(
      beginOnlineCookie(firms.a.slug).name,
      beginOnlineCookie(firms.b.slug).name,
    );
    expect(codeOf(await b.get('/drafts/current'))).toBe('DRAFT_NOT_FOUND');
    expect((await b.put('/drafts/current/steps/personal', { answers: {} })).status).toBe(404);

    const forged = visitor(firms.a.slug);
    forged.cookie = `${beginOnlineCookie(firms.a.slug).name}=${randomBytes(32).toString('base64url')}`;
    expect(codeOf(await forged.get('/drafts/current'))).toBe('DRAFT_NOT_FOUND');
  });

  it('a draft past its expiry is 410 and becomes EXPIRED', async () => {
    const v = visitor(firms.a.slug);
    const draft = BeginDraft.parse((await v.post('/drafts', annualStart())).body);
    await asOwner(
      firms.a.id,
      (tx) =>
        tx.$executeRaw`UPDATE leads SET draft_expires_at = now() - interval '1 minute'
                      WHERE id = ${draft.leadId}::uuid`,
    );
    expect(codeOf(await v.put('/drafts/current/steps/personal', { answers: {} }))).toBe(
      'DRAFT_EXPIRED',
    );
    expect(codeOf(await v.get('/drafts/current'))).toBe('DRAFT_EXPIRED');
    const lead = await asOwner(firms.a.id, (tx) =>
      tx.lead.findUniqueOrThrow({ where: { id: draft.leadId }, include: { intakes: true } }),
    );
    expect(lead.status).toBe('EXPIRED');
    expect(lead.intakes[0]?.status).toBe('EXPIRED');
  });

  it('needs JSON from the portal itself', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/portal/${firms.a.slug}/begin-online/drafts`)
      .set('origin', 'https://elsewhere.example')
      .send(annualStart());
    expect(res.status).toBe(403);
  });

  it('limits new drafts per IP (429)', async () => {
    const v = visitor(firms.b.slug);
    const body = { ...annualStart(), serviceId: services.b };
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await v.post('/drafts', body)).status);
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });
});

describe('Begin Online resume links', () => {
  it('emails a link that replaces the key: the old cookie stops, the fragment token opens the draft', async () => {
    const v = visitor(firms.a.slug);
    const draft = BeginDraft.parse((await v.post('/drafts', annualStart())).body);
    const oldCookie = v.cookie;
    const sent = await v.post('/drafts/current/resume-link', {});
    expect(sent.status).toBe(200);
    expect(v.cookie).not.toBe(oldCookie);
    const mail = outbox.at(-1)!;
    expect(mail).toMatchObject({
      template: 'begin-online.resume-link',
      to: `avery.${run}@example.com`,
      businessId: firms.a.id,
    });
    expect(Object.keys(mail.data).sort()).toEqual(['expiresAt', 'link']);
    const link = (mail.data as { link: string }).link;
    const portal = `${portalOrigin}/${firms.a.slug}/begin/resume#token=`;
    expect(link.startsWith(portal)).toBe(true);
    const token = link.slice(portal.length);
    expect(v.cookie.endsWith(`=${token}`)).toBe(true);

    const old = visitor(firms.a.slug);
    old.cookie = oldCookie;
    expect(codeOf(await old.get('/drafts/current'))).toBe('DRAFT_NOT_FOUND');
    expect(codeOf(await old.post('/drafts/resume', { token: oldCookie.split('=')[1] }))).toBe(
      'RESUME_LINK_EXPIRED',
    );

    const other = visitor(firms.a.slug);
    const resumed = await other.post('/drafts/resume', { token });
    expect(resumed.status).toBe(200);
    expect(BeginDraft.parse(resumed.body).leadId).toBe(draft.leadId);
    expect(other.cookie.endsWith(`=${token}`)).toBe(true);
    expect((await other.get('/drafts/current')).status).toBe(200);

    // Unknown, another firm's and expired tokens all answer the same.
    const b = visitor(firms.b.slug);
    expect(codeOf(await b.post('/drafts/resume', { token }))).toBe('RESUME_LINK_EXPIRED');
    const unknown = randomBytes(32).toString('base64url');
    expect(codeOf(await other.post('/drafts/resume', { token: unknown }))).toBe(
      'RESUME_LINK_EXPIRED',
    );
    await asOwner(
      firms.a.id,
      (tx) =>
        tx.$executeRaw`UPDATE leads SET draft_expires_at = now() - interval '1 minute'
                      WHERE id = ${draft.leadId}::uuid`,
    );
    const expired = await visitor(firms.a.slug).post('/drafts/resume', { token });
    expect([expired.status, codeOf(expired)]).toEqual([410, 'RESUME_LINK_EXPIRED']);

    const audits = await asOwner(firms.a.id, (tx) =>
      tx.auditLog.findMany({ where: { entityId: draft.leadId } }),
    );
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['begin_online.resume_link_sent', 'begin_online.draft_resumed']),
    );
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain(token);
  });

  it('sends at most 5 links a day per draft (counted in the database)', async () => {
    const v = visitor(firms.a.slug);
    BeginDraft.parse((await v.post('/drafts', annualStart())).body);
    const codes: (string | number)[] = [];
    for (let i = 0; i < 6; i++) {
      // A new IP each time, so only the per-draft limit applies.
      const r = await request(app.getHttpServer())
        .post(`/api/v1/portal/${firms.a.slug}/begin-online/drafts/current/resume-link`)
        .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
        .set('origin', portalOrigin)
        .set('cookie', v.cookie)
        .send({});
      const set = (r.headers['set-cookie'] as unknown as string[] | undefined)?.[0];
      if (set) v.cookie = set.split(';')[0]!;
      codes.push(r.status === 200 ? 200 : codeOf(r)!);
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 'RATE_LIMITED']);
    expect((await v.get('/drafts/current')).status).toBe(200);
  });
});

describe('Begin Online uploads', () => {
  const file = (bytes: Buffer, slot = 'governmentId', fields: Record<string, unknown> = {}) => ({
    slot,
    fileName: 'id-card.pdf',
    contentType: 'application/pdf',
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
    ...fields,
  });

  it('uploads into a slot of the form, under the firm prefix, and deletes while a draft', async () => {
    const v = visitor(firms.a.slug);
    const draft = BeginDraft.parse((await v.post('/drafts', annualStart())).body);
    const bytes = pdf('synthetic id');
    const ticket = await v.post('/drafts/current/uploads', file(bytes));
    expect(ticket.status).toBe(200);
    storage.put(ticket.body as { url: string }, bytes);
    const confirmed = await v.post('/drafts/current/uploads/confirm', {
      uploadToken: ticket.body.uploadToken,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ slot: 'governmentId', scanStatus: 'CLEAN' });
    expect(
      (await v.post('/drafts/current/uploads/confirm', { uploadToken: ticket.body.uploadToken }))
        .status,
    ).toBe(410);
    const row = await asOwner(firms.a.id, (tx) =>
      tx.leadUpload.findUniqueOrThrow({ where: { id: confirmed.body.id } }),
    );
    expect(row.s3Key.startsWith(`tenant/${firms.a.id}/leads/${draft.leadId}/`)).toBe(true);
    const current = BeginDraft.parse((await v.get('/drafts/current')).body);
    expect(current.uploads.map((u) => u.id)).toEqual([confirmed.body.id]);

    // Another browser (another draft) can't confirm or delete it.
    const other = visitor(firms.a.slug);
    BeginDraft.parse((await other.post('/drafts', annualStart())).body);
    expect(
      (
        await other.post('/drafts/current/uploads/confirm', {
          uploadToken: ticket.body.uploadToken,
        })
      ).status,
    ).toBe(410);
    expect((await other.del(`/drafts/current/uploads/${confirmed.body.id}`)).status).toBe(404);

    expect((await v.del(`/drafts/current/uploads/${confirmed.body.id}`)).status).toBe(200);
    expect(storage.objects.has(row.s3Key)).toBe(false);
    expect(BeginDraft.parse((await v.get('/drafts/current')).body).uploads).toEqual([]);
  });

  it('refuses a slot not in the form, an oversize or mistyped file, and bytes that differ', async () => {
    const v = visitor(firms.a.slug);
    BeginDraft.parse((await v.post('/drafts', annualStart())).body);
    const bytes = pdf();
    for (const body of [
      file(bytes, 'firstName'),
      file(bytes, 'noSuchSlot'),
      file(bytes, 'governmentId', { sizeBytes: 10 * 1024 * 1024 + 1 }),
      file(bytes, 'governmentId', { fileName: 'id-card.exe' }),
      file(bytes, 'governmentId', { contentType: 'text/html', fileName: 'x.html' }),
    ]) {
      const res = await v.post('/drafts/current/uploads', body);
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    const ticket = await v.post('/drafts/current/uploads', file(bytes));
    storage.put(ticket.body as { url: string }, pdf('other bytes, same length?'));
    const res = await v.post('/drafts/current/uploads/confirm', {
      uploadToken: ticket.body.uploadToken,
    });
    expect([res.status, codeOf(res)]).toEqual([409, 'UPLOAD_MISMATCH']);
  });

  it('takes no files once the draft expired', async () => {
    const v = visitor(firms.a.slug);
    const draft = BeginDraft.parse((await v.post('/drafts', annualStart())).body);
    await asOwner(
      firms.a.id,
      (tx) =>
        tx.$executeRaw`UPDATE leads SET draft_expires_at = now() - interval '1 minute'
                      WHERE id = ${draft.leadId}::uuid`,
    );
    expect(codeOf(await v.post('/drafts/current/uploads', file(pdf())))).toBe('DRAFT_EXPIRED');
  });
});
