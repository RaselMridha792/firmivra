import type {
  AdminApiKey,
  AdminApiKeyStatus,
  AdminApiScope,
  AdminCatalogFirmRule,
  AdminCatalogItem,
  AdminConnectionTestResult,
  AdminConnectionValue,
  AdminExportJob,
  AdminFirmOption,
  AdminIntegrationAccess,
  AdminIntegrationAuditEntry,
  AdminIntegrationLog,
  AdminIntegrationLogo,
  AdminIssuedApiKey,
  AdminLogRecord,
  AdminPlanOption,
  AdminPlatformIntegration,
  AdminPlatformIntegrationDetail,
  AdminPlatformRun,
  AdminPlatformSettings,
  AdminProviderTemplate,
  AdminUsageDay,
  AdminUsageReport,
  AdminUsageSubject,
  AdminWebhookDelivery,
  AdminWebhookEndpoint,
  AdminWebhookWithSecret,
  CreateAdminApiKeyRequest,
  CreateAdminWebhookRequest,
  ExportAdminLogsRequest,
  ListAdminIntegrationLogsQuery,
  ListAdminPlatformQuery,
  UpdateAdminCatalogRequest,
  UpdateAdminPlatformRequest,
} from '@firmivra/types';
import { api } from '../../../../../lib/api';

/*
 * The Integrations screens' link to the contract (R56, packages/types/src/admin-integrations):
 * `adminIntegrations` is `api.adminIntegrations` (the API, or the contract mock in mock mode), and
 * the names the screens were written with alias the contract's types. The lists and labels below
 * are the screens' own UI constants (they were in Tumit's mock); the values match the database.
 */
export const adminIntegrations = api.adminIntegrations;

export const CATEGORIES = [
  'PAYMENTS_BILLING',
  'COMMUNICATION',
  'EMAIL',
  'CLOUD_STORAGE',
  'AI_AUTOMATION',
  'MLS_DATA',
  'ESIGN',
  'SECURITY_INFRASTRUCTURE',
  'OTHER',
] as const;
export type IntegrationCategory = (typeof CATEGORIES)[number];
/** The dashboard design's names; Security & Infrastructure as the setup design names it. */
export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  PAYMENTS_BILLING: 'Payments & Billing',
  COMMUNICATION: 'Communication (SMS/Voice)',
  EMAIL: 'Email Delivery',
  CLOUD_STORAGE: 'Cloud & Storage',
  AI_AUTOMATION: 'AI / Automation',
  MLS_DATA: 'MLS / Data',
  ESIGN: 'E-Sign',
  SECURITY_INFRASTRUCTURE: 'Security & Infrastructure',
  OTHER: 'Other',
};

/** docx §11: DRAFT until activated; health moves it among the middle four; REMOVED is final. */
export const INTEGRATION_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'INACTIVE',
  'NEEDS_ATTENTION',
  'ERROR',
  'DISABLED',
  'REMOVED',
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export const STATUS_LABELS: Record<IntegrationStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  NEEDS_ATTENTION: 'Needs Attention',
  ERROR: 'Error',
  DISABLED: 'Disabled',
  REMOVED: 'Removed',
};

export const ENVIRONMENTS = ['LIVE', 'TEST'] as const;
export type IntegrationEnvironment = (typeof ENVIRONMENTS)[number];
export const ENVIRONMENT_LABELS: Record<IntegrationEnvironment, string> = {
  LIVE: 'Live',
  TEST: 'Test',
};

export const AUTH_TYPES = ['API_KEY', 'CLIENT_CREDENTIALS', 'OAUTH', 'ACCOUNT_KEYS'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];
export const AUTH_TYPE_LABELS: Record<AuthType, string> = {
  API_KEY: 'API key',
  CLIENT_CREDENTIALS: 'Client ID and secret',
  OAUTH: 'OAuth connection',
  ACCOUNT_KEYS: 'Account keys',
};

export const SYNC_SCHEDULES = [
  'REALTIME',
  'EVERY_15_MINUTES',
  'HOURLY',
  'DAILY',
  'MANUAL',
] as const;
export type SyncSchedule = (typeof SYNC_SCHEDULES)[number];
export const SYNC_SCHEDULE_LABELS: Record<SyncSchedule, string> = {
  REALTIME: 'Real time (webhooks)',
  EVERY_15_MINUTES: 'Every 15 minutes',
  HOURLY: 'Hourly',
  DAILY: 'Daily',
  MANUAL: 'Manual only',
};
export const DATA_ACCESS = ['READ_ONLY', 'READ_WRITE'] as const;
export type DataAccess = (typeof DATA_ACCESS)[number];
export const DATA_ACCESS_LABELS: Record<DataAccess, string> = {
  READ_ONLY: 'Read only',
  READ_WRITE: 'Read and write',
};
export const BACKOFFS = ['EXPONENTIAL', 'FIXED'] as const;
export type Backoff = (typeof BACKOFFS)[number];
/** docx §4 step 3: whether firms may use this service through the catalog. */
export const FIRM_EXPOSURES = ['PLATFORM_ONLY', 'CATALOG'] as const;
export type FirmExposure = (typeof FIRM_EXPOSURES)[number];
export const FIRM_EXPOSURE_LABELS: Record<FirmExposure, string> = {
  PLATFORM_ONLY: 'Firmivra only (not offered to firms)',
  CATALOG: 'May back a customer catalog entry',
};
/** The wizard's four steps; a draft remembers where it was left. */
export const SETUP_STEPS = ['SERVICE', 'CONNECTION', 'SETTINGS', 'REVIEW'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const RUN_KINDS = ['SYNC', 'TEST'] as const;
export type RunKind = (typeof RUN_KINDS)[number];
export const RUN_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  PARTIAL: 'Partial',
  FAILED: 'Failed',
};

export const LOG_SOURCES = ['PLATFORM_INTEGRATION', 'FIRM_CONNECTION', 'API', 'WEBHOOK'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];
export const LOG_SOURCE_LABELS: Record<LogSource, string> = {
  PLATFORM_INTEGRATION: 'Platform integration',
  FIRM_CONNECTION: 'Firm connection',
  API: 'Firmivra API',
  WEBHOOK: 'Webhook',
};
export const LOG_SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;
export type LogSeverity = (typeof LOG_SEVERITIES)[number];
export const LOG_SEVERITY_LABELS: Record<LogSeverity, string> = {
  INFO: 'Info',
  WARNING: 'Warning',
  ERROR: 'Error',
  CRITICAL: 'Critical',
};
export const LOG_OUTCOMES = ['SUCCESS', 'FAILURE'] as const;
export type LogOutcome = (typeof LOG_OUTCOMES)[number];

export const CATALOG_STATUSES = ['ENABLED', 'DISABLED', 'COMING_SOON'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];
export const CATALOG_STATUS_LABELS: Record<CatalogStatus, string> = {
  ENABLED: 'Enabled',
  DISABLED: 'Disabled',
  COMING_SOON: 'Coming Soon',
};
/** The catalog edit design's Status radio texts (docx §7). */
export const CATALOG_STATUS_HINTS: Record<CatalogStatus, string> = {
  ENABLED: 'Available for customer firms to add and use.',
  DISABLED: 'Not visible to customers.',
  COMING_SOON: 'Visible in catalog with a "Coming Soon" label.',
};
export const PLAN_ACCESS = ['ALL_PLANS', 'SELECTED_PLANS'] as const;
export type PlanAccess = (typeof PLAN_ACCESS)[number];
export const FIRM_ACCESS = ['ALLOW', 'DENY'] as const;
export type FirmAccess = (typeof FIRM_ACCESS)[number];
/** docx §7 Access & Permissions: the optional firm role a connection needs. */
export const REQUIRED_ROLES = ['ANY', 'OWNER_ADMIN', 'OWNER'] as const;
export type RequiredRole = (typeof REQUIRED_ROLES)[number];
export const REQUIRED_ROLE_LABELS: Record<RequiredRole, string> = {
  ANY: 'Any firm user',
  OWNER_ADMIN: 'Owners and admins',
  OWNER: 'Owners only',
};
export const CATALOG_AUTH_TYPES = ['OAUTH', 'API_KEY', 'ACCOUNT_LINK', 'NONE'] as const;
export type CatalogAuthType = (typeof CATALOG_AUTH_TYPES)[number];

export const WEBHOOK_DIRECTIONS = ['OUTBOUND', 'INBOUND'] as const;
export type WebhookDirection = (typeof WEBHOOK_DIRECTIONS)[number];
export const WEBHOOK_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];
export const DELIVERY_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
/** The events an outbound endpoint can subscribe to. */
export const WEBHOOK_EVENTS = [
  'integration.activated',
  'integration.disabled',
  'integration.error',
  'integration.needs_attention',
  'firm.connected',
  'firm.disconnected',
  'subscription.created',
  'subscription.canceled',
  'invoice.paid',
  'invoice.payment_failed',
] as const;

export const API_SCOPES = [
  'firms:read',
  'integrations:read',
  'integrations:write',
  'webhooks:manage',
  'usage:read',
  'logs:read',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'firms:read': 'Read firms',
  'integrations:read': 'Read integrations',
  'integrations:write': 'Change integrations',
  'webhooks:manage': 'Manage webhooks',
  'usage:read': 'Read usage',
  'logs:read': 'Read logs',
};
export type ApiKeyStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';
/** The system-wide ceiling when a key sets no rate limit of its own. */
export const SYSTEM_RATE_LIMIT_PER_MINUTE = 1000;

export const USAGE_SCOPES = ['PLATFORM_INTEGRATION', 'CATALOG', 'API'] as const;
export type UsageScope = (typeof USAGE_SCOPES)[number];
/** Each provider's own unit for `volume` (docx §10: normalize, but keep the provider's units). */
export type VolumeUnit =
  | 'CENTS'
  | 'MESSAGES'
  | 'EMAILS'
  | 'BYTES'
  | 'TOKENS'
  | 'ENVELOPES'
  | 'RECORDS'
  | 'REQUESTS'
  | 'LOOKUPS';
export type MetricUnit = VolumeUnit | 'COUNT' | 'PERCENT' | 'MS';

/** Super Admin roles (`PlatformRole`); docx §12 defaults sensitive actions to Super Admin only. */
export type PlatformRole = 'SUPER_ADMIN' | 'TEAM_MEMBER';
export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  TEAM_MEMBER: 'Team member',
};
export type IntegrationPermission =
  'VIEW' | 'TEST' | 'EDIT' | 'ROTATE_CREDENTIALS' | 'DISABLE_REMOVE';

/** Logo uploads (docx §4): raster only, as the catalog's S3 rule says, up to 2 MB. */
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const LOGO_MAX_BYTES = 2_097_152;
export const NAME_MAX = 80;
export const SHORT_DESCRIPTION_MAX = 250;
export const DESCRIPTION_MAX = 500;

/** The error codes the calls answer with, besides VALIDATION_FAILED, NOT_FOUND and FORBIDDEN. */
export const INTEGRATION_ERRORS = {
  /** A save named an old `version`: someone else saved first (409). */
  CONFLICT: 'CONFLICT',
  /** Another connection (not removed) has this provider and environment (409). */
  DUPLICATE_CONNECTION: 'DUPLICATE_CONNECTION',
  /** Activation needs a passing connection test first (422). */
  TEST_REQUIRED: 'TEST_REQUIRED',
  /** A required connection field is empty (422). */
  CREDENTIALS_REQUIRED: 'CREDENTIALS_REQUIRED',
  /** The action needs an explicit confirmation flag in the body (422). */
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  /** A catalog save removes access from connected firms; resend with `confirmAccessLoss` (409). */
  ACCESS_LOSS: 'ACCESS_LOSS',
  /** The action does not apply in the current status (409). */
  INVALID_STATE: 'INVALID_STATE',
} as const;

// ---------- The contract's types, by the screens' names ----------

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export type ExportFormat = 'CSV';
export type LogoFile = AdminIntegrationLogo;
export type ProviderTemplate = AdminProviderTemplate;
export type ConnectionValue = AdminConnectionValue;
export type PlatformSettings = AdminPlatformSettings;
export type PlatformIntegration = AdminPlatformIntegration;
export type PlatformIntegrationDetail = AdminPlatformIntegrationDetail;
export type AccessRule = AdminPlatformIntegrationDetail['accessControl'][number];
export type PlatformQuery = ListAdminPlatformQuery;
export type UpdatePlatformBody = UpdateAdminPlatformRequest;
export type ConnectionTestResult = AdminConnectionTestResult;
export type PlatformRun = AdminPlatformRun;
export type CatalogFirmRule = AdminCatalogFirmRule;
export type CatalogItem = AdminCatalogItem;
export type UpdateCatalogBody = UpdateAdminCatalogRequest;
export type ApiKey = AdminApiKey;
export type IssuedApiKey = AdminIssuedApiKey;
export type CreateApiKeyBody = CreateAdminApiKeyRequest;
export type WebhookEndpoint = AdminWebhookEndpoint;
export type WebhookWithSecret = AdminWebhookWithSecret;
export type CreateWebhookBody = CreateAdminWebhookRequest;
export type WebhookDelivery = AdminWebhookDelivery;
export type IntegrationLog = AdminIntegrationLog;
export type LogQuery = ListAdminIntegrationLogsQuery;
export type LogRecord = AdminLogRecord;
export type LogExport = AdminExportJob;
/** The export's filters: a JSON body, so its two flags are booleans. */
export type LogExportQuery = NonNullable<ExportAdminLogsRequest['query']>;
export type UsageDay = AdminUsageDay;
export type UsageSubject = AdminUsageSubject;
export type UsageAlert = AdminUsageReport['alerts'][number];
export type UsageReport = AdminUsageReport;
export type IntegrationAccess = AdminIntegrationAccess;
export type IntegrationAuditEntry = AdminIntegrationAuditEntry;
export type PlanOption = AdminPlanOption;
export type FirmOption = AdminFirmOption;
// Contract aliases kept for the screens' imports that name them.
export type { AdminApiKeyStatus, AdminApiScope };

export type CatalogVisibility = 'HIDDEN' | 'VISIBLE' | 'CONNECTABLE';
/**
 * How one firm sees an entry, in B8's order: DISABLED hides it; a firm's DENY hides it; a firm's
 * ALLOW shows it whatever the plan; otherwise the plan access decides (a firm without a plan sees
 * only all-plans entries). COMING_SOON is visible but not connectable.
 */
export function catalogVisibility(
  entry: {
    status: CatalogStatus;
    planAccess: PlanAccess;
    planIds: readonly string[];
    firmRules: readonly { businessId: string; access: FirmAccess }[];
  },
  firm: { id: string; planId: string | null },
): CatalogVisibility {
  if (entry.status === 'DISABLED') return 'HIDDEN';
  const rule = entry.firmRules.find((item) => item.businessId === firm.id);
  const seen =
    rule?.access === 'DENY'
      ? false
      : rule?.access === 'ALLOW'
        ? true
        : entry.planAccess === 'ALL_PLANS' ||
          (firm.planId !== null && entry.planIds.includes(firm.planId));
  if (!seen) return 'HIDDEN';
  return entry.status === 'COMING_SOON' ? 'VISIBLE' : 'CONNECTABLE';
}
