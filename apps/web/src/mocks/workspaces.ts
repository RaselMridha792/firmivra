import {
  ApiRequestError,
  CreateReportRequest,
  EngagementId,
  ListWorkspacesQuery,
  MyReportsQuery,
  type MyReportsClient,
  parseInput,
  Report,
  ReportId,
  REPORT_KINDS,
  ReportsQuery,
  UpdateReportRequest,
  type Workspace,
  type WorkspaceListItem,
  type WorkspacesClient,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { clientFixtures, firstClientId, type MockFirmRole, mockStaff } from './clients';
import {
  BOOKKEEPING_ENGAGEMENT,
  mockOffset,
  mockTaskStore,
  TAX_PLANNING_2025_ENGAGEMENT,
  TAX_PLANNING_ENGAGEMENT,
} from './tasks';

/**
 * Mock data for `api.workspaces` and `api.myReports(slug)` (R12): the Bookkeeping engagement from
 * mocks/engagements.ts, an active and a completed Tax Planning one, with tasks from
 * mocks/tasks.ts, a few reports and the documents a report may attach. Same checks and error codes
 * as the API (WRONG_REPORT_KIND, REPORT_WAS_PUBLISHED, DOCUMENT_MISMATCH, INTERNAL_DOCUMENT,
 * ENGAGEMENT_CLOSED). `role: 'STAFF'` is Sam Staff; every mock workspace is his client's.
 */
const at = '2026-10-07T09:00:00.000Z';
const client = { id: firstClientId, displayName: 'Jamie Sample' };
/** Fields every mock workspace shares; task counts are filled in on each read. */
const common = { client, openTasks: 0, nextDueOn: null };
const base: (WorkspaceListItem & { stages: string[] })[] = [
  {
    ...common,
    engagementId: BOOKKEEPING_ENGAGEMENT,
    kind: 'BOOKKEEPING',
    title: 'Bookkeeping (Growth)',
    serviceName: 'Bookkeeping',
    status: 'ACTIVE',
    stage: 'Monthly close',
    assignedTo: mockStaff,
    taxYear: null,
    periodStart: null,
    periodEnd: null,
    updatedAt: at,
    stages: ['Monthly close'],
  },
  {
    ...common,
    engagementId: TAX_PLANNING_ENGAGEMENT,
    kind: 'TAX_PLANNING',
    title: '2026 Tax Planning',
    serviceName: 'Tax Planning',
    status: 'ACTIVE',
    stage: 'Projection',
    assignedTo: mockStaff,
    taxYear: 2026,
    periodStart: null,
    periodEnd: null,
    updatedAt: at,
    stages: ['Discovery', 'Projection', 'Review'],
  },
  {
    ...common,
    engagementId: TAX_PLANNING_2025_ENGAGEMENT,
    kind: 'TAX_PLANNING',
    title: '2025 Tax Planning',
    serviceName: 'Tax Planning',
    status: 'COMPLETED',
    stage: 'Review',
    assignedTo: null,
    taxYear: 2025,
    periodStart: null,
    periodEnd: null,
    updatedAt: '2026-01-15T09:00:00.000Z',
    stages: ['Discovery', 'Projection', 'Review'],
  },
];
/** The engagements' documents (R5's, until its mock exists): only these may be attached. */
const documentId = (n: number) => `0199b6d4-0000-7000-8000-${String(n).padStart(12, '0')}`;
const DOCUMENTS = [
  { id: documentId(1), engagementId: BOOKKEEPING_ENGAGEMENT, internal: false },
  /** Firm-only working papers: never attached to a report. */
  { id: documentId(2), engagementId: BOOKKEEPING_ENGAGEMENT, internal: true },
  { id: documentId(3), engagementId: TAX_PLANNING_ENGAGEMENT, internal: false },
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
      documentId: documentId(1),
      data: {
        summary: 'All accounts reconciled.',
        lines: [
          { label: 'Revenue', amountCents: 4_825_000, note: null },
          { label: 'Expenses', amountCents: 3_112_050, note: null },
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
        lines: [{ label: 'Estimated tax', amountCents: 1_240_000, note: 'Placeholder' }],
      },
    }),
    report(4, {
      engagementId: TAX_PLANNING_2025_ENGAGEMENT,
      kind: 'PROJECTION',
      title: '2025 year-end projection',
      periodLabel: '2025 plan',
      status: 'PUBLISHED',
      publishedAt: '2026-01-10T09:00:00.000Z',
      firstPublishedAt: '2026-01-10T09:00:00.000Z',
      createdAt: '2026-01-05T09:00:00.000Z',
      updatedAt: '2026-01-10T09:00:00.000Z',
    }),
  ];
  return fixtures;
}

const copy = <T>(value: T): T => structuredClone(value);
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const page = <T>(all: T[], cursor: string | undefined, limit: number) => {
  const start = mockOffset(cursor);
  return {
    items: all.slice(start, start + limit),
    nextCursor: start + limit < all.length ? String(start + limit) : null,
  };
};
const newestFirst = (a: Report, b: Report) => b.createdAt.localeCompare(a.createdAt);

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

/** An in-memory `api.workspaces`. */
export function createWorkspacesMock(options: { role?: MockFirmRole } = {}): WorkspacesClient {
  let next = 100;
  const staffOnly = options.role === 'STAFF';
  const visible = (w: WorkspaceListItem) =>
    !staffOnly ||
    clientFixtures().some((c) => c.id === w.client.id && c.assignedTo?.userId === mockStaff.userId);
  const workspace = (id: string) => {
    const engagementId = parseInput(EngagementId, id);
    const w = base.find((x) => x.engagementId === engagementId && visible(x));
    if (!w) throw notFound();
    return w;
  };
  /** The report, if its workspace is visible. */
  const find = (id: string) => {
    const reportId = parseInput(ReportId, id);
    const r = reportStore().find((x) => x.id === reportId);
    if (!r) throw notFound();
    return { r, w: workspace(r.engagementId) };
  };
  /** Changes other than unpublish need an open engagement (not COMPLETED or CANCELLED). */
  const open = (w: WorkspaceListItem) => {
    if (w.status === 'COMPLETED' || w.status === 'CANCELLED') {
      throw fail(409, 'ENGAGEMENT_CLOSED', 'This service is closed; reports can no longer change');
    }
  };
  const attachable = (engagementId: string, docId: string | null | undefined) => {
    if (!docId) return;
    const doc = DOCUMENTS.find((d) => d.id === docId && d.engagementId === engagementId);
    if (!doc) throw fail(409, 'DOCUMENT_MISMATCH', 'The document is not from this service');
    if (doc.internal) {
      throw fail(
        409,
        'INTERNAL_DOCUMENT',
        'This document is firm-only; attach one the client may see',
      );
    }
  };
  const touch = (r: Report, fields: Partial<Report>) =>
    Object.assign(r, fields, { updatedAt: new Date().toISOString() });
  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListWorkspacesQuery, query);
      const search = q.search?.toLowerCase();
      const items = base
        .filter(visible)
        .filter(
          (w) =>
            (!q.kind || w.kind === q.kind) &&
            w.status === q.status &&
            (!q.assignedUserId || w.assignedTo?.userId === q.assignedUserId) &&
            (!search ||
              w.title.toLowerCase().includes(search) ||
              w.client.displayName.toLowerCase().includes(search)),
        )
        .map(({ stages: _stages, ...w }) => withTasks(w));
      return copy(page(items, q.cursor, q.limit));
    },
    get: async (engagementId) => {
      await mockDelay();
      const { stages, ...w } = workspace(engagementId);
      const detail: Workspace = { ...withTasks(w), stages };
      return copy(detail);
    },
    reports: async (engagementId, query = {}) => {
      await mockDelay();
      const w = workspace(engagementId);
      const q = parseInput(ReportsQuery, query);
      const all = reportStore()
        .filter((r) => r.engagementId === w.engagementId && (!q.status || r.status === q.status))
        .sort(newestFirst);
      return copy(page(all, q.cursor, q.limit));
    },
    createReport: async (engagementId, body) => {
      await mockDelay();
      const w = workspace(engagementId);
      const input = parseInput(CreateReportRequest, body);
      open(w);
      if (!REPORT_KINDS[w.kind].includes(input.kind)) {
        throw fail(409, 'WRONG_REPORT_KIND', 'That report kind does not belong to this workspace');
      }
      attachable(w.engagementId, input.documentId);
      const now = new Date().toISOString();
      const created = report(next++, {
        engagementId: w.engagementId,
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
      const { r, w } = find(id);
      const input = parseInput(UpdateReportRequest, body);
      open(w);
      attachable(w.engagementId, input.documentId);
      return copy(touch(r, input));
    },
    publishReport: async (id) => {
      await mockDelay();
      const { r, w } = find(id);
      open(w);
      attachable(w.engagementId, r.documentId);
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
      const { r } = find(id);
      return copy(touch(r, { status: 'DRAFT', publishedAt: null }));
    },
    deleteReport: async (id) => {
      await mockDelay();
      const { r } = find(id);
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
    list: async (id, query = {}) => {
      await mockDelay();
      const engagementId = parseInput(EngagementId, id);
      const q = parseInput(MyReportsQuery, query);
      if (!base.some((w) => w.engagementId === engagementId && w.client.id === client.id)) {
        throw notFound();
      }
      const all = reportStore()
        .filter((r) => r.engagementId === engagementId && r.status === 'PUBLISHED')
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
        .map(({ id: reportId, kind, title, periodLabel, data, documentId, publishedAt }) => ({
          id: reportId,
          kind,
          title,
          periodLabel,
          data,
          documentId,
          publishedAt,
        }));
      return copy(page(all, q.cursor, q.limit));
    },
  };
}

let mine: Map<string, MyReportsClient> | undefined;

/** `api.myReports(slug)` in mock mode: one mock per firm (by lower-cased slug), kept for the page. */
export function myReportsMock(firmSlug: string): MyReportsClient {
  mine ??= new Map();
  const key = firmSlug.toLowerCase();
  const found = mine.get(key);
  if (found) return found;
  const created = createMyReportsMock();
  mine.set(key, created);
  return created;
}
