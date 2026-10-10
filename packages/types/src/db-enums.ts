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
