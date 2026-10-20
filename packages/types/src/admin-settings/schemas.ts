import { z } from 'zod';
import {
  PlatformBrandAssetKind,
  PlatformDefaultSetKind,
  PlatformFeatureState,
  PlatformMaintenanceStatus,
  PlatformRetentionDisposition,
  PlatformRunStatus,
  ScanStatus,
} from '../db-enums.js';

// Super Admin System Settings (R55): the platform-wide settings of Firmivra. Designs:
// docs/mockups/super-admin/system-settings/ (the landing, General, Branding, Email & Notifications,
// Feature Management, Data & Retention, System Configuration & Maintenance, Defaults, and the
// developer instructions). Tables: R0 stage B7 (docs/work/R0-stage-b7-system-settings.md).
// Routes: /api/v1/admin/system-settings/..., Super Admin only.
// - Every save names the version it started from (409 SAVE_CONFLICT otherwise) and answers what
//   was stored. Secrets are referenced (an AWS Secrets Manager ARN), never stored or returned.
// - Security settings and audit retention are Audit & Security's (`api.adminAudit`); system health
//   is `api.firmApplications.systemStatus()` (`GET /admin/system-status`).
// - Controls the design shows with no table behind them are not here (the PR lists them): backups,
//   environment variables, cache and index tools, role templates, platform legal pages, custom CSS.
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const CalendarDate = z.iso.date();
const Name = (max: number) => z.string().trim().min(1, 'Enter a value').max(max);
const Optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable();
const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const OptionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => (s === '' ? null : s))
  .pipe(z.email().max(254).nullable())
  .nullable();
const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour like #0066FF');

export {
  PlatformBrandAssetKind as AdminBrandAssetKind,
  PlatformDefaultSetKind as AdminDefaultSetKind,
  PlatformFeatureState as AdminFeatureState,
  PlatformMaintenanceStatus as AdminMaintenanceStatus,
  PlatformRetentionDisposition as AdminRetentionDisposition,
  PlatformRunStatus as AdminRunStatus,
};

/** Stable `error.code` values of these routes, besides the generic ones. */
export const AdminSettingsErrorCode = z.enum([
  /** 409: someone saved after this was loaded; reload and reapply. */
  'SAVE_CONFLICT',
  /** 409: a feature others depend on, a dependency missing or off, or a cycle. */
  'FEATURE_DEPENDENCY',
  /** 409: the record's state does not allow this (a released hold, a finished window or run). */
  'STATE',
  /** 409: the upload expired, was used, or its bytes are not what was declared. */
  'UPLOAD_EXPIRED',
  'UPLOAD_MISMATCH',
  /** 409: the file is still being scanned or failed the scan. */
  'ASSET_NOT_READY',
]);
export type AdminSettingsErrorCode = z.infer<typeof AdminSettingsErrorCode>;

/** Who changed a record last, and when. */
export const AdminChangeStamp = z.object({
  updatedAt: DateTime,
  updatedBy: z.string().nullable(),
});
export type AdminChangeStamp = z.infer<typeof AdminChangeStamp>;

// ---------- The landing ----------

export const AdminSettingsCategory = z.enum([
  'GENERAL',
  'BRANDING',
  'EMAIL',
  'FEATURES',
  'RETENTION',
  'SECURITY',
  'SYSTEM',
  'MAINTENANCE',
  'DEFAULTS',
]);
export type AdminSettingsCategory = z.infer<typeof AdminSettingsCategory>;

/** GET /admin/system-settings: the landing's cards, System Information and Recent Changes. */
export const AdminSettingsOverview = z.object({
  categories: z.array(
    z.object({
      key: AdminSettingsCategory,
      /** The newest change in the category; null when never changed. */
      lastChangedAt: DateTime.nullable(),
      lastChangedBy: z.string().nullable(),
    }),
  ),
  system: z.object({
    /** The API's build version (package version or the release tag). */
    version: z.string(),
    /** "Production", "Development"... from configuration. */
    environment: z.string(),
    totalFirms: z.number().int(),
    totalUsers: z.number().int(),
    lastUpdatedAt: DateTime.nullable(),
  }),
  /** The window in force, else the next scheduled one. */
  maintenance: z
    .object({
      id: z.uuid(),
      title: z.string(),
      status: PlatformMaintenanceStatus,
      startsAt: DateTime,
      endsAt: DateTime,
    })
    .nullable(),
  /** The newest settings changes (audit rows), newest first. */
  recentChanges: z.array(
    z.object({ eventId: z.uuid(), label: z.string(), by: z.string().nullable(), at: DateTime }),
  ),
});
export type AdminSettingsOverview = z.infer<typeof AdminSettingsOverview>;

// ---------- Sections (platform_settings) ----------

export const AdminGeneralSettings = z.strictObject({
  platformName: Name(100),
  tagline: Optional(160),
  supportEmail: OptionalEmail,
  supportPhone: Optional(40),
  /** IANA, checked by the database ("America/New_York"). */
  defaultTimeZone: z.string().min(1).max(64),
  /** "en-US". */
  defaultLocale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use a locale like en-US'),
  /** ISO 4217 ("USD"). */
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/, 'Use a currency code like USD'),
  dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
  timeFormat: z.enum(['12H', '24H']),
  numberFormat: z.enum(['1,234.56', '1.234,56', '1 234,56']),
  preferences: z.strictObject({
    darkModeOption: z.boolean(),
    productUpdates: z.boolean(),
    helpCenter: z.boolean(),
    userFeedback: z.boolean(),
    maintenanceBanner: z.boolean(),
    betaFeatures: z.boolean(),
  }),
});
export type AdminGeneralSettings = z.infer<typeof AdminGeneralSettings>;

export const AdminBrandingSettings = z.strictObject({
  tagline: Optional(160),
  description: Optional(1000),
  colors: z.strictObject({
    primary: Hex.nullable(),
    secondary: Hex.nullable(),
    accent: Hex.nullable(),
    background: Hex.nullable(),
    text: Hex.nullable(),
    sidebar: Hex.nullable(),
  }),
  appearance: z.enum(['LIGHT', 'DARK', 'SYSTEM']),
  /** Users may pick their own appearance. */
  allowUserAppearance: z.boolean(),
  sidebarStyle: z.enum(['EXPANDED', 'COLLAPSED']),
  borderRadius: z.enum(['SMALL', 'MEDIUM', 'LARGE']),
  login: z.strictObject({ showLogo: z.boolean(), showTagline: z.boolean() }),
  portal: z.strictObject({ usePlatformBranding: z.boolean(), allowFirmBranding: z.boolean() }),
});
export type AdminBrandingSettings = z.infer<typeof AdminBrandingSettings>;

export const AdminRecipientGroup = z.enum(['SUPER_ADMINS', 'ALL_ADMINS', 'NOBODY']);
export const AdminEmailSettings = z.strictObject({
  fromName: Name(100),
  fromEmail: OptionalEmail,
  replyTo: OptionalEmail,
  cc: OptionalEmail,
  signature: Optional(4000),
  includeSignature: z.boolean(),
  /** Off globally overrides users' preferences. SMS needs a connected provider. */
  channels: z.strictObject({
    email: z.boolean(),
    inApp: z.boolean(),
    sms: z.boolean(),
    push: z.boolean(),
  }),
  digest: z.boolean(),
  recipients: z.strictObject({
    systemAlerts: AdminRecipientGroup,
    firmApplications: AdminRecipientGroup,
    billing: AdminRecipientGroup,
    securityAlerts: AdminRecipientGroup,
  }),
  maxRetries: z.number().int().min(0).max(10),
  retryBackoffMinutes: z.number().int().min(1).max(1440),
  dailyCapPerRecipient: z.number().int().min(1).max(1000),
});
export type AdminEmailSettings = z.infer<typeof AdminEmailSettings>;

const section = <S extends z.ZodType>(value: S) =>
  z.object({
    version: z.number().int(),
    updatedAt: DateTime,
    updatedBy: z.string().nullable(),
    value,
  });
const saveSection = <S extends z.ZodType>(value: S) =>
  z.strictObject({ version: z.number().int().min(1), value });

export const AdminGeneralSection = section(AdminGeneralSettings);
export type AdminGeneralSection = z.infer<typeof AdminGeneralSection>;
export const SaveAdminGeneralRequest = saveSection(AdminGeneralSettings);
export type SaveAdminGeneralRequest = z.input<typeof SaveAdminGeneralRequest>;
export const AdminBrandingSection = section(AdminBrandingSettings).extend({
  /** The asset in use per kind; null is Firmivra's built-in default. */
  assets: z.record(PlatformBrandAssetKind, z.lazy(() => AdminBrandAsset).nullable()),
});
export type AdminBrandingSection = z.infer<typeof AdminBrandingSection>;
export const SaveAdminBrandingRequest = saveSection(AdminBrandingSettings);
export type SaveAdminBrandingRequest = z.input<typeof SaveAdminBrandingRequest>;
export const AdminEmailSection = section(AdminEmailSettings).extend({
  /** Whether a custom SMTP server's secret is referenced (`smtp`); never the secret. */
  smtpConfigured: z.boolean(),
});
export type AdminEmailSection = z.infer<typeof AdminEmailSection>;
export const SaveAdminEmailRequest = saveSection(AdminEmailSettings);
export type SaveAdminEmailRequest = z.input<typeof SaveAdminEmailRequest>;

/** Send Test Email: the provider's answer; nothing is saved. */
export const AdminTestEmailRequest = z.strictObject({ to: Email });
export type AdminTestEmailRequest = z.input<typeof AdminTestEmailRequest>;
export const AdminTestEmailResult = z.object({
  accepted: z.boolean(),
  detail: z.string().nullable(),
});
export type AdminTestEmailResult = z.infer<typeof AdminTestEmailResult>;

/** GET /admin/system-settings/email/status: Email & Notifications' Email Delivery Status. */
export const AdminEmailStatus = z.object({
  /** How email leaves the platform: SES, an SMTP server, or only the log (development). */
  sender: z.enum(['SES', 'SMTP', 'LOG']),
  /** Whether a custom SMTP server's secret reference is set. */
  customSmtp: z.boolean(),
  /** The newest Send Test Email, from its audit row; null before the first one. */
  lastTest: z.object({ at: DateTime, accepted: z.boolean() }).nullable(),
  /**
   * The last 24 hours' delivery rate and bounces. They come from the firms' delivery records,
   * which the console's scope does not read: null until a platform-readable source exists.
   */
  deliveryRate24h: z.number().nullable(),
  bounced24h: z.number().int().nullable(),
});
export type AdminEmailStatus = z.infer<typeof AdminEmailStatus>;

/**
 * A service's state as the API can tell: ONLINE or DOWN when it was reached just now; CONFIGURED
 * when it is set up but not called (sending a message or a payment to test it would be real);
 * NOT_CONFIGURED when it is off (development) or missing.
 */
export const AdminServiceStatus = z.enum(['ONLINE', 'DOWN', 'CONFIGURED', 'NOT_CONFIGURED']);
export type AdminServiceStatus = z.infer<typeof AdminServiceStatus>;

/** GET /admin/system-settings/health: System Configuration's status and System Health. */
export const AdminSystemHealth = z.object({
  checkedAt: DateTime,
  services: z.array(
    z.object({
      key: z.enum(['api', 'database', 'storage', 'email', 'sms', 'payments']),
      status: AdminServiceStatus,
      /** What was checked or why it is not ("SES", "EMAIL_MODE is log"); never a secret. */
      detail: z.string().nullable(),
    }),
  ),
});
export type AdminSystemHealth = z.infer<typeof AdminSystemHealth>;

// ---------- Brand assets ----------

export const ADMIN_BRAND_ASSET_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  types: {
    LOGO: ['image/png', 'image/webp'],
    LOGO_DARK: ['image/png', 'image/webp'],
    FAVICON: ['image/png', 'image/x-icon'],
    APP_ICON: ['image/png'],
    LOGIN_BACKGROUND: ['image/jpeg', 'image/png', 'image/webp'],
  },
} as const;

export const AdminBrandAsset = z.object({
  id: z.uuid(),
  kind: PlatformBrandAssetKind,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  scanStatus: ScanStatus,
  /** A short-lived link while CLEAN; null otherwise. */
  url: z.string().nullable(),
  uploadedBy: z.string().nullable(),
  createdAt: DateTime,
});
export type AdminBrandAsset = z.infer<typeof AdminBrandAsset>;

export const CreateAdminBrandAssetUploadRequest = z.strictObject({
  kind: PlatformBrandAssetKind,
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^/\\]+$/, 'Use a plain file name'),
  contentType: z.enum(['image/png', 'image/webp', 'image/x-icon', 'image/jpeg']),
  sizeBytes: z.number().int().positive().max(ADMIN_BRAND_ASSET_LIMITS.maxBytes, 'Max size: 5 MB'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().min(1).max(8192).optional(),
  height: z.number().int().min(1).max(8192).optional(),
});
export type CreateAdminBrandAssetUploadRequest = z.input<typeof CreateAdminBrandAssetUploadRequest>;

export const AdminBrandAssetTicket = z.object({
  uploadToken: z.string(),
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: DateTime,
});
export type AdminBrandAssetTicket = z.infer<typeof AdminBrandAssetTicket>;

export const ConfirmAdminBrandAssetRequest = z.strictObject({
  uploadToken: z.string().min(1).max(8192),
});
export type ConfirmAdminBrandAssetRequest = z.input<typeof ConfirmAdminBrandAssetRequest>;

export const AdminBrandAssetList = z.object({ items: z.array(AdminBrandAsset) });
export type AdminBrandAssetList = z.infer<typeof AdminBrandAssetList>;

/** Use an uploaded, CLEAN asset of that kind (409 ASSET_NOT_READY otherwise). */
export const SetAdminBrandAssetRequest = z.strictObject({ assetId: z.uuid() });
export type SetAdminBrandAssetRequest = z.input<typeof SetAdminBrandAssetRequest>;

// ---------- Secrets (references only) ----------

export const AdminSecretRef = z.object({
  key: z.string(),
  /** The last characters the admin chose to show ("…4f2a"); never the secret. */
  hint: z.string().nullable(),
  configured: z.literal(true),
  rotatedAt: DateTime.nullable(),
  updatedAt: DateTime,
  updatedBy: z.string().nullable(),
});
export type AdminSecretRef = z.infer<typeof AdminSecretRef>;
export const AdminSecretRefList = z.object({ items: z.array(AdminSecretRef) });
export type AdminSecretRefList = z.infer<typeof AdminSecretRefList>;

/** Where the secret lives: an AWS Secrets Manager ARN (or `local:<name>` in development). */
export const SetAdminSecretRefRequest = z.strictObject({
  reference: z
    .string()
    .trim()
    .max(600)
    .regex(
      /^(arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+|local:[a-z0-9_.-]{1,100})$/,
      'Use a Secrets Manager ARN',
    ),
  hint: z
    .string()
    .regex(/^[A-Za-z0-9*._-]{1,8}$/)
    .nullable()
    .optional(),
});
export type SetAdminSecretRefRequest = z.input<typeof SetAdminSecretRefRequest>;
export const AdminSecretKey = z.string().regex(/^[a-z][a-z0-9_.]{0,99}$/);

// ---------- Features ----------

export const AdminFeatureKey = z
  .string()
  .regex(/^[a-z][a-z0-9_.]{0,79}$/, 'Use a key like reports.advanced');

export const AdminFeature = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  defaultState: PlatformFeatureState,
  emergencyDisabled: z.boolean(),
  dependsOn: z.array(z.string()),
  /** Features that need this one. */
  requiredBy: z.array(z.string()),
  /** How many firms have their own setting. */
  overrides: z.number().int(),
  updatedAt: DateTime,
  updatedBy: z.string().nullable(),
});
export type AdminFeature = z.infer<typeof AdminFeature>;

export const AdminFeatureQuery = z.strictObject({
  search: z.string().trim().max(100).optional(),
  state: z.enum(['ON', 'OFF', 'EMERGENCY_OFF']).optional(),
});
export type AdminFeatureQuery = z.input<typeof AdminFeatureQuery>;

/** Feature Management: the list and its stat cards. */
export const AdminFeatureList = z.object({
  items: z.array(AdminFeature),
  counts: z.object({
    total: z.number().int(),
    on: z.number().int(),
    off: z.number().int(),
    emergencyOff: z.number().int(),
  }),
});
export type AdminFeatureList = z.infer<typeof AdminFeatureList>;

export const CreateAdminFeatureRequest = z.strictObject({
  key: AdminFeatureKey,
  name: Name(100),
  description: Optional(1000).optional(),
  defaultState: PlatformFeatureState,
  dependsOn: z.array(AdminFeatureKey).max(20).optional(),
});
export type CreateAdminFeatureRequest = z.input<typeof CreateAdminFeatureRequest>;

export const UpdateAdminFeatureRequest = z.strictObject({
  name: Name(100).optional(),
  description: Optional(1000).optional(),
  defaultState: PlatformFeatureState.optional(),
  dependsOn: z.array(AdminFeatureKey).max(20).optional(),
});
export type UpdateAdminFeatureRequest = z.input<typeof UpdateAdminFeatureRequest>;

/** Emergency disable or re-enable: a reason, recorded at once. */
export const AdminFeatureEmergencyRequest = z.strictObject({
  disabled: z.boolean(),
  reason: z.string().trim().min(1, 'Say why').max(1000),
});
export type AdminFeatureEmergencyRequest = z.input<typeof AdminFeatureEmergencyRequest>;

export const AdminFeatureOverride = z.object({
  businessId: z.uuid(),
  firmName: z.string(),
  state: PlatformFeatureState,
  reason: z.string().nullable(),
  /** What the firm gets, after an emergency off or a required feature that is off. */
  effective: PlatformFeatureState,
  updatedAt: DateTime,
});
export type AdminFeatureOverride = z.infer<typeof AdminFeatureOverride>;
export const AdminFeatureOverrideList = z.object({ items: z.array(AdminFeatureOverride) });
export type AdminFeatureOverrideList = z.infer<typeof AdminFeatureOverrideList>;

export const SetAdminFeatureOverrideRequest = z.strictObject({
  state: PlatformFeatureState,
  reason: Optional(1000).optional(),
});
export type SetAdminFeatureOverrideRequest = z.input<typeof SetAdminFeatureOverrideRequest>;

// ---------- Data & Retention ----------

export const AdminRetentionPolicy = z.object({
  category: z.string(),
  retentionDays: z.number().int(),
  disposition: PlatformRetentionDisposition,
  archiveAfterDays: z.number().int().nullable(),
  /** The floor no change goes below. */
  minimumDays: z.number().int(),
  effectiveFrom: DateTime,
  version: z.number().int(),
  /** Active legal holds on the category. */
  activeHolds: z.number().int(),
  updatedAt: DateTime,
  updatedBy: z.string().nullable(),
});
export type AdminRetentionPolicy = z.infer<typeof AdminRetentionPolicy>;
export const AdminRetentionPolicyList = z.object({ items: z.array(AdminRetentionPolicy) });
export type AdminRetentionPolicyList = z.infer<typeof AdminRetentionPolicyList>;

/** A change applies from `effectiveFrom` (today or later), never backwards. */
export const UpdateAdminRetentionPolicyRequest = z.strictObject({
  version: z.number().int().min(1),
  retentionDays: z.number().int().min(1).max(36500),
  disposition: PlatformRetentionDisposition,
  archiveAfterDays: z.number().int().min(1).nullable(),
  effectiveFrom: CalendarDate.optional(),
});
export type UpdateAdminRetentionPolicyRequest = z.input<typeof UpdateAdminRetentionPolicyRequest>;

export const AdminRetentionRun = z.object({
  id: z.uuid(),
  category: z.string(),
  dryRun: z.boolean(),
  status: PlatformRunStatus,
  policyVersion: z.number().int().nullable(),
  eligibleCount: z.number().int().nullable(),
  affectedCount: z.number().int().nullable(),
  heldCount: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  requestedBy: z.string().nullable(),
  createdAt: DateTime,
  startedAt: DateTime.nullable(),
  finishedAt: DateTime.nullable(),
});
export type AdminRetentionRun = z.infer<typeof AdminRetentionRun>;
export const AdminRetentionRunList = z.object({ items: z.array(AdminRetentionRun) });
export type AdminRetentionRunList = z.infer<typeof AdminRetentionRunList>;

/** A run is queued for the retention worker; a dry run (the default) only counts. */
export const CreateAdminRetentionRunRequest = z.strictObject({
  dryRun: z.boolean().optional().default(true),
});
export type CreateAdminRetentionRunRequest = z.input<typeof CreateAdminRetentionRunRequest>;

export const AdminLegalHold = z.object({
  id: z.uuid(),
  name: z.string(),
  reason: z.string(),
  /** Exactly one of: a category, a firm, or one record. */
  category: z.string().nullable(),
  firm: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  record: z.object({ type: z.string(), id: z.string() }).nullable(),
  createdBy: z.string().nullable(),
  createdAt: DateTime,
  releasedAt: DateTime.nullable(),
  releaseReason: z.string().nullable(),
});
export type AdminLegalHold = z.infer<typeof AdminLegalHold>;
export const AdminLegalHoldList = z.object({ items: z.array(AdminLegalHold) });
export type AdminLegalHoldList = z.infer<typeof AdminLegalHoldList>;

export const CreateAdminLegalHoldRequest = z
  .strictObject({
    name: Name(120),
    reason: Name(2000),
    category: z.string().trim().min(1).max(60).optional(),
    businessId: z.uuid().optional(),
    record: z.strictObject({ type: Name(60), id: Name(100) }).optional(),
  })
  .refine(
    (h) => [h.category, h.businessId, h.record].filter((v) => v !== undefined).length === 1,
    'Hold exactly one of: a category, a firm, or a record',
  );
export type CreateAdminLegalHoldRequest = z.input<typeof CreateAdminLegalHoldRequest>;

export const ReleaseAdminLegalHoldRequest = z.strictObject({ reason: Name(2000) });
export type ReleaseAdminLegalHoldRequest = z.input<typeof ReleaseAdminLegalHoldRequest>;

// ---------- Maintenance and background jobs ----------

export const AdminMaintenanceWindow = z.object({
  id: z.uuid(),
  title: z.string(),
  message: z.string(),
  startsAt: DateTime,
  endsAt: DateTime,
  status: PlatformMaintenanceStatus,
  adminBypass: z.boolean(),
  startedAt: DateTime.nullable(),
  endedAt: DateTime.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
  updatedBy: z.string().nullable(),
});
export type AdminMaintenanceWindow = z.infer<typeof AdminMaintenanceWindow>;
export const AdminMaintenanceList = z.object({ items: z.array(AdminMaintenanceWindow) });
export type AdminMaintenanceList = z.infer<typeof AdminMaintenanceList>;

/** Schedule Maintenance. The end is after the start. */
export const CreateAdminMaintenanceRequest = z
  .strictObject({
    title: Name(120),
    message: Name(2000),
    startsAt: DateTime,
    endsAt: DateTime,
    adminBypass: z.boolean().optional().default(true),
  })
  .refine((w) => w.endsAt > w.startsAt, { path: ['endsAt'], message: 'End after the start' });
export type CreateAdminMaintenanceRequest = z.input<typeof CreateAdminMaintenanceRequest>;

/** A scheduled window changes freely; an active one only its message and end. */
export const UpdateAdminMaintenanceRequest = z.strictObject({
  title: Name(120).optional(),
  message: Name(2000).optional(),
  startsAt: DateTime.optional(),
  endsAt: DateTime.optional(),
  adminBypass: z.boolean().optional(),
});
export type UpdateAdminMaintenanceRequest = z.input<typeof UpdateAdminMaintenanceRequest>;

export const AdminJob = z.object({
  key: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  pausedReason: z.string().nullable(),
  lastRunAt: DateTime.nullable(),
  lastStatus: PlatformRunStatus.nullable(),
  lastError: z.string().nullable(),
  updatedAt: DateTime,
  updatedBy: z.string().nullable(),
});
export type AdminJob = z.infer<typeof AdminJob>;
export const AdminJobList = z.object({ items: z.array(AdminJob) });
export type AdminJobList = z.infer<typeof AdminJobList>;

export const PauseAdminJobRequest = z.strictObject({ reason: Name(500) });
export type PauseAdminJobRequest = z.input<typeof PauseAdminJobRequest>;
export const AdminJobKey = z.string().regex(/^[a-z][a-z0-9_.]{0,79}$/);

// ---------- Defaults for new firms and users ----------

export const AdminFirmDefaults = z.strictObject({
  /** A `platform_plans` code; null: chosen at approval. */
  planCode: z.string().max(40).nullable(),
  trialDays: z.number().int().min(0).max(365),
  timeZone: z.string().max(64).nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']).nullable(),
  /** Feature keys a new firm starts with on (never one that is off for the platform). */
  features: z.array(AdminFeatureKey).max(200),
  notifications: z.strictObject({ email: z.boolean(), sms: z.boolean(), inApp: z.boolean() }),
  onboarding: z.strictObject({ sendWelcomeEmail: z.boolean(), assignOnboardingTasks: z.boolean() }),
});
export type AdminFirmDefaults = z.infer<typeof AdminFirmDefaults>;

export const AdminUserDefaults = z.strictObject({
  /** A role below Owner and Admin (never privileged). */
  role: z.enum(['MANAGER', 'STAFF', 'BOOKKEEPER', 'TAX_PREPARER', 'CLIENT_SUPPORT', 'READ_ONLY']),
  requireEmailVerification: z.boolean(),
  timeZone: z.string().max(64).nullable(),
  locale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .nullable(),
  appearance: z.enum(['LIGHT', 'DARK', 'SYSTEM']).nullable(),
  notifications: z.strictObject({ email: z.boolean(), sms: z.boolean(), inApp: z.boolean() }),
  sendWelcomeEmail: z.boolean(),
});
export type AdminUserDefaults = z.infer<typeof AdminUserDefaults>;

/** The set in use (the newest version): new firms or users get it; existing ones never change. */
export const AdminFirmDefaultSet = z.object({
  id: z.uuid(),
  version: z.number().int(),
  values: AdminFirmDefaults,
  note: z.string().nullable(),
  createdAt: DateTime,
  createdBy: z.string().nullable(),
});
export type AdminFirmDefaultSet = z.infer<typeof AdminFirmDefaultSet>;
export const AdminUserDefaultSet = AdminFirmDefaultSet.extend({ values: AdminUserDefaults });
export type AdminUserDefaultSet = z.infer<typeof AdminUserDefaultSet>;

/** Save Changes: a new version of the set. */
export const SaveAdminFirmDefaultsRequest = z.strictObject({
  basedOnVersion: z.number().int().min(1),
  values: AdminFirmDefaults,
  note: Optional(500).optional(),
});
export type SaveAdminFirmDefaultsRequest = z.input<typeof SaveAdminFirmDefaultsRequest>;
export const SaveAdminUserDefaultsRequest = SaveAdminFirmDefaultsRequest.extend({
  values: AdminUserDefaults,
});
export type SaveAdminUserDefaultsRequest = z.input<typeof SaveAdminUserDefaultsRequest>;

export const AdminDefaultSetVersions = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      version: z.number().int(),
      note: z.string().nullable(),
      createdAt: DateTime,
      createdBy: z.string().nullable(),
      /** Firms provisioned with it (FIRM sets). */
      firms: z.number().int(),
    }),
  ),
});
export type AdminDefaultSetVersions = z.infer<typeof AdminDefaultSetVersions>;
