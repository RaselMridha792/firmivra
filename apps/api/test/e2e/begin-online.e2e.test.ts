// End-to-end: Begin Online (R11, contract B: packages/types/src/begin-online) on a firm's portal
// site, signed out. Forms, starting a draft, saving steps, the sealed draft cookie, expiry, resume
// links, uploads, submit, isolation between firms and services, rate limits and the audit (ids
// only). Synthetic data only.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  ANNUAL_TAX_FORM,
  BeginDraft,
  BeginOnlineForm,
  BeginOnlineFormList,
  BeginReceived,
  BeginSubmitted,
  INTAKE_FORMS,
  IntakeUpload,
  INTAKE_LIMITS,
  IntakeUploadList,
  intakeFields,
  intakeStepFields,
  SavedIntakeStep,
} from '@firmivra/types';
import {
  beginOnlineCookie,
  expiredDraftRefusal,
  hashToken,
} from '../../src/begin-online/drafts.js';
import { BeginOnlineSweep } from '../../src/begin-online/begin-online-sweep.js';
import { ResumeLinksService } from '../../src/begin-online/resume-links.service.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { REFUSALS_SINCE_MS } from '../../src/storage/uploads.service.js';
import { firmWideVersion, publishFirmWideAgreement, signatureFor } from '../intake-signing.js';
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
const D = '/annual-tax/draft';

let lastViewer = 0;
/**
 * Each test on its own viewer network (the start and resume limits count a /24 or /48 as one
 * viewer), so the limits apply only where tested.
 */
const newViewer = () => `198.${18 + Math.floor(++lastViewer / 250)}.${lastViewer % 250}.1`;
let lastEmail = 0;
const newEmail = () => `Avery.${run}.${++lastEmail}@Example.com`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const linksIdle = () => app.get(ResumeLinksService).idle();

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
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    const raw = res.headers['set-cookie'] as unknown;
    for (const c of Array.isArray(raw) ? (raw as string[]) : []) {
      const [pair] = c.split(';');
      const at = pair!.indexOf('=');
      const name = pair!.slice(0, at);
      if (!name.startsWith('fv_bo_')) continue;
      const value = pair!.slice(at + 1);
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    return res;
  };
  const header = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const send = (method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object) => {
    let req = request(app.getHttpServer())
      [method](`/api/v1/portal/${slug}/begin${path}`)
      .set('x-forwarded-for', `${viewer}, 10.0.0.5`)
      .set('cookie', header());
    if (method !== 'get') req = req.set('origin', portalOrigin);
    return (body ? req.send(body) : req).then(keep);
  };
  return {
    jar,
    get: (path: string) => send('get', path),
    post: (path: string, body: object) => send('post', path, body),
    put: (path: string, body: object) => send('put', path, body),
    del: (path: string) => send('delete', path),
  };
}
type Visitor = ReturnType<typeof visitor>;

const contact = (fields: Record<string, unknown> = {}) => ({
  firstName: 'Avery',
  lastName: 'Sample',
  email: newEmail(),
  phone: '(770) 555-0142',
  ...fields,
});

/** Starts a draft and finds its lead (a draft's answer carries no lead id). */
async function start(v: Visitor, firm = firms.a, path = 'annual-tax', fields = {}) {
  const body = contact(fields);
  const res = await v.post(`/${path}/draft`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const draft = BeginDraft.parse(res.body);
  const lead = await asOwner(firm.id, (tx) =>
    tx.lead.findFirstOrThrow({
      where: { email: body.email.toLowerCase() },
      orderBy: { createdAt: 'desc' },
    }),
  );
  return { draft, leadId: lead.id, email: body.email.toLowerCase() };
}

const expireDraft = (firmId: string, leadId: string) =>
  asOwner(
    firmId,
    (tx) =>
      tx.$executeRaw`UPDATE leads SET draft_expires_at = now() - interval '1 minute'
                    WHERE id = ${leadId}::uuid`,
  );

/** A CLEAN file in `slot`, inserted as confirm would, with its object in storage. */
async function addFile(leadId: string, slot: string, firm = firms.a) {
  const bytes = pdf(slot);
  const key = `tenant/${firm.id}/leads/${leadId}/${randomUUID()}`;
  storage.objects.set(key, bytes);
  await asOwner(firm.id, async (tx) => {
    const row = await tx.leadUpload.create({
      data: {
        businessId: firm.id,
        leadId,
        slot,
        fileName: `${slot}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        sha256: sha256(bytes),
        s3Key: key,
      },
    });
    await tx.leadUpload.update({
      where: { id: row.id },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
    });
  });
  return key;
}

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
  // Payroll first by the firm's sort order: `forms` still answers in the page's order.
  services.payroll = await service(firms.a.id, 'PAYROLL', { beginOnline: true, sortOrder: 1 });
  services.annual = await service(firms.a.id, 'ANNUAL_TAX', { beginOnline: true, sortOrder: 2 });
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
  await linksIdle();
  await app.close();
});

describe('Begin Online forms', () => {
  it("lists the firm's Begin Online services in the page's order", async () => {
    const res = await visitor(firms.a.slug).get('/forms');
    expect(res.status).toBe(200);
    const { items } = BeginOnlineFormList.parse(res.body);
    expect(items).toEqual([
      { form: 'ANNUAL_TAX', title: INTAKE_FORMS.ANNUAL_TAX!.title, version: 1 },
      { form: 'PAYROLL', title: INTAKE_FORMS.PAYROLL!.title, version: 1 },
    ]);
    const b = BeginOnlineFormList.parse((await visitor(firms.b.slug).get('/forms')).body);
    expect(b.items.map((i) => i.form)).toEqual(['ANNUAL_TAX']);
  });

  it('answers the built-in form as version 1 without writing it', async () => {
    const res = await visitor(firms.a.slug).get('/forms/payroll');
    expect(res.status).toBe(200);
    const form = BeginOnlineForm.parse(res.body);
    expect(form).toMatchObject({
      form: 'PAYROLL',
      version: 1,
      title: INTAKE_FORMS.PAYROLL!.title,
      taxYear: new Date().getUTCFullYear(),
    });
    const stored = await asOwner(firms.a.id, (tx) =>
      tx.intakeForm.count({ where: { serviceId: services.payroll } }),
    );
    expect(stored).toBe(0);
  });

  it('is 404 for a service the firm does not offer online, a bad path and inactive firms', async () => {
    const a = visitor(firms.a.slug);
    for (const path of ['bookkeeping', 'nope', 'ANNUAL_TAX']) {
      expect((await a.get(`/forms/${path}`)).status).toBe(404);
      expect((await a.post(`/${path}/draft`, contact())).status).toBe(404);
    }
    expect((await visitor(firms.b.slug).get('/forms/payroll')).status).toBe(404);
    for (const slug of [fx.suspended.slug, 'no-such-firm-here', 'BAD SLUG']) {
      const v = visitor(encodeURIComponent(slug));
      expect((await v.get('/forms')).status).toBe(404);
      expect((await v.post(D, contact())).status).toBe(404);
    }
  });
});

describe('Begin Online drafts', () => {
  it('starts a draft: the lead, the form v1, the intake and the prefilled answers; a sealed cookie', async () => {
    const v = visitor(firms.a.slug);
    const body = contact();
    const res = await v.post(D, body);
    expect(res.status).toBe(201);
    const draft = BeginDraft.parse(res.body);
    const email = body.email.toLowerCase();
    expect(draft).toMatchObject({
      form: 'ANNUAL_TAX',
      version: 1,
      taxYear: new Date().getUTCFullYear(),
      contact: { firstName: 'Avery', lastName: 'Sample', email, phone: '+17705550142' },
      savedSteps: [],
      uploads: [],
      answers: { firstName: 'Avery', lastName: 'Sample', email, phone: '+17705550142' },
    });
    const days = (Date.parse(draft.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    const raw = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    const { name, path } = beginOnlineCookie(firms.a.slug, 'ANNUAL_TAX');
    expect(name).toBe(`fv_bo_${firms.a.slug}_annual-tax`);
    expect(raw).toMatch(new RegExp(`^${name}=[^;]+; Max-Age=(\\d+); Path=${path};.*HttpOnly`, 'm'));
    expect(raw).toMatch(/SameSite=Strict/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(raw)![1]);
    expect(maxAge).toBeGreaterThan(5 * 3600);
    expect(maxAge).toBeLessThanOrEqual(6 * 3600);

    const [lead, forms, audits] = await asOwner(firms.a.id, async (tx) => {
      const l = await tx.lead.findFirstOrThrow({
        where: { email },
        include: { intakes: { include: { submissions: true } } },
      });
      const [f, a] = await Promise.all([
        tx.intakeForm.findMany({ where: { serviceId: services.annual } }),
        tx.auditLog.findMany({ where: { entityId: l.id } }),
      ]);
      return [l, f, a] as const;
    });
    // The cookie is sealed: neither the lead id nor anything readable.
    expect(v.jar.get(name)).not.toContain(lead.id);
    expect(lead).toMatchObject({
      status: 'DRAFT',
      serviceId: services.annual,
      firstName: 'Avery',
      lastName: 'Sample',
      email,
      phone: '+17705550142',
      taxYear: new Date().getUTCFullYear(),
      resumeTokenHash: null,
    });
    expect(forms.map((f) => [f.version, f.status])).toEqual([[1, 'PUBLISHED']]);
    expect(lead.intakes[0]).toMatchObject({ status: 'IN_PROGRESS', formId: forms[0]!.id });
    expect(lead.intakes[0]!.submissions[0]!.savedSteps).toEqual([]);
    expect(audits.map((a) => [a.action, a.businessId, a.actorUserId])).toEqual([
      ['begin_online.draft_started', firms.a.id, null],
    ]);
    expect(JSON.stringify(audits[0]!.metadata)).not.toMatch(/avery|example|0142/i);

    // The form endpoint now answers the stored version.
    const form = BeginOnlineForm.parse((await v.get('/forms/annual-tax')).body);
    expect(form.version).toBe(1);
  });

  it('reads and saves steps: masked numbers are kept, the step replaces its answers', async () => {
    const v = visitor(firms.a.slug);
    const { draft } = await start(v);
    expect(BeginDraft.parse((await v.get(D)).body).contact).toEqual(draft.contact);

    const personal = { firstName: 'Avery', lastName: 'Example', ssn: '123-45-6789' };
    const saved = await v.put(`${D}/steps/personal`, { answers: personal });
    expect(saved.status).toBe(200);
    expect(SavedIntakeStep.parse(saved.body).step).toBe('personal');
    expect(JSON.stringify(saved.body)).not.toContain('6789');
    const read = BeginDraft.parse((await v.get(D)).body);
    expect(read.answers).toMatchObject({ ssn: { last4: '6789' }, lastName: 'Example' });
    expect(read.answers['email']).toBeUndefined(); // the step's answers replace that step's
    expect(read.savedSteps).toEqual(['personal']);
    expect(JSON.stringify(read)).not.toMatch(/123-?45-?6789/);

    const again = await v.put(`${D}/steps/personal`, {
      answers: { ...personal, ssn: { last4: '6789' } },
    });
    expect(again.status).toBe(200);
    const wrong = await v.put(`${D}/steps/personal`, {
      answers: { ...personal, ssn: { last4: '0000' } },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details.issues[0]).toMatchObject({ path: ['ssn'] });

    expect((await v.put(`${D}/steps/businessIncome`, { answers: {} })).status).toBe(200);
    expect(BeginDraft.parse((await v.get(D)).body).savedSteps).toEqual([
      'personal',
      'businessIncome',
    ]);
  });

  it('seals a spouse SSN and SSNs in group rows', async () => {
    const v = visitor(firms.a.slug);
    const { leadId } = await start(v);
    const saved = await v.put(`${D}/steps/personal`, {
      answers: {
        ssn: '123-45-6789',
        spouseSsn: '987-65-4321',
        dependents: [{ id: 'row-1', ssn: '111-22-3333' }],
      },
    });
    expect(saved.status).toBe(200);
    expect(BeginDraft.parse((await v.get(D)).body).answers).toMatchObject({
      spouseSsn: { last4: '4321' },
      dependents: [{ id: 'row-1', ssn: { last4: '3333' } }],
    });
    const stored = await asOwner(firms.a.id, (tx) =>
      tx.intakeSubmission.findFirstOrThrow({ where: { intake: { leadId } } }),
    );
    expect(JSON.stringify(stored.answers)).not.toMatch(/123-?45-?6789|987-?65-?4321|111-?22-?3333/);
  });

  it('refuses a bad start card (400) and sets no cookie', async () => {
    const v = visitor(firms.a.slug);
    for (const body of [
      contact({ firstName: '' }),
      contact({ email: 'not-an-email' }),
      contact({ phone: '12' }),
      { ...contact(), serviceId: randomUUID() },
      { firstName: 'Avery' },
    ]) {
      const res = await v.post(D, body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect(v.jar.size).toBe(0);
  });

  it('refuses a wrong step and a bad answer (400)', async () => {
    const v = visitor(firms.a.slug);
    await start(v);
    expect(codeOf(await v.put(`${D}/steps/nope`, { answers: {} }))).toBe('VALIDATION_FAILED');
    expect((await v.put(`${D}/steps/businessIncome`, { answers: { firstName: 'X' } })).status).toBe(
      400,
    );
    expect((await v.put(`${D}/steps/personal`, { answers: { ssn: '12345' } })).status).toBe(400);
    expect((await v.put(`${D}/steps/personal`, { answers: {}, extra: 1 })).status).toBe(400);
  });

  it("never opens a draft without its cookie, on another firm's site, another service or a made-up cookie", async () => {
    const a = visitor(firms.a.slug);
    await start(a);
    const value = a.jar.get(beginOnlineCookie(firms.a.slug, 'ANNUAL_TAX').name)!;
    expect(codeOf(await visitor(firms.a.slug).get(D))).toBe('NOT_FOUND');

    const b = visitor(firms.b.slug);
    b.jar.set(beginOnlineCookie(firms.b.slug, 'ANNUAL_TAX').name, value);
    expect(codeOf(await b.get(D))).toBe('NOT_FOUND');
    expect((await b.put(`${D}/steps/personal`, { answers: {} })).status).toBe(404);

    const payroll = visitor(firms.a.slug);
    payroll.jar.set(beginOnlineCookie(firms.a.slug, 'PAYROLL').name, value);
    expect(codeOf(await payroll.get('/payroll/draft'))).toBe('NOT_FOUND');

    const forged = visitor(firms.a.slug);
    forged.jar.set(
      beginOnlineCookie(firms.a.slug, 'ANNUAL_TAX').name,
      randomBytes(32).toString('base64url'),
    );
    expect(codeOf(await forged.get(D))).toBe('NOT_FOUND');
    const tampered = visitor(firms.a.slug);
    tampered.jar.set(
      beginOnlineCookie(firms.a.slug, 'ANNUAL_TAX').name,
      `${value.slice(0, -2)}${value.endsWith('AA') ? 'BB' : 'AA'}`,
    );
    expect(codeOf(await tampered.get(D))).toBe('NOT_FOUND');
  });

  it("keeps one draft per service in a browser; starting again replaces this browser's draft", async () => {
    const v = visitor(firms.a.slug);
    const annual = await start(v);
    const payroll = await start(v, firms.a, 'payroll');
    expect(BeginDraft.parse((await v.get(D)).body).contact.email).toBe(annual.email);
    expect(BeginDraft.parse((await v.get('/payroll/draft')).body).form).toBe('PAYROLL');
    const again = await start(v);
    expect(BeginDraft.parse((await v.get(D)).body).contact.email).toBe(again.email);
    expect(again.leadId).not.toBe(annual.leadId);
    const leads = await asOwner(firms.a.id, (tx) =>
      tx.lead.findMany({ where: { id: { in: [annual.leadId, payroll.leadId] } } }),
    );
    expect(leads.map((l) => l.status)).toEqual(['DRAFT', 'DRAFT']);
  });

  /** A draft with answers, a file and a resume link: what an expiry must remove. */
  async function fullDraft(v: Visitor) {
    const started = await start(v);
    const saved = await v.put(`${D}/steps/personal`, { answers: { ssn: '123-45-6789' } });
    expect(saved.status).toBe(200);
    const key = await addFile(started.leadId, 'governmentId');
    const before = outbox.length;
    await v.post('/resume-link', { email: started.email });
    await linksIdle();
    const mail = outbox.slice(before).find((m) => m.to === started.email)!;
    const token = (mail.data as { link: string }).link.split('#token=')[1]!;
    return { ...started, key, token };
  }

  /** The lead after its expiry: EXPIRED, no answers, files or resume link left. */
  async function expectGone(d: Awaited<ReturnType<typeof fullDraft>>) {
    const lead = await asOwner(firms.a.id, (tx) =>
      tx.lead.findUniqueOrThrow({
        where: { id: d.leadId },
        include: { intakes: { include: { submissions: true } }, uploads: true },
      }),
    );
    expect(lead).toMatchObject({ status: 'EXPIRED', resumeTokenHash: null, resumeExpiresAt: null });
    expect(lead.intakes[0]?.status).toBe('EXPIRED');
    expect(lead.intakes[0]?.submissions[0]).toMatchObject({ answers: {}, savedSteps: [] });
    expect(lead.uploads).toEqual([]);
    expect(storage.objects.has(d.key)).toBe(false);
    const resumed = await visitor(firms.a.slug).post('/resume', { token: d.token });
    expect([resumed.status, codeOf(resumed)]).toEqual([410, 'DRAFT_EXPIRED']);
  }

  it('a draft past its expiry is 410: its answers, files and resume link go, it becomes EXPIRED', async () => {
    const v = visitor(firms.a.slug);
    const d = await fullDraft(v);
    await expireDraft(firms.a.id, d.leadId);
    expect(codeOf(await v.put(`${D}/steps/personal`, { answers: {} }))).toBe('DRAFT_EXPIRED');
    expect([(await v.get(D)).status, codeOf(await v.get(D))]).toEqual([410, 'DRAFT_EXPIRED']);
    await expectGone(d);
  });

  it('the sweep expires drafts nobody reopens, and only those', async () => {
    const d = await fullDraft(visitor(firms.a.slug));
    const live = visitor(firms.a.slug);
    const other = await start(live);
    await expireDraft(firms.a.id, d.leadId);
    const sweep = app.get(BeginOnlineSweep);
    const result = await sweep.run({ businessIds: [firms.a.id] });
    expect(result).toMatchObject({ skipped: false });
    expect(result.skipped === false && result.expired).toBeGreaterThanOrEqual(1);
    await expectGone(d);
    expect((await live.get(D)).status).toBe(200);
    const audit = await asOwner(firms.a.id, (tx) =>
      tx.auditLog.findMany({ where: { entityId: d.leadId, action: 'begin_online.draft_expired' } }),
    );
    expect(audit.map((a) => a.metadata)).toEqual([{ removed: 1 }]);
    expect(other.leadId).not.toBe(d.leadId);
    // A second run finds nothing more of this draft.
    await sweep.run({ businessIds: [firms.a.id] });
    const again = await asOwner(firms.a.id, (tx) =>
      tx.auditLog.count({ where: { entityId: d.leadId, action: 'begin_online.draft_expired' } }),
    );
    expect(again).toBe(1);
  });

  it('needs JSON from the portal itself', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/portal/${firms.a.slug}/begin${D}`)
      .set('origin', 'https://elsewhere.example')
      .send(contact());
    expect(res.status).toBe(403);
    // Server code relaying a draft cookie (no Origin, no Sec-Fetch-Site) is refused too.
    const v = visitor(firms.a.slug);
    await start(v);
    const [name, value] = [...v.jar][0]!;
    const relayed = await request(app.getHttpServer())
      .put(`/api/v1/portal/${firms.a.slug}/begin${D}/steps/personal`)
      .set('cookie', `${name}=${value}`)
      .send({ answers: {} });
    expect([relayed.status, codeOf(relayed)]).toEqual([403, 'ORIGIN_NOT_ALLOWED']);
  });

  it('limits new drafts per IP (429)', async () => {
    const v = visitor(firms.b.slug);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await v.post(D, contact())).status);
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('counts starts per network: addresses of one /24 or /48 share the limit, and the row keeps it', async () => {
    const statuses = async (viewers: string[]) => {
      const codes: number[] = [];
      for (const viewer of viewers) {
        codes.push((await visitor(firms.b.slug, viewer).post(D, contact())).status);
      }
      return codes;
    };
    // IPv4: three addresses of 203.0.113.0/24 are one viewer; the next /24 is another.
    const v4 = ['203.0.113.10', '203.0.113.20', '203.0.113.30'];
    expect(await statuses([...v4, ...v4])).toEqual([201, 201, 201, 201, 201, 429]);
    expect(await statuses(['203.0.114.10'])).toEqual([201]);
    // IPv6: other /64s of one /48 count together; another /48 does not.
    const v6 = ['2001:db8:5:a::1', '2001:db8:5:b::1', '2001:db8:5:ffff::9'];
    expect(await statuses([...v6, ...v6])).toEqual([201, 201, 201, 201, 201, 429]);
    expect(await statuses(['2001:db8:6::1'])).toEqual([201]);
    // The daily limit counts the network the start row records (never only the address).
    const rows = await asOwner(firms.b.id, (tx) =>
      tx.auditLog.findMany({
        where: { action: 'begin_online.draft_started', ip: { in: [...v4, ...v6] } },
        select: { metadata: true },
      }),
    );
    expect(new Set(rows.map((r) => (r.metadata as { net?: string }).net))).toEqual(
      new Set(['203.0.113.0/24', '2001:0db8:0005::/48']),
    );
    expect(rows).toHaveLength(10);
  });

  it('limits resume links and resume pages per network (429)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await visitor(firms.b.slug, `203.0.115.${i + 1}`).post('/resume-link', {
        email: newEmail(),
      });
      codes.push(res.status);
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    const resumes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await visitor(firms.b.slug, `2001:db8:7:${i}::1`).post('/resume', {
        token: randomBytes(32).toString('base64url'),
      });
      resumes.push(res.status);
    }
    expect(resumes).toEqual([...Array<number>(10).fill(410), 429]);
    await linksIdle();
  });
});

describe('Begin Online resume links', () => {
  const linkPrefix = () => `${portalOrigin}/${firms.a.slug}/begin/resume#token=`;
  const tokensTo = (email: string, from: number) =>
    outbox
      .slice(from)
      .filter((m) => m.template === 'begin-online.resume-link' && m.to === email)
      .map((m) => (m.data as { link: string }).link.slice(linkPrefix().length));

  it("emails a link for each of the address's open drafts; the token opens the draft in another browser", async () => {
    const v = visitor(firms.a.slug);
    const body = contact();
    const annualRes = await v.post(D, body);
    expect(annualRes.status).toBe(201);
    const annual = BeginDraft.parse(annualRes.body);
    expect((await v.post('/payroll/draft', { ...body })).status).toBe(201);
    const email = body.email.toLowerCase();
    const leads = await asOwner(firms.a.id, (tx) =>
      tx.lead.findMany({ where: { email }, orderBy: { createdAt: 'asc' } }),
    );

    const before = outbox.length;
    const sent = await v.post('/resume-link', { email: body.email.toUpperCase() });
    expect(sent.status).toBe(200);
    expect(BeginReceived.parse(sent.body)).toEqual({ received: true });
    expect(sent.headers['set-cookie']).toBeUndefined();
    await linksIdle();
    const mails = outbox.slice(before);
    expect(mails.map((m) => [m.template, m.to, m.businessId])).toEqual([
      ['begin-online.resume-link', email, firms.a.id],
      ['begin-online.resume-link', email, firms.a.id],
    ]);
    expect(Object.keys(mails[0]!.data).sort()).toEqual(['expiresAt', 'link']);
    const tokens = tokensTo(email, before);
    expect(tokens.every((t) => /^[A-Za-z0-9_-]{43}$/.test(t))).toBe(true);
    const after = await asOwner(firms.a.id, (tx) =>
      tx.lead.findMany({ where: { email }, orderBy: { createdAt: 'asc' } }),
    );
    expect(after.map((l) => l.resumeTokenHash)).toEqual(tokens.map(hashToken));
    // A link renews nothing: it lasts as long as the draft does.
    for (const [i, l] of after.entries()) {
      expect(l.draftExpiresAt).toEqual(leads[i]!.draftExpiresAt);
      expect(l.resumeExpiresAt).toEqual(l.draftExpiresAt);
    }

    const other = visitor(firms.a.slug);
    const resumed = await other.post('/resume', { token: tokens[0] });
    expect(resumed.status).toBe(200);
    expect(BeginDraft.parse(resumed.body)).toMatchObject({
      form: 'ANNUAL_TAX',
      contact: annual.contact,
    });
    expect([...other.jar.keys()]).toEqual([beginOnlineCookie(firms.a.slug, 'ANNUAL_TAX').name]);
    expect((await other.get(D)).status).toBe(200);
    const payroll = await other.post('/resume', { token: tokens[1] });
    expect(BeginDraft.parse(payroll.body).form).toBe('PAYROLL');
    expect((await other.get('/payroll/draft')).status).toBe(200);

    // A new link replaces the older one.
    const again = outbox.length;
    expect((await v.post('/resume-link', { email })).status).toBe(200);
    await linksIdle();
    const fresh = tokensTo(email, again);
    expect(fresh).toHaveLength(2);
    expect(codeOf(await visitor(firms.a.slug).post('/resume', { token: tokens[0] }))).toBe(
      'DRAFT_EXPIRED',
    );
    expect((await visitor(firms.a.slug).post('/resume', { token: fresh[0] })).status).toBe(200);

    // Unknown, another firm's and expired tokens all answer the same.
    expect(codeOf(await visitor(firms.b.slug).post('/resume', { token: fresh[0] }))).toBe(
      'DRAFT_EXPIRED',
    );
    const unknown = randomBytes(32).toString('base64url');
    expect(codeOf(await visitor(firms.a.slug).post('/resume', { token: unknown }))).toBe(
      'DRAFT_EXPIRED',
    );
    expect((await visitor(firms.a.slug).post('/resume', { token: 'short' })).status).toBe(400);
    await expireDraft(firms.a.id, leads[0]!.id);
    const expired = await visitor(firms.a.slug).post('/resume', { token: fresh[0] });
    expect([expired.status, codeOf(expired)]).toEqual([410, 'DRAFT_EXPIRED']);

    const audits = await asOwner(firms.a.id, (tx) =>
      tx.auditLog.findMany({ where: { entityId: { in: leads.map((l) => l.id) } } }),
    );
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['begin_online.resume_link_sent', 'begin_online.draft_resumed']),
    );
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toMatch(
      new RegExp([...tokens, ...fresh, run].join('|')),
    );
  });

  it('answers the same for an address without a draft, and sends nothing', async () => {
    const before = outbox.length;
    const v = visitor(firms.a.slug);
    const res = await v.post('/resume-link', { email: `nobody.${run}@example.com` });
    expect([res.status, res.body]).toEqual([200, { received: true }]);
    await linksIdle();
    expect(outbox.length).toBe(before);
    expect((await v.post('/resume-link', { email: 'not-an-email' })).status).toBe(400);
    expect((await v.post('/resume-link', { email: newEmail(), extra: 1 })).status).toBe(400);
    expect(
      (await visitor('no-such-firm-here').post('/resume-link', { email: newEmail() })).status,
    ).toBe(404);
  });

  it('sends at most 5 links an hour to an address, silently (counted in the database)', async () => {
    const v = visitor(firms.a.slug);
    const { email } = await start(v);
    const before = outbox.length;
    for (let i = 0; i < 7; i++) {
      // A new IP each time, so only the per-address limit applies.
      const res = await visitor(firms.a.slug).post('/resume-link', { email });
      expect([res.status, res.body]).toEqual([200, { received: true }]);
      await linksIdle();
    }
    expect(tokensTo(email, before)).toHaveLength(5);
    expect((await v.get(D)).status).toBe(200);
  });

  it('limits resume-link requests per IP (429)', async () => {
    const v = visitor(firms.a.slug);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await v.post('/resume-link', { email: `nobody.${run}@example.com` })).status);
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

/** The key a ticket's PUT writes (the memory storage's URL is `memory:{key}`). */
const keyOf = (ticket: Response) => (ticket.body as { url: string }).url.slice('memory:'.length);
/** The codes of the refusals audited for a ticket's key. */
const refusedCodes = async (ticket: Response) => {
  const uploadId = keyOf(ticket).split('/').at(-1)!;
  const rows = await asOwner(firms.a.id, (tx) =>
    tx.auditLog.findMany({
      where: {
        action: 'begin_online.upload_refused',
        metadata: { path: ['uploadId'], equals: uploadId },
      },
    }),
  );
  return rows.map((r) => (r.metadata as { code: string }).code);
};

describe('Begin Online uploads', () => {
  const file = (bytes: Buffer, slot = 'governmentId', fields: Record<string, unknown> = {}) => ({
    slot,
    fileName: 'id-card.pdf',
    contentType: 'application/pdf',
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
    ...fields,
  });

  it('uploads into a slot of the form, under the firm prefix, lists and deletes while a draft', async () => {
    const v = visitor(firms.a.slug);
    const { leadId } = await start(v);
    const bytes = pdf('synthetic id');
    const ticket = await v.post(`${D}/uploads`, file(bytes));
    expect(ticket.status).toBe(200);
    storage.put(ticket.body as { url: string }, bytes);
    const confirmed = await v.post(`${D}/uploads/confirm`, {
      uploadToken: ticket.body.uploadToken,
    });
    expect(confirmed.status).toBe(200);
    const upload = IntakeUpload.parse(confirmed.body);
    expect(upload).toMatchObject({
      slot: 'governmentId',
      status: 'READY',
      fileName: 'id-card.pdf',
    });
    expect(
      (await v.post(`${D}/uploads/confirm`, { uploadToken: ticket.body.uploadToken })).status,
    ).toBe(410);
    const row = await asOwner(firms.a.id, (tx) =>
      tx.leadUpload.findUniqueOrThrow({ where: { id: upload.id } }),
    );
    expect(row.s3Key.startsWith(`tenant/${firms.a.id}/leads/${leadId}/`)).toBe(true);
    expect(IntakeUploadList.parse((await v.get(`${D}/uploads`)).body).items).toEqual([upload]);
    expect(BeginDraft.parse((await v.get(D)).body).uploads).toEqual([upload]);

    // Another browser (another draft) can't confirm, list or delete it.
    const other = visitor(firms.a.slug);
    await start(other);
    expect(
      (await other.post(`${D}/uploads/confirm`, { uploadToken: ticket.body.uploadToken })).status,
    ).toBe(410);
    expect(IntakeUploadList.parse((await other.get(`${D}/uploads`)).body).items).toEqual([]);
    expect((await other.del(`${D}/uploads/${upload.id}`)).status).toBe(404);
    expect((await v.del(`${D}/uploads/not-a-uuid`)).status).toBe(404);

    const removed = await v.del(`${D}/uploads/${upload.id}`);
    expect([removed.status, removed.body]).toEqual([200, { ok: true }]);
    expect(storage.objects.has(row.s3Key)).toBe(false);
    expect(BeginDraft.parse((await v.get(D)).body).uploads).toEqual([]);
  });

  it("a ticket belongs to its draft: after a new start in this browser it's 410 UPLOAD_EXPIRED", async () => {
    const v = visitor(firms.a.slug);
    await start(v);
    const bytes = pdf('first draft');
    const ticket = await v.post(`${D}/uploads`, file(bytes));
    storage.put(ticket.body as { url: string }, bytes);
    await start(v);
    const res = await v.post(`${D}/uploads/confirm`, { uploadToken: ticket.body.uploadToken });
    expect([res.status, codeOf(res)]).toEqual([410, 'UPLOAD_EXPIRED']);
    // The ticket can never be confirmed now: its object is refused and deleted.
    expect(storage.objects.has(keyOf(ticket))).toBe(false);
    expect(await refusedCodes(ticket)).toEqual(['UPLOAD_EXPIRED']);
  });

  it('a confirm after the draft expired deletes the object (410 DRAFT_EXPIRED)', async () => {
    const v = visitor(firms.a.slug);
    const { leadId } = await start(v);
    const bytes = pdf('expired draft');
    const ticket = await v.post(`${D}/uploads`, file(bytes));
    await expireDraft(firms.a.id, leadId);
    expect(codeOf(await v.get(D))).toBe('DRAFT_EXPIRED');
    // The PUT lands after the expiry, then the confirm.
    storage.put(ticket.body as { url: string }, bytes);
    const res = await v.post(`${D}/uploads/confirm`, { uploadToken: ticket.body.uploadToken });
    expect([res.status, codeOf(res)]).toEqual([410, 'DRAFT_EXPIRED']);
    expect(storage.objects.has(keyOf(ticket))).toBe(false);
    expect(await refusedCodes(ticket)).toEqual(['DRAFT_EXPIRED']);
  });

  it("another firm's site never deletes a ticket's object", async () => {
    const v = visitor(firms.a.slug);
    await start(v);
    const bytes = pdf('firm a');
    const ticket = await v.post(`${D}/uploads`, file(bytes));
    storage.put(ticket.body as { url: string }, bytes);
    const b = visitor(firms.b.slug);
    await start(b, firms.b);
    const res = await b.post(`${D}/uploads/confirm`, { uploadToken: ticket.body.uploadToken });
    expect([res.status, codeOf(res)]).toEqual([410, 'UPLOAD_EXPIRED']);
    expect(storage.objects.has(keyOf(ticket))).toBe(true);
    expect(
      (await v.post(`${D}/uploads/confirm`, { uploadToken: ticket.body.uploadToken })).status,
    ).toBe(200);
  });

  it("open tickets count toward the slot's maxFiles; a confirm or refusal settles one", async () => {
    const v = visitor(firms.a.slug);
    await start(v);
    const field = intakeFields(ANNUAL_TAX_FORM).find((f) => f.key === 'governmentId');
    const max = field?.type === 'upload' ? field.maxFiles : 0;
    const bytes = pdf('ticket cap');
    const tickets: Response[] = [];
    for (let i = 0; i < max; i++) {
      const ticket = await v.post(`${D}/uploads`, file(bytes));
      expect(ticket.status).toBe(200);
      tickets.push(ticket);
    }
    const over = await v.post(`${D}/uploads`, file(bytes));
    expect([over.status, codeOf(over)]).toEqual([409, 'TOO_MANY_FILES']);
    const [first, second] = tickets;
    storage.put(first!.body as { url: string }, bytes);
    expect(
      (await v.post(`${D}/uploads/confirm`, { uploadToken: first!.body.uploadToken })).status,
    ).toBe(200);
    // A confirmed file still takes its place.
    expect((await v.post(`${D}/uploads`, file(bytes))).status).toBe(409);
    storage.put(second!.body as { url: string }, pdf('other bytes'));
    expect(
      codeOf(await v.post(`${D}/uploads/confirm`, { uploadToken: second!.body.uploadToken })),
    ).toBe('UPLOAD_MISMATCH');
    // The refused ticket's place is free again, once: of two parallel tickets one is 409.
    const racing = await Promise.all([
      v.post(`${D}/uploads`, file(bytes)),
      v.post(`${D}/uploads`, file(bytes)),
    ]);
    expect(racing.map((r) => r.status).sort()).toEqual([200, 409]);
    // Another slot has its own room.
    expect((await v.post(`${D}/uploads`, file(bytes, 'incomeDocuments'))).status).toBe(200);
  });

  it("open tickets count toward the draft's maxFiles across slots", async () => {
    const v = visitor(firms.a.slug);
    const { leadId } = await start(v);
    for (let i = 0; i < 20; i++) await addFile(leadId, 'governmentId');
    for (let i = 0; i < 20; i++) await addFile(leadId, 'socialSecurityCard');
    for (let i = 0; i < INTAKE_LIMITS.maxFiles - 42; i++) await addFile(leadId, 'incomeDocuments');
    for (const slot of ['incomeDocuments', 'deductionDocuments']) {
      expect((await v.post(`${D}/uploads`, file(pdf(), slot))).status).toBe(200);
    }
    const res = await v.post(`${D}/uploads`, file(pdf(), 'businessDocuments'));
    expect([res.status, codeOf(res)]).toEqual([409, 'TOO_MANY_FILES']);
  });

  it('only a refusal of the last REFUSALS_SINCE_MS blocks a confirm (a time-bound search)', async () => {
    const v = visitor(firms.a.slug);
    const { leadId } = await start(v);
    const refusedAt = async (ticket: Response, createdAt: Date) =>
      asOwner(firms.a.id, (tx) =>
        tx.auditLog.create({
          data: {
            businessId: firms.a.id,
            action: 'begin_online.upload_refused',
            entityType: 'lead',
            entityId: leadId,
            metadata: { uploadId: keyOf(ticket).split('/').at(-1)!, code: 'UPLOAD_MISMATCH' },
            createdAt,
          },
        }),
      );
    const bytes = pdf('refused before');
    const old = await v.post(`${D}/uploads`, file(bytes));
    storage.put(old.body as { url: string }, bytes);
    await refusedAt(old, new Date(Date.now() - REFUSALS_SINCE_MS - 60_000));
    expect(
      (await v.post(`${D}/uploads/confirm`, { uploadToken: old.body.uploadToken })).status,
    ).toBe(200);
    const recent = await v.post(`${D}/uploads`, file(bytes));
    storage.put(recent.body as { url: string }, bytes);
    await refusedAt(recent, new Date(Date.now() - REFUSALS_SINCE_MS + 60_000));
    const res = await v.post(`${D}/uploads/confirm`, { uploadToken: recent.body.uploadToken });
    expect([res.status, codeOf(res)]).toEqual([409, 'UPLOAD_MISMATCH']);
  });

  it('an expiry deletes the objects of tickets never confirmed', async () => {
    const v = visitor(firms.a.slug);
    const { leadId } = await start(v);
    const bytes = pdf('never confirmed');
    const ticket = await v.post(`${D}/uploads`, file(bytes));
    storage.put(ticket.body as { url: string }, bytes);
    const kept = visitor(firms.a.slug);
    await start(kept);
    const other = await kept.post(`${D}/uploads`, file(bytes));
    storage.put(other.body as { url: string }, bytes);
    await expireDraft(firms.a.id, leadId);
    await app.get(BeginOnlineSweep).run({ businessIds: [firms.a.id] });
    expect(storage.objects.has(keyOf(ticket))).toBe(false);
    // Another draft's ticket is not touched.
    expect(storage.objects.has(keyOf(other))).toBe(true);
  });

  it('refuses a slot not in the form, an oversize or mistyped file, and bytes that differ', async () => {
    const v = visitor(firms.a.slug);
    await start(v);
    const bytes = pdf();
    for (const body of [
      file(bytes, 'firstName'),
      file(bytes, 'noSuchSlot'),
      file(bytes, 'governmentId', { sizeBytes: 10 * 1024 * 1024 + 1 }),
      file(bytes, 'governmentId', { fileName: 'id-card.exe' }),
      file(bytes, 'governmentId', { contentType: 'text/html', fileName: 'x.html' }),
    ]) {
      const res = await v.post(`${D}/uploads`, body);
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    const ticket = await v.post(`${D}/uploads`, file(bytes));
    storage.put(ticket.body as { url: string }, pdf('other bytes, same length?'));
    const res = await v.post(`${D}/uploads/confirm`, { uploadToken: ticket.body.uploadToken });
    expect([res.status, codeOf(res)]).toEqual([409, 'UPLOAD_MISMATCH']);
  });

  it("409 TOO_MANY_FILES when the slot holds its field's maxFiles, at step 1 and at step 3", async () => {
    const v = visitor(firms.a.slug);
    const { leadId } = await start(v);
    const field = intakeFields(ANNUAL_TAX_FORM).find((f) => f.key === 'governmentId');
    const max = field?.type === 'upload' ? field.maxFiles : 0;
    expect(max).toBeGreaterThan(0);
    const bytes = pdf('late');
    // A ticket while there is room, then the slot fills before the confirm.
    const ticket = await v.post(`${D}/uploads`, file(bytes));
    expect(ticket.status).toBe(200);
    storage.put(ticket.body as { url: string }, bytes);
    for (let i = 0; i < max; i++) await addFile(leadId, 'governmentId');
    const late = await v.post(`${D}/uploads/confirm`, { uploadToken: ticket.body.uploadToken });
    expect([late.status, codeOf(late)]).toEqual([409, 'TOO_MANY_FILES']);
    const early = await v.post(`${D}/uploads`, file(bytes));
    expect([early.status, codeOf(early)]).toEqual([409, 'TOO_MANY_FILES']);
  });

  it('takes no files once the draft expired', async () => {
    const v = visitor(firms.a.slug);
    const { leadId } = await start(v);
    await expireDraft(firms.a.id, leadId);
    expect(codeOf(await v.post(`${D}/uploads`, file(pdf())))).toBe('DRAFT_EXPIRED');
    expect(codeOf(await v.get(`${D}/uploads`))).toBe('DRAFT_EXPIRED');
  });
});

describe('Begin Online: an expired draft (R0 refuses new data)', () => {
  it("maps the database's refusals of an expired draft to 410 DRAFT_EXPIRED", async () => {
    const v = visitor(firms.a.slug);
    const { leadId } = await start(v);
    const refused = (work: Parameters<typeof asOwner>[1]) =>
      asOwner(firms.a.id, work).then(
        () => null,
        (error: unknown) => expiredDraftRefusal(error) ?? error,
      );
    // Past its expiry in the database's clock, before the API has marked it EXPIRED.
    await expireDraft(firms.a.id, leadId);
    const upload = await refused((tx) =>
      tx.leadUpload.create({
        data: {
          businessId: firms.a.id,
          leadId,
          slot: 'governmentId',
          fileName: 'late.pdf',
          contentType: 'application/pdf',
          sizeBytes: 10,
          sha256: 'c'.repeat(64),
          s3Key: `tenant/${firms.a.id}/leads/${leadId}/${randomUUID()}`,
        },
      }),
    );
    const answers = await refused(async (tx) => {
      const intake = await tx.intake.findFirstOrThrow({ where: { leadId } });
      await tx.intakeSubmission.updateMany({
        where: { intakeId: intake.id },
        data: { answers: { firstName: 'Late' } },
      });
    });
    const link = await refused((tx) =>
      tx.lead.update({
        where: { id: leadId },
        data: { resumeTokenHash: 'f'.repeat(64), resumeExpiresAt: new Date() },
      }),
    );
    for (const error of [upload, answers, link]) {
      expect(error).toMatchObject({ status: 410, response: { code: 'DRAFT_EXPIRED' } });
    }
    // And the API answers the same for this browser.
    expect(codeOf(await v.get(D))).toBe('DRAFT_EXPIRED');
  });
});

describe('Begin Online submit', () => {
  /** A complete Annual Tax (single filer, personal return), as in the contract's tests. */
  const complete: Record<string, unknown> = {
    firstName: 'Avery',
    lastName: 'Example',
    dateOfBirth: '1985-04-12',
    phone: '(404) 555-0123',
    email: `avery.submit.${run}@example.com`,
    ssn: '900-12-3456',
    street: '100 Example Way',
    city: 'Atlanta',
    state: 'GA',
    zip: '30301',
    filingStatus: 'SINGLE',
    claimedAsDependent: false,
    returnTypes: ['PERSONAL'],
    legalStatus: 'US_CITIZEN',
    armedForces: false,
    hasDependents: false,
    socialSecurityCard: { notAvailable: true, reason: 'Ordered a replacement card.' },
    certifyDocuments: true,
    paymentPreference: 'PAY_AFTER',
  };
  /** The complete answers of one step. */
  const stepAnswers = (key: string, values = complete) => {
    const step = ANNUAL_TAX_FORM.steps.find((s) => s.key === key)!;
    const keys = new Set(intakeStepFields(step).map((f) => f.key));
    return Object.fromEntries(Object.entries(values).filter(([k]) => keys.has(k)));
  };
  /** Firm A's submit body (R14's sign(): its firm-wide agreement and its Terms and Privacy). */
  let signature: { signature: ReturnType<typeof signatureFor> & { acceptLegal?: unknown } };
  /** Firm B has nothing to sign: any well-formed signature. */
  const nothingToSign = {
    signature: signatureFor(
      { agreementId: randomUUID(), version: 1, bodySha256: 'a'.repeat(64) },
      'Avery Example',
    ),
  };

  // The firm's own people: the shared fixture users must not gain a membership here, or the
  // other e2e files that list their firms see this one.
  const team = {
    owner: { id: randomUUID(), email: `r11-bo-owner-${run}@example.test` },
    staff: { id: randomUUID(), email: `r11-bo-staff-${run}@example.test` },
  };

  /** A started draft whose personal step is married (so a spouse slot is shown) or `values`. */
  async function filled(v: Visitor, firm = firms.a, values = complete) {
    const started = await start(v, firm);
    const res = await v.put(`${D}/steps/personal`, { answers: stepAnswers('personal', values) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return started;
  }

  beforeAll(async () => {
    await asOwner(null, async (tx) => {
      for (const [key, p] of Object.entries(team)) {
        await tx.user.create({
          data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
        });
      }
    });
    await asOwner(firms.a.id, async (tx) => {
      await tx.membership.create({
        data: { businessId: firms.a.id, userId: team.owner.id, role: 'OWNER', status: 'ACTIVE' },
      });
      await tx.membership.create({
        data: { businessId: firms.a.id, userId: team.staff.id, role: 'STAFF', status: 'ACTIVE' },
      });
      // Firm A has its firm-wide intake agreement (no PDF) and its Terms and Privacy published;
      // firm B has none.
      await publishFirmWideAgreement(tx, firms.a.id, team.owner.id);
      for (const kind of ['TERMS', 'PRIVACY'] as const) {
        await tx.firmLegalDocument.create({
          data: {
            businessId: firms.a.id,
            kind,
            version: 1,
            body: 'Not legal text.',
            publishedByUserId: team.owner.id,
          },
        });
      }
      signature = {
        signature: {
          ...signatureFor(
            await firmWideVersion(tx, firms.a.id),
            'Avery Example',
            '  avery   EXAMPLE ',
          ),
          acceptLegal: { termsVersion: 1, privacyVersion: 1 },
        },
      };
    });
  });

  it('without a published firm-wide agreement: 409 NO_INTAKE_AGREEMENT and nothing changes', async () => {
    const v = visitor(firms.b.slug);
    const married = { ...complete, filingStatus: 'MARRIED_FILING_JOINTLY' };
    const { leadId } = await filled(v, firms.b, married);
    const hidden = await addFile(leadId, 'spouseGovernmentId', firms.b);
    await addFile(leadId, 'governmentId', firms.b);
    const personal = { ...stepAnswers('personal'), ssn: { last4: '3456' } };
    expect((await v.put(`${D}/steps/personal`, { answers: personal })).status).toBe(200);
    for (const step of ['documents', 'review']) {
      expect((await v.put(`${D}/steps/${step}`, { answers: stepAnswers(step) })).status).toBe(200);
    }
    const read = () =>
      asOwner(firms.b.id, (tx) =>
        tx.lead.findUniqueOrThrow({
          where: { id: leadId },
          include: {
            intakes: { include: { submissions: true, signatures: true } },
            uploads: { orderBy: { slot: 'asc' } },
          },
        }),
      );
    const before = await read();
    const sentBefore = outbox.length;

    const res = await v.post(`${D}/submit`, nothingToSign);
    expect([res.status, codeOf(res)]).toEqual([409, 'NO_INTAKE_AGREEMENT']);
    expect(res.body.error.message).toBe(
      "This form can't be signed right now. Please contact the firm.",
    );
    expect(res.headers['set-cookie']).toBeUndefined();

    const after = await read();
    expect(after).toEqual(before);
    expect(after.status).toBe('DRAFT');
    expect(after.intakes[0]?.submissions[0]?.submittedAt).toBeNull();
    expect(after.intakes[0]?.signatures).toEqual([]);
    expect(after.uploads.map((u) => u.slot)).toEqual(['governmentId', 'spouseGovernmentId']);
    expect(storage.objects.has(hidden)).toBe(true);
    expect(outbox.length).toBe(sentBefore);
    // The draft is still open with the same cookie.
    expect((await v.get(D)).status).toBe(200);
  });

  it('checks the whole form, removes hidden-slot files, locks the version and emails', async () => {
    const v = visitor(firms.a.slug);
    const married = { ...complete, filingStatus: 'MARRIED_FILING_JOINTLY' };
    const { leadId, email } = await filled(v, firms.a, married);
    const kept = await addFile(leadId, 'governmentId');
    const hidden = await addFile(leadId, 'spouseGovernmentId');
    // A resume link sent before the submit answers 409 DRAFT_SUBMITTED after it.
    const mailsBefore = outbox.length;
    expect((await v.post('/resume-link', { email })).status).toBe(200);
    await linksIdle();
    const link = outbox
      .slice(mailsBefore)
      .find((m) => m.template === 'begin-online.resume-link' && m.to === email)!;
    const token = (link.data as { link: string }).link.split('#token=')[1]!;

    // Incomplete: the documents and review steps are not answered yet.
    const early = await v.post(`${D}/submit`, signature);
    expect([early.status, codeOf(early)]).toEqual([400, 'VALIDATION_FAILED']);
    expect(early.body.error.details.issues.length).toBeGreaterThan(0);

    const personal = { ...stepAnswers('personal'), ssn: { last4: '3456' } };
    expect((await v.put(`${D}/steps/personal`, { answers: personal })).status).toBe(200);
    // The review step's answers come with the submit (saved first as that step).
    expect(
      (await v.put(`${D}/steps/documents`, { answers: stepAnswers('documents') })).status,
    ).toBe(200);
    const sig = signature.signature;
    const refusals: [object, number, string][] = [
      [{}, 400, 'VALIDATION_FAILED'],
      [
        { signature: { ...sig, signer: { ...sig.signer, typedSignature: 'Someone Else' } } },
        400,
        'VALIDATION_FAILED',
      ],
      // The same name to the API, not to Postgres' case folding (a dotted capital I).
      [
        {
          signature: {
            ...sig,
            signer: {
              ...sig.signer,
              printedName: 'İvy Example',
              typedSignature: 'i̇vy example',
            },
          },
        },
        400,
        'SIGNATURE_MISMATCH',
      ],
      // The firm has published its Terms and Privacy: a lead accepts them, at their versions.
      [{ signature: { ...sig, acceptLegal: undefined } }, 400, 'VALIDATION_FAILED'],
      [{ signature: { ...sig, acceptLegal: null } }, 400, 'VALIDATION_FAILED'],
      [
        { signature: { ...sig, acceptLegal: { termsVersion: 2, privacyVersion: 1 } } },
        409,
        'TERMS_OUTDATED',
      ],
      [{ signature: { ...sig, acknowledgments: [] } }, 400, 'ACKNOWLEDGMENT_REQUIRED'],
      [
        { signature: { ...sig, agreements: [{ ...sig.agreements[0]!, version: 2 }] } },
        409,
        'AGREEMENT_OUTDATED',
      ],
    ];
    for (const [body, status, code] of refusals) {
      // Each from its own IP (5 submits a minute per IP), with this draft's cookie.
      const same = visitor(firms.a.slug);
      for (const [k, val] of v.jar) same.jar.set(k, val);
      const res = await same.post(`${D}/submit`, { ...body, answers: stepAnswers('review') });
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([status, code]);
    }
    const unsigned = await asOwner(firms.a.id, (tx) =>
      tx.intakeSignature.count({ where: { leadId } }),
    );
    expect(unsigned).toBe(0);

    // Firm B's site never sends firm A's draft.
    const b = visitor(firms.b.slug);
    b.jar.set(
      beginOnlineCookie(firms.b.slug, 'ANNUAL_TAX').name,
      v.jar.get(beginOnlineCookie(firms.a.slug, 'ANNUAL_TAX').name)!,
    );
    expect(codeOf(await b.post(`${D}/submit`, signature))).toBe('NOT_FOUND');

    // Two tickets never confirmed: one PUT before the submit, one after it.
    const upload = (name: string) => ({
      slot: 'governmentId',
      fileName: `${name}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: pdf(name).length,
      sha256: sha256(pdf(name)),
    });
    const unconfirmed = await v.post(`${D}/uploads`, upload('unconfirmed'));
    storage.put(unconfirmed.body as { url: string }, pdf('unconfirmed'));
    const late = await v.post(`${D}/uploads`, upload('late'));

    const sentBefore = outbox.length;
    const res = await v.post(`${D}/submit`, { ...signature, answers: stepAnswers('review') });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const submitted = BeginSubmitted.parse(res.body);
    expect(submitted).toMatchObject({ received: true, form: 'ANNUAL_TAX' });

    const lead = await asOwner(firms.a.id, (tx) =>
      tx.lead.findUniqueOrThrow({
        where: { id: leadId },
        include: { intakes: { include: { submissions: true } }, uploads: true },
      }),
    );
    expect(lead.status).toBe('SUBMITTED');
    expect(lead.submittedAt?.toISOString()).toBe(submitted.submittedAt);
    expect(lead.draftExpiresAt).not.toBeNull();
    expect(lead.intakes[0]?.status).toBe('SUBMITTED');
    const version = lead.intakes[0]!.submissions[0]!;
    expect(version).toMatchObject({ signerName: 'Avery Example', submittedByUserId: null });
    expect(version.submittedAt).not.toBeNull();
    expect(JSON.stringify(version.answers)).not.toMatch(/900-?12-?3456/);
    expect(lead.uploads.map((u) => u.slot)).toEqual(['governmentId']);
    expect(storage.objects.has(hidden)).toBe(false);
    expect(storage.objects.has(kept)).toBe(true);
    expect(storage.objects.has(keyOf(unconfirmed))).toBe(false);
    // A PUT after the submit: its confirm is 409 DRAFT_SUBMITTED and the object is deleted.
    storage.put(late.body as { url: string }, pdf('late'));
    const lateConfirm = await v.post(`${D}/uploads/confirm`, {
      uploadToken: late.body.uploadToken,
    });
    expect([lateConfirm.status, codeOf(lateConfirm)]).toEqual([409, 'DRAFT_SUBMITTED']);
    expect(storage.objects.has(keyOf(late))).toBe(false);
    expect(await refusedCodes(late)).toEqual(['DRAFT_SUBMITTED']);

    // The emails: the visitor's confirmation and the firm's owner (not staff); no answers.
    const mails = outbox.slice(sentBefore);
    expect(mails.map((m) => [m.template, m.to]).sort()).toEqual(
      [
        ['lead.confirmation', email],
        ['lead.received', team.owner.email],
      ].sort(),
    );
    const received = mails.find((m) => m.template === 'lead.received')!;
    expect(received.data).toEqual({
      serviceName: expect.any(String),
      link: expect.stringMatching(new RegExp(`/leads/${leadId}$`)),
    });
    expect(JSON.stringify(mails.map((m) => m.data))).not.toMatch(
      /Avery|Example|3456|Atlanta|30301/,
    );

    const audit = await asOwner(firms.a.id, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { entityId: leadId, action: 'begin_online.submitted' },
      }),
    );
    expect(audit.metadata).toMatchObject({ version: 1, removed: 1 });

    // From now on this draft's calls answer 409 DRAFT_SUBMITTED; a start begins a new one.
    for (const r of [
      await v.get(D),
      await v.post(`${D}/submit`, signature),
      await v.put(`${D}/steps/personal`, { answers: {} }),
      await v.post(`${D}/uploads`, {
        slot: 'governmentId',
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
      }),
      await visitor(firms.a.slug).post('/resume', { token }),
    ]) {
      expect([r.status, codeOf(r)]).toEqual([409, 'DRAFT_SUBMITTED']);
    }
    await start(v);
    expect((await v.get(D)).status).toBe(200);
  });
});
