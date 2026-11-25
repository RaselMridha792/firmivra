import { z } from 'zod';
import { text } from '../clients/text.js';
import {
  SalesDemoAppointmentStatus,
  SalesDemoRequestStatus,
  SalesNurtureEnrollmentStatus,
  SalesNurtureExecutionStatus,
  SalesNurtureJourneyStatus,
} from '../db-enums.js';

// Super Admin Leads & CRM, backend P0 (Q35, `sales_lead_consents`, `sales_nurture_*` and
// `sales_demo_*`). Firmivra's own acquisition CRM: platform data, no firm. Leads are the Sales
// records (SalesContact / SalesOpportunity); this adds consent and suppression, versioned nurture
// journeys with explicit enrollment, and demo requests with appointments.
// Routes: /api/v1/admin/crm/... (the Super Admin site's session only).
// Rules: a suppressed contact, or one without consent, is never enrolled; suppressing a contact
// stops their active enrollments. A published journey version never changes; enrollments follow
// the journey's current (published) version. Booking a demo on a request with an opportunity
// adds a DEMO follow-up there. Nothing is deleted: archive, stop or cancel instead.
// Times are ISO with an offset. Requests are strict; responses are plain objects.

const DateTime = z.iso.datetime({ offset: true });
const Id = z.uuid();
const optional = (max: number, lines: 'one' | 'many' = 'one') =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((v) => (v === '' ? null : v))
    .pipe(z.union([z.null(), text(max, lines)]))
    .nullable()
    .optional();

export const CrmId = Id;

// ---------- Errors ----------

export const CrmErrorCode = z.enum([
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'NO_CONSENT',
  'SUPPRESSED',
  'ALREADY_ENROLLED',
  'JOURNEY_NOT_ACTIVE',
  'JOURNEY_ARCHIVED',
  'NO_PUBLISHED_VERSION',
  'DRAFT_EXISTS',
  'VERSION_PUBLISHED',
  'EMPTY_JOURNEY',
  'TEMPLATE_NOT_USABLE',
  'ENROLLMENT_CLOSED',
  'DEMO_CLOSED',
  'OPPORTUNITY_MISMATCH',
]);
export type CrmErrorCode = z.infer<typeof CrmErrorCode>;

// ---------- Consent ----------

export const SaveCrmConsentRequest = z
  .strictObject({
    consented: z.boolean(),
    /** Where consent was captured, e.g. website_form or manual. */
    consentSource: optional(50),
    suppressed: z.boolean(),
    /** Required when suppressed: e.g. unsubscribe, bounce or manual. */
    suppressionReason: optional(200),
  })
  .refine((b) => !b.suppressed || !!b.suppressionReason, {
    path: ['suppressionReason'],
    message: 'Enter why the contact is suppressed.',
  });
export type SaveCrmConsentRequest = z.input<typeof SaveCrmConsentRequest>;

export const CrmConsent = z.object({
  contactId: Id,
  consented: z.boolean(),
  consentedAt: DateTime.nullable(),
  consentSource: z.string().nullable(),
  suppressed: z.boolean(),
  suppressedAt: DateTime.nullable(),
  suppressionReason: z.string().nullable(),
  updatedAt: DateTime.nullable(),
});
export type CrmConsent = z.infer<typeof CrmConsent>;

// ---------- Nurture journeys ----------

/** One step: wait `delayDays` after the previous step (or enrollment), then send the template. */
export const CrmJourneyStep = z.strictObject({
  delayDays: z.number().int().min(0).max(365),
  channel: z.literal('EMAIL'),
  templateId: Id,
});
export type CrmJourneyStep = z.infer<typeof CrmJourneyStep>;

export const CrmJourneySteps = z.array(CrmJourneyStep).max(20, 'Use at most 20 steps.');

export const CreateCrmJourneyRequest = z.strictObject({
  name: text(200, 'one', 'Enter a journey name.'),
  description: optional(1000, 'many'),
});
export type CreateCrmJourneyRequest = z.input<typeof CreateCrmJourneyRequest>;

export const UpdateCrmJourneyRequest = z
  .strictObject({
    name: text(200, 'one', 'Enter a journey name.').optional(),
    description: optional(1000, 'many'),
    /** ACTIVE needs a published version; ARCHIVED is final. DRAFT is not a move. */
    status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field.');
export type UpdateCrmJourneyRequest = z.input<typeof UpdateCrmJourneyRequest>;

export const SaveCrmJourneyVersionRequest = z.strictObject({ steps: CrmJourneySteps });
export type SaveCrmJourneyVersionRequest = z.input<typeof SaveCrmJourneyVersionRequest>;

export const CrmJourneyVersion = z.object({
  id: Id,
  journeyId: Id,
  version: z.number().int(),
  steps: z.array(CrmJourneyStep),
  publishedAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type CrmJourneyVersion = z.infer<typeof CrmJourneyVersion>;

export const CrmJourney = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  status: SalesNurtureJourneyStatus,
  currentVersionId: Id.nullable(),
  activeEnrollments: z.number().int(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type CrmJourney = z.infer<typeof CrmJourney>;

export const CrmJourneyDetail = CrmJourney.extend({ versions: z.array(CrmJourneyVersion) });
export type CrmJourneyDetail = z.infer<typeof CrmJourneyDetail>;

export const CrmJourneyList = z.object({ items: z.array(CrmJourney) });
export type CrmJourneyList = z.infer<typeof CrmJourneyList>;

export const CrmJourneysQuery = z.strictObject({ status: SalesNurtureJourneyStatus.optional() });

// ---------- Enrollments ----------

export const EnrollCrmContactRequest = z.strictObject({ contactId: Id });
export type EnrollCrmContactRequest = z.input<typeof EnrollCrmContactRequest>;

export const StopCrmEnrollmentRequest = z.strictObject({
  reason: text(200, 'one', 'Enter why the enrollment stops.'),
});
export type StopCrmEnrollmentRequest = z.input<typeof StopCrmEnrollmentRequest>;

export const CrmExecution = z.object({
  stepIndex: z.number().int(),
  status: SalesNurtureExecutionStatus,
  scheduledAt: DateTime,
  sentAt: DateTime.nullable(),
  retryCount: z.number().int(),
});
export type CrmExecution = z.infer<typeof CrmExecution>;

export const CrmEnrollment = z.object({
  id: Id,
  journeyId: Id,
  versionId: Id,
  version: z.number().int(),
  contact: z.object({ id: Id, name: z.string(), email: z.string().nullable() }),
  status: SalesNurtureEnrollmentStatus,
  enrolledAt: DateTime,
  completedAt: DateTime.nullable(),
  stoppedAt: DateTime.nullable(),
  stopReason: z.string().nullable(),
  steps: z.array(CrmExecution),
});
export type CrmEnrollment = z.infer<typeof CrmEnrollment>;

export const CrmEnrollmentList = z.object({ items: z.array(CrmEnrollment) });
export type CrmEnrollmentList = z.infer<typeof CrmEnrollmentList>;

// ---------- Demos ----------

export const CreateCrmDemoRequest = z.strictObject({
  contactId: Id,
  /** An opportunity of this contact; null for none. */
  opportunityId: Id.nullable().optional(),
  topic: optional(200),
  preferredTime: optional(200),
  notes: optional(2000, 'many'),
});
export type CreateCrmDemoRequest = z.input<typeof CreateCrmDemoRequest>;

export const UpdateCrmDemoRequest = z
  .strictObject({
    /** SCHEDULED follows from booking an appointment; it is not set by hand. */
    status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
    topic: optional(200),
    preferredTime: optional(200),
    notes: optional(2000, 'many'),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field.');
export type UpdateCrmDemoRequest = z.input<typeof UpdateCrmDemoRequest>;

const VideoLink = z
  .url({ protocol: /^https$/, message: 'Enter an https:// link.' })
  .max(500, 'Use at most 500 characters');

export const BookCrmDemoRequest = z.strictObject({
  scheduledAt: DateTime,
  durationMinutes: z.number().int().min(5).max(480).optional(),
  videoLink: VideoLink.nullable().optional(),
  notes: optional(2000, 'many'),
});
export type BookCrmDemoRequest = z.input<typeof BookCrmDemoRequest>;

export const UpdateCrmDemoAppointmentRequest = z
  .strictObject({
    scheduledAt: DateTime.optional(),
    durationMinutes: z.number().int().min(5).max(480).optional(),
    videoLink: VideoLink.nullable().optional(),
    status: SalesDemoAppointmentStatus.optional(),
    notes: optional(2000, 'many'),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field.');
export type UpdateCrmDemoAppointmentRequest = z.input<typeof UpdateCrmDemoAppointmentRequest>;

export const CrmDemoAppointment = z.object({
  id: Id,
  requestId: Id,
  scheduledAt: DateTime,
  durationMinutes: z.number().int(),
  videoLink: z.string().nullable(),
  status: SalesDemoAppointmentStatus,
  notes: z.string().nullable(),
  followUpId: Id.nullable(),
});
export type CrmDemoAppointment = z.infer<typeof CrmDemoAppointment>;

export const CrmDemo = z.object({
  id: Id,
  contact: z.object({ id: Id, name: z.string(), email: z.string().nullable() }),
  opportunityId: Id.nullable(),
  topic: z.string().nullable(),
  status: SalesDemoRequestStatus,
  preferredTime: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: DateTime,
  appointments: z.array(CrmDemoAppointment),
});
export type CrmDemo = z.infer<typeof CrmDemo>;

export const CrmDemoList = z.object({ items: z.array(CrmDemo) });
export type CrmDemoList = z.infer<typeof CrmDemoList>;

export const CrmDemosQuery = z.strictObject({ status: SalesDemoRequestStatus.optional() });
