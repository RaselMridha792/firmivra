import { describe, expect, it } from 'vitest';
import {
  AddPlanStrategyRequest,
  CalculateSavingsRequest,
  CreatePlanningStrategyRequest,
  CreateTaxOpportunityRequest,
  CreateTaxPlanRequest,
  OpportunityActionRequest,
  PlanningCalendarQuery,
  PlanningClientsQuery,
  RunScreeningRequest,
  SavePlanInputsRequest,
  SaveScenarioRequest,
  SavingsEstimate,
  SendPlanRequest,
  TAX_PLANNING_DISCLAIMER,
  TaxOpportunitiesQuery,
  UpdatePlanStrategyRequest,
  UpdateTaxPlanRequest,
  createRequest,
  createTaxPlanningClient,
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

describe('plans', () => {
  const base = { clientId: id, planYear: 2026, name: '2026 Tax Strategy Plan' };

  it('create takes the stage 1 fields: a draft with defaults', () => {
    expect(CreateTaxPlanRequest.parse(base)).toMatchObject({
      planType: 'COMPREHENSIVE',
      goals: [],
      allowDuplicate: false,
    });
    expect(
      CreateTaxPlanRequest.safeParse({
        ...base,
        planType: 'FOCUSED',
        filingStatus: null,
        entityType: 'S_CORP',
        goals: ['REDUCE_TAXABLE_INCOME', 'OTHER'],
        otherGoal: 'Open a second office',
        assignedUserId: other,
        targetCompletionOn: '2026-12-15',
      }).success,
    ).toBe(true);
    expect(CreateTaxPlanRequest.safeParse({ ...base, planYear: 1999 }).success).toBe(false);
    expect(CreateTaxPlanRequest.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(CreateTaxPlanRequest.safeParse({ ...base, goals: ['GET_RICH'] }).success).toBe(false);
    expect(CreateTaxPlanRequest.safeParse({ ...base, businessId: id }).success).toBe(false);
    expect(CreateTaxPlanRequest.safeParse({ ...base, status: 'IMPLEMENTED' }).success).toBe(false);
  });

  it('a change names the version it started from and at least one field', () => {
    expect(UpdateTaxPlanRequest.safeParse({ etag: 'v1' }).success).toBe(false);
    expect(UpdateTaxPlanRequest.safeParse({ notes: 'x' }).success).toBe(false);
    expect(
      UpdateTaxPlanRequest.safeParse({ etag: 'v1', notes: null, clientNotes: 'Hello' }).success,
    ).toBe(true);
    // The client never changes.
    expect(UpdateTaxPlanRequest.safeParse({ etag: 'v1', clientId: other }).success).toBe(false);
  });

  it('inputs need an amount or a value, and an adjustment needs a note', () => {
    const input = {
      key: 'agi',
      kind: 'HISTORICAL',
      taxYear: 2025,
      amountCents: 14_230_000,
      source: 'Tax return 2025',
    };
    expect(SavePlanInputsRequest.safeParse({ inputs: [input], etag: 'v1' }).success).toBe(true);
    expect(
      SavePlanInputsRequest.safeParse({
        inputs: [{ ...input, amountCents: undefined }],
        etag: 'v1',
      }).success,
    ).toBe(false);
    expect(
      SavePlanInputsRequest.safeParse({ inputs: [{ ...input, kind: 'ADJUSTMENT' }], etag: 'v1' })
        .success,
    ).toBe(false);
    expect(
      SavePlanInputsRequest.safeParse({
        inputs: [{ ...input, kind: 'ADJUSTMENT', note: 'Client says so' }],
        etag: 'v1',
      }).success,
    ).toBe(true);
    expect(SavePlanInputsRequest.safeParse({ inputs: [], etag: 'v1' }).success).toBe(false);
    expect(
      SavePlanInputsRequest.safeParse({ inputs: [{ ...input, key: 'Bad Key' }], etag: 'v1' })
        .success,
    ).toBe(false);
  });

  it('strategies come from the library or are custom; an override needs a reason', () => {
    expect(AddPlanStrategyRequest.safeParse({ kind: 'LIBRARY', strategyId: id }).success).toBe(
      true,
    );
    expect(AddPlanStrategyRequest.safeParse({ kind: 'LIBRARY' }).success).toBe(false);
    expect(
      AddPlanStrategyRequest.safeParse({
        kind: 'CUSTOM',
        name: 'Cost segregation',
        category: 'BUSINESS',
      }).success,
    ).toBe(true);
    expect(
      AddPlanStrategyRequest.safeParse({ kind: 'CUSTOM', name: 'X', category: 'MAGIC' }).success,
    ).toBe(false);

    expect(UpdatePlanStrategyRequest.safeParse({ etag: 'v1', selected: false }).success).toBe(true);
    expect(
      UpdatePlanStrategyRequest.safeParse({ etag: 'v1', overrideSavingsCents: 650_000 }).success,
    ).toBe(false);
    expect(
      UpdatePlanStrategyRequest.safeParse({
        etag: 'v1',
        overrideSavingsCents: 650_000,
        overrideReason: 'Prior-year actuals',
      }).success,
    ).toBe(true);
    // null clears an override.
    expect(
      UpdatePlanStrategyRequest.safeParse({ etag: 'v1', overrideSavingsCents: null }).success,
    ).toBe(true);
    expect(UpdatePlanStrategyRequest.safeParse({ etag: 'v1' }).success).toBe(false);
  });

  it('sending needs a channel and delivers only the client-facing plan', () => {
    expect(SendPlanRequest.safeParse({ channel: 'EMAIL' }).success).toBe(true);
    expect(SendPlanRequest.safeParse({ channel: 'FAX' }).success).toBe(false);
    expect(SendPlanRequest.safeParse({ channel: 'EMAIL', notes: 'internal' }).success).toBe(false);
  });
});

describe('estimates', () => {
  it('say what they are based on; an unavailable one is null with a reason', () => {
    expect(
      SavingsEstimate.safeParse({
        cents: 650_000,
        modelCents: 650_000,
        overridden: false,
        dataYear: 2026,
        calculatedAt: '2026-10-18T10:00:00.000Z',
        basis: 'Based on current year data',
        unavailableReason: null,
      }).success,
    ).toBe(true);
    expect(
      SavingsEstimate.safeParse({
        cents: null,
        modelCents: null,
        overridden: false,
        dataYear: null,
        calculatedAt: null,
        basis: null,
        unavailableReason: 'Income for 2026 is missing',
      }).success,
    ).toBe(true);
    expect(TAX_PLANNING_DISCLAIMER).toMatch(/may vary/);
  });
});

describe('opportunities', () => {
  it('the queue defaults to the biggest savings first', () => {
    expect(TaxOpportunitiesQuery.parse({})).toMatchObject({
      sort: 'savings',
      direction: 'desc',
      page: 1,
    });
    expect(TaxOpportunitiesQuery.safeParse({ group: 'open', category: 'RETIREMENT' }).success).toBe(
      true,
    );
    expect(TaxOpportunitiesQuery.safeParse({ status: 'MAYBE' }).success).toBe(false);
  });

  it('a custom opportunity names a client, a year and a category', () => {
    expect(
      CreateTaxOpportunityRequest.safeParse({
        clientId: id,
        name: 'Home office',
        category: 'DEDUCTIONS',
        taxYear: 2026,
      }).success,
    ).toBe(true);
    expect(
      CreateTaxOpportunityRequest.safeParse({ clientId: id, name: 'x', category: 'DEDUCTIONS' })
        .success,
    ).toBe(false);
  });

  it('actions are explicit; not applicable and dismiss need a reason', () => {
    expect(OpportunityActionRequest.safeParse({ action: 'START_REVIEW' }).success).toBe(true);
    expect(OpportunityActionRequest.safeParse({ action: 'ADD_TO_PLAN', planId: id }).success).toBe(
      true,
    );
    expect(OpportunityActionRequest.safeParse({ action: 'ADD_TO_PLAN' }).success).toBe(true);
    expect(OpportunityActionRequest.safeParse({ action: 'DISMISS' }).success).toBe(false);
    expect(
      OpportunityActionRequest.safeParse({ action: 'DISMISS', reason: 'Client already did this' })
        .success,
    ).toBe(true);
    expect(
      OpportunityActionRequest.safeParse({
        action: 'MARK_NOT_APPLICABLE',
        reason: 'Not eligible',
        suppressedUntil: '2027-01-01',
      }).success,
    ).toBe(true);
    expect(OpportunityActionRequest.safeParse({ action: 'ASSIGN', userId: null }).success).toBe(
      true,
    );
    expect(
      OpportunityActionRequest.safeParse({ action: 'SCHEDULE_DISCUSSION', on: '2026-11-02' })
        .success,
    ).toBe(true);
    expect(OpportunityActionRequest.safeParse({ action: 'SCHEDULE_DISCUSSION' }).success).toBe(
      false,
    );
    expect(OpportunityActionRequest.safeParse({ action: 'IMPLEMENT_NOW' }).success).toBe(false);
    expect(
      OpportunityActionRequest.safeParse({ action: 'SET_DOCUMENT', index: 0, received: true })
        .success,
    ).toBe(true);
  });

  it('screening names a client or the whole firm', () => {
    expect(RunScreeningRequest.safeParse({}).success).toBe(true);
    expect(RunScreeningRequest.safeParse({ clientId: id, taxYear: 2026 }).success).toBe(true);
    expect(RunScreeningRequest.safeParse({ taxYear: 1800 }).success).toBe(false);
  });
});

describe('library, lists, calculator and calendar', () => {
  it('a strategy has a name, a category and its checklists', () => {
    expect(
      CreatePlanningStrategyRequest.safeParse({
        name: 'Retirement contributions',
        category: 'RETIREMENT',
        eligibility: ['Client has earned income'],
        requiredInputs: ['agi', 'w2_income'],
      }).success,
    ).toBe(true);
    expect(
      CreatePlanningStrategyRequest.safeParse({
        name: 'X',
        category: 'RETIREMENT',
        requiredInputs: ['Bad Key'],
      }).success,
    ).toBe(false);
  });

  it('the clients tab filters and sorts', () => {
    expect(PlanningClientsQuery.parse({})).toMatchObject({ sort: 'name', direction: 'asc' });
    expect(
      PlanningClientsQuery.safeParse({ hasPlan: 'false', status: 'IN_PROGRESS', planYear: '2026' })
        .success,
    ).toBe(true);
    expect(PlanningClientsQuery.safeParse({ sort: 'random' }).success).toBe(false);
  });

  it('the calculator takes cents, is stateless, and saving may link a plan', () => {
    const calc = {
      taxYear: 2026,
      filingStatus: 'SINGLE',
      baseline: { wagesCents: 13_850_000, age: 40 },
      strategy: { retirementContributionCents: 2_300_000 },
    };
    expect(CalculateSavingsRequest.safeParse(calc).success).toBe(true);
    expect(
      CalculateSavingsRequest.safeParse({ ...calc, baseline: { wagesCents: -1 } }).success,
    ).toBe(false);
    expect(CalculateSavingsRequest.safeParse({ ...calc, baseline: { wages: 1 } }).success).toBe(
      false,
    );
    expect(
      CalculateSavingsRequest.safeParse({ ...calc, strategy: { magicCents: 1 } }).success,
    ).toBe(false);
    expect(
      SaveScenarioRequest.safeParse({ planId: id, name: 'Plan A', calculation: calc }).success,
    ).toBe(true);
  });

  it('the calendar range is ordered and at most 400 days', () => {
    expect(PlanningCalendarQuery.safeParse({ from: '2026-10-01', to: '2027-01-31' }).success).toBe(
      true,
    );
    expect(PlanningCalendarQuery.safeParse({ from: '2026-10-01', to: '2026-09-01' }).success).toBe(
      false,
    );
    expect(PlanningCalendarQuery.safeParse({ from: '2025-01-01', to: '2026-12-31' }).success).toBe(
      false,
    );
  });
});

describe('createTaxPlanningClient', () => {
  it('calls the routes in the contract and never sends a business id', async () => {
    const f = fakeFetch({ items: [], total: 0, page: 1, pageSize: 25 });
    const client = createTaxPlanningClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await client.opportunities({ group: 'open', category: 'RETIREMENT' });
    const url = f.calls[0]?.url ?? '';
    expect(url.startsWith('/api/v1/business/tax-planning/opportunities?')).toBe(true);
    for (const part of ['group=open', 'category=RETIREMENT', 'sort=savings'])
      expect(url).toContain(part);
    expect(JSON.stringify(f.calls)).not.toMatch(/businessId|x-business-id/i);
  });

  it('refuses bad input before sending anything', async () => {
    const f = fakeFetch({});
    const client = createTaxPlanningClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await expect(client.plan('nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.version(id, 0)).rejects.toMatchObject({ status: 400 });
    await expect(
      client.opportunityAction(id, { action: 'DISMISS' } as never),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    await expect(client.createPlan({ clientId: id } as never)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      client.sendResource('Bad Key', { clientId: id, channel: 'EMAIL' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(0);
  });
});
