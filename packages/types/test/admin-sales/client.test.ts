import { describe, expect, it } from 'vitest';
import {
  adminSalesReportPath,
  ApiRequestError,
  createAdminSalesClient,
  createRequest,
  CreateSalesOpportunityRequest,
  CreateSalesTargetRequest,
  isSalesTargetPeriod,
  SALES_ERRORS,
  SalesErrorCode,
  type SalesFeedEntry,
  salesFeedDetail,
  salesFeedText,
  SalesOpportunitiesQuery,
  type SalesOpportunity,
  SalesOpportunityRecord,
  SalesPeriodQuery,
  salesPlanMaxExtraSeats,
  salesPlanPriceCents,
  SaveSalesPipelineRequest,
  salesStageTone,
  salesTargetPeriodEnd,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = (n: number) => `0199d1a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-19T09:00:00.000Z';
const client = (fn: typeof fetch) =>
  createAdminSalesClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

/** A synthetic opportunity as the API answers it. */
const opportunity = (): SalesOpportunity => ({
  id: id(1),
  pipelineId: id(2),
  stageId: id(3),
  stageName: 'New Lead',
  stageType: 'ACTIVE',
  stageTone: 'blue',
  stageOrder: 0,
  firmName: 'Sample Tax Partners',
  contactId: id(4),
  contactName: 'Avery Example',
  email: 'avery@example.test',
  phone: '+15550100123',
  valueCents: null,
  plan: null,
  source: 'REFERRAL',
  owner: null,
  tags: [],
  createdAt: at,
  stageEnteredAt: at,
  updatedAt: at,
  lastActivityAt: at,
  attempts: 0,
  contactedAt: null,
  nextFollowUp: null,
  nextAppointment: null,
  convertedAt: null,
  closedAt: null,
  lostAt: null,
  lostReason: null,
  lostNote: null,
  transaction: null,
  trial: null,
  firm: null,
  firmApplication: null,
  attention: ['NO_CONTACT', 'UNASSIGNED'],
});

const feedEntry = (patch: Partial<SalesFeedEntry>): SalesFeedEntry => ({
  id: id(30),
  kind: 'CREATED',
  at,
  opportunityId: id(1),
  firmName: 'Sample Tax Partners',
  actor: { kind: 'USER', name: 'Morgan Admin' },
  source: 'MANUAL',
  fromStage: null,
  toStage: 'New Lead',
  lostReason: null,
  lostNote: null,
  transactionStatus: null,
  fromOwner: null,
  toOwner: null,
  followUp: null,
  communication: null,
  valueCents: null,
  ...patch,
});

describe('admin sales client', () => {
  it('sends the list filters, several stages as one comma-separated parameter', async () => {
    const { fn, calls } = fakeFetch(200, {
      items: [opportunity()],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    const page = await client(fn).opportunities({
      pipelineId: id(2),
      stageIds: [id(3), id(5)],
      search: '  sample ',
      overdue: true,
      unassigned: false,
      set: 'IN_PROGRESS',
      sort: 'VALUE',
      dir: 'desc',
      page: 2,
    });
    expect(page.items[0]?.firmName).toBe('Sample Tax Partners');
    const url = new URL(calls[0]!.url, 'http://x');
    expect(url.pathname).toBe('/api/v1/admin/sales/opportunities');
    expect(url.searchParams.get('stageIds')).toBe(`${id(3)},${id(5)}`);
    expect(url.searchParams.get('search')).toBe('sample');
    expect(url.searchParams.get('overdue')).toBe('true');
    expect(url.searchParams.get('unassigned')).toBe('false');
    expect(url.searchParams.get('set')).toBe('IN_PROGRESS');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.has('tagId')).toBe(false);
    expect(url.searchParams.has('attention')).toBe(false);
  });

  it('reads the query string back (the API parses the same schema)', () => {
    const parsed = SalesOpportunitiesQuery.parse({
      stageIds: `${id(3)},${id(5)}`,
      overdue: 'true',
      attention: 'false',
      page: '3',
      pageSize: '500',
    });
    expect(parsed.stageIds).toEqual([id(3), id(5)]);
    expect(parsed.overdue).toBe(true);
    expect(parsed.attention).toBe(false);
    expect(parsed.page).toBe(3);
    expect(SalesOpportunitiesQuery.safeParse({ overdue: 'yes' }).success).toBe(false);
    expect(SalesOpportunitiesQuery.safeParse({ pageSize: '501' }).success).toBe(false);
    expect(SalesOpportunitiesQuery.safeParse({ stageIds: 'not-a-uuid' }).success).toBe(false);
    expect(
      SalesOpportunitiesQuery.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success,
    ).toBe(false);
    expect(SalesOpportunitiesQuery.safeParse({ plan: 'SOLO_CORE' }).success).toBe(false);
  });

  it('asks the KPI row for the same filters', async () => {
    const { fn, calls } = fakeFetch(200, {});
    await client(fn)
      .pipelineKpis({ pipelineId: id(2), stageIds: [id(3)], attention: true })
      .catch(() => undefined);
    const url = new URL(calls[0]!.url, 'http://x');
    expect(url.pathname).toBe('/api/v1/admin/sales/summary');
    expect(url.searchParams.get('pipelineId')).toBe(id(2));
    expect(url.searchParams.get('stageIds')).toBe(id(3));
    expect(url.searchParams.get('attention')).toBe('true');
  });

  it('creates a record with the defaults filled in and the contact normalized', async () => {
    const { fn, calls } = fakeFetch(201, opportunity());
    await client(fn).createOpportunity({
      requestId: id(9),
      firmName: ' Sample Tax Partners ',
      contactName: 'Avery Example',
      email: ' Avery@Example.TEST ',
      phone: '(555) 010-0123',
      source: 'REFERRAL',
    });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/admin/sales/opportunities' });
    expect(calls[0]!.body).toEqual({
      requestId: id(9),
      firmName: 'Sample Tax Partners',
      contactName: 'Avery Example',
      email: 'avery@example.test',
      phone: '+15550100123',
      source: 'REFERRAL',
      planId: null,
      valueCents: null,
      ownerId: null,
      tagIds: [],
      allowDuplicate: false,
    });
  });

  it('refuses a bad record before sending anything', async () => {
    const { fn, calls } = fakeFetch(201, opportunity());
    const base: CreateSalesOpportunityRequest = {
      requestId: id(9),
      firmName: 'Sample Tax Partners',
      contactName: 'Avery Example',
      email: 'avery@example.test',
      source: 'WEBSITE',
    };
    const api = client(fn);
    await expect(api.createOpportunity({ ...base, firmName: '   ' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    // Neither an email nor a phone.
    await expect(api.createOpportunity({ ...base, email: '' })).rejects.toMatchObject({
      message: 'Enter an email or a phone number.',
    });
    await expect(api.createOpportunity({ ...base, phone: '12' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(api.createOpportunity({ ...base, valueCents: -1 })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(
      api.createOpportunity({ ...base, valueCents: 1_000_000_001 }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    // The platform tables refuse a soft hyphen and a line separator that `text` allows.
    await expect(
      api.createOpportunity({ ...base, firmName: 'Sample\u00ADTax' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.createOpportunity({ ...base, note: 'First line\u2028second' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.createOpportunity({ ...base, firmName: '\u200C' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(api.createOpportunity({ ...base, tagIds: [id(7), id(7)] })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(
      api.createOpportunity({ ...base, source: 'COLD_CALL' as 'WEBSITE' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.createOpportunity({ ...base, lostNote: 'No budget' })).rejects.toMatchObject({
      message: 'Choose why this record was lost.',
    });
    expect(calls).toHaveLength(0);
  });

  it('changes only the fields given, and needs one', async () => {
    const { fn, calls } = fakeFetch(200, opportunity());
    const api = client(fn);
    await api.updateOpportunity(id(1), { valueCents: 240_000, planId: id(8), phone: '' });
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: `/api/v1/admin/sales/opportunities/${id(1)}`,
      body: { valueCents: 240_000, planId: id(8), phone: null },
    });
    await expect(api.updateOpportunity(id(1), {})).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(api.updateOpportunity('not-a-uuid', { source: 'EVENT' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(calls).toHaveLength(1);
  });

  it('moves a stage with its required data, and a lost note needs a reason', async () => {
    const { fn, calls } = fakeFetch(200, opportunity());
    const api = client(fn);
    await api.moveStage(id(1), { stageId: id(6), lostReason: 'OTHER', lostNote: ' Moved abroad ' });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `/api/v1/admin/sales/opportunities/${id(1)}/stage`,
      body: { stageId: id(6), lostReason: 'OTHER', lostNote: 'Moved abroad' },
    });
    await expect(api.moveStage(id(1), { stageId: id(6), lostNote: 'x' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(
      api.moveStage(id(1), { stageId: id(6), lostReason: 'GHOSTED' as 'OTHER' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('posts every record action to its own path', async () => {
    const { fn, calls } = fakeFetch(200, opportunity());
    const api = client(fn);
    const due = '2026-10-21T15:00:00.000Z';
    await api.assign(id(1), { ownerId: id(7) });
    await api.linkTransaction(id(1), { subscriptionId: id(11) });
    await api.linkTransaction(id(1), { subscriptionId: null });
    await api.startTrial(id(1), { planId: id(8) });
    await api.logOutreach(id(1), { kind: 'CALL', outcome: 'NO_ANSWER' });
    await api.addNote(id(1), { body: 'Asked about payroll.' }).catch(() => undefined);
    await api
      .updateNote(id(1), id(12), { body: 'Asked about payroll and tax.' })
      .catch(() => undefined);
    await api.deleteNote(id(1), id(12)).catch(() => undefined);
    await api
      .addFollowUp(id(1), { kind: 'DEMO', title: 'Demo', dueAt: due })
      .catch(() => undefined);
    await api.updateFollowUp(id(13), { dueAt: due }).catch(() => undefined);
    await api.completeFollowUp(id(13)).catch(() => undefined);
    await api.cancelFollowUp(id(13)).catch(() => undefined);
    expect(calls.map((c) => `${c.method} ${c.url.replace('/api/v1/admin/sales', '')}`)).toEqual([
      `POST /opportunities/${id(1)}/assign`,
      `POST /opportunities/${id(1)}/transaction`,
      `POST /opportunities/${id(1)}/transaction`,
      `POST /opportunities/${id(1)}/trial`,
      `POST /opportunities/${id(1)}/activities`,
      `POST /opportunities/${id(1)}/notes`,
      `PATCH /opportunities/${id(1)}/notes/${id(12)}`,
      `DELETE /opportunities/${id(1)}/notes/${id(12)}`,
      `POST /opportunities/${id(1)}/follow-ups`,
      `PATCH /follow-ups/${id(13)}`,
      `POST /follow-ups/${id(13)}/complete`,
      `POST /follow-ups/${id(13)}/cancel`,
    ]);
    expect(calls[2]!.body).toEqual({ subscriptionId: null });
    expect(calls[4]!.body).toEqual({
      kind: 'CALL',
      direction: 'OUTBOUND',
      outcome: 'NO_ANSWER',
      summary: '',
      followUpId: null,
    });
    expect(calls[8]!.body).toEqual({
      kind: 'DEMO',
      title: 'Demo',
      dueAt: due,
      endsAt: null,
      location: '',
    });
    expect(calls[10]!.body).toEqual({});
  });

  it('reads and lists from their own paths', async () => {
    const { fn, calls } = fakeFetch(200, { items: [] });
    const api = client(fn);
    await api.meta().catch(() => undefined);
    await api.plans();
    await api.centerKpis({ period: 'THIS_QUARTER' }).catch(() => undefined);
    await api
      .stageCounts({ from: '2026-10-01', to: '2026-10-31', pipelineId: id(2) })
      .catch(() => undefined);
    await api.revenueByPlan().catch(() => undefined);
    await api.leadSources({ period: 'LAST_7_DAYS' }).catch(() => undefined);
    await api.activity({ kinds: ['CREATED', 'WON'], limit: 5 });
    await api.appointments({ pipelineId: id(2), kinds: ['DEMO', 'MEETING'] });
    await api.opportunity(id(1)).catch(() => undefined);
    await api.duplicates({ email: 'avery@example.test' });
    await api.subscriptions({ search: ' sample ' });
    await api.pipelines();
    await api.attentionSettings().catch(() => undefined);
    await api.targets({ on: '2026-10-19', scope: 'REP' });
    expect(calls.map((c) => `${c.method} ${c.url.replace('/api/v1/admin/sales', '')}`)).toEqual([
      'GET /meta',
      'GET /plans',
      'GET /center?period=THIS_QUARTER',
      `GET /analytics/stages?from=2026-10-01&to=2026-10-31&pipelineId=${id(2)}`,
      'GET /analytics/revenue-by-plan',
      'GET /analytics/lead-sources?period=LAST_7_DAYS',
      'GET /activity?kinds=CREATED%2CWON&limit=5',
      `GET /follow-ups?pipelineId=${id(2)}&kinds=DEMO%2CMEETING`,
      `GET /opportunities/${id(1)}`,
      'POST /opportunities/duplicate-check',
      'GET /subscriptions?search=sample',
      'GET /pipelines',
      'GET /attention-settings',
      'GET /targets?on=2026-10-19&scope=REP',
    ]);
    expect(calls[9]!.body).toEqual({ firmName: '', email: 'avery@example.test' });
    await expect(api.duplicates({})).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.activity({ kinds: ['PROPOSAL_SENT' as 'WON'] })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });

  it('checks a period or a range, not both', async () => {
    expect(SalesPeriodQuery.safeParse({}).success).toBe(true);
    expect(SalesPeriodQuery.safeParse({ from: '2026-10-01' }).success).toBe(false);
    expect(
      SalesPeriodQuery.safeParse({ period: 'THIS_MONTH', from: '2026-10-01', to: '2026-10-31' })
        .success,
    ).toBe(false);
    expect(SalesPeriodQuery.safeParse({ period: 'LAST_365_DAYS' }).success).toBe(false);
    expect(adminSalesReportPath({ period: 'THIS_YEAR' })).toBe(
      '/admin/sales/report?period=THIS_YEAR',
    );
    expect(adminSalesReportPath()).toBe('/admin/sales/report');
    expect(() => adminSalesReportPath({ from: '2026-10-01' })).toThrow(ApiRequestError);
  });

  it('runs bulk actions only on the confirmed count', async () => {
    const { fn, calls } = fakeFetch(200, { updated: 2, unchanged: 0 });
    const api = client(fn);
    const result = await api.bulk({
      ids: [id(1), id(14)],
      confirmedCount: 2,
      action: { type: 'STAGE', stageId: id(6), lostReason: 'BUDGET' },
    });
    expect(result.updated).toBe(2);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/admin/sales/opportunities/bulk',
      body: {
        ids: [id(1), id(14)],
        confirmedCount: 2,
        action: { type: 'STAGE', stageId: id(6), lostReason: 'BUDGET' },
      },
    });
    await expect(
      api.bulk({
        ids: [id(1), id(14)],
        confirmedCount: 1,
        action: { type: 'ASSIGN', ownerId: null },
      }),
    ).rejects.toMatchObject({ message: 'Confirm the number of records again.' });
    await expect(
      api.bulk({ ids: [], confirmedCount: 1, action: { type: 'ADD_TAG', tagId: id(7) } }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.bulk({
        ids: [id(1)],
        confirmedCount: 1,
        action: { type: 'DELETE' } as unknown as { type: 'ASSIGN'; ownerId: null },
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('checks follow-ups and outreach before sending', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = client(fn);
    await expect(
      api.addFollowUp(id(1), {
        kind: 'MEETING',
        title: 'Proposal review',
        dueAt: '2026-10-21T15:00:00.000Z',
        endsAt: '2026-10-21T14:00:00.000Z',
      }),
    ).rejects.toMatchObject({ message: 'End it after it starts.' });
    await expect(
      api.addFollowUp(id(1), { kind: 'DEMO', title: 'Demo', dueAt: '2026-10-21 15:00' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.updateFollowUp(id(13), {})).rejects.toBeInstanceOf(ApiRequestError);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await expect(
      api.logOutreach(id(1), { kind: 'EMAIL', occurredAt: tomorrow }),
    ).rejects.toMatchObject({ message: 'An activity cannot be dated in the future.' });
    await expect(api.addNote(id(1), { body: '  ' })).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.addNote(id(1), { body: 'x'.repeat(10_001) })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(calls).toHaveLength(0);
  });

  it('saves a pipeline in one step and checks the layout first', async () => {
    const saved = fakeFetch(200, {});
    const stages: SaveSalesPipelineRequest['stages'] = [
      { id: id(3), name: 'New Lead', type: 'ACTIVE', active: true },
      { name: 'Proposal', type: 'ACTIVE', active: true, requires: ['VALUE'] },
      { id: id(6), name: 'Lost', type: 'LOST', active: true },
    ];
    const body: SaveSalesPipelineRequest = {
      expectedUpdatedAt: at,
      name: 'Partner Pipeline',
      stages,
      removed: [{ id: id(15), moveTo: id(3) }],
    };
    await client(saved.fn)
      .savePipeline(id(2), body)
      .catch(() => undefined);
    expect(saved.calls[0]).toMatchObject({
      method: 'PUT',
      url: `/api/v1/admin/sales/pipelines/${id(2)}`,
    });
    expect(saved.calls[0]!.body).toEqual({
      expectedUpdatedAt: at,
      name: 'Partner Pipeline',
      description: '',
      stages: [
        { id: id(3), name: 'New Lead', type: 'ACTIVE', active: true, requires: [], onEnter: [] },
        { name: 'Proposal', type: 'ACTIVE', active: true, requires: ['VALUE'], onEnter: [] },
        { id: id(6), name: 'Lost', type: 'LOST', active: true, requires: [], onEnter: [] },
      ],
      removed: [{ id: id(15), moveTo: id(3) }],
    });
    const bad = (patch: Partial<SaveSalesPipelineRequest>) =>
      SaveSalesPipelineRequest.safeParse({ ...body, ...patch }).success;
    expect(bad({ stages: stages.slice(0, 1) })).toBe(false);
    expect(bad({ stages: stages.map((stage) => ({ ...stage, active: false })) })).toBe(false);
    expect(bad({ stages: [...stages, { name: 'new lead', type: 'ACTIVE', active: true }] })).toBe(
      false,
    );
    expect(bad({ removed: [{ id: id(3), moveTo: null }] })).toBe(false);
    expect(bad({ removed: [{ id: id(15), moveTo: id(16) }] })).toBe(false);
    expect(bad({ name: 'x'.repeat(101) })).toBe(false);
    expect(bad({})).toBe(true);
    const created = fakeFetch(201, {});
    await client(created.fn)
      .createPipeline({ name: 'Partner Pipeline' })
      .catch(() => undefined);
    expect(created.calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/admin/sales/pipelines',
      body: { name: 'Partner Pipeline', description: '', template: 'DEFAULT' },
    });
  });

  it('creates or changes tags by whether an id is given, and saves the settings', async () => {
    const tag = { id: id(7), name: 'Hot Lead', colorKey: null };
    const { fn, calls } = fakeFetch(200, tag);
    const api = client(fn);
    await api.saveTag({ name: 'Hot Lead' });
    await api.saveTag({ id: id(7), name: 'Hot Lead', colorKey: 'accent-red' });
    await api.deleteTag(id(7)).catch(() => undefined);
    await api
      .saveAttentionSettings({
        noContactHours: 24,
        followUpDueHours: 24,
        noResponseAttempts: 3,
        noActivityDays: 14,
        ownerRequired: true,
        lostOtherNoteRequired: true,
      })
      .catch(() => undefined);
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/v1/admin/sales/tags', { name: 'Hot Lead', colorKey: null }],
      ['PATCH', `/api/v1/admin/sales/tags/${id(7)}`, { name: 'Hot Lead', colorKey: 'accent-red' }],
      ['DELETE', `/api/v1/admin/sales/tags/${id(7)}`, undefined],
      [
        'PUT',
        '/api/v1/admin/sales/attention-settings',
        {
          noContactHours: 24,
          followUpDueHours: 24,
          noResponseAttempts: 3,
          noActivityDays: 14,
          ownerRequired: true,
          lostOtherNoteRequired: true,
        },
      ],
    ]);
    await expect(api.saveTag({ name: 'Hot Lead', colorKey: '#ff0000' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(
      api.saveAttentionSettings({
        noContactHours: 721,
        followUpDueHours: 24,
        noResponseAttempts: 3,
        noActivityDays: 14,
        ownerRequired: true,
        lostOtherNoteRequired: true,
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(4);
  });

  it('keeps targets to the database period and subject rules', async () => {
    const base: CreateSalesTargetRequest = {
      name: 'Q4 won deals',
      scope: 'COMPANY',
      metric: 'WON_DEALS',
      targetValue: 12,
      periodType: 'QUARTER',
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
    };
    const ok = (patch: Partial<CreateSalesTargetRequest>) =>
      CreateSalesTargetRequest.safeParse({ ...base, ...patch }).success;
    expect(ok({})).toBe(true);
    expect(ok({ periodStart: '2026-11-01', periodEnd: '2027-01-31' })).toBe(false);
    expect(ok({ periodEnd: '2026-12-30' })).toBe(false);
    expect(ok({ periodType: 'MONTH', periodStart: '2026-02-01', periodEnd: '2026-02-28' })).toBe(
      true,
    );
    expect(ok({ periodType: 'YEAR', periodStart: '2026-01-01', periodEnd: '2026-12-31' })).toBe(
      true,
    );
    expect(ok({ periodType: 'CUSTOM', periodStart: '2026-01-01', periodEnd: '2027-01-01' })).toBe(
      true,
    );
    expect(ok({ periodType: 'CUSTOM', periodStart: '2026-01-01', periodEnd: '2027-01-02' })).toBe(
      false,
    );
    expect(ok({ scope: 'TEAM' })).toBe(false);
    expect(ok({ scope: 'TEAM', teamId: id(20) })).toBe(true);
    expect(ok({ teamId: id(20) })).toBe(false);
    expect(ok({ scope: 'REP', repId: id(21) })).toBe(true);
    expect(ok({ metric: 'CONVERSION_RATE', targetValue: 10_001 })).toBe(false);
    expect(ok({ targetValue: 0 })).toBe(false);
    expect(salesTargetPeriodEnd('QUARTER', '2026-10-01')).toBe('2026-12-31');
    expect(salesTargetPeriodEnd('MONTH', '2028-02-01')).toBe('2028-02-29');
    expect(isSalesTargetPeriod('MONTH', '2026-10-02', '2026-11-01')).toBe(false);

    const { fn, calls } = fakeFetch(200, {});
    const api = client(fn);
    await api.createTarget(base).catch(() => undefined);
    await api.updateTarget(id(22), { targetValue: 15 }).catch(() => undefined);
    await api.archiveTarget(id(22)).catch(() => undefined);
    expect(calls.map((c) => `${c.method} ${c.url.replace('/api/v1/admin/sales', '')}`)).toEqual([
      'POST /targets',
      `PATCH /targets/${id(22)}`,
      `POST /targets/${id(22)}/archive`,
    ]);
    expect(calls[0]!.body).toEqual({ ...base, teamId: null, repId: null, note: '' });
    await expect(api.updateTarget(id(22), {})).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('reads the record in the documented shape and drops unknown fields', () => {
    const record = SalesOpportunityRecord.parse({
      opportunity: { ...opportunity(), somethingNew: 'dropped' },
      pipeline: {
        id: id(2),
        name: 'Firmivra Sales Pipeline',
        stages: [
          {
            id: id(3),
            name: 'New Lead',
            systemKey: 'new_lead',
            type: 'ACTIVE',
            tone: 'blue',
            position: 0,
            active: true,
            requires: [],
            onEnter: [],
            records: 1,
          },
        ],
      },
      notes: [],
      followUps: [],
      communications: [],
      activity: [feedEntry({})],
    });
    expect(record.opportunity).not.toHaveProperty('somethingNew');
    expect(
      SalesOpportunityRecord.shape.opportunity.safeParse({
        ...opportunity(),
        stageType: 'TRANSACTION',
      }).success,
    ).toBe(false);
  });

  it('gives each stage a colour, prices plans and words the feed', () => {
    expect(salesStageTone({ systemKey: 'appointment_set', type: 'ACTIVE' })).toBe('amber');
    expect(salesStageTone({ systemKey: null, type: 'TRANSACTION_SYNCED' })).toBe('teal');
    expect(salesStageTone({ systemKey: 'something_else', type: 'LOST' })).toBe('red');

    const teamPro = { priceCents: 19_900, seatPriceCents: 2_900, locationPriceCents: null };
    expect(salesPlanPriceCents(teamPro, 2, 5)).toBe(25_700);
    expect(salesPlanMaxExtraSeats({ includedSeats: 3, maxSeats: 10, seatPriceCents: 2_900 })).toBe(
      7,
    );
    expect(salesPlanMaxExtraSeats({ includedSeats: 1, maxSeats: 1, seatPriceCents: null })).toBe(0);
    expect(salesPlanMaxExtraSeats({ includedSeats: 20, maxSeats: null, seatPriceCents: 1 })).toBe(
      null,
    );

    expect(salesFeedText(feedEntry({}))).toBe('New lead added: Sample Tax Partners in New Lead');
    const lost = feedEntry({
      kind: 'LOST',
      toStage: 'Unqualified / Lost',
      lostReason: 'OTHER',
      lostNote: 'Moved abroad',
    });
    expect(salesFeedText(lost)).toBe('Marked Sample Tax Partners as Unqualified / Lost');
    expect(salesFeedDetail(lost)).toBe('Other: Moved abroad');
    const call = feedEntry({
      kind: 'COMMUNICATION',
      source: null,
      communication: { kind: 'CALL', direction: 'OUTBOUND', outcome: 'NO_ANSWER', summary: null },
    });
    expect(salesFeedText(call)).toBe('Call to Sample Tax Partners (No answer)');
    expect(
      salesFeedText(
        feedEntry({
          kind: 'FOLLOW_UP_SCHEDULED',
          followUp: { kind: 'DEMO', title: 'Demo', dueAt: at },
        }),
      ),
    ).toBe('Scheduled a demo with Sample Tax Partners');
    expect(salesFeedDetail(feedEntry({ kind: 'UNASSIGNED', fromOwner: 'Taylor Sample' }))).toBe(
      'Taylor Sample → Unassigned',
    );
  });

  it('has a message for every error code', () => {
    for (const code of SalesErrorCode.options) expect(SALES_ERRORS[code]).toBeTruthy();
  });
});
