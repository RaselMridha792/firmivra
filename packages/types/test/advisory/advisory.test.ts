import { describe, expect, it } from 'vitest';
import {
  ADVISORY_DISCLAIMER,
  AddAdvisoryWorkstreamRequest,
  AdvisoryClientsQuery,
  AdvisoryGoalsQuery,
  AdvisoryPlanAssessment,
  AdvisoryPlanProfile,
  AdvisoryPlanStrategy,
  CreateAdvisoryActionItemRequest,
  CreateAdvisoryClientRequest,
  CreateAdvisoryFinancialRequest,
  CreateAdvisoryGoalRequest,
  CreateAdvisoryPlanRequest,
  SaveAdvisorySettingsRequest,
  SendAdvisoryPlanRequest,
  SetAdvisoryPlanStatusRequest,
  UpdateAdvisoryGoalRequest,
  UpdateAdvisoryPlanRequest,
  createAdvisoryClient,
  createRequest,
} from '../../src/index.js';

const id = '0199c0e0-0a00-7000-8000-000000000001';
const other = '0199c0e0-0a00-7000-8000-000000000002';

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('advisory clients and services', () => {
  it('adds a client with one primary service from the catalog', () => {
    const base = { clientId: id, primaryServiceId: other };
    expect(CreateAdvisoryClientRequest.parse(base)).toMatchObject({ additionalServiceIds: [] });
    expect(
      CreateAdvisoryClientRequest.safeParse({
        ...base,
        additionalServiceIds: [id],
        advisorUserId: other,
        industry: 'Construction',
        businessStage: 'growth',
        since: '2026-01-15',
      }).success,
    ).toBe(true);
    expect(CreateAdvisoryClientRequest.safeParse({ clientId: id }).success).toBe(false);
    expect(CreateAdvisoryClientRequest.safeParse({ ...base, businessId: id }).success).toBe(false);
  });

  it('services default to additional and interested; a change names a field', () => {
    expect(AddAdvisoryWorkstreamRequest.parse({ serviceId: id })).toMatchObject({
      role: 'ADDITIONAL',
      status: 'INTERESTED',
    });
    expect(AddAdvisoryWorkstreamRequest.safeParse({ serviceId: id, status: 'DONE' }).success).toBe(
      false,
    );
  });

  it('the clients tab filters and sorts', () => {
    expect(AdvisoryClientsQuery.parse({})).toMatchObject({
      sort: 'name',
      direction: 'asc',
      page: 1,
    });
    expect(
      AdvisoryClientsQuery.safeParse({ status: 'NEEDS_REVIEW', advisorUserId: id }).success,
    ).toBe(true);
    expect(AdvisoryClientsQuery.safeParse({ status: 'GONE' }).success).toBe(false);
  });
});

describe('business plans', () => {
  const base = { advisoryClientId: id, name: '2026 Growth Plan', targetYear: 2026 };

  it('create saves a draft; the EIN is never part of the profile', () => {
    expect(CreateAdvisoryPlanRequest.safeParse(base).success).toBe(true);
    expect(CreateAdvisoryPlanRequest.safeParse({ ...base, targetYear: 1990 }).success).toBe(false);
    expect(CreateAdvisoryPlanRequest.safeParse({ ...base, status: 'FINALIZED' }).success).toBe(
      false,
    );
    expect(AdvisoryPlanProfile.safeParse({ ein: '12-3456789' }).success).toBe(false);
    expect(
      AdvisoryPlanProfile.safeParse({
        businessName: 'Acme Builders LLC',
        entityType: 'LLC',
        yearsInBusiness: 6,
        employeeCount: 12,
        address: { line1: '1 Main St', city: 'Atlanta', state: 'GA', postalCode: '30303' },
        primaryContact: { name: 'Pat Sample', email: 'pat@example.com' },
        keyTeamMembers: [{ name: 'Alex', role: 'Estimator' }],
      }).success,
    ).toBe(true);
    expect(
      AdvisoryPlanProfile.safeParse({ primaryContact: { email: 'not-an-email' } }).success,
    ).toBe(false);
  });

  it('the assessment and strategy are validated documents', () => {
    expect(
      AdvisoryPlanAssessment.safeParse({
        funding: { amountNeededCents: 25_000_000, purpose: 'Second truck', timing: 'Q1' },
        sales: { customers: 'Local builders' },
        strengths: ['Repeat customers'],
        dataSource: 'BOOKKEEPING',
      }).success,
    ).toBe(true);
    expect(AdvisoryPlanAssessment.safeParse({ funding: { amountNeededCents: -5 } }).success).toBe(
      false,
    );
    expect(AdvisoryPlanAssessment.safeParse({ dataSource: 'GUESS' }).success).toBe(false);
    expect(
      AdvisoryPlanStrategy.safeParse({
        areas: [
          { area: 'FUNDING', objective: 'Raise $250k' },
          { area: 'STAFFING', objective: 'Hire a foreman' },
        ],
      }).success,
    ).toBe(true);
    expect(
      AdvisoryPlanStrategy.safeParse({
        areas: [
          { area: 'FUNDING', objective: 'a' },
          { area: 'FUNDING', objective: 'b' },
        ],
      }).success,
    ).toBe(false);
  });

  it('a change names its etag and a field; sections merge at their top keys', () => {
    expect(UpdateAdvisoryPlanRequest.safeParse({ etag: 'v1' }).success).toBe(false);
    expect(UpdateAdvisoryPlanRequest.safeParse({ step: 2 }).success).toBe(false);
    expect(
      UpdateAdvisoryPlanRequest.safeParse({
        etag: 'v1',
        step: 3,
        strategy: { summary: 'Grow the crew' },
      }).success,
    ).toBe(true);
    expect(UpdateAdvisoryPlanRequest.safeParse({ etag: 'v1', step: 6 }).success).toBe(false);
    expect(
      UpdateAdvisoryPlanRequest.safeParse({ etag: 'v1', advisoryClientId: other }).success,
    ).toBe(false);
  });

  it('status moves are the manual ones; finalize and send have their own routes', () => {
    expect(
      SetAdvisoryPlanStatusRequest.safeParse({ status: 'IN_REVIEW', etag: 'v1' }).success,
    ).toBe(true);
    expect(
      SetAdvisoryPlanStatusRequest.safeParse({ status: 'FINALIZED', etag: 'v1' }).success,
    ).toBe(false);
    expect(SetAdvisoryPlanStatusRequest.safeParse({ status: 'SENT', etag: 'v1' }).success).toBe(
      false,
    );
    expect(SendAdvisoryPlanRequest.safeParse({ channel: 'PORTAL' }).success).toBe(true);
    expect(
      SendAdvisoryPlanRequest.safeParse({
        channel: 'EMAIL',
        version: 2,
        message: 'Here is your plan',
      }).success,
    ).toBe(true);
    expect(SendAdvisoryPlanRequest.safeParse({ channel: 'FAX' }).success).toBe(false);
  });
});

describe('financial snapshots', () => {
  const base = {
    periodStart: '2025-01-01',
    periodEnd: '2025-12-31',
    revenueCents: 120_000_000,
    expensesCents: 90_000_000,
    asOf: '2026-02-01',
  };

  it('hold a period, a figure, a source and a date; a correction is a new row', () => {
    expect(CreateAdvisoryFinancialRequest.parse(base)).toMatchObject({ source: 'MANUAL' });
    expect(
      CreateAdvisoryFinancialRequest.safeParse({ ...base, periodStart: '2026-01-01' }).success,
    ).toBe(false);
    expect(
      CreateAdvisoryFinancialRequest.safeParse({
        periodStart: base.periodStart,
        periodEnd: base.periodEnd,
        asOf: base.asOf,
      }).success,
    ).toBe(false);
    expect(
      CreateAdvisoryFinancialRequest.safeParse({
        ...base,
        netProfitCents: -5_000_000,
        cashFlowCents: -1_000,
      }).success,
    ).toBe(true);
    expect(CreateAdvisoryFinancialRequest.safeParse({ ...base, revenueCents: -1 }).success).toBe(
      false,
    );
  });

  it('an override of figures from a source carries its reason', () => {
    expect(
      CreateAdvisoryFinancialRequest.safeParse({
        ...base,
        source: 'BOOKKEEPING',
        override: { reason: 'Owner confirmed a late invoice' },
      }).success,
    ).toBe(true);
    expect(CreateAdvisoryFinancialRequest.safeParse({ ...base, override: {} }).success).toBe(false);
  });
});

describe('goals, action items and settings', () => {
  it('a goal has a title and a client; progress is 0 to 100', () => {
    expect(
      CreateAdvisoryGoalRequest.safeParse({
        advisoryClientId: id,
        title: 'Increase annual revenue by 25%',
        targetDate: '2026-12-31',
        milestones: [{ title: 'Hire estimator' }],
      }).success,
    ).toBe(true);
    expect(
      CreateAdvisoryGoalRequest.safeParse({
        advisoryClientId: id,
        title: 'x',
        progressPercent: 101,
      }).success,
    ).toBe(false);
    expect(CreateAdvisoryGoalRequest.safeParse({ advisoryClientId: id }).success).toBe(false);
    expect(UpdateAdvisoryGoalRequest.safeParse({ etag: 'v1', status: 'COMPLETED' }).success).toBe(
      true,
    );
    expect(UpdateAdvisoryGoalRequest.safeParse({ status: 'COMPLETED' }).success).toBe(false);
    expect(AdvisoryGoalsQuery.parse({})).toMatchObject({ sort: 'targetDate', direction: 'asc' });
  });

  it('only a staff action item names a person', () => {
    const base = { advisoryClientId: id, title: 'Gather 3 vendor quotes' };
    expect(CreateAdvisoryActionItemRequest.parse(base)).toMatchObject({
      assigneeKind: 'STAFF',
      priority: 'NORMAL',
      clientVisible: false,
    });
    expect(
      CreateAdvisoryActionItemRequest.safeParse({
        ...base,
        assigneeKind: 'CLIENT',
        assigneeUserId: other,
      }).success,
    ).toBe(false);
    expect(
      CreateAdvisoryActionItemRequest.safeParse({
        ...base,
        assigneeKind: 'CLIENT',
        clientVisible: true,
      }).success,
    ).toBe(true);
    expect(
      CreateAdvisoryActionItemRequest.safeParse({
        ...base,
        assigneeUserId: other,
        dueOn: '2026-11-01',
      }).success,
    ).toBe(true);
  });

  it('the health formula weights add up to 100, each factor once', () => {
    const f = (factor: string, weight: number) => ({ factor, weight });
    expect(
      SaveAdvisorySettingsRequest.safeParse({
        healthFormula: [f('profit_margin', 40), f('goal_progress', 60)],
      }).success,
    ).toBe(true);
    expect(
      SaveAdvisorySettingsRequest.safeParse({
        healthFormula: [f('profit_margin', 40), f('goal_progress', 50)],
      }).success,
    ).toBe(false);
    expect(
      SaveAdvisorySettingsRequest.safeParse({
        healthFormula: [f('a_factor', 50), f('a_factor', 50)],
      }).success,
    ).toBe(false);
    expect(SaveAdvisorySettingsRequest.safeParse({}).success).toBe(false);
    expect(SaveAdvisorySettingsRequest.safeParse({ staleFinancialsDays: 3 }).success).toBe(false);
    expect(ADVISORY_DISCLAIMER).toMatch(/not guarantees/);
  });
});

describe('createAdvisoryClient', () => {
  it('calls the routes in the contract and never sends a business id', async () => {
    const f = fakeFetch({ items: [], total: 0, page: 1, pageSize: 25 });
    const client = createAdvisoryClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await client.goals({ status: 'AT_RISK', area: 'funding' });
    const url = f.calls[0]?.url ?? '';
    expect(url.startsWith('/api/v1/business/advisory/goals?')).toBe(true);
    for (const part of ['status=AT_RISK', 'area=funding', 'sort=targetDate'])
      expect(url).toContain(part);
    expect(JSON.stringify(f.calls)).not.toMatch(/businessId|x-business-id/i);
  });

  it('reads the reports, for the firm or one advisor', async () => {
    const f = fakeFetch({});
    const client = createAdvisoryClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await client.reports().catch(() => undefined);
    await client.reports({ advisorUserId: id }).catch(() => undefined);
    expect(f.calls.map((c) => c.url)).toEqual([
      '/api/v1/business/advisory/reports',
      `/api/v1/business/advisory/reports?advisorUserId=${id}`,
    ]);
    await expect(client.reports({ advisorUserId: 'me' })).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(2);
  });

  it('refuses bad input before sending anything', async () => {
    const f = fakeFetch({});
    const client = createAdvisoryClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await expect(client.plan('nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.version(id, 0)).rejects.toMatchObject({ status: 400 });
    await expect(client.updateGoal(id, { status: 'COMPLETED' } as never)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    await expect(
      client.sendResource('Bad Key', { advisoryClientId: id, channel: 'EMAIL' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(client.addClient({ clientId: id } as never)).rejects.toMatchObject({
      status: 400,
    });
    expect(f.calls).toHaveLength(0);
  });
});
