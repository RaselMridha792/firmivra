import { IntegrationConnectionDetail } from '@firmivra/types';

export const MANAGE_INTEGRATION_ID = '11111111-1111-4111-8111-111111111111';

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

export function integrationManageFixture(empty = false) {
  return IntegrationConnectionDetail.parse({
    id: MANAGE_INTEGRATION_ID,
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
      entities: entities.map(([key, label, description]) => ({
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
    recentRuns: empty
      ? []
      : [
          [
            '33333333-3333-4333-8333-333333333331',
            'invoices',
            'Invoices',
            'SUCCEEDED',
            42,
            0,
            minutesFromNow(-8),
          ],
          [
            '33333333-3333-4333-8333-333333333332',
            'payments',
            'Payments',
            'SUCCEEDED',
            18,
            0,
            minutesFromNow(-20),
          ],
          [
            '33333333-3333-4333-8333-333333333333',
            'expenses',
            'Expenses',
            'SUCCEEDED',
            36,
            0,
            minutesFromNow(-77),
          ],
          [
            '33333333-3333-4333-8333-333333333334',
            'vendors',
            'Vendors',
            'FAILED',
            2,
            2,
            minutesFromNow(-109),
          ],
          [
            '33333333-3333-4333-8333-333333333335',
            'customers',
            'Customers',
            'SUCCEEDED',
            28,
            0,
            minutesFromNow(-279),
          ],
        ].map(([id, entity, entityLabel, status, recordCount, failedCount, at]) => ({
          id,
          entity,
          entityLabel,
          status,
          manual: false,
          requestedBy: null,
          recordCount,
          failedCount,
          errorCode: status === 'FAILED' ? 'SYNC_FAILED' : null,
          errorMessage: status === 'FAILED' ? 'Provider rejected two records.' : null,
          startedAt: at,
          finishedAt: at,
          createdAt: at,
        })),
    mappingPreview: empty
      ? []
      : [
          ['client', 'client_name', 'Client Name', 'customer_name', 'Customer Name'],
          ['invoice', 'invoice_number', 'Invoice Number', 'doc_number', 'Invoice Number'],
          ['invoice', 'invoice_date', 'Invoice Date', 'txn_date', 'Invoice Date'],
          ['invoice', 'amount', 'Amount', 'total_amount', 'Total Amount'],
          ['payment', 'status', 'Payment Status', 'payment_status', 'Payment Status'],
          ['expense', 'category', 'Expense Category', 'account_name', 'Expense Category'],
          ['account', 'chart', 'Chart of Accounts', 'account', 'Chart of Accounts'],
        ].map(([scope, localField, localLabel, externalField, externalLabel]) => ({
          scope,
          localField,
          localLabel,
          externalField,
          externalLabel,
          direction: 'TWO_WAY',
        })),
    canManage: true,
  });
}
