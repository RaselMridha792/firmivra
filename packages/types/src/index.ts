export * from './schemas.js';
export {
  ApiRequestError,
  createApiClient,
  createRequest,
  parseInput,
  toQuery,
  type ApiClient,
  type ApiClientOptions,
  type ApiRequest,
} from './client.js';
export * from './auth/index.js';
export * from './tax-statuses/index.js';
export * from './client-auth/index.js';
export * from './team/index.js';
export * from './settings/index.js';
export * from './clients/index.js';
export * from './engagements/index.js';
export * from './tax-returns/index.js';
export * from './firm-applications/index.js';
export * from './appointments/index.js';
export * from './content/index.js';
export * from './calculators/index.js';
export * from './documents/index.js';
export * from './tasks/index.js';
export * from './workspaces/index.js';
export * from './audit-log/index.js';
export * from './support-access/index.js';
export * from './payments/index.js';
export * from './notifications/index.js';
export * from './esign/index.js';
export * from './intake/index.js';
export * from './messages/index.js';
// The same values as the database enums in db-enums.ts (exported through ./schemas.js). These
// modules define their own copies, so name the ones the root exports.
export { AppointmentStatus, LocationKind } from './appointments/index.js';
export { ContentKind } from './content/index.js';
export { TaskKind, TaskStatus } from './tasks/index.js';
export { ReportKind, ReportStatus } from './workspaces/index.js';
// Intake agreements and Firm Sign (R14, R13) will export modules that use these database enums:
// name them here so the root always takes the generated values.
export { AgreementScope, SignatureMethod } from './schemas.js';
// Documents exports only the type, with the same six values: the root takes the database enum.
export { DocumentRequestStatus } from './schemas.js';
