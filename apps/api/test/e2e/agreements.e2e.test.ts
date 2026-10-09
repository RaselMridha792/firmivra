// End-to-end: R14 intake agreements (docs/api/agreements.yaml). Firm routes are for the Owner and
// Admin; one firm never sees or changes another's; the public block reads only ACTIVE firms by
// slug. Audit entries carry ids and version numbers, never the text.
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
  ownerB: person('owner-b'),
};
type Firm = { id: string; slug: string; serviceId: string; cleanFile: string; files: string[] };
const firms = {} as Record<'a' | 'b' | 'pending', Firm>;
const sha = (n: number) => n.toString(16).padStart(64, '0');

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
const block = (slug: string, serviceId?: string) =>
  request(app.getHttpServer())
    .get(`/api/v1/portal/${slug}/intake-agreements`)
    .query(serviceId ? { serviceId } : {});

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
      const pool = key === 'clientA' ? 'CLIENT' : 'STAFF';
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
      firms[key] = { id: firm.id, slug, serviceId: '', cleanFile: '', files: [] };
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
      if (key === 'a') {
        await tx.clientAccount.create({
          data: { businessId, userId: people.clientA.id, email: people.clientA.email },
        });
      }
      firm.serviceId = (
        await tx.service.create({ data: { businessId, kind: 'BOOKKEEPING', name: 'Books' } })
      ).id;
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
  }).compile();
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

  it('the public block is not ready before a firm-wide version', async () => {
    const res = await block(firms.a.slug);
    expect(res.status).toBe(200);
    expect(IntakeAgreementBlock.parse(res.body)).toEqual({
      ready: false,
      agreements: [],
      legal: { terms: null, privacy: null },
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

    const fw = await asA('post', `/${firmWide}/archive`);
    expect([fw.status, codeOf(fw)]).toEqual([409, 'FIRM_WIDE_REQUIRED']);
    const archived = await asA('post', `/${service}/archive`);
    expect(archived.status).toBe(201);
    expect((archived.body as { archivedAt: string | null }).archivedAt).not.toBeNull();
    expect((await asA('post', `/${service}/archive`)).status).toBe(201);
    expect(await auditRows(firms.a.id, 'agreement.archived')).toHaveLength(1);
    const late = await asA('post', `/${service}/versions`, version(1, firms.a.cleanFile));
    expect([late.status, codeOf(late)]).toEqual([409, 'AGREEMENT_ARCHIVED']);
  });

  it('staff get 403; another firm gets 404 for every route', async () => {
    expect((await asA('get', '', undefined, people.staffA)).status).toBe(403);
    expect((await asA('post', '', { scope: 'ALL_INTAKES' }, people.staffA)).status).toBe(403);
    const asB = (method: 'get' | 'post', path: string, body?: object) =>
      call(method, path, people.ownerB, firms.b.id, body);
    expect(FirmAgreementList.parse((await asB('get', '')).body).items).toEqual([]);
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

  it('the public block: current versions, the service extra, wrong slugs 404', async () => {
    const res = await block(firms.a.slug.toUpperCase());
    const parsed = IntakeAgreementBlock.parse(res.body);
    expect(parsed.ready).toBe(true);
    expect(parsed.agreements).toHaveLength(1);
    expect(parsed.agreements[0]).toMatchObject({
      agreementId: firmWide,
      version: 2,
      title: 'Version 2',
      pdf: { available: true, sha256: sha(4) },
    });
    expect(JSON.stringify(res.body)).not.toContain(firms.a.files[3]);
    // The service agreement is archived, so its service shows only the firm-wide one.
    const withService = IntakeAgreementBlock.parse(
      (await block(firms.a.slug, firms.a.serviceId)).body,
    );
    expect(withService.agreements.map((a) => a.agreementId)).toEqual([firmWide]);

    expect((await block(firms.a.slug, firms.b.serviceId)).status).toBe(404);
    expect((await block(firms.a.slug, randomUUID())).status).toBe(404);
    expect((await block(firms.a.slug, 'nope')).status).toBe(400);
    expect((await block(`nobody-${run}`)).status).toBe(404);
    expect((await block(firms.pending.slug)).status).toBe(404);
    expect(IntakeAgreementBlock.parse((await block(firms.b.slug)).body).ready).toBe(false);
  });

  it('a client login is not a firm manager', async () => {
    const res = await call('get', '', people.clientA, firms.a.id);
    expect([401, 403, 404]).toContain(res.status);
  });
});
