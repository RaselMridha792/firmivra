import { describe, expect, it } from 'vitest';
import {
  BulkClientsRequest,
  ClientsSummary,
  createClientsClient,
  createDashboardClient,
  createRequest,
  DashboardSummaryQuery,
  ListClientsQuery,
  ListClientsResponse,
} from '../../src/index.js';

// R1: the clients list's new fields, filters, summary and bulk actions, and the dashboard's
// query (the design's This Month and This Year selectors).

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

const id = '0199b6a0-0000-7000-8000-000000000001';
const other = '0199b6a0-0000-7000-8000-000000000002';
const serviceId = '0199b6a0-0000-7000-8000-000000000010';
const kpi = { value: 3, previous: null };

describe('ListClientsQuery', () => {
  it('takes the stage, service and last-activity filters and a numbered page', () => {
    expect(
      ListClientsQuery.parse({
        clientStatus: 'PENDING_DOCUMENTS',
        serviceId,
        lastActivityFrom: '2026-10-01',
        lastActivityTo: '2026-10-20',
        page: '2',
      }),
    ).toMatchObject({ clientStatus: 'PENDING_DOCUMENTS', serviceId, page: 2, limit: 25 });
  });

  it('refuses cursor and page together, a reversed date range and an unknown stage', () => {
    expect(ListClientsQuery.safeParse({ cursor: 'abc', page: 2 }).success).toBe(false);
    expect(
      ListClientsQuery.safeParse({ lastActivityFrom: '2026-10-20', lastActivityTo: '2026-10-01' })
        .success,
    ).toBe(false);
    expect(ListClientsQuery.safeParse({ clientStatus: 'GONE' }).success).toBe(false);
  });
});

describe('ListClientsResponse', () => {
  it('reads a row with the work fields and the total', () => {
    const page = ListClientsResponse.parse({
      items: [
        {
          id,
          accountType: 'INDIVIDUAL',
          displayName: 'Jamie Sample',
          email: null,
          phone: null,
          assignedTo: null,
          portalStatus: null,
          archivedAt: null,
          createdAt: '2026-10-07T09:00:00.000Z',
          status: 'ACTIVE',
          services: [{ id: serviceId, name: 'Personal Tax', kind: 'ANNUAL_TAX' }],
          missingDocuments: 2,
          balanceDueCents: 29_000,
          lastActivityAt: '2026-10-19T09:00:00.000Z',
          nextAppointmentAt: null,
        },
      ],
      nextCursor: null,
      total: 1,
    });
    expect(page.items[0]?.services?.[0]?.kind).toBe('ANNUAL_TAX');
    expect(page.total).toBe(1);
  });
});

describe('BulkClientsRequest', () => {
  it('needs the assignee for ASSIGN, at most 100 clients and a known action', () => {
    expect(BulkClientsRequest.safeParse({ action: 'ASSIGN', clientIds: [id] }).success).toBe(false);
    expect(
      BulkClientsRequest.safeParse({ action: 'ASSIGN', clientIds: [id], assignedUserId: null })
        .success,
    ).toBe(true);
    expect(
      BulkClientsRequest.safeParse({ action: 'ARCHIVE', clientIds: Array(101).fill(id) }).success,
    ).toBe(false);
    expect(BulkClientsRequest.safeParse({ action: 'DELETE', clientIds: [id] }).success).toBe(false);
    expect(
      BulkClientsRequest.safeParse({ action: 'RESTORE', clientIds: [id], businessId: id }).success,
    ).toBe(false);
  });
});

describe('api.clients summary and bulk', () => {
  const summary = {
    kpis: {
      totalClients: { value: 127, previous: 113 },
      newClients: { value: 24, previous: 17 },
      activeClients: kpi,
      pendingDocuments: kpi,
      balancesDue: kpi,
      inactiveClients: { value: 9, previous: 9 },
    },
    counts: {
      all: 127,
      active: 98,
      new: 24,
      inactive: 9,
      byService: [{ id: serviceId, name: 'Personal Tax', kind: 'ANNUAL_TAX', count: 62 }],
    },
  };

  it('GETs the summary at its own path, before the client id routes', async () => {
    const { fn, calls } = fakeFetch(200, summary);
    const clients = createClientsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    expect(await clients.summary()).toEqual(ClientsSummary.parse(summary));
    expect(calls[0]).toMatchObject({ url: '/api/v1/business/clients/summary', method: 'GET' });
  });

  it('POSTs a bulk change and rejects a bad one before sending', async () => {
    const { fn, calls } = fakeFetch(200, {
      updated: 1,
      skipped: [{ clientId: other, code: 'NOT_FOUND' }],
    });
    const clients = createClientsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    const result = await clients.bulk({ action: 'ARCHIVE', clientIds: [id, other] });
    expect(result.skipped[0]?.code).toBe('NOT_FOUND');
    expect(calls[0]).toMatchObject({
      url: '/api/v1/business/clients/bulk',
      method: 'POST',
      body: { action: 'ARCHIVE', clientIds: [id, other] },
    });
    await expect(clients.bulk({ action: 'ARCHIVE', clientIds: [] })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(calls).toHaveLength(1);
  });
});

describe('api.dashboard summary query', () => {
  it('defaults the pipeline period and sends the revenue year', async () => {
    expect(DashboardSummaryQuery.parse({})).toEqual({ pipelinePeriod: 'THIS_MONTH' });
    expect(DashboardSummaryQuery.safeParse({ pipelinePeriod: 'NEXT_YEAR' }).success).toBe(false);
    const { fn, calls } = fakeFetch(500, {});
    const dashboard = createDashboardClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    await dashboard.summary({ pipelinePeriod: 'THIS_YEAR', revenueYear: 2025 }).catch(() => null);
    expect(calls[0]?.url).toBe(
      '/api/v1/business/dashboard/summary?pipelinePeriod=THIS_YEAR&revenueYear=2025',
    );
  });
});
