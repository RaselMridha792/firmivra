// Leads item n (R55): a lead's own files through the secure intake link
// (POST/DELETE /portal/{slug}/intake-link/uploads...; contract: packages/types/src/intake/link.ts).
// The lead adds files to the form's upload fields in the portal's three steps, with the firm's size
// limit, the type and the bytes checked and the file scanned; each is a lead_uploads row naming the
// intake. Every step works only through this browser's link cookie (firm, intake and token hash),
// a file is removed only by its own link while the form is open, submit counts the files, and a
// conversion keeps them with their intake. These tests are the routes' isolation walls too
// (test/isolation/cases/intake-link.ts). Synthetic data only.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  INTAKE_FORMS,
  type IntakeFormDefinition,
  IntakeUpload,
  intakeStepFields,
  LinkIntake,
  SendIntakeFormResult,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  type FileFacts,
} from '../../src/storage/document-storage.js';
import { firmWideVersion, publishFirmWideAgreement, signatureFor } from '../intake-signing.js';
import { MemoryUploads } from '../memory-uploads.js';
import { pdf, sha256 } from '../office-files.js';

/** Storage in memory: `put(ticket, bytes)` is the browser's PUT. */
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
const outbox: NotifyMessage[] = [];
const owners = {
  a: { id: randomUUID(), email: `r55-lu-owner-a-${run}@r55.test` },
  b: { id: randomUUID(), email: `r55-lu-owner-b-${run}@r55.test` },
};
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
const ids = {} as Record<string, string>;
let app: INestApplication;
let portalOrigin = '';
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.67.${100 + Math.floor(++viewers / 250)}.${viewers % 250}`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const inFirmA = <T>(work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms.a.id }, work);

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', `${viewer()}, 10.0.0.5`)
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

/** Firm A's owner on the firm's API. */
async function firmCall(method: 'post' | 'patch', path: string, body?: object) {
  const token = await tokenFor(owners.a.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms.a.id)
    .set('x-forwarded-for', `${viewer()}, 10.0.0.5`)
    .set('authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}

/** A browser on one firm's link page: its own IP, its cookie jar and the portal's origin. */
function visitor(slug: string) {
  const ip = viewer();
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    const raw = res.headers['set-cookie'] as unknown;
    for (const c of Array.isArray(raw) ? (raw as string[]) : []) {
      const [pair] = c.split(';');
      const at = pair!.indexOf('=');
      const name = pair!.slice(0, at);
      if (name.startsWith('fv_il_')) jar.set(name, pair!.slice(at + 1));
    }
    return res;
  };
  const send = (method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object) => {
    let req = request(app.getHttpServer())
      [method](`/api/v1/portal/${slug}/intake-link${path}`)
      .set('x-forwarded-for', `${ip}, 10.0.0.5`)
      .set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if (method !== 'get') req = req.set('origin', portalOrigin);
    return (body ? req.send(body) : req).then(keep);
  };
  return {
    jar,
    get: (path = '') => send('get', path),
    post: (path: string, body: object) => send('post', path, body),
    put: (path: string, body: object) => send('put', path, body),
    del: (path: string) => send('delete', path),
  };
}
type Visitor = ReturnType<typeof visitor>;

/** The Tax Planning form with one required upload field on its goals step. */
const SLOT = 'supportingDocuments';
const FORM: IntakeFormDefinition = (() => {
  const form = structuredClone(INTAKE_FORMS.TAX_PLANNING!);
  form.steps
    .find((s) => s.key === 'goals')!
    .sections[0]!.fields.push({
      key: SLOT,
      label: 'Supporting documents',
      required: true,
      type: 'upload',
      notAvailable: false,
      examples: [],
      maxFiles: 2,
    } as never);
  return form;
})();
const complete: Record<string, unknown> = {
  fullName: 'Lee Lead',
  phone: '(404) 555-0123',
  email: `lee.${run}@lead.test`,
  planningFor: 'INDIVIDUAL',
  businessStructure: 'SOLE_PROPRIETORSHIP',
  industry: 'CONSTRUCTION',
  operatingStates: ['GA'],
  accountingMethod: 'CASH',
  planningTaxYear: 2026,
  hasBookkeeper: 'NO',
  services: ['INDIVIDUAL'],
  reasons: ['REDUCE_LIABILITY'],
  multipleStates: false,
  filedRecentReturn: 'YES',
  taxIssues: false,
  taxProfessional: 'NO',
};
const stepAnswers = (key: string) => {
  const keys = new Set(
    intakeStepFields(FORM.steps.find((s) => s.key === key)!)
      .filter((f) => f.type !== 'upload')
      .map((f) => f.key),
  );
  return Object.fromEntries(Object.entries(complete).filter(([k]) => keys.has(k)));
};
const file = (bytes: Buffer, slot = SLOT, fields: Record<string, unknown> = {}) => ({
  slot,
  fileName: 'w2-synthetic.pdf',
  contentType: 'application/pdf',
  sizeBytes: bytes.length,
  sha256: sha256(bytes),
  ...fields,
});

/** Sends firm A's form to a lead by email and opens its link in a new browser. */
async function openLink(leadKey: string): Promise<{ id: string; v: Visitor; token: string }> {
  const res = await firmCall('post', '/intakes/send', {
    idempotencyKey: randomUUID(),
    recipient: { kind: 'LEAD', id: ids[leadKey] },
    formId: ids.template,
    channel: 'EMAIL',
    subject: 'Your tax planning form',
    message: 'Please fill this in.',
  });
  const sent = SendIntakeFormResult.parse(ok(res));
  const mail = outbox.filter((m) => m.template === 'intake.lead-link').at(-1)!;
  const token = /#token=([A-Za-z0-9_-]{43})$/.exec((mail.data as { link: string }).link)![1]!;
  const v = visitor(firms.a.slug);
  ok(await v.post('/open', { token }));
  return { id: sent.form.id, v, token };
}

/** Ticket, PUT and confirm: the stored file. */
async function upload(v: Visitor, bytes = pdf(`file ${randomUUID()}`)) {
  const ticket = ok(await v.post('/uploads', file(bytes))) as { url: string; uploadToken: string };
  storage.put(ticket, bytes);
  return IntakeUpload.parse(
    ok(await v.post('/uploads/confirm', { uploadToken: ticket.uploadToken })),
  );
}

beforeAll(async () => {
  process.env['KMS_MODE'] ??= 'local';
  process.env['LOCAL_KMS_KEY'] ??= randomBytes(32).toString('base64');
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const key of ['a', 'b'] as const) {
      const o = owners[key];
      await tx.user.create({
        data: { id: o.id, cognitoSub: o.id, pool: 'STAFF', email: o.email, name: `Fake ${key}` },
      });
      firms[key] = await tx.business.create({
        data: { slug: `r55-lu-${key}-${run}`, name: `R55 Link files ${key}`, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  for (const key of ['a', 'b'] as const) {
    await asOwner({ kind: 'business', businessId: firms[key].id }, (tx) =>
      tx.membership.create({
        data: {
          businessId: firms[key].id,
          userId: owners[key].id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      }),
    );
  }
  await inFirmA(async (tx) => {
    const businessId = firms.a.id;
    const service = await tx.service.create({
      data: { businessId, kind: 'TAX_PLANNING', name: `Tax Planning ${run}`, status: 'ACTIVE' },
      select: { id: true },
    });
    ids.service = service.id;
    const form = await tx.intakeForm.create({
      data: {
        businessId,
        serviceId: service.id,
        version: 1,
        title: 'Tax Planning Intake',
        definition: FORM as object,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      select: { templateId: true },
    });
    ids.template = form.templateId as string;
    for (const key of ['add', 'other', 'remove', 'remove2', 'submit', 'convert']) {
      ids[key] = (
        await tx.lead.create({
          data: {
            businessId,
            serviceId: service.id,
            status: 'CONTACTED',
            submittedAt: new Date(),
            firstName: 'Lee',
            lastName: `Lead ${key} (fake)`,
            email: `lee-${key}-${run}@lead.test`,
            phone: '(404) 555-0199',
          },
          select: { id: true },
        })
      ).id;
    }
    await publishFirmWideAgreement(tx, businessId, owners.a.id);
  });
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

describe("a lead's files through the secure link (Leads item n)", () => {
  it('adds a checked, scanned file to an upload field, on a row naming the intake', async () => {
    const { id, v } = await openLink('add');
    const saved = await upload(v);
    expect(saved).toMatchObject({ slot: SLOT, fileName: 'w2-synthetic.pdf', status: 'READY' });
    expect(LinkIntake.parse(ok(await v.get())).uploads.map((u) => u.id)).toEqual([saved.id]);
    const row = await inFirmA((tx) => tx.leadUpload.findUniqueOrThrow({ where: { id: saved.id } }));
    expect(row).toMatchObject({
      intakeId: id,
      leadId: ids.add,
      uploadedByUserId: null,
      scanStatus: 'CLEAN',
    });
    expect(row.s3Key.startsWith(`tenant/${firms.a.id}/leads/${ids.add}/`)).toBe(true);
    const audit = await inFirmA((tx) =>
      tx.auditLog.findMany({ where: { entityId: id, action: { startsWith: 'intake_link.' } } }),
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['intake_link.upload_started', 'intake_link.upload_confirmed']),
    );
    expect(JSON.stringify(audit)).not.toContain('w2-synthetic');
  });

  it('refuses a field that is not an upload, a file over the firm limit or with other bytes', async () => {
    const { v } = await openLink('other');
    expectError(await v.post('/uploads', file(pdf(), 'fullName')), 400, 'VALIDATION_FAILED');
    expectError(
      // Over the firm's limit (10 MB until Intake Form Settings sets one).
      await v.post('/uploads', file(pdf(), SLOT, { sizeBytes: 20 * 1024 * 1024 })),
      400,
      'VALIDATION_FAILED',
    );
    // Bytes that are not the PDF the ticket described: refused, and the object deleted.
    const bytes = pdf('described');
    const ticket = ok(await v.post('/uploads', file(bytes))) as {
      url: string;
      uploadToken: string;
    };
    storage.put(ticket, Buffer.from('not the same bytes at all'));
    const refused = await v.post('/uploads/confirm', { uploadToken: ticket.uploadToken });
    expect(refused.status).toBe(409);
    expect(storage.objects.has(ticket.url.slice('memory:'.length))).toBe(false);
    // The slot's cap (2), counted with open tickets.
    await upload(v);
    await upload(v);
    expectError(await v.post('/uploads', file(pdf('third'))), 409, 'TOO_MANY_FILES');
  });

  it("removes only this link's own file, and only while the form is open", async () => {
    const mine = await openLink('remove');
    const theirs = await openLink('remove2');
    const file1 = await upload(mine.v);
    // Another lead's link, a made-up id and another firm's slug find nothing.
    expectError(await theirs.v.del(`/uploads/${file1.id}`), 404, 'NOT_FOUND');
    expectError(await mine.v.del(`/uploads/${randomUUID()}`), 404, 'NOT_FOUND');
    expectError(await visitor(firms.b.slug).del(`/uploads/${file1.id}`), 410, 'LINK_INVALID');
    // The same browser after a resend replaced its link: 410, the file stays.
    ok(await firmCall('post', `/intakes/${mine.id}/resend`));
    expectError(await mine.v.del(`/uploads/${file1.id}`), 410, 'LINK_INVALID');
    expectError(await mine.v.post('/uploads', file(pdf())), 410, 'LINK_INVALID');
    expect(await inFirmA((tx) => tx.leadUpload.count({ where: { id: file1.id } }))).toBe(1);
    // Through the new link it goes, with its object.
    const mail = outbox.filter((m) => m.template === 'intake.lead-link').at(-1)!;
    const fresh = /#token=([A-Za-z0-9_-]{43})$/.exec((mail.data as { link: string }).link)![1]!;
    const again = visitor(firms.a.slug);
    ok(await again.post('/open', { token: fresh }));
    const key = (
      await inFirmA((tx) => tx.leadUpload.findUniqueOrThrow({ where: { id: file1.id } }))
    ).s3Key;
    ok(await again.del(`/uploads/${file1.id}`));
    expect(await inFirmA((tx) => tx.leadUpload.count({ where: { id: file1.id } }))).toBe(0);
    expect(storage.objects.has(key)).toBe(false);
  });

  it('submit needs the required upload, counts the link files, then nothing changes', async () => {
    const { id, v } = await openLink('submit');
    for (const step of ['profile', 'finances', 'goals']) {
      ok(await v.put(`/steps/${step}`, { answers: stepAnswers(step) }));
    }
    const signature = signatureFor(
      await inFirmA((tx) => firmWideVersion(tx, firms.a.id)),
      'Lee Lead',
    );
    const missing = await v.post('/submit', { answers: {}, signature });
    expectError(missing, 400, 'VALIDATION_FAILED');
    expect(JSON.stringify(missing.body)).toContain(SLOT);
    const saved = await upload(v);
    const done = LinkIntake.parse(ok(await v.post('/submit', { answers: {}, signature })));
    expect(done).toMatchObject({ status: 'SUBMITTED', canEdit: false });
    expect(done.uploads.map((u) => u.id)).toEqual([saved.id]);
    expectError(await v.post('/uploads', file(pdf())), 409, 'INTAKE_LOCKED');
    expectError(await v.del(`/uploads/${saved.id}`), 409, 'INTAKE_LOCKED');
    expect(await inFirmA((tx) => tx.leadUpload.count({ where: { intakeId: id } }))).toBe(1);
  });

  it('a conversion keeps a link file with its intake, as a client file', async () => {
    const { id, v } = await openLink('convert');
    const saved = await upload(v);
    const res = await firmCall('post', `/leads/${ids.convert}/convert-to-client`, {
      idempotencyKey: randomUUID(),
      accountType: 'INDIVIDUAL',
      fullName: 'Lee Lead convert',
      email: `lee-convert-${run}@lead.test`,
      phone: '+15550100999',
      serviceIds: [ids.service],
      primaryStaffUserId: owners.a.id,
      sendPortalInvite: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const doc = await inFirmA((tx) =>
      tx.document.findFirstOrThrow({ where: { leadUploadId: saved.id } }),
    );
    const intake = await inFirmA((tx) => tx.intake.findUniqueOrThrow({ where: { id } }));
    expect(doc).toMatchObject({
      intakeId: id,
      intakeSlot: SLOT,
      engagementId: intake.engagementId,
      direction: 'CLIENT_TO_FIRM',
    });
  });
});
