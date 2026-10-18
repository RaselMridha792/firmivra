import { describe, expect, it } from 'vitest';
import {
  CreateReportScheduleRequest,
  ExportReportRequest,
  ReportDateSpec,
  ReportDefinitionBody,
  ReportFilters,
  ReportsDashboardQuery,
  RunReportRequest,
  SaveReportRequest,
  SaveReportSettingsRequest,
  UpdateReportScheduleRequest,
  UpdateSavedReportRequest,
  createReportsClient,
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

const definition = {
  category: 'FINANCIAL',
  dataSource: 'invoices_payments',
  columns: ['client', 'invoiceNumber', 'total'],
  date: { rule: 'ROLLING', preset: 'last_30_days' },
};

describe('date ranges', () => {
  it('a rolling range names a preset; a fixed one starts on or before its end', () => {
    expect(ReportDateSpec.safeParse({ rule: 'ROLLING', preset: 'this_quarter' }).success).toBe(
      true,
    );
    expect(ReportDateSpec.safeParse({ rule: 'ROLLING', preset: 'forever' }).success).toBe(false);
    expect(
      ReportDateSpec.safeParse({ rule: 'FIXED', from: '2026-01-01', to: '2026-01-31' }).success,
    ).toBe(true);
    expect(
      ReportDateSpec.safeParse({ rule: 'FIXED', from: '2026-02-01', to: '2026-01-31' }).success,
    ).toBe(false);
    expect(ReportDateSpec.safeParse({ rule: 'FIXED', from: '2026-01-01' }).success).toBe(false);
  });

  it('the dashboard defaults to nothing: the firm’s own default range applies', () => {
    expect(ReportsDashboardQuery.parse({})).toEqual({});
    expect(
      ReportsDashboardQuery.parse({ preset: 'this_year', compareTo: 'SAME_PERIOD_LAST_YEAR' }),
    ).toMatchObject({ preset: 'this_year' });
    expect(ReportsDashboardQuery.safeParse({ businessId: id }).success).toBe(false);
  });
});

describe('filters', () => {
  it('are AND by default, with inner groups of their own logic, one level deep', () => {
    expect(ReportFilters.parse({})).toEqual({ logic: 'AND', conditions: [], groups: [] });
    expect(
      ReportFilters.safeParse({
        logic: 'AND',
        conditions: [{ field: 'status', op: 'IS_ANY_OF', value: ['PAID', 'OPEN'] }],
        groups: [
          {
            logic: 'OR',
            conditions: [
              { field: 'total', op: 'BETWEEN', value: { from: 100, to: 500 } },
              { field: 'notes', op: 'IS_EMPTY' },
            ],
          },
        ],
      }).success,
    ).toBe(true);
    // No deeper nesting, no empty group, no unknown operator or key.
    expect(ReportFilters.safeParse({ groups: [{ logic: 'OR', conditions: [] }] }).success).toBe(
      false,
    );
    expect(
      ReportFilters.safeParse({ conditions: [{ field: 'a', op: 'LIKE', value: 'x' }] }).success,
    ).toBe(false);
    expect(
      ReportFilters.safeParse({ conditions: [{ field: 'a', op: 'EQUALS', value: 'x', extra: 1 }] })
        .success,
    ).toBe(false);
    expect(
      ReportFilters.safeParse({ conditions: [{ field: 'Bad Field', op: 'EQUALS' }] }).success,
    ).toBe(false);
  });
});

describe('definitions', () => {
  it('takes the builder’s fields with sensible defaults, strictly', () => {
    const parsed = ReportDefinitionBody.parse(definition);
    expect(parsed).toMatchObject({
      sortDescending: false,
      showTotals: false,
      compareTo: 'NONE',
      chartType: 'AUTO',
      filters: { logic: 'AND', conditions: [], groups: [] },
    });
    expect(ReportDefinitionBody.safeParse({ ...definition, businessId: id }).success).toBe(false);
    expect(ReportDefinitionBody.safeParse({ ...definition, columns: [] }).success).toBe(false);
    expect(ReportDefinitionBody.safeParse({ ...definition, columns: ['a', 'a'] }).success).toBe(
      false,
    );
    expect(ReportDefinitionBody.safeParse({ ...definition, category: 'MARKETING' }).success).toBe(
      false,
    );
    expect(ReportDefinitionBody.safeParse({ ...definition, date: undefined }).success).toBe(false);
  });

  it('a run is of a quick report, a saved report or a definition, with overrides for this run', () => {
    expect(
      RunReportRequest.safeParse({ target: { kind: 'SYSTEM', key: 'revenue-summary' } }).success,
    ).toBe(true);
    expect(RunReportRequest.safeParse({ target: { kind: 'SAVED', id } }).success).toBe(true);
    expect(
      RunReportRequest.safeParse({ target: { kind: 'DEFINITION', definition }, preview: true })
        .success,
    ).toBe(true);
    expect(RunReportRequest.safeParse({ target: { kind: 'SAVED', id: 'nope' } }).success).toBe(
      false,
    );
    expect(RunReportRequest.safeParse({ target: { kind: 'SYSTEM', key: '../x' } }).success).toBe(
      false,
    );
    const run = RunReportRequest.parse({
      target: { kind: 'SYSTEM', key: 'revenue-summary' },
      date: { rule: 'ROLLING', preset: 'last_month' },
      compareTo: 'PREVIOUS_PERIOD',
      quick: { clientType: 'NEW', serviceId: id },
      sort: { field: 'total', descending: true },
    });
    expect(run).toMatchObject({ page: 1, pageSize: 25, preview: false });
    expect(
      RunReportRequest.safeParse({ target: { kind: 'SAVED', id }, pageSize: 101 }).success,
    ).toBe(false);
  });
});

describe('saving', () => {
  it('a saved report has a name, a visibility and a definition', () => {
    const base = { name: 'Monthly Revenue', definition };
    const parsed = SaveReportRequest.parse(base);
    expect(parsed).toMatchObject({ visibility: 'PRIVATE', sharedRoles: [], favorite: false });
    expect(SaveReportRequest.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(SaveReportRequest.safeParse({ ...base, name: 'x'.repeat(121) }).success).toBe(false);
    expect(
      SaveReportRequest.safeParse({
        ...base,
        visibility: 'SELECTED',
        sharedRoles: ['STAFF'],
        sharedWithUserIds: [id],
      }).success,
    ).toBe(true);
    expect(SaveReportRequest.safeParse({ ...base, ownerUserId: id }).success).toBe(false);
  });

  it('a change names its etag and at least one field', () => {
    expect(UpdateSavedReportRequest.safeParse({ etag: 'v1' }).success).toBe(false);
    expect(UpdateSavedReportRequest.safeParse({ name: 'x' }).success).toBe(false);
    expect(UpdateSavedReportRequest.safeParse({ etag: 'v1', description: null }).success).toBe(
      true,
    );
  });
});

describe('exports', () => {
  it('are of a run (never a page) in a format, with hidden columns', () => {
    expect(
      ExportReportRequest.safeParse({
        run: { target: { kind: 'SAVED', id }, quick: { clientType: 'ACTIVE' } },
        format: 'XLSX',
        hiddenColumns: ['notes'],
      }).success,
    ).toBe(true);
    expect(
      ExportReportRequest.safeParse({ run: { target: { kind: 'SAVED', id } }, format: 'DOCX' })
        .success,
    ).toBe(false);
    expect(
      ExportReportRequest.safeParse({
        run: { target: { kind: 'SAVED', id }, page: 2 },
        format: 'CSV',
      }).success,
    ).toBe(false);
  });
});

describe('schedules', () => {
  const base = {
    target: { kind: 'SAVED', id },
    name: 'Monthly revenue',
    frequency: 'MONTHLY',
    dayOfMonth: 1,
    runTime: '08:00',
    datePreset: 'last_month',
    formats: ['PDF'],
    recipientUserIds: [other],
  };

  it('needs the day for its frequency, a recipient, a delivery and a rolling range', () => {
    expect(CreateReportScheduleRequest.safeParse(base).success).toBe(true);
    expect(CreateReportScheduleRequest.safeParse({ ...base, dayOfMonth: undefined }).success).toBe(
      false,
    );
    expect(CreateReportScheduleRequest.safeParse({ ...base, frequency: 'WEEKLY' }).success).toBe(
      false,
    );
    expect(
      CreateReportScheduleRequest.safeParse({ ...base, frequency: 'WEEKLY', weekday: 1 }).success,
    ).toBe(true);
    expect(CreateReportScheduleRequest.safeParse({ ...base, frequency: 'ANNUAL' }).success).toBe(
      false,
    );
    expect(
      CreateReportScheduleRequest.safeParse({ ...base, frequency: 'ANNUAL', monthOfYear: 1 })
        .success,
    ).toBe(true);
    expect(CreateReportScheduleRequest.safeParse({ ...base, recipientUserIds: [] }).success).toBe(
      false,
    );
    expect(
      CreateReportScheduleRequest.safeParse({
        ...base,
        recipientUserIds: [],
        recipientEmails: ['cfo@example.com'],
      }).success,
    ).toBe(true);
    expect(CreateReportScheduleRequest.safeParse({ ...base, deliverEmail: false }).success).toBe(
      false,
    );
    expect(
      CreateReportScheduleRequest.safeParse({ ...base, deliverEmail: false, deliverInApp: true })
        .success,
    ).toBe(true);
    expect(CreateReportScheduleRequest.safeParse({ ...base, datePreset: 'custom' }).success).toBe(
      false,
    );
    expect(CreateReportScheduleRequest.safeParse({ ...base, runTime: '8:00' }).success).toBe(false);
    expect(CreateReportScheduleRequest.safeParse({ ...base, runTime: '08:07' }).success).toBe(
      false,
    );
    expect(CreateReportScheduleRequest.safeParse({ ...base, formats: [] }).success).toBe(false);
  });

  it('Save & Schedule carries the new report with the schedule', () => {
    expect(
      CreateReportScheduleRequest.safeParse({
        ...base,
        target: { kind: 'NEW', report: { name: 'New one', definition } },
      }).success,
    ).toBe(true);
  });

  it('a change names a field', () => {
    expect(UpdateReportScheduleRequest.safeParse({}).success).toBe(false);
    expect(UpdateReportScheduleRequest.safeParse({ runTime: '09:30' }).success).toBe(true);
  });
});

describe('settings', () => {
  it('change at least one field within limits', () => {
    expect(SaveReportSettingsRequest.safeParse({}).success).toBe(false);
    expect(SaveReportSettingsRequest.safeParse({ revenueBasis: 'INVOICED' }).success).toBe(true);
    expect(SaveReportSettingsRequest.safeParse({ staleAfterMinutes: 1 }).success).toBe(false);
  });
});

describe('createReportsClient', () => {
  it('runs a report and never sends a business id', async () => {
    const f = fakeFetch({});
    const client = createReportsClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await client.run({ target: { kind: 'SYSTEM', key: 'revenue-summary' } }).catch(() => undefined);
    expect(f.calls[0]?.url).toBe('/api/v1/business/reports/run');
    expect(f.calls[0]?.init.method).toBe('POST');
    expect(JSON.stringify(f.calls)).not.toMatch(/businessId|x-business-id/i);
  });

  it('refuses bad input before sending anything', async () => {
    const f = fakeFetch({});
    const client = createReportsClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await expect(client.savedReport('nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.schedule('nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.runStatus('nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.save({ name: '' } as never)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    await expect(client.createSchedule({} as never)).rejects.toMatchObject({ status: 400 });
    await expect(client.lookups({ kind: 'NOPE' } as never)).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(0);
  });
});
