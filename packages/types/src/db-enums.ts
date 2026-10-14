// Generated from packages/db/prisma/schema.prisma by `pnpm --filter @firmivra/db gen:enums`.
// Do not edit by hand: change the enum in the schema, then run the command.
import { z } from 'zod';

export const BusinessStatus = z.enum(['PENDING_SETUP', 'ACTIVE', 'SUSPENDED', 'CLOSED']);
export type BusinessStatus = z.infer<typeof BusinessStatus>;

/** Which Cognito user pool the identity belongs to (docs/AUTH-DESIGN.md). */
export const IdentityPool = z.enum(['STAFF', 'CLIENT', 'ADMIN']);
export type IdentityPool = z.infer<typeof IdentityPool>;

export const MembershipRole = z.enum(['OWNER', 'ADMIN', 'STAFF']);
export type MembershipRole = z.infer<typeof MembershipRole>;

export const MembershipStatus = z.enum(['INVITED', 'ACTIVE', 'DEACTIVATED']);
export type MembershipStatus = z.infer<typeof MembershipStatus>;

export const ClientAccountStatus = z.enum([
  'INVITED',
  'PENDING_APPROVAL',
  'ACTIVE',
  'DECLINED',
  'DISABLED',
]);
export type ClientAccountStatus = z.infer<typeof ClientAccountStatus>;

export const ClientAccountType = z.enum(['INDIVIDUAL', 'BUSINESS']);
export type ClientAccountType = z.infer<typeof ClientAccountType>;

/** Whose portal login this is on the client's record (docs/SYSTEM-DESIGN.md, Data model: members). */
export const ClientPortalRole = z.enum(['PRIMARY', 'SPOUSE', 'AUTHORIZED']);
export type ClientPortalRole = z.infer<typeof ClientPortalRole>;

export const PlatformRole = z.enum(['SUPER_ADMIN']);
export type PlatformRole = z.infer<typeof PlatformRole>;

/** docs/SYSTEM-DESIGN.md, Modules & packs. Only the tax and accounting pack exists now. */
export const IndustryPack = z.enum(['TAX_ACCOUNTING']);
export type IndustryPack = z.infer<typeof IndustryPack>;

export const FirmApplicationStatus = z.enum([
  'PENDING_REVIEW',
  'INFO_REQUESTED',
  'APPROVED',
  'DECLINED',
]);
export type FirmApplicationStatus = z.infer<typeof FirmApplicationStatus>;

/** Begin Online's six services, plus OTHER (docs/SYSTEM-DESIGN.md, Sign-up flows). */
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

/** ONE_TIME, or recurring. */
export const BillingInterval = z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'YEARLY']);
export type BillingInterval = z.infer<typeof BillingInterval>;

export const EngagementStatus = z.enum(['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
export type EngagementStatus = z.infer<typeof EngagementStatus>;

/** GENERAL, or a client's "Request Name Change" from the portal (at most one open per client). */
export const TaskKind = z.enum(['GENERAL', 'NAME_CHANGE']);
export type TaskKind = z.infer<typeof TaskKind>;

export const TaskStatus = z.enum(['OPEN', 'DONE', 'CANCELLED']);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** Where an OPEN task stands (the Tasks screens' Not Started, Pending, In Progress, Waiting, Blocked). status stays the lifecycle: DONE shows as Completed, and overdue is never stored but derived from an incomplete task past its due date (R38). */
export const TaskProgress = z.enum(['NOT_STARTED', 'PENDING', 'IN_PROGRESS', 'WAITING', 'BLOCKED']);
export type TaskProgress = z.infer<typeof TaskProgress>;

export const TaskPriority = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type TaskPriority = z.infer<typeof TaskPriority>;

/** What a compliance deadline is for (the Deadline Types chart and filter). */
export const DeadlineType = z.enum([
  'TAX_FILING',
  'ESTIMATED_TAX',
  'ELECTION',
  'BOOKKEEPING',
  'PAYROLL',
  'SALES_TAX',
  'STATE_FILING',
  'ANNUAL_REPORT',
  'LICENSE_PERMIT',
  'ADVISORY',
  'OTHER',
]);
export type DeadlineType = z.infer<typeof DeadlineType>;

export const DeadlineSource = z.enum(['GOVERNMENT', 'FIRM', 'CLIENT_SPECIFIC', 'IMPORTED']);
export type DeadlineSource = z.infer<typeof DeadlineSource>;

/** Due Soon and Overdue are never stored: they are derived from the due date, the firm's Due Soon threshold and the status (an incomplete deadline past its due date is overdue). */
export const DeadlineStatus = z.enum([
  'UPCOMING',
  'IN_PROGRESS',
  'WAITING_ON_CLIENT',
  'COMPLETED',
  'NOT_APPLICABLE',
  'CANCELLED',
]);
export type DeadlineStatus = z.infer<typeof DeadlineStatus>;

export const JurisdictionLevel = z.enum(['FEDERAL', 'STATE', 'LOCAL', 'INTERNAL']);
export type JurisdictionLevel = z.infer<typeof JurisdictionLevel>;

/** A family of official calendars (a firm keeps its own library of them). */
export const CalendarFamily = z.enum([
  'IRS_GENERAL',
  'IRS_EMPLOYER',
  'STATE_INCOME_FRANCHISE',
  'SECRETARY_OF_STATE',
  'SALES_USE_TAX',
  'PAYROLL_WITHHOLDING',
  'LOCAL_BUSINESS_LICENSE',
  'PROFESSIONAL_LICENSE',
  'FIRM_INTERNAL',
]);
export type CalendarFamily = z.infer<typeof CalendarFamily>;

/** DRAFT (imported), VERIFIED (checked against the source), PUBLISHED (in use: at most one per family, authority and year), SUPERSEDED (a later version replaced it; kept for rollback and comparison), ARCHIVED. */
export const CalendarStatus = z.enum(['DRAFT', 'VERIFIED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED']);
export type CalendarStatus = z.infer<typeof CalendarStatus>;

/** How a calendar entry gives its date. NEEDS_VERIFICATION has no date: a date is never invented. */
export const CalendarRuleKind = z.enum(['FIXED_DATE', 'FORMULA', 'NEEDS_VERIFICATION']);
export type CalendarRuleKind = z.infer<typeof CalendarRuleKind>;

/** How often a recurring deadline repeats; AUTHORITY_DEFINED follows the authority's own calendar. */
export const DeadlineFrequency = z.enum([
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
  'CUSTOM',
  'AUTHORITY_DEFINED',
]);
export type DeadlineFrequency = z.infer<typeof DeadlineFrequency>;

/** What a matching applicability rule does: APPLY makes the deadline, SUGGEST only suggests it until staff confirm it (imported government dates are never assigned to everyone). */
export const ApplicabilityOutcome = z.enum(['APPLY', 'SUGGEST']);
export type ApplicabilityOutcome = z.infer<typeof ApplicabilityOutcome>;

export const ApplicabilityDecision = z.enum([
  'SUGGESTED',
  'NEEDS_REVIEW',
  'CONFIRMED',
  'DISMISSED',
]);
export type ApplicabilityDecision = z.infer<typeof ApplicabilityDecision>;

/** What a compliance log row records. */
export const ComplianceLogKind = z.enum([
  'IMPORT',
  'VERIFY',
  'PUBLISH',
  'ROLLBACK',
  'GENERATE',
  'OVERRIDE',
  'ERROR',
]);
export type ComplianceLogKind = z.infer<typeof ComplianceLogKind>;

export const LogOutcome = z.enum(['SUCCESS', 'FAILED', 'SKIPPED']);
export type LogOutcome = z.infer<typeof LogOutcome>;

/** The modules automations start from and act on (a rule's trigger category and rule category). */
export const AutomationModule = z.enum([
  'CLIENTS',
  'LEADS',
  'APPOINTMENTS',
  'INTAKE_FORMS',
  'DOCUMENTS',
  'TAX_RETURNS',
  'BOOKKEEPING',
  'PAYROLL',
  'TAX_PLANNING',
  'BUSINESS_ADVISORY',
  'INVOICES_PAYMENTS',
  'COMMUNICATIONS',
  'TASKS',
  'COMPLIANCE_DEADLINES',
  'STAFF_MANAGEMENT',
  'INTEGRATIONS',
  'CUSTOM',
]);
export type AutomationModule = z.infer<typeof AutomationModule>;

/** DRAFT is saved but never runs; ACTIVE runs; PAUSED stops new runs; ARCHIVED is kept for its history. */
export const AutomationStatus = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
export type AutomationStatus = z.infer<typeof AutomationStatus>;

export const AutomationTiming = z.enum(['IMMEDIATE', 'BEFORE', 'AFTER', 'SCHEDULED']);
export type AutomationTiming = z.infer<typeof AutomationTiming>;

export const OffsetUnit = z.enum(['MINUTE', 'HOUR', 'DAY']);
export type OffsetUnit = z.infer<typeof OffsetUnit>;

export const MatchMode = z.enum(['ALL', 'ANY']);
export type MatchMode = z.infer<typeof MatchMode>;

/** PENDING waits to start (or for a scheduled action), RUNNING is in progress; the rest end the run: PARTIAL_SUCCESS means some actions worked and others failed. */
export const AutomationRunStatus = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'PARTIAL_SUCCESS',
  'FAILED',
  'SKIPPED',
]);
export type AutomationRunStatus = z.infer<typeof AutomationRunStatus>;

export const ActionExecutionStatus = z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED']);
export type ActionExecutionStatus = z.infer<typeof ActionExecutionStatus>;

/** A bookkeeping client's workflow status (the Bookkeeping status tabs). Set by staff (MANUAL) or by the firm's status rules from due dates, missing documents and sync problems (AUTOMATIC). */
export const BookkeepingStatus = z.enum([
  'ON_TRACK',
  'NEEDS_ATTENTION',
  'MISSING_DOCUMENTS',
  'OVERDUE',
  'NOT_STARTED',
]);
export type BookkeepingStatus = z.infer<typeof BookkeepingStatus>;

export const StatusSource = z.enum(['MANUAL', 'AUTOMATIC']);
export type StatusSource = z.infer<typeof StatusSource>;

export const ReportCadence = z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM']);
export type ReportCadence = z.infer<typeof ReportCadence>;

export const BookkeepingActivityKind = z.enum([
  'STATUS_CHANGE',
  'ASSIGNMENT',
  'PLAN_CHANGE',
  'PAUSE',
  'RESUME',
  'ARCHIVE',
  'SYNC',
  'DOCUMENT_REQUEST',
  'REPORT',
  'CLOSE',
  'RECONCILIATION',
  'CONTACT',
  'NOTE',
  'OTHER',
]);
export type BookkeepingActivityKind = z.infer<typeof BookkeepingActivityKind>;

export const ConnectionStatus = z.enum(['CONNECTED', 'EXPIRED', 'ERROR', 'DISCONNECTED']);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

export const SyncTrigger = z.enum(['INITIAL', 'MANUAL', 'SCHEDULED']);
export type SyncTrigger = z.infer<typeof SyncTrigger>;

export const SyncOutcome = z.enum(['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED']);
export type SyncOutcome = z.infer<typeof SyncOutcome>;

export const BookkeepingAccountType = z.enum(['BANK', 'CREDIT_CARD', 'LOAN', 'OTHER']);
export type BookkeepingAccountType = z.infer<typeof BookkeepingAccountType>;

export const BookkeepingPeriodKind = z.enum(['MONTH', 'QUARTER', 'YEAR', 'CUSTOM']);
export type BookkeepingPeriodKind = z.infer<typeof BookkeepingPeriodKind>;

/** A period's close: work in progress, then review, approval and close (which locks it). Reports and client delivery are steps of the close checklist, not statuses. */
export const BookkeepingPeriodStatus = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'APPROVED',
  'CLOSED',
]);
export type BookkeepingPeriodStatus = z.infer<typeof BookkeepingPeriodStatus>;

export const ReconciliationStatus = z.enum([
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'APPROVED',
  'REOPENED',
]);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatus>;

export const FiguresSource = z.enum(['MANUAL', 'IMPORTED']);
export type FiguresSource = z.infer<typeof FiguresSource>;

export const BookkeepingReportType = z.enum([
  'PROFIT_LOSS',
  'BALANCE_SHEET',
  'CASH_FLOW',
  'GENERAL_LEDGER',
  'TRIAL_BALANCE',
  'TRANSACTION_DETAIL',
  'UNCATEGORIZED',
  'RECONCILIATION',
  'QUARTERLY_REVIEW',
  'YEAR_TO_DATE_SUMMARY',
  'BOOKKEEPING_STATUS',
  'MISSING_DOCUMENTS',
  'CUSTOM',
]);
export type BookkeepingReportType = z.infer<typeof BookkeepingReportType>;

/** The work and review of one report: not started, being prepared, in review, approved, delivered to the client (which freezes it). */
export const ReportReviewStatus = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'IN_REVIEW',
  'APPROVED',
  'DELIVERED',
]);
export type ReportReviewStatus = z.infer<typeof ReportReviewStatus>;

export const AccountingBasis = z.enum(['CASH', 'ACCRUAL']);
export type AccountingBasis = z.infer<typeof AccountingBasis>;

/** How a template or recurring series picks the assignee of a new task. */
export const TaskAssignmentRule = z.enum(['UNASSIGNED', 'SPECIFIC_USER', 'CLIENT_TEAM']);
export type TaskAssignmentRule = z.infer<typeof TaskAssignmentRule>;

export const RecurrenceUnit = z.enum(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']);
export type RecurrenceUnit = z.infer<typeof RecurrenceUnit>;

export const RecurrenceEnd = z.enum(['NEVER', 'AFTER_COUNT', 'ON_DATE']);
export type RecurrenceEnd = z.infer<typeof RecurrenceEnd>;

/** Move a date that falls on a weekend or holiday. */
export const HolidayRule = z.enum(['NONE', 'NEXT_BUSINESS_DAY', 'PREVIOUS_BUSINESS_DAY']);
export type HolidayRule = z.infer<typeof HolidayRule>;

/** Also the status of a recurring compliance deadline (ComplianceRecurrence). */
export const TaskSeriesStatus = z.enum(['ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED']);
export type TaskSeriesStatus = z.infer<typeof TaskSeriesStatus>;

export const TaskOccurrenceState = z.enum(['SCHEDULED', 'GENERATED', 'SKIPPED', 'FAILED']);
export type TaskOccurrenceState = z.infer<typeof TaskOccurrenceState>;

/** Bookkeeping: REPORT, RECONCILIATION. Tax Planning: ESTIMATE, PROJECTION. */
export const ReportKind = z.enum(['REPORT', 'RECONCILIATION', 'ESTIMATE', 'PROJECTION']);
export type ReportKind = z.infer<typeof ReportKind>;

export const ReportStatus = z.enum(['DRAFT', 'PUBLISHED']);
export type ReportStatus = z.infer<typeof ReportStatus>;

export const DocumentDirection = z.enum(['CLIENT_TO_FIRM', 'FIRM_TO_CLIENT', 'INTERNAL']);
export type DocumentDirection = z.infer<typeof DocumentDirection>;

/** Malware scan of an upload. Only CLEAN files can be downloaded. */
export const ScanStatus = z.enum(['PENDING', 'CLEAN', 'INFECTED', 'FAILED']);
export type ScanStatus = z.infer<typeof ScanStatus>;

export const DocumentRequestStatus = z.enum([
  'REQUESTED',
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'NOT_AVAILABLE',
  'CANCELLED',
]);
export type DocumentRequestStatus = z.infer<typeof DocumentRequestStatus>;

export const IntakeFormStatus = z.enum(['DRAFT', 'PUBLISHED', 'RETIRED']);
export type IntakeFormStatus = z.infer<typeof IntakeFormStatus>;

/** docs/PROJECT-DRAFT-v2.md, Intake forms. */
export const IntakeStatus = z.enum([
  'SENT',
  'IN_PROGRESS',
  'SUBMITTED',
  'NEEDS_CORRECTION',
  'UNDER_REVIEW',
  'COMPLETED',
  'EXPIRED',
  'ARCHIVED',
]);
export type IntakeStatus = z.infer<typeof IntakeStatus>;

/** A Begin Online visitor's request, before it is a client. */
export const LeadStatus = z.enum([
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'CONVERTED',
  'DECLINED',
  'EXPIRED',
]);
export type LeadStatus = z.infer<typeof LeadStatus>;

/** Groups notifications for preferences. ACCOUNT (security) notices ignore preferences. */
export const NotificationCategory = z.enum([
  'ACCOUNT',
  'DOCUMENTS',
  'INTAKE',
  'SERVICES',
  'MESSAGES',
  'APPOINTMENTS',
  'BILLING',
]);
export type NotificationCategory = z.infer<typeof NotificationCategory>;

export const DeliveryChannel = z.enum(['EMAIL', 'SMS']);
export type DeliveryChannel = z.infer<typeof DeliveryChannel>;

export const DeliveryStatus = z.enum(['QUEUED', 'SENT', 'FAILED', 'SKIPPED']);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

export const AppointmentStatus = z.enum(['SCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']);
export type AppointmentStatus = z.infer<typeof AppointmentStatus>;

export const LocationKind = z.enum(['IN_PERSON', 'PHONE', 'VIDEO']);
export type LocationKind = z.infer<typeof LocationKind>;

export const MessageDirection = z.enum(['FIRM_TO_CLIENT', 'CLIENT_TO_FIRM']);
export type MessageDirection = z.infer<typeof MessageDirection>;

/** DRAFT -> SCHEDULED (Upcoming) or OPEN (Pending, Due Soon) -> PAID; CANCELED. PAID and CANCELED are final, except that voiding an offline payment reopens (PAID -> OPEN) a PAID invoice it no longer covers. */
export const InvoiceStatus = z.enum(['DRAFT', 'SCHEDULED', 'OPEN', 'PAID', 'CANCELED']);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

/** A refund is PENDING until Stripe's refund event confirms it (SUCCEEDED) or it fails. */
export const PaymentRefundStatus = z.enum(['PENDING', 'SUCCEEDED', 'FAILED']);
export type PaymentRefundStatus = z.infer<typeof PaymentRefundStatus>;

export const PaymentStatus = z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED']);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/** A firm's Stripe Connect onboarding: PENDING until Stripe has the details, RESTRICTED when Stripe needs more, COMPLETE when charges and payouts work. */
export const StripeOnboardingStatus = z.enum(['PENDING', 'RESTRICTED', 'COMPLETE']);
export type StripeOnboardingStatus = z.infer<typeof StripeOnboardingStatus>;

export const PaymentProcessor = z.enum(['STRIPE']);
export type PaymentProcessor = z.infer<typeof PaymentProcessor>;

/** How an offline payment arrived. Card and bank payments through Stripe are Payment rows, never these. */
export const OfflinePaymentMethod = z.enum(['CHECK', 'CASH']);
export type OfflinePaymentMethod = z.infer<typeof OfflinePaymentMethod>;

/** Content editor records shown in the portal (Business Documents, Resources & Services). */
export const ContentKind = z.enum(['RESOURCE', 'TIP', 'EXTERNAL_LINK']);
export type ContentKind = z.infer<typeof ContentKind>;

export const LegalDocumentKind = z.enum(['TERMS', 'PRIVACY']);
export type LegalDocumentKind = z.infer<typeof LegalDocumentKind>;

/** Which intakes a firm agreement covers. */
export const AgreementScope = z.enum(['ALL_INTAKES', 'SERVICE']);
export type AgreementScope = z.infer<typeof AgreementScope>;

/** How a signature was captured. Intake signing is TYPED; DRAWN and UPLOADED are Firm Sign's. */
export const SignatureMethod = z.enum(['TYPED', 'DRAWN', 'UPLOADED']);
export type SignatureMethod = z.infer<typeof SignatureMethod>;

/** Where a sign-up verification code was sent. */
export const VerificationChannel = z.enum(['EMAIL', 'PHONE']);
export type VerificationChannel = z.infer<typeof VerificationChannel>;

/** How a client prefers to be contacted (My Profile). */
export const ContactMethod = z.enum(['EMAIL', 'PHONE', 'TEXT']);
export type ContactMethod = z.infer<typeof ContactMethod>;

/** Individual (1040) or business (1120, 1120-S, 1065...) return. */
export const TaxFilingType = z.enum(['INDIVIDUAL', 'BUSINESS']);
export type TaxFilingType = z.infer<typeof TaxFilingType>;

/** The status the client sees on a return (portal Taxes tab). */
export const TaxReturnStatus = z.enum([
  'IN_PROGRESS',
  'FILED',
  'ACCEPTED',
  'REJECTED',
  'COMPLETED',
]);
export type TaxReturnStatus = z.infer<typeof TaxReturnStatus>;

/** A signature request's status. DELIVERED is shown as "Sent". */
export const EsignRequestStatus = z.enum([
  'DRAFT',
  'NEEDS_APPROVAL',
  'SENT',
  'DELIVERED',
  'VIEWED',
  'PARTIALLY_SIGNED',
  'COMPLETED',
  'DECLINED',
  'EXPIRED',
  'VOIDED',
]);
export type EsignRequestStatus = z.infer<typeof EsignRequestStatus>;

/** Where a request was started. */
export const EsignSource = z.enum(['TAB', 'CLIENT_RECORD', 'TEMPLATE', 'BULK']);
export type EsignSource = z.infer<typeof EsignSource>;

export const EsignRouting = z.enum(['SEQUENTIAL', 'PARALLEL']);
export type EsignRouting = z.infer<typeof EsignRouting>;

export const EsignRecipientKind = z.enum(['SIGNER', 'APPROVER', 'CC']);
export type EsignRecipientKind = z.infer<typeof EsignRecipientKind>;

/** The spec's signing roles; CUSTOM takes a role label. */
export const EsignRecipientRole = z.enum([
  'CLIENT',
  'SPOUSE',
  'BUSINESS_OWNER',
  'EMPLOYEE',
  'PREPARER',
  'MANAGER',
  'WITNESS',
  'CUSTOM',
]);
export type EsignRecipientRole = z.infer<typeof EsignRecipientRole>;

export const EsignRecipientStatus = z.enum([
  'WAITING',
  'SENT',
  'DELIVERED',
  'VIEWED',
  'SIGNED',
  'APPROVED',
  'REJECTED',
  'DECLINED',
]);
export type EsignRecipientStatus = z.infer<typeof EsignRecipientStatus>;

export const EsignDelivery = z.enum(['EMAIL', 'PORTAL', 'IN_PERSON']);
export type EsignDelivery = z.infer<typeof EsignDelivery>;

/** LINK, EMAIL_CODE and ACCESS_CODE are chosen for a recipient; PORTAL_SESSION and IN_PERSON are only recorded on events. */
export const EsignAuthMethod = z.enum([
  'LINK',
  'EMAIL_CODE',
  'ACCESS_CODE',
  'PORTAL_SESSION',
  'IN_PERSON',
]);
export type EsignAuthMethod = z.infer<typeof EsignAuthMethod>;

export const EsignFieldType = z.enum([
  'SIGNATURE',
  'INITIALS',
  'DATE_SIGNED',
  'PRINTED_NAME',
  'EMAIL',
  'PHONE',
  'ADDRESS',
  'TEXT',
  'CHECKBOX',
  'RADIO',
  'DROPDOWN',
  'ATTACHMENT',
]);
export type EsignFieldType = z.infer<typeof EsignFieldType>;

export const EsignEventType = z.enum([
  'CREATED',
  'EDITED',
  'APPROVAL_REQUESTED',
  'APPROVED',
  'APPROVAL_REJECTED',
  'SENT',
  'DELIVERED',
  'VIEWED',
  'AUTH_PASSED',
  'AUTH_FAILED',
  'CONSENTED',
  'SIGNED',
  'REMINDER_SENT',
  'EXPIRY_WARNING_SENT',
  'DECLINED',
  'EXPIRED',
  'VOIDED',
  'CORRECTED',
  'REPLACED',
  'COMPLETED',
  'COPY_SENT',
  'DOWNLOADED',
  'IN_PERSON_STARTED',
  'IN_PERSON_ENDED',
]);
export type EsignEventType = z.infer<typeof EsignEventType>;

export const EsignActorKind = z.enum(['STAFF', 'SIGNER', 'CLIENT', 'SYSTEM']);
export type EsignActorKind = z.infer<typeof EsignActorKind>;

export const EsignTemplateVisibility = z.enum(['FIRM', 'PRIVATE']);
export type EsignTemplateVisibility = z.infer<typeof EsignTemplateVisibility>;

export const EsignBulkItemState = z.enum(['QUEUED', 'SENT', 'NOT_SENT']);
export type EsignBulkItemState = z.infer<typeof EsignBulkItemState>;

/** Who a recipient is: one of the client's portal logins, a staff member, or someone else. */
export const EsignRecipientLinkType = z.enum(['CLIENT_LOGIN', 'STAFF', 'EXTERNAL']);
export type EsignRecipientLinkType = z.infer<typeof EsignRecipientLinkType>;

/** SIGN: the invitation's link. COPY: the completed-copy link (30 days). IN_PERSON: a kiosk link. */
export const EsignLinkPurpose = z.enum(['SIGN', 'COPY', 'IN_PERSON']);
export type EsignLinkPurpose = z.infer<typeof EsignLinkPurpose>;

export const EsignCodeKind = z.enum(['EMAIL', 'ACCESS']);
export type EsignCodeKind = z.infer<typeof EsignCodeKind>;

/** A Staff member's Firm Sign access beyond STAFF (no row: STAFF). */
export const EsignStaffRole = z.enum(['MANAGER', 'VIEWER']);
export type EsignStaffRole = z.infer<typeof EsignStaffRole>;

export const EsignApprovalDecision = z.enum(['APPROVE', 'REJECT']);
export type EsignApprovalDecision = z.infer<typeof EsignApprovalDecision>;

export const EsignEmailStatus = z.enum(['QUEUED', 'SENT', 'FAILED']);
export type EsignEmailStatus = z.infer<typeof EsignEmailStatus>;

/** An upload started and not confirmed: a request's file, or a signer's attachment. */
export const EsignUploadKind = z.enum(['DOCUMENT', 'ATTACHMENT']);
export type EsignUploadKind = z.infer<typeof EsignUploadKind>;
