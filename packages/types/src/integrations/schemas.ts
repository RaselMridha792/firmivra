import { z } from 'zod';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationRequestStatus,
  IntegrationSyncDirection,
  IntegrationSyncMode,
  IntegrationSyncRunStatus,
} from '../db-enums.js';

// Integrations (R55 contract, for the Integrations screens): the control-center page with its
// summary cards, tabs, Live/Test mode, health, data mapping and recent activity; the marketplace
// (Add Integration) with categories, featured providers and "request an integration"; the guided
// Connect / Configure flow; and the Manage page (Overview, Sync Settings, Data Mapping,
// Permissions, Sync History, Troubleshooting); plus the Custom API & Webhooks path. Designs:
// docs/mockups/firm-workspace/integrations/source/ and its developer instructions.
//
// Providers are CODES (`quickbooks`, `microsoft365`...), never hard-coded in a screen: the API's
// catalog says what each one is, what it can sync, which sign-in it uses and which options its
// setup shows, so a new provider is data, not a new page. A secret NEVER passes through this
// contract in a response: no token, key, password or signing secret is returned, shown or logged;
// only a masked tail and facts. Credentials a provider needs without OAuth (an API key) are sent
// once, write-only, to connect, and go to the secret store. Firm routes under /api/v1/business
// (`@Access('INTEGRATIONS')`): everyone with the grid's view reads; connecting, configuring,
// syncing, disconnecting and requests need Create, Edit or Manage (403 FORBIDDEN); Owner and
// Admin may always. The provider's authorization (OAuth) is done in the browser at the provider;
// the API's callback saves the connection and sends the browser back to the screen. Disconnected,
// never deleted: imported records and history stay. Responses are plain objects; requests are
// strict. Audited with ids, provider codes and field names only.

const DateTime = z.iso.datetime({ offset: true });
const Page = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };

export const IntegrationConnectionId = z.uuid();
export const IntegrationSyncRunId = z.uuid();
export const IntegrationRequestId = z.uuid();

/** A provider code: lower case letters, digits and underscores (`quickbooks`, `dropbox_sign`). */
export const IntegrationProviderKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use a provider code like quickbooks');

const PersonRef = z.object({ userId: z.uuid(), name: z.string() });

export const IntegrationCategory = z.enum([
  'ACCOUNTING_FINANCE',
  'PAYMENTS',
  'COMMUNICATION',
  'PRODUCTIVITY',
  'SCHEDULING',
  'DOCUMENT_MANAGEMENT',
  'CRM_LEADS',
  'E_SIGNATURE',
  'TAX_SOFTWARE',
  'PAYROLL_HR',
  'MARKETING',
  'ECOMMERCE',
  'CUSTOM',
]);
export type IntegrationCategory = z.infer<typeof IntegrationCategory>;

/** How the firm authorizes the provider. No provider's password is ever collected. */
export const IntegrationAuthMethod = z.enum([
  /** The provider's own authorization page, then our callback (Microsoft, QuickBooks, Google...). */
  'OAUTH2',
  /** Credentials the provider issues (an API key), sent once and write-only. */
  'API_KEY',
  /** A hosted link flow the provider offers (bank feeds). */
  'PROVIDER_LINK',
  /** No outside account: the firm's own website forms and webhooks. */
  'NONE',
]);
export type IntegrationAuthMethod = z.infer<typeof IntegrationAuthMethod>;

/** What a card shows: `AVAILABLE` (no connection) or the connection's status. */
export const IntegrationCardStatus = z.enum(['AVAILABLE', ...IntegrationConnectionStatus.options]);
export type IntegrationCardStatus = z.infer<typeof IntegrationCardStatus>;

/** Why a connection needs attention (the card shows `statusMessage` in plain words). */
export const IntegrationIssueCode = z.enum([
  'AUTHORIZATION_EXPIRED',
  'AUTHORIZATION_REVOKED',
  'PERMISSION_MISSING',
  'SYNC_FAILED',
  'PROVIDER_OUTAGE',
  'RATE_LIMITED',
  'CONFIGURATION_INCOMPLETE',
]);
export type IntegrationIssueCode = z.infer<typeof IntegrationIssueCode>;

// ---------- The catalog (data, from the API) ----------

/** One thing a provider can sync ("invoices", "calendar"), switched on or off by the firm. */
export const IntegrationEntity = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  /** On when a connection is first made. */
  defaultEnabled: z.boolean(),
  /** Which directions this object supports (a two-way option is disabled when it has none). */
  directions: z.array(IntegrationSyncDirection),
});
export type IntegrationEntity = z.infer<typeof IntegrationEntity>;

/** A permission the provider is asked for, in plain language (step 3 of the setup). */
export const IntegrationPermission = z.object({
  key: z.string(),
  label: z.string(),
  /** Asked only when this object is enabled; null: always. */
  entity: z.string().nullable(),
  required: z.boolean(),
});
export type IntegrationPermission = z.infer<typeof IntegrationPermission>;

/** A setup option the provider adds (a default calendar, folders, "create appointments"). */
export const IntegrationOptionField = z.object({
  key: z.string(),
  label: z.string(),
  help: z.string().nullable(),
  type: z.enum(['TOGGLE', 'SELECT', 'MULTI_SELECT', 'TEXT']),
  choices: z.array(z.object({ value: z.string(), label: z.string() })),
  defaultValue: z.union([z.boolean(), z.string(), z.array(z.string())]).nullable(),
  /** The choices (mailboxes, calendars) are read from the provider, so only after connecting. */
  afterConnect: z.boolean(),
});
export type IntegrationOptionField = z.infer<typeof IntegrationOptionField>;

/** A field the firm supplies without OAuth. Write-only: it is never shown again. */
export const IntegrationCredentialField = z.object({
  key: z.string(),
  label: z.string(),
  help: z.string().nullable(),
});
export type IntegrationCredentialField = z.infer<typeof IntegrationCredentialField>;

/** The fields of one mapping scope ("client", "invoice"): ours and the provider's. */
export const IntegrationMappingScope = z.object({
  scope: z.string(),
  label: z.string(),
  localFields: z.array(z.object({ key: z.string(), label: z.string() })),
  externalFields: z.array(z.object({ key: z.string(), label: z.string() })),
});
export type IntegrationMappingScope = z.infer<typeof IntegrationMappingScope>;

/** One provider of the catalog (the marketplace card and the setup's definition). */
export const IntegrationProvider = z.object({
  provider: IntegrationProviderKey,
  name: z.string(),
  category: IntegrationCategory,
  /** One line for the card ("Accounting, expenses and invoices"). */
  summary: z.string(),
  description: z.string(),
  /** A key of the app's own logo set; the screen draws a placeholder for a key it lacks. */
  logo: z.string(),
  featured: z.boolean(),
  badge: z.enum(['MOST_POPULAR', 'RECOMMENDED']).nullable(),
  /** Higher is more popular: the "Most Popular" sort. */
  popularity: z.number().int(),
  authMethod: IntegrationAuthMethod,
  environments: z.array(IntegrationEnvironment),
  directions: z.array(IntegrationSyncDirection),
  /** Minutes between automatic syncs that the provider supports. */
  frequencies: z.array(z.number().int()),
  entities: z.array(IntegrationEntity),
  permissions: z.array(IntegrationPermission),
  options: z.array(IntegrationOptionField),
  credentialFields: z.array(IntegrationCredentialField),
  mappingScopes: z.array(IntegrationMappingScope),
  /** More than one connection of this provider is allowed (otherwise one per environment). */
  multipleConnections: z.boolean(),
  /** The provider's API is not live for this firm yet: the card says "Coming soon". */
  comingSoon: z.boolean(),
  learnMoreUrl: z.url().nullable(),
});
export type IntegrationProvider = z.infer<typeof IntegrationProvider>;

// ---------- Cards, the main page and the marketplace ----------

/** The firm's connection to a provider, as a card or a header shows it. Never a secret. */
export const IntegrationConnectionSummary = z.object({
  id: z.uuid(),
  provider: IntegrationProviderKey,
  environment: IntegrationEnvironment,
  status: IntegrationConnectionStatus,
  issue: IntegrationIssueCode.nullable(),
  /** Plain words for the card ("Authorization expired"), with the fix in `statusAction`. */
  statusMessage: z.string().nullable(),
  statusAction: z.enum(['RECONNECT', 'FIX_PERMISSIONS', 'RETRY', 'VIEW_HISTORY']).nullable(),
  accountLabel: z.string().nullable(),
  direction: IntegrationSyncDirection,
  syncMode: IntegrationSyncMode,
  syncEveryMinutes: z.number().int().nullable(),
  connectedAt: DateTime,
  lastSyncAt: DateTime.nullable(),
  nextSyncAt: DateTime.nullable(),
});
export type IntegrationConnectionSummary = z.infer<typeof IntegrationConnectionSummary>;

/** A card: the provider and the firm's live connection to it, if any. */
export const IntegrationCard = z.object({
  provider: IntegrationProvider.pick({
    provider: true,
    name: true,
    category: true,
    summary: true,
    logo: true,
    featured: true,
    badge: true,
    popularity: true,
    comingSoon: true,
    multipleConnections: true,
  }),
  status: IntegrationCardStatus,
  /** The connections of this provider (none for AVAILABLE); most providers have one. */
  connections: z.array(IntegrationConnectionSummary),
  /** The action the card offers. */
  action: z.enum(['CONNECT', 'CONFIGURE', 'MANAGE', 'RECONNECT', 'RESUME']),
});
export type IntegrationCard = z.infer<typeof IntegrationCard>;

export const IntegrationTab = z.enum(['all', 'connected', 'available', 'attention']);
export type IntegrationTab = z.infer<typeof IntegrationTab>;

/**
 * GET /business/integrations: the main page. `environment` is the Live / Test switch: LIVE shows
 * production connections, TEST the sandbox ones (a provider without a sandbox has no test card).
 * `search` matches the name, summary and category. Counts follow the environment and category but
 * not the tab or search, so the tabs always show their own totals.
 */
export const IntegrationsQuery = z.strictObject({
  tab: IntegrationTab.optional().default('all'),
  category: IntegrationCategory.optional(),
  environment: IntegrationEnvironment.optional().default('LIVE'),
  search: SearchText.optional(),
});
export type IntegrationsQuery = z.input<typeof IntegrationsQuery>;

export const IntegrationSummary = z.object({
  /** Connected and actively syncing (CONNECTED or SYNCING). */
  connected: z.number().int(),
  needsAttention: z.number().int(),
  available: z.number().int(),
  paused: z.number().int(),
  total: z.number().int(),
  /** The last time the platform checked every connection's health. */
  lastCheckAt: DateTime.nullable(),
  /** "All systems operational" when nothing needs attention. */
  allOperational: z.boolean(),
});
export type IntegrationSummary = z.infer<typeof IntegrationSummary>;

export const IntegrationHealth = z.object({
  operational: z.number().int(),
  authorizationIssues: z.number().int(),
  failedSyncs: z.number().int(),
  /** Records waiting to sync across connections. */
  recordsPending: z.number().int(),
});
export type IntegrationHealth = z.infer<typeof IntegrationHealth>;

/** The data-mapping shortcut: how many fields are mapped per scope, across connections. */
export const IntegrationMappingSummary = z.object({
  scope: z.string(),
  label: z.string(),
  mappedFields: z.number().int(),
});
export type IntegrationMappingSummary = z.infer<typeof IntegrationMappingSummary>;

/** One line of Recent Activity (a sync, a connection, an error), newest first. */
export const IntegrationActivity = z.object({
  id: z.uuid(),
  provider: IntegrationProviderKey,
  providerName: z.string(),
  kind: z.enum(['SYNC', 'CONNECT', 'DISCONNECT', 'TEST', 'WEBHOOK', 'ERROR', 'SETTINGS']),
  ok: z.boolean(),
  /** A short sentence ("QuickBooks Online sync completed"); never record content. */
  message: z.string(),
  at: DateTime,
});
export type IntegrationActivity = z.infer<typeof IntegrationActivity>;

export const IntegrationsOverview = z.object({
  summary: IntegrationSummary,
  items: z.array(IntegrationCard),
  health: IntegrationHealth,
  mapping: z.array(IntegrationMappingSummary),
  recent: z.array(IntegrationActivity).max(10),
  /** The caller may connect, configure and disconnect (the buttons show or hide). */
  canManage: z.boolean(),
});
export type IntegrationsOverview = z.infer<typeof IntegrationsOverview>;

/** GET /business/integrations/activity: the full activity list ("View All"). */
export const IntegrationActivityQuery = z.strictObject({
  provider: IntegrationProviderKey.optional(),
  kind: IntegrationActivity.shape.kind.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type IntegrationActivityQuery = z.input<typeof IntegrationActivityQuery>;
export const IntegrationActivityPage = z.object({
  items: z.array(IntegrationActivity).max(100),
  ...Page,
});
export type IntegrationActivityPage = z.infer<typeof IntegrationActivityPage>;

export const IntegrationSort = z.enum(['popular', 'name', 'category']);

/** GET /business/integrations/marketplace: Add Integration, with the category list and counts. */
export const IntegrationMarketplaceQuery = z.strictObject({
  category: IntegrationCategory.optional(),
  search: SearchText.optional(),
  sort: IntegrationSort.optional().default('popular'),
});
export type IntegrationMarketplaceQuery = z.input<typeof IntegrationMarketplaceQuery>;
export const IntegrationMarketplace = z.object({
  /** Every category with its provider count (counts ignore the category filter). */
  categories: z.array(z.object({ category: IntegrationCategory, count: z.number().int() })),
  featured: z.array(IntegrationCard),
  items: z.array(IntegrationCard),
  total: z.number().int(),
});
export type IntegrationMarketplace = z.infer<typeof IntegrationMarketplace>;

// ---------- Setup: connect and configure ----------

/** What a setup option holds: a toggle, one choice, several, or text. The API checks it against the option. */
export const IntegrationSettingValue = z.union([
  z.boolean(),
  z.string().max(500),
  z.array(z.string().max(200)).max(50),
]);

/**
 * The firm's choices for a connection (step 2). Every field is optional: what is left out keeps
 * the provider's default (on connect) or the current value (on a change). `entities` are the
 * provider's entity keys; `direction` must be one the provider and every enabled entity support
 * (409 NOT_SUPPORTED otherwise); `syncEveryMinutes` one of the provider's frequencies, and only
 * with `syncMode` AUTO. `options` are the provider's own option keys.
 */
export const IntegrationSettingsFields = {
  entities: z.array(z.string().max(60)).max(50).optional(),
  direction: IntegrationSyncDirection.optional(),
  syncMode: IntegrationSyncMode.optional(),
  syncEveryMinutes: z.number().int().min(5).max(10_080).nullable().optional(),
  options: z.record(z.string().max(60), IntegrationSettingValue).optional(),
};
export const IntegrationSettings = z.strictObject(IntegrationSettingsFields);
export type IntegrationSettings = z.input<typeof IntegrationSettings>;

/** GET /business/integrations/providers/{provider}: the setup screen's definition and the firm's connections. */
export const IntegrationProviderDetail = z.object({
  provider: IntegrationProvider,
  connections: z.array(IntegrationConnectionSummary),
  canManage: z.boolean(),
});
export type IntegrationProviderDetail = z.infer<typeof IntegrationProviderDetail>;

const Credentials = z.record(z.string().max(60), z.string().min(1).max(4_000));

/**
 * POST /business/integrations/providers/{provider}/connect: starts a connection. OAuth2 and
 * provider-link providers answer `REDIRECT` with the provider's address (the browser goes there;
 * the API's callback then saves the connection and returns the browser to
 * /integrations/{provider}/setup?result=connected|failed). `settings` ride with the request and
 * are kept until the callback, so a failed authorization loses nothing. API-key providers take
 * `credentials` (write-only, by the provider's `credentialFields` keys) and answer `CONNECTED`.
 * 409 ALREADY_CONNECTED, NOT_SUPPORTED (environment, direction or object the provider lacks),
 * COMING_SOON; 400 CREDENTIALS_REJECTED (the provider refused them; nothing is saved).
 */
export const ConnectIntegrationRequest = z.strictObject({
  environment: IntegrationEnvironment.optional().default('LIVE'),
  settings: IntegrationSettings.optional(),
  credentials: Credentials.optional(),
  /** Run a connection test and a small sample sync after connecting (the default). */
  testAfterConnect: z.boolean().optional().default(true),
});
export type ConnectIntegrationRequest = z.input<typeof ConnectIntegrationRequest>;
export const ConnectIntegrationResult = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('REDIRECT'), url: z.string() }),
  z.object({ mode: z.literal('CONNECTED'), connection: IntegrationConnectionSummary }),
]);
export type ConnectIntegrationResult = z.infer<typeof ConnectIntegrationResult>;

/** POST .../connections/{id}/reconnect: as connect, for an existing connection. */
export const ReconnectIntegrationRequest = z.strictObject({ credentials: Credentials.optional() });
export type ReconnectIntegrationRequest = z.input<typeof ReconnectIntegrationRequest>;

// ---------- Mapping, health and sync runs ----------

export const IntegrationMappingPair = z.object({
  scope: z.string(),
  localField: z.string(),
  localLabel: z.string(),
  externalField: z.string(),
  externalLabel: z.string(),
  direction: IntegrationSyncDirection,
});
export type IntegrationMappingPair = z.infer<typeof IntegrationMappingPair>;

/** GET .../mappings: the saved pairs, and the provider's fields to choose from, per scope. */
export const IntegrationMappings = z.object({
  scopes: z.array(IntegrationMappingScope.extend({ pairs: z.array(IntegrationMappingPair) })),
});
export type IntegrationMappings = z.infer<typeof IntegrationMappings>;

/**
 * PUT .../mappings: replaces the pairs of one scope (Configure Mapping). Each local and provider
 * field is one the provider's catalog lists for that scope (409 INVALID_CONFIGURATION), and a
 * local field appears once.
 */
export const SaveIntegrationMappingsRequest = z.strictObject({
  scope: z.string().min(1).max(60),
  pairs: z
    .array(
      z.strictObject({
        localField: z.string().min(1).max(100),
        externalField: z.string().min(1).max(100),
        direction: IntegrationSyncDirection.optional().default('TWO_WAY'),
      }),
    )
    .max(200)
    .refine((p) => new Set(p.map((x) => x.localField)).size === p.length, 'Map each field once'),
});
export type SaveIntegrationMappingsRequest = z.input<typeof SaveIntegrationMappingsRequest>;

export const IntegrationHealthCheck = z.object({
  key: z.enum(['AUTHENTICATION', 'API', 'DATA_SYNC', 'RECENT_ERRORS', 'PERMISSIONS']),
  label: z.string(),
  ok: z.boolean(),
  message: z.string().nullable(),
});
export type IntegrationHealthCheck = z.infer<typeof IntegrationHealthCheck>;

/** Connection Health, and Troubleshooting (the checks, what to do, and the last check). */
export const IntegrationConnectionHealth = z.object({
  ok: z.boolean(),
  summary: z.string(),
  checks: z.array(IntegrationHealthCheck),
  /** Plain steps a person can take ("Reconnect to renew the authorization"). */
  suggestions: z.array(z.string()),
  checkedAt: DateTime.nullable(),
});
export type IntegrationConnectionHealth = z.infer<typeof IntegrationConnectionHealth>;

/** POST .../test (Run Connection Test): runs the checks now and records a `test` run. */
export const IntegrationTestResult = IntegrationConnectionHealth.extend({ runId: z.uuid() });
export type IntegrationTestResult = z.infer<typeof IntegrationTestResult>;

export const IntegrationSyncRun = z.object({
  id: z.uuid(),
  /** "invoices", "customers", "test", "webhook". */
  entity: z.string(),
  entityLabel: z.string(),
  status: IntegrationSyncRunStatus,
  manual: z.boolean(),
  requestedBy: PersonRef.nullable(),
  recordCount: z.number().int(),
  failedCount: z.number().int(),
  errorCode: z.string().nullable(),
  /** Short, plain; never a token or record content. */
  errorMessage: z.string().nullable(),
  startedAt: DateTime.nullable(),
  finishedAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type IntegrationSyncRun = z.infer<typeof IntegrationSyncRun>;

/** GET .../history: Sync History. */
export const IntegrationHistoryQuery = z.strictObject({
  status: IntegrationSyncRunStatus.optional(),
  entity: z.string().max(60).optional(),
  manual: z.union([z.boolean(), z.stringbool()]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type IntegrationHistoryQuery = z.input<typeof IntegrationHistoryQuery>;
export const IntegrationHistoryPage = z.object({
  items: z.array(IntegrationSyncRun).max(100),
  ...Page,
});
export type IntegrationHistoryPage = z.infer<typeof IntegrationHistoryPage>;

/** One run, with what to do about a failure (the "useful error details"). */
export const IntegrationSyncRunDetail = IntegrationSyncRun.extend({
  guidance: z.array(z.string()),
});
export type IntegrationSyncRunDetail = z.infer<typeof IntegrationSyncRunDetail>;

/** GET .../permissions: what the connection was granted, in plain language. */
export const IntegrationPermissionList = z.object({
  items: z.array(IntegrationPermission.extend({ granted: z.boolean() })),
  /** A permission is missing for an enabled object: reconnect to grant it. */
  needsReconnect: z.boolean(),
});
export type IntegrationPermissionList = z.infer<typeof IntegrationPermissionList>;

// ---------- Manage a connection ----------

/** GET .../connections/{id}: the Manage page's Overview (every tab reads its own route as well). */
export const IntegrationConnectionDetail = IntegrationConnectionSummary.extend({
  /** The masked provider account id ("•••• 3456"), never the id. */
  accountIdMasked: z.string().nullable(),
  connectionType: z.string(),
  connectedBy: PersonRef.nullable(),
  /** The provider's definition, for the object list, options and frequencies. */
  provider: IntegrationProvider,
  /** Entity keys that are on. */
  entities: z.array(z.string()),
  options: z.record(z.string(), IntegrationSettingValue),
  /** A sync is running now: Sync Now is off. */
  syncing: z.boolean(),
  paused: z.boolean(),
  health: IntegrationConnectionHealth,
  recentRuns: z.array(IntegrationSyncRun).max(10),
  mappingPreview: z.array(IntegrationMappingPair).max(10),
  canManage: z.boolean(),
});
export type IntegrationConnectionDetail = z.infer<typeof IntegrationConnectionDetail>;

/** PATCH .../connections/{id}/settings (Save Sync Settings): fields sent change, others stay. */
export const UpdateIntegrationSettingsRequest = z
  .strictObject(IntegrationSettingsFields)
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateIntegrationSettingsRequest = z.input<typeof UpdateIntegrationSettingsRequest>;

/** POST .../sync (Sync Now): all enabled objects, or the ones named. 409 SYNC_IN_PROGRESS. */
export const SyncIntegrationRequest = z.strictObject({
  entities: z.array(z.string().max(60)).min(1).max(50).optional(),
});
export type SyncIntegrationRequest = z.input<typeof SyncIntegrationRequest>;

/**
 * POST .../disconnect: asks to confirm. Imported and synced records stay in Firmivra and history
 * is kept; the provider's access is revoked and the stored secret removed.
 */
export const DisconnectIntegrationRequest = z.strictObject({ confirm: z.literal(true) });
export type DisconnectIntegrationRequest = z.input<typeof DisconnectIntegrationRequest>;

// ---------- Request an integration ----------

/** POST /business/integration-requests: stored for Super Admin to review (status NEW). */
export const CreateIntegrationRequest = z.strictObject({
  providerName: text(100),
  websiteUrl: clearable(z.url().max(300)),
  category: IntegrationCategory.nullable().optional(),
  connectTo: text(1_000, 'many'),
  businessReason: clearable(text(2_000, 'many')),
});
export type CreateIntegrationRequest = z.input<typeof CreateIntegrationRequest>;

/** The firm's own requests and where each stands. The internal note is Super Admin's, never here. */
export const IntegrationRequestRow = z.object({
  id: z.uuid(),
  providerName: z.string(),
  websiteUrl: z.string().nullable(),
  category: z.string().nullable(),
  connectTo: z.string(),
  businessReason: z.string().nullable(),
  status: IntegrationRequestStatus,
  requestedBy: PersonRef,
  statusChangedAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type IntegrationRequestRow = z.infer<typeof IntegrationRequestRow>;
export const IntegrationRequestList = z.object({ items: z.array(IntegrationRequestRow) });
export type IntegrationRequestList = z.infer<typeof IntegrationRequestList>;

// ---------- Custom API & Webhooks ----------

export const CustomIntegrationAuth = z.enum(['NONE', 'API_KEY', 'BEARER_TOKEN', 'HMAC_SIGNATURE']);
export type CustomIntegrationAuth = z.infer<typeof CustomIntegrationAuth>;

/** An event a custom webhook can be sent (GET .../custom-events; the list is data). */
export const CustomIntegrationEvent = z.object({
  key: z.string(),
  label: z.string(),
  module: z.string(),
});
export type CustomIntegrationEvent = z.infer<typeof CustomIntegrationEvent>;
export const CustomIntegrationEventList = z.object({ items: z.array(CustomIntegrationEvent) });
export type CustomIntegrationEventList = z.infer<typeof CustomIntegrationEventList>;

/**
 * A custom connection's setup (the `custom_api` provider). The address must be https. A secret
 * (a key, a token, the signing secret) is never returned: only `secretLast4` and
 * `secretRotatedAt`. `inboundUrl` is the address outside systems post to for this firm.
 */
export const CustomIntegrationConfig = z.object({
  connectionId: z.uuid(),
  enabled: z.boolean(),
  name: z.string(),
  documentationUrl: z.string().nullable(),
  authMethod: CustomIntegrationAuth,
  endpointUrl: z.string().nullable(),
  events: z.array(z.string()),
  secretLast4: z.string().nullable(),
  secretRotatedAt: DateTime.nullable(),
  inboundUrl: z.string(),
});
export type CustomIntegrationConfig = z.infer<typeof CustomIntegrationConfig>;

export const SaveCustomIntegrationRequest = z
  .strictObject({
    enabled: z.boolean().optional(),
    name: text(100).optional(),
    documentationUrl: clearable(z.url().max(300)),
    authMethod: CustomIntegrationAuth.optional(),
    endpointUrl: clearable(
      z
        .url()
        .max(500)
        .regex(/^https:\/\//i, 'Use an https address'),
    ),
    events: z.array(z.string().max(80)).max(100).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type SaveCustomIntegrationRequest = z.input<typeof SaveCustomIntegrationRequest>;

/** POST .../custom/secret: set (rotate) the secret. Write-only: the answer has the last 4 only. */
export const RotateCustomSecretRequest = z.strictObject({ secret: z.string().min(16).max(500) });
export type RotateCustomSecretRequest = z.input<typeof RotateCustomSecretRequest>;

/** POST .../custom/test: sends one test event to the endpoint; the answer is the facts of the call. */
export const CustomIntegrationTestResult = z.object({
  ok: z.boolean(),
  statusCode: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  message: z.string(),
  runId: z.uuid(),
});
export type CustomIntegrationTestResult = z.infer<typeof CustomIntegrationTestResult>;

// ---------- Errors ----------

export const IntegrationErrorCode = z.enum([
  /** 409: this provider is connected already (and allows one connection per environment). */
  'ALREADY_CONNECTED',
  /** 409: the provider, environment, direction, frequency or object is not supported. */
  'NOT_SUPPORTED',
  /** 409: the action needs a connected integration (not paused, disconnected or needing attention). */
  'NOT_CONNECTED',
  /** 409: a sync is running; wait for it. */
  'SYNC_IN_PROGRESS',
  /** 409: the connection is already paused (or already running). */
  'ALREADY_PAUSED',
  /** 400: the provider refused the credentials; nothing is saved. */
  'CREDENTIALS_REJECTED',
  /** 400: the authorization could not be completed (the browser returned with an error). */
  'AUTHORIZATION_FAILED',
  /** 409: a field is not in the provider's catalog, or two settings conflict. */
  'INVALID_CONFIGURATION',
  /** 503: the provider cannot be reached now. */
  'PROVIDER_UNAVAILABLE',
  /** 409: the provider is not available for this firm yet. */
  'COMING_SOON',
]);
export type IntegrationErrorCode = z.infer<typeof IntegrationErrorCode>;
