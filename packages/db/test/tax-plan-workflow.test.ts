// Tax Planning Review 2 approved workflow (R1, Nov 14; migrations r1_tax_plan_workflow_values and
// r1_tax_plan_workflow): the internal reviewer and the delivery on a plan, the client's approval of
// an exact version (one per version, insert-only, never after today, a manual one documented), and
// requests either way (the kinds each side sends). Isolation between firms. Runs as the app role
// under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const plan = (data: Record<string, unknown> = {}) =>
  A().taxPlan.create({
    data: {
      businessId: f.firmA,
      clientId: f.clientA,
      name: 'Plan (fake)',
      planYear: 2027,
      ...data,
    },
  });
const version = (planId: string, n: number) =>
  A().taxPlanVersion.create({
    data: {
      businessId: f.firmA,
      planId,
      version: n,
      event: 'SENT',
      taxYear: 2027,
      snapshot: { strategies: [] },
    },
  });
const approval = (planId: string, data: Record<string, unknown> = {}) =>
  A().taxPlanApproval.create({
    data: {
      businessId: f.firmA,
      clientId: f.clientA,
      planId,
      version: 1,
      method: 'MANUAL',
      approvedOn: new Date('2026-11-01'),
      note: 'Approved by phone (fake).',
      recordedByUserId: f.memberA,
      ...data,
    },
  });
const request = (planId: string, data: Record<string, unknown>) =>
  A().taxPlanRequest.create({
    data: {
      businessId: f.firmA,
      clientId: f.clientA,
      planId,
      direction: 'CLIENT_TO_FIRM' as const,
      kind: 'QUESTION' as const,
      body: 'Your W-2? (fake)',
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1tpw');
});

describe('the workflow statuses and the plan', () => {
  it('takes Under Review with its reviewer, Client Approved, and a delivery with its version', async () => {
    const p = await plan();
    await expect(
      A().taxPlan.update({
        where: { id: p.id },
        data: { status: 'UNDER_REVIEW', reviewerUserId: f.member2A, reviewRequestedAt: new Date() },
      }),
    ).resolves.toMatchObject({ status: 'UNDER_REVIEW' });
    await expect(
      A().taxPlan.update({
        where: { id: p.id },
        data: { status: 'CLIENT_APPROVED', deliveredAt: new Date(), deliveredVersion: 1 },
      }),
    ).resolves.toMatchObject({ status: 'CLIENT_APPROVED', deliveredVersion: 1 });
    for (const data of [
      { reviewerUserId: null },
      { deliveredAt: null },
      { deliveredVersion: 0 },
      // Another firm's member is never a reviewer.
      { reviewerUserId: f.memberB },
    ]) {
      expect(
        await failure(A().taxPlan.update({ where: { id: p.id }, data })),
        JSON.stringify(data),
      ).toMatch(/tax_plans_review_and_delivery|foreign key|reviewer_user_id_fkey/);
    }
  });
});

describe('tax_plan_approvals', () => {
  it('approves one exact version once, documented, never after today, insert-only', async () => {
    const p = await plan();
    await version(p.id, 1);
    // Only a version that exists.
    expect(await failure(approval(p.id, { version: 2 }))).toMatch(/version_fkey/);
    const a = await approval(p.id);
    expect(a).toMatchObject({ version: 1, method: 'MANUAL' });
    expect(await failure(approval(p.id))).toMatch(/Unique constraint|business_id_plan_id_version/);
    await version(p.id, 2);
    for (const data of [
      { version: 2, note: null },
      { version: 2, recordedByUserId: null },
      { version: 2, note: ' ' },
    ]) {
      expect(await failure(approval(p.id, data)), JSON.stringify(data)).toMatch(
        /tax_plan_approvals_shape/,
      );
    }
    expect(
      await failure(approval(p.id, { version: 2, approvedOn: new Date('2099-01-01') })),
    ).toMatch(/cannot be after today/);
    // A portal approval needs no staff note.
    await expect(
      approval(p.id, { version: 2, method: 'PORTAL', note: null, recordedByUserId: null }),
    ).resolves.toBeTruthy();
    // Insert-only for the app.
    expect(
      await failure(A().taxPlanApproval.update({ where: { id: a.id }, data: { note: 'Changed' } })),
    ).toMatch(/permission denied/);
    expect(await failure(A().taxPlanApproval.delete({ where: { id: a.id } }))).toMatch(
      /permission denied/,
    );
  });

  it("ties the approval to the plan's own client", async () => {
    const p = await plan();
    await version(p.id, 1);
    expect(await failure(approval(p.id, { clientId: f.clientB }))).toMatch(
      /foreign key|client_id_plan_id_fkey/,
    );
  });
});

describe('tax_plan_requests', () => {
  it('lets each side send only its own kinds, and answers and closes with a time', async () => {
    const p = await plan();
    await expect(
      request(p.id, {
        direction: 'FIRM_TO_CLIENT',
        kind: 'DOCUMENT',
        requestedByUserId: f.memberA,
      }),
    ).resolves.toMatchObject({ status: 'OPEN' });
    const q = await request(p.id, { direction: 'CLIENT_TO_FIRM', kind: 'MEETING' });
    for (const data of [
      { direction: 'FIRM_TO_CLIENT', kind: 'QUESTION', requestedByUserId: f.memberA },
      { direction: 'FIRM_TO_CLIENT', kind: 'INFORMATION' },
      { direction: 'CLIENT_TO_FIRM', kind: 'DOCUMENT' },
      { direction: 'CLIENT_TO_FIRM', kind: 'QUESTION', body: ' ' },
      { direction: 'CLIENT_TO_FIRM', kind: 'QUESTION', status: 'ANSWERED' },
    ]) {
      expect(await failure(request(p.id, data)), JSON.stringify(data)).toMatch(
        /tax_plan_requests_shape/,
      );
    }
    await expect(
      A().taxPlanRequest.update({
        where: { id: q.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      }),
    ).resolves.toMatchObject({ status: 'CLOSED' });
    expect(await failure(A().taxPlanRequest.delete({ where: { id: q.id } }))).toMatch(
      /permission denied/,
    );
  });

  it("is firm A's own: firm B sees none of the approvals or requests", async () => {
    const p = await plan();
    await version(p.id, 1);
    await approval(p.id);
    await request(p.id, { direction: 'CLIENT_TO_FIRM', kind: 'QUESTION' });
    expect(await B().taxPlanApproval.findMany({ where: { planId: p.id } })).toEqual([]);
    expect(await B().taxPlanRequest.findMany({ where: { planId: p.id } })).toEqual([]);
  });
});
