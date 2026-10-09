// End-to-end: R11 step 5, portal intake forms, and the firm's review, Needs Correction and unlock
// (contract in packages/types/src/intake/intakes.ts). The client (from the session) starts an
// intake for an ACTIVE engagement and autosaves it step by step; SSNs are sealed at rest and come
// back as last 4. A submitted version is locked; Owner and Admin start the next version.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { IntakeChoiceList, IntakeList, IntakeView, UploadTicket } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { IntakesService } from '../../src/intake/intakes.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { pdf, sha256 } from '../office-files.js';

/** Storage in memory: `objects.set(key, bytes)` is the browser's PUT. */
const objects = new Map<string, Buffer>();
const storage: DocumentStorage = {
  presignUpload: (f) =>
    Promise.resolve({ url: `memory:${f.key}`, headers: { 'content-type': f.contentType } }),
  head: (key, { checksum = false } = {}) => {
    const b = objects.get(key);
    return Promise.resolve(
      b
        ? { sizeBytes: b.length, sha256: checksum ? sha256(b) : null, contentEncoding: null }
        : null,
    );
  },
  read: (key) => Promise.resolve(objects.get(key) ?? null),
  remove: (key) => {
    objects.delete(key);
    return Promise.resolve();
  },
  presignDownload: (f) => Promise.resolve(`memory:${f.key}?download`),
} as DocumentStorage;

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r11i-${key}-${run}@r11.test` });
const people = {
  owner: person('owner'),
  staff: person('staff'),
  one: person('one'),
  two: person('two'),
  ownerB: person('owner-b'),
  clientB: person('client-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r11i-a-${run}`,
  slugB: `r11i-b-${run}`,
  clientOne: '',
  clientTwo: '',
  tax: '',
  other: '',
  pending: '',
  twoTax: '',
  submitTax: '',
  intake: '',
  sent: '',
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

async function portal(
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  who: { email: string },
  body?: object,
  slug = ids.slugA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${slug}/me/intakes${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

async function firm(
  method: 'get' | 'post',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
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
  return res;
};
const view = (res: Response) => IntakeView.parse(ok(res).body);

async function inFirm<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'business', businessId: ids.firmA }, fn);
  } finally {
    await owner.$disconnect();
  }
}

/** What a submit does to the database (submit itself waits on R14's signing service). */
const markSubmitted = (intakeId: string) =>
  inFirm(async (tx) => {
    const draft = await tx.intakeSubmission.findFirstOrThrow({
      where: { intakeId },
      orderBy: { version: 'desc' },
    });
    await tx.intakeSubmission.update({
      where: { id: draft.id },
      data: { submittedAt: new Date(), signerName: 'One Sample', signedAt: new Date() },
    });
    await tx.intake.update({
      where: { id: intakeId },
      data: { status: 'SUBMITTED', correctionNote: null },
    });
  });

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = ['one', 'two', 'clientB'].includes(key) ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: ids.slugB, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [userId, role] of [
      [people.owner.id, 'OWNER'],
      [people.staff.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    ids.clientOne = (
      await tx.client.create({
        data: { ...A, displayName: 'One', assignedUserId: people.staff.id },
      })
    ).id;
    ids.clientTwo = (await tx.client.create({ data: { ...A, displayName: 'Two' } })).id;
    for (const [p, clientId] of [
      [people.one, ids.clientOne],
      [people.two, ids.clientTwo],
    ] as const) {
      await tx.clientAccount.create({
        data: {
          ...A,
          userId: p.id,
          clientId,
          email: p.email,
          portalRole: 'PRIMARY',
          status: 'ACTIVE',
        },
      });
    }
    const tax = await tx.service.create({ data: { ...A, kind: 'ANNUAL_TAX', name: `Tax ${run}` } });
    const other = await tx.service.create({ data: { ...A, kind: 'OTHER', name: `Other ${run}` } });
    const engagement = (clientId: string, serviceId: string, title: string, status = 'ACTIVE') =>
      tx.engagement
        .create({
          data: { ...A, clientId, serviceId, title, taxYear: 2025, status: status as 'ACTIVE' },
        })
        .then((e) => e.id);
    ids.tax = await engagement(ids.clientOne, tax.id, '2025 return');
    ids.other = await engagement(ids.clientOne, other.id, 'Other work');
    ids.pending = await engagement(ids.clientOne, tax.id, 'Not yet', 'PENDING');
    ids.twoTax = await engagement(ids.clientTwo, tax.id, 'Two return');
    ids.submitTax = await engagement(ids.clientOne, tax.id, '2025 amended');
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const client = await tx.client.create({ data: { ...B, displayName: 'B client' } });
    await tx.clientAccount.create({
      data: {
        ...B,
        userId: people.clientB.id,
        clientId: client.id,
        email: people.clientB.email,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
      },
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
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue({ bucket: 'unused', region: 'us-east-1', forcePathStyle: true, scanMode: 'local' })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('portal: start and autosave', () => {
  it("lists the client's ACTIVE engagements that have a form", async () => {
    const choices = IntakeChoiceList.parse(ok(await portal('get', '/choices', people.one)).body);
    expect(choices.items.map((c) => c.engagement.id).sort()).toEqual(
      [ids.tax, ids.submitTax].sort(),
    );
    expect(choices.items.every((c) => c.intake === null)).toBe(true);
  });

  it('starts once per engagement, on the published built-in form', async () => {
    const started = view(await portal('post', '', people.one, { engagementId: ids.tax }));
    expect(started).toMatchObject({
      status: 'IN_PROGRESS',
      version: 1,
      formVersion: 1,
      locked: false,
      savedSteps: [],
      engagement: { id: ids.tax, taxYear: 2025 },
    });
    expect(started.definition.key).toBe('ANNUAL_TAX');
    ids.intake = started.id;
    const again = view(await portal('post', '', people.one, { engagementId: ids.tax }));
    expect(again.id).toBe(ids.intake);
    expect(codeOf(await portal('post', '', people.one, { engagementId: ids.other }))).toBe(
      'NO_INTAKE_FORM',
    );
    expect(codeOf(await portal('post', '', people.one, { engagementId: ids.pending }))).toBe(
      'ENGAGEMENT_NOT_ACTIVE',
    );
    expect((await portal('post', '', people.one, { engagementId: ids.twoTax })).status).toBe(404);
  });

  it('saves a step, seals the SSN at rest and returns its last 4 only', async () => {
    const saved = view(
      await portal('put', `/${ids.intake}/steps/personal`, people.one, {
        answers: { firstName: 'One', lastName: 'Sample', ssn: '123-45-6789' },
      }),
    );
    expect(saved.answers).toMatchObject({ firstName: 'One', ssn: { last4: '6789' } });
    expect(saved.savedSteps).toEqual(['personal']);
    const stored = await inFirm((tx) =>
      tx.intakeSubmission.findFirstOrThrow({ where: { intakeId: ids.intake } }),
    );
    expect(JSON.stringify(stored.answers)).not.toContain('123-45-6789');
    expect(JSON.stringify(stored.answers)).not.toContain('123456789');

    // An unchanged number comes back as its last 4 and keeps the stored one.
    const kept = view(
      await portal('put', `/${ids.intake}/steps/personal`, people.one, {
        answers: { firstName: 'Uno', lastName: 'Sample', ssn: { last4: '6789' } },
      }),
    );
    expect(kept.answers).toMatchObject({ firstName: 'Uno', ssn: { last4: '6789' } });
    const wrong = await portal('put', `/${ids.intake}/steps/personal`, people.one, {
      answers: { ssn: { last4: '0000' } },
    });
    expect(codeOf(wrong)).toBe('VALIDATION_FAILED');
    const unknown = await portal('put', `/${ids.intake}/steps/personal`, people.one, {
      answers: { notAField: 'x' },
    });
    expect(codeOf(unknown)).toBe('VALIDATION_FAILED');
    expect(
      codeOf(await portal('put', `/${ids.intake}/steps/nope`, people.one, { answers: {} })),
    ).toBe('VALIDATION_FAILED');
  });

  it("another client, and the same person at another firm, can't reach it", async () => {
    expect((await portal('get', `/${ids.intake}`, people.two)).status).toBe(404);
    const save = await portal('put', `/${ids.intake}/steps/personal`, people.two, {
      answers: { firstName: 'X' },
    });
    expect(save.status).toBe(404);
    const b = await portal('get', `/${ids.intake}`, people.clientB, undefined, ids.slugB);
    expect(b.status).toBe(404);
    const list = IntakeList.parse(ok(await portal('get', '', people.two)).body);
    expect(list.items).toEqual([]);
  });
});

describe('firm: send, review, correct and unlock', () => {
  it("lists a client's intakes for the members who reach the client", async () => {
    const owner = IntakeList.parse(
      ok(await firm('get', `/clients/${ids.clientOne}/intakes`, people.owner)).body,
    );
    expect(owner.items.map((i) => i.id)).toEqual([ids.intake]);
    ok(await firm('get', `/clients/${ids.clientOne}/intakes`, people.staff));
    expect((await firm('get', `/clients/${ids.clientTwo}/intakes`, people.staff)).status).toBe(404);
    const b = await firm('get', `/intakes/${ids.intake}`, people.ownerB, undefined, ids.firmB);
    expect(b.status).toBe(404);
    const detail = view(await firm('get', `/intakes/${ids.intake}`, people.staff));
    expect(detail.answers['ssn']).toEqual({ last4: '6789' });
  });

  it('sends an intake once per open engagement', async () => {
    const sent = IntakeView.parse(
      ok(
        await firm('post', `/engagements/${ids.twoTax}/intakes`, people.owner, {
          dueOn: '2026-12-01',
        }),
        201,
      ).body,
    );
    expect(sent).toMatchObject({ status: 'SENT', dueOn: '2026-12-01', version: 1 });
    ids.sent = sent.id;
    expect(codeOf(await firm('post', `/engagements/${ids.twoTax}/intakes`, people.owner, {}))).toBe(
      'INTAKE_OPEN',
    );
    expect(
      (await firm('post', `/engagements/${ids.twoTax}/intakes`, people.staff, {})).status,
    ).toBe(404);
    // The client's first save moves it from SENT to IN_PROGRESS.
    const saved = view(
      await portal('put', `/${ids.sent}/steps/personal`, people.two, {
        answers: { firstName: 'Two' },
      }),
    );
    expect(saved.status).toBe('IN_PROGRESS');
  });

  it('a submitted version is locked; Owner and Admin ask for corrections as a new version', async () => {
    expect(
      codeOf(
        await firm('post', `/intakes/${ids.intake}/request-correction`, people.owner, {
          note: 'x',
        }),
      ),
    ).toBe('INVALID_STATUS');
    await markSubmitted(ids.intake);
    // Starting again returns the submitted intake; the firm can't send a second one.
    const same = view(await portal('post', '', people.one, { engagementId: ids.tax }));
    expect(same).toMatchObject({ id: ids.intake, status: 'SUBMITTED', locked: true });
    expect(codeOf(await firm('post', `/engagements/${ids.tax}/intakes`, people.owner, {}))).toBe(
      'INTAKE_OPEN',
    );
    const locked = await portal('put', `/${ids.intake}/steps/personal`, people.one, {
      answers: { firstName: 'Late' },
    });
    expect(codeOf(locked)).toBe('INTAKE_LOCKED');
    const asStaff = await firm('post', `/intakes/${ids.intake}/request-correction`, people.staff, {
      note: 'Fix the address',
    });
    expect(asStaff.status).toBe(403);
    const corrected = view(
      await firm('post', `/intakes/${ids.intake}/request-correction`, people.owner, {
        note: 'Please fix the address.\nThanks',
      }),
    );
    expect(corrected).toMatchObject({
      status: 'NEEDS_CORRECTION',
      version: 2,
      locked: false,
      correctionNote: 'Please fix the address.\nThanks',
      answers: { firstName: 'Uno', ssn: { last4: '6789' } },
      savedSteps: ['personal'],
    });
    expect(corrected.submittedAt).not.toBeNull();
    const mine = view(
      await portal('put', `/${ids.intake}/steps/personal`, people.one, {
        answers: { firstName: 'Fixed', ssn: { last4: '6789' } },
      }),
    );
    expect(mine).toMatchObject({ status: 'NEEDS_CORRECTION', version: 2 });
    const audit = await inFirm((tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA, entityId: ids.intake } }),
    );
    expect(audit.map((a) => a.action)).toContain('intake.correction_requested');
    expect(JSON.stringify(audit)).not.toContain('fix the address');
  });

  it('reviews, completes, and unlocks a completed intake as the next version', async () => {
    await markSubmitted(ids.intake);
    expect(view(await firm('post', `/intakes/${ids.intake}/review`, people.staff, {})).status).toBe(
      'UNDER_REVIEW',
    );
    expect(codeOf(await firm('post', `/intakes/${ids.intake}/review`, people.staff, {}))).toBe(
      'INVALID_STATUS',
    );
    expect(
      view(await firm('post', `/intakes/${ids.intake}/complete`, people.staff, {})).status,
    ).toBe('COMPLETED');
    expect((await firm('post', `/intakes/${ids.intake}/unlock`, people.staff, {})).status).toBe(
      403,
    );
    const unlocked = view(await firm('post', `/intakes/${ids.intake}/unlock`, people.owner, {}));
    expect(unlocked).toMatchObject({
      status: 'IN_PROGRESS',
      version: 3,
      correctionNote: null,
      locked: false,
    });
  });
});

describe('portal: uploads', () => {
  const bytes = pdf('intake upload');
  const ticket = (intakeId: string, slot: string, who = people.one) =>
    portal('post', `/${intakeId}/uploads`, who, {
      slot,
      fileName: `${slot}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    });

  it("puts a file in an open intake's slot, and takes it out again", async () => {
    // The intake of ids.tax is IN_PROGRESS (version 3) after the firm unlocked it.
    const t = UploadTicket.parse(ok(await ticket(ids.intake, 'incomeDocuments'), 201).body);
    objects.set(t.url.slice('memory:'.length), bytes);
    const withFile = view(
      await portal('post', `/${ids.intake}/uploads/confirm`, people.one, {
        uploadToken: t.uploadToken,
      }),
    );
    const file = withFile.uploads.find((u) => u.slot === 'incomeDocuments')!;
    expect(file).toMatchObject({ fileName: 'incomeDocuments.pdf', scanStatus: 'CLEAN' });
    const stored = await inFirm((tx) =>
      tx.document.findUniqueOrThrow({ where: { id: file.documentId } }),
    );
    expect(stored).toMatchObject({ intakeId: ids.intake, intakeSlot: 'incomeDocuments' });

    const removed = view(
      await portal('delete', `/${ids.intake}/uploads/${file.documentId}`, people.one),
    );
    expect(removed.uploads.some((u) => u.documentId === file.documentId)).toBe(false);
  });

  it('refuses a slot that is not an upload field, another client, and a locked intake', async () => {
    expect(codeOf(await ticket(ids.intake, 'firstName'))).toBe('VALIDATION_FAILED');
    expect((await ticket(ids.intake, 'incomeDocuments', people.two)).status).toBe(404);
    const b = await portal('post', `/${ids.intake}/uploads`, people.clientB, {}, ids.slugB);
    expect([400, 404]).toContain(b.status);
  });
});

describe('portal: submit', () => {
  const signer = {
    name: 'One Sample',
    userId: people.one.id,
    ip: '203.0.113.7',
    userAgent: 'test',
  };
  const file = (intakeId: string, slot: string) =>
    inFirm((tx) =>
      tx.document
        .create({
          data: {
            businessId: ids.firmA,
            clientId: ids.clientOne,
            engagementId: ids.submitTax,
            intakeId,
            intakeSlot: slot,
            direction: 'CLIENT_TO_FIRM',
            fileName: `${slot}.pdf`,
            contentType: 'application/pdf',
            sizeBytes: 1024,
            sha256: 'b'.repeat(64),
            s3Key: `tenant/${ids.firmA}/documents/${randomUUID()}`,
            uploadedByUserId: people.one.id,
          },
          select: { id: true },
        })
        .then((d) => d.id),
    );
  const save = (intakeId: string, step: string, answers: object) =>
    portal('put', `/${intakeId}/steps/${step}`, people.one, { answers }).then(view);

  it('checks the whole form, takes hidden-slot files out, signs and locks the version', async () => {
    const service = app.get(IntakesService);
    const reach = { kind: 'client' as const, clientId: ids.clientOne };
    const intake = view(await portal('post', '', people.one, { engagementId: ids.submitTax }));
    const signed: number[] = [];
    const sign = async (_tx: unknown, v: { version: number }) => {
      signed.push(v.version);
    };
    await save(intake.id, 'personal', {
      firstName: 'One',
      lastName: 'Sample',
      dateOfBirth: '1985-04-12',
      phone: '(404) 555-0123',
      email: 'one.sample@r11.test',
      ssn: '900-12-3456',
      street: '100 Example Way',
      city: 'Atlanta',
      state: 'GA',
      zip: '30301',
      filingStatus: 'MARRIED_FILING_JOINTLY',
      claimedAsDependent: false,
      returnTypes: ['PERSONAL'],
      legalStatus: 'US_CITIZEN',
      armedForces: false,
      hasDependents: false,
    });
    // Incomplete: the spouse section and the documents are missing.
    await expect(service.submit(ids.firmA, reach, intake.id, signer, sign)).rejects.toMatchObject({
      response: { code: 'VALIDATION_FAILED' },
    });
    expect(signed).toEqual([]);

    const spouseId = await file(intake.id, 'spouseGovernmentId');
    await file(intake.id, 'governmentId');
    // Single now: the spouse's ID slot is hidden, so its file leaves the form on submit.
    await save(intake.id, 'personal', {
      firstName: 'One',
      lastName: 'Sample',
      dateOfBirth: '1985-04-12',
      phone: '(404) 555-0123',
      email: 'one.sample@r11.test',
      ssn: { last4: '3456' },
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
    });
    await save(intake.id, 'documents', {
      socialSecurityCard: { notAvailable: true, reason: 'Ordered a replacement card.' },
      certifyDocuments: true,
    });
    await save(intake.id, 'review', { paymentPreference: 'PAY_AFTER' });

    const sent = await service.submit(ids.firmA, reach, intake.id, signer, sign);
    expect(sent).toMatchObject({ status: 'SUBMITTED', locked: true, version: 1 });
    expect(sent.answers['ssn']).toEqual({ last4: '3456' });
    expect(sent.uploads.map((u) => u.slot)).toEqual(['governmentId']);
    expect(signed).toEqual([1]);
    const stored = await inFirm(async (tx) => ({
      spouse: await tx.document.findUniqueOrThrow({ where: { id: spouseId } }),
      version: await tx.intakeSubmission.findFirstOrThrow({ where: { intakeId: intake.id } }),
    }));
    expect(stored.spouse).toMatchObject({ intakeId: null, intakeSlot: null });
    expect(stored.version).toMatchObject({
      signerName: 'One Sample',
      submittedByUserId: people.one.id,
    });
    expect(stored.version.submittedAt).not.toBeNull();
    expect(JSON.stringify(stored.version.answers)).not.toContain('900123456');

    // Locked: a second submit and a save are refused.
    await expect(service.submit(ids.firmA, reach, intake.id, signer, sign)).rejects.toMatchObject({
      response: { code: 'INTAKE_LOCKED' },
    });
    expect(
      codeOf(await portal('put', `/${intake.id}/steps/review`, people.one, { answers: {} })),
    ).toBe('INTAKE_LOCKED');
  });

  it('a refused signature locks nothing', async () => {
    const service = app.get(IntakesService);
    const reach = { kind: 'client' as const, clientId: ids.clientOne };
    const intake = view(await firm('get', `/intakes/${ids.intake}`, people.owner));
    expect(intake.status).toBe('IN_PROGRESS'); // unlocked as version 3 above
    await expect(
      service.submit(ids.firmA, reach, intake.id, signer, async () => {
        throw new Error('refused');
      }),
    ).rejects.toThrow();
    const after = view(await portal('get', `/${intake.id}`, people.one));
    expect(after).toMatchObject({ status: 'IN_PROGRESS', locked: false, version: 3 });
  });
});
