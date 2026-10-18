// Generated from packages/db/prisma/schema.prisma by `pnpm --filter @firmivra/db gen:enums`.
// Do not edit by hand: change the enum in the schema, then run the command.
import { z } from 'zod';

export const BusinessStatus = z.enum(['PENDING_SETUP', 'ACTIVE', 'SUSPENDED', 'CLOSED']);
export type BusinessStatus = z.infer<typeof BusinessStatus>;

/** Which Cognito user pool the identity belongs to (docs/AUTH-DESIGN.md). */
export const IdentityPool = z.enum(['STAFF', 'CLIENT', 'ADMIN']);
export type IdentityPool = z.infer<typeof IdentityPool>;

/** The firm's eight staff roles (R35). What each may do is in packages/types (team/roles.ts). */
export const MembershipRole = z.enum([
  'OWNER',
  'ADMIN',
  'MANAGER',
  'STAFF',
  'BOOKKEEPER',
  'TAX_PREPARER',
  'CLIENT_SUPPORT',
  'READ_ONLY',
]);
export type MembershipRole = z.infer<typeof MembershipRole>;

/** LOCKED (R35): blocked for now and kept as a member; only ACTIVE members get into the firm. */
export const MembershipStatus = z.enum(['INVITED', 'ACTIVE', 'LOCKED', 'DEACTIVATED']);
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

export const PlatformRole = z.enum(['SUPER_ADMIN', 'TEAM_MEMBER']);
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

export const TaxPlanType = z.enum(['COMPREHENSIVE', 'FOCUSED']);
export type TaxPlanType = z.infer<typeof TaxPlanType>;

/** Where a planning plan stands (the Recent Planning Clients status). Needs Review in the screens is READY_FOR_REVIEW. */
export const TaxPlanStatus = z.enum([
  'DRAFT',
  'SCHEDULED',
  'IN_PROGRESS',
  'AWAITING_CLIENT',
  'READY_FOR_REVIEW',
  'IMPLEMENTED',
  'CLOSED',
]);
export type TaxPlanStatus = z.infer<typeof TaxPlanStatus>;

export const PlanningGoal = z.enum([
  'REDUCE_TAXABLE_INCOME',
  'INCREASE_RETIREMENT_SAVINGS',
  'PURCHASE_HOME',
  'START_BUSINESS',
  'BUY_EQUIPMENT_VEHICLE',
  'MINIMIZE_SELF_EMPLOYMENT_TAX',
  'PLAN_EDUCATION_EXPENSES',
  'BUILD_LONG_TERM_WEALTH',
  'PREPARE_LIFE_CHANGES',
  'OTHER',
]);
export type PlanningGoal = z.infer<typeof PlanningGoal>;

export const TaxFilingStatus = z.enum([
  'SINGLE',
  'MARRIED_FILING_JOINTLY',
  'MARRIED_FILING_SEPARATELY',
  'HEAD_OF_HOUSEHOLD',
  'QUALIFYING_SURVIVING_SPOUSE',
]);
export type TaxFilingStatus = z.infer<typeof TaxFilingStatus>;

export const StrategyCategory = z.enum([
  'RETIREMENT',
  'DEDUCTIONS',
  'BUSINESS',
  'CREDITS',
  'ENTITY',
  'TIMING',
  'INVESTMENT',
  'ESTATE_OTHER',
]);
export type StrategyCategory = z.infer<typeof StrategyCategory>;

/** A strategy in a plan: proposed, accepted by the client, being carried out, done, or declined. */
export const PlanStrategyStatus = z.enum([
  'PROPOSED',
  'ACCEPTED',
  'IN_PROGRESS',
  'IMPLEMENTED',
  'DECLINED',
]);
export type PlanStrategyStatus = z.infer<typeof PlanStrategyStatus>;

/** What a planning input is: a prior year's figure, a projection for the plan year, or a manual adjustment (which needs a note). */
export const PlanInputKind = z.enum(['HISTORICAL', 'PROJECTED', 'ADJUSTMENT']);
export type PlanInputKind = z.infer<typeof PlanInputKind>;

/** Why a plan snapshot was kept: when it was finalized, generated as a document or sent. */
export const PlanVersionEvent = z.enum(['FINALIZED', 'GENERATED', 'SENT']);
export type PlanVersionEvent = z.infer<typeof PlanVersionEvent>;

/** An opportunity's review state. NEW is identified and not reviewed; ADDED_TO_PLAN, IMPLEMENTED and CLOSED need a review; NOT_APPLICABLE and DISMISSED need a reason and can be reopened. */
export const OpportunityStatus = z.enum([
  'NEW',
  'UNDER_REVIEW',
  'ADDED_TO_PLAN',
  'ASSIGNED',
  'DISCUSSION_SCHEDULED',
  'NEEDS_DOCUMENTS',
  'NOT_APPLICABLE',
  'DISMISSED',
  'IMPLEMENTED',
  'CLOSED',
]);
export type OpportunityStatus = z.infer<typeof OpportunityStatus>;

export const OpportunitySource = z.enum(['SYSTEM', 'STAFF', 'IMPORTED', 'MANUAL']);
export type OpportunitySource = z.infer<typeof OpportunitySource>;

export const OpportunityEventKind = z.enum([
  'SCREENED',
  'STATUS',
  'ASSIGNED',
  'DISCUSSION',
  'DOCUMENTS',
  'PLAN',
  'NOTE',
]);
export type OpportunityEventKind = z.infer<typeof OpportunityEventKind>;

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
  'DRAFT',
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
  'CONTACTED',
  'IN_FOLLOW_UP',
  'APPOINTMENT_SCHEDULED',
  'QUALIFIED',
  'LOST',
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
export const OfflinePaymentMethod = z.enum(['CHECK', 'CASH', 'ACH', 'CARD', 'OTHER']);
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

export const PlatformRoleLevel = z.enum([
  'CEO',
  'CHIEF_OFFICER',
  'VP_DIRECTOR',
  'MANAGER',
  'LEAD_SUPERVISOR',
  'INDIVIDUAL_CONTRIBUTOR',
]);
export type PlatformRoleLevel = z.infer<typeof PlatformRoleLevel>;

/** Where a permission or a member's authority applies (hierarchy doc, "Permission Scope Options"). */
export const PlatformScopeType = z.enum([
  'COMPANY',
  'DEPARTMENT',
  'DIVISION',
  'TEAM',
  'DIRECT_REPORTS',
  'OWN_RECORDS',
  'CUSTOM',
]);
export type PlatformScopeType = z.infer<typeof PlatformScopeType>;

export const PlatformPermissionState = z.enum(['ALLOW', 'DENY', 'INHERIT']);
export type PlatformPermissionState = z.infer<typeof PlatformPermissionState>;

export const PlatformMemberStatus = z.enum([
  'PENDING_INVITATION',
  'PENDING_APPROVAL',
  'PENDING_DEPARTMENT_HEAD_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'INACTIVE',
  'DEACTIVATED',
]);
export type PlatformMemberStatus = z.infer<typeof PlatformMemberStatus>;

export const PlatformBillingCycle = z.enum(['MONTHLY', 'ANNUAL']);
export type PlatformBillingCycle = z.infer<typeof PlatformBillingCycle>;

export const PlatformSubscriptionStatus = z.enum([
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'NON_RENEWING',
  'EXPIRED',
  'CANCELLED',
]);
export type PlatformSubscriptionStatus = z.infer<typeof PlatformSubscriptionStatus>;

/** The Super Admin notification center's categories (Notifications spec). */
export const PlatformNotificationCategory = z.enum([
  'FIRMS',
  'FIRM_APPLICATIONS',
  'SALES_LEADS',
  'BILLING_SUBSCRIPTIONS',
  'SUPPORT',
  'INTEGRATIONS',
  'SECURITY',
  'SYSTEM',
]);
export type PlatformNotificationCategory = z.infer<typeof PlatformNotificationCategory>;

export const PlatformNotificationPriority = z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'INFORMATIONAL']);
export type PlatformNotificationPriority = z.infer<typeof PlatformNotificationPriority>;

/** The spec's five statuses mix two things: read or not (readAt) and whether the item asks for work. The API shows Unread / Read / Action Required / Resolved / Dismissed from the two. */
export const PlatformNotificationAttention = z.enum([
  'NONE',
  'ACTION_REQUIRED',
  'RESOLVED',
  'DISMISSED',
]);
export type PlatformNotificationAttention = z.infer<typeof PlatformNotificationAttention>;

/** The Super Admin modules that export (Audit, Integration logs, Communications, Reports, ...). */
export const PlatformExportModule = z.enum([
  'AUDIT',
  'BILLING',
  'COMMUNICATIONS',
  'INTEGRATION_LOGS',
  'REPORTS',
  'SALES',
  'SUPPORT',
]);
export type PlatformExportModule = z.infer<typeof PlatformExportModule>;

export const PlatformExportStatus = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED']);
export type PlatformExportStatus = z.infer<typeof PlatformExportStatus>;

/** Spec: Open by default, In Progress, Waiting on Customer, Resolved, and Closed (distinct from resolved). Overdue and Escalated are flags and tabs, not statuses; a merged ticket is CLOSED with mergedIntoTicketId set. */
export const SupportTicketStatus = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
  'RESOLVED',
  'CLOSED',
]);
export type SupportTicketStatus = z.infer<typeof SupportTicketStatus>;

/** How the ticket came in; stored permanently. */
export const SupportTicketSource = z.enum(['PORTAL', 'EMAIL', 'PHONE', 'INTERNAL', 'WEB_FORM']);
export type SupportTicketSource = z.infer<typeof SupportTicketSource>;

export const SupportAuthorSide = z.enum(['STAFF', 'CUSTOMER']);
export type SupportAuthorSide = z.infer<typeof SupportAuthorSide>;

export const SupportActorType = z.enum(['USER', 'SYSTEM']);
export type SupportActorType = z.infer<typeof SupportActorType>;

export const SupportSlaMode = z.enum(['BUSINESS_HOURS', 'CALENDAR']);
export type SupportSlaMode = z.infer<typeof SupportSlaMode>;

export const SupportEscalationKind = z.enum([
  'SLA_BREACH',
  'HIGH_PRIORITY_UNRESOLVED',
  'CRITICAL_IMMEDIATE',
]);
export type SupportEscalationKind = z.infer<typeof SupportEscalationKind>;

/** Stored lifecycle. Overdue is not stored: an issued invoice past its due date with a balance. */
export const PlatformInvoiceStatus = z.enum([
  'DRAFT',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'VOIDED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
]);
export type PlatformInvoiceStatus = z.infer<typeof PlatformInvoiceStatus>;

export const PlatformRecurringStatus = z.enum(['ACTIVE', 'PAUSED', 'CANCELED']);
export type PlatformRecurringStatus = z.infer<typeof PlatformRecurringStatus>;

export const PlatformRecurringFrequency = z.enum([
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
  'CUSTOM',
]);
export type PlatformRecurringFrequency = z.infer<typeof PlatformRecurringFrequency>;

export const PlatformEstimateStatus = z.enum([
  'DRAFT',
  'SENT',
  'PENDING',
  'APPROVED',
  'DECLINED',
  'EXPIRED',
  'CONVERTED',
]);
export type PlatformEstimateStatus = z.infer<typeof PlatformEstimateStatus>;

export const PlatformPaymentStatus = z.enum([
  'PENDING',
  'COMPLETED',
  'FAILED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
]);
export type PlatformPaymentStatus = z.infer<typeof PlatformPaymentStatus>;

export const PlatformPaymentMethod = z.enum([
  'CARD',
  'ACH',
  'WIRE',
  'CHECK',
  'CASH',
  'CREDIT_BALANCE',
  'OTHER',
]);
export type PlatformPaymentMethod = z.infer<typeof PlatformPaymentMethod>;

export const PlatformRefundStatus = z.enum(['PENDING', 'COMPLETED', 'FAILED']);
export type PlatformRefundStatus = z.infer<typeof PlatformRefundStatus>;

export const PlatformCreditNoteStatus = z.enum([
  'DRAFT',
  'AVAILABLE',
  'PARTIALLY_APPLIED',
  'APPLIED',
  'REFUNDED',
  'VOIDED',
]);
export type PlatformCreditNoteStatus = z.infer<typeof PlatformCreditNoteStatus>;

export const PlatformBillingDocType = z.enum(['INVOICE', 'ESTIMATE', 'CREDIT_NOTE']);
export type PlatformBillingDocType = z.infer<typeof PlatformBillingDocType>;

export const PlatformSubscriptionChangeKind = z.enum([
  'CREATED',
  'UPGRADED',
  'DOWNGRADED',
  'SEATS_CHANGED',
  'CYCLE_CHANGED',
  'STATUS_CHANGED',
  'RENEWED',
  'CANCEL_REQUESTED',
  'CANCELED',
]);
export type PlatformSubscriptionChangeKind = z.infer<typeof PlatformSubscriptionChangeKind>;

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

/** Percentage or a fixed amount. PERCENT keeps what the firm typed in `discount_percent`. */
export const InvoiceDiscountType = z.enum(['PERCENT', 'FIXED']);
export type InvoiceDiscountType = z.infer<typeof InvoiceDiscountType>;

/** How a client may pay one invoice. MANUAL is paid outside the system and recorded by the firm. */
export const InvoicePaymentMethod = z.enum(['CARD', 'ACH', 'MANUAL']);
export type InvoicePaymentMethod = z.infer<typeof InvoicePaymentMethod>;

/** How a late fee is worked out. */
export const LateFeeType = z.enum(['PERCENT', 'FIXED']);
export type LateFeeType = z.infer<typeof LateFeeType>;

/** What an invoice event records: what happened to the invoice, or what staff noted about it. */
export const InvoiceEventType = z.enum([
  'CREATED',
  'SENT',
  'RESENT',
  'VIEWED',
  'REMINDER_SENT',
  'OVERDUE_REMINDER_SENT',
  'RECEIPT_SENT',
  'PAYMENT_LINK_COPIED',
  'NOTE',
  'ACTIVITY_LOGGED',
  'FOLLOW_UP_SCHEDULED',
  'ARCHIVED',
  'UNARCHIVED',
]);
export type InvoiceEventType = z.infer<typeof InvoiceEventType>;

export const InvoiceActorKind = z.enum(['STAFF', 'CLIENT', 'SYSTEM']);
export type InvoiceActorKind = z.infer<typeof InvoiceActorKind>;

/** How often a recurring invoice, or a recurring service's billing, comes round. */
export const BillingFrequency = z.enum([
  'ONE_TIME',
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
]);
export type BillingFrequency = z.infer<typeof BillingFrequency>;

/** ACTIVE sends on its schedule (Upcoming when `start_on` is still ahead); PAUSED keeps its place and history; COMPLETED ran out its end rule; ENDED was stopped or archived by the firm. */
export const RecurringInvoiceStatus = z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'ENDED']);
export type RecurringInvoiceStatus = z.infer<typeof RecurringInvoiceStatus>;

export const InvoiceDelivery = z.enum(['EMAIL', 'PORTAL', 'EMAIL_AND_PORTAL']);
export type InvoiceDelivery = z.infer<typeof InvoiceDelivery>;

export const PaymentMethodStatus = z.enum(['ACTIVE', 'REMOVED']);
export type PaymentMethodStatus = z.infer<typeof PaymentMethodStatus>;

/** DRAFT is not sold yet; ACTIVE is selectable for new sales; INACTIVE keeps its history but is not offered. Archiving (`archived_at`) hides a service from both lists and keeps every record. */
export const ServiceStatus = z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']);
export type ServiceStatus = z.infer<typeof ServiceStatus>;

export const ServicePricingType = z.enum([
  'FIXED',
  'STARTING_AT',
  'HOURLY',
  'CUSTOM_QUOTE',
  'RECURRING',
]);
export type ServicePricingType = z.infer<typeof ServicePricingType>;

export const ServiceInclusionKind = z.enum(['INCLUDED', 'NOT_INCLUDED']);
export type ServiceInclusionKind = z.infer<typeof ServiceInclusionKind>;

export const ServiceLineItemMode = z.enum(['INFORMATIONAL', 'ADDITIVE']);
export type ServiceLineItemMode = z.infer<typeof ServiceLineItemMode>;

/** What a promotion discounts. */
export const PromotionAppliesTo = z.enum(['ALL', 'CATEGORIES', 'SERVICES', 'PACKAGES']);
export type PromotionAppliesTo = z.infer<typeof PromotionAppliesTo>;

export const PromotionEligibility = z.enum(['ALL_CLIENTS', 'NEW_CLIENTS', 'EXISTING_CLIENTS']);
export type PromotionEligibility = z.infer<typeof PromotionEligibility>;

/** DRAFT is not live; ACTIVE is live inside its dates ("Scheduled" before `starts_at` and "Expired" after `ends_at` are worked out from the dates); INACTIVE was ended by the firm. */
export const PromotionStatus = z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']);
export type PromotionStatus = z.infer<typeof PromotionStatus>;

/** Where a message goes: the client portal, email or a text message. */
export const MessageChannel = z.enum(['PORTAL', 'EMAIL', 'SMS']);
export type MessageChannel = z.infer<typeof MessageChannel>;

/** DIRECT: one conversation message to chosen recipients (New Message); BULK: a campaign to an audience built from filters (Send Bulk Message). */
export const OutboundMessageKind = z.enum(['DIRECT', 'BULK']);
export type OutboundMessageKind = z.infer<typeof OutboundMessageKind>;

/** DRAFT -> SCHEDULED or SENDING -> SENT, PARTIAL or FAILED; DRAFT or SCHEDULED -> CANCELED. The text can change until it is sending; SENT, PARTIAL, FAILED and CANCELED are final. */
export const OutboundMessageStatus = z.enum([
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'PARTIAL',
  'FAILED',
  'CANCELED',
]);
export type OutboundMessageStatus = z.infer<typeof OutboundMessageStatus>;

export const MessageAudience = z.enum(['CLIENTS', 'LEADS', 'BOTH']);
export type MessageAudience = z.infer<typeof MessageAudience>;

/** QUEUED -> SENT -> DELIVERED -> READ, or FAILED (retried back to QUEUED, never after SENT), or SKIPPED with the reason (final). A SENT recipient is never sent to again. */
export const OutboundRecipientStatus = z.enum([
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'SKIPPED',
]);
export type OutboundRecipientStatus = z.infer<typeof OutboundRecipientStatus>;

/** Why a recipient could not receive the message ("Cannot Receive"). */
export const OutboundExclusion = z.enum([
  'NO_CONTACT',
  'NO_CONSENT',
  'NO_PORTAL_ACCESS',
  'PROVIDER_UNAVAILABLE',
  'SUPPRESSED',
  'NOT_PERMITTED',
  'MANUALLY_EXCLUDED',
  'DUPLICATE',
]);
export type OutboundExclusion = z.infer<typeof OutboundExclusion>;

/** Part of the firm workspace a client's portal can show. The firm's default and a client's own are both rows of `portal_module_visibility`; a module's visibility never shares every record in it. */
export const PortalModule = z.enum([
  'TAX_RETURNS',
  'DOCUMENTS',
  'INVOICES_PAYMENTS',
  'APPOINTMENTS',
  'INTAKE_FORMS',
  'TASKS_REQUESTS',
  'MESSAGES',
  'REPORTS',
]);
export type PortalModule = z.infer<typeof PortalModule>;

export const BrandTheme = z.enum(['LIGHT', 'DARK', 'SYSTEM']);
export type BrandTheme = z.infer<typeof BrandTheme>;

export const SidebarStyle = z.enum(['SOLID', 'GRADIENT']);
export type SidebarStyle = z.infer<typeof SidebarStyle>;

export const SidebarPosition = z.enum(['LEFT', 'RIGHT']);
export type SidebarPosition = z.infer<typeof SidebarPosition>;

export const DateFormat = z.enum(['MDY', 'DMY', 'YMD']);
export type DateFormat = z.infer<typeof DateFormat>;

export const MessageTemplateKind = z.enum([
  'EMAIL',
  'SMS',
  'PORTAL_MESSAGE',
  'DOCUMENT_REQUEST',
  'INTAKE_ORGANIZER',
  'ENGAGEMENT_AGREEMENT',
  'INVOICE_PAYMENT',
  'APPOINTMENT',
  'TASK',
  'TAX_WORKFLOW',
  'BOOKKEEPING',
  'PAYROLL',
  'LEAD_FOLLOW_UP',
  'CAMPAIGN',
  'LETTER_NOTICE',
  'ANNOUNCEMENT',
]);
export type MessageTemplateKind = z.infer<typeof MessageTemplateKind>;

/** DRAFT is not offered to automations; ARCHIVED is hidden from pickers but kept for history. */
export const MessageTemplateStatus = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export type MessageTemplateStatus = z.infer<typeof MessageTemplateStatus>;

/** Who can use a template: its owner only, the whole team, or the people in message_template_shares. */
export const MessageTemplateAccess = z.enum(['PRIVATE', 'TEAM', 'SELECTED']);
export type MessageTemplateAccess = z.infer<typeof MessageTemplateAccess>;

export const IntegrationConnectionStatus = z.enum([
  'CONNECTED',
  'SYNCING',
  'NEEDS_ATTENTION',
  'PAUSED',
  'DISCONNECTED',
]);
export type IntegrationConnectionStatus = z.infer<typeof IntegrationConnectionStatus>;

/** Live (production) or Test (sandbox) credentials; the two never mix. */
export const IntegrationEnvironment = z.enum(['LIVE', 'TEST']);
export type IntegrationEnvironment = z.infer<typeof IntegrationEnvironment>;

export const IntegrationSyncDirection = z.enum(['IMPORT', 'EXPORT', 'TWO_WAY']);
export type IntegrationSyncDirection = z.infer<typeof IntegrationSyncDirection>;

export const IntegrationSyncMode = z.enum(['AUTO', 'MANUAL']);
export type IntegrationSyncMode = z.infer<typeof IntegrationSyncMode>;

export const IntegrationSyncRunStatus = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'PARTIAL',
]);
export type IntegrationSyncRunStatus = z.infer<typeof IntegrationSyncRunStatus>;

export const IntegrationRequestStatus = z.enum([
  'NEW',
  'REVIEWING',
  'PLANNED',
  'IN_DEVELOPMENT',
  'AVAILABLE',
  'DECLINED',
]);
export type IntegrationRequestStatus = z.infer<typeof IntegrationRequestStatus>;

/** How a campaign goes out. Consent and suppression exist only for EMAIL and SMS. */
export const CommunicationChannel = z.enum(['EMAIL', 'SMS', 'ANNOUNCEMENT']);
export type CommunicationChannel = z.infer<typeof CommunicationChannel>;

/** DYNAMIC: members come from `criteria` each time. STATIC: members are saved rows. */
export const SegmentType = z.enum(['DYNAMIC', 'STATIC']);
export type SegmentType = z.infer<typeof SegmentType>;

export const SegmentAudience = z.enum(['CLIENTS', 'LEADS', 'BOTH']);
export type SegmentAudience = z.infer<typeof SegmentAudience>;

/** A contact's standing on one channel. Anything but OPTED_IN keeps them out of campaigns. */
export const ConsentStatus = z.enum(['OPTED_IN', 'OPTED_OUT', 'BOUNCED', 'INVALID', 'COMPLAINED']);
export type ConsentStatus = z.infer<typeof ConsentStatus>;

/** DRAFT or SCHEDULED can be edited. SENDING, PAUSED, SENT, FAILED and CANCELLED never change their content. Archiving is `archivedAt`, not a status, so it can be undone. */
export const CommunicationStatus = z.enum([
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'PAUSED',
  'SENT',
  'FAILED',
  'CANCELLED',
]);
export type CommunicationStatus = z.infer<typeof CommunicationStatus>;

/** How a campaign was made from an earlier one (never by changing the earlier one). */
export const CommunicationSourceKind = z.enum(['DUPLICATE', 'RESEND_FAILED', 'FOLLOW_UP']);
export type CommunicationSourceKind = z.infer<typeof CommunicationSourceKind>;

/** A segment, one person, or one person left out by hand. */
export const AudienceEntryKind = z.enum([
  'SEGMENT',
  'CLIENT',
  'LEAD',
  'EXCLUDE_CLIENT',
  'EXCLUDE_LEAD',
]);
export type AudienceEntryKind = z.infer<typeof AudienceEntryKind>;

/** Where one recipient stands, in Firmivra's own words (provider states are normalized to these). */
export const CommunicationRecipientStatus = z.enum([
  'QUEUED',
  'SENT',
  'DELIVERED',
  'OPENED',
  'CLICKED',
  'BOUNCED',
  'UNSUBSCRIBED',
  'FAILED',
  'NOT_SENT',
]);
export type CommunicationRecipientStatus = z.infer<typeof CommunicationRecipientStatus>;

export const CommunicationEventType = z.enum([
  'QUEUED',
  'SENT',
  'DELIVERED',
  'OPENED',
  'CLICKED',
  'BOUNCED',
  'COMPLAINED',
  'UNSUBSCRIBED',
  'FAILED',
]);
export type CommunicationEventType = z.infer<typeof CommunicationEventType>;

export const ReportCategory = z.enum([
  'FINANCIAL',
  'CLIENT',
  'TAX',
  'BOOKKEEPING',
  'PAYROLL',
  'LEADS',
  'COMMUNICATIONS',
  'TEAM_PRODUCTIVITY',
  'ADVISORY',
]);
export type ReportCategory = z.infer<typeof ReportCategory>;

export const ReportVisibility = z.enum(['PRIVATE', 'SELECTED', 'COMPANY']);
export type ReportVisibility = z.infer<typeof ReportVisibility>;

/** A saved report keeps its settings, with either a fixed date range or a rolling one. */
export const ReportDateRule = z.enum(['FIXED', 'ROLLING']);
export type ReportDateRule = z.infer<typeof ReportDateRule>;

/** Which money "Total Revenue" means in every report, KPI card and export of the firm. */
export const RevenueBasis = z.enum(['COLLECTED', 'INVOICED']);
export type RevenueBasis = z.infer<typeof RevenueBasis>;

export const ReportFrequency = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL']);
export type ReportFrequency = z.infer<typeof ReportFrequency>;

export const ReportFormat = z.enum(['PDF', 'XLSX', 'CSV']);
export type ReportFormat = z.infer<typeof ReportFormat>;

/** VIEW: opened on screen (Recent Reports). EXPORT: a download. SCHEDULED: made by a schedule. SNAPSHOT: a saved copy of the numbers at that moment. */
export const ReportRunKind = z.enum(['VIEW', 'EXPORT', 'SCHEDULED', 'SNAPSHOT']);
export type ReportRunKind = z.infer<typeof ReportRunKind>;

export const ReportRunStatus = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']);
export type ReportRunStatus = z.infer<typeof ReportRunStatus>;

/** Firmivra's own workflow status for a payroll client, not the provider's. */
export const PayrollClientStatus = z.enum([
  'ON_TRACK',
  'PROCESSING',
  'ACTION_REQUIRED',
  'PAST_DUE',
  'NOT_STARTED',
  'ON_HOLD',
  'ARCHIVED',
]);
export type PayrollClientStatus = z.infer<typeof PayrollClientStatus>;

export const PayrollFrequency = z.enum(['WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY']);
export type PayrollFrequency = z.infer<typeof PayrollFrequency>;

export const PayrollActivityKind = z.enum([
  'PAYROLL_REVIEW',
  'CLIENT_CALL',
  'PROVIDER_ISSUE',
  'NOTICE_FOLLOW_UP',
  'DOCUMENT_FOLLOW_UP',
  'OTHER',
]);
export type PayrollActivityKind = z.infer<typeof PayrollActivityKind>;

export const PayrollWorkerType = z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACTOR']);
export type PayrollWorkerType = z.infer<typeof PayrollWorkerType>;

export const PayrollWorkerStatus = z.enum(['ACTIVE', 'ON_LEAVE', 'INACTIVE', 'PENDING_SETUP']);
export type PayrollWorkerStatus = z.infer<typeof PayrollWorkerStatus>;

export const PayrollPayType = z.enum(['HOURLY', 'SALARY', 'COMMISSION']);
export type PayrollPayType = z.infer<typeof PayrollPayType>;

/** Firmivra's workflow for a run. The provider's own status is kept apart in `providerStatus`. COMPLETED is final. */
export const PayrollRunStatus = z.enum([
  'NOT_STARTED',
  'DRAFT',
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'APPROVED',
  'SUBMITTED',
  'PROCESSING',
  'COMPLETED',
  'NEEDS_ATTENTION',
]);
export type PayrollRunStatus = z.infer<typeof PayrollRunStatus>;

export const PayrollLineStatus = z.enum([
  'READY',
  'WARNING',
  'ERROR',
  'PENDING_CHANGE',
  'EXCLUDED',
]);
export type PayrollLineStatus = z.infer<typeof PayrollLineStatus>;

export const PayrollIssueSeverity = z.enum(['INFO', 'WARNING', 'ERROR']);
export type PayrollIssueSeverity = z.infer<typeof PayrollIssueSeverity>;

/** Only what the provider or an import confirmed. A Firmivra task being done never makes a filing FILED or PAID. */
export const PayrollFilingStatus = z.enum([
  'UPCOMING',
  'IN_PROGRESS',
  'FILED',
  'PAID',
  'FAILED',
  'NEEDS_ATTENTION',
  'UNKNOWN',
]);
export type PayrollFilingStatus = z.infer<typeof PayrollFilingStatus>;

export const PayrollPaymentStatus = z.enum(['SCHEDULED', 'PAID', 'FAILED', 'UNKNOWN']);
export type PayrollPaymentStatus = z.infer<typeof PayrollPaymentStatus>;

export const PayrollReportKind = z.enum([
  'REGISTER',
  'EARNINGS',
  'DEDUCTIONS',
  'EMPLOYER_TAX',
  'TAX_FILING',
  'JOURNAL',
  'LABOR',
  'W2_W3',
  'FORM_1099',
  'OTHER',
]);
export type PayrollReportKind = z.infer<typeof PayrollReportKind>;

export const PayrollYearEndStatus = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'RECONCILED',
  'DELIVERED',
  'ARCHIVED',
]);
export type PayrollYearEndStatus = z.infer<typeof PayrollYearEndStatus>;

export const AdvisoryClientStatus = z.enum([
  'IN_PROGRESS',
  'SCHEDULED',
  'NEEDS_REVIEW',
  'ON_HOLD',
  'COMPLETED',
  'ARCHIVED',
]);
export type AdvisoryClientStatus = z.infer<typeof AdvisoryClientStatus>;

export const AdvisoryServiceStatus = z.enum([
  'INTERESTED',
  'PROPOSED',
  'ACCEPTED',
  'IN_PROGRESS',
  'AWAITING_CLIENT',
  'COMPLETED',
  'DECLINED',
  'ON_HOLD',
]);
export type AdvisoryServiceStatus = z.infer<typeof AdvisoryServiceStatus>;

/** A client has one PRIMARY service focus (exactly one, in SQL) and any number of ADDITIONAL ones. */
export const AdvisoryServiceRole = z.enum(['PRIMARY', 'ADDITIONAL']);
export type AdvisoryServiceRole = z.infer<typeof AdvisoryServiceRole>;

export const AdvisoryPlanStatus = z.enum([
  'DRAFT',
  'IN_REVIEW',
  'FINALIZED',
  'SENT',
  'IN_PROGRESS',
  'COMPLETED',
  'ARCHIVED',
]);
export type AdvisoryPlanStatus = z.infer<typeof AdvisoryPlanStatus>;

export const AdvisoryGoalStatus = z.enum([
  'NOT_STARTED',
  'PLANNING',
  'IN_PROGRESS',
  'ON_TRACK',
  'AT_RISK',
  'OVERDUE',
  'COMPLETED',
  'CANCELLED',
]);
export type AdvisoryGoalStatus = z.infer<typeof AdvisoryGoalStatus>;

export const AdvisoryRecommendationStatus = z.enum([
  'PROPOSED',
  'ACCEPTED',
  'IN_PROGRESS',
  'IMPLEMENTED',
  'NOT_APPLICABLE',
  'DECLINED',
]);
export type AdvisoryRecommendationStatus = z.infer<typeof AdvisoryRecommendationStatus>;

export const AdvisoryActionStatus = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export type AdvisoryActionStatus = z.infer<typeof AdvisoryActionStatus>;

export const AdvisoryPriority = z.enum(['LOW', 'NORMAL', 'HIGH']);
export type AdvisoryPriority = z.infer<typeof AdvisoryPriority>;

/** Who an action item is for. Tasks (the `tasks` table) can only name a staff member, but an advisory action item is often the client's ("Gather 3 vendor quotes") or the firm team's. */
export const AdvisoryAssigneeKind = z.enum(['STAFF', 'CLIENT', 'TEAM']);
export type AdvisoryAssigneeKind = z.infer<typeof AdvisoryAssigneeKind>;

export const AdvisoryFinancialSource = z.enum([
  'MANUAL',
  'BOOKKEEPING',
  'PAYROLL',
  'BANK',
  'UPLOADED',
]);
export type AdvisoryFinancialSource = z.infer<typeof AdvisoryFinancialSource>;

export const StaffGroupStatus = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);
export type StaffGroupStatus = z.infer<typeof StaffGroupStatus>;

/** A member's place in a team: their one primary team, their one backup team, or a member. */
export const TeamMemberKind = z.enum(['PRIMARY', 'BACKUP', 'MEMBER']);
export type TeamMemberKind = z.infer<typeof TeamMemberKind>;

export const StaffEmploymentType = z.enum([
  'W2',
  'FORM_1099',
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'TEMPORARY',
  'SEASONAL',
  'INTERN',
  'OTHER',
]);
export type StaffEmploymentType = z.infer<typeof StaffEmploymentType>;

/** The "User Access Level" on Create Staff. It labels the member's authority; what they can do comes from the role and its permissions, never from this field alone. */
export const StaffAccessLevel = z.enum(['STANDARD_USER', 'MANAGER', 'ADMINISTRATOR']);
export type StaffAccessLevel = z.infer<typeof StaffAccessLevel>;

export const StaffAuthMethod = z.enum(['AUTHENTICATOR_APP', 'SMS', 'EMAIL', 'BACKUP_CODES']);
export type StaffAuthMethod = z.infer<typeof StaffAuthMethod>;

/** Where a member may sign in from: anywhere, only the listed IP addresses or networks, or only the listed countries (approximate, from the viewer's IP; telemetry, not proof of location). */
export const StaffAccessLocation = z.enum(['ANYWHERE', 'ALLOWED_IPS', 'ALLOWED_COUNTRIES']);
export type StaffAccessLocation = z.infer<typeof StaffAccessLocation>;

export const StaffPayType = z.enum(['SALARY', 'HOURLY', 'COMMISSION', 'PER_PROJECT', 'OTHER']);
export type StaffPayType = z.infer<typeof StaffPayType>;

export const StaffPayFrequency = z.enum([
  'WEEKLY',
  'BIWEEKLY',
  'SEMIMONTHLY',
  'MONTHLY',
  'ANNUALLY',
]);
export type StaffPayFrequency = z.infer<typeof StaffPayFrequency>;

export const StaffDocumentType = z.enum([
  'EMPLOYMENT_AGREEMENT',
  'CONTRACTOR_AGREEMENT',
  'W4',
  'DIRECT_DEPOSIT',
  'NDA',
  'CREDENTIAL_LICENSE',
  'TRAINING_ACKNOWLEDGMENT',
  'OTHER',
]);
export type StaffDocumentType = z.infer<typeof StaffDocumentType>;

export const PermissionModule = z.enum([
  'DASHBOARD',
  'CLIENTS',
  'LEADS',
  'APPOINTMENTS',
  'INTAKE_FORMS',
  'DOCUMENTS',
  'CLIENT_PORTAL',
  'TASKS',
  'TAX_RETURNS',
  'BOOKKEEPING',
  'PAYROLL',
  'TAX_PLANNING',
  'BUSINESS_ADVISORY',
  'INVOICES_PAYMENTS',
  'MESSAGES',
  'COMMUNICATIONS',
  'AUTOMATIONS',
  'COMPLIANCE',
  'REPORTS',
  'TEMPLATES',
  'SERVICES_PRICING',
  'STAFF_MANAGEMENT',
  'INTEGRATIONS',
  'SETTINGS',
]);
export type PermissionModule = z.infer<typeof PermissionModule>;

/** What a person may do in a module. "Full Access" is all of them (not stored). The Users & Roles grid's "Admin" column is MANAGE: configuration and access of the module. */
export const PermissionCapability = z.enum([
  'VIEW',
  'CREATE',
  'EDIT',
  'DELETE',
  'APPROVE',
  'MANAGE',
  'EXPORT',
]);
export type PermissionCapability = z.infer<typeof PermissionCapability>;

/** How an intake is delivered to its recipient. PORTAL only for a client's intake (CHECK). */
export const IntakeDelivery = z.enum(['EMAIL', 'SMS', 'PORTAL']);
export type IntakeDelivery = z.infer<typeof IntakeDelivery>;

/** Where a document is in review. "Signed" is not stored: Firm Sign's records say it. */
export const DocumentReviewStatus = z.enum([
  'NEEDS_REVIEW',
  'IN_REVIEW',
  'VERIFIED',
  'REPLACEMENT_REQUESTED',
  'COMPLETED',
]);
export type DocumentReviewStatus = z.infer<typeof DocumentReviewStatus>;

/** CLIENT folders hold a client's documents; FIRM folders are the firm's own (never shared). */
export const DocumentFolderScope = z.enum(['CLIENT', 'FIRM']);
export type DocumentFolderScope = z.infer<typeof DocumentFolderScope>;

/** Folder colours, mapped to packages/ui tokens by the screens (no hex values here). */
export const FolderColor = z.enum(['BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'PINK', 'PURPLE', 'GRAY']);
export type FolderColor = z.infer<typeof FolderColor>;

/** A folder's default for "Make visible to client" on that client's own new documents. Never a grant to all clients. */
export const FolderClientAccess = z.enum(['NONE', 'VIEW', 'VIEW_UPLOAD']);
export type FolderClientAccess = z.infer<typeof FolderClientAccess>;

export const DocumentRequestRecipient = z.enum(['CLIENT', 'MEMBER']);
export type DocumentRequestRecipient = z.infer<typeof DocumentRequestRecipient>;

/** DRAFT is saved but not sent (the portal never shows it); OPEN is with the recipient; SUBMITTED means the client pressed "Submit for review"; COMPLETED and CANCELLED are final. "Outstanding", "Partially received", "Ready for review", "Overdue" and "Expired" are computed from the items, dueOn and expiresAt, not stored. */
export const DocumentRequestPacketStatus = z.enum([
  'DRAFT',
  'OPEN',
  'SUBMITTED',
  'COMPLETED',
  'CANCELLED',
]);
export type DocumentRequestPacketStatus = z.infer<typeof DocumentRequestPacketStatus>;

export const DocumentShareRecipient = z.enum(['CLIENT', 'MEMBER']);
export type DocumentShareRecipient = z.infer<typeof DocumentShareRecipient>;

/** Where a return is in the firm's own workflow (Tax Returns list and workspace). The client sees the five-value TaxReturnStatus, which the database derives from this. */
export const TaxReturnWorkflowStatus = z.enum([
  'IN_PREPARATION',
  'WAITING_ON_CLIENT',
  'READY_FOR_REVIEW',
  'READY_FOR_SIGNATURE',
  'READY_TO_FILE',
  'TRANSMITTED',
  'ACCEPTED',
  'REJECTED',
  'CLOSED',
]);
export type TaxReturnWorkflowStatus = z.infer<typeof TaxReturnWorkflowStatus>;

export const TaxpayerFilingStatus = z.enum([
  'SINGLE',
  'MARRIED_FILING_JOINTLY',
  'MARRIED_FILING_SEPARATELY',
  'HEAD_OF_HOUSEHOLD',
  'QUALIFYING_SURVIVING_SPOUSE',
]);
export type TaxpayerFilingStatus = z.infer<typeof TaxpayerFilingStatus>;

/** A quarterly estimate's own progress (Overdue is computed: past dueOn and not PAID). */
export const TaxEstimateStatus = z.enum([
  'NOT_STARTED',
  'CALCULATED',
  'SENT_TO_CLIENT',
  'SCHEDULED',
  'PAID',
]);
export type TaxEstimateStatus = z.infer<typeof TaxEstimateStatus>;

export const TaxFilingMethod = z.enum(['EFILE', 'PAPER']);
export type TaxFilingMethod = z.infer<typeof TaxFilingMethod>;

/** One jurisdiction's filing state. For EFILE it follows the newest attempt (the database sets it); PAPER_FILED is for paper filings only. */
export const TaxJurisdictionStatus = z.enum([
  'NOT_FILED',
  'TRANSMITTED',
  'ACCEPTED',
  'REJECTED',
  'PAPER_FILED',
]);
export type TaxJurisdictionStatus = z.infer<typeof TaxJurisdictionStatus>;

export const TaxAmountStatus = z.enum(['ESTIMATED', 'FINAL']);
export type TaxAmountStatus = z.infer<typeof TaxAmountStatus>;

export const TaxAckStatus = z.enum(['PENDING', 'ACCEPTED', 'REJECTED']);
export type TaxAckStatus = z.infer<typeof TaxAckStatus>;

export const TaxApprovalStatus = z.enum(['PENDING', 'APPROVED', 'RETURNED', 'INVALIDATED']);
export type TaxApprovalStatus = z.infer<typeof TaxApprovalStatus>;

export const TaxChecklistSection = z.enum(['PREPARATION', 'REVIEW', 'VALIDATION']);
export type TaxChecklistSection = z.infer<typeof TaxChecklistSection>;

/** OPEN and DONE are for the preparation and review lists; VALID, INFO, WARNING and ERROR for the final validation. */
export const TaxCheckResult = z.enum(['OPEN', 'DONE', 'VALID', 'INFO', 'WARNING', 'ERROR']);
export type TaxCheckResult = z.infer<typeof TaxCheckResult>;

export const TaxAuthorizationKind = z.enum(['FEDERAL_EFILE', 'STATE_EFILE', 'CLIENT_CONSENT']);
export type TaxAuthorizationKind = z.infer<typeof TaxAuthorizationKind>;

/** What a file is in a return's folder: the draft, the signature form, the filed return, the acknowledgment, a voucher, proof of payment or an extension form. Files stay ordinary documents of the client; this adds the role. The filed return and acknowledgment links are never removed. */
export const TaxReturnDocumentKind = z.enum([
  'DRAFT_RETURN',
  'SIGNATURE_FORM',
  'FILED_RETURN',
  'ACKNOWLEDGMENT',
  'VOUCHER',
  'PAYMENT_PROOF',
  'EXTENSION',
]);
export type TaxReturnDocumentKind = z.infer<typeof TaxReturnDocumentKind>;

/** Calendar colours: token names the screens map to packages/ui (no hex values here). */
export const CalendarColor = z.enum(['BLUE', 'GREEN', 'AMBER', 'RED', 'PURPLE', 'GRAY']);
export type CalendarColor = z.infer<typeof CalendarColor>;

export const ReminderChannel = z.enum(['EMAIL', 'SMS', 'PORTAL']);
export type ReminderChannel = z.infer<typeof ReminderChannel>;

export const BlockedTimeKind = z.enum(['BLOCKED', 'TIME_OFF']);
export type BlockedTimeKind = z.infer<typeof BlockedTimeKind>;

export const RecurrenceFrequency = z.enum(['DAILY', 'WEEKLY', 'MONTHLY']);
export type RecurrenceFrequency = z.infer<typeof RecurrenceFrequency>;

export const ClientStatus = z.enum([
  'NEW',
  'PENDING_DOCUMENTS',
  'IN_PROGRESS',
  'ACTIVE',
  'ON_HOLD',
  'INACTIVE',
]);
export type ClientStatus = z.infer<typeof ClientStatus>;

/** Not drawn in the designs (only the filter's name): High, Medium, Low as on tasks. To confirm. */
export const ClientPriority = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type ClientPriority = z.infer<typeof ClientPriority>;

/** Where a lead came from (the list's source filter). Begin Online leads are BEGIN_ONLINE. */
export const LeadSource = z.enum([
  'BEGIN_ONLINE',
  'WEBSITE_FORM',
  'FACEBOOK_AD',
  'INSTAGRAM',
  'GOOGLE_AD',
  'REFERRAL',
  'PHONE_CALL',
  'WALK_IN',
  'EMAIL',
  'EVENT',
  'OTHER',
]);
export type LeadSource = z.infer<typeof LeadSource>;

/** Set by hand, as on the designs (Hot, Warm, Cold); there is no score. */
export const LeadPriority = z.enum(['HOT', 'WARM', 'COLD']);
export type LeadPriority = z.infer<typeof LeadPriority>;

export const LeadActionType = z.enum([
  'CALL',
  'EMAIL',
  'SMS',
  'APPOINTMENT',
  'SEND_DOCUMENTS',
  'FOLLOW_UP',
  'CLOSE_LEAD',
]);
export type LeadActionType = z.infer<typeof LeadActionType>;

export const LeadActivityKind = z.enum([
  'CREATED',
  'STATUS_CHANGED',
  'FORM_SUBMITTED',
  'EMAIL_SENT',
  'SMS_SENT',
  'CALL',
  'MEETING',
  'NOTE',
  'FOLLOW_UP',
  'FOLLOW_UP_COMPLETED',
  'APPOINTMENT_SCHEDULED',
  'TAG_ADDED',
  'ASSIGNED',
  'CONVERTED',
  'DOCUMENT',
  'CAMPAIGN',
]);
export type LeadActivityKind = z.infer<typeof LeadActivityKind>;

export const PlatformIntegrationCategory = z.enum([
  'PAYMENTS_BILLING',
  'COMMUNICATION',
  'EMAIL',
  'CLOUD_STORAGE',
  'AI_AUTOMATION',
  'MLS_DATA',
  'ESIGN',
  'SECURITY_INFRASTRUCTURE',
  'OTHER',
]);
export type PlatformIntegrationCategory = z.infer<typeof PlatformIntegrationCategory>;

/** DRAFT until activated (after a passing test); then ACTIVE, INACTIVE, NEEDS_ATTENTION or ERROR as health and admins decide; DISABLED by an admin; REMOVED is the tombstone. */
export const PlatformIntegrationStatus = z.enum([
  'DRAFT',
  'ACTIVE',
  'INACTIVE',
  'NEEDS_ATTENTION',
  'ERROR',
  'DISABLED',
  'REMOVED',
]);
export type PlatformIntegrationStatus = z.infer<typeof PlatformIntegrationStatus>;

export const PlatformIntegrationRunKind = z.enum(['SYNC', 'TEST']);
export type PlatformIntegrationRunKind = z.infer<typeof PlatformIntegrationRunKind>;

export const PlatformIntegrationLogSource = z.enum([
  'PLATFORM_INTEGRATION',
  'FIRM_CONNECTION',
  'API',
  'WEBHOOK',
]);
export type PlatformIntegrationLogSource = z.infer<typeof PlatformIntegrationLogSource>;

export const PlatformIntegrationLogSeverity = z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);
export type PlatformIntegrationLogSeverity = z.infer<typeof PlatformIntegrationLogSeverity>;

/** ENABLED: visible and connectable; COMING_SOON: visible, not connectable; DISABLED: hidden. */
export const PlatformCatalogStatus = z.enum(['ENABLED', 'COMING_SOON', 'DISABLED']);
export type PlatformCatalogStatus = z.infer<typeof PlatformCatalogStatus>;

export const PlatformCatalogPlanAccess = z.enum(['ALL_PLANS', 'SELECTED_PLANS']);
export type PlatformCatalogPlanAccess = z.infer<typeof PlatformCatalogPlanAccess>;

export const PlatformCatalogFirmAccess = z.enum(['ALLOW', 'DENY']);
export type PlatformCatalogFirmAccess = z.infer<typeof PlatformCatalogFirmAccess>;

export const PlatformWebhookDirection = z.enum(['OUTBOUND', 'INBOUND']);
export type PlatformWebhookDirection = z.infer<typeof PlatformWebhookDirection>;

export const PlatformWebhookStatus = z.enum(['ACTIVE', 'DISABLED']);
export type PlatformWebhookStatus = z.infer<typeof PlatformWebhookStatus>;

export const PlatformDeliveryStatus = z.enum(['PENDING', 'SUCCEEDED', 'FAILED']);
export type PlatformDeliveryStatus = z.infer<typeof PlatformDeliveryStatus>;

export const PlatformUsageScope = z.enum(['PLATFORM_INTEGRATION', 'CATALOG', 'API']);
export type PlatformUsageScope = z.infer<typeof PlatformUsageScope>;
