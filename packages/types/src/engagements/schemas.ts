import { z } from 'zod';
import { CalendarDate, MemberRef } from '../clients/schemas.js';

// Services and engagements (R10): one engagement is one service for one client and one period.
// Firm routes: /api/v1/business/engagements/... and /business/clients/{id}/engagements
// (Owner, Admin, Staff). Portal: /api/v1/portal/{firmSlug}/me/services (the client's own).
// The database keeps the lifecycle: COMPLETED needs completedAt, CANCELLED needs cancelledAt,
// a cancelled engagement can be reactivated within 90 days, and engagements are never deleted.

const DateTime = z.iso.datetime({ offset: true });
const text = (max: number) =>
  z.string().trim().min(1, 'Enter a value').max(max, `Use at most ${max} characters`);

export const EngagementId = z.uuid();
export const EngagementStatus = z.enum(['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
export type EngagementStatus = z.infer<typeof EngagementStatus>;
/** ONE_TIME, or recurring. */
export const BillingInterval = z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'YEARLY']);
export type BillingInterval = z.infer<typeof BillingInterval>;
export const ServiceKind = z.enum([
  'ANNUAL_TAX',
  'QUARTERLY_TAX',
  'BOOKKEEPING',
  'PAYROLL',
  'TAX_PLANNING',
  'BUSINESS_DEVELOPMENT',
  'OTHER',
]);
export type ServiceKind = z.infer<typeof ServiceKind>;

export const ServiceRef = z.strictObject({ id: z.uuid(), name: z.string(), kind: ServiceKind });
export type ServiceRef = z.infer<typeof ServiceRef>;

/** An engagement as the firm sees it. */
export const Engagement = z.strictObject({
  id: z.uuid(),
  clientId: z.uuid(),
  service: ServiceRef,
  title: z.string(),
  taxYear: z.number().int().nullable(),
  periodStart: CalendarDate.nullable(),
  periodEnd: CalendarDate.nullable(),
  /** e.g. Starter, Growth, Premium. */
  package: z.string().nullable(),
  status: EngagementStatus,
  /** One of the service's workflow stages. */
  stage: z.string().nullable(),
  billingInterval: BillingInterval,
  /** True for anything but ONE_TIME (the "Recurring" tab). */
  recurring: z.boolean(),
  nextBillingOn: CalendarDate.nullable(),
  assignedTo: MemberRef.nullable(),
  completedAt: DateTime.nullable(),
  cancelRequestedAt: DateTime.nullable(),
  cancelledAt: DateTime.nullable(),
  cancellationReason: z.string().nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type Engagement = z.infer<typeof Engagement>;

/** GET /business/clients/{id}/engagements: newest first; all statuses unless one is given. */
export const ListEngagementsQuery = z.strictObject({ status: EngagementStatus.optional() });
export type ListEngagementsQuery = z.input<typeof ListEngagementsQuery>;
export const EngagementList = z.strictObject({ items: z.array(Engagement) });

/** POST /business/engagements. The billing interval defaults to the service's. */
export const CreateEngagementRequest = z.strictObject({
  clientId: z.uuid(),
  serviceId: z.uuid(),
  title: text(200),
  taxYear: z.number().int().min(2000).max(2100).optional(),
  periodStart: CalendarDate.optional(),
  periodEnd: CalendarDate.optional(),
  package: text(100).optional(),
  stage: text(100).optional(),
  billingInterval: BillingInterval.optional(),
  /** Recurring services only. */
  nextBillingOn: CalendarDate.optional(),
  assignedUserId: z.uuid().optional(),
});
export type CreateEngagementRequest = z.input<typeof CreateEngagementRequest>;

/** PATCH /business/engagements/{id}. Status changes use complete, cancel and reactivate. */
export const UpdateEngagementRequest = z
  .strictObject({
    title: text(200).optional(),
    taxYear: z.number().int().min(2000).max(2100).nullable().optional(),
    periodStart: CalendarDate.nullable().optional(),
    periodEnd: CalendarDate.nullable().optional(),
    package: text(100).nullable().optional(),
    stage: text(100).nullable().optional(),
    nextBillingOn: CalendarDate.nullable().optional(),
    assignedUserId: z.uuid().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Change at least one field');
export type UpdateEngagementRequest = z.input<typeof UpdateEngagementRequest>;

/** POST /business/engagements/{id}/cancel. */
export const CancelEngagementRequest = z.strictObject({ reason: text(500) });
export type CancelEngagementRequest = z.input<typeof CancelEngagementRequest>;

/** GET /business/engagements/{id}/history: every status or stage change, newest first. */
export const EngagementHistory = z.strictObject({
  items: z.array(
    z.strictObject({
      status: EngagementStatus,
      stage: z.string().nullable(),
      changedBy: MemberRef.nullable(),
      changedAt: DateTime,
    }),
  ),
});
export type EngagementHistory = z.infer<typeof EngagementHistory>;

// ---------- My Services (portal) ----------
/** What the client sees of an engagement (no staff, internal notes or cancellation reason). */
export const MyService = z.strictObject({
  id: z.uuid(),
  service: z.strictObject({ name: z.string(), kind: ServiceKind }),
  title: z.string(),
  taxYear: z.number().int().nullable(),
  package: z.string().nullable(),
  status: EngagementStatus,
  stage: z.string().nullable(),
  billingInterval: BillingInterval,
  recurring: z.boolean(),
  nextBillingOn: CalendarDate.nullable(),
  cancelRequestedAt: DateTime.nullable(),
  cancelledAt: DateTime.nullable(),
  /** Cancelled services: the client keeps document access until this date (60 days). */
  documentAccessUntil: CalendarDate.nullable(),
});
export type MyService = z.infer<typeof MyService>;

/** GET /portal/{firmSlug}/me/services: newest first. */
export const MyServiceList = z.strictObject({ items: z.array(MyService) });

/** POST /portal/{firmSlug}/me/services/{id}/cancel-request: recurring services only. */
export const RequestCancellationRequest = z.strictObject({
  reason: text(500).optional(),
});
export type RequestCancellationRequest = z.input<typeof RequestCancellationRequest>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const EngagementErrorCode = z.enum([
  /** 409: the stage is not one of the service's stages. */
  'INVALID_STAGE',
  /** 409: the change does not fit the engagement's status (e.g. completing a cancelled one). */
  'INVALID_STATUS',
  /** 409: a cancelled engagement can be reactivated only within 90 days. */
  'REACTIVATION_WINDOW_PASSED',
  /** 409: a cancellation must be requested at least 14 days before the next billing date. */
  'TOO_LATE_TO_CANCEL',
  /** 409: only recurring services take a cancellation request. */
  'NOT_RECURRING',
]);
export type EngagementErrorCode = z.infer<typeof EngagementErrorCode>;
