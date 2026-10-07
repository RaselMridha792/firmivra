import {
  ApiRequestError,
  CreateReportRequest,
  ListWorkspacesQuery,
  type MyReportsClient,
  parseInput,
  Report,
  REPORT_KINDS,
  UpdateReportRequest,
  type Workspace,
  type WorkspaceListItem,
  type WorkspacesClient,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { firstClientId, type MockFirmRole, mockStaff } from './clients';
import { BOOKKEEPING_ENGAGEMENT, mockTaskStore, TAX_PLANNING_ENGAGEMENT } from './tasks';

/**
 * Mock data for `api.workspaces` and `api.myReports(slug)` (R12): the Bookkeeping engagement from
 * mocks/engagements.ts and a Tax Planning one, with tasks from mocks/tasks.ts and a few reports.
 * Same checks and error codes as the API (WRONG_REPORT_KIND, REPORT_WAS_PUBLISHED).
 */
const at = '2026-10-07T09:00:00.000Z';
const client = { id: firstClientId, displayName: 'Jamie Sample' };
const base: (WorkspaceListItem & { stages: string[] })[] = [
  {
    engagementId: BOOKKEEPING_ENGAGEMENT,
    kind: 'BOOKKEEPING',
    title: 'Bookkeeping (Growth)',
    client,
    serviceName: 'Bookkeeping',
    status: 'ACTIVE',
    stage: 'Monthly close',
    stages: ['Monthly close'],
    assignedTo: mockStaff,
    taxYear: null,
    periodStart: null,
    periodEnd: null,
    openTasks: 0,
    nextDueOn: null,
    updatedAt: at,
  },
  {
    engagementId: TAX_PLANNING_ENGAGEMENT,
    kind: 'TAX_PLANNING',
    title: '2026 Tax Planning',
    client,
    serviceName: 'Tax Planning',
    status: 'ACTIVE',
    stage: 'Projection',
    stages: ['Discovery', 'Projection', 'Review'],
    assignedTo: mockStaff,
    taxYear: 2026,
    periodStart: null,
    periodEnd: null,
    openTasks: 0,
    nextDueOn: null,
    updatedAt: at,
  },
];
const reportId = (n: number) => `0199b6d2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const report = (
  n: number,
  fields: Partial<Report> & Pick<Report, 'engagementId' | 'kind' | 'title'>,
): Report =>
  // Parsed, so a fixture that breaks the contract fails on first use.
  Report.parse({
    id: reportId(n),
    periodLabel: null,
    status: 'DRAFT',
    data: { summary: null, lines: [] },
    documentId: null,
    publishedAt: null,
    firstPublishedAt: null,
    createdBy: mockStaff,
    createdAt: at,
    updatedAt: at,
    ...fields,
  });

let fixtures: readonly Report[] | undefined;

/** Built on first use: importing this file runs nothing. */
export function reportFixtures(): readonly Report[] {
  fixtures ??= [
    report(1, {
      engagementId: BOOKKEEPING_ENGAGEMENT,
      kind: 'REPORT',
      title: 'September close',
      periodLabel: 'September 2026',
      status: 'PUBLISHED',
      publishedAt: at,
      firstPublishedAt: at,
      data: {
        summary: 'All accounts reconciled.',
        lines: [
          { label: 'Revenue', amount: 48_250, note: null },
          { label: 'Expenses', amount: 31_120.5, note: null },
        ],
      },
    }),
    report(2, {
      engagementId: BOOKKEEPING_ENGAGEMENT,
      kind: 'RECONCILIATION',
      title: 'Bank reconciliation',
      periodLabel: 'October 2026',
    }),
    report(3, {
      engagementId: TAX_PLANNING_ENGAGEMENT,
      kind: 'ESTIMATE',
      title: '2026 estimate',
      periodLabel: '2026 plan',
      data: {
        summary: 'Draft, waiting for Q3 figures.',
        lines: [{ label: 'Estimated tax', amount: 12_400, note: 'Placeholder' }],
      },
    }),
  ];
  return fixtures;
}

const copy = <T>(value: T): T => structuredClone(value);
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');

let reports: Report[] | undefined;
const reportStore = () => (reports ??= reportFixtures().map(copy));

/** The list item with today's task counts. */
const withTasks = (w: WorkspaceListItem): WorkspaceListItem => {
  const open = mockTaskStore().filter(
    (t) => t.engagementId === w.engagementId && t.status === 'OPEN',
  );
  const due = open
    .map((t) => t.dueOn)
    .filter((d): d is string => d !== null)
    .sort();
  return { ...w, openTasks: open.length, nextDueOn: due[0] ?? null };
};

/** An in-memory `api.workspaces`. Every mock workspace is Sam Staff's client's, so STAFF sees them. */
export function createWorkspacesMock(_options: { role?: MockFirmRole } = {}): WorkspacesClient {
  let next = 100;
  const workspace = (engagementId: string) => {
    const w = base.find((x) => x.engagementId === engagementId);
    if (!w) throw notFound();
    return w;
  };
  const find = (id: string) => {
    const r = reportStore().find((x) => x.id === id);
    if (!r) throw notFound();
    return r;
  };
  const touch = (r: Report, fields: Partial<Report>) =>
    Object.assign(r, fields, { updatedAt: new Date().toISOString() });
  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListWorkspacesQuery, query);
      const items = base
        .filter((w) => (!q.kind || w.kind === q.kind) && w.status === q.status)
        .filter(
          (w) =>
            !q.search ||
            w.title.toLowerCase().includes(q.search.toLowerCase()) ||
            w.client.displayName.toLowerCase().includes(q.search.toLowerCase()),
        )
        .map(({ stages: _stages, ...w }) => withTasks(w));
      return copy({ items, nextCursor: null });
    },
    get: async (engagementId) => {
      await mockDelay();
      const { stages, ...w } = workspace(engagementId);
      const detail: Workspace = {
        ...withTasks(w),
        stages,
        tasks: mockTaskStore().filter(
          (t) => t.engagementId === engagementId && t.status === 'OPEN',
        ),
        reports: reportStore().filter((r) => r.engagementId === engagementId),
      };
      return copy(detail);
    },
    reports: async (engagementId) => {
      await mockDelay();
      workspace(engagementId);
      return copy(reportStore().filter((r) => r.engagementId === engagementId));
    },
    createReport: async (engagementId, body) => {
      await mockDelay();
      const input = parseInput(CreateReportRequest, body);
      const w = workspace(engagementId);
      if (!REPORT_KINDS[w.kind].includes(input.kind)) {
        throw fail(409, 'WRONG_REPORT_KIND', 'That report kind does not belong to this workspace');
      }
      const now = new Date().toISOString();
      const created = report(next++, {
        engagementId,
        kind: input.kind,
        title: input.title,
        periodLabel: input.periodLabel ?? null,
        data: input.data ?? { summary: null, lines: [] },
        documentId: input.documentId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      reportStore().push(created);
      return copy(created);
    },
    updateReport: async (id, body) => {
      await mockDelay();
      const input = parseInput(UpdateReportRequest, body);
      return copy(touch(find(id), input));
    },
    publishReport: async (id) => {
      await mockDelay();
      const r = find(id);
      const now = new Date().toISOString();
      return copy(
        touch(r, {
          status: 'PUBLISHED',
          publishedAt: now,
          firstPublishedAt: r.firstPublishedAt ?? now,
        }),
      );
    },
    unpublishReport: async (id) => {
      await mockDelay();
      return copy(touch(find(id), { status: 'DRAFT', publishedAt: null }));
    },
    deleteReport: async (id) => {
      await mockDelay();
      const r = find(id);
      if (r.firstPublishedAt) {
        throw fail(
          409,
          'REPORT_WAS_PUBLISHED',
          'A report that was published cannot be deleted; unpublish it',
        );
      }
      reports = reportStore().filter((x) => x !== r);
      return { ok: true };
    },
  };
}

/** An in-memory `api.myReports(slug)`: published reports of the signed-in client's services. */
export function createMyReportsMock(): MyReportsClient {
  return {
    list: async (engagementId) => {
      await mockDelay();
      if (!base.some((w) => w.engagementId === engagementId)) throw notFound();
      return copy(
        reportStore()
          .filter((r) => r.engagementId === engagementId && r.status === 'PUBLISHED')
          .map(({ id, kind, title, periodLabel, data, documentId, publishedAt }) => ({
            id,
            kind,
            title,
            periodLabel,
            data,
            documentId,
            publishedAt,
          })),
      );
    },
  };
}
