import { describe, expect, it } from 'vitest';
import {
  AuditEntry,
  AuditLogQuery,
  CreateReportRequest,
  CreateTaskRequest,
  createAuditLogClient,
  createMyReportsClient,
  createRequest,
  createTasksClient,
  createWorkspacesClient,
  ListWorkspacesQuery,
  REPORT_KINDS,
  UpdateTaskRequest,
  WorkspaceErrorCode,
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
      data: { summary: null, lines: [{ label: 'Income', amountCents: null, note: null }] },
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

describe('#71 review', () => {
  it("reads '' as none in optional text, and keeps money in whole cents", () => {
    expect(
      CreateTaskRequest.parse({ clientId: id, title: 'Call back', details: '' }),
    ).toMatchObject({ details: null });
    const report = CreateReportRequest.parse({
      kind: 'REPORT',
      title: 'September close',
      periodLabel: '',
      data: { summary: '', lines: [{ label: 'Revenue', amountCents: 4_825_000, note: '' }] },
    });
    expect(report).toMatchObject({
      periodLabel: null,
      data: { summary: null, lines: [{ label: 'Revenue', amountCents: 4_825_000, note: null }] },
    });
    const line = (amountCents: number) => ({
      kind: 'REPORT',
      title: 'Close',
      data: { lines: [{ label: 'Revenue', amountCents }] },
    });
    expect(CreateReportRequest.safeParse(line(48_250.5)).success).toBe(false);
    // Control characters stay out of report text and searches.
    expect(CreateReportRequest.safeParse({ kind: 'REPORT', title: 'Close\u0007' }).success).toBe(
      false,
    );
    expect(ListWorkspacesQuery.safeParse({ search: 'Jamie\u001b[31m' }).success).toBe(false);
    expect(WorkspaceErrorCode.options).toContain('INTERNAL_DOCUMENT');
  });

  it('takes both ends of a date range or neither, and refuses control characters', () => {
    const from = '2026-01-01T00:00:00.000Z';
    expect(AuditLogQuery.safeParse({ from }).success).toBe(false);
    expect(AuditLogQuery.safeParse({ to: from }).success).toBe(false);
    expect(AuditLogQuery.safeParse({}).success).toBe(true);
    expect(AuditLogQuery.safeParse({ entityId: 'abc\u0000' }).success).toBe(false);
  });

  it('shows Firmivra Support without a person or an IP', () => {
    const entry = {
      id,
      at: '2026-10-07T09:00:00.000Z',
      action: 'client.viewed',
      actor: { kind: 'PLATFORM', userId: null, name: 'Firmivra Support' },
      entity: { type: 'client', id },
      metadata: { via: 'support_grant' },
      ip: null,
      requestId: null,
    };
    expect(AuditEntry.parse(entry).actor).toEqual(entry.actor);
    // A Super Admin's own id never fits a PLATFORM row; a staff row needs one.
    const withPerson = { ...entry, actor: { ...entry.actor, userId: id } };
    expect(AuditEntry.safeParse(withPerson).success).toBe(false);
    const staffWithout = { ...entry, actor: { kind: 'STAFF', userId: null, name: 'Sam' } };
    expect(AuditEntry.safeParse(staffWithout).success).toBe(false);
    // Nor a person's name or an IP.
    const named = { ...entry, actor: { ...entry.actor, name: 'Pat Admin' } };
    expect(AuditEntry.safeParse(named).success).toBe(false);
    expect(AuditEntry.safeParse({ ...entry, ip: '203.0.113.10' }).success).toBe(false);
  });
});

describe('clients', () => {
  it('call the firm and portal routes', async () => {
    const tasks = fakeFetch(200, { items: [], nextCursor: null });
    await createTasksClient(createRequest({ baseUrl: '', fetch: tasks.fn })).list({
      engagementId: id,
    });
    expect(tasks.calls[0]?.url).toBe(`/business/tasks?engagementId=${id}&limit=50`);

    const reports = fakeFetch(200, { items: [], nextCursor: null });
    await createWorkspacesClient(createRequest({ baseUrl: '', fetch: reports.fn })).reports(id, {
      status: 'PUBLISHED',
    });
    expect(reports.calls[0]?.url).toBe(
      `/business/workspaces/${id}/reports?status=PUBLISHED&limit=25`,
    );

    const mine = fakeFetch(200, { items: [], nextCursor: null });
    await createMyReportsClient(createRequest({ baseUrl: '', fetch: mine.fn }), 'lvp').list(id, {
      cursor: 'next',
    });
    expect(mine.calls[0]?.url).toBe(`/portal/lvp/me/services/${id}/reports?cursor=next&limit=25`);

    const audit = fakeFetch(200, { items: [], nextCursor: null });
    await createAuditLogClient(createRequest({ baseUrl: '', fetch: audit.fn })).list({
      action: 'appointment.',
    });
    expect(audit.calls[0]?.url).toBe('/business/audit-log?action=appointment.&limit=50');
  });
});
