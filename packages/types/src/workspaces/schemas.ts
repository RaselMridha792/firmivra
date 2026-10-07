import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { clearable, text } from '../clients/text.js';
import { EngagementStatus } from '../engagements/schemas.js';

// Service workspaces (R12): the Bookkeeping and Tax Planning work for one engagement: status and
// stage, tasks, documents, notes and reports.
// Firm routes: /api/v1/business/workspaces/... and /business/reports/... Owner and Admin see every
// workspace; Staff see the workspaces of clients assigned to them (others are 404, like client
// records). Whoever sees a workspace drafts, edits, publishes and unpublishes its reports (R12
// Decisions). Reports change only while the engagement is open (PENDING or ACTIVE): on a
// COMPLETED or CANCELLED one, create, edit and publish are 409 ENGAGEMENT_CLOSED; unpublish
// always works, and so does deleting a draft that was never published (the client never saw it). Publishing sends the client no notice for now (R12 Decisions).
// The client side follows My Services: the logins that see a service there see its published
// reports, for as long as the service is shown. What each part uses:
// - status and stage: R10's `api.engagements` (update, complete, cancel), not a copy;
// - tasks: `api.tasks` with `engagementId` (paged);
// - notes: R11's notes API with `engagementId`; documents: R5's list with `engagementId`;
// - reports: here (paged). The client sees a report while it is PUBLISHED (portal My Services:
//   /api/v1/portal/{firmSlug}/me/services/{engagementId}/reports). A report that was ever
//   published is never deleted (unpublish it instead).
// - A report's file is one of the engagement's documents that the client may see: never an
//   INTERNAL (firm-only) one, checked when it is attached and again on publish (409
//   INTERNAL_DOCUMENT). The client downloads it only through R5's portal document route, which
//   serves CLEAN files only; `documentId` here is a reference, never a link.
// - What the client reads (title, period, summary, line labels and notes) is plain text, not
//   Markdown: screens show it as text.
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const CalendarDate = z.iso.date();
/** Optional plain text: leave it out, or send '' or null, for none. */
const optionalText = (max: number, lines: 'one' | 'many' = 'one') =>
  clearable(text(max, lines)).transform((v) => v ?? null);
/** Whole cents, up to a trillion dollars either way. */
const Cents = z.number().int('Use whole cents').min(-100_000_000_000_000).max(100_000_000_000_000);
const cursorAndLimit = (max: number, fallback: number) => ({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(max).optional().default(fallback),
});

export const ReportId = z.uuid();
export const WorkspaceKind = z.enum(['BOOKKEEPING', 'TAX_PLANNING']);
export type WorkspaceKind = z.infer<typeof WorkspaceKind>;
/** Bookkeeping: REPORT, RECONCILIATION. Tax Planning: ESTIMATE, PROJECTION. */
export const ReportKind = z.enum(['REPORT', 'RECONCILIATION', 'ESTIMATE', 'PROJECTION']);
export type ReportKind = z.infer<typeof ReportKind>;
export const REPORT_KINDS: Record<WorkspaceKind, readonly ReportKind[]> = {
  BOOKKEEPING: ['REPORT', 'RECONCILIATION'],
  TAX_PLANNING: ['ESTIMATE', 'PROJECTION'],
};
export const ReportStatus = z.enum(['DRAFT', 'PUBLISHED']);
export type ReportStatus = z.infer<typeof ReportStatus>;

/**
 * A report's figures: label and amount lines (whole cents, like all money in Firmivra), with a
 * short summary. A report saved without figures reads as `{ summary: null, lines: [] }`.
 */
export const ReportData = z.object({
  summary: z.string().nullable(),
  lines: z.array(
    z.object({
      label: z.string(),
      amountCents: z.number().int().nullable(),
      note: z.string().nullable(),
    }),
  ),
});
export type ReportData = z.infer<typeof ReportData>;

const ReportDataInput = z.strictObject({
  summary: optionalText(2_000, 'many'),
  lines: z
    .array(
      z.strictObject({
        label: text(120),
        amountCents: Cents.nullable().default(null),
        note: optionalText(500, 'many'),
      }),
    )
    .max(200)
    .default([]),
});

export const Report = z.object({
  id: z.uuid(),
  engagementId: z.uuid(),
  kind: ReportKind,
  title: z.string(),
  /** "March 2026", "Q1 2026", "2026 plan". */
  periodLabel: z.string().nullable(),
  status: ReportStatus,
  data: ReportData,
  /** The attached file, from the same engagement (R5's documents). */
  documentId: z.uuid().nullable(),
  publishedAt: DateTime.nullable(),
  /** Set the first time it is published; such a report can only be unpublished, not deleted. */
  firstPublishedAt: DateTime.nullable(),
  createdBy: MemberRef.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type Report = z.infer<typeof Report>;

/** GET /business/workspaces/{engagementId}/reports: newest first, by status, paged. */
export const ReportsQuery = z.strictObject({
  status: ReportStatus.optional(),
  ...cursorAndLimit(100, 25),
});
export type ReportsQuery = z.input<typeof ReportsQuery>;

export const ReportList = z.object({
  items: z.array(Report).max(100),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type ReportList = z.infer<typeof ReportList>;

/**
 * A new DRAFT report; its kind must fit the workspace (REPORT_KINDS), else 409 WRONG_REPORT_KIND.
 * The document must be this engagement's (409 DOCUMENT_MISMATCH) and not INTERNAL (409
 * INTERNAL_DOCUMENT).
 */
export const CreateReportRequest = z.strictObject({
  kind: ReportKind,
  title: text(160),
  periodLabel: clearable(text(60)),
  data: ReportDataInput.optional(),
  documentId: z.uuid().optional(),
});
export type CreateReportRequest = z.input<typeof CreateReportRequest>;

/**
 * Send only what changes; `null` clears the period or the document. Published ones too: the client
 * sees the change at once. The same document rules as on create.
 */
export const UpdateReportRequest = z
  .strictObject({
    title: text(160).optional(),
    periodLabel: clearable(text(60)),
    data: ReportDataInput.optional(),
    documentId: z.uuid().nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateReportRequest = z.input<typeof UpdateReportRequest>;

// ---------- Workspaces ----------
const ClientRef = z.object({ id: z.uuid(), displayName: z.string() });
/** One line, without control characters. */
const SearchText = z
  .string()
  .trim()
  .max(100)
  .regex(/^[^\p{Cc}]*$/u, 'Remove the special characters');

/** One engagement in the workspaces list. */
export const WorkspaceListItem = z.object({
  engagementId: z.uuid(),
  kind: WorkspaceKind,
  title: z.string(),
  client: ClientRef,
  serviceName: z.string(),
  status: EngagementStatus,
  stage: z.string().nullable(),
  assignedTo: MemberRef.nullable(),
  taxYear: z.number().int().nullable(),
  periodStart: CalendarDate.nullable(),
  periodEnd: CalendarDate.nullable(),
  openTasks: z.number().int(),
  /** The soonest due date of an open task. */
  nextDueOn: CalendarDate.nullable(),
  updatedAt: DateTime,
});
export type WorkspaceListItem = z.infer<typeof WorkspaceListItem>;

/** GET /business/workspaces: by kind and status (ACTIVE by default), newest activity first. */
export const ListWorkspacesQuery = z.strictObject({
  kind: WorkspaceKind.optional(),
  status: EngagementStatus.optional().default('ACTIVE'),
  assignedUserId: z.uuid().optional(),
  search: SearchText.optional(),
  ...cursorAndLimit(100, 25),
});
export type ListWorkspacesQuery = z.input<typeof ListWorkspacesQuery>;

export const WorkspaceList = z.object({
  items: z.array(WorkspaceListItem).max(100),
  nextCursor: z.string().nullable(),
});
export type WorkspaceList = z.infer<typeof WorkspaceList>;

/**
 * GET /business/workspaces/{engagementId}: the engagement and its service's stages (for the stage
 * picker). The rest is paged from its own list: tasks from `api.tasks` (`engagementId`), reports
 * from `reports()`, notes from R11 and documents from R5.
 */
export const Workspace = WorkspaceListItem.extend({
  stages: z.array(z.string()),
});
export type Workspace = z.infer<typeof Workspace>;

// ---------- The client's published reports (portal My Services) ----------
export const MyReport = Report.pick({
  id: true,
  kind: true,
  title: true,
  periodLabel: true,
  data: true,
  documentId: true,
  publishedAt: true,
});
export type MyReport = z.infer<typeof MyReport>;

/** Newest published first, paged. */
export const MyReportsQuery = z.strictObject(cursorAndLimit(50, 25));
export type MyReportsQuery = z.input<typeof MyReportsQuery>;

export const MyReportList = z.object({
  items: z.array(MyReport).max(50),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type MyReportList = z.infer<typeof MyReportList>;

export const WorkspaceErrorCode = z.enum([
  /** 409: that report kind does not belong to this workspace (REPORT_KINDS). */
  'WRONG_REPORT_KIND',
  /** 409: a report that was ever published cannot be deleted; unpublish it. */
  'REPORT_WAS_PUBLISHED',
  /** 409: the document is not from this engagement. */
  'DOCUMENT_MISMATCH',
  /** 409: the document is INTERNAL (firm only); attach one the client may see. */
  'INTERNAL_DOCUMENT',
  /** 409: the engagement is COMPLETED or CANCELLED; only unpublish still works. */
  'ENGAGEMENT_CLOSED',
]);
export type WorkspaceErrorCode = z.infer<typeof WorkspaceErrorCode>;
