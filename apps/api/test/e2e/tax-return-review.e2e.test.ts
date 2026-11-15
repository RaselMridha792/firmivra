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
  MailingReport,
  TaxApprovalList,
  TaxAuthorizationList,
  TaxChecklist,
  TaxReturnDetail,
  TaxReturnDocumentList,
  TaxReturnExportLink,
  TaxAmountHistory,
  TaxReturnFilingList,
  TaxReturnHistoryList,
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
    // TX-F28: an amount names its source, and each change of it is a new version.
    expectError(
      await call('patch', `/tax-returns/${ids.r}/filings/${us}`, ownerA, {
        refundCents: 150000,
        amountStatus: 'ESTIMATED',
      }),
      400,
      'VALIDATION_FAILED',
    );
    const amounts = ok(
      await call('patch', `/tax-returns/${ids.r}/filings/${us}`, ownerA, {
        refundCents: 150000,
        amountStatus: 'ESTIMATED',
        amountSource: 'STAFF_ESTIMATE',
      }),
      TaxReturnFilingList,
    );
    expect(amounts.items[0]).toMatchObject({
      refundCents: 150000,
      amountStatus: 'ESTIMATED',
      amountSource: 'STAFF_ESTIMATE',
      amountVersion: 1,
    });
    const final = ok(
      await call('patch', `/tax-returns/${ids.r}/filings/${us}`, ownerA, {
        refundCents: 148250,
        amountStatus: 'FINAL',
        amountSource: 'TAX_SOFTWARE',
      }),
      TaxReturnFilingList,
    );
    expect(final.items[0]).toMatchObject({
      refundCents: 148250,
      amountStatus: 'FINAL',
      amountSource: 'TAX_SOFTWARE',
      amountVersion: 2,
    });
    const required = ok(
      await call('patch', `/tax-returns/${ids.r}/filings/${us}`, ownerA, { required: true }),
      TaxReturnFilingList,
    );
    expect(required.items[0]).toMatchObject({ amountSource: 'TAX_SOFTWARE', amountVersion: 2 });
    // Review 2: the amount, version by version, newest first (`required` alone is no version).
    const history = ok(
      await call('get', `/tax-returns/${ids.r}/filings/${us}/amount-history`, ownerA),
      TaxAmountHistory,
    ).items;
    expect(history.map((h) => [h.version, h.refundCents, h.amountStatus, h.amountSource])).toEqual([
      [2, 148250, 'FINAL', 'TAX_SOFTWARE'],
      [1, 150000, 'ESTIMATED', 'STAFF_ESTIMATE'],
    ]);
    expect(history[0]!.by?.userId).toBe(ownerA.id);
    const cleared = ok(
      await call('patch', `/tax-returns/${ids.r}/filings/${us}`, ownerA, {
        refundCents: null,
        amountStatus: null,
      }),
      TaxReturnFilingList,
    );
    expect(cleared.items[0]).toMatchObject({
      refundCents: null,
      amountStatus: null,
      amountSource: null,
      amountVersion: null,
    });
    ok(
      await call('patch', `/tax-returns/${ids.r}/filings/${us}`, ownerA, {
        refundCents: 150000,
        amountStatus: 'ESTIMATED',
        amountSource: 'STAFF_ESTIMATE',
      }),
      TaxReturnFilingList,
    );
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
    // TX-F26: a paper filing is logged as mailed only with its Mail Tracking Number.
    expectError(
      await call('post', `/tax-returns/${ids.r}/filings/${ca}/paper-filed`, ownerA, {
        paperFiledOn: '2026-03-01',
      }),
      400,
      'VALIDATION_FAILED',
    );
    const paper = ok(
      await call('post', `/tax-returns/${ids.r}/filings/${ca}/paper-filed`, ownerA, {
        paperFiledOn: '2026-03-01',
        mailTrackingNumber: '9400 1000 0000 0000 0000 01',
      }),
      TaxReturnFilingList,
    );
    expect(paper.items[2]).toMatchObject({
      status: 'PAPER_FILED',
      paperFiledOn: '2026-03-01',
      mailTrackingNumber: '9400 1000 0000 0000 0000 01',
    });
    // TX-F27: the Mailing Report lists it, record by record; another firm sees none of it.
    const mailing = ok(
      await call('get', '/tax-returns/reports/mailing?taxYear=2025', ownerA),
      MailingReport,
    );
    expect(
      mailing.rows.find((r) => r.taxReturnId === ids.r && r.jurisdiction === 'CA'),
    ).toMatchObject({
      status: 'PAPER_FILED',
      paperFiledOn: '2026-03-01',
      mailTrackingNumber: '9400 1000 0000 0000 0000 01',
    });
    const theirs = ok(
      await call('get', '/tax-returns/reports/mailing?taxYear=2025', ownerB, undefined, 'b'),
      MailingReport,
    );
    expect(theirs.rows.some((r) => r.taxReturnId === ids.r)).toBe(false);
    expectError(
      await call('post', `/tax-returns/${ids.r}/filings/${us}/paper-filed`, ownerA, {
        paperFiledOn: '2026-03-01',
        mailTrackingNumber: '9400 1000 0000 0000 0000 02',
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  // Tax Returns Review 2 (F26ba): the server, not only the screen, insists on the mailing date.
  it('refuses a paper filing record without its mailing date and never puts in today', async () => {
    const fresh = ok(
      await call('post', '/tax-returns', ownerA, {
        clientId: ids.c1,
        taxYear: 2014,
        filingType: 'INDIVIDUAL',
        formType: '1040',
      }),
      TaxReturnDetail,
      201,
    );
    const set = ok(
      await call('put', `/tax-returns/${fresh.id}/filings`, ownerA, {
        filings: [{ jurisdiction: 'US', filingMethod: 'PAPER' }],
      }),
      TaxReturnFilingList,
    );
    const us = set.items.find((f) => f.jurisdiction === 'US')!.id;
    const path = `/tax-returns/${fresh.id}/filings/${us}/paper-filed`;
    const tracking = { mailTrackingNumber: '9400 1000 0000 0000 0000 77' };
    expectError(await call('post', path, ownerA, tracking), 400, 'VALIDATION_FAILED');
    for (const paperFiledOn of ['', null, '   ']) {
      expectError(
        await call('post', path, ownerA, { ...tracking, paperFiledOn }),
        400,
        'VALIDATION_FAILED',
      );
    }
    const after = ok(
      await call('get', `/tax-returns/${fresh.id}/filings`, ownerA),
      TaxReturnFilingList,
    ).items.find((f) => f.id === us)!;
    expect([after.status, after.paperFiledOn]).toEqual(['NOT_FILED', null]);
    const logged = await inFirm('a', (tx) =>
      tx.auditLog.count({ where: { action: 'tax_return.transmission', entityId: fresh.id } }),
    );
    expect(logged).toBe(0);
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
    // TX-F22: Rejected waits for a recorded rejection, which names its agency and the fix.
    expectError(
      await call('post', `/tax-returns/${id}/status`, adminA, { workflowStatus: 'REJECTED' }),
      409,
      'REJECTION_NOT_RECORDED',
    );
    expectError(
      await call('patch', `/tax-returns/${id}/attempts/${attempt}`, staffA, {
        ackStatus: 'REJECTED',
        acknowledgedAt: ago(10),
        rejectCode: 'IND-031',
        correctiveAction: 'Fix the prior-year AGI',
      }),
      400,
      'VALIDATION_FAILED',
    );
    const rejected = ok(
      await call('patch', `/tax-returns/${id}/attempts/${attempt}`, staffA, {
        ackStatus: 'REJECTED',
        acknowledgedAt: ago(10),
        rejectingAgency: 'IRS',
        rejectCode: 'IND-031',
        correctiveAction: 'Fix the prior-year AGI',
      }),
      TaxReturnFilingList,
    );
    expect(rejected.items[0]).toMatchObject({
      status: 'REJECTED',
      attempts: [{ ackStatus: 'REJECTED', rejectingAgency: 'IRS', rejectCode: 'IND-031' }],
    });
    // Review 2 (TX-F24): the rejection made its corrective task, linked to the attempt (no
    // preparer on this return, so it waits unassigned), on the return's client.
    const corrective = rejected.items[0]!.attempts[0]!.correctiveTask!;
    expect(corrective).toMatchObject({
      title: 'Correct the IRS rejection IND-031',
      status: 'OPEN',
      owner: null,
    });
    const taskRow = await inFirm('a', (tx) =>
      tx.task.findUniqueOrThrow({
        where: { id: corrective.id },
        select: { clientId: true, priority: true, details: true },
      }),
    );
    expect(taskRow).toMatchObject({ clientId: ids.c1, priority: 'HIGH' });
    expect(taskRow.details).toContain('Corrective action: Fix the prior-year AGI');
    const moved = ok(
      await call('post', `/tax-returns/${id}/status`, adminA, { workflowStatus: 'REJECTED' }),
      TaxReturnDetail,
    );
    expect(moved.workflowStatus).toBe('REJECTED');
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
    // Review 2 (TX-F22): from Rejected the only move is In Correction, and nothing is sent again
    // until the return is through review and Ready to File.
    expect(moved.canMoveTo).toEqual(['IN_CORRECTION']);
    const resend = () =>
      call('post', `/tax-returns/${id}/filings/${us}/attempts`, staffA, {
        submissionId: 'SUB-002',
        transmittedAt: ago(4),
      });
    expectError(await resend(), 409, 'STATUS_BLOCKED');
    expectError(
      await call('post', `/tax-returns/${id}/status`, adminA, { workflowStatus: 'READY_TO_FILE' }),
      409,
      'STATUS_BLOCKED',
    );
    ok(
      await call('post', `/tax-returns/${id}/status`, adminA, {
        workflowStatus: 'IN_CORRECTION',
        reason: 'Fake: fix the prior-year AGI',
      }),
      TaxReturnDetail,
    );
    expectError(await resend(), 409, 'STATUS_BLOCKED');
    ok(
      await call('post', `/tax-returns/${id}/status`, adminA, { workflowStatus: 'READY_TO_FILE' }),
      TaxReturnDetail,
    );
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
    // TX-F24: the retransmission is a new attempt; the rejected one stays with its answer.
    expect(accepted.items[0]!.attempts).toHaveLength(2);
    expect(accepted.items[0]!.attempts[1]).toMatchObject({
      id: attempt,
      submissionId: 'SUB-001',
      ackStatus: 'REJECTED',
      rejectingAgency: 'IRS',
      correctiveAction: 'Fixed the prior-year AGI',
    });
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

  it("TX-F18: only the step's reviewer decides it; an Owner or Admin as the override, recorded", async () => {
    const id = ids.r!;
    const added = ok(
      await call('post', `/tax-returns/${id}/approvals`, ownerA, {
        step: 'Staff Review',
        assignedUserId: staffA.id,
      }),
      TaxApprovalList,
    );
    const step = added.items.find((a) => a.step === 'Staff Review')!;
    // Each member reads whether the step is theirs to decide.
    const as = async (who: typeof ownerA) =>
      ok(await call('get', `/tax-returns/${id}/approvals`, who), TaxApprovalList).items.find(
        (a) => a.id === step.id,
      )!;
    expect((await as(staffA)).canDecide).toBe(true);
    expect((await as(ownerA)).canDecide).toBe(true);
    // A step assigned to someone else is not Staff's, even with the client in reach.
    const other = ok(
      await call('post', `/tax-returns/${id}/approvals`, ownerA, {
        step: 'Admin Review',
        assignedUserId: adminA.id,
      }),
      TaxApprovalList,
    ).items.find((a) => a.step === 'Admin Review')!;
    expect(
      ok(await call('get', `/tax-returns/${id}/approvals`, staffA), TaxApprovalList).items.find(
        (a) => a.id === other.id,
      )!.canDecide,
    ).toBe(false);
    expectError(
      await call('post', `/tax-returns/${id}/approvals/${other.id}/approve`, staffA, {}),
      403,
      'FORBIDDEN',
    );
    // The Owner decides Staff's step as the override, and the audit says so.
    ok(
      await call('post', `/tax-returns/${id}/approvals/${step.id}/approve`, ownerA, {}),
      TaxApprovalList,
    );
    const rows = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a, action: 'tax_return.approval', entityId: id },
        select: { metadata: true },
      }),
    );
    expect(
      rows.some(
        (r) =>
          (r.metadata as { approvalId?: string; override?: boolean } | null)?.approvalId ===
            step.id && (r.metadata as { override?: boolean }).override === true,
      ),
    ).toBe(true);
    // The assignee decides theirs without the override.
    ok(
      await call('post', `/tax-returns/${id}/approvals/${other.id}/approve`, adminA, {}),
      TaxApprovalList,
    );
    expect((await as(staffA)).canDecide).toBe(false);
  });

  it("TX-F18: a task of the return's engagement is reassigned by the return's people or the override", async () => {
    const id = ids.r!;
    // The return is prepared in client c1's engagement; Staff is c1's assignee, not its reviewer.
    const engagementId = await inFirm('a', async (tx) => {
      const e = await tx.engagement.findFirstOrThrow({
        where: { businessId: firms.a, clientId: ids.c1 },
        select: { id: true },
      });
      await tx.taxReturn.update({ where: { id }, data: { engagementId: e.id } });
      return e.id;
    });
    const created = await call('post', '/tasks', ownerA, {
      clientId: ids.c1,
      engagementId,
      title: 'Gather W-2s (fake)',
      assignedUserId: staffA.id,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const taskId = (created.body as { id: string }).id;
    expectError(
      await call('patch', `/tasks/${taskId}`, staffA, { assignedUserId: adminA.id }),
      403,
      'FORBIDDEN',
    );
    // The return's reviewer may; then the Owner as the override, recorded.
    const byReviewer = await call('patch', `/tasks/${taskId}`, adminA, {
      assignedUserId: adminA.id,
    });
    expect(byReviewer.status, JSON.stringify(byReviewer.body)).toBe(200);
    const byOwner = await call('patch', `/tasks/${taskId}`, ownerA, { assignedUserId: staffA.id });
    expect(byOwner.status, JSON.stringify(byOwner.body)).toBe(200);
    const rows = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a, action: 'task.updated', entityId: taskId },
        select: { metadata: true },
      }),
    );
    const overrides = rows.filter((r) => (r.metadata as { override?: boolean } | null)?.override);
    expect(overrides).toHaveLength(1);
    // A task tied to no return is as before: Staff reassigns their own client's task.
    const free = await call('post', '/tasks', staffA, {
      clientId: ids.c1,
      title: 'Call back (fake)',
    });
    expect(free.status, JSON.stringify(free.body)).toBe(201);
    const freeId = (free.body as { id: string }).id;
    const moved = await call('patch', `/tasks/${freeId}`, staffA, { assignedUserId: staffA.id });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
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

describe('TX-F16: Correct Tax Year (Review 2)', () => {
  it('needs a reason, never lands on another return, and on a filed return needs the reviewer', async () => {
    const fresh = ok(
      await call('post', '/tax-returns', ownerA, {
        clientId: ids.c1,
        taxYear: 2023,
        filingType: 'INDIVIDUAL',
        formType: '1040',
      }),
      TaxReturnDetail,
      201,
    );
    expectError(
      await call('post', `/tax-returns/${fresh.id}/tax-year`, ownerA, { taxYear: 2022 }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/tax-returns/${fresh.id}/tax-year`, ownerA, {
        taxYear: 2023,
        reason: 'Fake: same year',
      }),
      400,
      'VALIDATION_FAILED',
    );
    // The client's 2025 Form 1040 already exists: named, never overwritten.
    const clash = await call('post', `/tax-returns/${fresh.id}/tax-year`, ownerA, {
      taxYear: 2025,
      reason: 'Fake: entered as 2023 by mistake',
    });
    expectError(clash, 409, 'DUPLICATE_RETURN');
    expect((clash.body as { error: { details: { taxReturnId: string } } }).error.details).toEqual({
      taxReturnId: ids.r,
    });
    const corrected = ok(
      await call('post', `/tax-returns/${fresh.id}/tax-year`, staffA, {
        taxYear: 2022,
        reason: 'Fake: entered as 2023 by mistake',
      }),
      TaxReturnDetail,
    );
    expect([corrected.taxYear, corrected.filedTaxYear]).toEqual([2022, null]);
    const [row] = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { action: 'tax_return.tax_year_corrected', entityId: fresh.id },
        select: { metadata: true, actorUserId: true },
      }),
    );
    expect(row).toMatchObject({
      actorUserId: staffA.id,
      metadata: { from: 2023, to: 2022, reason: 'Fake: entered as 2023 by mistake', filed: false },
    });

    // A filed return (R10's way, status FILED with its date; the database stamps the year it
    // was filed under): Staff may not correct it; its reviewer may, and the filed year stays.
    const filedId = (
      await inFirm('a', (tx) =>
        tx.taxReturn.create({
          data: {
            businessId: firms.a,
            clientId: ids.c1!,
            taxYear: 2021,
            filingType: 'INDIVIDUAL',
            formType: '1040',
            status: 'FILED',
            filedOn: new Date('2022-04-10T00:00:00Z'),
            reviewerUserId: adminA.id,
          },
        }),
      )
    ).id;
    expectError(
      await call('post', `/tax-returns/${filedId}/tax-year`, staffA, {
        taxYear: 2020,
        reason: 'Fake: the wrong year',
      }),
      403,
      'FORBIDDEN',
    );
    const filed = ok(
      await call('post', `/tax-returns/${filedId}/tax-year`, adminA, {
        taxYear: 2020,
        reason: 'Fake: the wrong year',
      }),
      TaxReturnDetail,
    );
    expect([filed.taxYear, filed.filedTaxYear]).toEqual([2020, 2021]);
  });
});

describe('Review 2: Start Correction, Record Extension and amount rounding', () => {
  it('corrects a rejected return before review, with a reason; the client sees In Progress', async () => {
    const id = (
      await inFirm('a', (tx) =>
        tx.taxReturn.create({
          data: {
            businessId: firms.a,
            clientId: ids.c1!,
            taxYear: 2019,
            filingType: 'INDIVIDUAL',
            formType: '1040',
            status: 'REJECTED',
            filedOn: new Date('2020-04-10T00:00:00Z'),
          },
        }),
      )
    ).id;
    const rejected = ok(await call('get', `/tax-returns/${id}`, staffA), TaxReturnDetail);
    expect(rejected.canMoveTo).toContain('IN_CORRECTION');
    expect(rejected.canMoveTo).not.toContain('READY_FOR_REVIEW');
    expectError(
      await call('post', `/tax-returns/${id}/status`, staffA, {
        workflowStatus: 'READY_FOR_REVIEW',
      }),
      409,
      'STATUS_BLOCKED',
    );
    expectError(
      await call('post', `/tax-returns/${id}/status`, staffA, { workflowStatus: 'IN_CORRECTION' }),
      400,
      'REASON_REQUIRED',
    );
    const correcting = ok(
      await call('post', `/tax-returns/${id}/status`, staffA, {
        workflowStatus: 'IN_CORRECTION',
        reason: 'Fake: the prior-year AGI',
      }),
      TaxReturnDetail,
    );
    expect([correcting.workflowStatus, correcting.status, correcting.statusReason]).toEqual([
      'IN_CORRECTION',
      'IN_PROGRESS',
      'Fake: the prior-year AGI',
    ]);
    expect(correcting.canMoveTo).toContain('READY_FOR_REVIEW');
    const review = ok(
      await call('post', `/tax-returns/${id}/status`, staffA, {
        workflowStatus: 'READY_FOR_REVIEW',
      }),
      TaxReturnDetail,
    );
    expect(review.workflowStatus).toBe('READY_FOR_REVIEW');
    // Review 2 audit note: a move without a reason never repeats the one before it.
    expect(review.statusReason).toBeNull();
    const history = ok(
      await call('get', `/tax-returns/${id}/history`, staffA),
      TaxReturnHistoryList,
    );
    expect(history.items.slice(0, 2).map((h) => [h.workflowStatus, h.reason])).toEqual([
      ['READY_FOR_REVIEW', null],
      ['IN_CORRECTION', 'Fake: the prior-year AGI'],
    ]);
  });

  it('records an extension (the event only) after the due date, never on a filed return', async () => {
    const fresh = ok(
      await call('post', '/tax-returns', ownerA, {
        clientId: ids.c1,
        taxYear: 2017,
        filingType: 'INDIVIDUAL',
        formType: '1040',
        dueOn: '2018-04-17',
      }),
      TaxReturnDetail,
      201,
    );
    expect([fresh.extensionFiledOn, fresh.extendedDueOn]).toEqual([null, null]);
    const path = `/tax-returns/${fresh.id}/extension`;
    expectError(
      await call('post', path, staffA, {
        extensionFiledOn: '2018-04-10',
        extendedDueOn: '2018-04-17',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', path, staffA, {
        extensionFiledOn: '2999-04-10',
        extendedDueOn: '2999-10-15',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', path, staffA, { extensionFiledOn: '2018-04-10' }),
      400,
      'VALIDATION_FAILED',
    );
    const ext = ok(
      await call('post', path, staffA, {
        extensionFiledOn: '2018-04-10',
        extendedDueOn: '2018-10-15',
      }),
      TaxReturnDetail,
    );
    expect([ext.extensionFiledOn, ext.extendedDueOn, ext.dueOn]).toEqual([
      '2018-04-10',
      '2018-10-15',
      '2018-04-17',
    ]);
    const [row] = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { action: 'tax_return.extension_recorded', entityId: fresh.id },
        select: { metadata: true, actorUserId: true },
      }),
    );
    expect(row).toMatchObject({
      actorUserId: staffA.id,
      metadata: {
        extensionFiledOn: '2018-04-10',
        extendedDueOn: '2018-10-15',
        dueOn: '2018-04-17',
        replaced: false,
      },
    });
    // The due date never moves past the extended deadline: 400, never a 500.
    expectError(
      await call('patch', `/tax-returns/${fresh.id}/details`, ownerA, { dueOn: '2018-11-01' }),
      400,
      'VALIDATION_FAILED',
    );
    const filedId = (
      await inFirm('a', (tx) =>
        tx.taxReturn.create({
          data: {
            businessId: firms.a,
            clientId: ids.c1!,
            taxYear: 2016,
            filingType: 'INDIVIDUAL',
            formType: '1040',
            status: 'FILED',
            filedOn: new Date('2017-04-10T00:00:00Z'),
          },
        }),
      )
    ).id;
    expectError(
      await call('post', `/tax-returns/${filedId}/extension`, ownerA, {
        extensionFiledOn: '2017-04-10',
        extendedDueOn: '2017-10-16',
      }),
      409,
      'RETURN_FILED',
    );
    // Another firm reaches none of it.
    expectError(
      await call(
        'post',
        path,
        ownerB,
        { extensionFiledOn: '2018-04-10', extendedDueOn: '2018-10-15' },
        'b',
      ),
      404,
      'NOT_FOUND',
    );
  });

  it('rounds amounts to the dollar for a firm that chose it; the audit keeps the figure entered', async () => {
    expect((await call('patch', '/settings', staffA, { taxAmountRounding: 'EXACT' })).status).toBe(
      403,
    );
    const set = await call('patch', '/settings', ownerA, { taxAmountRounding: 'ROUND_TO_DOLLAR' });
    expect([set.status, (set.body as { taxAmountRounding: string }).taxAmountRounding]).toEqual([
      200,
      'ROUND_TO_DOLLAR',
    ]);
    try {
      const fresh = ok(
        await call('post', '/tax-returns', ownerA, {
          clientId: ids.c1,
          taxYear: 2015,
          filingType: 'INDIVIDUAL',
          formType: '1040',
        }),
        TaxReturnDetail,
        201,
      );
      const filings = ok(
        await call('put', `/tax-returns/${fresh.id}/filings`, ownerA, {
          filings: [{ jurisdiction: 'US' }],
        }),
        TaxReturnFilingList,
      );
      const us = filings.items.find((f) => f.jurisdiction === 'US')!.id;
      const save = async (refundCents: number) =>
        ok(
          await call('patch', `/tax-returns/${fresh.id}/filings/${us}`, ownerA, {
            refundCents,
            amountStatus: 'ESTIMATED',
            amountSource: 'STAFF_ESTIMATE',
          }),
          TaxReturnFilingList,
        ).items.find((f) => f.id === us)!.refundCents;
      // Review 2 (rounding): up to the next whole dollar for any cents; a whole dollar stays.
      expect(await save(148250)).toBe(148300);
      expect(await save(148249)).toBe(148300);
      expect(await save(148201)).toBe(148300);
      expect(await save(148300)).toBe(148300);
      const rows = await inFirm('a', (tx) =>
        tx.auditLog.findMany({
          where: { action: 'tax_return.filings_changed', entityId: fresh.id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { metadata: true },
        }),
      );
      const amounts = rows
        .map((r) => r.metadata as { amount?: { refundCents: number }; entered?: object })
        .filter((m) => m.amount);
      expect(amounts.map((m) => [m.amount!.refundCents, m.entered ?? null])).toEqual([
        [148300, { refundCents: 148250 }],
        [148300, { refundCents: 148249 }],
        [148300, { refundCents: 148201 }],
        [148300, null],
      ]);
    } finally {
      await call('patch', '/settings', ownerA, { taxAmountRounding: 'EXACT' });
    }
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
