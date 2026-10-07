import { describe, expect, it } from 'vitest';
import {
  AuditLogQuery,
  CreateReportRequest,
  createAuditLogClient,
  createMyReportsClient,
  createRequest,
  createTasksClient,
  createWorkspacesClient,
  REPORT_KINDS,
  UpdateTaskRequest,
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

const id = '0199b6d0-0000-7000-8000-000000000001';

describe('tasks, reports and audit log schemas', () => {
  it('clears task fields with null, and needs at least one change', () => {
    expect(UpdateTaskRequest.parse({ details: '', dueOn: null, assignedUserId: null })).toEqual({
      details: null,
      dueOn: null,
      assignedUserId: null,
    });
    expect(UpdateTaskRequest.safeParse({}).success).toBe(false);
  });

  it('fills report data defaults, and knows which kinds fit each workspace', () => {
    expect(
      CreateReportRequest.parse({
        kind: 'ESTIMATE',
        title: '2026 plan',
        data: { lines: [{ label: 'Income' }] },
      }),
    ).toMatchObject({
      data: { summary: null, lines: [{ label: 'Income', amount: null, note: null }] },
    });
    expect(REPORT_KINDS.BOOKKEEPING).toEqual(['REPORT', 'RECONCILIATION']);
  });

  it('takes an action or its prefix, and limits the range', () => {
    for (const action of ['client.created', 'appointment.', 'client_account.approved']) {
      expect([action, AuditLogQuery.safeParse({ action }).success]).toEqual([action, true]);
    }
    expect(AuditLogQuery.safeParse({ action: 'DROP TABLE' }).success).toBe(false);
    const from = '2026-01-01T00:00:00.000Z';
    expect(AuditLogQuery.safeParse({ from, to: '2027-01-03T00:00:00.000Z' }).success).toBe(false);
  });
});

describe('clients', () => {
  it('call the firm and portal routes', async () => {
    const tasks = fakeFetch(200, { items: [], nextCursor: null });
    await createTasksClient(createRequest({ baseUrl: '', fetch: tasks.fn })).list({
      engagementId: id,
    });
    expect(tasks.calls[0]?.url).toBe(`/business/tasks?engagementId=${id}&limit=50`);

    const reports = fakeFetch(200, { items: [] });
    await createWorkspacesClient(createRequest({ baseUrl: '', fetch: reports.fn })).reports(id);
    expect(reports.calls[0]?.url).toBe(`/business/workspaces/${id}/reports`);

    const mine = fakeFetch(200, { items: [] });
    await createMyReportsClient(createRequest({ baseUrl: '', fetch: mine.fn }), 'lvp').list(id);
    expect(mine.calls[0]?.url).toBe(`/portal/lvp/me/services/${id}/reports`);

    const audit = fakeFetch(200, { items: [], nextCursor: null });
    await createAuditLogClient(createRequest({ baseUrl: '', fetch: audit.fn })).list({
      action: 'appointment.',
    });
    expect(audit.calls[0]?.url).toBe('/business/audit-log?action=appointment.&limit=50');
  });
});
