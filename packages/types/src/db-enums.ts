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
