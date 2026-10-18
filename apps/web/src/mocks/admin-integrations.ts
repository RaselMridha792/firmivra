import { ApiRequestError } from '@firmivra/types';
import { mockDelay, mocked, mockedEmpty } from '../lib/mock';
import {
  INTEGRATIONS_ADMIN,
  INTEGRATIONS_ADMIN_IP,
  integrationsUuid,
  providerTemplates,
  seedIntegrationsStore,
} from './admin-integrations-data';

/**
 * Mock data for the Super Admin Integrations module (spec 14, docs/work/R0-stage-b8-integrations.md):
 * the dashboard summary, Firmivra's platform integrations (list, setup wizard draft, manage,
 * lifecycle, credentials, runs), the customer integration catalog (plan and firm access, preview),
 * API keys, webhooks and deliveries, the central integration log, usage and adoption rollups.
 * There is no admin integrations API or contract yet, so the types and the client live here, named
 * after the endpoints in R0-stage-b8 (`/api/v1/admin/integrations/...`); outside mock mode every
 * call fails like an unreachable API. Synthetic data only, built on the first call
 * (admin-integrations-data.ts). Secrets: the mock keeps only masked hints (`sk_live_••••4242`);
 * a full API key or signing secret is returned once, at creation or rotation, and never stored.
 */
const MODULE = 'adminIntegrations';

/** No admin integrations API yet: outside mock mode every call fails like an unreachable API. */
async function ready() {
  await mockDelay();
  if (!mocked(MODULE)) throw new TypeError('Failed to fetch');
}

// ---------- Enums and labels (the schema's, migration 20261017220000_r0_platform_integrations) ----------

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

// ---------- Types ----------

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
/** A logo's metadata: the file itself goes to S3 (platform/integrations/<id>/). */
export interface LogoFile {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/** One connection field of a provider template (docx §4 step 2: fields vary by provider). */
export interface ConnectionField {
  key: string;
  label: string;
  /** Write-only: never returned after save, only a masked hint. */
  secret: boolean;
  required: boolean;
  kind: 'text' | 'url';
  placeholder: string;
  hint: string | null;
  /** Live and test values start differently, so the two never mix. */
  prefix: Record<IntegrationEnvironment, string> | null;
}
export interface ProviderFeature {
  key: string;
  label: string;
  description: string;
}
/** A provider definition (kept in code by the API): what its setup asks for and supports. */
export interface ProviderTemplate {
  key: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  websiteUrl: string | null;
  docsUrl: string | null;
  statusUrl: string | null;
  authType: AuthType;
  fields: ConnectionField[];
  /** False: no test endpoint, so activation needs the admin's explicit confirmation. */
  supportsTest: boolean;
  supportsOAuth: boolean;
  /** False: the provider reports no uptime, so the screens show N/A. */
  supportsUptime: boolean;
  scopes: string[];
  /** Least privilege (docx §4 step 3). */
  defaultScopes: string[];
  features: ProviderFeature[];
  /** The path Firmivra receives this provider's webhooks on, if it sends any. */
  webhookPath: string | null;
  volumeUnit: VolumeUnit;
  /** "Total Processed", "Messages Sent". */
  volumeLabel: string;
  /** "Transactions", "API Calls". */
  requestLabel: string;
}

export interface ConnectionValue extends ConnectionField {
  /** Non-secret: the value. Secret: a masked hint (`sk_live_••••4242`). Null: not set yet. */
  display: string | null;
  updatedAt: string | null;
}
export interface PlatformConnection {
  authType: AuthType;
  fields: ConnectionValue[];
  /** Where the provider sends its webhooks to Firmivra, if it sends any. */
  webhookUrl: string | null;
  /** OAuth providers only. */
  oauth: { connected: boolean; account: string | null; connectedAt: string | null } | null;
  secretRotatedAt: string | null;
  /** Every required field is set. */
  complete: boolean;
}
export interface PlatformSettings {
  scopes: string[];
  syncSchedule: SyncSchedule;
  /** Enabled feature keys (the template's `features`). */
  features: string[];
  dataAccess: DataAccess;
  retry: { maxRetries: number; backoff: Backoff };
  firmExposure: FirmExposure;
}
/** Why it needs attention or failed, with the recommended action (docx §11). */
export interface StatusReason {
  code: string;
  message: string;
  recommendedAction: string;
}
export interface IntegrationError {
  code: string;
  /** "Connection failed": the short form the list shows. */
  title: string;
  message: string;
  at: string;
  logId: string | null;
  requestId: string | null;
}

export interface PlatformIntegration {
  id: string;
  /** The readable id the manage page shows ("int_001"). */
  reference: string;
  /** The provider key in the code catalog ("stripe"); `custom_<name>` without a template. */
  provider: string;
  name: string;
  category: IntegrationCategory;
  /** The short purpose, up to 250 characters. */
  description: string;
  /** Optional, up to 500 characters. */
  longDescription: string | null;
  logo: LogoFile | null;
  websiteUrl: string | null;
  docsUrl: string | null;
  statusUrl: string | null;
  environment: IntegrationEnvironment;
  status: IntegrationStatus;
  statusReason: StatusReason | null;
  connection: PlatformConnection;
  settings: PlatformSettings;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckMessage: string | null;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  /** Percent over the last 30 days; null is N/A (the provider reports none, or no data yet). */
  uptime30d: number | null;
  supportsTest: boolean;
  supportsUptime: boolean;
  /** Critical infrastructure: removal needs the name typed (docx §5, §12). */
  critical: boolean;
  activatedWithoutTest: boolean;
  activatedAt: string | null;
  disabledAt: string | null;
  removedAt: string | null;
  /** Drafts only: the wizard step it was left on. */
  setupStep: SetupStep;
  latestError: IntegrationError | null;
  /** The dashboard's order. */
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}
export interface UsageHighlight {
  key: string;
  label: string;
  /** Null is N/A. */
  value: number | null;
  unit: MetricUnit;
}
export interface AccessRule {
  permission: IntegrationPermission;
  label: string;
  description: string;
  roles: PlatformRole[];
  /** Fixed by policy (Super Admin only). */
  locked: boolean;
}
export interface PlatformIntegrationDetail extends PlatformIntegration {
  /** What depends on it: warn before disabling or removing (docx §5). */
  dependents: {
    catalog: { id: string; name: string; status: CatalogStatus }[];
    webhooks: { id: string; url: string }[];
  };
  /** The last 30 days in the provider's own units (the Usage card). */
  highlights: UsageHighlight[];
  accessControl: AccessRule[];
}
export interface PlatformQuery {
  /** Name, provider, description or reference. */
  search?: string;
  category?: IntegrationCategory;
  /** One status or several (the KPI cards filter by Needs Attention and Error together). */
  status?: IntegrationStatus | IntegrationStatus[];
  environment?: IntegrationEnvironment;
  /** Removed tombstones are left out unless asked for (or `status` names REMOVED). */
  includeRemoved?: boolean;
  sort?: 'order' | 'name' | 'category' | 'status' | 'lastSync';
  descending?: boolean;
  page?: number;
  pageSize?: number;
}
export interface CreatePlatformBody {
  /** A key from `providers()`; without it the name picks the template (or a custom one). */
  provider?: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  longDescription?: string | null;
  logo?: LogoFile | null;
  websiteUrl?: string | null;
  docsUrl?: string | null;
  /** Test unless chosen (least privilege, docx §4). */
  environment?: IntegrationEnvironment;
}
export interface UpdatePlatformBody {
  /** The version read: a stale one is refused with 409 CONFLICT. */
  version: number;
  name?: string;
  category?: IntegrationCategory;
  description?: string;
  longDescription?: string | null;
  logo?: LogoFile | null;
  websiteUrl?: string | null;
  docsUrl?: string | null;
  /** On a configured integration it clears the credentials (live and test never mix). */
  environment?: IntegrationEnvironment;
  /** Needed with an environment change once the integration has credentials. */
  confirmEnvironmentChange?: boolean;
  /** Non-secret connection fields only (base URL, account ID); secrets go to `putCredentials`. */
  connection?: Record<string, string>;
  settings?: Partial<PlatformSettings>;
  setupStep?: SetupStep;
}
export interface ConnectionTestResult {
  ok: boolean;
  /** Tells a provider outage from bad credentials (docx §14). */
  kind: 'OK' | 'INVALID_CREDENTIALS' | 'PROVIDER_UNAVAILABLE' | 'MISSING_CONFIGURATION';
  at: string;
  latencyMs: number | null;
  /** Safe to show: never a secret. */
  message: string;
  errorCode: string | null;
  requestId: string;
  runId: string;
  logId: string;
  integration: PlatformIntegrationDetail;
}
export interface PlatformRun {
  id: string;
  integrationId: string;
  kind: RunKind;
  status: RunStatus;
  trigger: 'SCHEDULE' | 'MANUAL';
  requestedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  objectCount: number;
  failedCount: number;
  retries: number;
  errorCode: string | null;
  errorMessage: string | null;
  correlationId: string;
  /** The log record the run wrote (drill-down, docx §5). */
  logId: string | null;
}

export interface CatalogSetupField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help: string | null;
}
/** The customer connection experience (docx §7 Customer Setup); never Super Admin secrets. */
export interface CatalogSetup {
  authType: CatalogAuthType;
  instructions: string;
  requiredFields: CatalogSetupField[];
  helpText: string | null;
  /** Run a connection test when a firm connects. */
  testOnConnect: boolean;
}
export interface CatalogAdvanced {
  featureFlag: string | null;
  beta: boolean;
  deprecationNotice: string | null;
  minAppVersion: string | null;
  /** 0 to 100. */
  rolloutPercent: number;
  /** Two-letter US state codes it is limited to; empty is everywhere. */
  regions: string[];
}
export interface CatalogFirmRule {
  businessId: string;
  firmName: string;
  planName: string;
  access: FirmAccess;
  reason: string | null;
  updatedAt: string;
  updatedBy: string;
}
/** Adoption from the daily rollup (cross-firm counts only, never a firm's own connection). */
export interface CatalogStats {
  /** Firms connected now ("Customers Using"). */
  firmsUsing: number;
  /** Connected firms that used it in the last 30 days. */
  activeFirms: number;
  /** Every connect a firm ever made. */
  totalConnections: number;
  connects30d: number;
  disconnects30d: number;
  lastActivityAt: string | null;
  /** The platform integration's uptime, when the entry relies on one. */
  uptime30d: number | null;
}
export interface CatalogItem {
  id: string;
  /** Never changes; matches the firms' `integration_connections.provider`. */
  provider: string;
  name: string;
  category: IntegrationCategory;
  shortDescription: string;
  /** Rich text (HTML, sanitized by the API), up to 500 characters of text. */
  description: string | null;
  logo: LogoFile | null;
  websiteUrl: string | null;
  helpUrl: string | null;
  /** A shorter label for the catalog card, if the name is long (Display & Branding). */
  displayLabel: string | null;
  status: CatalogStatus;
  planAccess: PlanAccess;
  /** The plans a SELECTED_PLANS entry is on. */
  plans: { id: string; name: string }[];
  firmRules: CatalogFirmRule[];
  requiredRole: RequiredRole;
  setup: CatalogSetup;
  badges: string[];
  sortOrder: number;
  advanced: CatalogAdvanced;
  /** The Firmivra service it relies on (Firmivra's own Stripe account), if any. */
  platformIntegration: {
    id: string;
    name: string;
    status: IntegrationStatus;
    environment: IntegrationEnvironment;
    lastCheckAt: string | null;
    lastCheckOk: boolean | null;
  } | null;
  stats: CatalogStats;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}
export interface CatalogQuery {
  search?: string;
  status?: CatalogStatus;
  /** A plan id: entries that plan can see (all plans, or listed). */
  plan?: string;
  category?: IntegrationCategory;
  sort?: 'order' | 'name' | 'category' | 'customers' | 'status';
  descending?: boolean;
  page?: number;
  pageSize?: number;
}
export interface CreateCatalogBody {
  provider: string;
  name: string;
  category: IntegrationCategory;
  shortDescription: string;
  description?: string | null;
  websiteUrl?: string | null;
  helpUrl?: string | null;
  platformIntegrationId?: string | null;
}
export interface UpdateCatalogBody {
  version: number;
  name?: string;
  category?: IntegrationCategory;
  shortDescription?: string;
  description?: string | null;
  logo?: LogoFile | null;
  websiteUrl?: string | null;
  helpUrl?: string | null;
  displayLabel?: string | null;
  status?: CatalogStatus;
  planAccess?: PlanAccess;
  planIds?: string[];
  requiredRole?: RequiredRole;
  setup?: Partial<CatalogSetup>;
  badges?: string[];
  sortOrder?: number;
  advanced?: Partial<CatalogAdvanced>;
  platformIntegrationId?: string | null;
  /** Save even though connected firms lose access (after the warning, docx §7). */
  confirmAccessLoss?: boolean;
}
/** How a firm sees the entry: never live customer data (docx §7, View in Catalog). */
export interface CatalogPreview {
  id: string;
  name: string;
  category: IntegrationCategory;
  shortDescription: string;
  description: string | null;
  logo: LogoFile | null;
  badges: string[];
  status: CatalogStatus;
  /** Hidden from firms (DISABLED). */
  hidden: boolean;
  connectable: boolean;
  /** "Connect", "Coming Soon" or "Not available". */
  connectLabel: string;
  setup: CatalogSetup;
  websiteUrl: string | null;
  helpUrl: string | null;
  deprecationNotice: string | null;
}
/** How one firm sees an entry, in the documented order (R0-stage-b8, "Who sees and can connect"). */
export type CatalogVisibility = 'HIDDEN' | 'VISIBLE' | 'CONNECTABLE';

export interface ApiKey {
  id: string;
  name: string;
  /** `fv_live_…` or `fv_test_…`: names the environment. */
  prefix: string;
  lastFour: string;
  scopes: ApiScope[];
  environment: IntegrationEnvironment;
  /** Null: the system ceiling (`SYSTEM_RATE_LIMIT_PER_MINUTE`). */
  rateLimitPerMinute: number | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  rotatedFromId: string | null;
  rotatedToId: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
  createdBy: string;
  status: ApiKeyStatus;
  /** The last 24 hours, against the rate limit (docx §8 Rate limits / usage). */
  usage24h: { requests: number; peakPerMinute: number; rateLimited: number };
}
export interface IssuedApiKey {
  key: ApiKey;
  /** The full key: shown once, here. The mock keeps only its prefix and last four. */
  secret: string;
}
export interface CreateApiKeyBody {
  name: string;
  environment: IntegrationEnvironment;
  scopes: ApiScope[];
  rateLimitPerMinute?: number | null;
  /** ISO; null or left out: never expires. */
  expiresAt?: string | null;
}

export interface WebhookEndpoint {
  id: string;
  direction: WebhookDirection;
  /** https only. */
  url: string;
  description: string | null;
  events: string[];
  status: WebhookStatus;
  maxRetries: number;
  /** `whsec_••••91c2`; null when none is set. */
  signingSecretHint: string | null;
  secretRotatedAt: string | null;
  /** Inbound endpoints: the platform integration whose provider calls it. */
  integration: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  stats: {
    deliveries7d: number;
    failures7d: number;
    lastDeliveryAt: string | null;
    lastStatus: DeliveryStatus | null;
  };
}
export interface WebhookWithSecret {
  endpoint: WebhookEndpoint;
  /** Shown once, at creation or rotation; null otherwise. */
  signingSecret: string | null;
}
export interface CreateWebhookBody {
  direction: WebhookDirection;
  url: string;
  description?: string | null;
  events: string[];
  maxRetries?: number;
  integrationId?: string | null;
}
export interface UpdateWebhookBody {
  url?: string;
  description?: string | null;
  events?: string[];
  status?: WebhookStatus;
  maxRetries?: number;
  /** Issue a new signing secret (Super Admin only); it is returned once. */
  rotateSecret?: boolean;
}
export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventType: string;
  /** The receiver stays idempotent on it. */
  eventId: string;
  attempt: number;
  redeliveryOfId: string | null;
  status: DeliveryStatus;
  responseStatusCode: number | null;
  durationMs: number | null;
  requestId: string;
  errorCode: string | null;
  /** Automatic retries before this result. */
  retries: number;
  requestedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** The payload with sensitive fields redacted (docx §8). */
  payload: string;
  /** Outbound, finished, on an active endpoint. */
  canRedeliver: boolean;
}

export interface LogDetailRow {
  label: string;
  value: string;
}
/** A contextual next step for an error (docx §9 Error resolution link). */
export interface LogResolution {
  action:
    | 'RECONNECT'
    | 'UPDATE_CREDENTIAL'
    | 'RETRY_SYNC'
    | 'VIEW_PROVIDER_STATUS'
    | 'VIEW_INTEGRATION'
    | 'VIEW_WEBHOOK';
  label: string;
  /** An admin path, or the provider's status page. */
  href: string | null;
}
export interface IntegrationLog {
  id: string;
  at: string;
  source: LogSource;
  integrationId: string | null;
  integrationName: string | null;
  provider: string | null;
  environment: IntegrationEnvironment | null;
  severity: LogSeverity;
  /** The taxonomy name, e.g. `sync.completed`. */
  eventType: string;
  /** "Synchronization completed". */
  action: string;
  succeeded: boolean;
  errorCode: string | null;
  /** One line: "Stripe synchronization completed". */
  message: string;
  /** Redacted: never secrets, tokens or record content. */
  details: LogDetailRow[];
  requestId: string | null;
  correlationId: string | null;
  /** The firm a firm-connection event concerns. */
  firm: { id: string; name: string } | null;
  actor: { type: 'USER' | 'SYSTEM' | 'PROVIDER'; id: string | null; name: string };
  /** The endpoint or event called. */
  endpoint: string | null;
  resolution: LogResolution | null;
}
export interface LogQuery {
  /** Message, integration, request or correlation id, firm. */
  search?: string;
  integrationId?: string;
  /** Only events of platform integrations (the dashboard's Integration Activity). */
  platformOnly?: boolean;
  source?: LogSource;
  severity?: LogSeverity;
  eventType?: string;
  environment?: IntegrationEnvironment;
  outcome?: LogOutcome;
  /** A request or correlation id, exact. */
  requestId?: string;
  firmId?: string;
  /** ISO moments, inclusive. */
  from?: string;
  to?: string;
  /** Newest first unless false. */
  descending?: boolean;
  page?: number;
  pageSize?: number;
}
export interface LogFacets {
  integrations: { id: string; name: string }[];
  eventTypes: string[];
  firms: { id: string; name: string }[];
}
export interface LogRecord {
  log: IntegrationLog;
  /** The other events with the same correlation id. */
  related: IntegrationLog[];
  /** The affected integration now; null when there is none or it no longer exists. */
  integration: { id: string; name: string; status: IntegrationStatus } | null;
  /** The newer and the older record in the log's default order. */
  previousId: string | null;
  nextId: string | null;
}
export type ExportFormat = 'CSV' | 'JSON';
export interface LogExport {
  jobId: string;
  fileName: string;
  mimeType: string;
  content: string;
  rowCount: number;
  expiresAt: string;
}

/** One day of the rollup. Null: the provider does not report it. */
export interface UsageDay {
  day: string;
  requests: number;
  successes: number;
  failures: number;
  avgLatencyMs: number | null;
  volume: number | null;
  costCents: number | null;
  connectedFirms: number | null;
  activeFirms: number | null;
  connects: number | null;
  disconnects: number | null;
}
export interface UsageTotals {
  requests: number;
  successes: number;
  failures: number;
  /** Percent; null with no requests. */
  successRate: number | null;
  avgLatencyMs: number | null;
  /** Null when the subjects use different units. */
  volume: number | null;
  costCents: number | null;
  /** The last day's counts. */
  connectedFirms: number | null;
  activeFirms: number | null;
  connects: number | null;
  disconnects: number | null;
}
export interface UsageSubject extends UsageTotals {
  key: string;
  name: string;
  category: IntegrationCategory | null;
  volumeUnit: VolumeUnit | null;
  volumeLabel: string | null;
  requestLabel: string | null;
}
export interface UsageAlert {
  subjectKey: string;
  subjectName: string;
  kind: 'ERROR_RATE' | 'LATENCY' | 'COST' | 'SYNC_FAILURES' | 'QUOTA';
  value: number;
  threshold: number;
  message: string;
}
export interface UsageQuery {
  /** PLATFORM_INTEGRATION unless chosen. */
  scope?: UsageScope;
  /** An integration id, a catalog provider key or an API key id; all of the scope when left out. */
  subject?: string;
  /** `YYYY-MM-DD` (UTC days), inclusive; the last 30 days by default (docx §10). */
  from?: string;
  to?: string;
}
export interface UsageReport {
  scope: UsageScope;
  subject: string | null;
  from: string;
  to: string;
  series: UsageDay[];
  totals: UsageTotals;
  subjects: UsageSubject[];
  /** CATALOG: connected firms by plan on the last day. */
  planDistribution: { planId: string; planName: string; firms: number }[];
  /** Subjects over a threshold in the range (deduplicated per subject and kind). */
  alerts: UsageAlert[];
}
/** Optional alert thresholds (docx §10); null turns one off. */
export interface UsageThresholds {
  version: number;
  errorRatePercent: number | null;
  latencyMs: number | null;
  quotaPercent: number | null;
  monthlyCostCents: number | null;
  syncFailures: number | null;
  updatedAt: string;
  updatedBy: string;
}
export type SaveThresholdsBody = Omit<UsageThresholds, 'updatedAt' | 'updatedBy'>;

export interface IntegrationSummary {
  /** Platform integrations (not removed) plus catalog entries: "Platform + Customer". */
  total: number;
  platformTotal: number;
  active: number;
  inactive: number;
  needsAttention: number;
  errors: number;
  disabled: number;
  drafts: number;
  /** Average 30-day uptime of the running platform integrations that report one. */
  uptime30d: number | null;
  catalog: {
    total: number;
    enabled: number;
    disabled: number;
    comingSoon: number;
    /** Entries added this calendar month. */
    addedThisMonth: number;
  };
}

/** What the signed-in admin may do here (docx §12); the mock signs in a Super Admin. */
export interface IntegrationAccess {
  role: PlatformRole;
  canView: boolean;
  canManageConfiguration: boolean;
  /** Credentials, API keys, signing secrets. */
  canManageSecrets: boolean;
  /** Disable, enable, remove. */
  canLifecycle: boolean;
}
export interface IntegrationAuditEntry {
  id: string;
  at: string;
  actor: { id: string; name: string; role: string };
  /** `integration.disabled`, `credentials.rotated`... */
  action: string;
  label: string;
  /** SECURITY for credentials and keys, INTEGRATION otherwise (R0-stage-b8, Audit). */
  category: 'INTEGRATION' | 'SECURITY';
  target: {
    type: 'PLATFORM_INTEGRATION' | 'CATALOG_ITEM' | 'API_KEY' | 'WEBHOOK' | 'LOG_EXPORT' | 'USAGE';
    id: string;
    name: string;
  };
  /** Old and new non-secret values; a secret shows only as "changed". */
  changes: { field: string; before: string | null; after: string | null }[];
  result: 'SUCCESS' | 'FAILED';
  ip: string;
}
export interface PlanOption {
  id: string;
  code: string;
  name: string;
}
export interface FirmOption {
  id: string;
  name: string;
  planId: string;
  planName: string;
}

// ---------- The store: built on first use, changed by the calls below while the page is open ----------

export interface CatalogRecord extends Omit<
  CatalogItem,
  'plans' | 'firmRules' | 'platformIntegration' | 'stats'
> {
  planIds: string[];
  firmRules: Omit<CatalogFirmRule, 'firmName' | 'planName'>[];
  platformIntegrationId: string | null;
  /** The firms connected now (the rollup counts them; the screens never list them). */
  connectedFirmIds: string[];
  activeFirmIds: string[];
  totalConnections: number;
  lastActivityAt: string | null;
}
export interface ApiKeyRecord extends Omit<ApiKey, 'status' | 'usage24h'> {
  /** A stand-in for the SHA-256 hash: never the key. */
  keyHash: string;
  usage24h: ApiKey['usage24h'];
}
export interface WebhookRecord extends Omit<WebhookEndpoint, 'integration' | 'stats'> {
  integrationId: string | null;
}
export interface UsageRow extends UsageDay {
  scope: UsageScope;
  subjectKey: string;
}
export interface IntegrationsStore {
  platform: PlatformIntegration[];
  runs: PlatformRun[];
  logs: IntegrationLog[];
  catalog: CatalogRecord[];
  apiKeys: ApiKeyRecord[];
  webhooks: WebhookRecord[];
  deliveries: WebhookDelivery[];
  usage: UsageRow[];
  audit: IntegrationAuditEntry[];
  thresholds: UsageThresholds;
  plans: PlanOption[];
  firms: { id: string; name: string; planId: string }[];
  /** Integration ids whose saved credentials the provider rejects (a test fails). */
  rejected: string[];
  /** Integration ids whose provider is down (a test fails with PROVIDER_UNAVAILABLE). */
  outages: string[];
  /** The next number for new records. */
  next: number;
}
let store: IntegrationsStore | undefined;
const db = (): IntegrationsStore => (store ??= seedIntegrationsStore(mockedEmpty(MODULE)));

/** The signed-in admin's role. The mock signs in a Super Admin (Morgan Admin). */
const VIEWER_ROLE: PlatformRole = 'SUPER_ADMIN';

const invalid = (message: string) => new ApiRequestError(400, 'VALIDATION_FAILED', message);
const notFound = (what: string) => new ApiRequestError(404, 'NOT_FOUND', `${what} not found`);
const conflict = (code: string, message: string) => new ApiRequestError(409, code, message);
const unprocessable = (code: string, message: string) => new ApiRequestError(422, code, message);
const copy = <T>(value: T): T => structuredClone(value);
const time = (iso: string) => Date.parse(iso);
const nowIso = () => new Date().toISOString();
const DAY_MS = 86_400_000;
const uuid = (s: IntegrationsStore, block: string) => integrationsUuid(block, s.next++);
const requestId = (s: IntegrationsStore) => `req_${(s.next * 7919).toString(36).toUpperCase()}`;
const correlationId = (s: IntegrationsStore) => `corr_${(s.next * 104_729).toString(36)}`;

function requireSuperAdmin(action: string) {
  if (VIEWER_ROLE !== 'SUPER_ADMIN')
    throw new ApiRequestError(403, 'FORBIDDEN', `Only a Super Admin can ${action}.`);
}

/** Trimmed text with control characters removed; `max` characters at most. */
function cleanText(value: string, label: string, max: number, required: boolean): string {
  const text = value.replace(/[\p{Cc}\p{Cs}]/gu, ' ').trim();
  if (required && !text) throw invalid(`Enter the ${label}.`);
  if (text.length > max) throw invalid(`Keep the ${label} to ${max} characters.`);
  return text;
}
const optionalText = (value: string | null | undefined, label: string, max: number) =>
  value == null ? null : cleanText(value, label, max, false) || null;

/** An https address, or null (docx §4: sanitize URLs). */
export function cleanUrl(value: string | null | undefined, label: string): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalid(`Enter the ${label} as a full address (https://…).`);
  }
  if (url.protocol !== 'https:') throw invalid(`The ${label} must start with https://.`);
  if (url.username || url.password) throw invalid(`The ${label} cannot contain a user name.`);
  return url.toString();
}
function checkLogo(logo: LogoFile | null | undefined): LogoFile | null {
  if (!logo) return null;
  if (!LOGO_TYPES.some((type) => type === logo.contentType))
    throw invalid('Upload the logo as PNG, JPEG or WebP.');
  if (logo.sizeBytes <= 0 || logo.sizeBytes > LOGO_MAX_BYTES)
    throw invalid('The logo must be 2 MB or smaller.');
  return { ...logo, fileName: cleanText(logo.fileName, 'file name', 200, true) };
}
const category = (value: string): IntegrationCategory => {
  const found = CATEGORIES.find((item) => item === value);
  if (!found) throw invalid('Choose a category.');
  return found;
};

function pageOf<T>(rows: T[], page = 1, pageSize = 10): Page<T> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw invalid('Choose a page size from 1 to 100.');
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
  return copy({
    items: rows.slice((current - 1) * pageSize, current * pageSize),
    total: rows.length,
    page: current,
    pageSize,
  });
}
function cleanSearch(value: string | undefined) {
  const search = (value ?? '')
    .replace(/[\p{Cc}\p{Cs}]/gu, ' ')
    .trim()
    .toLowerCase();
  if (search.length > 100) throw invalid('Search is limited to 100 characters.');
  return search;
}
interface Range {
  from: number | null;
  to: number | null;
}
function parseRange(from?: string, to?: string): Range {
  const start = from ? time(from) : null;
  const end = to ? time(to) : null;
  if (start !== null && Number.isNaN(start)) throw invalid('Choose a valid start date.');
  if (end !== null && Number.isNaN(end)) throw invalid('Choose a valid end date.');
  if (start !== null && end !== null && start > end)
    throw invalid('The start date must be on or before the end date.');
  return { from: start, to: end };
}
const within = (range: Range, at: number) =>
  (range.from === null || at >= range.from) && (range.to === null || at <= range.to);

// ---------- Audit and log records ----------

type AuditFields = Pick<IntegrationAuditEntry, 'action' | 'label' | 'category' | 'target'> &
  Partial<Pick<IntegrationAuditEntry, 'changes' | 'result'>>;
/** Every sensitive change writes one entry, never with a secret (docx §12). */
function audit(s: IntegrationsStore, fields: AuditFields): IntegrationAuditEntry {
  const entry: IntegrationAuditEntry = {
    id: uuid(s, '1a08'),
    at: nowIso(),
    actor: { id: INTEGRATIONS_ADMIN.id, name: INTEGRATIONS_ADMIN.name, role: 'Super Admin' },
    changes: [],
    result: 'SUCCESS',
    ip: INTEGRATIONS_ADMIN_IP,
    ...fields,
  };
  s.audit.push(entry);
  return entry;
}

type LogFields = Pick<
  IntegrationLog,
  'eventType' | 'action' | 'message' | 'severity' | 'succeeded'
> &
  Partial<Omit<IntegrationLog, 'id' | 'at'>>;
/** A log record by the signed-in admin about one integration (or none). */
function writeLog(
  s: IntegrationsStore,
  integration: PlatformIntegration | null,
  fields: LogFields,
): IntegrationLog {
  const entry: IntegrationLog = {
    id: uuid(s, '1a03'),
    at: nowIso(),
    source: 'PLATFORM_INTEGRATION',
    integrationId: integration?.id ?? null,
    integrationName: integration?.name ?? null,
    provider: integration?.provider ?? null,
    environment: integration?.environment ?? null,
    errorCode: null,
    details: [],
    requestId: requestId(s),
    correlationId: correlationId(s),
    firm: null,
    actor: { type: 'USER', id: INTEGRATIONS_ADMIN.id, name: INTEGRATIONS_ADMIN.name },
    endpoint: null,
    resolution: null,
    ...fields,
  };
  s.logs.push(entry);
  return entry;
}

const target = (integration: PlatformIntegration) => ({
  type: 'PLATFORM_INTEGRATION' as const,
  id: integration.id,
  name: integration.name,
});

// ---------- Platform integrations ----------

const STATUS_RANK: Record<IntegrationStatus, number> = {
  ERROR: 0,
  NEEDS_ATTENTION: 1,
  ACTIVE: 2,
  INACTIVE: 3,
  DISABLED: 4,
  DRAFT: 5,
  REMOVED: 6,
};
const CATEGORY_RANK = (value: IntegrationCategory) => CATEGORIES.indexOf(value);

/** A provider's template; `custom_…` and unknown keys use the generic one. */
export function templateFor(provider: string): ProviderTemplate {
  const templates = providerTemplates();
  const found = templates.find((item) => item.key === provider);
  if (found) return found;
  const custom = templates.find((item) => item.key === 'custom');
  if (!custom) throw new Error('The custom provider template is missing.');
  return custom;
}
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);

/** Who may do what (docx §12); sensitive actions are Super Admin only, by policy. */
function accessControl(): AccessRule[] {
  return [
    {
      permission: 'VIEW',
      label: 'View integration',
      description: 'See status, metadata, non-sensitive logs and usage.',
      roles: ['SUPER_ADMIN', 'TEAM_MEMBER'],
      locked: false,
    },
    {
      permission: 'TEST',
      label: 'Test connection',
      description: 'Run a safe provider check and record the result.',
      roles: ['SUPER_ADMIN'],
      locked: false,
    },
    {
      permission: 'EDIT',
      label: 'Edit configuration',
      description: 'Change metadata, endpoints, schedules and enabled features.',
      roles: ['SUPER_ADMIN'],
      locked: false,
    },
    {
      permission: 'ROTATE_CREDENTIALS',
      label: 'Rotate credentials',
      description: 'Create, rotate or revoke credentials (re-authentication when supported).',
      roles: ['SUPER_ADMIN'],
      locked: true,
    },
    {
      permission: 'DISABLE_REMOVE',
      label: 'Disable or remove',
      description: 'Stop or permanently remove the service, after an impact confirmation.',
      roles: ['SUPER_ADMIN'],
      locked: true,
    },
  ];
}

function usageRows(s: IntegrationsStore, scope: UsageScope, subject: string, days = 30) {
  const since = Date.now() - days * DAY_MS;
  return s.usage.filter(
    (row) =>
      row.scope === scope && row.subjectKey === subject && time(`${row.day}T23:59:59Z`) >= since,
  );
}

/** The Usage card's numbers, in the provider's units (null where it reports none). */
function highlightsOf(s: IntegrationsStore, integration: PlatformIntegration): UsageHighlight[] {
  const template = templateFor(integration.provider);
  const rows = usageRows(s, 'PLATFORM_INTEGRATION', integration.id);
  const sum = (pick: (row: UsageRow) => number | null) =>
    rows.length ? rows.reduce((total, row) => total + (pick(row) ?? 0), 0) : null;
  const requests = sum((row) => row.requests);
  const successes = sum((row) => row.successes);
  const list: UsageHighlight[] = [
    { key: 'requests', label: template.requestLabel, value: requests, unit: 'COUNT' },
    {
      key: 'volume',
      label: template.volumeLabel,
      value: sum((row) => row.volume),
      unit: template.volumeUnit,
    },
    {
      key: 'successRate',
      label: 'Success Rate',
      value: requests ? Math.round(((successes ?? 0) / requests) * 10_000) / 100 : null,
      unit: 'PERCENT',
    },
  ];
  if (integration.provider === 'stripe')
    list.push({
      key: 'activeSubscriptions',
      label: 'Active Subscriptions',
      value: rows.length ? 26 : null,
      unit: 'COUNT',
    });
  return list;
}

function detailOf(
  s: IntegrationsStore,
  integration: PlatformIntegration,
): PlatformIntegrationDetail {
  return copy({
    ...integration,
    dependents: {
      catalog: s.catalog
        .filter((item) => item.platformIntegrationId === integration.id)
        .map((item) => ({ id: item.id, name: item.name, status: item.status })),
      webhooks: s.webhooks
        .filter((hook) => hook.integrationId === integration.id)
        .map((hook) => ({ id: hook.id, url: hook.url })),
    },
    highlights: highlightsOf(s, integration),
    accessControl: accessControl(),
  });
}

function findPlatform(s: IntegrationsStore, id: string): PlatformIntegration {
  const found = s.platform.find((item) => item.id === id);
  if (!found) throw notFound('Integration');
  return found;
}
function liveOne(s: IntegrationsStore, id: string): PlatformIntegration {
  const found = findPlatform(s, id);
  if (found.status === 'REMOVED')
    throw conflict(INTEGRATION_ERRORS.INVALID_STATE, 'This integration was removed.');
  return found;
}
/** One connection (not removed) per provider and environment. */
function checkDuplicate(
  s: IntegrationsStore,
  provider: string,
  environment: IntegrationEnvironment,
  except: string | null,
) {
  const other = s.platform.find(
    (item) =>
      item.id !== except &&
      item.status !== 'REMOVED' &&
      item.provider === provider &&
      item.environment === environment,
  );
  if (other)
    throw conflict(
      INTEGRATION_ERRORS.DUPLICATE_CONNECTION,
      `${other.name} already has a ${ENVIRONMENT_LABELS[environment]} connection.`,
    );
}
const connectionComplete = (connection: PlatformConnection) =>
  connection.fields.every((field) => !field.required || field.display !== null) &&
  (connection.oauth === null || connection.oauth.connected);

function bump(integration: PlatformIntegration) {
  integration.version += 1;
  integration.updatedAt = nowIso();
  integration.updatedBy = INTEGRATIONS_ADMIN.name;
}

/** A fresh connection for a template: nothing set (environment changes clear it too). */
export function emptyConnection(
  template: ProviderTemplate,
  environment: IntegrationEnvironment,
): PlatformConnection {
  return {
    authType: template.authType,
    fields: template.fields.map((field) => ({ ...field, display: null, updatedAt: null })),
    webhookUrl: template.webhookPath
      ? `https://api.firmivra.example.test${template.webhookPath}${environment === 'TEST' ? '/test' : ''}`
      : null,
    oauth: template.supportsOAuth ? { connected: false, account: null, connectedAt: null } : null,
    secretRotatedAt: null,
    complete: false,
  };
}

const maskSecret = (value: string, prefix: string | null) =>
  `${prefix && value.startsWith(prefix) ? prefix : ''}••••${value.slice(-4)}`;

function filterPlatform(s: IntegrationsStore, query: PlatformQuery) {
  const search = cleanSearch(query.search);
  const statuses = query.status === undefined ? null : [query.status].flat();
  return s.platform.filter((item) => {
    if (item.status === 'REMOVED' && !query.includeRemoved && !statuses?.includes('REMOVED'))
      return false;
    if (statuses && !statuses.includes(item.status)) return false;
    if (query.category && item.category !== query.category) return false;
    if (query.environment && item.environment !== query.environment) return false;
    if (!search) return true;
    return [item.name, item.provider, item.description, item.reference].some((text) =>
      text.toLowerCase().includes(search),
    );
  });
}
function sortPlatform(rows: PlatformIntegration[], query: PlatformQuery) {
  const by = query.sort ?? 'order';
  const sign = query.descending ? -1 : 1;
  const key = (item: PlatformIntegration): string | number =>
    by === 'name'
      ? item.name.toLowerCase()
      : by === 'category'
        ? CATEGORY_RANK(item.category)
        : by === 'status'
          ? STATUS_RANK[item.status]
          : by === 'lastSync'
            ? item.lastSyncAt
              ? time(item.lastSyncAt)
              : 0
            : item.sortOrder;
  return [...rows].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    const compared =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
    return compared * sign || a.sortOrder - b.sortOrder;
  });
}

function testOutcome(
  s: IntegrationsStore,
  integration: PlatformIntegration,
): Pick<ConnectionTestResult, 'ok' | 'kind' | 'latencyMs' | 'message' | 'errorCode'> {
  if (!integration.connection.complete)
    return {
      ok: false,
      kind: 'MISSING_CONFIGURATION',
      latencyMs: null,
      message: 'Enter every required connection field before testing.',
      errorCode: 'MISSING_CONFIGURATION',
    };
  if (s.outages.includes(integration.id))
    return {
      ok: false,
      kind: 'PROVIDER_UNAVAILABLE',
      latencyMs: 30_000,
      message: `${integration.name} did not answer (503 Service Unavailable). Your credentials were not checked; try again later or view the provider's status.`,
      errorCode: 'PROVIDER_UNAVAILABLE',
    };
  if (s.rejected.includes(integration.id))
    return {
      ok: false,
      kind: 'INVALID_CREDENTIALS',
      latencyMs: 410,
      message: `${integration.name} rejected the credentials (401 Unauthorized). Check the key and its environment.`,
      errorCode: 'AUTH_FAILED',
    };
  const slow = integration.statusReason?.code === 'ELEVATED_LATENCY';
  return {
    ok: true,
    kind: 'OK',
    latencyMs: slow ? 4200 : 180 + (integration.name.length % 7) * 23,
    message: slow
      ? `Connected to ${integration.name}, but responses are slow (4.2 s).`
      : `Connection successful (${ENVIRONMENT_LABELS[integration.environment]}).`,
    errorCode: null,
  };
}

/** A safe provider check: a TEST run, a log record and the result on the integration. */
function runTest(
  s: IntegrationsStore,
  integration: PlatformIntegration,
  trigger: PlatformRun['trigger'],
): ConnectionTestResult {
  if (!integration.supportsTest)
    throw unprocessable(
      INTEGRATION_ERRORS.INVALID_STATE,
      `${integration.name} has no test endpoint. Check it in the provider's console.`,
    );
  const outcome = testOutcome(s, integration);
  const at = nowIso();
  const runId = uuid(s, '1a02');
  const log = writeLog(s, integration, {
    eventType: 'connection.test',
    action: 'Test connection',
    message: outcome.ok
      ? `${integration.name} connection test passed`
      : `${integration.name} connection test failed`,
    severity: outcome.ok ? 'INFO' : 'ERROR',
    succeeded: outcome.ok,
    errorCode: outcome.errorCode,
    details: [
      { label: 'Result', value: outcome.message },
      { label: 'Latency', value: outcome.latencyMs === null ? 'N/A' : `${outcome.latencyMs} ms` },
    ],
    resolution: outcome.ok
      ? null
      : outcome.kind === 'PROVIDER_UNAVAILABLE'
        ? {
            action: 'VIEW_PROVIDER_STATUS',
            label: 'View Provider Status',
            href: integration.statusUrl,
          }
        : {
            action: 'UPDATE_CREDENTIAL',
            label: 'Update Credential',
            href: `/integrations/platform/${integration.id}`,
          },
  });
  s.runs.push({
    id: runId,
    integrationId: integration.id,
    kind: 'TEST',
    status: outcome.ok ? 'SUCCEEDED' : 'FAILED',
    trigger,
    requestedBy: trigger === 'MANUAL' ? INTEGRATIONS_ADMIN.name : null,
    createdAt: at,
    startedAt: at,
    finishedAt: at,
    durationMs: outcome.latencyMs,
    objectCount: 0,
    failedCount: 0,
    retries: 0,
    errorCode: outcome.errorCode,
    errorMessage: outcome.ok ? null : outcome.message,
    correlationId: log.correlationId ?? correlationId(s),
    logId: log.id,
  });
  integration.lastCheckAt = at;
  integration.lastCheckOk = outcome.ok;
  integration.lastCheckMessage = outcome.message;
  if (!outcome.ok)
    integration.latestError = {
      code: outcome.errorCode ?? 'TEST_FAILED',
      title: outcome.kind === 'PROVIDER_UNAVAILABLE' ? 'Provider unavailable' : 'Connection failed',
      message: outcome.message,
      at,
      logId: log.id,
      requestId: log.requestId,
    };
  // The health check's view: a failed test puts a running service in Error; a passing one clears
  // a credential problem (not a provider's slowness, which the health checks clear on their own).
  if (!outcome.ok && integration.status === 'ACTIVE') {
    integration.status = 'ERROR';
    integration.statusReason = {
      code: outcome.errorCode ?? 'TEST_FAILED',
      message: outcome.message,
      recommendedAction:
        outcome.kind === 'PROVIDER_UNAVAILABLE'
          ? "View the provider's status and retry later. Your credentials are unchanged."
          : 'Update the credentials in Connection Settings, then test again.',
    };
  } else if (
    outcome.ok &&
    (integration.status === 'ERROR' || integration.status === 'NEEDS_ATTENTION') &&
    integration.statusReason?.code !== 'ELEVATED_LATENCY' &&
    integration.statusReason?.code !== 'CREDENTIAL_EXPIRING'
  ) {
    integration.status = 'ACTIVE';
    integration.statusReason = null;
    integration.latestError = null;
  }
  return {
    ...outcome,
    at,
    requestId: log.requestId ?? '',
    runId,
    logId: log.id,
    integration: detailOf(s, integration),
  };
}

// ---------- Catalog ----------

function findCatalog(s: IntegrationsStore, id: string): CatalogRecord {
  const found = s.catalog.find((item) => item.id === id);
  if (!found) throw notFound('Catalog integration');
  return found;
}
const planNameOf = (s: IntegrationsStore, planId: string) =>
  s.plans.find((plan) => plan.id === planId)?.name ?? 'Unknown plan';

/**
 * How one firm sees an entry, in the documented order: DISABLED hides it; a firm's DENY hides it;
 * a firm's ALLOW shows it whatever the plan; otherwise the plan access decides. COMING_SOON is
 * visible but not connectable.
 */
export function catalogVisibility(
  entry: Pick<CatalogRecord, 'status' | 'planAccess' | 'planIds' | 'firmRules'>,
  firm: { id: string; planId: string },
): CatalogVisibility {
  if (entry.status === 'DISABLED') return 'HIDDEN';
  const rule = entry.firmRules.find((item) => item.businessId === firm.id);
  const seen =
    rule?.access === 'DENY'
      ? false
      : rule?.access === 'ALLOW'
        ? true
        : entry.planAccess === 'ALL_PLANS' || entry.planIds.includes(firm.planId);
  if (!seen) return 'HIDDEN';
  return entry.status === 'COMING_SOON' ? 'VISIBLE' : 'CONNECTABLE';
}

function catalogStats(s: IntegrationsStore, record: CatalogRecord): CatalogStats {
  const rows = usageRows(s, 'CATALOG', record.provider);
  const linked = s.platform.find((item) => item.id === record.platformIntegrationId);
  return {
    firmsUsing: record.connectedFirmIds.length,
    activeFirms: record.activeFirmIds.length,
    totalConnections: record.totalConnections,
    connects30d: rows.reduce((total, row) => total + (row.connects ?? 0), 0),
    disconnects30d: rows.reduce((total, row) => total + (row.disconnects ?? 0), 0),
    lastActivityAt: record.lastActivityAt,
    uptime30d: linked?.uptime30d ?? null,
  };
}
function catalogItemOf(s: IntegrationsStore, record: CatalogRecord): CatalogItem {
  const linked = s.platform.find((item) => item.id === record.platformIntegrationId);
  const {
    planIds,
    firmRules,
    platformIntegrationId: _linkedId,
    connectedFirmIds: _connected,
    activeFirmIds: _active,
    totalConnections: _total,
    lastActivityAt: _last,
    ...rest
  } = record;
  return copy({
    ...rest,
    plans: planIds.map((id) => ({ id, name: planNameOf(s, id) })),
    firmRules: firmRules.map((rule) => {
      const firm = s.firms.find((item) => item.id === rule.businessId);
      return {
        ...rule,
        firmName: firm?.name ?? 'Removed firm',
        planName: firm ? planNameOf(s, firm.planId) : '—',
      };
    }),
    platformIntegration: linked
      ? {
          id: linked.id,
          name: linked.name,
          status: linked.status,
          environment: linked.environment,
          lastCheckAt: linked.lastCheckAt,
          lastCheckOk: linked.lastCheckOk,
        }
      : null,
    stats: catalogStats(s, record),
  });
}
/** Connected firms that would no longer see the entry after the change. */
function firmsLosingAccess(
  s: IntegrationsStore,
  before: CatalogRecord,
  after: Pick<CatalogRecord, 'status' | 'planAccess' | 'planIds' | 'firmRules'>,
) {
  return before.connectedFirmIds.filter((firmId) => {
    const firm = s.firms.find((item) => item.id === firmId);
    if (!firm) return false;
    return (
      catalogVisibility(before, firm) !== 'HIDDEN' && catalogVisibility(after, firm) === 'HIDDEN'
    );
  }).length;
}
function guardAccessLoss(
  s: IntegrationsStore,
  before: CatalogRecord,
  after: Pick<CatalogRecord, 'status' | 'planAccess' | 'planIds' | 'firmRules'>,
  confirmed: boolean | undefined,
) {
  const losing = firmsLosingAccess(s, before, after);
  if (losing && !confirmed)
    throw conflict(
      INTEGRATION_ERRORS.ACCESS_LOSS,
      `This change removes access for ${losing} connected ${losing === 1 ? 'firm' : 'firms'}. Confirm to save it.`,
    );
  return losing;
}
const catalogTarget = (record: CatalogRecord) => ({
  type: 'CATALOG_ITEM' as const,
  id: record.id,
  name: record.name,
});
function bumpCatalog(record: CatalogRecord) {
  record.version += 1;
  record.updatedAt = nowIso();
  record.updatedBy = INTEGRATIONS_ADMIN.name;
}

// ---------- API keys and webhooks ----------

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Random characters for a key or secret that is shown once and never kept. */
function randomText(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => BASE62[byte % BASE62.length] ?? 'x').join('');
}
function apiKeyOf(record: ApiKeyRecord): ApiKey {
  const { keyHash: _hash, ...rest } = record;
  const status: ApiKeyStatus = record.revokedAt
    ? 'REVOKED'
    : record.expiresAt && time(record.expiresAt) <= Date.now()
      ? 'EXPIRED'
      : 'ACTIVE';
  return copy({ ...rest, status });
}
function issueKey(
  s: IntegrationsStore,
  fields: Omit<
    ApiKeyRecord,
    'id' | 'prefix' | 'lastFour' | 'keyHash' | 'createdAt' | 'createdBy' | 'lastUsedAt' | 'usage24h'
  >,
): IssuedApiKey {
  const environment = fields.environment === 'LIVE' ? 'live' : 'test';
  const body = randomText(32);
  const secret = `fv_${environment}_${body}`;
  const record: ApiKeyRecord = {
    ...fields,
    id: uuid(s, '1a05'),
    prefix: `fv_${environment}_${body.slice(0, 4)}`,
    lastFour: body.slice(-4),
    keyHash: `sha256:${randomText(16)}`,
    createdAt: nowIso(),
    createdBy: INTEGRATIONS_ADMIN.name,
    lastUsedAt: null,
    usage24h: { requests: 0, peakPerMinute: 0, rateLimited: 0 },
  };
  s.apiKeys.push(record);
  return { key: apiKeyOf(record), secret };
}
function checkScopes(scopes: string[]): ApiScope[] {
  const picked = API_SCOPES.filter((scope) => scopes.includes(scope));
  if (!picked.length) throw invalid('Choose at least one scope.');
  if (picked.length !== new Set(scopes).size) throw invalid('Choose scopes from the list.');
  return picked;
}

function webhookOf(s: IntegrationsStore, record: WebhookRecord): WebhookEndpoint {
  const since = Date.now() - 7 * DAY_MS;
  const recent = s.deliveries.filter(
    (item) => item.endpointId === record.id && time(item.createdAt) >= since,
  );
  const last = s.deliveries
    .filter((item) => item.endpointId === record.id)
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
  const linked = s.platform.find((item) => item.id === record.integrationId);
  const { integrationId: _id, ...rest } = record;
  return copy({
    ...rest,
    integration: linked ? { id: linked.id, name: linked.name } : null,
    stats: {
      deliveries7d: recent.length,
      failures7d: recent.filter((item) => item.status === 'FAILED').length,
      lastDeliveryAt: last?.createdAt ?? null,
      lastStatus: last?.status ?? null,
    },
  });
}
function findWebhook(s: IntegrationsStore, id: string): WebhookRecord {
  const found = s.webhooks.find((item) => item.id === id);
  if (!found) throw notFound('Webhook endpoint');
  return found;
}
function checkEvents(events: string[], direction: WebhookDirection): string[] {
  const list = [...new Set(events.map((event) => event.trim()).filter(Boolean))];
  if (!list.length) throw invalid('Choose at least one event.');
  if (direction === 'OUTBOUND' && list.some((event) => !WEBHOOK_EVENTS.some((e) => e === event)))
    throw invalid('Choose events from the list.');
  return list;
}
function checkRetries(value: number | undefined, fallback: number) {
  const retries = value ?? fallback;
  if (!Number.isInteger(retries) || retries < 0 || retries > 10)
    throw invalid('Choose from 0 to 10 retries.');
  return retries;
}
const canRedeliver = (s: IntegrationsStore, delivery: WebhookDelivery) => {
  const endpoint = s.webhooks.find((item) => item.id === delivery.endpointId);
  return (
    !!endpoint &&
    endpoint.direction === 'OUTBOUND' &&
    endpoint.status === 'ACTIVE' &&
    delivery.status !== 'PENDING'
  );
};

// ---------- Logs and usage ----------

function filterLogs(s: IntegrationsStore, query: LogQuery): IntegrationLog[] {
  const search = cleanSearch(query.search);
  const range = parseRange(query.from, query.to);
  const exact = (query.requestId ?? '').trim();
  const rows = s.logs.filter((log) => {
    if (!within(range, time(log.at))) return false;
    if (query.integrationId && log.integrationId !== query.integrationId) return false;
    if (query.platformOnly && !log.integrationId) return false;
    if (query.source && log.source !== query.source) return false;
    if (query.severity && log.severity !== query.severity) return false;
    if (query.eventType && log.eventType !== query.eventType) return false;
    if (query.environment && log.environment !== query.environment) return false;
    if (query.outcome && log.succeeded !== (query.outcome === 'SUCCESS')) return false;
    if (query.firmId && log.firm?.id !== query.firmId) return false;
    if (exact && log.requestId !== exact && log.correlationId !== exact) return false;
    if (!search) return true;
    return [
      log.message,
      log.action,
      log.eventType,
      log.integrationName ?? '',
      log.requestId ?? '',
      log.correlationId ?? '',
      log.errorCode ?? '',
      log.firm?.name ?? '',
    ].some((text) => text.toLowerCase().includes(search));
  });
  const sign = query.descending === false ? 1 : -1;
  return rows.sort((a, b) => (time(a.at) - time(b.at)) * sign || a.id.localeCompare(b.id) * sign);
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function usageRange(query: UsageQuery) {
  const to = query.to ?? dayKey(new Date());
  if (!DAY_PATTERN.test(to) || Number.isNaN(time(`${to}T00:00:00Z`)))
    throw invalid('Choose a valid end date.');
  const from = query.from ?? dayKey(new Date(time(`${to}T00:00:00Z`) - 29 * DAY_MS));
  if (!DAY_PATTERN.test(from) || Number.isNaN(time(`${from}T00:00:00Z`)))
    throw invalid('Choose a valid start date.');
  if (from > to) throw invalid('The start date must be on or before the end date.');
  if (time(`${to}T00:00:00Z`) - time(`${from}T00:00:00Z`) > 366 * DAY_MS)
    throw invalid('Choose a range of a year or less.');
  return { from, to };
}

function totalsOf(rows: UsageDay[], sameUnit: boolean): UsageTotals {
  const sum = (pick: (row: UsageDay) => number | null) => {
    const values = rows.map(pick).filter((value): value is number => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const requests = rows.reduce((total, row) => total + row.requests, 0);
  const successes = rows.reduce((total, row) => total + row.successes, 0);
  const failures = rows.reduce((total, row) => total + row.failures, 0);
  const timed = rows.filter((row) => row.avgLatencyMs !== null && row.requests > 0);
  const timedRequests = timed.reduce((total, row) => total + row.requests, 0);
  const lastDay = rows.reduce<string | null>(
    (latest, row) => (latest === null || row.day > latest ? row.day : latest),
    null,
  );
  const lastRows = rows.filter((row) => row.day === lastDay);
  const lastSum = (pick: (row: UsageDay) => number | null) => {
    const values = lastRows.map(pick).filter((value): value is number => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    requests,
    successes,
    failures,
    successRate: requests ? Math.round((successes / requests) * 10_000) / 100 : null,
    avgLatencyMs: timedRequests
      ? Math.round(
          timed.reduce((total, row) => total + (row.avgLatencyMs ?? 0) * row.requests, 0) /
            timedRequests,
        )
      : null,
    volume: sameUnit ? sum((row) => row.volume) : null,
    costCents: sum((row) => row.costCents),
    connectedFirms: lastSum((row) => row.connectedFirms),
    activeFirms: lastSum((row) => row.activeFirms),
    connects: sum((row) => row.connects),
    disconnects: sum((row) => row.disconnects),
  };
}

/** The scope's subjects: names, categories and units for the breakdown. */
type SubjectInfo = Pick<
  UsageSubject,
  'key' | 'name' | 'category' | 'volumeUnit' | 'volumeLabel' | 'requestLabel'
>;
function subjectsOf(s: IntegrationsStore, scope: UsageScope): SubjectInfo[] {
  if (scope === 'PLATFORM_INTEGRATION')
    return s.platform.map((item) => {
      const template = templateFor(item.provider);
      return {
        key: item.id,
        name: item.name,
        category: item.category,
        volumeUnit: template.volumeUnit,
        volumeLabel: template.volumeLabel,
        requestLabel: template.requestLabel,
      };
    });
  if (scope === 'CATALOG')
    return s.catalog.map((item) => ({
      key: item.provider,
      name: item.name,
      category: item.category,
      volumeUnit: null,
      volumeLabel: null,
      requestLabel: 'Firm Requests',
    }));
  return s.apiKeys.map((item) => ({
    key: item.id,
    name: `${item.name} (${item.prefix}…${item.lastFour})`,
    category: null,
    volumeUnit: null,
    volumeLabel: null,
    requestLabel: 'API Calls',
  }));
}

function alertsOf(s: IntegrationsStore, scope: UsageScope, subjects: UsageSubject[]): UsageAlert[] {
  const t = s.thresholds;
  const alerts: UsageAlert[] = [];
  for (const subject of subjects) {
    const errorRate = subject.requests ? (subject.failures / subject.requests) * 100 : 0;
    if (t.errorRatePercent !== null && subject.requests && errorRate > t.errorRatePercent)
      alerts.push({
        subjectKey: subject.key,
        subjectName: subject.name,
        kind: 'ERROR_RATE',
        value: Math.round(errorRate * 100) / 100,
        threshold: t.errorRatePercent,
        message: `${subject.name}: ${Math.round(errorRate * 10) / 10}% of requests failed (threshold ${t.errorRatePercent}%).`,
      });
    if (t.latencyMs !== null && subject.avgLatencyMs !== null && subject.avgLatencyMs > t.latencyMs)
      alerts.push({
        subjectKey: subject.key,
        subjectName: subject.name,
        kind: 'LATENCY',
        value: subject.avgLatencyMs,
        threshold: t.latencyMs,
        message: `${subject.name}: average latency ${subject.avgLatencyMs} ms (threshold ${t.latencyMs} ms).`,
      });
    if (
      t.monthlyCostCents !== null &&
      subject.costCents !== null &&
      subject.costCents > t.monthlyCostCents
    )
      alerts.push({
        subjectKey: subject.key,
        subjectName: subject.name,
        kind: 'COST',
        value: subject.costCents,
        threshold: t.monthlyCostCents,
        message: `${subject.name}: provider cost over the threshold for the range.`,
      });
    if (scope === 'PLATFORM_INTEGRATION' && t.syncFailures !== null) {
      const failed = s.runs.filter(
        (run) =>
          run.integrationId === subject.key && run.kind === 'SYNC' && run.status === 'FAILED',
      ).length;
      if (failed > t.syncFailures)
        alerts.push({
          subjectKey: subject.key,
          subjectName: subject.name,
          kind: 'SYNC_FAILURES',
          value: failed,
          threshold: t.syncFailures,
          message: `${subject.name}: ${failed} failed syncs (threshold ${t.syncFailures}).`,
        });
    }
    if (scope === 'API' && t.quotaPercent !== null) {
      const key = s.apiKeys.find((item) => item.id === subject.key);
      const limit = key?.rateLimitPerMinute ?? SYSTEM_RATE_LIMIT_PER_MINUTE;
      const peak = key && !key.revokedAt ? key.usage24h.peakPerMinute : 0;
      const used = (peak / limit) * 100;
      if (used > t.quotaPercent)
        alerts.push({
          subjectKey: subject.key,
          subjectName: subject.name,
          kind: 'QUOTA',
          value: Math.round(used),
          threshold: t.quotaPercent,
          message: `${subject.name}: peak use reached ${Math.round(used)}% of its rate limit.`,
        });
    }
  }
  return alerts;
}

const csvCell = (value: string) => {
  // A cell that starts like a formula is kept as text when a spreadsheet opens the file.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

// ---------- The client ----------

export const adminIntegrations = {
  /** The signed-in admin's rights in this module (docx §12). */
  access: async (): Promise<IntegrationAccess> => {
    await ready();
    const superAdmin = VIEWER_ROLE === 'SUPER_ADMIN';
    return {
      role: VIEWER_ROLE,
      canView: true,
      canManageConfiguration: superAdmin,
      canManageSecrets: superAdmin,
      canLifecycle: superAdmin,
    };
  },

  /** GET /summary: the dashboard's cards (docx §2: counts from the status records). */
  summary: async (): Promise<IntegrationSummary> => {
    await ready();
    const s = db();
    const live = s.platform.filter((item) => item.status !== 'REMOVED');
    const count = (status: IntegrationStatus) =>
      live.filter((item) => item.status === status).length;
    const running = live.filter(
      (item) =>
        ['ACTIVE', 'NEEDS_ATTENTION', 'ERROR'].includes(item.status) && item.uptime30d !== null,
    );
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const catalogCount = (status: CatalogStatus) =>
      s.catalog.filter((item) => item.status === status).length;
    return {
      total: live.length + s.catalog.length,
      platformTotal: live.length,
      active: count('ACTIVE'),
      inactive: count('INACTIVE'),
      needsAttention: count('NEEDS_ATTENTION'),
      errors: count('ERROR'),
      disabled: count('DISABLED'),
      drafts: count('DRAFT'),
      uptime30d: running.length
        ? Math.round(
            (running.reduce((total, item) => total + (item.uptime30d ?? 0), 0) / running.length) *
              100,
          ) / 100
        : null,
      catalog: {
        total: s.catalog.length,
        enabled: catalogCount('ENABLED'),
        disabled: catalogCount('DISABLED'),
        comingSoon: catalogCount('COMING_SOON'),
        addedThisMonth: s.catalog.filter((item) => time(item.createdAt) >= monthStart.getTime())
          .length,
      },
    };
  },

  /** Provider definitions for the wizard (docx §15 Integration Definition). */
  providers: async (): Promise<ProviderTemplate[]> => {
    await ready();
    return copy(providerTemplates());
  },

  /** The subscription plans (from the plan configuration, never hard-coded in the UI). */
  plans: async (): Promise<PlanOption[]> => {
    await ready();
    return copy(db().plans);
  },

  /** Firms for the catalog's firm access picker: id, name and plan only. */
  firmOptions: async (search?: string): Promise<FirmOption[]> => {
    await ready();
    const s = db();
    const text = cleanSearch(search);
    return s.firms
      .filter((firm) => !text || firm.name.toLowerCase().includes(text))
      .map((firm) => ({ ...firm, planName: planNameOf(s, firm.planId) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  // ----- Platform integrations -----

  /** GET /platform: search, category, status and environment combine with AND (docx §2). */
  listPlatform: async (query: PlatformQuery = {}): Promise<Page<PlatformIntegration>> => {
    await ready();
    const s = db();
    return pageOf(sortPlatform(filterPlatform(s, query), query), query.page, query.pageSize ?? 10);
  },

  /** GET /platform/:id. */
  getPlatform: async (id: string): Promise<PlatformIntegrationDetail> => {
    await ready();
    const s = db();
    return detailOf(s, findPlatform(s, id));
  },

  /** POST /platform: the wizard's step 1 saves a DRAFT (docx §4); nothing runs until activation. */
  createPlatform: async (body: CreatePlatformBody): Promise<PlatformIntegrationDetail> => {
    await ready();
    const s = db();
    const name = cleanText(body.name, 'integration name', NAME_MAX, true);
    const description = cleanText(
      body.description,
      'short description',
      SHORT_DESCRIPTION_MAX,
      true,
    );
    const longDescription = optionalText(
      body.longDescription,
      'detailed description',
      DESCRIPTION_MAX,
    );
    const environment = body.environment ?? 'TEST';
    const templates = providerTemplates();
    const byName = templates.find(
      (item) => item.key !== 'custom' && item.name.toLowerCase() === name.toLowerCase(),
    );
    const provider = body.provider
      ? (templates.find((item) => item.key === body.provider)?.key ?? null)
      : (byName?.key ?? `custom_${slug(name) || 'service'}`);
    if (!provider) throw invalid('Choose a provider from the list.');
    checkDuplicate(s, provider, environment, null);
    const template = templateFor(provider);
    const now = nowIso();
    const number = s.platform.length + 1;
    const integration: PlatformIntegration = {
      id: uuid(s, '1a01'),
      reference: `int_${String(number).padStart(3, '0')}`,
      provider,
      name,
      category: category(body.category),
      description,
      longDescription,
      logo: checkLogo(body.logo),
      websiteUrl: cleanUrl(body.websiteUrl, 'provider website'),
      docsUrl: cleanUrl(body.docsUrl, 'documentation URL'),
      statusUrl: template.statusUrl,
      environment,
      status: 'DRAFT',
      statusReason: null,
      connection: emptyConnection(template, environment),
      settings: {
        scopes: [...template.defaultScopes],
        syncSchedule: 'DAILY',
        features: [],
        dataAccess: 'READ_ONLY',
        retry: { maxRetries: 3, backoff: 'EXPONENTIAL' },
        firmExposure: 'PLATFORM_ONLY',
      },
      lastCheckAt: null,
      lastCheckOk: null,
      lastCheckMessage: null,
      lastSyncAt: null,
      lastSyncOk: null,
      uptime30d: null,
      supportsTest: template.supportsTest,
      supportsUptime: template.supportsUptime,
      critical: false,
      activatedWithoutTest: false,
      activatedAt: null,
      disabledAt: null,
      removedAt: null,
      setupStep: 'CONNECTION',
      latestError: null,
      sortOrder: Math.max(0, ...s.platform.map((item) => item.sortOrder)) + 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
      updatedBy: INTEGRATIONS_ADMIN.name,
    };
    s.platform.push(integration);
    audit(s, {
      action: 'integration.draft_created',
      label: 'Created integration draft',
      category: 'INTEGRATION',
      target: target(integration),
      changes: [
        { field: 'Name', before: null, after: name },
        { field: 'Environment', before: null, after: ENVIRONMENT_LABELS[environment] },
      ],
    });
    return detailOf(s, integration);
  },

  /**
   * PATCH /platform/:id with the version read (a stale one is 409 CONFLICT). Changing the
   * environment of a configured integration needs `confirmEnvironmentChange` and clears its
   * credentials, so live and test never mix (docx §3).
   */
  updatePlatform: async (
    id: string,
    body: UpdatePlatformBody,
  ): Promise<PlatformIntegrationDetail> => {
    await ready();
    const s = db();
    const integration = liveOne(s, id);
    if (body.version !== integration.version)
      throw conflict(
        INTEGRATION_ERRORS.CONFLICT,
        'This integration was changed by someone else. Reload to see the latest version.',
      );
    const changes: IntegrationAuditEntry['changes'] = [];
    const next = copy(integration);
    const note = (field: string, before: string | null, after: string | null) => {
      if (before !== after) changes.push({ field, before, after });
    };
    if (body.name !== undefined) {
      next.name = cleanText(body.name, 'integration name', NAME_MAX, true);
      note('Name', integration.name, next.name);
    }
    if (body.category !== undefined) {
      next.category = category(body.category);
      note('Category', CATEGORY_LABELS[integration.category], CATEGORY_LABELS[next.category]);
    }
    if (body.description !== undefined) {
      next.description = cleanText(
        body.description,
        'short description',
        SHORT_DESCRIPTION_MAX,
        true,
      );
      note('Short description', integration.description, next.description);
    }
    if (body.longDescription !== undefined) {
      next.longDescription = optionalText(
        body.longDescription,
        'detailed description',
        DESCRIPTION_MAX,
      );
      note('Detailed description', integration.longDescription, next.longDescription);
    }
    if (body.logo !== undefined) {
      next.logo = checkLogo(body.logo);
      note('Logo', integration.logo?.fileName ?? null, next.logo?.fileName ?? null);
    }
    if (body.websiteUrl !== undefined) {
      next.websiteUrl = cleanUrl(body.websiteUrl, 'provider website');
      note('Provider website', integration.websiteUrl, next.websiteUrl);
    }
    if (body.docsUrl !== undefined) {
      next.docsUrl = cleanUrl(body.docsUrl, 'documentation URL');
      note('Documentation URL', integration.docsUrl, next.docsUrl);
    }
    if (body.connection) {
      for (const [key, raw] of Object.entries(body.connection)) {
        const field = next.connection.fields.find((item) => item.key === key);
        if (!field) throw invalid(`Unknown connection field: ${key}.`);
        if (field.secret)
          throw invalid(`${field.label} is a secret: save it with the credentials.`);
        const value =
          field.kind === 'url'
            ? cleanUrl(raw, field.label.toLowerCase())
            : optionalText(raw, field.label.toLowerCase(), 200);
        if (field.required && !value) throw invalid(`Enter the ${field.label.toLowerCase()}.`);
        note(field.label, field.display, value);
        field.display = value;
        field.updatedAt = nowIso();
      }
    }
    if (body.settings) {
      const template = templateFor(next.provider);
      const settings = { ...next.settings, ...body.settings };
      if (settings.scopes.some((scope) => !template.scopes.includes(scope)))
        throw invalid('Choose scopes this provider offers.');
      if (settings.features.some((key) => !template.features.some((f) => f.key === key)))
        throw invalid('Choose features this provider offers.');
      if (!SYNC_SCHEDULES.includes(settings.syncSchedule)) throw invalid('Choose a sync schedule.');
      if (!DATA_ACCESS.includes(settings.dataAccess)) throw invalid('Choose the data access.');
      if (!FIRM_EXPOSURES.includes(settings.firmExposure)) throw invalid('Choose the exposure.');
      settings.retry = {
        maxRetries: checkRetries(settings.retry.maxRetries, 3),
        backoff: BACKOFFS.includes(settings.retry.backoff) ? settings.retry.backoff : 'EXPONENTIAL',
      };
      note('Scopes', next.settings.scopes.join(', '), settings.scopes.join(', '));
      note(
        'Sync schedule',
        SYNC_SCHEDULE_LABELS[next.settings.syncSchedule],
        SYNC_SCHEDULE_LABELS[settings.syncSchedule],
      );
      note('Features', next.settings.features.join(', '), settings.features.join(', '));
      note(
        'Data access',
        DATA_ACCESS_LABELS[next.settings.dataAccess],
        DATA_ACCESS_LABELS[settings.dataAccess],
      );
      note('Retries', String(next.settings.retry.maxRetries), String(settings.retry.maxRetries));
      note(
        'Exposure',
        FIRM_EXPOSURE_LABELS[next.settings.firmExposure],
        FIRM_EXPOSURE_LABELS[settings.firmExposure],
      );
      next.settings = settings;
    }
    if (body.environment !== undefined && body.environment !== integration.environment) {
      const environment = ENVIRONMENTS.find((item) => item === body.environment);
      if (!environment) throw invalid('Choose Live or Test.');
      const configured = integration.connection.fields.some((field) => field.display !== null);
      if (configured && !body.confirmEnvironmentChange)
        throw unprocessable(
          INTEGRATION_ERRORS.CONFIRMATION_REQUIRED,
          'Changing the environment clears the saved credentials. Confirm to continue.',
        );
      checkDuplicate(s, next.provider, environment, next.id);
      next.environment = environment;
      next.connection = emptyConnection(templateFor(next.provider), environment);
      next.lastCheckAt = null;
      next.lastCheckOk = null;
      next.lastCheckMessage = null;
      s.rejected = s.rejected.filter((item) => item !== id);
      if (next.status !== 'DRAFT' && next.status !== 'DISABLED') {
        next.status = 'NEEDS_ATTENTION';
        next.statusReason = {
          code: 'CREDENTIALS_REQUIRED',
          message: `Switched to ${ENVIRONMENT_LABELS[environment]}: no credentials are saved for it yet.`,
          recommendedAction:
            'Enter the credentials for this environment, then test the connection.',
        };
      }
      note(
        'Environment',
        ENVIRONMENT_LABELS[integration.environment],
        ENVIRONMENT_LABELS[environment],
      );
    }
    if (body.setupStep !== undefined) {
      if (!SETUP_STEPS.includes(body.setupStep)) throw invalid('Choose a setup step.');
      next.setupStep = body.setupStep;
    }
    next.connection.complete = connectionComplete(next.connection);
    Object.assign(integration, next);
    if (changes.length) {
      bump(integration);
      const environmentChanged = changes.some((change) => change.field === 'Environment');
      audit(s, {
        action: environmentChanged ? 'integration.environment_changed' : 'integration.updated',
        label: environmentChanged ? 'Changed integration environment' : 'Updated integration',
        category: 'INTEGRATION',
        target: target(integration),
        changes,
      });
      writeLog(s, integration, {
        eventType: 'config.updated',
        action: 'Configuration updated',
        message: `${integration.name} configuration updated`,
        severity: environmentChanged ? 'WARNING' : 'INFO',
        succeeded: true,
        details: changes.map((change) => ({ label: change.field, value: 'changed' })),
      });
    } else if (body.setupStep !== undefined) {
      integration.updatedAt = nowIso();
    }
    return detailOf(s, integration);
  },

  /**
   * PUT /platform/:id/credentials (Super Admin only): write-only. The mock keeps a masked hint
   * per secret (`sk_live_••••4242`), never the value. Values with the other environment's prefix
   * are refused. On a running integration this is a rotation, stamped and audited (SECURITY).
   * A value containing "invalid" makes the provider reject it at the next test (to try failures).
   */
  putCredentials: async (
    id: string,
    body: { values: Record<string, string> },
  ): Promise<PlatformIntegrationDetail> => {
    await ready();
    requireSuperAdmin('change credentials');
    const s = db();
    const integration = liveOne(s, id);
    const entries = Object.entries(body.values).filter(([, value]) => value.trim() !== '');
    if (!entries.length) throw invalid('Enter at least one credential.');
    const now = nowIso();
    // Check every value first, so a refused one leaves the saved credentials as they were.
    const updates: { field: ConnectionValue; display: string | null; rejects: boolean }[] = [];
    for (const [key, raw] of entries) {
      const field = integration.connection.fields.find((item) => item.key === key);
      if (!field) throw invalid(`Unknown connection field: ${key}.`);
      const value = raw.trim();
      if (value.length > 500) throw invalid(`${field.label} is too long.`);
      if (field.kind !== 'url' && field.prefix) {
        const wanted = field.prefix[integration.environment];
        const other = field.prefix[integration.environment === 'LIVE' ? 'TEST' : 'LIVE'];
        if (wanted !== other && value.startsWith(other))
          throw invalid(
            `${field.label} is a ${integration.environment === 'LIVE' ? 'test' : 'live'} value; this connection is ${ENVIRONMENT_LABELS[integration.environment]}. Live and test credentials never mix.`,
          );
        if (!value.startsWith(wanted)) throw invalid(`${field.label} should start with ${wanted}.`);
      }
      if (field.secret && value.length < 8) throw invalid(`${field.label} looks too short.`);
      const display =
        field.kind === 'url'
          ? cleanUrl(value, field.label.toLowerCase())
          : field.secret
            ? maskSecret(value, field.prefix?.[integration.environment] ?? null)
            : value;
      updates.push({ field, display, rejects: /invalid/i.test(value) });
    }
    for (const update of updates) {
      update.field.display = update.display;
      update.field.updatedAt = now;
    }
    const changed = updates.map((update) => update.field.label);
    const rejected = updates.some((update) => update.rejects);
    s.rejected = s.rejected.filter((item) => item !== id);
    if (rejected) s.rejected.push(id);
    const rotation = integration.status !== 'DRAFT';
    integration.connection.secretRotatedAt = now;
    integration.connection.complete = connectionComplete(integration.connection);
    integration.lastCheckOk = null;
    integration.lastCheckMessage = 'Credentials changed: test the connection.';
    if (
      ['CREDENTIAL_EXPIRING', 'CREDENTIALS_REQUIRED'].includes(integration.statusReason?.code ?? '')
    )
      integration.statusReason = {
        code: 'TEST_REQUIRED',
        message: 'Credentials changed: test the connection to confirm them.',
        recommendedAction: 'Test the connection.',
      };
    bump(integration);
    audit(s, {
      action: rotation ? 'credentials.rotated' : 'credentials.set',
      label: rotation ? 'Rotated integration credentials' : 'Set integration credentials',
      category: 'SECURITY',
      target: target(integration),
      changes: changed.map((field) => ({
        field,
        before: rotation ? 'set' : null,
        after: 'changed',
      })),
    });
    writeLog(s, integration, {
      eventType: rotation ? 'credentials.rotated' : 'credentials.set',
      action: rotation ? 'API key rotated' : 'Credentials saved',
      message: `${integration.name} ${rotation ? 'credentials rotated' : 'credentials saved'}`,
      severity: 'INFO',
      succeeded: true,
      details: [{ label: 'Fields', value: changed.join(', ') }],
    });
    return detailOf(s, integration);
  },

  /**
   * POST /platform/:id/test: a safe provider check. It records a TEST run, a log record and the
   * result on the integration. A provider outage is told apart from bad credentials (docx §14).
   */
  testPlatform: async (id: string): Promise<ConnectionTestResult> => {
    await ready();
    const s = db();
    return runTest(s, liveOne(s, id), 'MANUAL');
  },

  /**
   * POST /platform/:id/reconnect (Super Admin): re-authenticates an OAuth connection (the mock
   * completes the provider's round trip at once) and tests it. The old connection is kept until
   * the new one validates (docx §5); key-based providers update their credentials instead.
   */
  reconnectPlatform: async (id: string): Promise<ConnectionTestResult> => {
    await ready();
    requireSuperAdmin('reconnect an integration');
    const s = db();
    const integration = liveOne(s, id);
    const oauth = integration.connection.oauth;
    if (!oauth)
      throw unprocessable(
        INTEGRATION_ERRORS.INVALID_STATE,
        `${integration.name} connects with keys: update its credentials instead.`,
      );
    if (!s.outages.includes(id)) {
      const now = nowIso();
      oauth.connected = true;
      oauth.connectedAt = now;
      oauth.account ??= 'Firmivra platform account';
      integration.connection.secretRotatedAt = now;
      integration.connection.complete = connectionComplete(integration.connection);
      bump(integration);
      audit(s, {
        action: 'credentials.reconnected',
        label: 'Reconnected integration (OAuth)',
        category: 'SECURITY',
        target: target(integration),
        changes: [{ field: 'OAuth connection', before: 'connected', after: 'reconnected' }],
      });
    }
    return runTest(s, integration, 'MANUAL');
  },

  /**
   * POST /platform/:id/activate: DRAFT (or INACTIVE) to ACTIVE, only after a passing test, or
   * with `confirmWithoutTest` when the provider has no test endpoint. A failed activation leaves
   * the draft and writes an error log; a success is audited (docx §4).
   */
  activatePlatform: async (
    id: string,
    body: { confirmWithoutTest?: boolean } = {},
  ): Promise<PlatformIntegrationDetail> => {
    await ready();
    requireSuperAdmin('activate an integration');
    const s = db();
    const integration = liveOne(s, id);
    if (integration.status !== 'DRAFT' && integration.status !== 'INACTIVE')
      throw conflict(
        INTEGRATION_ERRORS.INVALID_STATE,
        'Only a draft or inactive integration can be activated.',
      );
    const fail = (error: ApiRequestError) => {
      writeLog(s, integration, {
        eventType: 'integration.activation_failed',
        action: 'Activation failed',
        message: `${integration.name} activation failed`,
        severity: 'ERROR',
        succeeded: false,
        errorCode: error.code,
        details: [{ label: 'Reason', value: error.message }],
      });
      return error;
    };
    if (!integration.connection.complete)
      throw fail(
        unprocessable(
          INTEGRATION_ERRORS.CREDENTIALS_REQUIRED,
          'Enter every required connection field first.',
        ),
      );
    checkDuplicate(s, integration.provider, integration.environment, integration.id);
    if (integration.supportsTest && integration.lastCheckOk !== true)
      throw fail(
        unprocessable(
          INTEGRATION_ERRORS.TEST_REQUIRED,
          'Run a passing connection test before activating.',
        ),
      );
    if (!integration.supportsTest && !body.confirmWithoutTest)
      throw unprocessable(
        INTEGRATION_ERRORS.CONFIRMATION_REQUIRED,
        'This provider has no test endpoint. Confirm that you checked the connection to activate it.',
      );
    const now = nowIso();
    integration.status = 'ACTIVE';
    integration.statusReason = null;
    integration.activatedAt = now;
    integration.activatedWithoutTest = !integration.supportsTest;
    integration.setupStep = 'REVIEW';
    bump(integration);
    audit(s, {
      action: 'integration.activated',
      label: 'Activated integration',
      category: 'INTEGRATION',
      target: target(integration),
      changes: [{ field: 'Status', before: 'Draft', after: 'Active' }],
    });
    writeLog(s, integration, {
      eventType: 'integration.activated',
      action: 'Integration activated',
      message: `${integration.name} activated (${ENVIRONMENT_LABELS[integration.environment]})`,
      severity: 'INFO',
      succeeded: true,
      details: integration.activatedWithoutTest
        ? [{ label: 'Test', value: 'No test endpoint: activated with confirmation' }]
        : [],
    });
    return detailOf(s, integration);
  },

  /** POST /platform/:id/disable (Super Admin): stops jobs and new calls, keeps the configuration. */
  disablePlatform: async (
    id: string,
    body: { reason?: string } = {},
  ): Promise<PlatformIntegrationDetail> => {
    await ready();
    requireSuperAdmin('disable an integration');
    const s = db();
    const integration = liveOne(s, id);
    if (integration.status === 'DISABLED' || integration.status === 'DRAFT')
      throw conflict(INTEGRATION_ERRORS.INVALID_STATE, 'This integration is not running.');
    const reason = optionalText(body.reason, 'reason', 500);
    const before = STATUS_LABELS[integration.status];
    integration.status = 'DISABLED';
    integration.disabledAt = nowIso();
    bump(integration);
    audit(s, {
      action: 'integration.disabled',
      label: 'Disabled integration',
      category: 'INTEGRATION',
      target: target(integration),
      changes: [
        { field: 'Status', before, after: 'Disabled' },
        ...(reason ? [{ field: 'Reason', before: null, after: reason }] : []),
      ],
    });
    writeLog(s, integration, {
      eventType: 'integration.disabled',
      action: 'Integration disabled',
      message: `${integration.name} disabled`,
      severity: 'WARNING',
      succeeded: true,
      details: reason ? [{ label: 'Reason', value: reason }] : [],
    });
    return detailOf(s, integration);
  },

  /** POST /platform/:id/enable (Super Admin): an explicit re-enable; never automatic (docx §11). */
  enablePlatform: async (id: string): Promise<PlatformIntegrationDetail> => {
    await ready();
    requireSuperAdmin('enable an integration');
    const s = db();
    const integration = liveOne(s, id);
    if (integration.status !== 'DISABLED')
      throw conflict(INTEGRATION_ERRORS.INVALID_STATE, 'This integration is not disabled.');
    integration.status = integration.lastCheckOk === false ? 'NEEDS_ATTENTION' : 'ACTIVE';
    integration.statusReason =
      integration.status === 'NEEDS_ATTENTION'
        ? {
            code: 'LAST_TEST_FAILED',
            message: 'Re-enabled, but the last connection test failed.',
            recommendedAction: 'Test the connection, and update the credentials if it fails again.',
          }
        : integration.statusReason;
    integration.disabledAt = null;
    bump(integration);
    audit(s, {
      action: 'integration.enabled',
      label: 'Enabled integration',
      category: 'INTEGRATION',
      target: target(integration),
      changes: [{ field: 'Status', before: 'Disabled', after: STATUS_LABELS[integration.status] }],
    });
    writeLog(s, integration, {
      eventType: 'integration.enabled',
      action: 'Integration enabled',
      message: `${integration.name} enabled`,
      severity: 'INFO',
      succeeded: true,
    });
    return detailOf(s, integration);
  },

  /**
   * POST /platform/:id/remove (Super Admin): a tombstone, never deleted; the secrets are revoked.
   * A critical service needs its name typed as `confirmation` (docx §5, §12).
   */
  removePlatform: async (
    id: string,
    body: { confirmation?: string } = {},
  ): Promise<PlatformIntegrationDetail> => {
    await ready();
    requireSuperAdmin('remove an integration');
    const s = db();
    const integration = liveOne(s, id);
    if (integration.critical && (body.confirmation ?? '').trim() !== integration.name)
      throw unprocessable(
        INTEGRATION_ERRORS.CONFIRMATION_REQUIRED,
        `Type ${integration.name} to confirm removing a critical service.`,
      );
    const before = STATUS_LABELS[integration.status];
    integration.status = 'REMOVED';
    integration.removedAt = nowIso();
    integration.connection = emptyConnection(
      templateFor(integration.provider),
      integration.environment,
    );
    for (const item of s.catalog)
      if (item.platformIntegrationId === integration.id) item.platformIntegrationId = null;
    bump(integration);
    audit(s, {
      action: 'integration.removed',
      label: 'Removed integration',
      category: 'INTEGRATION',
      target: target(integration),
      changes: [
        { field: 'Status', before, after: 'Removed' },
        { field: 'Credentials', before: 'set', after: 'revoked' },
      ],
    });
    writeLog(s, integration, {
      eventType: 'integration.removed',
      action: 'Integration removed',
      message: `${integration.name} removed; its credentials were revoked`,
      severity: 'WARNING',
      succeeded: true,
    });
    return detailOf(s, integration);
  },

  /** POST /platform/:id/sync: queue a sync now (the mock's worker finishes it at once). */
  syncPlatform: async (id: string): Promise<PlatformRun> => {
    await ready();
    const s = db();
    const integration = liveOne(s, id);
    if (!['ACTIVE', 'NEEDS_ATTENTION', 'ERROR'].includes(integration.status))
      throw conflict(INTEGRATION_ERRORS.INVALID_STATE, 'Only a running integration can sync.');
    const failed = s.outages.includes(id) || s.rejected.includes(id);
    const at = nowIso();
    const objects = failed ? 0 : 40 + (s.next % 90);
    const log = writeLog(s, integration, {
      eventType: failed ? 'sync.failed' : 'sync.completed',
      action: failed ? 'Synchronization failed' : 'Synchronization completed',
      message: failed
        ? `${integration.name} synchronization failed`
        : `${integration.name} synchronization completed`,
      severity: failed ? 'ERROR' : 'INFO',
      succeeded: !failed,
      errorCode: failed ? 'PROVIDER_UNAVAILABLE' : null,
      details: [{ label: 'Objects processed', value: String(objects) }],
      resolution: failed
        ? { action: 'RETRY_SYNC', label: 'Retry Sync', href: `/integrations/platform/${id}` }
        : null,
    });
    const run: PlatformRun = {
      id: uuid(s, '1a02'),
      integrationId: id,
      kind: 'SYNC',
      status: failed ? 'FAILED' : 'SUCCEEDED',
      trigger: 'MANUAL',
      requestedBy: INTEGRATIONS_ADMIN.name,
      createdAt: at,
      startedAt: at,
      finishedAt: at,
      durationMs: failed ? 30_000 : 2_400,
      objectCount: objects,
      failedCount: 0,
      retries: failed ? 3 : 0,
      errorCode: failed ? 'PROVIDER_UNAVAILABLE' : null,
      errorMessage: failed ? 'The provider did not answer.' : null,
      correlationId: log.correlationId ?? correlationId(s),
      logId: log.id,
    };
    s.runs.push(run);
    integration.lastSyncAt = at;
    integration.lastSyncOk = !failed;
    return copy(run);
  },

  /** GET /platform/:id/runs: sync and test history, newest first (docx §5 Sync History). */
  platformRuns: async (
    id: string,
    query: { kind?: RunKind; status?: RunStatus; page?: number; pageSize?: number } = {},
  ): Promise<Page<PlatformRun>> => {
    await ready();
    const s = db();
    findPlatform(s, id);
    const rows = s.runs
      .filter(
        (run) =>
          run.integrationId === id &&
          (!query.kind || run.kind === query.kind) &&
          (!query.status || run.status === query.status),
      )
      .sort((a, b) => time(b.createdAt) - time(a.createdAt));
    return pageOf(rows, query.page, query.pageSize ?? 10);
  },

  /** GET /platform/:id/usage: the integration's usage in its own units. */
  platformUsage: async (
    id: string,
    query: { from?: string; to?: string } = {},
  ): Promise<UsageReport> => {
    await ready();
    findPlatform(db(), id);
    return usageReport({ scope: 'PLATFORM_INTEGRATION', subject: id, ...query });
  },

  // ----- Customer catalog -----

  /** GET /catalog: status, plan, category and search combine with AND (docx §6). */
  listCatalog: async (query: CatalogQuery = {}): Promise<Page<CatalogItem>> => {
    await ready();
    const s = db();
    const search = cleanSearch(query.search);
    const rows = s.catalog.filter((item) => {
      if (query.status && item.status !== query.status) return false;
      if (query.category && item.category !== query.category) return false;
      if (query.plan && item.planAccess === 'SELECTED_PLANS' && !item.planIds.includes(query.plan))
        return false;
      if (!search) return true;
      return [item.name, item.provider, item.shortDescription].some((text) =>
        text.toLowerCase().includes(search),
      );
    });
    const by = query.sort ?? 'order';
    const sign = query.descending ? -1 : 1;
    const key = (item: CatalogRecord): string | number =>
      by === 'name'
        ? item.name.toLowerCase()
        : by === 'category'
          ? CATEGORY_RANK(item.category)
          : by === 'customers'
            ? item.connectedFirmIds.length
            : by === 'status'
              ? CATALOG_STATUSES.indexOf(item.status)
              : item.sortOrder;
    const sorted = [...rows].sort((a, b) => {
      const left = key(a);
      const right = key(b);
      const compared =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right));
      return compared * sign || a.sortOrder - b.sortOrder;
    });
    const page = pageOf(sorted, query.page, query.pageSize ?? 10);
    return { ...page, items: page.items.map((item) => catalogItemOf(s, item)) };
  },

  /** GET /catalog/:id. */
  getCatalog: async (id: string): Promise<CatalogItem> => {
    await ready();
    const s = db();
    return catalogItemOf(s, findCatalog(s, id));
  },

  /** POST /catalog: a new entry starts DISABLED, on all plans; the provider key never changes. */
  createCatalog: async (body: CreateCatalogBody): Promise<CatalogItem> => {
    await ready();
    const s = db();
    const provider = slug(cleanText(body.provider, 'provider key', 40, true));
    if (!provider) throw invalid('Enter the provider key.');
    if (s.catalog.some((item) => item.provider === provider))
      throw conflict(
        INTEGRATION_ERRORS.DUPLICATE_CONNECTION,
        'The catalog already has this provider.',
      );
    const linked = body.platformIntegrationId ? liveOne(s, body.platformIntegrationId) : null;
    const now = nowIso();
    const record: CatalogRecord = {
      id: uuid(s, '1a04'),
      provider,
      name: cleanText(body.name, 'integration name', NAME_MAX, true),
      category: category(body.category),
      shortDescription: cleanText(
        body.shortDescription,
        'short description',
        SHORT_DESCRIPTION_MAX,
        true,
      ),
      description: optionalText(body.description, 'detailed description', 5000),
      logo: null,
      websiteUrl: cleanUrl(body.websiteUrl, 'website URL'),
      helpUrl: cleanUrl(body.helpUrl, 'help URL'),
      displayLabel: null,
      status: 'DISABLED',
      planAccess: 'ALL_PLANS',
      planIds: [],
      firmRules: [],
      requiredRole: 'OWNER_ADMIN',
      setup: {
        authType: 'OAUTH',
        instructions: '',
        requiredFields: [],
        helpText: null,
        testOnConnect: true,
      },
      badges: [],
      sortOrder: Math.max(0, ...s.catalog.map((item) => item.sortOrder)) + 1,
      advanced: {
        featureFlag: null,
        beta: false,
        deprecationNotice: null,
        minAppVersion: null,
        rolloutPercent: 100,
        regions: [],
      },
      platformIntegrationId: linked?.id ?? null,
      connectedFirmIds: [],
      activeFirmIds: [],
      totalConnections: 0,
      lastActivityAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      updatedBy: INTEGRATIONS_ADMIN.name,
    };
    s.catalog.push(record);
    audit(s, {
      action: 'catalog.created',
      label: 'Added catalog integration',
      category: 'INTEGRATION',
      target: catalogTarget(record),
      changes: [{ field: 'Status', before: null, after: 'Disabled' }],
    });
    return catalogItemOf(s, record);
  },

  /**
   * PATCH /catalog/:id with the version read. A status or plan change that hides the entry from
   * firms already connected is refused with 409 ACCESS_LOSS until `confirmAccessLoss` (docx §7).
   */
  updateCatalog: async (id: string, body: UpdateCatalogBody): Promise<CatalogItem> => {
    await ready();
    const s = db();
    const record = findCatalog(s, id);
    if (body.version !== record.version)
      throw conflict(
        INTEGRATION_ERRORS.CONFLICT,
        'This catalog entry was changed by someone else. Reload to see the latest version.',
      );
    const next = copy(record);
    const changes: IntegrationAuditEntry['changes'] = [];
    const note = (field: string, before: string | null, after: string | null) => {
      if (before !== after) changes.push({ field, before, after });
    };
    if (body.name !== undefined)
      next.name = cleanText(body.name, 'integration name', NAME_MAX, true);
    if (body.category !== undefined) next.category = category(body.category);
    if (body.shortDescription !== undefined)
      next.shortDescription = cleanText(
        body.shortDescription,
        'short description',
        SHORT_DESCRIPTION_MAX,
        true,
      );
    if (body.description !== undefined) {
      const text = (body.description ?? '').replace(/<[^>]*>/g, '');
      if (text.length > DESCRIPTION_MAX)
        throw invalid(`Keep the detailed description to ${DESCRIPTION_MAX} characters.`);
      next.description = body.description?.trim() || null;
    }
    if (body.logo !== undefined) next.logo = checkLogo(body.logo);
    if (body.websiteUrl !== undefined) next.websiteUrl = cleanUrl(body.websiteUrl, 'website URL');
    if (body.helpUrl !== undefined) next.helpUrl = cleanUrl(body.helpUrl, 'help URL');
    if (body.displayLabel !== undefined)
      next.displayLabel = optionalText(body.displayLabel, 'display label', 40);
    if (body.status !== undefined) {
      if (!CATALOG_STATUSES.includes(body.status)) throw invalid('Choose a status.');
      next.status = body.status;
    }
    if (body.planAccess !== undefined) {
      if (!PLAN_ACCESS.includes(body.planAccess)) throw invalid('Choose the plan access.');
      next.planAccess = body.planAccess;
    }
    if (body.planIds !== undefined) {
      const unknown = body.planIds.filter((planId) => !s.plans.some((plan) => plan.id === planId));
      if (unknown.length) throw invalid('Choose plans from the list.');
      next.planIds = [...new Set(body.planIds)];
    }
    if (next.planAccess === 'SELECTED_PLANS' && !next.planIds.length)
      throw invalid('Choose at least one plan, or make it available on all plans.');
    if (body.requiredRole !== undefined) {
      if (!REQUIRED_ROLES.includes(body.requiredRole)) throw invalid('Choose the required role.');
      next.requiredRole = body.requiredRole;
    }
    if (body.setup !== undefined) {
      const setup = { ...next.setup, ...body.setup };
      if (!CATALOG_AUTH_TYPES.includes(setup.authType)) throw invalid('Choose how firms connect.');
      setup.instructions = cleanText(setup.instructions, 'setup instructions', 4000, false);
      setup.helpText = optionalText(setup.helpText, 'help text', 500);
      if (
        /(sk_live_|sk_test_|whsec_|fv_live_|fv_test_)/.test(
          `${setup.instructions} ${setup.helpText ?? ''}`,
        )
      )
        throw invalid('Customer instructions cannot contain Firmivra secrets.');
      if (setup.requiredFields.some((field) => !field.key.trim() || !field.label.trim()))
        throw invalid('Give every required field a key and a label.');
      next.setup = setup;
    }
    if (body.badges !== undefined) {
      const badges = [...new Set(body.badges.map((badge) => badge.trim()).filter(Boolean))];
      if (badges.length > 5 || badges.some((badge) => badge.length > 24))
        throw invalid('Use up to 5 badges of 24 characters.');
      next.badges = badges;
    }
    if (body.sortOrder !== undefined) {
      if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0)
        throw invalid('The order is a whole number from 0.');
      next.sortOrder = body.sortOrder;
    }
    if (body.advanced !== undefined) {
      const advanced = { ...next.advanced, ...body.advanced };
      if (
        !Number.isInteger(advanced.rolloutPercent) ||
        advanced.rolloutPercent < 0 ||
        advanced.rolloutPercent > 100
      )
        throw invalid('The rollout is a whole percent from 0 to 100.');
      if (advanced.regions.some((region) => !/^[A-Z]{2}$/.test(region)))
        throw invalid('Use two-letter state codes for regions.');
      if (advanced.minAppVersion && !/^\d+\.\d+(\.\d+)?$/.test(advanced.minAppVersion))
        throw invalid('Write the version as 1.2 or 1.2.3.');
      advanced.featureFlag = optionalText(advanced.featureFlag, 'feature flag', 60);
      advanced.deprecationNotice = optionalText(
        advanced.deprecationNotice,
        'deprecation notice',
        300,
      );
      next.advanced = advanced;
    }
    if (body.platformIntegrationId !== undefined)
      next.platformIntegrationId = body.platformIntegrationId
        ? liveOne(s, body.platformIntegrationId).id
        : null;
    const losing = guardAccessLoss(s, record, next, body.confirmAccessLoss);
    note('Name', record.name, next.name);
    note('Category', CATEGORY_LABELS[record.category], CATEGORY_LABELS[next.category]);
    note('Short description', record.shortDescription, next.shortDescription);
    note('Detailed description', record.description, next.description);
    note('Logo', record.logo?.fileName ?? null, next.logo?.fileName ?? null);
    note('Website URL', record.websiteUrl, next.websiteUrl);
    note('Help URL', record.helpUrl, next.helpUrl);
    note('Display label', record.displayLabel, next.displayLabel);
    note('Status', CATALOG_STATUS_LABELS[record.status], CATALOG_STATUS_LABELS[next.status]);
    note('Plan access', record.planAccess, next.planAccess);
    note(
      'Plans',
      record.planIds.map((planId) => planNameOf(s, planId)).join(', '),
      next.planIds.map((planId) => planNameOf(s, planId)).join(', '),
    );
    note(
      'Required role',
      REQUIRED_ROLE_LABELS[record.requiredRole],
      REQUIRED_ROLE_LABELS[next.requiredRole],
    );
    note('Setup', JSON.stringify(record.setup), JSON.stringify(next.setup));
    note('Badges', record.badges.join(', '), next.badges.join(', '));
    note('Order', String(record.sortOrder), String(next.sortOrder));
    note('Advanced', JSON.stringify(record.advanced), JSON.stringify(next.advanced));
    note('Platform integration', record.platformIntegrationId, next.platformIntegrationId);
    if (!changes.length) return catalogItemOf(s, record);
    Object.assign(record, next);
    bumpCatalog(record);
    const access = changes.some((change) =>
      ['Status', 'Plan access', 'Plans', 'Required role'].includes(change.field),
    );
    audit(s, {
      action: access ? 'catalog.access_changed' : 'catalog.updated',
      label: access ? 'Changed catalog availability' : 'Updated catalog integration',
      category: 'INTEGRATION',
      target: catalogTarget(record),
      changes: [
        ...changes.map((change) =>
          change.field === 'Setup' || change.field === 'Advanced'
            ? { field: change.field, before: null, after: 'changed' }
            : change,
        ),
        ...(losing
          ? [{ field: 'Connected firms losing access', before: null, after: String(losing) }]
          : []),
      ],
    });
    return catalogItemOf(s, record);
  },

  /** PUT /catalog/:id/plans/:planId: add a plan to a SELECTED_PLANS entry. */
  putCatalogPlan: async (id: string, planId: string): Promise<CatalogItem> => {
    await ready();
    const s = db();
    const record = findCatalog(s, id);
    if (!s.plans.some((plan) => plan.id === planId)) throw notFound('Plan');
    if (record.planIds.includes(planId)) return catalogItemOf(s, record);
    record.planIds.push(planId);
    bumpCatalog(record);
    audit(s, {
      action: 'catalog.plan_added',
      label: 'Added plan access',
      category: 'INTEGRATION',
      target: catalogTarget(record),
      changes: [{ field: 'Plan', before: null, after: planNameOf(s, planId) }],
    });
    return catalogItemOf(s, record);
  },

  /** DELETE /catalog/:id/plans/:planId: warns (409 ACCESS_LOSS) when connected firms lose it. */
  deleteCatalogPlan: async (
    id: string,
    planId: string,
    body: { confirmAccessLoss?: boolean } = {},
  ): Promise<CatalogItem> => {
    await ready();
    const s = db();
    const record = findCatalog(s, id);
    if (!record.planIds.includes(planId)) return catalogItemOf(s, record);
    const planIds = record.planIds.filter((item) => item !== planId);
    if (record.planAccess === 'SELECTED_PLANS' && !planIds.length)
      throw invalid('Keep at least one plan, or make it available on all plans.');
    guardAccessLoss(s, record, { ...record, planIds }, body.confirmAccessLoss);
    record.planIds = planIds;
    bumpCatalog(record);
    audit(s, {
      action: 'catalog.plan_removed',
      label: 'Removed plan access',
      category: 'INTEGRATION',
      target: catalogTarget(record),
      changes: [{ field: 'Plan', before: planNameOf(s, planId), after: null }],
    });
    return catalogItemOf(s, record);
  },

  /** PUT /catalog/:id/firms/:businessId: a firm's ALLOW or DENY (it overrides the plan). */
  putCatalogFirm: async (
    id: string,
    businessId: string,
    body: { access: FirmAccess; reason?: string | null; confirmAccessLoss?: boolean },
  ): Promise<CatalogItem> => {
    await ready();
    const s = db();
    const record = findCatalog(s, id);
    const firm = s.firms.find((item) => item.id === businessId);
    if (!firm) throw notFound('Firm');
    if (!FIRM_ACCESS.includes(body.access)) throw invalid('Choose Allow or Deny.');
    const reason = optionalText(body.reason, 'reason', 300);
    const before = record.firmRules.find((rule) => rule.businessId === businessId);
    const rule = {
      businessId,
      access: body.access,
      reason,
      updatedAt: nowIso(),
      updatedBy: INTEGRATIONS_ADMIN.name,
    };
    const firmRules = [...record.firmRules.filter((item) => item.businessId !== businessId), rule];
    guardAccessLoss(s, record, { ...record, firmRules }, body.confirmAccessLoss);
    record.firmRules = firmRules;
    bumpCatalog(record);
    audit(s, {
      action: 'catalog.firm_access_set',
      label: body.access === 'ALLOW' ? 'Allowed firm access' : 'Denied firm access',
      category: 'INTEGRATION',
      target: catalogTarget(record),
      changes: [{ field: firm.name, before: before?.access ?? null, after: body.access }],
    });
    return catalogItemOf(s, record);
  },

  /** DELETE /catalog/:id/firms/:businessId: back to the plan default. */
  deleteCatalogFirm: async (
    id: string,
    businessId: string,
    body: { confirmAccessLoss?: boolean } = {},
  ): Promise<CatalogItem> => {
    await ready();
    const s = db();
    const record = findCatalog(s, id);
    const before = record.firmRules.find((rule) => rule.businessId === businessId);
    if (!before) return catalogItemOf(s, record);
    const firmRules = record.firmRules.filter((rule) => rule.businessId !== businessId);
    guardAccessLoss(s, record, { ...record, firmRules }, body.confirmAccessLoss);
    record.firmRules = firmRules;
    bumpCatalog(record);
    const firm = s.firms.find((item) => item.id === businessId);
    audit(s, {
      action: 'catalog.firm_access_cleared',
      label: 'Cleared firm access rule',
      category: 'INTEGRATION',
      target: catalogTarget(record),
      changes: [{ field: firm?.name ?? businessId, before: before.access, after: null }],
    });
    return catalogItemOf(s, record);
  },

  /** GET /catalog/:id/preview: how firms see it; no live customer data (docx §7). */
  previewCatalog: async (id: string): Promise<CatalogPreview> => {
    await ready();
    const s = db();
    const record = findCatalog(s, id);
    return copy({
      id: record.id,
      name: record.displayLabel ?? record.name,
      category: record.category,
      shortDescription: record.shortDescription,
      description: record.description,
      logo: record.logo,
      badges: record.advanced.beta ? [...record.badges, 'Beta'] : record.badges,
      status: record.status,
      hidden: record.status === 'DISABLED',
      connectable: record.status === 'ENABLED',
      connectLabel:
        record.status === 'ENABLED'
          ? 'Connect'
          : record.status === 'COMING_SOON'
            ? 'Coming Soon'
            : 'Not available',
      setup: record.setup,
      websiteUrl: record.websiteUrl,
      helpUrl: record.helpUrl,
      deprecationNotice: record.advanced.deprecationNotice,
    });
  },

  // ----- API keys -----

  /** GET /api-keys: metadata only (prefix and last four), newest first. */
  listApiKeys: async (
    query: { status?: ApiKeyStatus; environment?: IntegrationEnvironment } = {},
  ): Promise<ApiKey[]> => {
    await ready();
    return db()
      .apiKeys.map(apiKeyOf)
      .filter(
        (key) =>
          (!query.status || key.status === query.status) &&
          (!query.environment || key.environment === query.environment),
      )
      .sort((a, b) => time(b.createdAt) - time(a.createdAt));
  },

  /** POST /api-keys (Super Admin): returns the full key once; only its hash is kept. */
  createApiKey: async (body: CreateApiKeyBody): Promise<IssuedApiKey> => {
    await ready();
    requireSuperAdmin('issue an API key');
    const s = db();
    const name = cleanText(body.name, 'key name', 60, true);
    const environment = ENVIRONMENTS.find((item) => item === body.environment);
    if (!environment) throw invalid('Choose Live or Test.');
    const limit = body.rateLimitPerMinute ?? null;
    if (
      limit !== null &&
      (!Number.isInteger(limit) || limit < 1 || limit > SYSTEM_RATE_LIMIT_PER_MINUTE)
    )
      throw invalid(`Set a rate limit from 1 to ${SYSTEM_RATE_LIMIT_PER_MINUTE} per minute.`);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()))
      throw invalid('Choose an expiry date in the future.');
    const issued = issueKey(s, {
      name,
      environment,
      scopes: checkScopes(body.scopes),
      rateLimitPerMinute: limit,
      expiresAt: expiresAt?.toISOString() ?? null,
      rotatedFromId: null,
      rotatedToId: null,
      revokedAt: null,
      revokedBy: null,
    });
    audit(s, {
      action: 'api_key.created',
      label: 'Issued API key',
      category: 'SECURITY',
      target: { type: 'API_KEY', id: issued.key.id, name },
      changes: [
        { field: 'Key', before: null, after: `${issued.key.prefix}…${issued.key.lastFour}` },
        { field: 'Scopes', before: null, after: issued.key.scopes.join(', ') },
      ],
    });
    return issued;
  },

  /** POST /api-keys/:id/rotate (Super Admin): a new key naming the old, which is revoked. */
  rotateApiKey: async (id: string): Promise<IssuedApiKey> => {
    await ready();
    requireSuperAdmin('rotate an API key');
    const s = db();
    const old = s.apiKeys.find((item) => item.id === id);
    if (!old) throw notFound('API key');
    if (apiKeyOf(old).status !== 'ACTIVE')
      throw conflict(INTEGRATION_ERRORS.INVALID_STATE, 'Only an active key can be rotated.');
    const issued = issueKey(s, {
      name: old.name,
      environment: old.environment,
      scopes: [...old.scopes],
      rateLimitPerMinute: old.rateLimitPerMinute,
      expiresAt: old.expiresAt,
      rotatedFromId: old.id,
      rotatedToId: null,
      revokedAt: null,
      revokedBy: null,
    });
    old.revokedAt = nowIso();
    old.revokedBy = INTEGRATIONS_ADMIN.name;
    old.rotatedToId = issued.key.id;
    audit(s, {
      action: 'api_key.rotated',
      label: 'Rotated API key',
      category: 'SECURITY',
      target: { type: 'API_KEY', id: issued.key.id, name: old.name },
      changes: [
        {
          field: 'Key',
          before: `${old.prefix}…${old.lastFour}`,
          after: `${issued.key.prefix}…${issued.key.lastFour}`,
        },
      ],
    });
    return issued;
  },

  /** POST /api-keys/:id/revoke (Super Admin): once, stamped. */
  revokeApiKey: async (id: string, body: { reason?: string } = {}): Promise<ApiKey> => {
    await ready();
    requireSuperAdmin('revoke an API key');
    const s = db();
    const record = s.apiKeys.find((item) => item.id === id);
    if (!record) throw notFound('API key');
    if (record.revokedAt)
      throw conflict(INTEGRATION_ERRORS.INVALID_STATE, 'This key is already revoked.');
    const reason = optionalText(body.reason, 'reason', 300);
    record.revokedAt = nowIso();
    record.revokedBy = INTEGRATIONS_ADMIN.name;
    audit(s, {
      action: 'api_key.revoked',
      label: 'Revoked API key',
      category: 'SECURITY',
      target: { type: 'API_KEY', id, name: record.name },
      changes: [
        { field: 'Key', before: `${record.prefix}…${record.lastFour}`, after: 'revoked' },
        ...(reason ? [{ field: 'Reason', before: null, after: reason }] : []),
      ],
    });
    return apiKeyOf(record);
  },

  // ----- Webhooks -----

  /** GET /webhooks. */
  listWebhooks: async (
    query: { direction?: WebhookDirection; status?: WebhookStatus } = {},
  ): Promise<WebhookEndpoint[]> => {
    await ready();
    const s = db();
    return s.webhooks
      .filter(
        (item) =>
          (!query.direction || item.direction === query.direction) &&
          (!query.status || item.status === query.status),
      )
      .map((item) => webhookOf(s, item));
  },

  /** POST /webhooks (Super Admin): https only; the signing secret is returned once. */
  createWebhook: async (body: CreateWebhookBody): Promise<WebhookWithSecret> => {
    await ready();
    requireSuperAdmin('create a webhook endpoint');
    const s = db();
    const direction = WEBHOOK_DIRECTIONS.find((item) => item === body.direction);
    if (!direction) throw invalid('Choose outbound or inbound.');
    const url = cleanUrl(body.url, 'endpoint URL');
    if (!url) throw invalid('Enter the endpoint URL.');
    const signingSecret = `whsec_${randomText(32)}`;
    const now = nowIso();
    const record: WebhookRecord = {
      id: uuid(s, '1a06'),
      direction,
      url,
      description: optionalText(body.description, 'description', 200),
      events: checkEvents(body.events, direction),
      status: 'ACTIVE',
      maxRetries: checkRetries(body.maxRetries, 5),
      signingSecretHint: maskSecret(signingSecret, 'whsec_'),
      secretRotatedAt: now,
      integrationId: body.integrationId ? liveOne(s, body.integrationId).id : null,
      createdAt: now,
      updatedAt: now,
    };
    s.webhooks.push(record);
    audit(s, {
      action: 'webhook.created',
      label: 'Created webhook endpoint',
      category: 'SECURITY',
      target: { type: 'WEBHOOK', id: record.id, name: url },
      changes: [
        { field: 'Events', before: null, after: record.events.join(', ') },
        { field: 'Signing secret', before: null, after: 'set' },
      ],
    });
    return { endpoint: webhookOf(s, record), signingSecret };
  },

  /** PATCH /webhooks/:id: URL, events, status, retries; `rotateSecret` returns a new one once. */
  updateWebhook: async (id: string, body: UpdateWebhookBody): Promise<WebhookWithSecret> => {
    await ready();
    const s = db();
    const record = findWebhook(s, id);
    const changes: IntegrationAuditEntry['changes'] = [];
    const next = { ...record };
    if (body.url !== undefined) {
      const url = cleanUrl(body.url, 'endpoint URL');
      if (!url) throw invalid('Enter the endpoint URL.');
      next.url = url;
    }
    if (body.description !== undefined)
      next.description = optionalText(body.description, 'description', 200);
    if (body.events !== undefined) next.events = checkEvents(body.events, record.direction);
    if (body.status !== undefined) {
      if (!WEBHOOK_STATUSES.includes(body.status)) throw invalid('Choose Active or Disabled.');
      next.status = body.status;
    }
    if (body.maxRetries !== undefined) next.maxRetries = checkRetries(body.maxRetries, 5);
    let signingSecret: string | null = null;
    if (body.rotateSecret) {
      requireSuperAdmin('rotate a signing secret');
      signingSecret = `whsec_${randomText(32)}`;
      next.signingSecretHint = maskSecret(signingSecret, 'whsec_');
      next.secretRotatedAt = nowIso();
      changes.push({ field: 'Signing secret', before: 'set', after: 'rotated' });
    }
    const note = (field: string, before: string | null, after: string | null) => {
      if (before !== after) changes.push({ field, before, after });
    };
    note('URL', record.url, next.url);
    note('Description', record.description, next.description);
    note('Events', record.events.join(', '), next.events.join(', '));
    note('Status', record.status, next.status);
    note('Max retries', String(record.maxRetries), String(next.maxRetries));
    if (changes.length) {
      Object.assign(record, next, { updatedAt: nowIso() });
      audit(s, {
        action: signingSecret ? 'webhook.secret_rotated' : 'webhook.updated',
        label: signingSecret ? 'Rotated webhook signing secret' : 'Updated webhook endpoint',
        category: signingSecret ? 'SECURITY' : 'INTEGRATION',
        target: { type: 'WEBHOOK', id: record.id, name: record.url },
        changes,
      });
    }
    return { endpoint: webhookOf(s, record), signingSecret };
  },

  /** GET /webhooks/:id/deliveries: newest first (docx §8 Delivery history). */
  webhookDeliveries: async (
    id: string,
    query: { status?: DeliveryStatus; page?: number; pageSize?: number } = {},
  ): Promise<Page<WebhookDelivery>> => {
    await ready();
    const s = db();
    findWebhook(s, id);
    const rows = s.deliveries
      .filter((item) => item.endpointId === id && (!query.status || item.status === query.status))
      .sort((a, b) => time(b.createdAt) - time(a.createdAt))
      .map((item) => ({ ...item, canRedeliver: canRedeliver(s, item) }));
    return pageOf(rows, query.page, query.pageSize ?? 10);
  },

  /**
   * POST /deliveries/:id/redeliver (after the team's confirmation): a new attempt of the same
   * event to the same endpoint, naming the original; the receiver stays idempotent on event_id.
   */
  redeliver: async (deliveryId: string): Promise<WebhookDelivery> => {
    await ready();
    const s = db();
    const original = s.deliveries.find((item) => item.id === deliveryId);
    if (!original) throw notFound('Delivery');
    if (!canRedeliver(s, original))
      throw conflict(
        INTEGRATION_ERRORS.INVALID_STATE,
        'Only a finished outbound delivery to an active endpoint can be redelivered.',
      );
    const endpoint = findWebhook(s, original.endpointId);
    const attempt =
      Math.max(
        ...s.deliveries
          .filter((item) => item.endpointId === endpoint.id && item.eventId === original.eventId)
          .map((item) => item.attempt),
      ) + 1;
    const now = nowIso();
    const failing = /ops\.example\.test/.test(endpoint.url);
    const delivery: WebhookDelivery = {
      ...original,
      id: uuid(s, '1a07'),
      attempt,
      redeliveryOfId: original.id,
      status: failing ? 'FAILED' : 'SUCCEEDED',
      responseStatusCode: failing ? 500 : 200,
      durationMs: failing ? 1_900 : 240,
      requestId: requestId(s),
      errorCode: failing ? 'HTTP_500' : null,
      retries: 0,
      requestedBy: INTEGRATIONS_ADMIN.name,
      createdAt: now,
      finishedAt: now,
      canRedeliver: false,
    };
    s.deliveries.push(delivery);
    audit(s, {
      action: 'webhook.redelivered',
      label: 'Redelivered webhook event',
      category: 'INTEGRATION',
      target: { type: 'WEBHOOK', id: endpoint.id, name: endpoint.url },
      changes: [
        { field: 'Event', before: null, after: `${original.eventType} (${original.eventId})` },
        { field: 'Attempt', before: String(original.attempt), after: String(attempt) },
      ],
    });
    writeLog(s, null, {
      source: 'WEBHOOK',
      eventType: failing ? 'webhook.delivery_failed' : 'webhook.delivered',
      action: failing ? 'Webhook delivery failed' : 'Webhook delivered',
      message: `Redelivery of ${original.eventType} ${failing ? 'failed' : 'succeeded'}`,
      severity: failing ? 'ERROR' : 'INFO',
      succeeded: !failing,
      errorCode: delivery.errorCode,
      endpoint: endpoint.url,
      requestId: delivery.requestId,
      details: [
        { label: 'Status code', value: String(delivery.responseStatusCode) },
        { label: 'Attempt', value: String(attempt) },
      ],
    });
    return copy({ ...delivery, canRedeliver: canRedeliver(s, delivery) });
  },

  // ----- Logs -----

  /** GET /logs: every filter combines with AND (docx §9). */
  listLogs: async (query: LogQuery = {}): Promise<Page<IntegrationLog>> => {
    await ready();
    return pageOf(filterLogs(db(), query), query.page, query.pageSize ?? 20);
  },

  /** The filter choices, from the log itself. */
  logFacets: async (): Promise<LogFacets> => {
    await ready();
    const s = db();
    const integrations = new Map<string, string>();
    const firms = new Map<string, string>();
    for (const log of s.logs) {
      if (log.integrationId && log.integrationName)
        integrations.set(log.integrationId, log.integrationName);
      if (log.firm) firms.set(log.firm.id, log.firm.name);
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return {
      integrations: [...integrations].map(([id, name]) => ({ id, name })).sort(byName),
      eventTypes: [...new Set(s.logs.map((log) => log.eventType))].sort(),
      firms: [...firms].map(([id, name]) => ({ id, name })).sort(byName),
    };
  },

  /** GET /logs/:id: one record, its correlated events and the affected integration now. */
  getLog: async (id: string): Promise<LogRecord> => {
    await ready();
    const s = db();
    const log = s.logs.find((item) => item.id === id);
    if (!log) throw notFound('Log record');
    const ordered = filterLogs(s, {});
    const index = ordered.findIndex((item) => item.id === id);
    const integration = s.platform.find((item) => item.id === log.integrationId);
    return copy({
      log,
      related: log.correlationId
        ? ordered.filter((item) => item.id !== id && item.correlationId === log.correlationId)
        : [],
      integration: integration
        ? { id: integration.id, name: integration.name, status: integration.status }
        : null,
      previousId: ordered[index - 1]?.id ?? null,
      nextId: ordered[index + 1]?.id ?? null,
    });
  },

  /** POST /logs/export: the filtered rows, redacted, as CSV or JSON; the export is audited. */
  exportLogs: async (body: { query: LogQuery; format: ExportFormat }): Promise<LogExport> => {
    await ready();
    if (body.format !== 'CSV' && body.format !== 'JSON') throw invalid('Choose CSV or JSON.');
    const s = db();
    const rows = filterLogs(s, body.query);
    const columns: [string, (log: IntegrationLog) => string][] = [
      ['logId', (log) => log.id],
      ['timestampUtc', (log) => log.at],
      ['integration', (log) => log.integrationName ?? ''],
      ['source', (log) => log.source],
      ['environment', (log) => log.environment ?? ''],
      ['severity', (log) => log.severity],
      ['eventType', (log) => log.eventType],
      ['action', (log) => log.action],
      ['outcome', (log) => (log.succeeded ? 'SUCCESS' : 'FAILURE')],
      ['errorCode', (log) => log.errorCode ?? ''],
      ['message', (log) => log.message],
      ['requestId', (log) => log.requestId ?? ''],
      ['correlationId', (log) => log.correlationId ?? ''],
      ['firm', (log) => log.firm?.name ?? ''],
      ['actor', (log) => log.actor.name],
    ];
    const content =
      body.format === 'JSON'
        ? JSON.stringify(
            rows.map((log) => Object.fromEntries(columns.map(([key, read]) => [key, read(log)]))),
            null,
            2,
          )
        : [
            columns.map(([key]) => key).join(','),
            ...rows.map((log) => columns.map(([, read]) => csvCell(read(log))).join(',')),
          ].join('\r\n');
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10).replaceAll('-', '');
    const jobId = uuid(s, '1a09');
    audit(s, {
      action: 'logs.exported',
      label: 'Exported integration logs',
      category: 'INTEGRATION',
      target: { type: 'LOG_EXPORT', id: jobId, name: `Integration logs ${body.format}` },
      changes: [
        { field: 'Rows', before: null, after: String(rows.length) },
        { field: 'Format', before: null, after: body.format },
      ],
    });
    return {
      jobId,
      fileName: `firmivra-integration-logs-${stamp}.${body.format.toLowerCase()}`,
      mimeType: body.format === 'JSON' ? 'application/json' : 'text/csv',
      content,
      rowCount: rows.length,
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    };
  },

  // ----- Usage -----

  /** GET /usage?scope=&subject=&from=&to=: the daily rollup's series, totals and breakdown. */
  usage: async (query: UsageQuery = {}): Promise<UsageReport> => {
    await ready();
    return usageReport(query);
  },

  /** The alert thresholds (docx §10). */
  thresholds: async (): Promise<UsageThresholds> => {
    await ready();
    return copy(db().thresholds);
  },

  /** Saves the thresholds with the version read; audited. */
  saveThresholds: async (body: SaveThresholdsBody): Promise<UsageThresholds> => {
    await ready();
    const s = db();
    if (body.version !== s.thresholds.version)
      throw conflict(INTEGRATION_ERRORS.CONFLICT, 'The thresholds were changed by someone else.');
    const check = (value: number | null, label: string, max: number) => {
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > max))
        throw invalid(`Set the ${label} from 0 to ${max}, or leave it empty.`);
      return value;
    };
    const next: UsageThresholds = {
      version: s.thresholds.version + 1,
      errorRatePercent: check(body.errorRatePercent, 'error rate', 100),
      latencyMs: check(body.latencyMs, 'latency', 120_000),
      quotaPercent: check(body.quotaPercent, 'quota', 100),
      monthlyCostCents: check(body.monthlyCostCents, 'cost', 100_000_000),
      syncFailures: check(body.syncFailures, 'sync failures', 1000),
      updatedAt: nowIso(),
      updatedBy: INTEGRATIONS_ADMIN.name,
    };
    const before = s.thresholds;
    s.thresholds = next;
    audit(s, {
      action: 'usage.thresholds_changed',
      label: 'Changed usage alert thresholds',
      category: 'INTEGRATION',
      target: { type: 'USAGE', id: 'thresholds', name: 'Usage alert thresholds' },
      changes: (
        [
          'errorRatePercent',
          'latencyMs',
          'quotaPercent',
          'monthlyCostCents',
          'syncFailures',
        ] as const
      )
        .filter((key) => before[key] !== next[key])
        .map((key) => ({
          field: key,
          before: before[key] === null ? null : String(before[key]),
          after: next[key] === null ? null : String(next[key]),
        })),
    });
    return copy(next);
  },

  /** The module's audit entries, newest first; `targetId` narrows to one record. */
  auditTrail: async (
    query: { targetId?: string; page?: number; pageSize?: number } = {},
  ): Promise<Page<IntegrationAuditEntry>> => {
    await ready();
    const rows = db()
      .audit.filter((entry) => !query.targetId || entry.target.id === query.targetId)
      .sort((a, b) => time(b.at) - time(a.at));
    return pageOf(rows, query.page, query.pageSize ?? 10);
  },
};

/** The usage report for a scope and subject over whole UTC days. */
function usageReport(query: UsageQuery): UsageReport {
  const s = db();
  const scope = query.scope ?? 'PLATFORM_INTEGRATION';
  if (!USAGE_SCOPES.includes(scope)) throw invalid('Choose a usage scope.');
  const { from, to } = usageRange(query);
  const subjects = subjectsOf(s, scope);
  const subject = query.subject ?? null;
  if (subject && !subjects.some((item) => item.key === subject)) throw notFound('Usage subject');
  const rows = s.usage.filter(
    (row) =>
      row.scope === scope &&
      row.day >= from &&
      row.day <= to &&
      (subject === null || row.subjectKey === subject),
  );
  const byDay = new Map<string, UsageDay[]>();
  for (const row of rows) byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  const units = new Set(
    subjects
      .filter((item) => subject === null || item.key === subject)
      .map((item) => item.volumeUnit),
  );
  const sameUnit = units.size === 1 && !units.has(null);
  const series: UsageDay[] = [];
  for (let at = time(`${from}T00:00:00Z`); at <= time(`${to}T00:00:00Z`); at += DAY_MS) {
    const day = dayKey(new Date(at));
    const dayRows = byDay.get(day) ?? [];
    const totals = totalsOf(dayRows, sameUnit);
    series.push({
      day,
      requests: totals.requests,
      successes: totals.successes,
      failures: totals.failures,
      avgLatencyMs: totals.avgLatencyMs,
      volume: totals.volume,
      costCents: totals.costCents,
      connectedFirms: totals.connectedFirms,
      activeFirms: totals.activeFirms,
      connects: totals.connects,
      disconnects: totals.disconnects,
    });
  }
  const breakdown: UsageSubject[] = subjects
    .filter((item) => subject === null || item.key === subject)
    .map((item) => ({
      ...item,
      ...totalsOf(
        rows.filter((row) => row.subjectKey === item.key),
        item.volumeUnit !== null,
      ),
    }))
    .filter((item) => item.requests > 0 || item.connectedFirms !== null)
    .sort((a, b) => b.requests - a.requests);
  const planDistribution =
    scope === 'CATALOG'
      ? s.plans.map((plan) => ({
          planId: plan.id,
          planName: plan.name,
          firms: new Set(
            s.catalog
              .filter((item) => subject === null || item.provider === subject)
              .flatMap((item) => item.connectedFirmIds)
              .filter((firmId) => s.firms.find((firm) => firm.id === firmId)?.planId === plan.id),
          ).size,
        }))
      : [];
  return copy({
    scope,
    subject,
    from,
    to,
    series,
    totals: totalsOf(rows, sameUnit),
    subjects: breakdown,
    planDistribution,
    alerts: alertsOf(s, scope, breakdown),
  });
}
