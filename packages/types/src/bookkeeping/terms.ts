import { z } from 'zod';
import { clearable, text } from '../clients/text.js';
import {
  BookkeepingBillingFrequency,
  BookkeepingBillingTiming,
  BookkeepingPaymentTerms,
  BookkeepingRenewalType,
  BookkeepingTermsEventKind,
  BookkeepingTermsStatus,
  EsignRequestStatus,
  InvoiceStatus,
} from '../db-enums.js';

// Bookkeeping Terms (R55): a bookkeeping client's engagement terms, the six tabs of the Terms page
// (docs/mockups/firm-workspace/bookkeeping/source/bookkeeping-close-reconciliation-and-report-
// review.jpg; the developer instructions' sections 10 to 13). Tables: bookkeeping_terms and
// bookkeeping_terms_events (R0 stage C1, docs/work/R0-stage-c1-bookkeeping.md).
// Firm routes under /api/v1/business/bookkeeping, keyed like the rest of the module:
// - `clients/{id}/terms...` with the bookkeeping client's id (BookkeepingClientRow.id);
// - `terms/{termsId}/...` with one version's id.
// Who: everyone who reaches the client reads (Staff only their assigned clients, 404 otherwise).
// Owner and Admin change terms (403 FORBIDDEN otherwise): terms and pricing are a manager's.
// Versions, never overwritten: a client has at most one version in force (ACTIVE) and one open
// draft (DRAFT or SENT). Only a draft's terms are edited; a change to terms in force is a new
// version, made from the one in force (`POST clients/{id}/terms`), and activating it supersedes
// the old one. Internal notes and the signed agreement may still change while a version is in
// force. Superseded and terminated versions never change (409 TERMS_STATE).
// Each change writes a History event (`bookkeeping_terms_events`) and an audit row with ids,
// field names and old and new values only. Money is in cents; days are `YYYY-MM-DD`.
// Not here: the payment schedule's invoices are Invoices & Payments' (read through
// `paymentSchedule`, never copied); agreement files are Documents' (uploaded with the client's
// `engagementId`, then linked here); e-signature requests are Firm Sign's.

const CalendarDate = z.iso.date();
const DateTime = z.iso.datetime({ offset: true });
const FeeCents = z
  .number()
  .int('Use whole cents')
  .min(0, 'Use 0 or more')
  .max(100_000_000_00, 'Use at most $100,000,000');

export {
  BookkeepingBillingFrequency,
  BookkeepingBillingTiming,
  BookkeepingPaymentTerms,
  BookkeepingRenewalType,
  BookkeepingTermsEventKind,
  BookkeepingTermsStatus,
};

/** A version's id in a path: anything else gets 400 VALIDATION_FAILED. */
export const BookkeepingTermsId = z.uuid();

/** Stable `error.code` values of the Terms routes, besides BookkeepingErrorCode's. */
export const BookkeepingTermsErrorCode = z.enum([
  /** 409: the version's status does not allow this (only a draft is edited, a sent one is
   * activated or taken back, an active one is terminated; superseded and terminated never change). */
  'TERMS_STATE',
  /** 409: the client already has an open draft (DRAFT or SENT): edit or discard that one. */
  'TERMS_DRAFT_EXISTS',
  /** 409: a signed agreement needs its signed copy or an e-signature request first. */
  'AGREEMENT_NOT_SIGNED',
]);
export type BookkeepingTermsErrorCode = z.infer<typeof BookkeepingTermsErrorCode>;

// ---------- The six tabs' fields ----------

const Line = text(200);
const Lines = z.array(Line).max(50, 'Use at most 50 lines');

/** Additional Services: a service billed on top of the package, and how. */
export const TermsAdditionalBilling = z.strictObject({
  service: text(120),
  /** Left out or null: priced when billed. */
  feeCents: FeeCents.nullable().optional(),
  billing: z.enum(['SEPARATE', 'INCLUDED', 'WAIVED']),
});
export type TermsAdditionalBilling = z.infer<typeof TermsAdditionalBilling>;

/** Apply Late Fee: a flat amount charged this many days after the due date. Off: null. */
export const TermsLateFeeRule = z.strictObject({
  amountCents: FeeCents.refine((v) => v > 0, 'Enter the late fee'),
  afterDays: z.number().int().min(1, 'Use 1 day or more').max(365, 'Use at most 365 days'),
});
export type TermsLateFeeRule = z.infer<typeof TermsLateFeeRule>;

/** Discount / Credit: an authorized adjustment, with why. */
export const TermsDiscount = z
  .strictObject({
    label: text(120),
    kind: z.enum(['AMOUNT', 'PERCENT']),
    /** Cents for AMOUNT; whole percent (1 to 100) for PERCENT. */
    value: z.number().int().min(1),
    startsOn: CalendarDate.nullable().optional(),
    endsOn: CalendarDate.nullable().optional(),
    reason: text(500, 'many'),
  })
  .refine((d) => d.kind !== 'PERCENT' || d.value <= 100, {
    path: ['value'],
    message: 'Use at most 100 percent',
  })
  .refine((d) => !d.startsOn || !d.endsOn || d.endsOn >= d.startsOn, {
    path: ['endsOn'],
    message: 'End on or after the start',
  });
export type TermsDiscount = z.infer<typeof TermsDiscount>;

/** Add-Ons: a service from Services & Pricing (by name, a snapshot) and its fee. */
export const TermsAddOn = z.strictObject({
  name: text(120),
  feeCents: FeeCents.nullable().optional(),
  frequency: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'AS_NEEDED']).optional(),
});
export type TermsAddOn = z.infer<typeof TermsAddOn>;

/** Deliverables: reports, reconciliations, meetings and support, with how often. */
export const TermsDeliverable = z.strictObject({
  label: text(200),
  frequency: clearable(text(40)),
});
export type TermsDeliverable = z.infer<typeof TermsDeliverable>;

/**
 * A draft's fields (create and edit). Every field is optional on edit: only those sent change.
 * The database keeps: end on or after start; FIXED_TERM needs an end date; CUSTOM payment terms
 * need their days (and only CUSTOM has them); at most 64 KB of lists.
 */
const TermsFieldsShape = {
  // Terms tab
  /** The package's name from Services & Pricing (a snapshot), up to 120 characters. */
  packageName: clearable(text(120)),
  startDate: CalendarDate,
  /** Agreement End Date; null for an open-ended agreement. */
  endDate: CalendarDate.nullable(),
  /** Auto-Renew on is AUTO. */
  renewalType: BookkeepingRenewalType,
  renewalDate: CalendarDate.nullable(),
  /** Notice period, 0 to 365 days. */
  noticeDays: z.number().int().min(0).max(365).nullable(),
  /** When this version's terms apply. */
  effectiveFrom: CalendarDate,
  // Billing & Payments
  billingFrequency: BookkeepingBillingFrequency,
  billingTiming: BookkeepingBillingTiming,
  paymentTerms: BookkeepingPaymentTerms,
  /** CUSTOM only: due this many days after issue (1 to 365). */
  paymentTermsDays: z.number().int().min(1).max(365).nullable(),
  /** "Auto-Debit (ACH)", "Card", "Check"…: a label, never account details. */
  preferredPaymentMethod: clearable(text(60)),
  /** Only with a valid payment authorization (Invoices & Payments); a flag here, no charge. */
  autopay: z.boolean(),
  monthlyFeeCents: FeeCents,
  setupFeeCents: FeeCents,
  additionalBilling: z.array(TermsAdditionalBilling).max(50),
  lateFeeRule: TermsLateFeeRule.nullable(),
  discounts: z.array(TermsDiscount).max(20),
  // Service Details
  includedServices: Lines,
  /** Exclusions / Not Included, with "Other" as its own line. */
  excludedServices: Lines,
  addOns: z.array(TermsAddOn).max(50),
  deliverables: z.array(TermsDeliverable).max(50),
  clientResponsibilities: Lines,
  firmResponsibilities: Lines,
};

const TermsFields = z
  .strictObject({ ...TermsFieldsShape, internalNotes: clearable(text(5000, 'many')) })
  .partial();

/** The database's rules, checked before the request is sent. */
const termsRules = (t: z.infer<typeof TermsFields>, ctx: z.RefinementCtx) => {
  if (t.startDate && t.endDate && t.endDate < t.startDate)
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End on or after the start date' });
  if (t.renewalType === 'FIXED_TERM' && t.endDate === null)
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'A fixed term needs an end date' });
  if (t.paymentTerms === 'CUSTOM' && typeof t.paymentTermsDays !== 'number')
    ctx.addIssue({
      code: 'custom',
      path: ['paymentTermsDays'],
      message: 'Custom payment terms need their days',
    });
  if (t.paymentTerms && t.paymentTerms !== 'CUSTOM' && typeof t.paymentTermsDays === 'number')
    ctx.addIssue({
      code: 'custom',
      path: ['paymentTermsDays'],
      message: 'Only custom payment terms have days',
    });
};

/**
 * POST /business/bookkeeping/clients/{id}/terms: New Terms, a DRAFT. Left out, a field comes from
 * the version in force (a change is a new version of it), else from the client's package (name,
 * included services) and the defaults: today, Auto-Renew, monthly in advance, due on receipt.
 * 409 TERMS_DRAFT_EXISTS when an open draft exists.
 */
export const CreateBookkeepingTermsRequest = TermsFields.superRefine(termsRules);
export type CreateBookkeepingTermsRequest = z.input<typeof CreateBookkeepingTermsRequest>;

/**
 * PATCH /business/bookkeeping/terms/{termsId}: Save. The terms fields on a DRAFT only (409
 * TERMS_STATE otherwise); `internalNotes` on any version not superseded or terminated. A SENT
 * version goes back to DRAFT first (`backToDraft`).
 */
export const UpdateBookkeepingTermsRequest = CreateBookkeepingTermsRequest;
export type UpdateBookkeepingTermsRequest = z.input<typeof UpdateBookkeepingTermsRequest>;

// ---------- One version ----------

export const TermsDocumentRef = z.object({ id: z.uuid(), name: z.string() });
export type TermsDocumentRef = z.infer<typeof TermsDocumentRef>;

/** Engagement Documents: the agreement, its signed copy and the e-signature request. */
export const TermsAgreement = z.object({
  /** Generated from these terms (or uploaded) for the client to sign: a draft's only. */
  agreement: TermsDocumentRef.nullable(),
  signedAgreement: TermsDocumentRef.nullable(),
  esignRequest: z
    .object({ id: z.uuid(), title: z.string(), status: EsignRequestStatus })
    .nullable(),
  signedAt: DateTime.nullable(),
});
export type TermsAgreement = z.infer<typeof TermsAgreement>;

export const BookkeepingTerms = z.object({
  id: z.uuid(),
  /** The client's bookkeeping id (BookkeepingClientRow.id). */
  bookkeepingClientId: z.uuid(),
  /** 1, 2, 3… per client, set by the database. */
  version: z.number().int(),
  status: BookkeepingTermsStatus,
  packageName: z.string().nullable(),
  startDate: CalendarDate,
  endDate: CalendarDate.nullable(),
  renewalType: BookkeepingRenewalType,
  renewalDate: CalendarDate.nullable(),
  noticeDays: z.number().int().nullable(),
  effectiveFrom: CalendarDate,
  billingFrequency: BookkeepingBillingFrequency,
  billingTiming: BookkeepingBillingTiming,
  paymentTerms: BookkeepingPaymentTerms,
  paymentTermsDays: z.number().int().nullable(),
  preferredPaymentMethod: z.string().nullable(),
  autopay: z.boolean(),
  monthlyFeeCents: z.number().int(),
  setupFeeCents: z.number().int(),
  additionalBilling: z.array(TermsAdditionalBilling),
  lateFeeRule: TermsLateFeeRule.nullable(),
  discounts: z.array(TermsDiscount),
  includedServices: z.array(z.string()),
  excludedServices: z.array(z.string()),
  addOns: z.array(TermsAddOn),
  deliverables: z.array(TermsDeliverable),
  clientResponsibilities: z.array(z.string()),
  firmResponsibilities: z.array(z.string()),
  /** Owner and Admin only; null for everyone else. */
  internalNotes: z.string().nullable(),
  documents: TermsAgreement,
  sentAt: DateTime.nullable(),
  activatedAt: DateTime.nullable(),
  supersededAt: DateTime.nullable(),
  terminatedAt: DateTime.nullable(),
  terminationReason: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
  /** What the caller may do now (the buttons). */
  can: z.object({
    edit: z.boolean(),
    send: z.boolean(),
    backToDraft: z.boolean(),
    activate: z.boolean(),
    terminate: z.boolean(),
    newVersion: z.boolean(),
  }),
});
export type BookkeepingTerms = z.infer<typeof BookkeepingTerms>;

export const BookkeepingTermsVersion = z.object({
  id: z.uuid(),
  version: z.number().int(),
  status: BookkeepingTermsStatus,
  packageName: z.string().nullable(),
  monthlyFeeCents: z.number().int(),
  effectiveFrom: CalendarDate,
  activatedAt: DateTime.nullable(),
  supersededAt: DateTime.nullable(),
  terminatedAt: DateTime.nullable(),
});
export type BookkeepingTermsVersion = z.infer<typeof BookkeepingTermsVersion>;

/**
 * GET /business/bookkeeping/clients/{id}/terms: the page. `current` is the version in force
 * (ACTIVE), `draft` the open one (DRAFT or SENT); both null for a client with no terms yet.
 * `versions` is every version, newest first (Agreement Version).
 */
export const BookkeepingTermsPage = z.object({
  bookkeepingClientId: z.uuid(),
  current: BookkeepingTerms.nullable(),
  draft: BookkeepingTerms.nullable(),
  versions: z.array(BookkeepingTermsVersion),
});
export type BookkeepingTermsPage = z.infer<typeof BookkeepingTermsPage>;

// ---------- Actions ----------

/** Send Terms to Client: SENT (the agreement goes out through Firm Sign or Documents). */
export const SendBookkeepingTermsRequest = z.strictObject({
  /** Recorded on the History event. */
  note: clearable(text(1000, 'many')),
});
export type SendBookkeepingTermsRequest = z.input<typeof SendBookkeepingTermsRequest>;

/**
 * Activate: the draft (or sent) version comes into force and supersedes the one before.
 * `requireSigned` (default true) refuses one without a signed copy or e-signature (409
 * AGREEMENT_NOT_SIGNED); an Owner or Admin may activate unsigned terms with false.
 */
export const ActivateBookkeepingTermsRequest = z.strictObject({
  requireSigned: z.boolean().optional().default(true),
  note: clearable(text(1000, 'many')),
});
export type ActivateBookkeepingTermsRequest = z.input<typeof ActivateBookkeepingTermsRequest>;

/** Termination / Non-Renewal: the version in force ends, with the reason and dates. */
export const TerminateBookkeepingTermsRequest = z.strictObject({
  reason: text(1000, 'many'),
  effectiveDate: CalendarDate,
  /** When the client was told; null: not yet. */
  noticeSentAt: DateTime.nullable().optional(),
});
export type TerminateBookkeepingTermsRequest = z.input<typeof TerminateBookkeepingTermsRequest>;

/**
 * Renewal & Notices: record a price-change or termination notice, or a renewal, on the version in
 * force (a History event; the terms themselves change only through a new version).
 */
export const BookkeepingTermsNoticeRequest = z.strictObject({
  kind: z.enum(['PRICE_CHANGE_NOTICE', 'TERMINATION_NOTICE', 'RENEWED', 'NOTE']),
  effectiveDate: CalendarDate.nullable().optional(),
  noticeSentAt: DateTime.nullable().optional(),
  reason: clearable(text(1000, 'many')),
  /** A price change: the new monthly fee, for the record. */
  newMonthlyFeeCents: FeeCents.optional(),
});
export type BookkeepingTermsNoticeRequest = z.input<typeof BookkeepingTermsNoticeRequest>;

/**
 * PUT /business/bookkeeping/terms/{termsId}/agreement: Engagement Documents. Ids of this client's
 * documents (uploaded through `api.documents` with the client's `engagementId`) and of a Firm Sign
 * request; another client's is 409 NOT_THIS_CLIENTS. `agreementDocumentId` changes on a draft
 * only. `signed: true` stamps the signing time and needs the signed copy or the e-signature.
 * Each key left out is unchanged; null clears it.
 */
export const SetBookkeepingTermsAgreementRequest = z
  .strictObject({
    agreementDocumentId: z.uuid().nullable().optional(),
    signedAgreementDocumentId: z.uuid().nullable().optional(),
    esignRequestId: z.uuid().nullable().optional(),
    signed: z.boolean().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Change something first');
export type SetBookkeepingTermsAgreementRequest = z.input<
  typeof SetBookkeepingTermsAgreementRequest
>;

// ---------- History ----------

export const BookkeepingTermsEvent = z.object({
  id: z.uuid(),
  termsId: z.uuid(),
  version: z.number().int(),
  kind: BookkeepingTermsEventKind,
  effectiveDate: CalendarDate.nullable(),
  noticeSentAt: DateTime.nullable(),
  reason: z.string().nullable(),
  /** The fields changed, with old and new values: `{ monthlyFeeCents: { from, to } }`. */
  details: z.record(z.string(), z.unknown()),
  actorName: z.string().nullable(),
  at: DateTime,
});
export type BookkeepingTermsEvent = z.infer<typeof BookkeepingTermsEvent>;

export const BookkeepingTermsHistoryQuery = z.strictObject({
  kind: BookkeepingTermsEventKind.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type BookkeepingTermsHistoryQuery = z.input<typeof BookkeepingTermsHistoryQuery>;

/** GET /business/bookkeeping/clients/{id}/terms/history: every version's events, newest first. */
export const BookkeepingTermsHistory = z.object({
  items: z.array(BookkeepingTermsEvent),
  nextCursor: z.string().nullable(),
});
export type BookkeepingTermsHistory = z.infer<typeof BookkeepingTermsHistory>;

// ---------- Payment Schedule (Invoices & Payments, read here) ----------

export const BookkeepingPaymentScheduleQuery = z.strictObject({
  status: InvoiceStatus.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});
export type BookkeepingPaymentScheduleQuery = z.input<typeof BookkeepingPaymentScheduleQuery>;

/** One invoice of the client's bookkeeping engagement (never a draft). */
export const BookkeepingPaymentScheduleRow = z.object({
  invoiceId: z.uuid(),
  number: z.string(),
  /** "September 2026": the month it was issued (or is scheduled for). */
  period: z.string(),
  issuedOn: CalendarDate.nullable(),
  dueOn: CalendarDate.nullable(),
  amountCents: z.number().int(),
  status: InvoiceStatus,
  paidAt: DateTime.nullable(),
});
export type BookkeepingPaymentScheduleRow = z.infer<typeof BookkeepingPaymentScheduleRow>;

/**
 * GET /business/bookkeeping/clients/{id}/terms/payment-schedule: the engagement's invoices,
 * newest first. View All and the row actions open Invoices & Payments (`api.invoices`).
 */
export const BookkeepingPaymentSchedule = z.object({
  items: z.array(BookkeepingPaymentScheduleRow),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type BookkeepingPaymentSchedule = z.infer<typeof BookkeepingPaymentSchedule>;
