// End-to-end: R55, the Tax Returns workspace part 2: filings per jurisdiction and their
// transmissions, checklists and final validation, review steps, authorizations (Form 8879,
// state), the return's documents, the e-file report and the CSV export, with the database's
// rules. Staff reach their own clients; firm B sees nothing.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  EfileReport,
  TaxApprovalList,
  TaxAuthorizationList,
  TaxChecklist,
  TaxReturnDetail,
  TaxReturnDocumentList,
  TaxReturnExportLink,
  TaxReturnFilingList,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { REPORT_FILES, type ReportFiles } from '../../src/reports/report-files.js';

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
const person = (key: string) => ({ id: randomUUID(), email: `r55v-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
let app: INestApplication;
const tokens = new Map<string, string>();
const ids = {} as Record<string, string>;

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
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

async function call(
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  who: Who | undefined,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm]);
  if (who) {
    let token = tokens.get(who.email);
    if (!token) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/dev/token')
        .send({ email: who.email })
        .expect(200);
      token = (res.body as { token: string }).token;
      tokens.set(who.email, token);
    }
    req = req.set('authorization', `Bearer ${token}`);
  }
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = <T>(res: Response, parse: { parse: (v: unknown) => T }, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return parse.parse(res.body);
};
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const { ownerA, adminA, staffA, ownerB } = people;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55v-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, userId, role] of [
    ['a', ownerA.id, 'OWNER'],
    ['a', adminA.id, 'ADMIN'],
    ['a', staffA.id, 'STAFF'],
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: `Tax ${run}`, status: 'ACTIVE' },
    });
    for (const [key, name, assigned] of [
      ['c1', 'Cora One (fake)', staffA.id],
      ['c2', 'Cal Two (fake)', undefined],
    ] as const) {
      const c = await tx.client.create({
        data: { businessId, displayName: name, assignedUserId: assigned },
      });
      const e = await tx.engagement.create({
        data: { businessId, clientId: c.id, serviceId: service.id, title: `${name} 2025` },
      });
      ids[key] = c.id;
      for (const n of [1, 2]) {
        const tag = randomUUID();
        const d = await tx.document.create({
          data: {
            businessId,
            clientId: c.id,
            engagementId: e.id,
            direction: 'FIRM_TO_CLIENT',
            fileName: `${key}-${String(n)}.pdf`,
            contentType: 'application/pdf',
            sizeBytes: 100,
            sha256: createHash('sha256').update(tag).digest('hex'),
            s3Key: `tenant/${businessId}/e2e/${tag}.pdf`,
          },
        });
        ids[`${key}doc${String(n)}`] = d.id;
      }
    }
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
  const r = ok(
    await call('post', '/tax-returns', ownerA, {
      clientId: ids.c1,
      taxYear: 2025,
      filingType: 'INDIVIDUAL',
      formType: '1040',
      states: ['NY'],
      reviewerUserId: adminA.id,
    }),
    TaxReturnDetail,
    201,
  );
  ids.r = r.id;
  const r2 = ok(
    await call('post', '/tax-returns', ownerA, {
      clientId: ids.c1,
      taxYear: 2025,
      filingType: 'INDIVIDUAL',
      formType: '1040-X',
    }),
    TaxReturnDetail,
    201,
  );
  ids.r2 = r2.id;
});

afterAll(async () => {
  await app.close();
});

describe('filings', () => {
  it('sets the jurisdictions and their amounts', async () => {
    const first = ok(
      await call('get', `/tax-returns/${ids.r}/filings`, staffA),
      TaxReturnFilingList,
    );
    expect(first.items.map((f) => f.jurisdiction)).toEqual(['US', 'NY']);
    const set = ok(
      await call('put', `/tax-returns/${ids.r}/filings`, ownerA, {
        filings: [{ jurisdiction: 'US' }, { jurisdiction: 'CA', filingMethod: 'PAPER' }],
      }),
      TaxReturnFilingList,
    );
    expect(set.items.map((f) => [f.jurisdiction, f.required, f.filingMethod])).toEqual([
      ['US', true, 'EFILE'],
      ['NY', false, 'EFILE'],
      ['CA', true, 'PAPER'],
    ]);
    const us = set.items[0]!.id;
    const amounts = ok(
      await call('patch', `/tax-returns/${ids.r}/filings/${us}`, ownerA, {
        refundCents: 150000,
        amountStatus: 'ESTIMATED',
      }),
      TaxReturnFilingList,
    );
    expect(amounts.items[0]).toMatchObject({ refundCents: 150000, amountStatus: 'ESTIMATED' });
    expectError(
      await call('patch', `/tax-returns/${ids.r}/filings/${us}`, ownerA, { amountDueCents: 100 }),
      400,
      'VALIDATION_FAILED',
    );
    const ca = set.items[2]!.id;
    expectError(
      await call('post', `/tax-returns/${ids.r}/filings/${ca}/attempts`, ownerA, {
        submissionId: 'X1',
        transmittedAt: ago(5),
      }),
      400,
      'VALIDATION_FAILED',
    );
    const paper = ok(
      await call('post', `/tax-returns/${ids.r}/filings/${ca}/paper-filed`, ownerA, {
        paperFiledOn: '2026-03-01',
      }),
      TaxReturnFilingList,
    );
    expect(paper.items[2]).toMatchObject({ status: 'PAPER_FILED', paperFiledOn: '2026-03-01' });
    expectError(
      await call('post', `/tax-returns/${ids.r}/filings/${us}/paper-filed`, ownerA, {
        paperFiledOn: '2026-03-01',
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('records transmissions and their answers as the database allows', async () => {
    const id = ids.r2!;
    ok(
      await call('post', `/tax-returns/${id}/status`, adminA, { workflowStatus: 'READY_TO_FILE' }),
      TaxReturnDetail,
    );
    const us = ok(await call('get', `/tax-returns/${id}/filings`, ownerA), TaxReturnFilingList)
      .items[0]!.id;
    const t1 = ok(
      await call('post', `/tax-returns/${id}/filings/${us}/attempts`, staffA, {
        submissionId: 'SUB-001',
        transmittedAt: ago(30),
      }),
      TaxReturnFilingList,
    );
    expect(t1.items[0]).toMatchObject({
      status: 'TRANSMITTED',
      attempts: [{ submissionId: 'SUB-001', ackStatus: 'PENDING' }],
    });
    expectError(
      await call('post', `/tax-returns/${id}/filings/${us}/attempts`, staffA, {
        submissionId: 'SUB-002',
        transmittedAt: ago(20),
      }),
      409,
      'ATTEMPT_PENDING',
    );
    ok(
      await call('post', `/tax-returns/${id}/status`, adminA, { workflowStatus: 'TRANSMITTED' }),
      TaxReturnDetail,
    );
    const attempt = t1.items[0]!.attempts[0]!.id;
    const rejected = ok(
      await call('patch', `/tax-returns/${id}/attempts/${attempt}`, staffA, {
        ackStatus: 'REJECTED',
        acknowledgedAt: ago(10),
        rejectCode: 'IND-031',
      }),
      TaxReturnFilingList,
    );
    expect(rejected.items[0]).toMatchObject({ status: 'REJECTED' });
    expectError(
      await call('patch', `/tax-returns/${id}/attempts/${attempt}`, staffA, {
        ackStatus: 'ACCEPTED',
        acknowledgedAt: ago(5),
      }),
      409,
      'RETURN_LOCKED',
    );
    ok(
      await call('patch', `/tax-returns/${id}/attempts/${attempt}`, staffA, {
        ackStatus: 'NOTE',
        correctiveAction: 'Fixed the prior-year AGI',
      }),
      TaxReturnFilingList,
    );
    const report = ok(
      await call('get', '/tax-returns/reports/efile?taxYear=2025', ownerA),
      EfileReport,
    );
    expect(report.rejections).toMatchObject([
      { taxReturnId: id, jurisdiction: 'US', rejectCode: 'IND-031' },
    ]);
    const t2 = ok(
      await call('post', `/tax-returns/${id}/filings/${us}/attempts`, staffA, {
        submissionId: 'SUB-002',
        transmittedAt: ago(4),
      }),
      TaxReturnFilingList,
    );
    const accepted = ok(
      await call('patch', `/tax-returns/${id}/attempts/${t2.items[0]!.attempts[0]!.id}`, staffA, {
        ackStatus: 'ACCEPTED',
        acknowledgedAt: ago(1),
      }),
      TaxReturnFilingList,
    );
    expect(accepted.items[0]).toMatchObject({ status: 'ACCEPTED' });
    expect(accepted.items[0]!.attempts).toHaveLength(2);
    const done = ok(
      await call('post', `/tax-returns/${id}/status`, adminA, { workflowStatus: 'ACCEPTED' }),
      TaxReturnDetail,
    );
    expect(done).toMatchObject({ workflowStatus: 'ACCEPTED', status: 'ACCEPTED' });
    const after = ok(
      await call('get', '/tax-returns/reports/efile?taxYear=2025', ownerA),
      EfileReport,
    );
    expect(after.byJurisdiction.find((j) => j.jurisdiction === 'US')).toMatchObject({
      accepted: 1,
    });
    expect(after.rejections).toEqual([]);
  });
});

describe('review', () => {
  it('runs final validation once errors are fixed and warnings acknowledged', async () => {
    const id = ids.r!;
    ok(
      await call('post', `/tax-returns/${id}/checklist`, staffA, {
        section: 'PREPARATION',
        label: 'W-2 entered',
      }),
      TaxChecklist,
    );
    expectError(
      await call('post', `/tax-returns/${id}/checklist`, staffA, {
        section: 'VALIDATION',
        label: 'Missing',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/tax-returns/${id}/checklist`, staffA, {
        section: 'PREPARATION',
        label: 'Bad',
        result: 'ERROR',
      }),
      400,
      'VALIDATION_FAILED',
    );
    const list = ok(
      await call('post', `/tax-returns/${id}/checklist`, staffA, {
        section: 'VALIDATION',
        label: 'Dependent age',
        result: 'WARNING',
      }),
      TaxChecklist,
    );
    const warning = list.items.find((i) => i.section === 'VALIDATION')!.id;
    const prep = list.items.find((i) => i.section === 'PREPARATION')!.id;
    expectError(
      await call('post', `/tax-returns/${id}/final-validation`, adminA),
      409,
      'STATUS_BLOCKED',
    );
    expectError(
      await call('patch', `/tax-returns/${id}/checklist/${prep}`, staffA, { acknowledge: true }),
      400,
      'VALIDATION_FAILED',
    );
    const acked = ok(
      await call('patch', `/tax-returns/${id}/checklist/${warning}`, adminA, { acknowledge: true }),
      TaxChecklist,
    );
    expect(acked.items.find((i) => i.id === warning)).toMatchObject({
      acknowledgedBy: { userId: adminA.id },
    });
    const validated = ok(
      await call('post', `/tax-returns/${id}/final-validation`, adminA),
      TaxReturnDetail,
    );
    expect(validated.finalValidatedBy?.userId).toBe(adminA.id);
    expect(validated.blockers).not.toContain('VALIDATION_NOT_RUN');
    const removed = ok(
      await call('delete', `/tax-returns/${id}/checklist/${prep}`, staffA),
      TaxChecklist,
    );
    expect(removed.items.map((i) => i.id)).toEqual([warning]);
  });

  it('decides review steps: the assignee or an approver, once', async () => {
    const id = ids.r!;
    const steps = ok(
      await call('post', `/tax-returns/${id}/approvals`, ownerA, {
        step: 'Final Review',
        assignedUserId: adminA.id,
      }),
      TaxApprovalList,
    );
    const step = steps.items[0]!.id;
    expectError(
      await call('post', `/tax-returns/${id}/approvals/${step}/approve`, staffA, {}),
      403,
      'FORBIDDEN',
    );
    const approved = ok(
      await call('post', `/tax-returns/${id}/approvals/${step}/approve`, adminA, {
        approvedDocumentId: ids.c1doc1,
      }),
      TaxApprovalList,
    );
    expect(approved.items[0]).toMatchObject({
      status: 'APPROVED',
      decidedBy: { userId: adminA.id },
      approvedDocument: { id: ids.c1doc1 },
    });
    expectError(
      await call('post', `/tax-returns/${id}/approvals/${step}/approve`, adminA, {}),
      409,
      'RETURN_LOCKED',
    );
    const second = ok(
      await call('post', `/tax-returns/${id}/approvals`, ownerA, { step: 'Partner Review' }),
      TaxApprovalList,
    );
    const returned = ok(
      await call('post', `/tax-returns/${id}/approvals/${second.items[1]!.id}/return`, ownerA, {
        note: 'Check Schedule C',
      }),
      TaxApprovalList,
    );
    expect(returned.items[1]).toMatchObject({ status: 'RETURNED', note: 'Check Schedule C' });
    expect(ok(await call('get', `/tax-returns/${id}`, ownerA), TaxReturnDetail).blockers).toContain(
      'APPROVAL_RETURNED',
    );
  });

  it('keeps the authorizations and their signatures', async () => {
    const id = ids.r!;
    expect(
      (
        await call('put', `/tax-returns/${id}/authorizations`, ownerA, {
          items: [{ kind: 'STATE_EFILE' }],
        })
      ).status,
    ).toBe(400);
    const set = ok(
      await call('put', `/tax-returns/${id}/authorizations`, ownerA, {
        items: [{ kind: 'FEDERAL_EFILE' }, { kind: 'STATE_EFILE', jurisdiction: 'NY' }],
      }),
      TaxAuthorizationList,
    );
    expect(set.items.map((a) => [a.kind, a.status])).toEqual([
      ['FEDERAL_EFILE', 'NOT_SENT'],
      ['STATE_EFILE', 'NOT_SENT'],
    ]);
    const federal = set.items[0]!.id;
    expectError(
      await call('post', `/tax-returns/${id}/authorizations/${federal}/wet-signature`, ownerA, {
        signedOn: '2026-03-02',
        documentId: ids.c2doc1,
      }),
      409,
      'INVALID_DOCUMENT',
    );
    const signed = ok(
      await call('post', `/tax-returns/${id}/authorizations/${federal}/wet-signature`, ownerA, {
        signedOn: '2026-03-02',
        documentId: ids.c1doc2,
      }),
      TaxAuthorizationList,
    );
    expect(signed.items[0]).toMatchObject({
      status: 'SIGNED',
      signedOn: '2026-03-02',
      document: { id: ids.c1doc2 },
    });
    expectError(
      await call('post', `/tax-returns/${id}/authorizations/${federal}/link`, ownerA, {
        esignRequestId: randomUUID(),
      }),
      404,
      'NOT_FOUND',
    );
    const kept = ok(
      await call('put', `/tax-returns/${id}/authorizations`, ownerA, {
        items: [{ kind: 'FEDERAL_EFILE' }],
      }),
      TaxAuthorizationList,
    );
    expect(kept.items.map((a) => [a.kind, a.required])).toEqual([
      ['FEDERAL_EFILE', true],
      ['STATE_EFILE', false],
    ]);
  });

  it("links the client's documents; the filed return stays linked", async () => {
    const id = ids.r!;
    ok(
      await call('post', `/tax-returns/${id}/documents`, staffA, {
        documentId: ids.c1doc1,
        kind: 'DRAFT_RETURN',
      }),
      TaxReturnDocumentList,
      200,
    );
    expectError(
      await call('post', `/tax-returns/${id}/documents`, staffA, {
        documentId: ids.c2doc1,
        kind: 'DRAFT_RETURN',
      }),
      409,
      'INVALID_DOCUMENT',
    );
    const both = ok(
      await call('post', `/tax-returns/${id}/documents`, ownerA, {
        documentId: ids.c1doc2,
        kind: 'FILED_RETURN',
        jurisdiction: 'US',
      }),
      TaxReturnDocumentList,
    );
    expect(both.items.map((d) => d.kind)).toEqual(['DRAFT_RETURN', 'FILED_RETURN']);
    expectError(
      await call('delete', `/tax-returns/${id}/documents/${ids.c1doc2}`, ownerA),
      409,
      'DOCUMENT_LOCKED',
    );
    ok(await call('delete', `/tax-returns/${id}/documents/${ids.c1doc1}`, staffA), {
      parse: (v) => v,
    });
    expect(
      ok(
        await call('get', `/tax-returns/${id}/documents`, ownerA),
        TaxReturnDocumentList,
      ).items.map((d) => d.kind),
    ).toEqual(['FILED_RETURN']);
  });
});

describe('export and another firm', () => {
  it('exports the list masked, for those with EXPORT', async () => {
    expectError(await call('post', '/tax-returns/export', staffA, {}), 403, 'FORBIDDEN');
    const link = ok(
      await call('post', '/tax-returns/export', ownerA, { taxYear: 2025 }),
      TaxReturnExportLink,
    );
    expect(link.rowCount).toBe(2);
    const csv = files.objects.get(link.url.slice('memory:'.length))!.toString('utf8');
    expect(csv).toContain('Cora One (fake)');
    expect(csv.split('\r\n')[0]).toContain('"SSN/EIN"');
  });

  it('reaches none of it', async () => {
    for (const [method, path, body] of [
      ['get', `/tax-returns/${ids.r}/filings`, undefined],
      ['put', `/tax-returns/${ids.r}/filings`, { filings: [{ jurisdiction: 'US' }] }],
      ['get', `/tax-returns/${ids.r}/checklist`, undefined],
      ['post', `/tax-returns/${ids.r}/approvals`, { step: 'x' }],
      ['get', `/tax-returns/${ids.r}/authorizations`, undefined],
      ['get', `/tax-returns/${ids.r}/documents`, undefined],
      ['post', `/tax-returns/${ids.r}/final-validation`, undefined],
    ] as const) {
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
    }
    expect(
      ok(await call('get', '/tax-returns/reports/efile', ownerB, undefined, 'b'), EfileReport)
        .byJurisdiction,
    ).toEqual([]);
  });
});
