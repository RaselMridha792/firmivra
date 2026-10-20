import { IntegrationConnectionDetail } from '@firmivra/types';

export const SYNC_SETTINGS_ID = '11111111-1111-4111-8111-111111111111';

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

export function syncSettingsFixture(empty = false) {
  return IntegrationConnectionDetail.parse({
    id: SYNC_SETTINGS_ID,
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
      mappingScopes: [],
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
