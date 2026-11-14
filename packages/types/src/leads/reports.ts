import { z } from 'zod';
import { CalendarDate } from '../clients/schemas.js';
import { LeadSource, LeadStatus } from '../db-enums.js';

// Leads Review 2, R2 18: the funnel and aging reports (Reports > Leads, linked from the Leads
// summary cards). Read only, the same firm and role reach as the Leads list (Staff: their own
// leads). Definitions, shown on the page too:
// - The leads counted: submitted leads (never a draft or a merged duplicate) created on the
//   firm's days from `from` to `to`, both included; archived ones only when asked for.
// - The funnel's stages, in order: New (SUBMITTED, IN_REVIEW), Contacted, In Follow-Up,
//   Appointment Scheduled, Qualified, Converted. A lead "reached" a stage when its status is that
//   stage or a later one now, or its history shows it there (a lead lost after Qualified reached
//   Qualified). Conversion rate: converted leads over the leads counted.
// - Aging, for open leads only (New to Qualified, not archived): days in the current stage since
//   its newest status change into it (or since the lead came in), and days since the newest
//   meaningful activity (a message, call, meeting, note, completed follow-up, appointment, status
//   change, form or document); leads with none show as "No activity yet".

export const LeadFunnelStage = z.enum([
  'NEW',
  'CONTACTED',
  'IN_FOLLOW_UP',
  'APPOINTMENT_SCHEDULED',
  'QUALIFIED',
  'CONVERTED',
]);
export type LeadFunnelStage = z.infer<typeof LeadFunnelStage>;

/** Age buckets in days, both ends included: 0 to 7, 8 to 14, 15 to 30, 31 to 60, 61 or more. */
export const LeadAgeBucket = z.enum(['D0_7', 'D8_14', 'D15_30', 'D31_60', 'D61_PLUS']);
export type LeadAgeBucket = z.infer<typeof LeadAgeBucket>;

export const LeadReportQuery = z
  .strictObject({
    /** Created on or after this firm day; default 89 days before `to`. */
    from: CalendarDate.optional(),
    /** Created on or before this firm day; default today. */
    to: CalendarDate.optional(),
    source: LeadSource.optional(),
    serviceId: z.uuid().optional(),
    /** Owner and Admin (Staff see only their own leads anyway). */
    assignedUserId: z.uuid().optional(),
    archived: z.enum(['exclude', 'include']).optional().default('exclude'),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The start is after the end',
    path: ['to'],
  });
export type LeadReportQuery = z.input<typeof LeadReportQuery>;

const Count = z.number().int().min(0);

/** GET /business/leads/reports/funnel. */
export const LeadReport = z.object({
  from: CalendarDate,
  to: CalendarDate,
  /** The firm's day the ages count to. */
  today: CalendarDate,
  /** The leads counted. */
  total: Count,
  funnel: z.array(z.object({ stage: LeadFunnelStage, reached: Count, current: Count })),
  /** Closed without converting, by their status now. */
  closed: z.object({ notQualified: Count, lost: Count }),
  /** Converted over `total`, 0 to 1; null with no leads. */
  conversionRate: z.number().min(0).max(1).nullable(),
  aging: z.object({
    open: Count,
    inStage: z.array(z.object({ bucket: LeadAgeBucket, count: Count })),
    idle: z.array(z.object({ bucket: LeadAgeBucket, count: Count })),
    noActivity: Count,
    /** Open leads per stage, with their average whole days in it. */
    byStage: z.array(
      z.object({ stage: LeadFunnelStage, open: Count, averageDays: z.number().nullable() }),
    ),
  }),
});
export type LeadReport = z.infer<typeof LeadReport>;

/**
 * GET /business/leads/reports/funnel/leads: the leads behind one number, the report's filters
 * plus what was clicked. REACHED and CURRENT take a stage; CLOSED takes NOT_QUALIFIED or LOST;
 * IN_STAGE and IDLE take a bucket (IDLE also NONE: no activity yet); OPEN_STAGE takes a stage.
 */
export const LeadReportLeadsQuery = z
  .strictObject({
    ...LeadReportQuery.shape,
    metric: z.enum(['REACHED', 'CURRENT', 'CLOSED', 'IN_STAGE', 'IDLE', 'OPEN_STAGE']),
    key: z.string().max(40),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The start is after the end',
    path: ['to'],
  });
export type LeadReportLeadsQuery = z.input<typeof LeadReportLeadsQuery>;

export const LeadReportLeads = z.object({
  /** The 200 that waited longest first; `total` counts them all. */
  items: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        status: LeadStatus,
        source: LeadSource,
        owner: z.string().nullable(),
        createdAt: z.iso.datetime({ offset: true }),
        daysInStage: z.number().int().nullable(),
        daysIdle: z.number().int().nullable(),
      }),
    )
    .max(200),
  total: Count,
});
export type LeadReportLeads = z.infer<typeof LeadReportLeads>;
