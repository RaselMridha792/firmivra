import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { clearable, text } from '../clients/text.js';
import { EngagementStatus } from '../engagements/schemas.js';
import { Task } from '../tasks/schemas.js';

// Service workspaces (R12): the Bookkeeping and Tax Planning work for one engagement: status and
// stage, tasks, documents, notes and reports.
// Firm routes: /api/v1/business/workspaces/... and /business/reports/... Owner and Admin see every
// workspace; Staff see the workspaces of clients assigned to them (others are 404, like client
// records). What each part uses:
// - status and stage: R10's `api.engagements` (update, complete, cancel), not a copy;
// - tasks: `api.tasks` with `engagementId` (the detail includes the open ones);
// - notes: R11's notes API with `engagementId`; documents: R5's list with `engagementId`;
// - reports: here. The client sees a report while it is PUBLISHED (portal My Services:
//   /api/v1/portal/{firmSlug}/me/services/{engagementId}/reports). A report that was ever
//   published is never deleted (unpublish it instead).
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const CalendarDate = z.iso.date();

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

/** A report's figures: label and amount lines, with a short summary. */
export const ReportData = z.object({
  summary: z.string().nullable(),
  lines: z.array(
    z.object({ label: z.string(), amount: z.number().nullable(), note: z.string().nullable() }),
  ),
});
export type ReportData = z.infer<typeof ReportData>;

const ReportDataInput = z.strictObject({
  summary: text(2_000, 'many').nullable().default(null),
  lines: z
    .array(
      z.strictObject({
        label: text(120),
        amount: z.number().min(-1e12).max(1e12).nullable().default(null),
        note: text(500, 'many').nullable().default(null),
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

export const ReportList = z.object({ items: z.array(Report) });
export type ReportList = z.infer<typeof ReportList>;

/** A new DRAFT report; its kind must fit the workspace (REPORT_KINDS), else 409 WRONG_REPORT_KIND. */
export const CreateReportRequest = z.strictObject({
  kind: ReportKind,
  title: text(160),
  periodLabel: text(60).optional(),
  data: ReportDataInput.optional(),
  documentId: z.uuid().optional(),
});
export type CreateReportRequest = z.input<typeof CreateReportRequest>;

/** Send only what changes; `null` clears the period or the document. Published ones too. */
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
  search: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListWorkspacesQuery = z.input<typeof ListWorkspacesQuery>;

export const WorkspaceList = z.object({
  items: z.array(WorkspaceListItem).max(100),
  nextCursor: z.string().nullable(),
});
export type WorkspaceList = z.infer<typeof WorkspaceList>;

/**
 * GET /business/workspaces/{engagementId}: the engagement, its service's stages (for the stage
 * picker), the open tasks, and every report. Notes and documents come from R11 and R5.
 */
export const Workspace = WorkspaceListItem.extend({
  stages: z.array(z.string()),
  tasks: z.array(Task),
  reports: z.array(Report),
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

export const MyReportList = z.object({ items: z.array(MyReport) });
export type MyReportList = z.infer<typeof MyReportList>;

export const WorkspaceErrorCode = z.enum([
  /** 409: that report kind does not belong to this workspace (REPORT_KINDS). */
  'WRONG_REPORT_KIND',
  /** 409: a report that was ever published cannot be deleted; unpublish it. */
  'REPORT_WAS_PUBLISHED',
  /** 409: the document is not from this engagement. */
  'DOCUMENT_MISMATCH',
]);
export type WorkspaceErrorCode = z.infer<typeof WorkspaceErrorCode>;
