import { z } from 'zod';
import { CalendarDate, MemberRef } from '../clients/schemas.js';
import { clearable, text } from '../clients/text.js';

// Services and engagements (R10): one engagement is one service for one client and one period.
// Firm routes: /api/v1/business/clients/{id}/engagements and /business/engagements/{id}. Owner and
// Admin see every client's; Staff only their own clients' (others are 404).
// Portal: /api/v1/portal/{firmSlug}/me/services (the client's own).
// The database keeps the lifecycle: COMPLETED needs completedAt, CANCELLED needs cancelledAt,
// a cancelled engagement can be reactivated within 90 days, and engagements are never deleted.
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

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

export const ServiceRef = z.object({ id: z.uuid(), name: z.string(), kind: ServiceKind });
export type ServiceRef = z.infer<typeof ServiceRef>;

const TaxYearValue = z.number().int().min(2000).max(2100);
const periodInOrder = (body: { periodStart?: string | null; periodEnd?: string | null }) =>
  !body.periodStart || !body.periodEnd || body.periodEnd >= body.periodStart;
const PERIOD_ORDER = { message: 'The period must end on or after its start', path: ['periodEnd'] };

/** An engagement as the firm sees it. */
export const Engagement = z.object({
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
  /** The client asked to cancel (portal), with their reason. */
  cancelRequestedAt: DateTime.nullable(),
  cancelRequestReason: z.string().nullable(),
  cancelledAt: DateTime.nullable(),
  /** The firm's reason when it cancelled. */
  cancellationReason: z.string().nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type Engagement = z.infer<typeof Engagement>;

/** GET /business/clients/{id}/engagements: newest first; all statuses unless one is given. */
export const ListEngagementsQuery = z.strictObject({ status: EngagementStatus.optional() });
export type ListEngagementsQuery = z.input<typeof ListEngagementsQuery>;
export const EngagementList = z.object({ items: z.array(Engagement) });

/**
 * POST /business/clients/{id}/engagements. The billing interval defaults to the service's; a next
 * billing date only for a recurring one (the API answers 400 if the service's default is
 * ONE_TIME).
 */
export const CreateEngagementRequest = z
  .strictObject({
    serviceId: z.uuid(),
    title: text(200),
    taxYear: TaxYearValue.optional(),
    periodStart: CalendarDate.optional(),
    periodEnd: CalendarDate.optional(),
    package: text(100).optional(),
    stage: text(100).optional(),
    billingInterval: BillingInterval.optional(),
    nextBillingOn: CalendarDate.optional(),
    assignedUserId: z.uuid().optional(),
  })
  .refine(periodInOrder, PERIOD_ORDER)
  .refine((body) => !body.nextBillingOn || body.billingInterval !== 'ONE_TIME', {
    message: 'Only a recurring service has a next billing date',
    path: ['nextBillingOn'],
  });
export type CreateEngagementRequest = z.input<typeof CreateEngagementRequest>;

/**
 * PATCH /business/engagements/{id}. Status changes use complete, cancel and reactivate.
 * `null` or `''` clears a field; the assignee is Owner and Admin only.
 */
export const UpdateEngagementRequest = z
  .strictObject({
    title: text(200).optional(),
    taxYear: TaxYearValue.nullable().optional(),
    periodStart: clearable(CalendarDate),
    periodEnd: clearable(CalendarDate),
    package: clearable(text(100)),
    stage: clearable(text(100)),
    nextBillingOn: clearable(CalendarDate),
    assignedUserId: z.uuid().nullable().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), 'Change at least one field')
  .refine(periodInOrder, PERIOD_ORDER);
export type UpdateEngagementRequest = z.input<typeof UpdateEngagementRequest>;

/** POST /business/engagements/{id}/cancel. */
export const CancelEngagementRequest = z.strictObject({ reason: text(500, 'many') });
export type CancelEngagementRequest = z.input<typeof CancelEngagementRequest>;

/** GET /business/engagements/{id}/history: every status or stage change, newest first. */
export const EngagementHistory = z.object({
  items: z.array(
    z.object({
      status: EngagementStatus,
      stage: z.string().nullable(),
      changedBy: MemberRef.nullable(),
      changedAt: DateTime,
    }),
  ),
});
export type EngagementHistory = z.infer<typeof EngagementHistory>;

// ---------- My Services (portal) ----------
/** What the client sees of an engagement (no staff, internal notes or the firm's reason). */
export const MyService = z.object({
  id: z.uuid(),
  service: z.object({ name: z.string(), kind: ServiceKind }),
  title: z.string(),
  taxYear: z.number().int().nullable(),
  package: z.string().nullable(),
  status: EngagementStatus,
  stage: z.string().nullable(),
  billingInterval: BillingInterval,
  recurring: z.boolean(),
  nextBillingOn: CalendarDate.nullable(),
  /**
   * The last day a cancellation can be asked for: 14 days before the next billing date, in the
   * firm's time zone. Null when the service is not ACTIVE and recurring with a next billing date.
   */
  cancelBy: CalendarDate.nullable(),
  cancelRequestedAt: DateTime.nullable(),
  cancelledAt: DateTime.nullable(),
  /** Cancelled services: the client keeps document access until this date (60 days). */
  documentAccessUntil: CalendarDate.nullable(),
});
export type MyService = z.infer<typeof MyService>;

/** GET /portal/{firmSlug}/me/services: newest first. */
export const MyServiceList = z.object({ items: z.array(MyService) });

/**
 * POST /portal/{firmSlug}/me/services/{id}/cancel-request: ACTIVE recurring services only, on or
 * before `cancelBy` (the firm's calendar). Asking again returns the service unchanged.
 */
export const RequestCancellationRequest = z.strictObject({
  reason: clearable(text(500, 'many')),
});
export type RequestCancellationRequest = z.input<typeof RequestCancellationRequest>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const EngagementErrorCode = z.enum([
  /** 409: the stage is not one of the service's stages. */
  'INVALID_STAGE',
  /**
   * 409: the change does not fit the engagement's status (completing a cancelled one; a
   * cancellation request for a service that is not ACTIVE).
   */
  'INVALID_STATUS',
  /** 409: a cancelled engagement can be reactivated only within 90 days. */
  'REACTIVATION_WINDOW_PASSED',
  /** 409: after `cancelBy`, 14 days before the next billing date. */
  'TOO_LATE_TO_CANCEL',
  /** 409: only recurring services take a cancellation request. */
  'NOT_RECURRING',
]);
export type EngagementErrorCode = z.infer<typeof EngagementErrorCode>;
