import type {
  ApiKeyRecord,
  CatalogRecord,
  CatalogSetup,
  ConnectionField,
  IntegrationAuditEntry,
  IntegrationCategory,
  IntegrationEnvironment,
  IntegrationError,
  IntegrationLog,
  IntegrationStatus,
  IntegrationsStore,
  LogResolution,
  LogSeverity,
  LogSource,
  PlanAccess,
  PlatformIntegration,
  PlatformRun,
  PlatformSettings,
  ProviderTemplate,
  RunStatus,
  StatusReason,
  UsageRow,
  UsageThresholds,
  WebhookDelivery,
  WebhookRecord,
  CatalogStatus,
  FirmAccess,
} from './admin-integrations';

/**
 * Synthetic fixtures for mocks/admin-integrations.ts: Firmivra's platform services (real provider
 * names, invented accounts), the customer catalog, invented firms ("Sample …", "Example …"), API
 * keys, webhooks and their deliveries, the integration log and 90 days of usage rollups. Times are
 * relative to the first call, so the default ranges always have data. Secrets appear only as
 * masked hints. Nothing runs on import.
 */

/**
 * uuid-shaped ids in this module's block: 1a01 platform integrations, 1a02 runs, 1a03 logs,
 * 1a04 catalog entries, 1a05 API keys, 1a06 webhooks, 1a07 deliveries, 1a08 audit entries,
 * 1a09 export jobs, 1a0a plans, 1a0b firms.
 */
export const integrationsUuid = (block: string, n: number) =>
  `0199d1a0-${block}-7000-8000-${String(n).padStart(12, '0')}`;

/** The mock Super Admin, the same person mocks/admin-auth.ts signs in. */
export const INTEGRATIONS_ADMIN = {
  id: '0199b6a2-0000-7000-8000-0000000000a1',
  name: 'Morgan Admin',
  email: 'morgan.admin@example.test',
};
/** A documentation address (RFC 5737), never a real one. */
export const INTEGRATIONS_ADMIN_IP = '198.51.100.10';

const SECOND_ADMIN = { id: '0199b6a2-0000-7000-8000-0000000000a2', name: 'Avery Sample' };
const WEBHOOK_HOST = 'https://api.firmivra.example.test';

// ---------- Provider templates (the API keeps these in code) ----------

const secretField = (
  key: string,
  label: string,
  placeholder: string,
  prefix: Record<IntegrationEnvironment, string> | null = null,
  hint: string | null = null,
): ConnectionField => ({
  key,
  label,
  secret: true,
  required: true,
  kind: 'text',
  placeholder,
  hint,
  prefix,
});
const plainField = (
  key: string,
  label: string,
  placeholder: string,
  options: {
    required?: boolean;
    kind?: 'text' | 'url';
    prefix?: Record<IntegrationEnvironment, string>;
    hint?: string;
  } = {},
): ConnectionField => ({
  key,
  label,
  secret: false,
  required: options.required ?? true,
  kind: options.kind ?? 'text',
  placeholder,
  hint: options.hint ?? null,
  prefix: options.prefix ?? null,
});
const both = (prefix: string) => ({ LIVE: prefix, TEST: prefix });

let templates: ProviderTemplate[] | undefined;
/** Every provider Firmivra knows how to connect, plus `custom` for anything else. */
export function providerTemplates(): ProviderTemplate[] {
  templates ??= [
    {
      key: 'stripe',
      name: 'Stripe',
      category: 'PAYMENTS_BILLING',
      description: 'Payments, subscriptions and invoicing',
      websiteUrl: 'https://stripe.com',
      docsUrl: 'https://stripe.com/docs',
      statusUrl: 'https://status.stripe.com',
      authType: 'API_KEY',
      fields: [
        secretField(
          'secretKey',
          'Secret Key',
          'sk_live_…',
          { LIVE: 'sk_live_', TEST: 'sk_test_' },
          'From the Stripe dashboard, Developers › API keys.',
        ),
        plainField('publishableKey', 'Publishable Key', 'pk_live_…', {
          prefix: { LIVE: 'pk_live_', TEST: 'pk_test_' },
        }),
        secretField('webhookSecret', 'Webhook Signing Secret', 'whsec_…', both('whsec_')),
        plainField('accountId', 'Account ID', 'acct_…', { required: false, prefix: both('acct_') }),
      ],
      supportsTest: true,
      supportsOAuth: false,
      supportsUptime: true,
      scopes: [
        'charges:read',
        'charges:write',
        'customers:write',
        'subscriptions:write',
        'invoices:write',
        'payouts:read',
      ],
      defaultScopes: ['charges:read'],
      features: [
        { key: 'subscriptions', label: 'Subscriptions', description: 'Plans and renewals.' },
        { key: 'invoicing', label: 'Invoicing', description: 'Invoices and receipts.' },
        { key: 'payouts', label: 'Payout reports', description: 'Daily payout reconciliation.' },
      ],
      webhookPath: '/webhooks/stripe',
      volumeUnit: 'CENTS',
      volumeLabel: 'Total Processed',
      requestLabel: 'Transactions',
    },
    {
      key: 'twilio',
      name: 'Twilio',
      category: 'COMMUNICATION',
      description: 'SMS, voice and verification',
      websiteUrl: 'https://www.twilio.com',
      docsUrl: 'https://www.twilio.com/docs',
      statusUrl: 'https://status.twilio.com',
      authType: 'ACCOUNT_KEYS',
      fields: [
        plainField('accountSid', 'Account SID', 'AC…', { prefix: both('AC') }),
        secretField('authToken', 'Auth Token', '32 characters'),
        plainField('messagingServiceSid', 'Messaging Service SID', 'MG…', {
          required: false,
          prefix: both('MG'),
        }),
        plainField('verifyServiceSid', 'Verify Service SID', 'VA…', {
          required: false,
          prefix: both('VA'),
        }),
      ],
      supportsTest: true,
      supportsOAuth: false,
      supportsUptime: true,
      scopes: ['messages:send', 'voice:call', 'verify:send', 'numbers:read'],
      defaultScopes: ['messages:send'],
      features: [
        { key: 'sms', label: 'SMS', description: 'Reminders and notifications.' },
        { key: 'voice', label: 'Voice', description: 'Call forwarding.' },
        { key: 'verify', label: 'Verification', description: 'Sign-in codes.' },
      ],
      webhookPath: '/webhooks/twilio',
      volumeUnit: 'MESSAGES',
      volumeLabel: 'Messages Sent',
      requestLabel: 'API Calls',
    },
    {
      key: 'sendgrid',
      name: 'SendGrid',
      category: 'EMAIL',
      description: 'Transactional and marketing emails',
      websiteUrl: 'https://sendgrid.com',
      docsUrl: 'https://docs.sendgrid.com',
      statusUrl: 'https://status.sendgrid.com',
      authType: 'API_KEY',
      fields: [
        secretField('apiKey', 'API Key', 'SG.…', both('SG.')),
        plainField('senderDomain', 'Sender Domain', 'mail.example.test'),
      ],
      supportsTest: true,
      supportsOAuth: false,
      supportsUptime: true,
      scopes: ['mail:send', 'templates:read', 'stats:read', 'suppressions:write'],
      defaultScopes: ['mail:send'],
      features: [
        { key: 'transactional', label: 'Transactional email', description: 'Receipts, resets.' },
        { key: 'marketing', label: 'Marketing email', description: 'Announcements.' },
        { key: 'events', label: 'Event webhooks', description: 'Bounces and opens.' },
      ],
      webhookPath: '/webhooks/sendgrid',
      volumeUnit: 'EMAILS',
      volumeLabel: 'Emails Sent',
      requestLabel: 'API Calls',
    },
    {
      key: 'aws',
      name: 'Amazon Web Services',
      category: 'CLOUD_STORAGE',
      description: 'Hosting, storage and infrastructure',
      websiteUrl: 'https://aws.amazon.com',
      docsUrl: 'https://docs.aws.amazon.com',
      statusUrl: 'https://health.aws.amazon.com',
      authType: 'CLIENT_CREDENTIALS',
      fields: [
        secretField('accessKeyId', 'Access Key ID', 'AKIA…', both('AKIA')),
        secretField('secretAccessKey', 'Secret Access Key', '40 characters'),
        plainField('region', 'Region', 'us-east-1'),
        plainField('bucket', 'Document Bucket', 'firmivra-documents'),
      ],
      supportsTest: true,
      supportsOAuth: false,
      supportsUptime: true,
      scopes: ['s3:read', 's3:write', 'kms:encrypt', 'ses:send'],
      defaultScopes: ['s3:read'],
      features: [
        { key: 'documents', label: 'Document storage', description: 'Per-firm prefixes.' },
        { key: 'backups', label: 'Backups', description: 'Nightly snapshots.' },
        { key: 'kms', label: 'Per-firm keys', description: 'KMS envelope encryption.' },
      ],
      webhookPath: null,
      volumeUnit: 'BYTES',
      volumeLabel: 'Data Transferred',
      requestLabel: 'Requests',
    },
    {
      key: 'amazon_ses',
      name: 'Amazon SES',
      category: 'EMAIL',
      description: 'Backup route for transactional email',
      websiteUrl: 'https://aws.amazon.com/ses',
      docsUrl: 'https://docs.aws.amazon.com/ses',
      statusUrl: 'https://health.aws.amazon.com',
      authType: 'CLIENT_CREDENTIALS',
      fields: [
        secretField('accessKeyId', 'Access Key ID', 'AKIA…', both('AKIA')),
        secretField('secretAccessKey', 'Secret Access Key', '40 characters'),
        plainField('region', 'Region', 'us-east-1'),
      ],
      supportsTest: true,
      supportsOAuth: false,
      supportsUptime: true,
      scopes: ['ses:send', 'ses:read'],
      defaultScopes: ['ses:send'],
      features: [
        { key: 'transactional', label: 'Transactional email', description: 'Fallback sending.' },
      ],
      webhookPath: null,
      volumeUnit: 'EMAILS',
      volumeLabel: 'Emails Sent',
      requestLabel: 'API Calls',
    },
    {
      key: 'openai',
      name: 'OpenAI',
      category: 'AI_AUTOMATION',
      description: 'AI and automation services',
      websiteUrl: 'https://openai.com',
      docsUrl: 'https://platform.openai.com/docs',
      statusUrl: 'https://status.openai.com',
      authType: 'API_KEY',
      fields: [
        secretField('apiKey', 'API Key', 'sk-…', both('sk-')),
        plainField('organizationId', 'Organization ID', 'org-…', {
          required: false,
          prefix: both('org-'),
        }),
      ],
      supportsTest: true,
      supportsOAuth: false,
      supportsUptime: true,
      scopes: ['models:read', 'responses:write', 'files:write'],
      defaultScopes: ['models:read'],
      features: [
        { key: 'drafting', label: 'Drafting', description: 'Email and letter drafts.' },
        { key: 'summaries', label: 'Summaries', description: 'Document summaries.' },
        { key: 'classification', label: 'Classification', description: 'Document sorting.' },
      ],
      webhookPath: null,
      volumeUnit: 'TOKENS',
      volumeLabel: 'Tokens Used',
      requestLabel: 'Requests',
    },
    {
      key: 'docusign',
      name: 'DocuSign',
      category: 'ESIGN',
      description: 'E-Signature infrastructure',
      websiteUrl: 'https://www.docusign.com',
      docsUrl: 'https://developers.docusign.com',
      statusUrl: 'https://status.docusign.com',
      authType: 'OAUTH',
      fields: [
        plainField('integrationKey', 'Integration Key', 'A 36-character key'),
        plainField('accountId', 'API Account ID', 'A 36-character id'),
        plainField('baseUrl', 'Base URL', 'https://na4.docusign.net', { kind: 'url' }),
      ],
      supportsTest: true,
      supportsOAuth: true,
      supportsUptime: true,
      scopes: ['signature', 'extended', 'impersonation'],
      defaultScopes: ['signature'],
      features: [
        { key: 'envelopes', label: 'Envelopes', description: 'Send for signature.' },
        { key: 'templates', label: 'Templates', description: 'Reusable documents.' },
        { key: 'bulk', label: 'Bulk send', description: 'Many recipients at once.' },
      ],
      webhookPath: '/webhooks/docusign',
      volumeUnit: 'ENVELOPES',
      volumeLabel: 'Envelopes Sent',
      requestLabel: 'API Calls',
    },
    {
      key: 'mls_data',
      name: 'MLS Data Provider',
      category: 'MLS_DATA',
      description: 'Property and listing data (master account)',
      websiteUrl: 'https://mls.example.test',
      docsUrl: 'https://mls.example.test/docs',
      statusUrl: 'https://status.mls.example.test',
      authType: 'API_KEY',
      fields: [
        secretField('apiKey', 'API Key', '40 characters'),
        plainField('feedUrl', 'Feed URL', 'https://feed.mls.example.test/v2', { kind: 'url' }),
        plainField('memberId', 'Member ID', 'M-000000'),
      ],
      supportsTest: true,
      supportsOAuth: false,
      supportsUptime: true,
      scopes: ['listings:read', 'media:read', 'agents:read'],
      defaultScopes: ['listings:read'],
      features: [
        { key: 'listings', label: 'Listings', description: 'Active and sold listings.' },
        { key: 'media', label: 'Media', description: 'Listing photos.' },
        { key: 'openHouses', label: 'Open houses', description: 'Upcoming open houses.' },
      ],
      webhookPath: '/webhooks/mls',
      volumeUnit: 'RECORDS',
      volumeLabel: 'Listings Synced',
      requestLabel: 'API Calls',
    },
    {
      key: 'cloudflare',
      name: 'Cloudflare',
      category: 'SECURITY_INFRASTRUCTURE',
      description: 'Security, CDN and domain management',
      websiteUrl: 'https://www.cloudflare.com',
      docsUrl: 'https://developers.cloudflare.com',
      statusUrl: 'https://www.cloudflarestatus.com',
      authType: 'API_KEY',
      fields: [
        secretField('apiToken', 'API Token', '40 characters'),
        plainField('zoneId', 'Zone ID', '32 characters'),
      ],
      supportsTest: true,
      supportsOAuth: false,
      supportsUptime: true,
      scopes: ['zone:read', 'dns:edit', 'firewall:edit', 'cache:purge'],
      defaultScopes: ['zone:read'],
      features: [
        { key: 'waf', label: 'Web application firewall', description: 'Managed rules.' },
        { key: 'dns', label: 'DNS', description: 'Firm portal domains.' },
        { key: 'cache', label: 'CDN cache', description: 'Static assets.' },
      ],
      webhookPath: null,
      volumeUnit: 'REQUESTS',
      volumeLabel: 'Requests Served',
      requestLabel: 'API Calls',
    },
    {
      key: 'google_maps',
      name: 'Google Maps Platform',
      category: 'OTHER',
      description: 'Address lookup and validation',
      websiteUrl: 'https://mapsplatform.google.com',
      docsUrl: 'https://developers.google.com/maps/documentation',
      statusUrl: null,
      authType: 'API_KEY',
      fields: [secretField('apiKey', 'API Key', 'AIza…', both('AIza'))],
      supportsTest: true,
      supportsOAuth: false,
      supportsUptime: false,
      scopes: ['geocoding', 'places', 'address-validation'],
      defaultScopes: ['address-validation'],
      features: [
        { key: 'autocomplete', label: 'Address autocomplete', description: 'Intake forms.' },
        { key: 'validation', label: 'Address validation', description: 'Mailing addresses.' },
      ],
      webhookPath: null,
      volumeUnit: 'LOOKUPS',
      volumeLabel: 'Address Lookups',
      requestLabel: 'Requests',
    },
    {
      key: 'postmark',
      name: 'Postmark',
      category: 'EMAIL',
      description: 'Transactional email (standby)',
      websiteUrl: 'https://postmarkapp.com',
      docsUrl: 'https://postmarkapp.com/developer',
      statusUrl: 'https://status.postmarkapp.com',
      authType: 'API_KEY',
      fields: [
        secretField('serverToken', 'Server Token', '36 characters'),
        plainField('senderSignature', 'Sender Signature', 'notices@example.test'),
      ],
      supportsTest: true,
      supportsOAuth: false,
      supportsUptime: true,
      scopes: ['email:send', 'stats:read'],
      defaultScopes: ['email:send'],
      features: [
        { key: 'transactional', label: 'Transactional email', description: 'Receipts, resets.' },
      ],
      webhookPath: null,
      volumeUnit: 'EMAILS',
      volumeLabel: 'Emails Sent',
      requestLabel: 'API Calls',
    },
    {
      key: 'datadog',
      name: 'Datadog',
      category: 'SECURITY_INFRASTRUCTURE',
      description: 'Monitoring and alerting',
      websiteUrl: 'https://www.datadoghq.com',
      docsUrl: 'https://docs.datadoghq.com',
      statusUrl: 'https://status.datadoghq.com',
      authType: 'API_KEY',
      fields: [
        secretField('apiKey', 'API Key', '32 characters'),
        secretField('appKey', 'Application Key', '40 characters'),
        plainField('site', 'Site', 'datadoghq.com'),
      ],
      supportsTest: false,
      supportsOAuth: false,
      supportsUptime: true,
      scopes: ['metrics:write', 'logs:write', 'monitors:read'],
      defaultScopes: ['metrics:write'],
      features: [
        { key: 'metrics', label: 'Metrics', description: 'Service metrics.' },
        { key: 'logs', label: 'Log forwarding', description: 'Redacted logs.' },
      ],
      webhookPath: null,
      volumeUnit: 'REQUESTS',
      volumeLabel: 'Events Sent',
      requestLabel: 'API Calls',
    },
    {
      key: 'custom',
      name: 'Custom service',
      category: 'OTHER',
      description: 'Another provider, connected with an API key',
      websiteUrl: null,
      docsUrl: null,
      statusUrl: null,
      authType: 'API_KEY',
      fields: [
        secretField('apiKey', 'API Key', 'The provider’s API key'),
        plainField('baseUrl', 'Base URL', 'https://api.example.test', { kind: 'url' }),
      ],
      supportsTest: false,
      supportsOAuth: false,
      supportsUptime: false,
      scopes: [],
      defaultScopes: [],
      features: [],
      webhookPath: null,
      volumeUnit: 'REQUESTS',
      volumeLabel: 'Requests',
      requestLabel: 'Requests',
    },
  ];
  return templates;
}

// ---------- Helpers ----------

/** A repeatable number from 0 to 1 for row `n` (no Math.random, so every load is the same). */
const wave = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43_758.5453;
  return x - Math.floor(x);
};
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);

interface Clock {
  now: number;
  /** The ISO moment `minutes` ago. */
  ago: (minutes: number) => string;
}

// ---------- Platform integrations ----------

interface PlatformSeed {
  n: number;
  provider: string;
  name?: string;
  category?: IntegrationCategory;
  description?: string;
  longDescription?: string;
  environment: IntegrationEnvironment;
  status: IntegrationStatus;
  /** Masked or plain values by field key; absent fields stay unset. */
  values: Record<string, string>;
  uptime: number | null;
  /** Minutes ago. */
  lastSync: number | null;
  lastSyncOk?: boolean;
  lastCheck: number | null;
  lastCheckOk?: boolean;
  activatedDays: number | null;
  createdDays: number;
  rotatedDays?: number;
  critical?: boolean;
  reason?: StatusReason;
  settings?: Partial<PlatformSettings>;
  setupStep?: PlatformIntegration['setupStep'];
  disabledDays?: number;
  removedDays?: number;
  updatedBy?: string;
}

const REASONS = {
  openai: {
    code: 'ELEVATED_LATENCY',
    message:
      'Response times are elevated: 4.2 s on average over the last 2 days (normally about 1.5 s).',
    recommendedAction:
      'Check the provider status page, and lower AI request volume until it recovers.',
  },
  maps: {
    code: 'CREDENTIAL_EXPIRING',
    message: 'The API key expires in 9 days.',
    recommendedAction: 'Rotate the API key in Connection Settings before it expires.',
  },
  mls: {
    code: 'CONNECTION_FAILED',
    message: 'The provider has not answered since this morning (503 Service Unavailable).',
    recommendedAction:
      'View the provider status, and retry the sync once it recovers. Your credentials are unchanged.',
  },
  ses: {
    code: 'PAUSED',
    message: 'Paused: kept as a backup route for transactional email.',
    recommendedAction: 'Activate it if SendGrid needs a fallback.',
  },
  postmark: {
    code: 'DISABLED_BY_ADMIN',
    message: 'Disabled by Avery Sample: replaced by SendGrid.',
    recommendedAction: 'Enable it again only if it is needed.',
  },
} satisfies Record<string, StatusReason>;

function platformSeeds(): PlatformSeed[] {
  return [
    {
      n: 1,
      provider: 'stripe',
      longDescription:
        'Firmivra’s own Stripe account: firm subscriptions, platform invoices and payouts.',
      environment: 'LIVE',
      status: 'ACTIVE',
      values: {
        secretKey: 'sk_live_••••4242',
        publishableKey: 'pk_live_••••6789',
        webhookSecret: 'whsec_••••91c2',
        accountId: 'acct_1SampleFirmivra',
      },
      uptime: 99.98,
      lastSync: 10,
      lastCheck: 16 * 60 + 14,
      activatedDays: 223,
      createdDays: 224,
      rotatedDays: 41,
      critical: true,
      settings: {
        scopes: [
          'charges:read',
          'charges:write',
          'customers:write',
          'subscriptions:write',
          'invoices:write',
        ],
        syncSchedule: 'REALTIME',
        features: ['subscriptions', 'invoicing', 'payouts'],
        dataAccess: 'READ_WRITE',
        firmExposure: 'CATALOG',
      },
    },
    {
      n: 2,
      provider: 'twilio',
      environment: 'LIVE',
      status: 'ACTIVE',
      values: {
        accountSid: 'AC••••3e21',
        authToken: '••••8c1d',
        messagingServiceSid: 'MG••••4b6c',
        verifyServiceSid: 'VA••••8a1c',
      },
      uptime: 99.95,
      lastSync: 82,
      lastCheck: 3 * 1440,
      activatedDays: 210,
      createdDays: 212,
      rotatedDays: 95,
      settings: {
        scopes: ['messages:send', 'verify:send'],
        syncSchedule: 'REALTIME',
        features: ['sms', 'verify'],
        dataAccess: 'READ_WRITE',
        firmExposure: 'CATALOG',
      },
    },
    {
      n: 3,
      provider: 'sendgrid',
      environment: 'LIVE',
      status: 'ACTIVE',
      values: { apiKey: 'SG.••••Qx7e', senderDomain: 'mail.firmivra.example.test' },
      uptime: 99.99,
      lastSync: 118,
      lastCheck: 113,
      activatedDays: 205,
      createdDays: 205,
      rotatedDays: 0,
      settings: {
        scopes: ['mail:send', 'stats:read'],
        syncSchedule: 'HOURLY',
        features: ['transactional', 'events'],
        firmExposure: 'CATALOG',
      },
    },
    {
      n: 4,
      provider: 'aws',
      environment: 'LIVE',
      status: 'ACTIVE',
      values: {
        accessKeyId: 'AKIA••••7QXZ',
        secretAccessKey: '••••w9Lp',
        region: 'us-east-1',
        bucket: 'firmivra-documents-sample',
      },
      uptime: 99.97,
      lastSync: 159,
      lastCheck: 2 * 1440,
      activatedDays: 230,
      createdDays: 231,
      rotatedDays: 60,
      critical: true,
      settings: {
        scopes: ['s3:read', 's3:write', 'kms:encrypt'],
        syncSchedule: 'HOURLY',
        features: ['documents', 'backups', 'kms'],
        dataAccess: 'READ_WRITE',
        firmExposure: 'CATALOG',
      },
    },
    {
      n: 5,
      provider: 'openai',
      environment: 'LIVE',
      status: 'NEEDS_ATTENTION',
      values: { apiKey: 'sk-••••T3bQ', organizationId: 'org-SampleFirmivra' },
      uptime: 99.21,
      lastSync: 16 * 60 + 14,
      lastCheck: 16 * 60 + 14,
      activatedDays: 120,
      createdDays: 121,
      rotatedDays: 33,
      reason: REASONS.openai,
      settings: {
        scopes: ['models:read', 'responses:write'],
        syncSchedule: 'HOURLY',
        features: ['drafting', 'summaries'],
        firmExposure: 'CATALOG',
      },
    },
    {
      n: 6,
      provider: 'docusign',
      environment: 'LIVE',
      status: 'ACTIVE',
      values: {
        integrationKey: '7c2e1a94-3b5d-4f6a-9e8c-1d2b3a4c5e6f',
        accountId: 'a1b2c3d4-0000-4e5f-8a9b-sample000001',
        baseUrl: 'https://na4.docusign.net/',
      },
      uptime: 99.96,
      lastSync: 91,
      lastCheck: 4 * 1440,
      activatedDays: 180,
      createdDays: 181,
      rotatedDays: 25,
      settings: {
        scopes: ['signature', 'extended'],
        syncSchedule: 'REALTIME',
        features: ['envelopes', 'templates'],
        dataAccess: 'READ_WRITE',
        firmExposure: 'CATALOG',
      },
    },
    {
      n: 7,
      provider: 'mls_data',
      environment: 'LIVE',
      status: 'ERROR',
      values: {
        apiKey: '••••m2Rk',
        feedUrl: 'https://feed.mls.example.test/v2',
        memberId: 'M-204816',
      },
      uptime: 97.42,
      lastSync: 264,
      lastSyncOk: false,
      lastCheck: 250,
      lastCheckOk: false,
      activatedDays: 150,
      createdDays: 151,
      rotatedDays: 70,
      reason: REASONS.mls,
      settings: {
        scopes: ['listings:read', 'media:read'],
        syncSchedule: 'EVERY_15_MINUTES',
        features: ['listings', 'media'],
        firmExposure: 'CATALOG',
      },
    },
    {
      n: 8,
      provider: 'cloudflare',
      environment: 'LIVE',
      status: 'ACTIVE',
      values: { apiToken: '••••Jk8s', zoneId: '3f9a1c7e5b2d4f6a8c0e2b4d6f8a1c3e' },
      uptime: 99.99,
      lastSync: 136,
      lastCheck: 6 * 1440,
      activatedDays: 240,
      createdDays: 240,
      rotatedDays: 120,
      critical: true,
      settings: {
        scopes: ['zone:read', 'dns:edit', 'firewall:edit'],
        syncSchedule: 'DAILY',
        features: ['waf', 'dns', 'cache'],
        dataAccess: 'READ_WRITE',
      },
    },
    {
      n: 9,
      provider: 'google_maps',
      environment: 'LIVE',
      status: 'NEEDS_ATTENTION',
      values: { apiKey: 'AIza••••3kQw' },
      uptime: null,
      lastSync: 5 * 60,
      lastCheck: 2 * 1440,
      activatedDays: 140,
      createdDays: 141,
      rotatedDays: 356,
      reason: REASONS.maps,
      settings: {
        scopes: ['places', 'address-validation'],
        syncSchedule: 'MANUAL',
        features: ['autocomplete', 'validation'],
      },
    },
    {
      n: 10,
      provider: 'amazon_ses',
      environment: 'TEST',
      status: 'INACTIVE',
      values: { accessKeyId: 'AKIA••••2MNB', secretAccessKey: '••••r4Td', region: 'us-east-1' },
      uptime: 99.9,
      lastSync: 9 * 1440,
      lastCheck: 9 * 1440,
      activatedDays: 100,
      createdDays: 101,
      rotatedDays: 100,
      reason: REASONS.ses,
      settings: { scopes: ['ses:send'], syncSchedule: 'DAILY', features: ['transactional'] },
    },
    {
      n: 11,
      provider: 'postmark',
      environment: 'LIVE',
      status: 'DISABLED',
      values: { serverToken: '••••5e2a', senderSignature: 'notices@firmivra.example.test' },
      uptime: 99.94,
      lastSync: 20 * 1440 + 40,
      lastCheck: 30 * 1440,
      activatedDays: 300,
      createdDays: 301,
      rotatedDays: 200,
      reason: REASONS.postmark,
      disabledDays: 20,
      updatedBy: SECOND_ADMIN.name,
      settings: { scopes: ['email:send'], syncSchedule: 'HOURLY', features: ['transactional'] },
    },
    {
      n: 12,
      provider: 'datadog',
      environment: 'TEST',
      status: 'DRAFT',
      values: { site: 'datadoghq.com' },
      uptime: null,
      lastSync: null,
      lastCheck: null,
      activatedDays: null,
      createdDays: 2,
      setupStep: 'CONNECTION',
      settings: { scopes: ['metrics:write'], syncSchedule: 'EVERY_15_MINUTES', features: [] },
    },
    {
      n: 13,
      provider: 'custom_legacy_sms_gateway',
      name: 'Legacy SMS Gateway',
      category: 'COMMUNICATION',
      description: 'Former SMS provider (replaced by Twilio)',
      environment: 'LIVE',
      status: 'REMOVED',
      values: {},
      uptime: null,
      lastSync: 70 * 1440,
      lastCheck: 70 * 1440,
      activatedDays: 400,
      createdDays: 400,
      removedDays: 64,
      updatedBy: SECOND_ADMIN.name,
    },
  ];
}

function makePlatform(
  seed: PlatformSeed,
  clock: Clock,
  findTemplate: (key: string) => ProviderTemplate,
): PlatformIntegration {
  const template = findTemplate(seed.provider);
  const { ago } = clock;
  const days = (value: number | undefined) => (value === undefined ? null : ago(value * 1440));
  const rotated = days(seed.rotatedDays);
  const fields = template.fields.map((field) => ({
    ...field,
    display: seed.values[field.key] ?? null,
    updatedAt: seed.values[field.key] ? (rotated ?? ago(seed.createdDays * 1440)) : null,
  }));
  const oauthConnected = seed.status !== 'DRAFT' && seed.status !== 'REMOVED';
  const connection: PlatformIntegration['connection'] = {
    authType: template.authType,
    fields,
    webhookUrl: template.webhookPath
      ? `${WEBHOOK_HOST}${template.webhookPath}${seed.environment === 'TEST' ? '/test' : ''}`
      : null,
    oauth: template.supportsOAuth
      ? {
          connected: oauthConnected,
          account: oauthConnected ? 'Firmivra platform account' : null,
          connectedAt: oauthConnected ? rotated : null,
        }
      : null,
    secretRotatedAt: rotated,
    complete:
      fields.every((field) => !field.required || field.display !== null) &&
      (!template.supportsOAuth || oauthConnected),
  };
  const created = ago(seed.createdDays * 1440);
  const updatedAt = rotated && rotated > created ? rotated : created;
  const integration: PlatformIntegration = {
    id: integrationsUuid('1a01', seed.n),
    reference: `int_${String(seed.n).padStart(3, '0')}`,
    provider: seed.provider,
    name: seed.name ?? template.name,
    category: seed.category ?? template.category,
    description: seed.description ?? template.description,
    longDescription: seed.longDescription ?? null,
    logo: null,
    websiteUrl: template.websiteUrl,
    docsUrl: template.docsUrl,
    statusUrl: template.statusUrl,
    environment: seed.environment,
    status: seed.status,
    statusReason: seed.reason ?? null,
    connection,
    settings: {
      scopes: [...template.defaultScopes],
      syncSchedule: 'DAILY',
      features: [],
      dataAccess: 'READ_ONLY',
      retry: { maxRetries: 3, backoff: 'EXPONENTIAL' },
      firmExposure: 'PLATFORM_ONLY',
      ...seed.settings,
    },
    lastCheckAt: seed.lastCheck === null ? null : ago(seed.lastCheck),
    lastCheckOk: seed.lastCheck === null ? null : (seed.lastCheckOk ?? true),
    lastCheckMessage:
      seed.lastCheck === null
        ? null
        : seed.lastCheckOk === false
          ? `${template.name} did not answer (503 Service Unavailable).`
          : `Connection successful (${seed.environment === 'LIVE' ? 'Live' : 'Test'}).`,
    lastSyncAt: seed.lastSync === null ? null : ago(seed.lastSync),
    lastSyncOk: seed.lastSync === null ? null : (seed.lastSyncOk ?? true),
    uptime30d: seed.uptime,
    supportsTest: template.supportsTest,
    supportsUptime: template.supportsUptime,
    critical: seed.critical ?? false,
    activatedWithoutTest: false,
    activatedAt: days(seed.activatedDays ?? undefined),
    disabledAt: days(seed.disabledDays),
    removedAt: days(seed.removedDays),
    setupStep: seed.setupStep ?? 'REVIEW',
    latestError: null,
    sortOrder: seed.n,
    version: 1 + (seed.n % 4) + (seed.rotatedDays !== undefined ? 1 : 0),
    createdAt: created,
    updatedAt: seed.disabledDays
      ? ago(seed.disabledDays * 1440)
      : seed.removedDays
        ? ago(seed.removedDays * 1440)
        : updatedAt,
    updatedBy: seed.updatedBy ?? INTEGRATIONS_ADMIN.name,
  };
  return integration;
}

// ---------- Runs and the log ----------

interface LogSeed {
  minutesAgo: number;
  source?: LogSource;
  integration?: PlatformIntegration | null;
  /** Shown as the integration for firm connections (the catalog name). */
  integrationName?: string;
  provider?: string;
  environment?: IntegrationEnvironment | null;
  severity: LogSeverity;
  eventType: string;
  action: string;
  succeeded: boolean;
  errorCode?: string | null;
  message: string;
  details?: { label: string; value: string }[];
  correlationId?: string;
  firm?: { id: string; name: string } | null;
  actor?: IntegrationLog['actor'];
  endpoint?: string | null;
  resolution?: LogResolution | null;
}

const SCHEDULER = { type: 'SYSTEM' as const, id: null, name: 'Firmivra scheduler' };

function buildRuns(
  platform: PlatformIntegration[],
  clock: Clock,
  addLog: (seed: LogSeed) => IntegrationLog,
): PlatformRun[] {
  const runs: PlatformRun[] = [];
  let runNumber = 1;
  for (const integration of platform) {
    if (!integration.lastSyncAt || integration.status === 'DRAFT') continue;
    const last = Date.parse(integration.lastSyncAt);
    const minutesAgo = Math.round((clock.now - last) / MINUTE_MS);
    const failing = integration.status === 'ERROR';
    const index = integration.sortOrder;
    // Six syncs, about four days apart, newest at lastSyncAt; then two connection tests.
    for (let k = 0; k < 8; k += 1) {
      const test = k >= 6;
      const at = test
        ? minutesAgo + (k === 6 ? 2 * 1440 + 95 : 11 * 1440 + 30) + index * 7
        : minutesAgo + k * (4 * 1440 + 130 + index * 11);
      if (at > 30 * 1440 + 600) continue;
      const failed = failing && !test && k < 4;
      const partial = !failed && !test && integration.provider === 'openai' && k === 0;
      const status: RunStatus = failed ? 'FAILED' : partial ? 'PARTIAL' : 'SUCCEEDED';
      const objects = test ? 0 : failed ? 0 : 40 + Math.round(wave(index * 31 + k) * 160);
      const correlation = `corr_${(index * 1000 + k).toString(36)}${index}`;
      const runId = integrationsUuid('1a02', runNumber);
      runNumber += 1;
      const started = clock.ago(at);
      const duration = test
        ? 180 + Math.round(wave(index + k) * 300)
        : failed
          ? 30_000
          : 1_800 + Math.round(wave(index * 7 + k) * 4_000);
      const log = addLog({
        minutesAgo: at,
        integration,
        severity: failed ? (k === 0 ? 'CRITICAL' : 'ERROR') : partial ? 'WARNING' : 'INFO',
        eventType: test
          ? 'connection.test'
          : failed
            ? 'sync.failed'
            : partial
              ? 'sync.partial'
              : 'sync.completed',
        action: test
          ? 'Test connection'
          : failed
            ? 'Synchronization failed'
            : partial
              ? 'Synchronization partly completed'
              : 'Synchronization completed',
        succeeded: !failed,
        errorCode: failed ? 'PROVIDER_UNAVAILABLE' : partial ? 'TIMEOUT' : null,
        message: test
          ? `${integration.name} connection test passed`
          : failed
            ? `${integration.name} synchronization failed: connection failed`
            : partial
              ? `${integration.name} synchronization partly completed (3 requests timed out)`
              : `${integration.name} synchronization completed`,
        details: test
          ? [{ label: 'Latency', value: `${duration} ms` }]
          : [
              { label: 'Objects processed', value: String(objects) },
              { label: 'Duration', value: `${(duration / 1000).toFixed(1)} s` },
              ...(failed ? [{ label: 'Retries', value: '3' }] : []),
            ],
        correlationId: correlation,
        actor: test
          ? { type: 'USER', id: INTEGRATIONS_ADMIN.id, name: INTEGRATIONS_ADMIN.name }
          : SCHEDULER,
        endpoint: test ? 'GET /v1/health' : 'POST /sync',
        resolution: failed
          ? k === 0
            ? {
                action: 'VIEW_PROVIDER_STATUS',
                label: 'View Provider Status',
                href: integration.statusUrl,
              }
            : {
                action: 'RETRY_SYNC',
                label: 'Retry Sync',
                href: `/integrations/platform/${integration.id}`,
              }
          : null,
      });
      runs.push({
        id: runId,
        integrationId: integration.id,
        kind: test ? 'TEST' : 'SYNC',
        status,
        trigger: test ? 'MANUAL' : 'SCHEDULE',
        requestedBy: test ? INTEGRATIONS_ADMIN.name : null,
        createdAt: started,
        startedAt: started,
        finishedAt: new Date(Date.parse(started) + duration).toISOString(),
        durationMs: duration,
        objectCount: objects,
        failedCount: partial ? 3 : 0,
        retries: failed ? 3 : partial ? 1 : 0,
        errorCode: log.errorCode,
        errorMessage: failed
          ? `${integration.name} did not answer (503 Service Unavailable).`
          : partial
            ? 'Three requests timed out and were skipped.'
            : null,
        correlationId: correlation,
        logId: log.id,
      });
      if (failed && k === 0)
        integration.latestError = {
          code: 'PROVIDER_UNAVAILABLE',
          title: 'Connection failed',
          message: `${integration.name} did not answer (503 Service Unavailable).`,
          at: started,
          logId: log.id,
          requestId: log.requestId,
        } satisfies IntegrationError;
    }
  }
  return runs;
}

/** Events beside the runs: webhooks, credentials, health, firm connections and API keys. */
function eventLogs(
  platform: PlatformIntegration[],
  firms: { id: string; name: string }[],
  addLog: (seed: LogSeed) => IntegrationLog,
) {
  const by = (provider: string) => platform.find((item) => item.provider === provider) ?? null;
  const admin = { type: 'USER' as const, id: INTEGRATIONS_ADMIN.id, name: INTEGRATIONS_ADMIN.name };
  const provider = (name: string) => ({ type: 'PROVIDER' as const, id: null, name });
  const firm = (index: number) => {
    const found = firms[index % firms.length];
    return found ? { id: found.id, name: found.name } : null;
  };
  const stripe = by('stripe');
  const mls = by('mls_data');
  const sendgrid = by('sendgrid');
  const openai = by('openai');
  const twilio = by('twilio');
  const maps = by('google_maps');
  const cloudflare = by('cloudflare');
  const postmark = by('postmark');
  const docusign = by('docusign');
  const seeds: LogSeed[] = [
    {
      minutesAgo: 36,
      source: 'WEBHOOK',
      integration: mls,
      severity: 'INFO',
      eventType: 'webhook.received',
      action: 'Webhook received',
      succeeded: true,
      message: 'New webhook received (MLS)',
      details: [
        { label: 'Event', value: 'listing.updated' },
        { label: 'Signature', value: 'Verified' },
      ],
      actor: provider('MLS Data Provider'),
      endpoint: `${WEBHOOK_HOST}/webhooks/mls`,
    },
    {
      minutesAgo: 113,
      integration: sendgrid,
      severity: 'INFO',
      eventType: 'credentials.rotated',
      action: 'API key rotated',
      succeeded: true,
      message: 'SendGrid API key rotated',
      details: [
        { label: 'Field', value: 'API Key' },
        { label: 'New key', value: 'SG.••••Qx7e' },
      ],
      actor: admin,
    },
    {
      minutesAgo: 16 * 60 + 14,
      integration: openai,
      severity: 'WARNING',
      eventType: 'latency.elevated',
      action: 'Response time elevated',
      succeeded: true,
      message: 'OpenAI response time elevated',
      details: [
        { label: 'Average latency', value: '4,200 ms' },
        { label: 'Usual latency', value: '1,450 ms' },
      ],
      actor: SCHEDULER,
      resolution: {
        action: 'VIEW_PROVIDER_STATUS',
        label: 'View Provider Status',
        href: 'https://status.openai.com',
      },
    },
    {
      minutesAgo: 18 * 60 + 22,
      integration: twilio,
      severity: 'INFO',
      eventType: 'verify.check',
      action: 'Number verification',
      succeeded: true,
      message: 'Twilio number verification successful',
      details: [{ label: 'Number', value: '+1 (555) ••• ••42' }],
      actor: SCHEDULER,
    },
    {
      minutesAgo: 2 * 1440 + 30,
      integration: maps,
      severity: 'WARNING',
      eventType: 'credentials.expiring',
      action: 'Credential expiring',
      succeeded: true,
      message: 'Google Maps Platform API key expires in 9 days',
      actor: SCHEDULER,
      resolution: {
        action: 'UPDATE_CREDENTIAL',
        label: 'Update Credential',
        href: maps ? `/integrations/platform/${maps.id}` : null,
      },
    },
    {
      minutesAgo: 3 * 1440 + 200,
      integration: cloudflare,
      severity: 'INFO',
      eventType: 'config.updated',
      action: 'Configuration updated',
      succeeded: true,
      message: 'Cloudflare configuration updated',
      details: [{ label: 'Scopes', value: 'changed' }],
      actor: admin,
    },
    {
      minutesAgo: 20 * 1440,
      integration: postmark,
      severity: 'WARNING',
      eventType: 'integration.disabled',
      action: 'Integration disabled',
      succeeded: true,
      message: 'Postmark disabled',
      details: [{ label: 'Reason', value: 'Replaced by SendGrid' }],
      actor: { type: 'USER', id: SECOND_ADMIN.id, name: SECOND_ADMIN.name },
    },
    {
      minutesAgo: 5 * 1440 + 75,
      integration: twilio,
      severity: 'WARNING',
      eventType: 'rate_limit.warning',
      action: 'Rate limit warning',
      succeeded: true,
      message: 'Twilio messaging reached 85% of its rate limit',
      details: [{ label: 'Peak', value: '85 messages per second' }],
      actor: SCHEDULER,
    },
    {
      minutesAgo: 9 * 1440 + 15,
      integration: docusign,
      severity: 'INFO',
      eventType: 'credentials.reconnected',
      action: 'OAuth reconnected',
      succeeded: true,
      message: 'DocuSign OAuth connection refreshed',
      actor: admin,
    },
    {
      minutesAgo: 4 * 1440 + 610,
      source: 'WEBHOOK',
      integration: stripe,
      severity: 'ERROR',
      eventType: 'webhook.signature_invalid',
      action: 'Webhook rejected',
      succeeded: false,
      errorCode: 'SIGNATURE_INVALID',
      message: 'Stripe webhook rejected: signature did not match',
      details: [{ label: 'Event', value: 'invoice.paid' }],
      actor: provider('Stripe'),
      endpoint: `${WEBHOOK_HOST}/webhooks/stripe`,
      resolution: {
        action: 'VIEW_WEBHOOK',
        label: 'View Webhook',
        href: '/integrations/api-webhooks',
      },
    },
  ];
  // Inbound webhooks over the month: Stripe invoices and MLS listing updates.
  for (let i = 0; i < 16; i += 1) {
    const isStripe = i % 2 === 0;
    seeds.push({
      minutesAgo: 1440 + i * 2 * 1440 + Math.round(wave(i + 300) * 900),
      source: 'WEBHOOK',
      integration: isStripe ? stripe : mls,
      severity: 'INFO',
      eventType: 'webhook.received',
      action: 'Webhook received',
      succeeded: true,
      message: isStripe ? 'Stripe webhook received (invoice.paid)' : 'New webhook received (MLS)',
      details: [{ label: 'Event', value: isStripe ? 'invoice.paid' : 'listing.created' }],
      actor: provider(isStripe ? 'Stripe' : 'MLS Data Provider'),
      endpoint: `${WEBHOOK_HOST}/webhooks/${isStripe ? 'stripe' : 'mls'}`,
    });
  }
  // Firms connecting their own accounts (catalog providers; the firm is named, never its data).
  const firmEvents: [string, string, 'connected' | 'disconnected' | 'auth_expired'][] = [
    ['stripe', 'Stripe', 'connected'],
    ['docusign', 'DocuSign', 'connected'],
    ['twilio', 'Twilio', 'connected'],
    ['quickbooks_online', 'QuickBooks Online', 'auth_expired'],
    ['sendgrid', 'SendGrid', 'connected'],
    ['dropbox', 'Dropbox', 'disconnected'],
    ['calendly', 'Calendly', 'connected'],
    ['openai', 'OpenAI', 'connected'],
    ['zapier', 'Zapier', 'auth_expired'],
    ['amazon_s3', 'Amazon S3', 'connected'],
    ['mls_feed', 'MLS Data Feed', 'connected'],
    ['stripe', 'Stripe', 'disconnected'],
  ];
  firmEvents.forEach(([key, name, kind], i) => {
    const who = firm(i * 5 + 1);
    seeds.push({
      minutesAgo: 6 * 60 + i * 2 * 1440 + Math.round(wave(i + 500) * 700),
      source: 'FIRM_CONNECTION',
      integration: null,
      integrationName: name,
      provider: key,
      environment: 'LIVE',
      severity: kind === 'auth_expired' ? 'WARNING' : 'INFO',
      eventType: `firm.${kind}`,
      action:
        kind === 'connected'
          ? 'Firm connected'
          : kind === 'disconnected'
            ? 'Firm disconnected'
            : 'Firm authorization expired',
      succeeded: kind !== 'auth_expired',
      errorCode: kind === 'auth_expired' ? 'TOKEN_EXPIRED' : null,
      message:
        kind === 'connected'
          ? `${who?.name ?? 'A firm'} connected ${name}`
          : kind === 'disconnected'
            ? `${who?.name ?? 'A firm'} disconnected ${name}`
            : `${name} authorization expired for ${who?.name ?? 'a firm'}`,
      firm: who,
      actor:
        kind === 'auth_expired' ? provider(name) : { type: 'USER', id: null, name: 'Firm owner' },
      resolution:
        kind === 'auth_expired' ? { action: 'RECONNECT', label: 'Reconnect', href: null } : null,
    });
  });
  // Firmivra API keys: rate limits and refused keys.
  for (let i = 0; i < 6; i += 1) {
    const limited = i % 2 === 0;
    seeds.push({
      minutesAgo: 3 * 60 + i * 4 * 1440 + Math.round(wave(i + 700) * 400),
      source: 'API',
      integration: null,
      environment: limited ? 'TEST' : 'LIVE',
      severity: limited ? 'WARNING' : 'ERROR',
      eventType: limited ? 'api.rate_limited' : 'api.auth_failed',
      action: limited ? 'Rate limit reached' : 'API key refused',
      succeeded: false,
      errorCode: limited ? 'RATE_LIMITED' : 'KEY_REVOKED',
      message: limited
        ? 'API key fv_test_r2Vd…9kQe reached its rate limit (429)'
        : 'A revoked API key (fv_live_q7Lm…a91X) was refused (401)',
      details: [{ label: 'Endpoint', value: limited ? 'GET /v1/integrations' : 'GET /v1/usage' }],
      actor: { type: 'SYSTEM', id: null, name: 'Firmivra API' },
      endpoint: limited ? 'GET /v1/integrations' : 'GET /v1/usage',
    });
  }
  // Outbound deliveries that failed on the ops endpoint.
  for (let i = 0; i < 4; i += 1)
    seeds.push({
      minutesAgo: 50 + i * 1440 + Math.round(wave(i + 900) * 300),
      source: 'WEBHOOK',
      integration: null,
      environment: 'LIVE',
      severity: 'ERROR',
      eventType: 'webhook.delivery_failed',
      action: 'Webhook delivery failed',
      succeeded: false,
      errorCode: 'HTTP_500',
      message: 'Delivery of integration.error to ops.example.test failed (500)',
      details: [{ label: 'Attempts', value: '6' }],
      actor: { type: 'SYSTEM', id: null, name: 'Webhook dispatcher' },
      endpoint: 'https://ops.example.test/alerts/integrations',
      resolution: {
        action: 'VIEW_WEBHOOK',
        label: 'View Webhook',
        href: '/integrations/api-webhooks',
      },
    });
  for (const seed of seeds) addLog(seed);
}

// ---------- Catalog ----------

interface CatalogSeed {
  n: number;
  provider: string;
  name: string;
  category: IntegrationCategory;
  short: string;
  description?: string;
  status: CatalogStatus;
  plans: number[] | null;
  firmsUsing: number;
  linked: string | null;
  badges?: string[];
  createdDays: number;
  website: string;
  setup?: Partial<CatalogSetup>;
  rules?: { firm: number; access: FirmAccess; reason: string }[];
  beta?: boolean;
  deprecation?: string;
}

/** Plan indexes: 0 Solo Core, 1 Solo Pro, 2 Solo Elite, 3 Team Pro, 4 Business, 5 Enterprise. */
const TEAM_UP = [3, 4, 5];
function catalogSeeds(): CatalogSeed[] {
  return [
    {
      n: 1,
      provider: 'stripe',
      name: 'Stripe',
      category: 'PAYMENTS_BILLING',
      short: 'Process payments, subscriptions and invoicing.',
      description:
        '<p>Stripe allows firms to accept payments, manage subscriptions, and handle invoicing securely. It supports one-time payments, recurring billing, and integrates with your Firmivra platform for a seamless client experience.</p>',
      status: 'ENABLED',
      plans: null,
      firmsUsing: 12,
      linked: 'stripe',
      badges: ['Popular'],
      createdDays: 200,
      website: 'https://stripe.com',
    },
    {
      n: 2,
      provider: 'twilio',
      name: 'Twilio',
      category: 'COMMUNICATION',
      short: 'SMS, voice and verification services.',
      status: 'ENABLED',
      plans: TEAM_UP,
      firmsUsing: 10,
      linked: 'twilio',
      createdDays: 190,
      website: 'https://www.twilio.com',
      setup: {
        authType: 'API_KEY',
        instructions:
          'Copy the Account SID and Auth Token from your Twilio console and paste them below. Firmivra sends texts from your own Twilio number.',
        requiredFields: [
          {
            key: 'accountSid',
            label: 'Account SID',
            secret: false,
            required: true,
            help: 'Starts with AC.',
          },
          { key: 'authToken', label: 'Auth Token', secret: true, required: true, help: null },
          {
            key: 'fromNumber',
            label: 'Sending number',
            secret: false,
            required: true,
            help: 'In +1 format.',
          },
        ],
      },
      rules: [{ firm: 7, access: 'ALLOW', reason: 'Pilot for SMS appointment reminders' }],
    },
    {
      n: 3,
      provider: 'sendgrid',
      name: 'SendGrid',
      category: 'EMAIL',
      short: 'Transactional and marketing emails.',
      status: 'ENABLED',
      plans: null,
      firmsUsing: 11,
      linked: 'sendgrid',
      createdDays: 185,
      website: 'https://sendgrid.com',
    },
    {
      n: 4,
      provider: 'amazon_s3',
      name: 'Amazon S3',
      category: 'CLOUD_STORAGE',
      short: 'File storage, backups and media.',
      status: 'ENABLED',
      plans: null,
      firmsUsing: 8,
      linked: 'aws',
      createdDays: 180,
      website: 'https://aws.amazon.com/s3',
    },
    {
      n: 5,
      provider: 'openai',
      name: 'OpenAI',
      category: 'AI_AUTOMATION',
      short: 'AI tools for content, automation and insights.',
      status: 'ENABLED',
      plans: TEAM_UP,
      firmsUsing: 9,
      linked: 'openai',
      badges: ['New'],
      beta: true,
      createdDays: 110,
      website: 'https://openai.com',
      rules: [{ firm: 1, access: 'DENY', reason: 'The firm opted out of AI features' }],
    },
    {
      n: 6,
      provider: 'docusign',
      name: 'DocuSign',
      category: 'ESIGN',
      short: 'Document signing and e-sign workflows.',
      status: 'ENABLED',
      plans: null,
      firmsUsing: 13,
      linked: 'docusign',
      createdDays: 170,
      website: 'https://www.docusign.com',
    },
    {
      n: 7,
      provider: 'mls_feed',
      name: 'MLS Data Feed',
      category: 'MLS_DATA',
      short: 'MLS data and property listings.',
      status: 'ENABLED',
      plans: TEAM_UP,
      firmsUsing: 7,
      linked: 'mls_data',
      createdDays: 140,
      website: 'https://mls.example.test',
    },
    {
      n: 8,
      provider: 'quickbooks_online',
      name: 'QuickBooks Online',
      category: 'OTHER',
      short: 'Accounting and bookkeeping integration.',
      status: 'DISABLED',
      plans: [4, 5],
      firmsUsing: 0,
      linked: null,
      createdDays: 90,
      website: 'https://quickbooks.intuit.com',
    },
    {
      n: 9,
      provider: 'zapier',
      name: 'Zapier',
      category: 'AI_AUTOMATION',
      short: 'Connect with thousands of apps.',
      status: 'ENABLED',
      plans: TEAM_UP,
      firmsUsing: 5,
      linked: null,
      createdDays: 75,
      website: 'https://zapier.com',
    },
    {
      n: 10,
      provider: 'google_workspace',
      name: 'Google Workspace',
      category: 'EMAIL',
      short: 'Email, calendar and collaboration.',
      status: 'COMING_SOON',
      plans: null,
      firmsUsing: 0,
      linked: null,
      createdDays: -1,
      website: 'https://workspace.google.com',
    },
    {
      n: 11,
      provider: 'microsoft_365',
      name: 'Microsoft 365',
      category: 'EMAIL',
      short: 'Outlook mail, calendar and OneDrive files.',
      status: 'COMING_SOON',
      plans: [4, 5],
      firmsUsing: 0,
      linked: null,
      createdDays: -2,
      website: 'https://www.microsoft.com/microsoft-365',
    },
    {
      n: 12,
      provider: 'dropbox',
      name: 'Dropbox',
      category: 'CLOUD_STORAGE',
      short: 'Shared folders for client documents.',
      status: 'DISABLED',
      plans: null,
      firmsUsing: 3,
      linked: null,
      createdDays: 260,
      website: 'https://www.dropbox.com',
      deprecation:
        'Replaced by Amazon S3 document storage. Existing connections keep working until year end.',
    },
    {
      n: 13,
      provider: 'xero',
      name: 'Xero',
      category: 'OTHER',
      short: 'Cloud accounting for small businesses.',
      status: 'DISABLED',
      plans: [4, 5],
      firmsUsing: 0,
      linked: null,
      createdDays: 60,
      website: 'https://www.xero.com',
    },
    {
      n: 14,
      provider: 'calendly',
      name: 'Calendly',
      category: 'OTHER',
      short: 'Online scheduling for client meetings.',
      status: 'ENABLED',
      plans: null,
      firmsUsing: 6,
      linked: null,
      createdDays: 50,
      website: 'https://calendly.com',
    },
    {
      n: 15,
      provider: 'gusto',
      name: 'Gusto',
      category: 'OTHER',
      short: 'Payroll, benefits and HR.',
      status: 'COMING_SOON',
      plans: TEAM_UP,
      firmsUsing: 0,
      linked: null,
      createdDays: 20,
      website: 'https://gusto.com',
    },
  ];
}

// ---------- The store ----------

const PLAN_SEEDS = [
  ['SOLO_CORE', 'Solo Core'],
  ['SOLO_PRO', 'Solo Pro'],
  ['SOLO_ELITE', 'Solo Elite'],
  ['TEAM_PRO', 'Team Pro'],
  ['BUSINESS', 'Business'],
  ['ENTERPRISE', 'Enterprise'],
] as const;
const FIRM_NAMES = [
  'Sample Tax Partners',
  'Example Bookkeeping Co',
  'Sample Ledger Group',
  'Example CPA Studio',
  'Sample Payroll Works',
  'Example Advisory LLC',
  'Sample Audit House',
  'Example Tax Desk',
  'Sample Books & Co',
  'Example Ledger Lane',
  'Sample Small Business CPAs',
  'Example Family Tax',
  'Sample Harbor Accounting',
  'Example Summit Tax',
  'Sample Northside Bookkeeping',
  'Example Prairie CPAs',
  'Sample Coastal Tax',
  'Example Metro Accounting',
];
/** Each firm's plan (indexes into PLAN_SEEDS): twelve firms are on Team Pro or above. */
const FIRM_PLANS = [3, 4, 5, 1, 2, 3, 4, 0, 5, 3, 4, 1, 2, 3, 4, 5, 0, 3];

export function seedIntegrationsStore(empty: boolean): IntegrationsStore {
  const now = Date.now();
  const clock: Clock = { now, ago: (minutes) => new Date(now - minutes * MINUTE_MS).toISOString() };
  const { ago } = clock;
  const plans = PLAN_SEEDS.map(([code, name], i) => ({
    id: integrationsUuid('1a0a', i + 1),
    code,
    name,
  }));
  const planId = (index: number) => plans[index]?.id ?? '';
  const firms = FIRM_NAMES.map((name, i) => ({
    id: integrationsUuid('1a0b', i + 1),
    name,
    planId: planId(FIRM_PLANS[i] ?? 0),
  }));
  const thresholds: UsageThresholds = {
    version: 1,
    errorRatePercent: 5,
    latencyMs: 3000,
    quotaPercent: 80,
    monthlyCostCents: 2_000_000,
    syncFailures: 3,
    updatedAt: ago(30 * 1440),
    updatedBy: INTEGRATIONS_ADMIN.name,
  };
  const base: IntegrationsStore = {
    platform: [],
    runs: [],
    logs: [],
    catalog: [],
    apiKeys: [],
    webhooks: [],
    deliveries: [],
    usage: [],
    audit: [],
    thresholds,
    plans,
    firms,
    rejected: [],
    outages: [],
    next: 5000,
  };
  if (empty) return base;

  const all = providerTemplates();
  const findTemplate = (key: string): ProviderTemplate => {
    const found = all.find((item) => item.key === key) ?? all.find((item) => item.key === 'custom');
    if (!found) throw new Error('The custom provider template is missing.');
    return found;
  };
  const platform = platformSeeds().map((seed) => makePlatform(seed, clock, findTemplate));
  const byProvider = (key: string) => platform.find((item) => item.provider === key);

  // The log: built in any order, then kept newest first by the client.
  const logs: IntegrationLog[] = [];
  const addLog = (seed: LogSeed): IntegrationLog => {
    const n = logs.length + 1;
    const integration = seed.integration ?? null;
    const entry: IntegrationLog = {
      id: integrationsUuid('1a03', n),
      at: ago(seed.minutesAgo),
      source: seed.source ?? 'PLATFORM_INTEGRATION',
      integrationId: integration?.id ?? null,
      integrationName: integration?.name ?? seed.integrationName ?? null,
      provider: integration?.provider ?? seed.provider ?? null,
      environment:
        seed.environment === undefined ? (integration?.environment ?? null) : seed.environment,
      severity: seed.severity,
      eventType: seed.eventType,
      action: seed.action,
      succeeded: seed.succeeded,
      errorCode: seed.errorCode ?? null,
      message: seed.message,
      details: seed.details ?? [],
      requestId: `req_${(n * 7919 + 104_729).toString(36).toUpperCase()}`,
      correlationId: seed.correlationId ?? `corr_${(n * 15_485_863).toString(36)}`,
      firm: seed.firm ?? null,
      actor: seed.actor ?? SCHEDULER,
      endpoint: seed.endpoint ?? null,
      resolution: seed.resolution ?? null,
    };
    logs.push(entry);
    return entry;
  };
  const runs = buildRuns(platform, clock, addLog);
  eventLogs(platform, firms, addLog);

  // The MLS provider is down; its credentials are fine.
  const mls = byProvider('mls_data');
  const outages = mls ? [mls.id] : [];

  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const catalog: CatalogRecord[] = catalogSeeds().map((seed): CatalogRecord => {
    const planAccess: PlanAccess = seed.plans ? 'SELECTED_PLANS' : 'ALL_PLANS';
    const planIds = (seed.plans ?? []).map(planId);
    const firmRules = (seed.rules ?? []).map((rule) => ({
      businessId: firms[rule.firm]?.id ?? '',
      access: rule.access,
      reason: rule.reason,
      updatedAt: ago(12 * 1440 + seed.n * 60),
      updatedBy: INTEGRATIONS_ADMIN.name,
    }));
    const sees = (firm: { id: string; planId: string }) => {
      const rule = firmRules.find((item) => item.businessId === firm.id);
      if (rule) return rule.access === 'ALLOW';
      return planAccess === 'ALL_PLANS' || planIds.includes(firm.planId);
    };
    const connected = firms
      .filter(sees)
      .slice(0, seed.firmsUsing)
      .map((firm) => firm.id);
    // Negative days: added this calendar month (the catalog's "added this month").
    const created =
      seed.createdDays < 0
        ? new Date(Math.max(monthStart, now + seed.createdDays * 26 * 3_600_000)).toISOString()
        : ago(seed.createdDays * 1440);
    const setup: CatalogSetup = {
      authType: 'OAUTH',
      instructions: `Click Connect and sign in to your ${seed.name} account. Firmivra asks only for the permissions it needs, and you can disconnect at any time.`,
      requiredFields: [],
      helpText: `Need help? Read the ${seed.name} setup guide.`,
      testOnConnect: true,
      ...seed.setup,
    };
    return {
      id: integrationsUuid('1a04', seed.n),
      provider: seed.provider,
      name: seed.name,
      category: seed.category,
      shortDescription: seed.short,
      description: seed.description ?? `<p>${seed.short}</p>`,
      logo: null,
      websiteUrl: seed.website,
      helpUrl: `https://help.firmivra.example.test/integrations/${seed.provider}`,
      displayLabel: null,
      status: seed.status,
      planAccess,
      planIds,
      firmRules,
      requiredRole: 'OWNER_ADMIN',
      setup,
      badges: seed.badges ?? [],
      sortOrder: seed.n,
      advanced: {
        featureFlag: seed.beta ? 'catalog_openai_beta' : null,
        beta: seed.beta ?? false,
        deprecationNotice: seed.deprecation ?? null,
        minAppVersion: null,
        rolloutPercent: seed.beta ? 50 : 100,
        regions: [],
      },
      platformIntegrationId: seed.linked ? (byProvider(seed.linked)?.id ?? null) : null,
      connectedFirmIds: connected,
      activeFirmIds: connected.slice(0, Math.ceil(connected.length * 0.8)),
      totalConnections: connected.length + Math.round(connected.length * 0.6) + (seed.n % 3),
      lastActivityAt: connected.length ? ago(30 + seed.n * 47) : null,
      version: 1 + (seed.n % 3),
      createdAt: created,
      updatedAt:
        seed.createdDays < 0 ? created : ago(Math.min(seed.createdDays, 6 + seed.n) * 1440),
      updatedBy: INTEGRATIONS_ADMIN.name,
    };
  });

  // API keys: a rotation (the old key revoked), a live key and a test key near its limit.
  const apiKeys: ApiKeyRecord[] = [
    {
      id: integrationsUuid('1a05', 1),
      name: 'Sample Partner Portal',
      prefix: 'fv_live_8k2q',
      lastFour: 'Zt4P',
      keyHash: 'sha256:sample-hash-1',
      scopes: ['integrations:read', 'usage:read'],
      environment: 'LIVE',
      rateLimitPerMinute: 600,
      expiresAt: new Date(now + 325 * DAY_MS).toISOString(),
      lastUsedAt: ago(14),
      rotatedFromId: integrationsUuid('1a05', 3),
      rotatedToId: null,
      revokedAt: null,
      revokedBy: null,
      createdAt: ago(40 * 1440),
      createdBy: INTEGRATIONS_ADMIN.name,
      usage24h: { requests: 18_420, peakPerMinute: 212, rateLimited: 0 },
    },
    {
      id: integrationsUuid('1a05', 2),
      name: 'Staging QA Suite',
      prefix: 'fv_test_r2Vd',
      lastFour: '9kQe',
      keyHash: 'sha256:sample-hash-2',
      scopes: ['integrations:read', 'integrations:write', 'webhooks:manage', 'logs:read'],
      environment: 'TEST',
      rateLimitPerMinute: 120,
      expiresAt: new Date(now + 9 * DAY_MS).toISOString(),
      lastUsedAt: ago(3 * 60),
      rotatedFromId: null,
      rotatedToId: null,
      revokedAt: null,
      revokedBy: null,
      createdAt: ago(80 * 1440),
      createdBy: SECOND_ADMIN.name,
      usage24h: { requests: 2_310, peakPerMinute: 118, rateLimited: 4 },
    },
    {
      id: integrationsUuid('1a05', 3),
      name: 'Sample Partner Portal',
      prefix: 'fv_live_q7Lm',
      lastFour: 'a91X',
      keyHash: 'sha256:sample-hash-3',
      scopes: ['integrations:read', 'usage:read'],
      environment: 'LIVE',
      rateLimitPerMinute: 600,
      expiresAt: null,
      lastUsedAt: ago(40 * 1440 + 30),
      rotatedFromId: null,
      rotatedToId: integrationsUuid('1a05', 1),
      revokedAt: ago(40 * 1440),
      revokedBy: INTEGRATIONS_ADMIN.name,
      createdAt: ago(160 * 1440),
      createdBy: INTEGRATIONS_ADMIN.name,
      usage24h: { requests: 0, peakPerMinute: 0, rateLimited: 0 },
    },
  ];

  const stripe = byProvider('stripe');
  const webhooks: WebhookRecord[] = [
    {
      id: integrationsUuid('1a06', 1),
      direction: 'INBOUND',
      url: `${WEBHOOK_HOST}/webhooks/stripe`,
      description: 'Stripe events for Firmivra billing',
      events: ['invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated'],
      status: 'ACTIVE',
      maxRetries: 5,
      signingSecretHint: 'whsec_••••91c2',
      secretRotatedAt: ago(41 * 1440),
      integrationId: stripe?.id ?? null,
      createdAt: ago(223 * 1440),
      updatedAt: ago(41 * 1440),
    },
    {
      id: integrationsUuid('1a06', 2),
      direction: 'INBOUND',
      url: `${WEBHOOK_HOST}/webhooks/mls`,
      description: 'Listing updates from the MLS provider',
      events: ['listing.created', 'listing.updated', 'listing.removed'],
      status: 'ACTIVE',
      maxRetries: 5,
      signingSecretHint: 'whsec_••••3be0',
      secretRotatedAt: ago(70 * 1440),
      integrationId: mls?.id ?? null,
      createdAt: ago(150 * 1440),
      updatedAt: ago(70 * 1440),
    },
    {
      id: integrationsUuid('1a06', 3),
      direction: 'OUTBOUND',
      url: 'https://hooks.example.test/firmivra/billing',
      description: 'Sample finance warehouse',
      events: [
        'subscription.created',
        'subscription.canceled',
        'invoice.paid',
        'invoice.payment_failed',
      ],
      status: 'ACTIVE',
      maxRetries: 5,
      signingSecretHint: 'whsec_••••0f7a',
      secretRotatedAt: ago(30 * 1440),
      integrationId: null,
      createdAt: ago(120 * 1440),
      updatedAt: ago(30 * 1440),
    },
    {
      id: integrationsUuid('1a06', 4),
      direction: 'OUTBOUND',
      url: 'https://ops.example.test/alerts/integrations',
      description: 'Example on-call alerts',
      events: ['integration.error', 'integration.needs_attention', 'integration.disabled'],
      status: 'ACTIVE',
      maxRetries: 3,
      signingSecretHint: 'whsec_••••c41d',
      secretRotatedAt: ago(90 * 1440),
      integrationId: null,
      createdAt: ago(90 * 1440),
      updatedAt: ago(90 * 1440),
    },
  ];

  // Deliveries: nine per endpoint over the last ten days.
  const deliveries: WebhookDelivery[] = [];
  const eventTypes: Record<number, string[]> = {
    1: ['invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated'],
    2: ['listing.updated', 'listing.created', 'listing.removed'],
    3: ['invoice.paid', 'subscription.created', 'invoice.payment_failed', 'subscription.canceled'],
    4: ['integration.error', 'integration.needs_attention', 'integration.disabled'],
  };
  webhooks.forEach((hook, h) => {
    const endpoint = h + 1;
    for (let i = 0; i < 9; i += 1) {
      const n = deliveries.length + 1;
      const types = eventTypes[endpoint] ?? ['event'];
      const eventType = types[i % types.length] ?? 'event';
      const minutes = 20 + i * 26 * 60 + endpoint * 37 + Math.round(wave(n) * 120);
      // The ops endpoint fails lately; one billing delivery failed and was redelivered.
      const failed =
        (endpoint === 4 && i < 4) || (endpoint === 3 && i === 2) || (endpoint === 1 && i === 4);
      const code = failed ? (endpoint === 1 ? 400 : 500) : 200;
      const eventId = `evt_${(n * 48_271).toString(36)}`;
      const created = ago(minutes);
      const delivery: WebhookDelivery = {
        id: integrationsUuid('1a07', n),
        endpointId: hook.id,
        eventType,
        eventId,
        attempt: 1,
        redeliveryOfId: null,
        status: failed ? 'FAILED' : 'SUCCEEDED',
        responseStatusCode: code,
        durationMs: failed ? 1_800 + n * 13 : 120 + Math.round(wave(n + 40) * 400),
        requestId: `req_W${(n * 7919).toString(36).toUpperCase()}`,
        errorCode: failed ? (endpoint === 1 ? 'SIGNATURE_INVALID' : 'HTTP_500') : null,
        retries: failed ? hook.maxRetries : 0,
        requestedBy: null,
        createdAt: created,
        finishedAt: new Date(Date.parse(created) + 2_000).toISOString(),
        payload: JSON.stringify(
          {
            id: eventId,
            type: eventType,
            created: created,
            data:
              endpoint === 2
                ? { listingId: `L-${10_000 + n}`, status: 'active', agentEmail: '[redacted]' }
                : endpoint === 4
                  ? { integration: 'MLS Data Provider', status: 'ERROR', code: 'CONNECTION_FAILED' }
                  : {
                      invoice: `in_••••${(n * 31).toString(36)}`,
                      amountCents: 4_900 + n * 100,
                      customerEmail: '[redacted]',
                    },
          },
          null,
          2,
        ),
        canRedeliver: false,
      };
      deliveries.push(delivery);
      if (endpoint === 3 && i === 2) {
        const retryAt = ago(minutes - 45);
        deliveries.push({
          ...delivery,
          id: integrationsUuid('1a07', deliveries.length + 1),
          attempt: 2,
          redeliveryOfId: delivery.id,
          status: 'SUCCEEDED',
          responseStatusCode: 200,
          durationMs: 260,
          requestId: `req_W${((n + 99) * 7919).toString(36).toUpperCase()}`,
          errorCode: null,
          retries: 0,
          requestedBy: INTEGRATIONS_ADMIN.name,
          createdAt: retryAt,
          finishedAt: retryAt,
        });
      }
    }
  });

  const usage = usageSeries(platform, catalog, apiKeys, now);

  const audit: IntegrationAuditEntry[] = [];
  const addAudit = (
    minutesAgo: number,
    fields: Omit<IntegrationAuditEntry, 'id' | 'at' | 'actor' | 'result' | 'ip'> & {
      by?: { id: string; name: string };
    },
  ) => {
    const { by, ...rest } = fields;
    audit.push({
      id: integrationsUuid('1a08', audit.length + 1),
      at: ago(minutesAgo),
      actor: {
        id: (by ?? INTEGRATIONS_ADMIN).id,
        name: (by ?? INTEGRATIONS_ADMIN).name,
        role: 'Super Admin',
      },
      result: 'SUCCESS',
      ip: INTEGRATIONS_ADMIN_IP,
      ...rest,
    });
  };
  const sendgrid = byProvider('sendgrid');
  const postmark = byProvider('postmark');
  const cloudflare = byProvider('cloudflare');
  const legacy = byProvider('custom_legacy_sms_gateway');
  if (sendgrid)
    addAudit(113, {
      action: 'credentials.rotated',
      label: 'Rotated integration credentials',
      category: 'SECURITY',
      target: { type: 'PLATFORM_INTEGRATION', id: sendgrid.id, name: sendgrid.name },
      changes: [{ field: 'API Key', before: 'set', after: 'changed' }],
    });
  if (cloudflare)
    addAudit(3 * 1440 + 200, {
      action: 'integration.updated',
      label: 'Updated integration',
      category: 'INTEGRATION',
      target: { type: 'PLATFORM_INTEGRATION', id: cloudflare.id, name: cloudflare.name },
      changes: [
        {
          field: 'Scopes',
          before: 'zone:read, dns:edit',
          after: 'zone:read, dns:edit, firewall:edit',
        },
      ],
    });
  if (postmark)
    addAudit(20 * 1440, {
      by: SECOND_ADMIN,
      action: 'integration.disabled',
      label: 'Disabled integration',
      category: 'INTEGRATION',
      target: { type: 'PLATFORM_INTEGRATION', id: postmark.id, name: postmark.name },
      changes: [
        { field: 'Status', before: 'Active', after: 'Disabled' },
        { field: 'Reason', before: null, after: 'Replaced by SendGrid' },
      ],
    });
  if (legacy)
    addAudit(64 * 1440, {
      by: SECOND_ADMIN,
      action: 'integration.removed',
      label: 'Removed integration',
      category: 'INTEGRATION',
      target: { type: 'PLATFORM_INTEGRATION', id: legacy.id, name: legacy.name },
      changes: [
        { field: 'Status', before: 'Disabled', after: 'Removed' },
        { field: 'Credentials', before: 'set', after: 'revoked' },
      ],
    });
  addAudit(40 * 1440, {
    action: 'api_key.rotated',
    label: 'Rotated API key',
    category: 'SECURITY',
    target: { type: 'API_KEY', id: integrationsUuid('1a05', 1), name: 'Sample Partner Portal' },
    changes: [{ field: 'Key', before: 'fv_live_q7Lm…a91X', after: 'fv_live_8k2q…Zt4P' }],
  });
  addAudit(30 * 1440, {
    action: 'webhook.secret_rotated',
    label: 'Rotated webhook signing secret',
    category: 'SECURITY',
    target: {
      type: 'WEBHOOK',
      id: integrationsUuid('1a06', 3),
      name: 'https://hooks.example.test/firmivra/billing',
    },
    changes: [{ field: 'Signing secret', before: 'set', after: 'rotated' }],
  });
  const twilioEntry = catalog.find((item) => item.provider === 'twilio');
  if (twilioEntry)
    addAudit(12 * 1440 + 120, {
      action: 'catalog.firm_access_set',
      label: 'Allowed firm access',
      category: 'INTEGRATION',
      target: { type: 'CATALOG_ITEM', id: twilioEntry.id, name: twilioEntry.name },
      changes: [{ field: FIRM_NAMES[7] ?? 'Firm', before: null, after: 'ALLOW' }],
    });

  return {
    ...base,
    platform,
    runs,
    logs,
    catalog,
    apiKeys,
    webhooks,
    deliveries,
    usage,
    audit,
    outages,
  };
}

// ---------- Usage rollups (90 days) ----------

interface UsageProfile {
  requests: number;
  volume: number | null;
  /** Cents per request, or a share of volume for payments. */
  cost: (requests: number, volume: number) => number | null;
  latency: number;
  successRate: number;
}
const PROFILES: Record<string, UsageProfile> = {
  stripe: {
    requests: 95,
    volume: 162_070,
    cost: (requests, volume) => Math.round(volume * 0.029 + requests * 30),
    latency: 310,
    successRate: 0.996,
  },
  twilio: {
    requests: 1_400,
    volume: 1_250,
    cost: (_requests, volume) => Math.round(volume * 0.79),
    latency: 190,
    successRate: 0.997,
  },
  sendgrid: {
    requests: 3_200,
    volume: 3_000,
    cost: (_requests, volume) => Math.round(volume * 0.1),
    latency: 140,
    successRate: 0.999,
  },
  aws: {
    requests: 52_000,
    volume: 38_000_000_000,
    cost: () => 2_100,
    latency: 45,
    successRate: 0.9995,
  },
  amazon_ses: {
    requests: 120,
    volume: 110,
    cost: (_requests, volume) => Math.round(volume * 0.01),
    latency: 150,
    successRate: 0.998,
  },
  openai: {
    requests: 820,
    volume: 1_600_000,
    cost: (_requests, volume) => Math.round(volume / 840),
    latency: 1_450,
    successRate: 0.993,
  },
  docusign: {
    requests: 260,
    volume: 64,
    cost: () => null,
    latency: 520,
    successRate: 0.998,
  },
  mls_data: {
    requests: 4_800,
    volume: 12_000,
    cost: () => 400,
    latency: 880,
    successRate: 0.995,
  },
  cloudflare: {
    requests: 600,
    volume: 410_000,
    cost: () => null,
    latency: 60,
    successRate: 0.9998,
  },
  google_maps: {
    requests: 1_100,
    volume: 1_100,
    cost: (requests) => Math.round(requests * 0.5),
    latency: 120,
    successRate: 0.999,
  },
  postmark: {
    requests: 300,
    volume: 280,
    cost: (_requests, volume) => Math.round(volume * 0.12),
    latency: 160,
    successRate: 0.998,
  },
};

function usageSeries(
  platform: PlatformIntegration[],
  catalog: CatalogRecord[],
  apiKeys: ApiKeyRecord[],
  now: number,
): UsageRow[] {
  const rows: UsageRow[] = [];
  const empty = {
    avgLatencyMs: null,
    volume: null,
    costCents: null,
    connectedFirms: null,
    activeFirms: null,
    connects: null,
    disconnects: null,
  };
  platform.forEach((integration, p) => {
    const profile = PROFILES[integration.provider];
    if (!profile || !integration.activatedAt) return;
    const start = Date.parse(integration.activatedAt);
    const stop = Date.parse(
      integration.disabledAt ?? integration.removedAt ?? new Date(now).toISOString(),
    );
    const paused = integration.status === 'INACTIVE' ? now - 9 * DAY_MS : stop;
    for (let d = 89; d >= 0; d -= 1) {
      const at = now - d * DAY_MS;
      if (at < start || at > Math.min(stop, paused) + DAY_MS / 2) continue;
      const n = p * 1000 + d;
      const weekday = new Date(at).getUTCDay();
      const weekend = weekday === 0 || weekday === 6 ? 0.55 : 1;
      const requests = Math.round(profile.requests * weekend * (0.85 + wave(n) * 0.3));
      const outage = integration.status === 'ERROR' && d === 0;
      const slow = integration.provider === 'openai' && d <= 1;
      const rate = outage ? 0.2 : slow ? 0.97 : profile.successRate;
      const successes = Math.round(requests * Math.min(1, rate + (wave(n + 7) - 0.5) * 0.004));
      const volume =
        profile.volume === null
          ? null
          : Math.round(profile.volume * weekend * (0.85 + wave(n + 3) * 0.3));
      rows.push({
        day: dayKey(at),
        scope: 'PLATFORM_INTEGRATION',
        subjectKey: integration.id,
        ...empty,
        requests,
        successes,
        failures: requests - successes,
        avgLatencyMs: outage
          ? 30_000
          : slow
            ? 4_200
            : Math.round(profile.latency * (0.9 + wave(n + 5) * 0.2)),
        volume,
        costCents: profile.cost(requests, volume ?? 0),
      });
    }
  });
  catalog.forEach((item, c) => {
    const final = item.connectedFirmIds.length;
    if (!final) return;
    const active = item.activeFirmIds.length;
    let level = Math.max(0, final - 4);
    const created = Date.parse(item.createdAt);
    for (let d = 89; d >= 0; d -= 1) {
      const at = now - d * DAY_MS;
      if (at < created) continue;
      const n = 50_000 + c * 1000 + d;
      // Reach the final count in the last weeks: a few connects, an occasional disconnect.
      const target = d === 0 ? final : Math.min(final, level + (wave(n) > 0.93 ? 1 : 0));
      const disconnects = d > 0 && level > 1 && wave(n + 11) > 0.985 ? 1 : 0;
      const connects = Math.max(0, target - level) + disconnects;
      level = target;
      const firmsActive = Math.min(level, Math.round(active * (0.7 + wave(n + 2) * 0.3)));
      const requests = firmsActive * Math.round(18 + wave(n + 4) * 14);
      const successes = Math.round(requests * (0.985 + wave(n + 6) * 0.014));
      rows.push({
        day: dayKey(at),
        scope: 'CATALOG',
        subjectKey: item.provider,
        ...empty,
        requests,
        successes,
        failures: requests - successes,
        avgLatencyMs: Math.round(200 + wave(n + 8) * 300),
        connectedFirms: level,
        activeFirms: firmsActive,
        connects,
        disconnects,
      });
    }
  });
  apiKeys.forEach((key, k) => {
    const created = Date.parse(key.createdAt);
    const revoked = key.revokedAt ? Date.parse(key.revokedAt) : now + DAY_MS;
    const daily = key.environment === 'LIVE' ? 18_000 : 2_100;
    for (let d = 89; d >= 0; d -= 1) {
      const at = now - d * DAY_MS;
      if (at < created || at > revoked) continue;
      const n = 90_000 + k * 1000 + d;
      const requests = Math.round(daily * (0.8 + wave(n) * 0.4));
      const successes = Math.round(requests * (0.992 + wave(n + 1) * 0.007));
      rows.push({
        day: dayKey(at),
        scope: 'API',
        subjectKey: key.id,
        ...empty,
        requests,
        successes,
        failures: requests - successes,
        avgLatencyMs: Math.round(85 + wave(n + 2) * 60),
      });
    }
  });
  return rows;
}
