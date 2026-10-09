// End-to-end: R14 intake agreements (docs/api/agreements.yaml). Firm routes are for the Owner and
// Admin; one firm never sees or changes another's; the Begin Online block reads only ACTIVE firms
// by slug and form; the portal intake block answers only the signed-in client's own intake.
// Audit entries carry ids and version numbers, never the text.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AgreementVersion,
  FirmAgreementDetail,
  FirmAgreementList,
  FirmAgreementSummary,
  IntakeAgreementBlock,
} from '@firmivra/types';
import { AGREEMENTS_CONFIG } from '../../src/agreements/agreements.service.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r14-${key}-${run}@r14.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  clientA: person('client-a'),
  clientA2: person('client-a2'),
  ownerB: person('owner-b'),
  clientB: person('client-b'),
};
type Firm = {
  id: string;
  slug: string;
  serviceId: string;
  cleanFile: string;
  files: string[];
  /** The first client's intake on the service (firm A: clientA's; firm B: clientB's). */
  intakeId: string;
};
const firms = {} as Record<'a' | 'b' | 'pending', Firm>;
const sha = (n: number) => n.toString(16).padStart(64, '0');
/** clientA2's own intake in firm A. */
let intakeA2 = '';

let app: INestApplication;
/** On for these tests (PDF rules); the Pending Setup firm's test turns it off. */
const pdfConfig = { pdfRequired: true };
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
  method: 'get' | 'post',
  path: string,
  who: { email: string },
  businessId: string,
  body?: object,
): Promise<Response> {
  const token = await tokenFor(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/agreements${path}`)
    .set('authorization', `Bearer ${token}`)
    .set('x-business-id', businessId);
  return body === undefined ? req : req.send(body);
}
const asA = (method: 'get' | 'post', path: string, body?: object, who = people.ownerA) =>
  call(method, path, who, firms.a.id, body);
const block = (slug: string, form?: string) =>
  request(app.getHttpServer())
    .get(`/api/v1/portal/${slug}/intake-agreements`)
    .query(form ? { form } : {});
const myBlock = async (slug: string, intakeId: string, who?: { email: string }) => {
  const req = request(app.getHttpServer()).get(
    `/api/v1/portal/${slug}/me/intakes/${intakeId}/agreements`,
  );
  return who ? req.set('authorization', `Bearer ${await tokenFor(who.email)}`) : req;
};

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ack = { key: 'read_agreement', label: 'I read it', text: 'I have read it.', required: true };
const version = (expectedCurrentVersion: number | null, pdfFileId: string | null, extra = {}) => ({
  expectedCurrentVersion,
  title: 'Client Intake Agreement (sample)',
  bodyMarkdown: '# Sample\n\nNot legal text.',
  acknowledgments: [ack],
  pdfFileId,
  ...extra,
});

async function auditRows(businessId: string, action: string) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const rows = await runInScope(owner, { kind: 'business', businessId }, (tx) =>
    tx.auditLog.findMany({ where: { businessId, action }, orderBy: { createdAt: 'asc' } }),
  );
  await owner.$disconnect();
  return rows;
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key.startsWith('client') ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R14 ${key}` },
      });
    }
    for (const [key, status] of [
      ['a', 'ACTIVE'],
      ['b', 'ACTIVE'],
      ['pending', 'PENDING_SETUP'],
    ] as const) {
      const slug = `r14-${key}-${run}`;
      const firm = await tx.business.create({ data: { slug, name: slug, status } });
      firms[key] = { id: firm.id, slug, serviceId: '', cleanFile: '', files: [], intakeId: '' };
    }
  });
  const members = [
    ['a', people.ownerA.id, 'OWNER'],
    ['a', people.adminA.id, 'ADMIN'],
    ['a', people.staffA.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
    ['pending', people.ownerB.id, 'OWNER'],
  ] as const;
  for (const [key, userId, role] of members) {
    const businessId = firms[key].id;
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
  // Each firm: a service, and files a version may link (CLEAN, PENDING, INFECTED).
  for (const [key, firm] of Object.entries(firms)) {
    const businessId = firm.id;
    const uploader = key === 'a' ? people.ownerA.id : people.ownerB.id;
    await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      firm.serviceId = (
        await tx.service.create({ data: { businessId, kind: 'BOOKKEEPING', name: 'Books' } })
      ).id;
      // Clients with a login and an intake on the service (firm A: two, firm B: one).
      const logins =
        key === 'a' ? [people.clientA, people.clientA2] : key === 'b' ? [people.clientB] : [];
      for (const login of logins) {
        const client = await tx.client.create({
          data: { businessId, displayName: `Fake ${login.email}`, email: login.email },
        });
        await tx.clientAccount.create({
          data: {
            businessId,
            userId: login.id,
            clientId: client.id,
            email: login.email,
            status: 'ACTIVE',
          },
        });
        const engagement = await tx.engagement.create({
          data: { businessId, clientId: client.id, serviceId: firm.serviceId, title: 'Books' },
        });
        const form =
          (await tx.intakeForm.findFirst({ where: { serviceId: firm.serviceId } })) ??
          (await tx.intakeForm.create({
            data: {
              businessId,
              serviceId: firm.serviceId,
              version: 1,
              title: 'Fake bookkeeping intake',
              status: 'PUBLISHED',
              publishedAt: new Date(),
            },
          }));
        const intake = await tx.intake.create({
          data: { businessId, formId: form.id, engagementId: engagement.id },
        });
        if (!firm.intakeId) firm.intakeId = intake.id;
        if (login === people.clientA2) intakeA2 = intake.id;
      }
      for (const [n, scan] of (['CLEAN', 'PENDING', 'INFECTED', 'CLEAN'] as const).entries()) {
        const id = randomUUID();
        await tx.firmAgreementFile.create({
          data: {
            id,
            businessId,
            fileName: `sample-${n}.pdf`,
            sizeBytes: 1000 + n,
            sha256: sha(n + 1),
            s3Key: `tenant/${businessId}/agreements/${id}.pdf`,
            uploadedByUserId: uploader,
          },
        });
        if (scan !== 'PENDING') {
          await tx.firmAgreementFile.update({
            where: { id },
            data: { scanStatus: scan, scannedAt: new Date() },
          });
        }
        firm.files.push(id);
      }
      firm.cleanFile = firm.files[0]!;
    });
  }
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  })
    .overrideProvider(AGREEMENTS_CONFIG)
    .useValue(pdfConfig)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('firm agreements', () => {
  let firmWide: string;
  let service: string;

  it('the Begin Online block is not ready before a firm-wide version', async () => {
    const res = await block(firms.a.slug, 'BOOKKEEPING');
    expect(res.status).toBe(200);
    expect(IntakeAgreementBlock.parse(res.body)).toEqual({
      ready: false,
      agreements: [],
      legal: null,
    });
  });

  it('creates one firm-wide agreement and service agreements', async () => {
    const created = await asA('post', '', { scope: 'ALL_INTAKES' }, people.adminA);
    expect(created.status).toBe(201);
    firmWide = FirmAgreementSummary.parse(created.body).id;
    expect(created.body).toMatchObject({ scope: 'ALL_INTAKES', current: null, versionCount: 0 });
    const again = await asA('post', '', { scope: 'ALL_INTAKES' });
    expect([again.status, codeOf(again)]).toEqual([409, 'FIRM_WIDE_EXISTS']);

    const svc = await asA('post', '', { scope: 'SERVICE', serviceId: firms.a.serviceId });
    expect(svc.status).toBe(201);
    service = (svc.body as { id: string }).id;
    expect(svc.body).toMatchObject({ service: { id: firms.a.serviceId, name: 'Books' } });
    // Another firm's service, a made-up one, and a body naming the firm.
    expect((await asA('post', '', { scope: 'SERVICE', serviceId: firms.b.serviceId })).status).toBe(
      404,
    );
    expect((await asA('post', '', { scope: 'SERVICE', serviceId: randomUUID() })).status).toBe(404);
    expect((await asA('post', '', { scope: 'ALL_INTAKES', businessId: firms.b.id })).status).toBe(
      400,
    );
    expect((await auditRows(firms.a.id, 'agreement.created')).length).toBe(2);
  });

  it('publishes versions: PDF rules, version conflicts, required acknowledgment', async () => {
    const publish = (body: object) => asA('post', `/${firmWide}/versions`, body);
    const [, pending, infected] = firms.a.files;
    const refused: [object, number, string][] = [
      [version(null, null), 409, 'PDF_REQUIRED'],
      [version(null, pending!), 409, 'FILE_NOT_READY'],
      [version(null, infected!), 409, 'FILE_BLOCKED'],
      [version(null, firms.b.cleanFile), 404, 'NOT_FOUND'],
      [version(1, firms.a.cleanFile), 409, 'VERSION_CONFLICT'],
      [version(null, firms.a.cleanFile, { acknowledgments: [] }), 400, 'VALIDATION_FAILED'],
    ];
    for (const [body, status, code] of refused) {
      const res = await publish(body);
      expect([res.status, codeOf(res)]).toEqual([status, code]);
    }

    const v1 = await publish(version(null, firms.a.cleanFile, { effectiveDate: '2026-10-01' }));
    expect(v1.status).toBe(201);
    const first = AgreementVersion.parse(v1.body);
    expect(first).toMatchObject({
      version: 1,
      effectiveDate: '2026-10-01',
      publishedBy: { userId: people.ownerA.id, name: 'Fake R14 ownerA' },
      pdf: { fileId: firms.a.cleanFile, sha256: sha(1) },
      acknowledgments: [ack],
    });
    expect(first.bodySha256).toMatch(/^[0-9a-f]{64}$/);

    // Two publishers on version 1 at once: one wins, the other gets VERSION_CONFLICT.
    const pair = await Promise.all(
      [0, 1].map(() => publish(version(1, firms.a.files[3]!, { title: 'Version 2' }))),
    );
    expect(pair.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(pair.map(codeOf)).toContain('VERSION_CONFLICT');

    const detail = FirmAgreementDetail.parse((await asA('get', `/${firmWide}`)).body);
    expect(detail.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(detail.current?.version).toBe(2);
    const one = await asA('get', `/${firmWide}/versions/1`);
    expect(AgreementVersion.parse(one.body).bodyMarkdown).toBe('# Sample\n\nNot legal text.');
    expect((await asA('get', `/${firmWide}/versions/9`)).status).toBe(404);
    expect((await asA('get', `/${firmWide}/versions/01`)).status).toBe(400);

    // A service agreement needs no acknowledgment.
    const sv = await asA('post', `/${service}/versions`, {
      ...version(null, firms.a.cleanFile),
      acknowledgments: [],
    });
    expect(sv.status).toBe(201);

    const audits = await auditRows(firms.a.id, 'agreement.version_published');
    expect(audits).toHaveLength(3);
    expect(JSON.stringify(audits)).not.toContain('Not legal text');
  });

  it('lists the firm-wide agreement first and archives service agreements only', async () => {
    const list = FirmAgreementList.parse((await asA('get', '')).body);
    expect(list.items.map((i) => i.id)).toEqual([firmWide, service]);
    expect(list.services).toContainEqual({
      id: firms.a.serviceId,
      name: 'Books',
      kind: 'BOOKKEEPING',
    });
    expect(list.services.map((s) => s.id)).not.toContain(firms.b.serviceId);

    const fw = await asA('post', `/${firmWide}/archive`);
    expect([fw.status, codeOf(fw)]).toEqual([409, 'FIRM_WIDE_REQUIRED']);
    const archived = await asA('post', `/${service}/archive`);
    expect(archived.status).toBe(200);
    expect((archived.body as { archivedAt: string | null }).archivedAt).not.toBeNull();
    expect((await asA('post', `/${service}/archive`)).status).toBe(200);
    expect(await auditRows(firms.a.id, 'agreement.archived')).toHaveLength(1);
    const late = await asA('post', `/${service}/versions`, version(1, firms.a.cleanFile));
    expect([late.status, codeOf(late)]).toEqual([409, 'AGREEMENT_ARCHIVED']);
  });

  it('staff get 403; another firm gets 404 for every route', async () => {
    expect((await asA('get', '', undefined, people.staffA)).status).toBe(403);
    expect((await asA('post', '', { scope: 'ALL_INTAKES' }, people.staffA)).status).toBe(403);
    for (const [method, path, body] of [
      ['get', `/${firmWide}`],
      ['get', `/${firmWide}/versions/1`],
      ['post', `/${firmWide}/versions`, version(2, firms.a.cleanFile)],
      ['post', `/${service}/archive`],
    ] as const) {
      expect((await asA(method, path, body, people.staffA)).status).toBe(403);
    }
    const asB = (method: 'get' | 'post', path: string, body?: object) =>
      call(method, path, people.ownerB, firms.b.id, body);
    const listB = FirmAgreementList.parse((await asB('get', '')).body);
    expect(listB.items).toEqual([]);
    expect(listB.services.map((s) => s.id)).toContain(firms.b.serviceId);
    expect(listB.services.map((s) => s.id)).not.toContain(firms.a.serviceId);
    for (const [method, path, body] of [
      ['get', `/${firmWide}`],
      ['get', `/${firmWide}/versions/1`],
      ['post', `/${firmWide}/versions`, version(2, firms.b.cleanFile)],
      ['post', `/${service}/archive`],
    ] as const) {
      expect((await asB(method, path, body)).status).toBe(404);
    }
    // Firm B's owner naming firm A.
    expect((await call('get', '', people.ownerB, firms.a.id)).status).toBe(404);
  });

  it('the Begin Online block: by form, firm-wide first, then the service in order', async () => {
    // The first service agreement is archived; two new ones are published, a third is not.
    const extras: string[] = [];
    for (const n of [1, 2, 3]) {
      const created = await asA('post', '', { scope: 'SERVICE', serviceId: firms.a.serviceId });
      const id = FirmAgreementSummary.parse(created.body).id;
      if (n < 3) {
        const published = await asA('post', `/${id}/versions`, {
          ...version(null, firms.a.cleanFile, { title: `Extra ${n}` }),
          acknowledgments: [],
        });
        expect(published.status).toBe(201);
        extras.push(id);
      }
    }
    const res = await block(firms.a.slug.toUpperCase(), 'BOOKKEEPING');
    const parsed = IntakeAgreementBlock.parse(res.body);
    expect(parsed.ready).toBe(true);
    expect(parsed.agreements.map((a) => a.agreementId)).toEqual([firmWide, ...extras]);
    expect(parsed.agreements[0]).toMatchObject({
      agreementId: firmWide,
      scope: 'ALL_INTAKES',
      version: 2,
      title: 'Version 2',
      // No PDF download route yet, so never offered; the hash is still signed.
      pdf: { available: false, sha256: sha(4) },
    });
    expect(parsed.agreements.slice(1).map((a) => a.title)).toEqual(['Extra 1', 'Extra 2']);
    expect(JSON.stringify(res.body)).not.toContain(firms.a.files[3]);
    expect(JSON.stringify(res.body)).not.toContain('versionIds');
  });

  it('the Begin Online block: unknown forms 400, forms without a service and wrong slugs 404', async () => {
    for (const form of [undefined, 'nope', 'OTHER', 'bookkeeping']) {
      const res = await block(firms.a.slug, form);
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    const extra = await request(app.getHttpServer())
      .get(`/api/v1/portal/${firms.a.slug}/intake-agreements`)
      .query({ form: 'BOOKKEEPING', serviceId: firms.a.serviceId });
    expect(extra.status).toBe(400);
    // Firm A offers no annual tax service.
    expect((await block(firms.a.slug, 'ANNUAL_TAX')).status).toBe(404);
    expect((await block(`nobody-${run}`, 'BOOKKEEPING')).status).toBe(404);
    expect((await block(firms.pending.slug, 'BOOKKEEPING')).status).toBe(404);
    // Firm B's own block: its service, none of firm A's agreements.
    const b = await block(firms.b.slug, 'BOOKKEEPING');
    expect(IntakeAgreementBlock.parse(b.body)).toEqual({
      ready: false,
      agreements: [],
      legal: null,
    });
  });

  it('legal is null unless both Terms and Privacy are published', async () => {
    const legalOf = async () =>
      IntakeAgreementBlock.parse((await block(firms.a.slug, 'BOOKKEEPING')).body).legal;
    const publishLegal = async (kind: 'TERMS' | 'PRIVACY', v: number) => {
      const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
      await runInScope(owner, { kind: 'business', businessId: firms.a.id }, (tx) =>
        tx.firmLegalDocument.create({
          data: {
            businessId: firms.a.id,
            kind,
            version: v,
            body: `# Fake ${kind}`,
            publishedByUserId: people.ownerA.id,
          },
        }),
      );
      await owner.$disconnect();
    };
    expect(await legalOf()).toBeNull();
    await publishLegal('TERMS', 1);
    await publishLegal('TERMS', 2);
    expect(await legalOf()).toBeNull();
    await publishLegal('PRIVACY', 1);
    expect(await legalOf()).toEqual({ terms: { version: 2 }, privacy: { version: 1 } });
  });

  it("the portal intake block: the client's own intake only, legal null", async () => {
    const res = await myBlock(firms.a.slug, firms.a.intakeId, people.clientA);
    expect(res.status).toBe(200);
    const mine = IntakeAgreementBlock.parse(res.body);
    const begin = IntakeAgreementBlock.parse((await block(firms.a.slug, 'BOOKKEEPING')).body);
    expect(mine).toEqual({ ...begin, legal: null });
    expect(begin.legal).not.toBeNull();
    const own2 = await myBlock(firms.a.slug, intakeA2, people.clientA2);
    expect(own2.status).toBe(200);

    // Another client's intake in the same firm, another firm's intake, a made-up one: 404.
    for (const [slug, intakeId, who] of [
      [firms.a.slug, firms.a.intakeId, people.clientA2],
      [firms.a.slug, intakeA2, people.clientA],
      [firms.a.slug, firms.b.intakeId, people.clientA],
      [firms.a.slug, randomUUID(), people.clientA],
      [firms.b.slug, firms.a.intakeId, people.clientA],
      [firms.b.slug, firms.b.intakeId, people.clientA],
      [firms.a.slug, firms.a.intakeId, people.clientB],
    ] as const) {
      const refused = await myBlock(slug, intakeId, who);
      expect([refused.status, codeOf(refused)]).toEqual([404, 'NOT_FOUND']);
    }
    expect((await myBlock(firms.a.slug, 'nope', people.clientA)).status).toBe(400);
    expect((await myBlock(firms.a.slug, firms.a.intakeId)).status).toBe(401);
    // A firm manager is not a portal client.
    expect((await myBlock(firms.a.slug, firms.a.intakeId, people.ownerA)).status).toBe(401);
    const audits = await auditRows(firms.a.id, 'portal.intake_agreements_viewed');
    expect(audits.map((a) => a.entityId)).toEqual([firms.a.intakeId, intakeA2]);
  });

  it('a service holds at most 9 unarchived agreements, also under concurrency', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    const payroll = await runInScope(owner, { kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.service.create({ data: { businessId: firms.a.id, kind: 'PAYROLL', name: 'Payroll' } }),
    );
    await owner.$disconnect();
    const create = () => asA('post', '', { scope: 'SERVICE', serviceId: payroll.id });
    const made: string[] = [];
    for (let n = 0; n < 8; n++) {
      const res = await create();
      expect(res.status).toBe(201);
      made.push((res.body as { id: string }).id);
    }
    const pair = await Promise.all([create(), create()]);
    expect(pair.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(pair.map(codeOf)).toContain('SERVICE_AGREEMENT_LIMIT');
    const tenth = await create();
    expect([tenth.status, codeOf(tenth)]).toEqual([409, 'SERVICE_AGREEMENT_LIMIT']);
    // Another service is not limited by this one; archiving one frees a place.
    expect((await asA('post', '', { scope: 'SERVICE', serviceId: firms.a.serviceId })).status).toBe(
      201,
    );
    expect((await asA('post', `/${made[0]}/archive`)).status).toBe(200);
    expect((await create()).status).toBe(201);
  });

  it("another service's agreements stay out of the Begin Online and portal blocks", async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    const other = await runInScope(owner, { kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.service.create({
        data: { businessId: firms.a.id, kind: 'TAX_PLANNING', name: 'Planning' },
      }),
    );
    await owner.$disconnect();
    const created = await asA('post', '', { scope: 'SERVICE', serviceId: other.id });
    const id = FirmAgreementSummary.parse(created.body).id;
    const published = await asA('post', `/${id}/versions`, {
      ...version(null, firms.a.cleanFile, { title: 'Planning only' }),
      acknowledgments: [],
    });
    expect(published.status).toBe(201);
    const begin = IntakeAgreementBlock.parse((await block(firms.a.slug, 'BOOKKEEPING')).body);
    const mine = IntakeAgreementBlock.parse(
      (await myBlock(firms.a.slug, firms.a.intakeId, people.clientA)).body,
    );
    for (const b of [begin, mine]) {
      expect(b.ready).toBe(true);
      expect(b.agreements.map((a) => a.agreementId)).not.toContain(id);
    }
    const planning = IntakeAgreementBlock.parse((await block(firms.a.slug, 'TAX_PLANNING')).body);
    expect(planning.agreements.map((a) => a.agreementId)).toContain(id);
  });

  it('works on a Pending Setup firm: one firm-wide create wins a race, publish without a PDF when off', async () => {
    const asP = (method: 'get' | 'post', path: string, body?: object) =>
      call(method, path, people.ownerB, firms.pending.id, body);
    expect(FirmAgreementList.parse((await asP('get', '')).body).items).toEqual([]);
    const pair = await Promise.all([0, 1].map(() => asP('post', '', { scope: 'ALL_INTAKES' })));
    expect(pair.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(pair.map(codeOf)).toContain('FIRM_WIDE_EXISTS');
    const id = FirmAgreementSummary.parse(pair.find((r) => r.status === 201)!.body).id;

    pdfConfig.pdfRequired = false;
    try {
      const res = await asP('post', `/${id}/versions`, version(null, null));
      expect(res.status).toBe(201);
      expect(AgreementVersion.parse(res.body)).toMatchObject({ version: 1, pdf: null });
    } finally {
      pdfConfig.pdfRequired = true;
    }
    const again = await asP('post', `/${id}/versions`, version(1, null));
    expect([again.status, codeOf(again)]).toEqual([409, 'PDF_REQUIRED']);
    expect((await asP('get', `/${id}/versions/1`)).status).toBe(200);
  });

  it('a client login is not a firm manager', async () => {
    const res = await call('get', '', people.clientA, firms.a.id);
    expect(res.status).toBe(403);
  });
});
