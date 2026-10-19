import { z } from 'zod';
import { SearchText } from '../clients/text.js';
import {
  IntegrationEnvironment,
  IntegrationSyncRunStatus,
  PlatformCatalogFirmAccess,
  PlatformCatalogPlanAccess,
  PlatformCatalogStatus,
  PlatformIntegrationCategory,
  PlatformIntegrationRunKind,
  PlatformIntegrationStatus,
  PlatformRole,
  PlatformUsageScope,
} from '../db-enums.js';

// Super Admin Integrations, part 1 (R0 stage B8; contract note docs/work/R0-stage-b8-integrations.md):
// the dashboard, Firmivra's own platform integrations (Stripe, Twilio, SES, S3, AI...) and the
// customer catalog firms may connect. API keys, webhooks, logs and usage are part 2.
// Routes: /api/v1/admin/integrations/... (the Super Admin site's session only).
// Field names follow Tumit's screens (apps/web/src/mocks/admin-integrations.ts) so they switch with
// few changes. Secrets never come back: a secret field shows only a masked hint, and credentials
// are kept in the secret store (the database holds a reference only).
// Responses are plain objects (a field the API adds later is dropped); requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const count = z.number().int().min(0);
const Url = z.url().max(500);
const paging = {
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
};
const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item).max(100),
    total: count,
    page: count.min(1),
    pageSize: count.min(1),
  });
const bool = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

export const AdminIntegrationId = z.uuid();
export const AdminCatalogItemId = z.uuid();

export const ADMIN_INTEGRATION_NAME_MAX = 80;
export const ADMIN_INTEGRATION_SHORT_DESCRIPTION_MAX = 250;
export const ADMIN_INTEGRATION_DESCRIPTION_MAX = 500;
export const ADMIN_INTEGRATION_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const ADMIN_INTEGRATION_LOGO_MAX_BYTES = 2_097_152;

export const ADMIN_INTEGRATION_CATEGORY_LABELS: Readonly<
  Record<PlatformIntegrationCategory, string>
> = {
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
export const ADMIN_INTEGRATION_STATUS_LABELS: Readonly<Record<PlatformIntegrationStatus, string>> =
  {
    DRAFT: 'Draft',
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
    NEEDS_ATTENTION: 'Needs Attention',
    ERROR: 'Error',
    DISABLED: 'Disabled',
    REMOVED: 'Removed',
  };

export const AdminIntegrationAuthType = z.enum([
  'API_KEY',
  'CLIENT_CREDENTIALS',
  'OAUTH',
  'ACCOUNT_KEYS',
]);
export const AdminIntegrationSyncSchedule = z.enum([
  'REALTIME',
  'EVERY_15_MINUTES',
  'HOURLY',
  'DAILY',
  'MANUAL',
]);
export const AdminIntegrationDataAccess = z.enum(['READ_ONLY', 'READ_WRITE']);
export const AdminIntegrationBackoff = z.enum(['EXPONENTIAL', 'FIXED']);
/** PLATFORM_ONLY: Firmivra's own use; CATALOG: also offered to firms (a catalog entry relies on it). */
export const AdminIntegrationFirmExposure = z.enum(['PLATFORM_ONLY', 'CATALOG']);
export const AdminIntegrationSetupStep = z.enum(['SERVICE', 'CONNECTION', 'SETTINGS', 'REVIEW']);
export const AdminIntegrationVolumeUnit = z.enum([
  'CENTS',
  'MESSAGES',
  'EMAILS',
  'BYTES',
  'TOKENS',
  'ENVELOPES',
  'RECORDS',
  'REQUESTS',
  'LOOKUPS',
]);
export const AdminIntegrationMetricUnit = z.enum([
  ...AdminIntegrationVolumeUnit.options,
  'COUNT',
  'PERCENT',
  'MS',
]);
export const AdminIntegrationPermission = z.enum([
  'VIEW',
  'TEST',
  'EDIT',
  'ROTATE_CREDENTIALS',
  'DISABLE_REMOVE',
]);
export const AdminCatalogRequiredRole = z.enum(['ANY', 'OWNER_ADMIN', 'OWNER']);
export const AdminCatalogAuthType = z.enum(['OAUTH', 'API_KEY', 'ACCOUNT_LINK', 'NONE']);

/** A logo's metadata; the file goes to S3 (platform/integrations/<id>/). */
export const AdminIntegrationLogo = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum(ADMIN_INTEGRATION_LOGO_TYPES),
  sizeBytes: z.number().int().min(1).max(ADMIN_INTEGRATION_LOGO_MAX_BYTES),
});
export type AdminIntegrationLogo = z.infer<typeof AdminIntegrationLogo>;

// ---------- Providers (definitions kept in code by the API) ----------

export const AdminConnectionField = z.object({
  key: z.string(),
  label: z.string(),
  /** Write-only: never returned after save, only a masked hint. */
  secret: z.boolean(),
  required: z.boolean(),
  kind: z.enum(['text', 'url']),
  placeholder: z.string(),
  hint: z.string().nullable(),
  /** Live and test values start differently, so the two never mix. */
  prefix: z.object({ LIVE: z.string(), TEST: z.string() }).nullable(),
});
export type AdminConnectionField = z.infer<typeof AdminConnectionField>;

export const AdminProviderTemplate = z.object({
  key: z.string(),
  name: z.string(),
  category: PlatformIntegrationCategory,
  description: z.string(),
  websiteUrl: z.string().nullable(),
  docsUrl: z.string().nullable(),
  statusUrl: z.string().nullable(),
  authType: AdminIntegrationAuthType,
  fields: z.array(AdminConnectionField),
  /** False: no test endpoint, so activation needs the admin's explicit confirmation. */
  supportsTest: z.boolean(),
  supportsOAuth: z.boolean(),
  /** False: the provider reports no uptime (the screens show N/A). */
  supportsUptime: z.boolean(),
  scopes: z.array(z.string()),
  /** Least privilege. */
  defaultScopes: z.array(z.string()),
  features: z.array(z.object({ key: z.string(), label: z.string(), description: z.string() })),
  /** The path Firmivra receives this provider's webhooks on, if it sends any. */
  webhookPath: z.string().nullable(),
  volumeUnit: AdminIntegrationVolumeUnit,
  volumeLabel: z.string(),
  requestLabel: z.string(),
});
export type AdminProviderTemplate = z.infer<typeof AdminProviderTemplate>;

// ---------- Platform integrations ----------

export const AdminConnectionValue = AdminConnectionField.extend({
  /** Non-secret: the value. Secret: a masked hint (`sk_live_••••4242`). Null: not set yet. */
  display: z.string().nullable(),
  updatedAt: DateTime.nullable(),
});
export type AdminConnectionValue = z.infer<typeof AdminConnectionValue>;

export const AdminPlatformConnection = z.object({
  authType: AdminIntegrationAuthType,
  fields: z.array(AdminConnectionValue),
  webhookUrl: z.string().nullable(),
  /** OAuth providers only. */
  oauth: z
    .object({
      connected: z.boolean(),
      account: z.string().nullable(),
      connectedAt: DateTime.nullable(),
    })
    .nullable(),
  secretRotatedAt: DateTime.nullable(),
  /** Every required field is set. */
  complete: z.boolean(),
});
export type AdminPlatformConnection = z.infer<typeof AdminPlatformConnection>;

export const AdminPlatformSettings = z.object({
  scopes: z.array(z.string().max(100)).max(50),
  syncSchedule: AdminIntegrationSyncSchedule,
  /** Enabled feature keys (the provider's `features`). */
  features: z.array(z.string().max(100)).max(50),
  dataAccess: AdminIntegrationDataAccess,
  retry: z.object({
    maxRetries: z.number().int().min(0).max(10),
    backoff: AdminIntegrationBackoff,
  }),
  firmExposure: AdminIntegrationFirmExposure,
});
export type AdminPlatformSettings = z.infer<typeof AdminPlatformSettings>;

/** Why it needs attention or failed, with the recommended action. */
export const AdminStatusReason = z.object({
  code: z.string(),
  message: z.string(),
  recommendedAction: z.string(),
});
export const AdminIntegrationError = z.object({
  code: z.string(),
  /** The short form the list shows ("Connection failed"). */
  title: z.string(),
  message: z.string(),
  at: DateTime,
  logId: z.string().nullable(),
  requestId: z.string().nullable(),
});

export const AdminPlatformIntegration = z.object({
  id: AdminIntegrationId,
  /** The readable id the manage page shows ("int_001"). */
  reference: z.string(),
  /** The provider key ("stripe"); `custom_<name>` without a template. */
  provider: z.string(),
  name: z.string(),
  category: PlatformIntegrationCategory,
  description: z.string(),
  longDescription: z.string().nullable(),
  logo: AdminIntegrationLogo.nullable(),
  websiteUrl: z.string().nullable(),
  docsUrl: z.string().nullable(),
  statusUrl: z.string().nullable(),
  environment: IntegrationEnvironment,
  status: PlatformIntegrationStatus,
  statusReason: AdminStatusReason.nullable(),
  connection: AdminPlatformConnection,
  settings: AdminPlatformSettings,
  lastCheckAt: DateTime.nullable(),
  lastCheckOk: z.boolean().nullable(),
  lastCheckMessage: z.string().nullable(),
  lastSyncAt: DateTime.nullable(),
  lastSyncOk: z.boolean().nullable(),
  /** Percent over the last 30 days; null is N/A. */
  uptime30d: z.number().min(0).max(100).nullable(),
  supportsTest: z.boolean(),
  supportsUptime: z.boolean(),
  /** Critical infrastructure: removal needs the name typed. */
  critical: z.boolean(),
  activatedWithoutTest: z.boolean(),
  activatedAt: DateTime.nullable(),
  disabledAt: DateTime.nullable(),
  removedAt: DateTime.nullable(),
  /** Drafts only: the wizard step it was left on. */
  setupStep: AdminIntegrationSetupStep,
  latestError: AdminIntegrationError.nullable(),
  sortOrder: z.number().int(),
  version: z.number().int().min(1),
  createdAt: DateTime,
  updatedAt: DateTime,
  updatedBy: z.string().nullable(),
});
export type AdminPlatformIntegration = z.infer<typeof AdminPlatformIntegration>;

export const AdminUsageHighlight = z.object({
  key: z.string(),
  label: z.string(),
  /** Null is N/A. */
  value: z.number().nullable(),
  unit: AdminIntegrationMetricUnit,
});

export const AdminIntegrationAccessRule = z.object({
  permission: AdminIntegrationPermission,
  label: z.string(),
  description: z.string(),
  roles: z.array(PlatformRole),
  /** Fixed by policy (Super Admin only). */
  locked: z.boolean(),
});

export const AdminPlatformIntegrationDetail = AdminPlatformIntegration.extend({
  /** What depends on it: warn before disabling or removing. */
  dependents: z.object({
    catalog: z.array(z.object({ id: z.uuid(), name: z.string(), status: PlatformCatalogStatus })),
    webhooks: z.array(z.object({ id: z.uuid(), url: z.string() })),
  }),
  /** The last 30 days in the provider's own units. */
  highlights: z.array(AdminUsageHighlight),
  accessControl: z.array(AdminIntegrationAccessRule),
});
export type AdminPlatformIntegrationDetail = z.infer<typeof AdminPlatformIntegrationDetail>;

/** GET /admin/integrations/platform: the filters combine with AND. */
export const ListAdminPlatformQuery = z.strictObject({
  search: SearchText.optional(),
  category: PlatformIntegrationCategory.optional(),
  /** One status or several, comma separated (NEEDS_ATTENTION,ERROR). */
  status: z
    .string()
    .max(200)
    .refine(
      (v) => v.split(',').every((s) => PlatformIntegrationStatus.safeParse(s).success),
      'Unknown status',
    )
    .optional(),
  environment: IntegrationEnvironment.optional(),
  /** Removed tombstones are left out unless asked for (or `status` names REMOVED). */
  includeRemoved: bool,
  sort: z.enum(['order', 'name', 'category', 'status', 'lastSync']).optional().default('order'),
  descending: bool,
  ...paging,
});
export type ListAdminPlatformQuery = z.input<typeof ListAdminPlatformQuery>;
export const ListAdminPlatformResponse = page(AdminPlatformIntegration);
export type ListAdminPlatformResponse = z.infer<typeof ListAdminPlatformResponse>;

const Name = z.string().trim().min(1, 'Enter a name').max(ADMIN_INTEGRATION_NAME_MAX);
const ShortDescription = z
  .string()
  .trim()
  .min(1, 'Describe it')
  .max(ADMIN_INTEGRATION_SHORT_DESCRIPTION_MAX);
const LongDescription = z.string().trim().max(ADMIN_INTEGRATION_DESCRIPTION_MAX);

/** POST /admin/integrations/platform: the wizard's step 1 saves a DRAFT; nothing runs yet. */
export const CreateAdminPlatformRequest = z.strictObject({
  /** A key from `providers()`; without it the name picks the template, or a custom one. */
  provider: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,59}$/)
    .optional(),
  name: Name,
  category: PlatformIntegrationCategory,
  description: ShortDescription,
  longDescription: LongDescription.nullable().optional(),
  logo: AdminIntegrationLogo.nullable().optional(),
  websiteUrl: Url.nullable().optional(),
  docsUrl: Url.nullable().optional(),
  /** TEST unless chosen (least privilege). */
  environment: IntegrationEnvironment.optional().default('TEST'),
});
export type CreateAdminPlatformRequest = z.input<typeof CreateAdminPlatformRequest>;

/**
 * PATCH /admin/integrations/platform/:id with the `version` read (409 CONFLICT when stale). Secrets
 * never go here (`putCredentials`). Changing the environment of a configured integration clears
 * its credentials and needs `confirmEnvironmentChange`.
 */
export const UpdateAdminPlatformRequest = z.strictObject({
  version: z.number().int().min(1),
  name: Name.optional(),
  category: PlatformIntegrationCategory.optional(),
  description: ShortDescription.optional(),
  longDescription: LongDescription.nullable().optional(),
  logo: AdminIntegrationLogo.nullable().optional(),
  websiteUrl: Url.nullable().optional(),
  docsUrl: Url.nullable().optional(),
  environment: IntegrationEnvironment.optional(),
  confirmEnvironmentChange: z.boolean().optional(),
  /** Non-secret connection fields only (base URL, account id). */
  connection: z.record(z.string().max(100), z.string().max(500)).optional(),
  settings: AdminPlatformSettings.partial().optional(),
  setupStep: AdminIntegrationSetupStep.optional(),
});
export type UpdateAdminPlatformRequest = z.input<typeof UpdateAdminPlatformRequest>;

/** PUT .../credentials (Super Admin): every value goes to the secret store; a rotation is stamped. */
export const PutAdminCredentialsRequest = z.strictObject({
  values: z
    .record(z.string().max(100), z.string().min(1).max(4000))
    .refine((v) => Object.keys(v).length > 0, 'Enter at least one value'),
});
export type PutAdminCredentialsRequest = z.input<typeof PutAdminCredentialsRequest>;

/** POST .../activate (Super Admin): after a passing test, or confirmed for a provider with none. */
export const ActivateAdminPlatformRequest = z.strictObject({
  confirmWithoutTest: z.boolean().optional(),
});
export type ActivateAdminPlatformRequest = z.input<typeof ActivateAdminPlatformRequest>;
/** POST .../disable (Super Admin): stops jobs and new calls; keeps the configuration. */
export const DisableAdminPlatformRequest = z.strictObject({
  reason: z.string().trim().max(500).optional(),
});
export type DisableAdminPlatformRequest = z.input<typeof DisableAdminPlatformRequest>;
/** POST .../remove (Super Admin): final; a critical integration needs its name typed. */
export const RemoveAdminPlatformRequest = z.strictObject({
  confirmation: z.string().max(100).optional(),
});
export type RemoveAdminPlatformRequest = z.input<typeof RemoveAdminPlatformRequest>;

export const AdminPlatformRun = z.object({
  id: z.uuid(),
  integrationId: AdminIntegrationId,
  kind: PlatformIntegrationRunKind,
  status: IntegrationSyncRunStatus,
  trigger: z.enum(['SCHEDULE', 'MANUAL']),
  requestedBy: z.string().nullable(),
  createdAt: DateTime,
  startedAt: DateTime.nullable(),
  finishedAt: DateTime.nullable(),
  durationMs: count.nullable(),
  objectCount: count,
  failedCount: count,
  retries: count,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  correlationId: z.string(),
  logId: z.string().nullable(),
});
export type AdminPlatformRun = z.infer<typeof AdminPlatformRun>;

export const ListAdminPlatformRunsQuery = z.strictObject({
  kind: PlatformIntegrationRunKind.optional(),
  status: IntegrationSyncRunStatus.optional(),
  ...paging,
});
export type ListAdminPlatformRunsQuery = z.input<typeof ListAdminPlatformRunsQuery>;
export const ListAdminPlatformRunsResponse = page(AdminPlatformRun);
export type ListAdminPlatformRunsResponse = z.infer<typeof ListAdminPlatformRunsResponse>;

/** POST .../test: a connection test; tells a provider outage from bad credentials. */
export const AdminConnectionTestResult = z.object({
  ok: z.boolean(),
  kind: z.enum(['OK', 'INVALID_CREDENTIALS', 'PROVIDER_UNAVAILABLE', 'MISSING_CONFIGURATION']),
  at: DateTime,
  latencyMs: count.nullable(),
  /** Safe to show: never a secret. */
  message: z.string(),
  errorCode: z.string().nullable(),
  requestId: z.string(),
  runId: z.uuid(),
  logId: z.string(),
  integration: AdminPlatformIntegrationDetail,
});
export type AdminConnectionTestResult = z.infer<typeof AdminConnectionTestResult>;

// ---------- Catalog ----------

export const AdminCatalogSetupField = z.object({
  key: z.string().max(100),
  label: z.string().max(100),
  secret: z.boolean(),
  required: z.boolean(),
  help: z.string().max(300).nullable(),
});
/** The customer connection experience; never Super Admin secrets. */
export const AdminCatalogSetup = z.object({
  authType: AdminCatalogAuthType,
  instructions: z.string().max(2000),
  requiredFields: z.array(AdminCatalogSetupField).max(20),
  helpText: z.string().max(500).nullable(),
  /** Run a connection test when a firm connects. */
  testOnConnect: z.boolean(),
});
export type AdminCatalogSetup = z.infer<typeof AdminCatalogSetup>;

export const AdminCatalogAdvanced = z.object({
  featureFlag: z.string().max(100).nullable(),
  beta: z.boolean(),
  deprecationNotice: z.string().max(300).nullable(),
  minAppVersion: z.string().max(20).nullable(),
  rolloutPercent: z.number().int().min(0).max(100),
  /** Two-letter US state codes; empty is everywhere. */
  regions: z.array(z.string().regex(/^[A-Z]{2}$/)).max(60),
});
export type AdminCatalogAdvanced = z.infer<typeof AdminCatalogAdvanced>;

export const AdminCatalogFirmRule = z.object({
  businessId: z.uuid(),
  firmName: z.string(),
  planName: z.string(),
  access: PlatformCatalogFirmAccess,
  reason: z.string().nullable(),
  updatedAt: DateTime,
  updatedBy: z.string(),
});
export type AdminCatalogFirmRule = z.infer<typeof AdminCatalogFirmRule>;

/** Adoption from the daily rollup (cross-firm counts only, never a firm's own connection). */
export const AdminCatalogStats = z.object({
  firmsUsing: count,
  activeFirms: count,
  totalConnections: count,
  connects30d: count,
  disconnects30d: count,
  lastActivityAt: DateTime.nullable(),
  uptime30d: z.number().min(0).max(100).nullable(),
});

export const AdminCatalogItem = z.object({
  id: AdminCatalogItemId,
  /** Never changes; matches the firms' `integration_connections.provider`. */
  provider: z.string(),
  name: z.string(),
  category: PlatformIntegrationCategory,
  shortDescription: z.string(),
  description: z.string().nullable(),
  logo: AdminIntegrationLogo.nullable(),
  websiteUrl: z.string().nullable(),
  helpUrl: z.string().nullable(),
  displayLabel: z.string().nullable(),
  status: PlatformCatalogStatus,
  planAccess: PlatformCatalogPlanAccess,
  plans: z.array(z.object({ id: z.uuid(), name: z.string() })),
  firmRules: z.array(AdminCatalogFirmRule),
  requiredRole: AdminCatalogRequiredRole,
  setup: AdminCatalogSetup,
  badges: z.array(z.string()),
  sortOrder: z.number().int(),
  advanced: AdminCatalogAdvanced,
  platformIntegration: z
    .object({
      id: AdminIntegrationId,
      name: z.string(),
      status: PlatformIntegrationStatus,
      environment: IntegrationEnvironment,
      lastCheckAt: DateTime.nullable(),
      lastCheckOk: z.boolean().nullable(),
    })
    .nullable(),
  stats: AdminCatalogStats,
  version: z.number().int().min(1),
  createdAt: DateTime,
  updatedAt: DateTime,
  updatedBy: z.string().nullable(),
});
export type AdminCatalogItem = z.infer<typeof AdminCatalogItem>;

/** GET /admin/integrations/catalog. */
export const ListAdminCatalogQuery = z.strictObject({
  search: SearchText.optional(),
  status: PlatformCatalogStatus.optional(),
  /** A plan id: the entries that plan can see. */
  plan: z.uuid().optional(),
  category: PlatformIntegrationCategory.optional(),
  sort: z.enum(['order', 'name', 'category', 'customers', 'status']).optional().default('order'),
  descending: bool,
  ...paging,
});
export type ListAdminCatalogQuery = z.input<typeof ListAdminCatalogQuery>;
export const ListAdminCatalogResponse = page(AdminCatalogItem);
export type ListAdminCatalogResponse = z.infer<typeof ListAdminCatalogResponse>;

/** POST /admin/integrations/catalog: a new entry starts DISABLED, on all plans. */
export const CreateAdminCatalogRequest = z.strictObject({
  provider: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, 'Use a key like quickbooks_online'),
  name: Name,
  category: PlatformIntegrationCategory,
  shortDescription: ShortDescription,
  description: LongDescription.nullable().optional(),
  websiteUrl: Url.nullable().optional(),
  helpUrl: Url.nullable().optional(),
  platformIntegrationId: AdminIntegrationId.nullable().optional(),
});
export type CreateAdminCatalogRequest = z.input<typeof CreateAdminCatalogRequest>;

/**
 * PATCH /admin/integrations/catalog/:id with the `version` read. A save that removes access from
 * connected firms answers 409 ACCESS_LOSS with their count; resend with `confirmAccessLoss`.
 */
export const UpdateAdminCatalogRequest = z.strictObject({
  version: z.number().int().min(1),
  name: Name.optional(),
  category: PlatformIntegrationCategory.optional(),
  shortDescription: ShortDescription.optional(),
  description: LongDescription.nullable().optional(),
  logo: AdminIntegrationLogo.nullable().optional(),
  websiteUrl: Url.nullable().optional(),
  helpUrl: Url.nullable().optional(),
  displayLabel: z.string().trim().max(40).nullable().optional(),
  status: PlatformCatalogStatus.optional(),
  planAccess: PlatformCatalogPlanAccess.optional(),
  planIds: z.array(z.uuid()).max(20).optional(),
  requiredRole: AdminCatalogRequiredRole.optional(),
  setup: AdminCatalogSetup.partial().optional(),
  badges: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  advanced: AdminCatalogAdvanced.partial().optional(),
  platformIntegrationId: AdminIntegrationId.nullable().optional(),
  confirmAccessLoss: z.boolean().optional(),
});
export type UpdateAdminCatalogRequest = z.input<typeof UpdateAdminCatalogRequest>;

export const AdminConfirmAccessLoss = z.strictObject({ confirmAccessLoss: z.boolean().optional() });
export type AdminConfirmAccessLoss = z.input<typeof AdminConfirmAccessLoss>;
/** PUT .../firms/:businessId: a firm's ALLOW or DENY (it overrides the plan). */
export const PutAdminCatalogFirmRequest = z.strictObject({
  access: PlatformCatalogFirmAccess,
  reason: z.string().trim().max(300).nullable().optional(),
  confirmAccessLoss: z.boolean().optional(),
});
export type PutAdminCatalogFirmRequest = z.input<typeof PutAdminCatalogFirmRequest>;

/** GET .../preview: how firms see it; never live customer data. */
export const AdminCatalogPreview = z.object({
  id: AdminCatalogItemId,
  name: z.string(),
  category: PlatformIntegrationCategory,
  shortDescription: z.string(),
  description: z.string().nullable(),
  logo: AdminIntegrationLogo.nullable(),
  badges: z.array(z.string()),
  status: PlatformCatalogStatus,
  hidden: z.boolean(),
  connectable: z.boolean(),
  /** "Connect", "Coming Soon" or "Not available". */
  connectLabel: z.string(),
  setup: AdminCatalogSetup,
  websiteUrl: z.string().nullable(),
  helpUrl: z.string().nullable(),
  deprecationNotice: z.string().nullable(),
});
export type AdminCatalogPreview = z.infer<typeof AdminCatalogPreview>;

// ---------- Dashboard and options ----------

export const AdminIntegrationSummary = z.object({
  /** Platform integrations (not removed) plus catalog entries. */
  total: count,
  platformTotal: count,
  active: count,
  inactive: count,
  needsAttention: count,
  errors: count,
  disabled: count,
  drafts: count,
  uptime30d: z.number().min(0).max(100).nullable(),
  catalog: z.object({
    total: count,
    enabled: count,
    disabled: count,
    comingSoon: count,
    addedThisMonth: count,
  }),
});
export type AdminIntegrationSummary = z.infer<typeof AdminIntegrationSummary>;

/** What the signed-in admin may do here. */
export const AdminIntegrationAccess = z.object({
  role: PlatformRole,
  canView: z.boolean(),
  canManageConfiguration: z.boolean(),
  canManageSecrets: z.boolean(),
  canLifecycle: z.boolean(),
});
export type AdminIntegrationAccess = z.infer<typeof AdminIntegrationAccess>;

export const AdminPlanOption = z.object({ id: z.uuid(), code: z.string(), name: z.string() });
export type AdminPlanOption = z.infer<typeof AdminPlanOption>;
export const AdminFirmOption = z.object({
  id: z.uuid(),
  name: z.string(),
  planId: z.uuid().nullable(),
  planName: z.string().nullable(),
});
export type AdminFirmOption = z.infer<typeof AdminFirmOption>;
export const ListAdminFirmOptionsQuery = z.strictObject({ search: SearchText.optional() });
export type ListAdminFirmOptionsQuery = z.input<typeof ListAdminFirmOptionsQuery>;

/** GET .../usage (an integration's), part 2 defines the full report; here the day range. */
export const AdminUsageRangeQuery = z.strictObject({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type AdminUsageRangeQuery = z.input<typeof AdminUsageRangeQuery>;
export const AdminUsageScope = PlatformUsageScope;

export const AdminIntegrationErrorCode = z.enum([
  'NOT_FOUND',
  /** A save named an old `version`. */
  'CONFLICT',
  /** Another live connection has this provider and environment. */
  'DUPLICATE_CONNECTION',
  /** A catalog entry with this provider exists. */
  'DUPLICATE_PROVIDER',
  /** Activation needs a passing connection test first. */
  'TEST_REQUIRED',
  /** A required connection field is empty. */
  'CREDENTIALS_REQUIRED',
  /** The action needs its confirmation flag (or the typed name). */
  'CONFIRMATION_REQUIRED',
  /** A catalog save removes access from connected firms; resend with `confirmAccessLoss`. */
  'ACCESS_LOSS',
  /** The action does not apply in the current status. */
  'INVALID_STATE',
]);
export type AdminIntegrationErrorCode = z.infer<typeof AdminIntegrationErrorCode>;

export const ADMIN_INTEGRATION_ERRORS: Readonly<Record<AdminIntegrationErrorCode, string>> = {
  NOT_FOUND: 'This is no longer available. The list is now up to date.',
  CONFLICT: 'Someone saved this after you opened it. Reload and try again.',
  DUPLICATE_CONNECTION: 'This provider is already connected in that environment.',
  DUPLICATE_PROVIDER: 'The catalog already has an entry for this provider.',
  TEST_REQUIRED: 'Run a passing connection test before activating.',
  CREDENTIALS_REQUIRED: 'Enter every required connection value first.',
  CONFIRMATION_REQUIRED: 'Confirm this action to continue.',
  ACCESS_LOSS: 'Firms that are connected would lose access. Confirm to save anyway.',
  INVALID_STATE: 'This cannot be done while the integration is in its current status.',
};
