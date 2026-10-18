import type {
  IntegrationAuthMethod,
  IntegrationCategory,
  IntegrationEntity,
  IntegrationMappingScope,
  IntegrationOptionField,
  IntegrationPermission,
  IntegrationProvider,
} from '@firmivra/types';

// The integration catalog (the registry the developer guide's section 8 asks for): what each
// provider is, how it signs in, what it can sync and which options its setup shows. It lives in
// code, so a firm's connection (`integration_connections.provider`) is a lower-case key checked
// against this list, and a new provider is data here, not a new screen. `comingSoon` marks a
// provider whose adapter is not built: it is listed, but a connect answers 409 COMING_SOON (the
// provider's API access and credentials are a commercial step, per the guide).

type Direction = 'IMPORT' | 'EXPORT' | 'TWO_WAY';
const ALL: Direction[] = ['IMPORT', 'EXPORT', 'TWO_WAY'];
const FREQUENCIES = [15, 30, 60, 240, 1_440];

const entity = (
  key: string,
  label: string,
  description: string,
  directions: Direction[] = ALL,
  defaultEnabled = true,
): IntegrationEntity => ({ key, label, description, directions, defaultEnabled });

const permission = (
  key: string,
  label: string,
  entityKey: string | null = null,
  required = true,
): IntegrationPermission => ({ key, label, entity: entityKey, required });

const toggle = (
  key: string,
  label: string,
  defaultValue: boolean,
  help: string | null = null,
): IntegrationOptionField => ({
  key,
  label,
  help,
  type: 'TOGGLE',
  choices: [],
  defaultValue,
  afterConnect: false,
});
const select = (
  key: string,
  label: string,
  choices: [string, string][],
  defaultValue: string | null,
  afterConnect = false,
): IntegrationOptionField => ({
  key,
  label,
  help: null,
  type: 'SELECT',
  choices: choices.map(([value, text]) => ({ value, label: text })),
  defaultValue,
  afterConnect,
});
const multi = (
  key: string,
  label: string,
  choices: [string, string][],
  defaultValue: string[],
): IntegrationOptionField => ({
  key,
  label,
  help: null,
  type: 'MULTI_SELECT',
  choices: choices.map(([value, text]) => ({ value, label: text })),
  defaultValue,
  afterConnect: false,
});

const scope = (
  key: string,
  label: string,
  local: [string, string][],
  external: [string, string][],
): IntegrationMappingScope => ({
  scope: key,
  label,
  localFields: local.map(([k, l]) => ({ key: k, label: l })),
  externalFields: external.map(([k, l]) => ({ key: k, label: l })),
});

interface Def {
  provider: string;
  name: string;
  category: IntegrationCategory;
  summary: string;
  description: string;
  popularity: number;
  featured?: boolean;
  badge?: 'MOST_POPULAR' | 'RECOMMENDED';
  authMethod?: IntegrationAuthMethod;
  environments?: ('LIVE' | 'TEST')[];
  directions?: Direction[];
  frequencies?: number[];
  entities?: IntegrationEntity[];
  permissions?: IntegrationPermission[];
  options?: IntegrationOptionField[];
  credentialFields?: { key: string; label: string; help: string | null }[];
  mappingScopes?: IntegrationMappingScope[];
  multipleConnections?: boolean;
  /** Live: its adapter exists (no outside account needed). */
  live?: boolean;
  learnMoreUrl?: string | null;
}

const build = (d: Def): IntegrationProvider => ({
  provider: d.provider,
  name: d.name,
  category: d.category,
  summary: d.summary,
  description: d.description,
  logo: d.provider,
  featured: d.featured ?? false,
  badge: d.badge ?? null,
  popularity: d.popularity,
  authMethod: d.authMethod ?? 'OAUTH2',
  environments: d.environments ?? ['LIVE'],
  directions: d.directions ?? ALL,
  frequencies: d.frequencies ?? FREQUENCIES,
  entities: d.entities ?? [],
  permissions: d.permissions ?? [],
  options: d.options ?? [],
  credentialFields: d.credentialFields ?? [],
  mappingScopes: d.mappingScopes ?? [],
  multipleConnections: d.multipleConnections ?? false,
  comingSoon: !(d.live ?? false),
  learnMoreUrl: d.learnMoreUrl ?? null,
});

const clientFields: [string, string][] = [
  ['client.name', 'Client Name'],
  ['client.email', 'Email'],
  ['client.phone', 'Phone'],
];

export const PROVIDERS: readonly IntegrationProvider[] = [
  build({
    provider: 'quickbooks',
    name: 'QuickBooks Online',
    category: 'ACCOUNTING_FINANCE',
    summary: 'Accounting, expenses and invoices',
    description:
      'Sync your QuickBooks Online data with Firmivra to automate bookkeeping, import transactions, sync invoices and payments, and keep your financial data up to date.',
    popularity: 100,
    featured: true,
    badge: 'MOST_POPULAR',
    environments: ['LIVE', 'TEST'],
    entities: [
      entity('invoices', 'Invoices', 'Customers, invoices, payments'),
      entity('expenses', 'Expenses', 'Bills and expenses'),
      entity('customers', 'Customers', 'Client and contact information'),
      entity('vendors', 'Vendors', 'Vendor information'),
      entity('accounts', 'Chart of Accounts', 'Account lists and mapping'),
      entity('products', 'Products & Services', 'Items and services'),
      entity('payments', 'Payments', 'Payment records'),
      entity('employees', 'Employees (if applicable)', 'Employee information', ['IMPORT'], false),
    ],
    permissions: [
      permission('accounting.read', 'Read your accounting data'),
      permission('accounting.write', 'Create and update invoices and customers', 'invoices', false),
    ],
    mappingScopes: [
      scope('client', 'Client fields', clientFields, [
        ['DisplayName', 'Customer Name'],
        ['PrimaryEmailAddr', 'Email'],
        ['PrimaryPhone', 'Phone'],
      ]),
      scope(
        'invoice',
        'Invoice fields',
        [
          ['invoice.number', 'Invoice Number'],
          ['invoice.date', 'Invoice Date'],
          ['invoice.total', 'Amount'],
          ['invoice.status', 'Payment Status'],
        ],
        [
          ['DocNumber', 'Invoice Number'],
          ['TxnDate', 'Invoice Date'],
          ['TotalAmt', 'Total Amount'],
          ['Balance', 'Payment Status'],
        ],
      ),
    ],
  }),
  build({
    provider: 'microsoft365',
    name: 'Microsoft 365',
    category: 'PRODUCTIVITY',
    summary: 'Outlook email and calendar',
    description:
      'Connect your Microsoft 365 account to sync email, calendar, contacts and files with Firmivra.',
    popularity: 95,
    featured: true,
    badge: 'RECOMMENDED',
    entities: [
      entity('email', 'Email (Outlook)', 'Sync emails and link them to client records'),
      entity('calendar', 'Calendar', 'Sync appointments and events'),
      entity('contacts', 'Contacts', 'Sync contact information'),
      entity(
        'files',
        'Files (OneDrive / SharePoint)',
        'Access and attach files to client records',
        ['IMPORT', 'TWO_WAY'],
      ),
    ],
    permissions: [
      permission('mail.readwrite', 'Read and manage your email', 'email'),
      permission('calendars.readwrite', 'Read and write calendar events', 'calendar'),
      permission('contacts.read', 'Read contacts', 'contacts'),
      permission('files.readwrite', 'Read and manage files (OneDrive/SharePoint)', 'files'),
      permission('user.read', 'Sign you in and read your profile'),
    ],
    options: [
      select('mailbox', 'Mailbox / Account', [], null, true),
      select('defaultCalendar', 'Default Calendar', [['primary', 'Calendar (Primary)']], 'primary'),
      toggle(
        'createAppointments',
        'Create appointments in Firmivra from new calendar events',
        true,
      ),
      toggle(
        'attachClientEmails',
        'Automatically attach client emails to records (when the email contains client info)',
        true,
      ),
      multi(
        'folders',
        'Folders',
        [
          ['inbox', 'Inbox'],
          ['sent', 'Sent Items'],
          ['drafts', 'Drafts'],
          ['important', 'Important'],
          ['other', 'Other Mail'],
        ],
        ['inbox', 'sent'],
      ),
    ],
  }),
  build({
    provider: 'google_workspace',
    name: 'Google Workspace',
    category: 'PRODUCTIVITY',
    summary: 'Gmail, Drive and Calendar',
    description: 'Sync Gmail, Google Calendar, contacts and Drive files with Firmivra.',
    popularity: 90,
    entities: [
      entity('email', 'Gmail', 'Sync emails and link them to client records'),
      entity('calendar', 'Calendar', 'Sync appointments and events'),
      entity('contacts', 'Contacts', 'Sync contact information'),
      entity('files', 'Drive', 'Access and attach files to client records', ['IMPORT', 'TWO_WAY']),
    ],
    permissions: [
      permission('gmail.modify', 'Read and manage your email', 'email'),
      permission('calendar.events', 'Read and write calendar events', 'calendar'),
    ],
  }),
  build({
    provider: 'stripe',
    name: 'Stripe',
    category: 'PAYMENTS',
    summary: 'Online payments and transactions',
    description:
      'Accept online payments and view transactions. Firm payments are set up under Invoices & Payments.',
    popularity: 85,
    featured: true,
    environments: ['LIVE', 'TEST'],
    entities: [entity('payments', 'Payments', 'Payment records and status', ['IMPORT'])],
    directions: ['IMPORT'],
  }),
  build({
    provider: 'plaid',
    name: 'Plaid Bank Feeds',
    category: 'ACCOUNTING_FINANCE',
    summary: 'Secure bookkeeping feeds',
    description: 'Securely connect bank accounts so transactions flow into bookkeeping.',
    popularity: 80,
    authMethod: 'PROVIDER_LINK',
    environments: ['LIVE', 'TEST'],
    directions: ['IMPORT'],
    entities: [entity('transactions', 'Transactions', 'Bank and card transactions', ['IMPORT'])],
    multipleConnections: true,
  }),
  build({
    provider: 'dropbox_sign',
    name: 'Dropbox Sign',
    category: 'E_SIGNATURE',
    summary: 'Electronic signatures',
    description: 'Send documents for signature and receive the signed copies back.',
    popularity: 70,
    entities: [entity('signatures', 'Signature requests', 'Requests and signed documents')],
  }),
  build({
    provider: 'zoom',
    name: 'Zoom',
    category: 'SCHEDULING',
    summary: 'Virtual appointments',
    description: 'Create meeting links for virtual appointments automatically.',
    popularity: 88,
    featured: true,
    directions: ['EXPORT'],
    entities: [entity('meetings', 'Meetings', 'Meeting links for appointments', ['EXPORT'])],
    permissions: [permission('meeting.write', 'Create meetings for your appointments')],
  }),
  build({
    provider: 'textmagic',
    name: 'Textmagic',
    category: 'COMMUNICATION',
    summary: 'SMS and client communications',
    description: 'Send and receive text messages with clients.',
    popularity: 75,
    authMethod: 'API_KEY',
    directions: ['EXPORT', 'TWO_WAY'],
    entities: [
      entity('sms', 'Text messages', 'Outbound and inbound messages', ['EXPORT', 'TWO_WAY']),
    ],
    credentialFields: [
      { key: 'username', label: 'Textmagic username', help: null },
      {
        key: 'apiKey',
        label: 'API key',
        help: 'Create one in your Textmagic account. It is stored encrypted and never shown again.',
      },
    ],
  }),
  build({
    provider: 'website_forms',
    name: 'Website & Lead Forms',
    category: 'MARKETING',
    summary: 'Intake and consultation leads',
    description: 'Capture leads and intake submissions from your website forms.',
    popularity: 78,
    authMethod: 'NONE',
    directions: ['IMPORT'],
    entities: [entity('leads', 'Leads', 'Lead and intake submissions', ['IMPORT'])],
    live: true,
  }),
  build({
    provider: 'custom_api',
    name: 'API & Webhooks',
    category: 'CUSTOM',
    summary: 'Custom connections',
    description:
      'Connect a system Firmivra does not support yet with your own endpoint, events and a signing secret.',
    popularity: 60,
    authMethod: 'NONE',
    directions: ['EXPORT', 'IMPORT'],
    entities: [entity('events', 'Events', 'Events sent to your endpoint', ['EXPORT'])],
    multipleConnections: false,
    live: true,
  }),
  build({
    provider: 'tax_software',
    name: 'Tax Preparation Software',
    category: 'TAX_SOFTWARE',
    summary: 'Tax return workflow',
    description: 'Import and export client and tax-return workflow data with your tax software.',
    popularity: 65,
    authMethod: 'API_KEY',
    entities: [entity('returns', 'Returns', 'Return status and client data')],
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API key',
        help: 'Issued by your tax software. It is stored encrypted and never shown again.',
      },
    ],
  }),
  build({
    provider: 'payroll_providers',
    name: 'Payroll Providers',
    category: 'PAYROLL_HR',
    summary: 'Payroll and reporting',
    description: 'Sync payroll, employee and reporting data from your payroll provider.',
    popularity: 64,
    directions: ['IMPORT'],
    entities: [entity('payroll', 'Payroll runs', 'Runs and reports', ['IMPORT'])],
    multipleConnections: true,
  }),
  build({
    provider: 'square',
    name: 'Square',
    category: 'PAYMENTS',
    summary: 'In-person and online payments',
    description: 'Accept in-person and online payments and sync transaction records.',
    popularity: 62,
    directions: ['IMPORT'],
    entities: [entity('payments', 'Payments', 'Payment records', ['IMPORT'])],
  }),
  build({
    provider: 'xero',
    name: 'Xero',
    category: 'ACCOUNTING_FINANCE',
    summary: 'Online accounting software',
    description: 'An alternative accounting and bookkeeping connection.',
    popularity: 72,
    entities: [
      entity('invoices', 'Invoices', 'Invoices and payments'),
      entity('contacts', 'Contacts', 'Customers and suppliers'),
    ],
  }),
  build({
    provider: 'calendly',
    name: 'Calendly',
    category: 'SCHEDULING',
    summary: 'Appointments and availability',
    description: 'Sync appointment scheduling and availability.',
    popularity: 58,
    directions: ['IMPORT'],
    entities: [entity('events', 'Scheduled events', 'Booked appointments', ['IMPORT'])],
  }),
  build({
    provider: 'hubspot',
    name: 'HubSpot',
    category: 'CRM_LEADS',
    summary: 'CRM and marketing data',
    description: 'Sync contacts and marketing activity.',
    popularity: 56,
    entities: [entity('contacts', 'Contacts', 'Contacts and companies')],
  }),
  build({
    provider: 'mailchimp',
    name: 'Mailchimp',
    category: 'MARKETING',
    summary: 'Email marketing and automations',
    description: 'Sync email marketing lists, audiences and campaign automation.',
    popularity: 55,
    directions: ['EXPORT'],
    entities: [entity('audiences', 'Audiences', 'Lists and audiences', ['EXPORT'])],
  }),
  build({
    provider: 'shopify',
    name: 'Shopify',
    category: 'ECOMMERCE',
    summary: 'Orders and customer data',
    description: 'Bring commerce and order data into bookkeeping workflows.',
    popularity: 50,
    directions: ['IMPORT'],
    entities: [entity('orders', 'Orders', 'Orders and customers', ['IMPORT'])],
  }),
];

const BY_KEY = new Map(PROVIDERS.map((p) => [p.provider, p]));
export const providerOf = (key: string): IntegrationProvider | undefined => BY_KEY.get(key);

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  ACCOUNTING_FINANCE: 'Accounting & Finance',
  PAYMENTS: 'Payments',
  COMMUNICATION: 'Communication',
  PRODUCTIVITY: 'Productivity',
  SCHEDULING: 'Scheduling',
  DOCUMENT_MANAGEMENT: 'Document Management',
  CRM_LEADS: 'CRM & Lead Generation',
  E_SIGNATURE: 'E-Signature',
  TAX_SOFTWARE: 'Tax Software',
  PAYROLL_HR: 'Payroll & HR',
  MARKETING: 'Marketing',
  ECOMMERCE: 'E-Commerce',
  CUSTOM: 'Custom Integrations',
};

/** The events a custom webhook can be sent (a small first list; the screen reads it from the API). */
export const CUSTOM_EVENTS: readonly { key: string; label: string; module: string }[] = [
  { key: 'client.created', label: 'Client created', module: 'Clients' },
  { key: 'client.updated', label: 'Client updated', module: 'Clients' },
  { key: 'lead.created', label: 'Lead created', module: 'Leads' },
  { key: 'appointment.scheduled', label: 'Appointment scheduled', module: 'Appointments' },
  { key: 'invoice.paid', label: 'Invoice paid', module: 'Invoices & Payments' },
  { key: 'document.uploaded', label: 'Document uploaded', module: 'Documents' },
  { key: 'task.completed', label: 'Task completed', module: 'Tasks' },
];
