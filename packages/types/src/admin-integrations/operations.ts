import { z } from 'zod';
import { SearchText } from '../clients/text.js';
import {
  IntegrationEnvironment,
  PlatformDeliveryStatus,
  PlatformExportStatus,
  PlatformIntegrationCategory,
  PlatformIntegrationLogSeverity,
  PlatformIntegrationLogSource,
  PlatformIntegrationStatus,
  PlatformUsageScope,
  PlatformWebhookDirection,
  PlatformWebhookStatus,
} from '../db-enums.js';
import { AdminIntegrationVolumeUnit } from './schemas.js';

// Super Admin Integrations, part 2 (R0 stage B8): Firmivra's API keys, webhook endpoints and their
// deliveries, the central integration log and its export (B1 export jobs), the usage report from
// the daily rollup, and the module's audit trail. Routes: /api/v1/admin/integrations/... Field
// names follow Tumit's screens (apps/web/src/mocks/admin-integrations.ts). A full API key or
// signing secret comes back once, when it is issued; afterwards only its prefix and last four or a
// mask. Where B8 keeps nothing (a delivery's payload, a key's peak rate, alert thresholds) the
// field is null or empty, never a made-up number.

const DateTime = z.iso.datetime({ offset: true });
const count = z.number().int().min(0);
const paging = (pageSize = 25) => ({
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(pageSize),
});
const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item).max(100),
    total: count,
    page: count.min(1),
    pageSize: count.min(1),
  });
const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true'));
const Trace = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/, 'Use a request or correlation id');
const Https = z
  .url()
  .max(2048)
  .refine((v) => v.startsWith('https://'), 'The address must start with https://');

// ---------- API keys ----------

export const ADMIN_API_SCOPES = [
  'firms:read',
  'integrations:read',
  'integrations:write',
  'webhooks:manage',
  'usage:read',
  'logs:read',
] as const;
export const AdminApiScope = z.enum(ADMIN_API_SCOPES);
export type AdminApiScope = z.infer<typeof AdminApiScope>;
export const ADMIN_API_SCOPE_LABELS: Readonly<Record<AdminApiScope, string>> = {
  'firms:read': 'Read firms',
  'integrations:read': 'Read integrations',
  'integrations:write': 'Change integrations',
  'webhooks:manage': 'Manage webhooks',
  'usage:read': 'Read usage',
  'logs:read': 'Read logs',
};
/** The system-wide ceiling when a key sets no rate limit of its own. */
export const ADMIN_API_RATE_LIMIT_MAX = 1000;
export const AdminApiKeyStatus = z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']);
export type AdminApiKeyStatus = z.infer<typeof AdminApiKeyStatus>;
export const AdminApiKeyId = z.uuid();

export const AdminApiKey = z.object({
  id: AdminApiKeyId,
  name: z.string(),
  /** `fv_live_…` or `fv_test_…`: names the environment. */
  prefix: z.string(),
  lastFour: z.string(),
  scopes: z.array(z.string()),
  environment: IntegrationEnvironment,
  /** Null: the system ceiling (`ADMIN_API_RATE_LIMIT_MAX`). */
  rateLimitPerMinute: z.number().int().nullable(),
  expiresAt: DateTime.nullable(),
  lastUsedAt: DateTime.nullable(),
  rotatedFromId: z.uuid().nullable(),
  rotatedToId: z.uuid().nullable(),
  revokedAt: DateTime.nullable(),
  revokedBy: z.string().nullable(),
  createdAt: DateTime,
  createdBy: z.string().nullable(),
  status: AdminApiKeyStatus,
  /** The rollup's latest day; the peak and the limited calls are not tracked yet (null). */
  usage24h: z.object({
    requests: count.nullable(),
    peakPerMinute: count.nullable(),
    rateLimited: count.nullable(),
  }),
});
export type AdminApiKey = z.infer<typeof AdminApiKey>;

/** The full key, shown once: only its SHA-256 hash is kept. */
export const AdminIssuedApiKey = z.object({ key: AdminApiKey, secret: z.string() });
export type AdminIssuedApiKey = z.infer<typeof AdminIssuedApiKey>;

export const ListAdminApiKeysQuery = z.strictObject({
  status: AdminApiKeyStatus.optional(),
  environment: IntegrationEnvironment.optional(),
});
export type ListAdminApiKeysQuery = z.input<typeof ListAdminApiKeysQuery>;

/** POST /admin/integrations/api-keys (Super Admin). */
export const CreateAdminApiKeyRequest = z.strictObject({
  name: z.string().trim().min(1, 'Name the key').max(60),
  environment: IntegrationEnvironment,
  scopes: z.array(AdminApiScope).min(1, 'Choose at least one scope').max(ADMIN_API_SCOPES.length),
  rateLimitPerMinute: z.number().int().min(1).max(ADMIN_API_RATE_LIMIT_MAX).nullable().optional(),
  /** Null or left out: never expires. */
  expiresAt: DateTime.nullable().optional(),
});
export type CreateAdminApiKeyRequest = z.input<typeof CreateAdminApiKeyRequest>;

export const RevokeAdminApiKeyRequest = z.strictObject({
  reason: z.string().trim().max(300).optional(),
});
export type RevokeAdminApiKeyRequest = z.input<typeof RevokeAdminApiKeyRequest>;

// ---------- Webhooks ----------

/** The events Firmivra sends to an outbound endpoint. */
export const ADMIN_WEBHOOK_EVENTS = [
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
const EventKey = z
  .string()
  .regex(/^[a-z][a-z0-9_.:-]{0,79}$/, 'Use an event name like invoice.paid');
export const AdminWebhookId = z.uuid();
export const AdminWebhookDeliveryId = z.uuid();

export const AdminWebhookEndpoint = z.object({
  id: AdminWebhookId,
  direction: PlatformWebhookDirection,
  url: z.string(),
  description: z.string().nullable(),
  events: z.array(z.string()),
  status: PlatformWebhookStatus,
  maxRetries: count,
  /** A mask (`whsec_••••••••`) when a signing secret is set; the secret itself is never shown. */
  signingSecretHint: z.string().nullable(),
  secretRotatedAt: DateTime.nullable(),
  /** B8 links no endpoint to an integration yet: always null. */
  integration: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
  stats: z.object({
    deliveries7d: count,
    failures7d: count,
    lastDeliveryAt: DateTime.nullable(),
    lastStatus: PlatformDeliveryStatus.nullable(),
  }),
});
export type AdminWebhookEndpoint = z.infer<typeof AdminWebhookEndpoint>;

/** The signing secret, shown once (at creation or rotation); null otherwise. */
export const AdminWebhookWithSecret = z.object({
  endpoint: AdminWebhookEndpoint,
  signingSecret: z.string().nullable(),
});
export type AdminWebhookWithSecret = z.infer<typeof AdminWebhookWithSecret>;

export const ListAdminWebhooksQuery = z.strictObject({
  direction: PlatformWebhookDirection.optional(),
  status: PlatformWebhookStatus.optional(),
});
export type ListAdminWebhooksQuery = z.input<typeof ListAdminWebhooksQuery>;

/** POST /admin/integrations/webhooks (Super Admin): https only; outbound events from the list. */
export const CreateAdminWebhookRequest = z.strictObject({
  direction: PlatformWebhookDirection,
  url: Https,
  description: z.string().trim().max(200).nullable().optional(),
  events: z.array(EventKey).min(1, 'Choose at least one event').max(100),
  maxRetries: z.number().int().min(0).max(10).optional(),
});
export type CreateAdminWebhookRequest = z.input<typeof CreateAdminWebhookRequest>;

/** PATCH /admin/integrations/webhooks/:id; `rotateSecret` issues a new signing secret, once. */
export const UpdateAdminWebhookRequest = z.strictObject({
  url: Https.optional(),
  description: z.string().trim().max(200).nullable().optional(),
  events: z.array(EventKey).min(1).max(100).optional(),
  status: PlatformWebhookStatus.optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  rotateSecret: z.boolean().optional(),
});
export type UpdateAdminWebhookRequest = z.input<typeof UpdateAdminWebhookRequest>;

export const AdminWebhookDelivery = z.object({
  id: AdminWebhookDeliveryId,
  endpointId: AdminWebhookId,
  eventType: z.string(),
  /** The receiver stays idempotent on it. */
  eventId: z.string(),
  attempt: z.number().int().min(1),
  redeliveryOfId: z.uuid().nullable(),
  status: PlatformDeliveryStatus,
  responseStatusCode: z.number().int().nullable(),
  durationMs: count.nullable(),
  requestId: z.string().nullable(),
  errorCode: z.string().nullable(),
  /** Earlier attempts of the same event to this endpoint. */
  retries: count,
  requestedBy: z.string().nullable(),
  createdAt: DateTime,
  finishedAt: DateTime.nullable(),
  /** B8 keeps no payload: always null. */
  payload: z.string().nullable(),
  /** Outbound, finished, on an active endpoint. */
  canRedeliver: z.boolean(),
});
export type AdminWebhookDelivery = z.infer<typeof AdminWebhookDelivery>;

export const ListAdminWebhookDeliveriesQuery = z.strictObject({
  status: PlatformDeliveryStatus.optional(),
  ...paging(10),
});
export type ListAdminWebhookDeliveriesQuery = z.input<typeof ListAdminWebhookDeliveriesQuery>;
export const ListAdminWebhookDeliveriesResponse = page(AdminWebhookDelivery);
export type ListAdminWebhookDeliveriesResponse = z.infer<typeof ListAdminWebhookDeliveriesResponse>;

// ---------- The integration log ----------

export const AdminIntegrationLogId = z.uuid();
export const AdminLogResolution = z.object({
  action: z.enum([
    'RECONNECT',
    'UPDATE_CREDENTIAL',
    'RETRY_SYNC',
    'VIEW_PROVIDER_STATUS',
    'VIEW_INTEGRATION',
    'VIEW_WEBHOOK',
  ]),
  label: z.string(),
  /** An admin path, or the provider's status page. */
  href: z.string().nullable(),
});
export const AdminIntegrationLog = z.object({
  id: AdminIntegrationLogId,
  at: DateTime,
  source: PlatformIntegrationLogSource,
  integrationId: z.uuid().nullable(),
  integrationName: z.string().nullable(),
  provider: z.string().nullable(),
  environment: IntegrationEnvironment.nullable(),
  severity: PlatformIntegrationLogSeverity,
  /** The taxonomy name, e.g. `sync.requested`. */
  eventType: z.string(),
  /** A label: "Test connection". */
  action: z.string(),
  succeeded: z.boolean(),
  errorCode: z.string().nullable(),
  message: z.string(),
  /** Redacted: never secrets, tokens or record content. */
  details: z.array(z.object({ label: z.string(), value: z.string() })),
  requestId: z.string().nullable(),
  correlationId: z.string().nullable(),
  /** The firm a firm-connection event concerns. */
  firm: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  actor: z.object({
    type: z.enum(['USER', 'SYSTEM', 'PROVIDER']),
    id: z.uuid().nullable(),
    name: z.string(),
  }),
  endpoint: z.string().nullable(),
  resolution: AdminLogResolution.nullable(),
});
export type AdminIntegrationLog = z.infer<typeof AdminIntegrationLog>;

const LogFilters = {
  /** Message, action, event, error code, request or correlation id, integration or firm name. */
  search: SearchText.optional(),
  integrationId: z.uuid().optional(),
  /** Only platform integrations' events (the dashboard's activity). */
  platformOnly: flag(false),
  source: PlatformIntegrationLogSource.optional(),
  severity: PlatformIntegrationLogSeverity.optional(),
  eventType: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
    .optional(),
  environment: IntegrationEnvironment.optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE']).optional(),
  /** A request or correlation id, exact. */
  requestId: Trace.optional(),
  firmId: z.uuid().optional(),
  /** ISO moments, inclusive. */
  from: DateTime.optional(),
  to: DateTime.optional(),
  /** Newest first unless 'false'. */
  descending: flag(true),
};
/** GET /admin/integrations/logs: the filters combine with AND. */
export const ListAdminIntegrationLogsQuery = z.strictObject({ ...LogFilters, ...paging(20) });
export type ListAdminIntegrationLogsQuery = z.input<typeof ListAdminIntegrationLogsQuery>;
export const ListAdminIntegrationLogsResponse = page(AdminIntegrationLog);
export type ListAdminIntegrationLogsResponse = z.infer<typeof ListAdminIntegrationLogsResponse>;

export const AdminLogFacets = z.object({
  integrations: z.array(z.object({ id: z.uuid(), name: z.string() })),
  eventTypes: z.array(z.string()),
  firms: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type AdminLogFacets = z.infer<typeof AdminLogFacets>;

export const AdminLogRecord = z.object({
  log: AdminIntegrationLog,
  /** The other events with the same correlation id (at most 50). */
  related: z.array(AdminIntegrationLog),
  /** The affected integration now; null when there is none. */
  integration: z
    .object({ id: z.uuid(), name: z.string(), status: PlatformIntegrationStatus })
    .nullable(),
  /** The newer and the older record in the log's default order. */
  previousId: z.uuid().nullable(),
  nextId: z.uuid().nullable(),
});
export type AdminLogRecord = z.infer<typeof AdminLogRecord>;

/**
 * POST .../logs/export: a B1 export job (CSV) of the rows the filters find; the export worker
 * makes the file. In this JSON body the two flags are booleans.
 */
export const ExportAdminLogsRequest = z.strictObject({
  query: z
    .strictObject({
      ...LogFilters,
      platformOnly: z.boolean().optional(),
      descending: z.boolean().optional(),
    })
    .optional(),
  format: z.literal('CSV').optional(),
});
export type ExportAdminLogsRequest = z.input<typeof ExportAdminLogsRequest>;

export const AdminExportJob = z.object({
  id: z.uuid(),
  title: z.string(),
  format: z.literal('CSV'),
  status: PlatformExportStatus,
  rowCount: count.nullable(),
  errorCode: z.string().nullable(),
  createdAt: DateTime,
  finishedAt: DateTime.nullable(),
  /** The file is kept until then (download from the exports page, B1). */
  expiresAt: DateTime.nullable(),
});
export type AdminExportJob = z.infer<typeof AdminExportJob>;

// ---------- Usage ----------

const DayKey = z.iso.date();
export const AdminUsageDay = z.object({
  day: DayKey,
  requests: count,
  successes: count,
  failures: count,
  avgLatencyMs: count.nullable(),
  volume: z.number().min(0).nullable(),
  costCents: count.nullable(),
  connectedFirms: count.nullable(),
  activeFirms: count.nullable(),
  connects: count.nullable(),
  disconnects: count.nullable(),
});
export type AdminUsageDay = z.infer<typeof AdminUsageDay>;

export const AdminUsageTotals = z.object({
  requests: count,
  successes: count,
  failures: count,
  /** Percent; null with no requests. */
  successRate: z.number().min(0).max(100).nullable(),
  avgLatencyMs: count.nullable(),
  /** Null when the subjects use different units. */
  volume: z.number().min(0).nullable(),
  costCents: count.nullable(),
  /** The last day's counts. */
  connectedFirms: count.nullable(),
  activeFirms: count.nullable(),
  connects: count.nullable(),
  disconnects: count.nullable(),
});
export type AdminUsageTotals = z.infer<typeof AdminUsageTotals>;

export const AdminUsageSubject = AdminUsageTotals.extend({
  key: z.string(),
  name: z.string(),
  category: PlatformIntegrationCategory.nullable(),
  volumeUnit: AdminIntegrationVolumeUnit.nullable(),
  volumeLabel: z.string().nullable(),
  requestLabel: z.string().nullable(),
});
export type AdminUsageSubject = z.infer<typeof AdminUsageSubject>;

export const AdminUsageAlert = z.object({
  subjectKey: z.string(),
  subjectName: z.string(),
  kind: z.enum(['ERROR_RATE', 'LATENCY', 'COST', 'SYNC_FAILURES', 'QUOTA']),
  value: z.number(),
  threshold: z.number(),
  message: z.string(),
});

/** GET .../usage: UTC days, inclusive; the last 30 days by default, at most 366. */
export const AdminUsageQuery = z.strictObject({
  scope: PlatformUsageScope.optional().default('PLATFORM_INTEGRATION'),
  /** An integration id, a catalog provider key or an API key id; all of the scope when left out. */
  subject: z.string().min(1).max(100).optional(),
  from: DayKey.optional(),
  to: DayKey.optional(),
});
export type AdminUsageQuery = z.input<typeof AdminUsageQuery>;

export const AdminUsageReport = z.object({
  scope: PlatformUsageScope,
  subject: z.string().nullable(),
  from: DayKey,
  to: DayKey,
  series: z.array(AdminUsageDay),
  totals: AdminUsageTotals,
  subjects: z.array(AdminUsageSubject),
  /** By plan: the rollup has no per-plan counts yet, so this stays empty. */
  planDistribution: z.array(z.object({ planId: z.uuid(), planName: z.string(), firms: count })),
  /** Alert thresholds have no table yet, so no alerts are raised. */
  alerts: z.array(AdminUsageAlert),
});
export type AdminUsageReport = z.infer<typeof AdminUsageReport>;

// ---------- The module's audit trail (from audit_logs) ----------

export const AdminIntegrationAuditEntry = z.object({
  id: z.uuid(),
  at: DateTime,
  actor: z.object({ id: z.uuid().nullable(), name: z.string(), role: z.string() }),
  /** `integrations.platform.disabled`, `integrations.credentials.rotated`... */
  action: z.string(),
  label: z.string(),
  category: z.enum(['INTEGRATION', 'SECURITY']),
  target: z.object({
    type: z.enum(['PLATFORM_INTEGRATION', 'CATALOG_ITEM', 'API_KEY', 'WEBHOOK', 'LOG_EXPORT']),
    id: z.string(),
    name: z.string(),
  }),
  /** The fields that changed; values are not kept (never a secret). */
  changes: z.array(
    z.object({ field: z.string(), before: z.string().nullable(), after: z.string().nullable() }),
  ),
  result: z.enum(['SUCCESS', 'FAILED']),
  ip: z.string().nullable(),
});
export type AdminIntegrationAuditEntry = z.infer<typeof AdminIntegrationAuditEntry>;

export const ListAdminIntegrationAuditQuery = z.strictObject({
  targetId: z.string().min(1).max(100).optional(),
  ...paging(10),
});
export type ListAdminIntegrationAuditQuery = z.input<typeof ListAdminIntegrationAuditQuery>;
export const ListAdminIntegrationAuditResponse = page(AdminIntegrationAuditEntry);
export type ListAdminIntegrationAuditResponse = z.infer<typeof ListAdminIntegrationAuditResponse>;
