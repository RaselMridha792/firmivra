// End-to-end: R55, Leads Review Two (Octavia, Nov 8) R2 16, bulk import and export. Import checks
// every mapped row first (a dry run creates nothing), then creates only the new valid leads; a row
// whose email or phone matches a lead or an earlier row is skipped, never merged. Export makes a CSV
// of the selected leads, the filtered list or all the member reaches (the Owner, or Leads EXPORT),
// formula-like cells quoted. Both audited with counts only. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { LeadExportLink, LeadImportResult, LeadProfile } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { REPORT_FILES, type ReportFiles } from '../../src/reports/report-files.js';
import { PermissionGrantsService } from '../../src/roles/permission-grants.service.js';

/** The reports file store in memory (the export's CSV). */
class MemoryFiles implements ReportFiles {
  readonly objects = new Map<string, Buffer>();
  put(key: string, bytes: Uint8Array) {
    this.objects.set(key, Buffer.from(bytes));
    return Promise.resolve();
  }
  presignDownload(input: { key: string }) {
    return Promise.resolve(`memory:${input.key}`);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
const files = new MemoryFiles();

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55tr-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '', tax: '', books: '', serviceB: '' };
let app: INestApplication;
const tokens = new Map<string, string>();
const owner = createPrismaClient(testDatabaseUrls('test_api').owner);

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
  path: string,
  who: { email: string },
  body: object,
  businessId = ids.firmA,
): Promise<Response> {
  const token = await tokenFor(who.email);
  return request(app.getHttpServer())
    .post(`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${token}`)
    .send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const inFirmA = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(owner, { kind: 'business', businessId: ids.firmA }, fn);
const imported = (res: Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return LeadImportResult.parse(res.body);
};
const exported = (res: Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const link = LeadExportLink.parse(res.body);
  const csv = files.objects.get(link.url.replace(/^memory:/, ''))!.toString('utf8');
  return {
    link,
    lines: csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n'),
  };
};
const email = (key: string) => `imp-${key}-${run}@example.test`;

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    ids.firmA = (
      await tx.business.create({ data: { slug: `r55tr-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r55tr-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await inFirmA(async (tx) => {
    for (const [p, role] of [
      [people.ownerA, 'OWNER'],
      [people.staffA, 'STAFF'],
    ] as const) {
      await tx.membership.create({
        data: { businessId: ids.firmA, userId: p.id, role, status: 'ACTIVE' },
      });
    }
    ids.tax = (
      await tx.service.create({
        data: { businessId: ids.firmA, kind: 'ANNUAL_TAX', name: `Tax ${run}` },
      })
    ).id;
    ids.books = (
      await tx.service.create({
        data: { businessId: ids.firmA, kind: 'BOOKKEEPING', name: `Books ${run}` },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.serviceB = (
      await tx.service.create({
        data: { businessId: ids.firmB, kind: 'ANNUAL_TAX', name: `Tax B ${run}` },
      })
    ).id;
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(REPORT_FILES)
    .useValue(files)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  // One lead the file will duplicate (by phone, written differently).
  const res = await call('/leads', people.ownerA, {
    firstName: 'Ivy',
    lastName: `Existing${run}`,
    email: email('existing'),
    phone: '(555) 010-4477',
    source: 'REFERRAL',
    serviceIds: [ids.tax],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

const rows = () => [
  // 1: new, a service by name, a source by its label, a priority in any case.
  {
    firstName: 'Ana',
    lastName: `Import${run}`,
    email: email('ana'),
    phone: '555-010-1001',
    source: 'Facebook Ad',
    priority: 'hot',
    service: `books ${run}`,
  },
  // 2: the same email as row 1 (another case): a duplicate of an earlier row.
  { firstName: 'Ana', lastName: 'Again', email: email('ana').toUpperCase() },
  // 3: the existing lead's phone: a duplicate of that lead.
  { firstName: 'Ivy', lastName: 'Twin', email: email('ivy-twin'), phone: '5550104477' },
  // 4: invalid in three ways.
  {
    firstName: 'Bad',
    lastName: 'Row',
    email: 'not-an-email',
    source: 'Billboard',
    priority: 'Urgent',
  },
  // 5: an unknown service; 6: no last name.
  { firstName: 'Cy', lastName: 'Svc', email: email('cy'), service: 'Astrology' },
  { firstName: 'Di', email: email('di') },
  // 7: new, with the default service, and a business name a spreadsheet would read as a formula.
  { firstName: 'Eve', lastName: `Import${run}`, email: email('eve'), businessName: '=Fake Biz' },
];

describe('POST /business/leads/import (R2 16)', () => {
  it('checks every row on a dry run and creates nothing', async () => {
    const before = await inFirmA((tx) => tx.lead.count({ where: { businessId: ids.firmA } }));
    const result = imported(
      await call('/leads/import', people.ownerA, {
        rows: rows(),
        defaultServiceId: ids.tax,
        dryRun: true,
      }),
    );
    expect(result).toMatchObject({ dryRun: true, created: 0, duplicates: 2, invalid: 3 });
    expect(result.rows.map((r) => r.status)).toEqual([
      'CREATE',
      'DUPLICATE',
      'DUPLICATE',
      'INVALID',
      'INVALID',
      'INVALID',
      'CREATE',
    ]);
    expect(result.rows[1]!.duplicateOf).toBeNull();
    expect(result.rows[2]!.duplicateOf?.name).toBe(`Ivy Existing${run}`);
    expect(result.rows[3]!.issues).toEqual([
      'Lead source: "Billboard" is not one of the sources',
      'Priority: use Hot, Warm or Cold',
      expect.stringMatching(/^Email: /),
    ]);
    expect(result.rows[4]!.issues).toEqual(['Service: no service is named "Astrology"']);
    expect(result.rows[5]!.issues).toEqual([expect.stringMatching(/^Last name: /)]);
    expect(result.rows.every((r) => r.leadId === null)).toBe(true);
    expect(await inFirmA((tx) => tx.lead.count({ where: { businessId: ids.firmA } }))).toBe(before);
  });

  it('creates only the new valid rows, as Add New Lead; a second import creates none', async () => {
    const result = imported(
      await call('/leads/import', people.ownerA, {
        rows: rows(),
        defaultServiceId: ids.tax,
        dryRun: false,
      }),
    );
    expect(result).toMatchObject({ dryRun: false, created: 2, duplicates: 2, invalid: 3 });
    const [ana, eve] = [result.rows[0]!.leadId, result.rows[6]!.leadId];
    expect(ana && eve).toBeTruthy();
    const token = await tokenFor(people.ownerA.email);
    const profile = async (id: string) =>
      LeadProfile.parse(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/business/leads/${id}/profile`)
            .set('x-business-id', ids.firmA)
            .set('authorization', `Bearer ${token}`)
            .expect(200)
        ).body,
      );
    const a = await profile(ana!);
    expect([a.source, a.priority, a.stage, a.services.map((s) => s.id)]).toEqual([
      'FACEBOOK_AD',
      'HOT',
      'SUBMITTED',
      [ids.books],
    ]);
    const e = await profile(eve!);
    expect([e.source, e.priority, e.services.map((s) => s.id)]).toEqual([
      'OTHER',
      'WARM',
      [ids.tax],
    ]);
    // Never an update: the same file again only finds duplicates.
    const again = imported(
      await call('/leads/import', people.ownerA, {
        rows: rows(),
        defaultServiceId: ids.tax,
        dryRun: false,
      }),
    );
    expect([again.created, again.duplicates, again.invalid]).toEqual([0, 4, 3]);
    const audits = await inFirmA((tx) =>
      tx.auditLog.findMany({
        where: {
          businessId: ids.firmA,
          action: { in: ['leads.import_checked', 'leads.imported'] },
        },
        orderBy: { createdAt: 'asc' },
        select: { action: true, metadata: true },
      }),
    );
    expect(audits.map((x) => x.action)).toEqual([
      'leads.import_checked',
      'leads.imported',
      'leads.imported',
    ]);
    expect(audits[1]!.metadata).toEqual({
      rows: 7,
      created: 2,
      duplicates: 2,
      invalid: 3,
      duplicatesForReview: false,
    });
    expect(JSON.stringify(audits)).not.toContain('@example.test');
  });

  it('adds a possible duplicate only when asked, for Review Duplicates', async () => {
    const twin = {
      firstName: 'Ivy',
      lastName: `Twin${run}`,
      email: email('ivy-twin'),
      phone: '5550104477',
    };
    const result = imported(
      await call('/leads/import', people.ownerA, {
        rows: [twin],
        defaultServiceId: ids.tax,
        dryRun: false,
        duplicates: 'REVIEW',
      }),
    );
    expect([result.created, result.duplicates]).toEqual([1, 1]);
    const [row] = result.rows;
    expect(row!.status).toBe('DUPLICATE');
    expect(row!.duplicateOf?.name).toBe(`Ivy Existing${run}`);
    const token = await tokenFor(people.ownerA.email);
    const review = await request(app.getHttpServer())
      .get('/api/v1/business/leads/duplicates')
      .set('x-business-id', ids.firmA)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const pairs = (review.body as { items: { leads: { id: string }[] }[] }).items;
    expect(
      pairs.some(
        (p) =>
          p.leads.some((l) => l.id === row!.leadId) &&
          p.leads.some((l) => l.id === row!.duplicateOf?.id),
      ),
    ).toBe(true);
  });

  it("refuses another firm's service, and firm B finds none of firm A's leads", async () => {
    expectError(
      await call('/leads/import', people.ownerA, {
        rows: rows(),
        defaultServiceId: ids.serviceB,
        dryRun: true,
      }),
      404,
      'NOT_FOUND',
    );
    const b = imported(
      await call(
        '/leads/import',
        people.ownerB,
        {
          rows: [{ firstName: 'Ana', lastName: 'B', email: email('ana') }],
          defaultServiceId: ids.serviceB,
          dryRun: true,
        },
        ids.firmB,
      ),
    );
    expect(b.rows[0]!.status).toBe('CREATE');
    expectError(
      await call('/leads/import', people.ownerA, {
        rows: [],
        defaultServiceId: ids.tax,
        dryRun: true,
      }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('POST /business/leads/export (R2 16)', () => {
  const fields = ['name', 'email', 'businessName', 'source'];

  it('exports all, the filtered list or the selected leads with the chosen columns', async () => {
    const all = exported(await call('/leads/export', people.ownerA, { scope: 'ALL', fields }));
    expect(all.lines[0]).toBe('"Name","Email","Business name","Source"');
    expect(all.link.rowCount).toBe(4);
    expect(all.link.fileName).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(all.link.url.startsWith(`memory:tenant/${ids.firmA}/reports/`)).toBe(true);
    // A cell a spreadsheet would read as a formula starts with a quote.
    expect(all.lines).toContain(`"Eve Import${run}","${email('eve')}","'=Fake Biz","Other"`);
    const filtered = exported(
      await call('/leads/export', people.ownerA, {
        scope: 'FILTERED',
        filters: { source: 'FACEBOOK_AD' },
        fields: ['email'],
      }),
    );
    expect(filtered.lines).toEqual(['"Email"', `"${email('ana')}"`]);
    const lead = await inFirmA((tx) =>
      tx.lead.findFirstOrThrow({ where: { businessId: ids.firmA, email: email('existing') } }),
    );
    const selected = exported(
      await call('/leads/export', people.ownerA, {
        scope: 'SELECTED',
        ids: [lead.id],
        fields: ['name', 'phone'],
      }),
    );
    expect(selected.lines).toEqual(['"Name","Phone"', `"Ivy Existing${run}","(555) 010-4477"`]);
    expectError(
      await call('/leads/export', people.ownerA, { scope: 'SELECTED', fields }),
      400,
      'VALIDATION_FAILED',
    );
    const [audit] = await inFirmA((tx) =>
      tx.auditLog.findMany({
        where: { businessId: ids.firmA, action: 'leads.exported' },
        orderBy: { createdAt: 'asc' },
        select: { metadata: true },
      }),
    );
    expect(audit!.metadata).toEqual({ scope: 'ALL', rows: 4, fields });
  });

  it('Staff need Leads EXPORT, then export only their own leads; firm B none of firm A', async () => {
    expectError(
      await call('/leads/export', people.staffA, { scope: 'ALL', fields }),
      403,
      'FORBIDDEN',
    );
    await inFirmA((tx) =>
      tx.rolePermission.create({
        data: {
          businessId: ids.firmA,
          role: 'STAFF',
          module: 'LEADS',
          capability: 'EXPORT',
          granted: true,
        },
      }),
    );
    app.get(PermissionGrantsService).invalidate(ids.firmA);
    const own = exported(await call('/leads/export', people.staffA, { scope: 'ALL', fields }));
    expect(own.link.rowCount).toBe(0);
    const lead = await inFirmA((tx) =>
      tx.lead.findFirstOrThrow({ where: { businessId: ids.firmA, email: email('existing') } }),
    );
    // A lead the member does not reach is not found, as everywhere in Leads.
    expectError(
      await call('/leads/export', people.staffA, { scope: 'SELECTED', ids: [lead.id], fields }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        '/leads/export',
        people.ownerB,
        { scope: 'SELECTED', ids: [lead.id], fields },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
    const b = exported(
      await call('/leads/export', people.ownerB, { scope: 'ALL', fields }, ids.firmB),
    );
    expect(b.link.rowCount).toBe(0);
    expect(b.lines).toEqual(['"Name","Email","Business name","Source"']);
  });
});
