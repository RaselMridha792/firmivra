export * from './schemas.js';
export {
  ApiRequestError,
  createApiClient,
  createRequest,
  parseInput,
  retryWhenUnavailable,
  toQuery,
  type ApiClient,
  type ApiClientOptions,
  type ApiRequest,
} from './client.js';
export * from './auth/index.js';
export * from './tax-statuses/index.js';
export * from './client-auth/index.js';
export * from './team/index.js';
export * from './staff/index.js';
export * from './settings/index.js';
export * from './clients/index.js';
export * from './engagements/index.js';
export * from './tax-returns/index.js';
export * from './firm-applications/index.js';
export * from './admin-notifications/index.js';
export * from './appointments/index.js';
export * from './content/index.js';
export * from './calculators/index.js';
export * from './documents/index.js';
export * from './tasks/index.js';
export * from './templates/index.js';
export * from './automations/index.js';
export * from './reports/index.js';
export * from './advisory/index.js';
export * from './integrations/index.js';
export * from './tax-planning/index.js';
export * from './communications/index.js';
export * from './workspaces/index.js';
export * from './audit-log/index.js';
export * from './support-access/index.js';
export * from './admin-support/index.js';
export * from './admin-audit/index.js';
export * from './admin-settings/index.js';
export * from './payments/index.js';
export * from './notifications/index.js';
export * from './esign/index.js';
export * from './intake/index.js';
export * from './begin-online/index.js';
export * from './leads/index.js';
export * from './services-pricing/index.js';
export * from './messages/index.js';
export * from './agreements/index.js';
export * from './dashboard/index.js';
export * from './payroll/index.js';
export * from './compliance/index.js';
// The same values as the database enums in db-enums.ts (exported through ./schemas.js). These
// modules define their own copies, so name the ones the root exports.
export { AppointmentStatus, LocationKind } from './appointments/index.js';
export { ContentKind } from './content/index.js';
export { TaskKind, TaskStatus } from './tasks/index.js';
export { ReportKind, ReportStatus } from './workspaces/index.js';
export { BillingFrequency, PromotionStatus } from './services-pricing/index.js';
// Intake agreements and Firm Sign (R14, R13) will export modules that use these database enums:
// name them here so the root always takes the generated values.
export { AgreementScope, SignatureMethod } from './schemas.js';
// Firm Sign's value lists (esign/enums.ts) are the same as these database enums (r0_esign).
export {
  EsignActorKind,
  EsignAuthMethod,
  EsignBulkItemState,
  EsignDelivery,
  EsignEventType,
  EsignFieldType,
  EsignRecipientKind,
  EsignRecipientRole,
  EsignRecipientStatus,
  EsignRequestStatus,
  EsignRouting,
  EsignSource,
  EsignTemplateVisibility,
} from './schemas.js';
// Documents exports only the type, with the same six values: the root takes the database enum.
export { DocumentRequestStatus } from './schemas.js';
// The R42 contracts (settings/branding.ts, appointments/scheduling.ts) define their own copies of
// these database enums (R36, R37): the root takes the generated values. SidebarStyle,
// SidebarPosition and ReminderChannel have the same values; the scheduling form's
// RecurrenceFrequency adds NONE and CUSTOM, which the contract's own schemas keep using.
export { RecurrenceFrequency, ReminderChannel, SidebarPosition, SidebarStyle } from './schemas.js';
export * from './bookkeeping/index.js';
