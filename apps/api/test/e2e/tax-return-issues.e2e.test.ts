// End-to-end: Octavia's TX-F19 and F20 (Oct 26 review), the Tax Returns validation issues on R1's
// tax_return_validation_issues: the reviewer returns a step to the preparer with a new issue or the
// open ones; an unresolved Error blocks Ready to File and every filing path (status, transmission,
// paper filing, the client record's Filed) while Manual Warning and Info never do; a line marked
// Valid clears nothing; who may resolve; Staff reach their own clients and firm B sees nothing.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  TaxApprovalList,
  TaxChecklist,
  TaxReturnActivityList,
  TaxReturnDetail,
  TaxReturnDocumentList,
  TaxReturnFilingList,
  TaxValidationIssueList,
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
const person = (key: string) => ({ id: randomUUID(), email: `r60i-${key}-${run}@r60.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
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
const { ownerA, adminA, staffA, staffA2, ownerB } = people;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r60i-${key}-${run}`;
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
    ['a', staffA2.id, 'STAFF'],
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
  for (const key of ['r', 'r2'] as const) {
    const r = ok(
      await call('post', '/tax-returns', ownerA, {
        clientId: ids.c1,
        taxYear: key === 'r' ? 2025 : 2024,
        filingType: 'INDIVIDUAL',
        formType: '1040',
        preparerUserId: staffA.id,
        reviewerUserId: adminA.id,
      }),
      TaxReturnDetail,
      201,
    );
    ids[key] = r.id;
  }
});

afterAll(async () => {
  await app.close();
});

const issuesOf = async (id: string, who: Who) =>
  ok(await call('get', `/tax-returns/${id}/issues`, who), TaxValidationIssueList).items;
const blockedBy = (res: Response) =>
  (res.body as { error?: { details?: { blockers?: string[] } } }).error?.details?.blockers;
const audits = (action: string, entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { businessId: firms.a, action, entityId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { metadata: true },
    }),
  );

describe('TX-F19: validation issues on Return to Preparer', () => {
  it('returns a step with a new issue and an open one, both recorded on the decision', async () => {
    const id = ids.r!;
    // The preparer notes a warning first.
    const raised = ok(
      await call('post', `/tax-returns/${id}/issues`, staffA, {
        severity: 'MANUAL_WARNING',
        note: 'Schedule C mileage looks high (fake)',
      }),
      TaxValidationIssueList,
    ).items;
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      severity: 'MANUAL_WARNING',
      raisedBy: { userId: staffA.id },
      responsible: null,
      resolvedAt: null,
      canResolve: true,
    });
    const warning = raised[0]!.id;
    // The draft it is about, the review line and the step.
    ok(
      await call('post', `/tax-returns/${id}/documents`, ownerA, {
        documentId: ids.c1doc1,
        kind: 'DRAFT_RETURN',
      }),
      TaxReturnDocumentList,
    );
    const line = ok(
      await call('post', `/tax-returns/${id}/checklist`, ownerA, {
        section: 'REVIEW',
        label: 'Income tie-out (fake)',
      }),
      TaxChecklist,
    ).items[0]!.id;
    const step = ok(
      await call('post', `/tax-returns/${id}/approvals`, ownerA, {
        step: 'Final Review',
        assignedUserId: adminA.id,
      }),
      TaxApprovalList,
    ).items[0]!.id;
    const issue = {
      severity: 'ERROR',
      note: 'W-2 box 1 does not match the draft (fake)',
      responsibleUserId: staffA.id,
      draftDocumentId: ids.c1doc1,
      checklistItemId: line,
    };
    const back = `/tax-returns/${id}/approvals/${step}/return`;
    // What the issue names must be this return's and this firm's.
    expectError(
      await call('post', back, adminA, {
        note: 'Fix it',
        issue: { ...issue, draftDocumentId: ids.c1doc2 },
      }),
      409,
      'INVALID_DOCUMENT',
    );
    expectError(
      await call('post', back, adminA, {
        note: 'Fix it',
        issue: { ...issue, responsibleUserId: ownerB.id },
      }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('post', back, adminA, {
        note: 'Fix it',
        issue: { ...issue, checklistItemId: randomUUID() },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', back, adminA, { note: 'Fix it', issueIds: [randomUUID()] }),
      404,
      'NOT_FOUND',
    );
    // Staff may not decide the Admin's step, issue or not (TX-F18).
    expectError(await call('post', back, staffA, { note: 'Fix it', issue }), 403, 'FORBIDDEN');
    // None of the refusals left an issue behind.
    expect(await issuesOf(id, adminA)).toHaveLength(1);
    const decided = ok(
      await call('post', back, adminA, {
        note: 'Two things to fix',
        issue,
        issueIds: [warning],
      }),
      TaxApprovalList,
    ).items;
    expect(decided[0]).toMatchObject({ status: 'RETURNED', note: 'Two things to fix' });

    const list = await issuesOf(id, adminA);
    expect(list.map((i) => i.severity)).toEqual(['ERROR', 'MANUAL_WARNING']);
    expect(list[0]).toMatchObject({
      note: issue.note,
      responsible: { userId: staffA.id },
      draft: { id: ids.c1doc1, fileName: 'c1-1.pdf' },
      step: { id: line, label: 'Income tie-out (fake)' },
      raisedBy: { userId: adminA.id },
      canResolve: true,
    });
    // An Error is resolved by who raised it or the reviewer; the preparer fixes, not clears, it.
    const forStaff = await issuesOf(id, staffA);
    expect(forStaff.map((i) => i.canResolve)).toEqual([false, true]);
    // A member who does not reach the return's client sees none of it.
    expectError(await call('get', `/tax-returns/${id}/issues`, staffA2), 404, 'NOT_FOUND');

    const [decision] = await audits('tax_return.approval', id);
    const named = (decision!.metadata as { issueIds?: string[] }).issueIds ?? [];
    expect(named.sort()).toEqual([list[0]!.id, warning].sort());
    // A resolved issue is not named again.
    ok(
      await call('patch', `/tax-returns/${id}/issues/${warning}`, staffA, { resolved: true }),
      TaxValidationIssueList,
    );
    const step2 = ok(
      await call('post', `/tax-returns/${id}/approvals`, ownerA, { step: 'Second Review' }),
      TaxApprovalList,
    ).items.find((a) => a.step === 'Second Review')!.id;
    expectError(
      await call('post', `/tax-returns/${id}/approvals/${step2}/return`, adminA, {
        note: 'Again',
        issueIds: [warning],
      }),
      400,
      'VALIDATION_FAILED',
    );
    const activity = ok(
      await call('get', `/tax-returns/${id}/activity`, ownerA),
      TaxReturnActivityList,
    ).items.map((a) => a.label);
    expect(activity).toContain('Validation issue raised');
    expect(activity).toContain('Validation issue resolved');
    // The note never reaches the audit log.
    expect(JSON.stringify(await audits('tax_return.issue', id))).not.toContain('W-2');
  });
});

describe('TX-F20: severity', () => {
  it('an open Error blocks Ready to File and every filing; a Valid line clears nothing', async () => {
    const id = ids.r2!;
    const error = ok(
      await call('post', `/tax-returns/${id}/issues`, adminA, {
        severity: 'ERROR',
        note: 'Missing 1099-INT (fake)',
        responsibleUserId: staffA.id,
      }),
      TaxValidationIssueList,
    ).items[0]!.id;
    for (const severity of ['MANUAL_WARNING', 'INFO'] as const) {
      ok(
        await call('post', `/tax-returns/${id}/issues`, adminA, {
          severity,
          note: `A ${severity.toLowerCase()} (fake)`,
          responsibleUserId: staffA.id,
        }),
        TaxValidationIssueList,
      );
    }
    const detail = ok(await call('get', `/tax-returns/${id}`, adminA), TaxReturnDetail);
    expect(detail.blockers).toContain('VALIDATION_ISSUES_OPEN');

    // Ready to File, and Transmitted or Accepted straight away.
    for (const workflowStatus of ['READY_TO_FILE', 'TRANSMITTED', 'ACCEPTED']) {
      const res = await call('post', `/tax-returns/${id}/status`, adminA, { workflowStatus });
      expectError(res, 409, 'STATUS_BLOCKED');
      expect(blockedBy(res)).toContain('VALIDATION_ISSUES_OPEN');
    }
    // A validation line marked Valid, then Run Final Validation: still blocked.
    ok(
      await call('post', `/tax-returns/${id}/checklist`, adminA, {
        section: 'VALIDATION',
        label: 'Schema check (fake)',
        result: 'VALID',
      }),
      TaxChecklist,
    );
    expectError(
      await call('post', `/tax-returns/${id}/final-validation`, adminA),
      409,
      'STATUS_BLOCKED',
    );
    // A transmission and a paper filing.
    const filings = ok(
      await call('put', `/tax-returns/${id}/filings`, ownerA, {
        filings: [{ jurisdiction: 'US' }, { jurisdiction: 'CA', filingMethod: 'PAPER' }],
      }),
      TaxReturnFilingList,
    ).items;
    const us = filings.find((f) => f.jurisdiction === 'US')!.id;
    const ca = filings.find((f) => f.jurisdiction === 'CA')!.id;
    const sent = await call('post', `/tax-returns/${id}/filings/${us}/attempts`, staffA, {
      submissionId: 'FAKE-SUB-1',
      transmittedAt: ago(30),
    });
    expectError(sent, 409, 'STATUS_BLOCKED');
    expect(blockedBy(sent)).toContain('VALIDATION_ISSUES_OPEN');
    expectError(
      await call('post', `/tax-returns/${id}/filings/${ca}/paper-filed`, staffA, {
        paperFiledOn: '2026-03-01',
        mailTrackingNumber: 'FAKE-TRACK-0002',
      }),
      409,
      'STATUS_BLOCKED',
    );
    // The client record's Filed (R10) files it too.
    expectError(
      await call('patch', `/tax-returns/${id}`, ownerA, { status: 'FILED', filedOn: '2026-03-01' }),
      409,
      'STATUS_BLOCKED',
    );

    // The person responsible fixes the Error but does not clear it.
    expectError(
      await call('patch', `/tax-returns/${id}/issues/${error}`, staffA, { resolved: true }),
      403,
      'FORBIDDEN',
    );
    // The Owner may, as the override, which is recorded.
    ok(
      await call('patch', `/tax-returns/${id}/issues/${error}`, ownerA, { resolved: true }),
      TaxValidationIssueList,
    );
    const [resolved] = await audits('tax_return.issue', id);
    expect(resolved!.metadata).toMatchObject({
      issueId: error,
      action: 'resolved',
      override: true,
    });
    // Who raised it reopens it and hands it to someone else.
    const reopened = ok(
      await call('patch', `/tax-returns/${id}/issues/${error}`, adminA, {
        resolved: false,
        responsibleUserId: ownerA.id,
      }),
      TaxValidationIssueList,
    ).items.find((i) => i.id === error)!;
    expect(reopened).toMatchObject({ resolvedAt: null, responsible: { userId: ownerA.id } });
    expectError(
      await call('post', `/tax-returns/${id}/status`, adminA, { workflowStatus: 'READY_TO_FILE' }),
      409,
      'STATUS_BLOCKED',
    );
    // Resolved by the reviewer: the open Manual Warning and Info do not block.
    const after = ok(
      await call('patch', `/tax-returns/${id}/issues/${error}`, adminA, { resolved: true }),
      TaxValidationIssueList,
    ).items;
    expect(after.filter((i) => !i.resolvedAt).map((i) => i.severity)).toEqual([
      'MANUAL_WARNING',
      'INFO',
    ]);
    ok(await call('post', `/tax-returns/${id}/final-validation`, adminA), TaxReturnDetail);
    const ready = ok(
      await call('post', `/tax-returns/${id}/status`, adminA, { workflowStatus: 'READY_TO_FILE' }),
      TaxReturnDetail,
    );
    expect(ready.workflowStatus).toBe('READY_TO_FILE');
    expect(ready.blockers).not.toContain('VALIDATION_ISSUES_OPEN');
    ok(
      await call('post', `/tax-returns/${id}/filings/${us}/attempts`, staffA, {
        submissionId: 'FAKE-SUB-1',
        transmittedAt: ago(30),
      }),
      TaxReturnFilingList,
    );
  });
});

describe('another firm', () => {
  it('reaches none of it', async () => {
    const [issue] = await issuesOf(ids.r!, ownerA);
    expectError(
      await call('get', `/tax-returns/${ids.r}/issues`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'patch',
        `/tax-returns/${ids.r}/issues/${issue!.id}`,
        ownerB,
        { resolved: true },
        'b',
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        `/tax-returns/${ids.r}/issues`,
        ownerB,
        { severity: 'INFO', note: 'Fake' },
        'b',
      ),
      404,
      'NOT_FOUND',
    );
  });
});
