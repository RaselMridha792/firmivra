import { IntegrationConnectionDetail, IntegrationMappings } from '@firmivra/types';

export const DATA_MAPPING_ID = '11111111-1111-4111-8111-111111111111';

// Synthetic field catalogs for browser interception only, never production fallback data.
export function mappingFieldsFixture(empty = false) {
  const groups = [
    {
      scope: 'client',
      label: 'Clients',
      fields: [
        ['client_name', 'Client Name', 'customer_name', 'Customer Name'],
        ['email', 'Email Address', 'email_address', 'Email Address'],
      ],
    },
    {
      scope: 'invoice',
      label: 'Invoices',
      fields: [
        ['invoice_number', 'Invoice Number', 'doc_number', 'Invoice Number'],
        ['invoice_date', 'Invoice Date', 'txn_date', 'Invoice Date'],
        ['amount', 'Amount', 'total_amount', 'Total Amount'],
      ],
    },
    {
      scope: 'payment',
      label: 'Payments',
      fields: [['status', 'Payment Status', 'payment_status', 'Payment Status']],
    },
    {
      scope: 'expense',
      label: 'Expenses',
      fields: [['category', 'Expense Category', 'account_name', 'Expense Category']],
    },
    {
      scope: 'account',
      label: 'Chart of Accounts',
      fields: [['chart', 'Chart of Accounts', 'account', 'Chart of Accounts']],
    },
  ];
  return IntegrationMappings.parse({
    scopes: empty
      ? []
      : groups.map(({ scope, label, fields }) => ({
          scope,
          label,
          localFields: fields.map(([key, label]) => ({ key, label })),
          externalFields: fields.map(([, , key, label]) => ({ key, label })),
          pairs: fields
            .filter(([key]) => key !== 'email')
            .map(([localField, localLabel, externalField, externalLabel]) => ({
              scope,
              localField,
              localLabel,
              externalField,
              externalLabel,
              direction: 'TWO_WAY',
            })),
        })),
  });
}

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

const entities = [
  ['invoices', 'Invoices', 'Customers, invoices and payments'],
  ['expenses', 'Expenses', 'Bills and expenses'],
  ['customers', 'Customers', 'Client and contact information'],
  ['vendors', 'Vendors', 'Vendor information'],
  ['chart_of_accounts', 'Chart of Accounts', 'Account lists and mapping'],
  ['products_services', 'Products & Services', 'Items and services'],
  ['payments', 'Payments', 'Payment records'],
  ['employees', 'Employees (if applicable)', 'Employee information'],
] as const;

export function mappingConnectionFixture(empty = false) {
  return IntegrationConnectionDetail.parse({
    id: DATA_MAPPING_ID,
    provider: {
      provider: 'quickbooks',
      name: 'QuickBooks Online',
      category: 'ACCOUNTING_FINANCE',
      summary: 'Accounting, expenses and invoices',
      description:
        'Sync your QuickBooks Online data with LVP Pro to automate bookkeeping, import transactions, sync invoices and payments, and keep your financial data up to date.',
      logo: 'quickbooks',
      featured: true,
      badge: 'MOST_POPULAR',
      popularity: 100,
      authMethod: 'OAUTH2',
      environments: ['LIVE', 'TEST'],
      directions: ['IMPORT', 'EXPORT', 'TWO_WAY'],
      frequencies: [15, 30, 60, 360, 1440],
      entities: (empty ? [] : entities).map(([key, label, description]) => ({
        key,
        label,
        description,
        defaultEnabled: true,
        directions: ['IMPORT', 'EXPORT', 'TWO_WAY'],
      })),
      permissions: [],
      options: [],
      credentialFields: [],
      mappingScopes: mappingFieldsFixture(empty).scopes.map(
        ({ scope, label, localFields, externalFields }) => ({
          scope,
          label,
          localFields,
          externalFields,
        }),
      ),
      multipleConnections: false,
      comingSoon: false,
      learnMoreUrl: 'https://quickbooks.intuit.com/',
    },
    environment: 'LIVE',
    status: 'CONNECTED',
    issue: null,
    statusMessage: null,
    statusAction: null,
    accountLabel: 'LVP Accounting & Taxes LLC',
    direction: 'TWO_WAY',
    syncMode: 'AUTO',
    syncEveryMinutes: 60,
    connectedAt: '2026-03-12T10:24:00.000-04:00',
    lastSyncAt: minutesFromNow(-8),
    nextSyncAt: minutesFromNow(52),
    accountIdMasked: '•••• 3456',
    connectionType: 'OAuth 2.0 (Secure)',
    connectedBy: { userId: '22222222-2222-4222-8222-222222222222', name: 'Synthetic Owner' },
    entities: empty ? [] : entities.map(([key]) => key),
    options: {},
    syncing: false,
    paused: false,
    health: {
      ok: true,
      summary: 'Connection is active and working properly.',
      checks: empty
        ? []
        : [
            { key: 'AUTHENTICATION', label: 'Authentication valid', ok: true, message: null },
            { key: 'API', label: 'API connection healthy', ok: true, message: null },
            { key: 'DATA_SYNC', label: 'Data syncing as expected', ok: true, message: null },
            { key: 'RECENT_ERRORS', label: 'No recent errors', ok: true, message: null },
            { key: 'PERMISSIONS', label: 'Permissions granted', ok: true, message: null },
          ],
      suggestions: [],
      checkedAt: minutesFromNow(-1),
    },
    recentRuns: [],
    mappingPreview: [],
    canManage: true,
  });
}
