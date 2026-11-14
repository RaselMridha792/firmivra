// Tax Planning Review 2 (R1, Nov 14; migrations r1_tax_plan_finalized and
// r1_tax_planning_review2): a plan's history (S1), FINALIZED and a closed plan that changes only by
// reopening (S2), appointments and tasks on the same client's plan (S3, S4), and the firm's own
// planning resources (S6). Isolation between firms. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
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
const event = (planId: string, data: Record<string, unknown>) =>
  A().taxPlanEvent.create({
    data: { businessId: f.firmA, planId, kind: 'STATUS', toStatus: 'IN_PROGRESS', ...data },
  });
let slotN = 0;
const slot = () => {
  const startsAt = new Date(Date.UTC(2033, 0, 1) + slotN++ * 7_200_000);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) };
};

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1tpr2');
});

describe('plan history (S1)', () => {
  it('records events, insert-only; a reopen or revise needs a reason', async () => {
    const p = await plan();
    await expect(event(p.id, {})).resolves.toBeTruthy();
    await expect(
      event(p.id, {
        kind: 'REOPEN',
        fromStatus: 'CLOSED',
        toStatus: 'IN_PROGRESS',
        reason: 'Client asked (fake)',
      }),
    ).resolves.toBeTruthy();
    for (const data of [
      { kind: 'REOPEN', fromStatus: 'CLOSED', toStatus: 'IN_PROGRESS' },
      { kind: 'REVISE', version: 2, reason: ' ' },
      { kind: 'STATUS', toStatus: null },
      { kind: 'FINALIZE', version: 0 },
    ]) {
      expect(await failure(event(p.id, data)), JSON.stringify(data)).toMatch(
        /tax_plan_events_shape/,
      );
    }
    const e = await event(p.id, { kind: 'FINALIZE', toStatus: 'FINALIZED', version: 1 });
    expect(
      await failure(A().taxPlanEvent.update({ where: { id: e.id }, data: { reason: 'x' } })),
    ).toMatch(/permission denied/i);
    expect(await failure(A().taxPlanEvent.delete({ where: { id: e.id } }))).toMatch(
      /permission denied/i,
    );
  });
});

describe('finalized and closed plans (S2)', () => {
  it('takes FINALIZED, and a closed plan changes only its status or archive', async () => {
    const p = await plan();
    await A().taxPlan.update({ where: { id: p.id }, data: { status: 'FINALIZED' } });
    await A().taxPlan.update({ where: { id: p.id }, data: { status: 'CLOSED' } });
    for (const data of [{ name: 'Renamed (fake)' }, { notes: 'x' }, { planYear: 2028 }]) {
      expect(
        await failure(A().taxPlan.update({ where: { id: p.id }, data })),
        JSON.stringify(data),
      ).toMatch(/closed plan changes only by reopening/);
    }
    await expect(
      A().taxPlan.update({ where: { id: p.id }, data: { archivedAt: new Date() } }),
    ).resolves.toBeTruthy();
    await A().taxPlan.update({ where: { id: p.id }, data: { archivedAt: null } });
    // Reopened, it changes again.
    await A().taxPlan.update({ where: { id: p.id }, data: { status: 'IN_PROGRESS' } });
    await expect(
      A().taxPlan.update({ where: { id: p.id }, data: { name: 'Revised (fake)' } }),
    ).resolves.toMatchObject({ name: 'Revised (fake)' });
  });
});

describe("appointments and tasks on the client's plan (S3, S4)", () => {
  it("link only the same client's plan; a plan's task has a client", async () => {
    const p = await plan();
    const other = await A().client.create({
      data: { businessId: f.firmA, displayName: 'Other client (fake)' },
      select: { id: true },
    });
    const book = (clientId: string) =>
      A().appointment.create({
        data: {
          businessId: f.firmA,
          staffUserId: f.memberA,
          clientId,
          locationKind: 'PHONE',
          taxPlanId: p.id,
          ...slot(),
        },
      });
    await expect(book(f.clientA)).resolves.toMatchObject({ taxPlanId: p.id });
    expect(await failure(book(other.id))).toMatch(/foreign key/i);

    const task = (data: Record<string, unknown>) =>
      A().task.create({ data: { businessId: f.firmA, title: 'Open the account (fake)', ...data } });
    await expect(task({ clientId: f.clientA, taxPlanId: p.id })).resolves.toMatchObject({
      taxPlanId: p.id,
    });
    expect(await failure(task({ clientId: other.id, taxPlanId: p.id }))).toMatch(/foreign key/i);
    expect(
      await failure(task({ status: 'DRAFT', createdByUserId: f.memberA, taxPlanId: p.id })),
    ).toMatch(/tasks_tax_plan_has_client/);
  });
});

describe('planning resources (S6)', () => {
  it('keep one edited copy per built-in resource, within their limits', async () => {
    const res = (data: Record<string, unknown> = {}) =>
      A().taxPlanningResource.create({
        data: {
          businessId: f.firmA,
          title: 'Year-End Checklist (fake)',
          category: 'Checklists',
          kind: 'CHECKLIST',
          ...data,
        },
      });
    const key = `year-end-${randomUUID().slice(0, 8)}`;
    await expect(res({ catalogKey: key, clientFacing: true })).resolves.toMatchObject({
      clientFacing: true,
    });
    expect(await failure(res({ catalogKey: key }))).toMatch(/unique/i);
    await expect(res()).resolves.toBeTruthy();
    await expect(res()).resolves.toBeTruthy();
    for (const data of [
      { catalogKey: 'Not A Key' },
      { title: ' ' },
      { category: 'x'.repeat(101) },
      { summary: 'x'.repeat(1001) },
      { body: 'x'.repeat(20001) },
    ]) {
      expect(await failure(res(data)), Object.keys(data)[0]).toMatch(
        /tax_planning_resources_shape/,
      );
    }
    const r = await res();
    expect(await failure(A().taxPlanningResource.delete({ where: { id: r.id } }))).toMatch(
      /permission denied/i,
    );
  });
});

describe('isolation', () => {
  it("another firm sees none of firm A's events or resources, and cannot add to them", async () => {
    const p = await plan();
    await event(p.id, {});
    await A().taxPlanningResource.create({
      data: { businessId: f.firmA, title: 'Mine (fake)', category: 'Guides', kind: 'GUIDE' },
    });
    expect(await B().taxPlanEvent.findMany({ where: { planId: p.id } })).toEqual([]);
    expect(await B().taxPlanningResource.findMany({ where: { businessId: f.firmA } })).toEqual([]);
    expect(
      await failure(
        B().taxPlanEvent.create({
          data: { businessId: f.firmA, planId: p.id, kind: 'NOTE' as never },
        }),
      ),
    ).not.toBe('');
    expect(
      await failure(
        B().taxPlanningResource.create({
          data: { businessId: f.firmA, title: 'x', category: 'x', kind: 'PDF' },
        }),
      ),
    ).toMatch(/row-level security|policy/i);
    // Firm B's appointment cannot point at firm A's plan.
    expect(
      await failure(
        B().appointment.create({
          data: {
            businessId: f.firmB,
            staffUserId: f.memberB,
            clientId: f.clientB,
            locationKind: 'PHONE',
            taxPlanId: p.id,
            ...slot(),
          },
        }),
      ),
    ).toMatch(/foreign key/i);
  });
});
