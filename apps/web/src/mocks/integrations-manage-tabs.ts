import {
  CustomIntegrationConfig,
  CustomIntegrationEventList,
  IntegrationConnectionDetail,
  IntegrationConnectionHealth,
  IntegrationHistoryPage,
  IntegrationMappings,
  IntegrationPermissionList,
  IntegrationSyncRunDetail,
  type IntegrationSyncRun,
  type IntegrationSyncRunStatus,
} from '@firmivra/types';
import { integrationManageFixture, MANAGE_INTEGRATION_ID } from './integrations-manage';

// Synthetic fixtures for the Manage Integration tabs' browser tests (R56, on Ibrahim's Overview
// fixture): Sync Settings, Data Mapping, Permissions, Sync History, Troubleshooting and the Custom
// API & Webhooks setup. Served through Playwright request interception; never production data.

export const CUSTOM_INTEGRATION_ID = '55555555-5555-4555-8555-555555555555';
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

/** The QuickBooks connection with its provider's options, permissions and mapping scopes. */
export function manageTabsConnection(state: 'data' | 'attention' = 'data') {
  const base = integrationManageFixture();
  return IntegrationConnectionDetail.parse({
    ...base,
    ...(state === 'attention'
      ? {
          status: 'NEEDS_ATTENTION',
          issue: 'PERMISSION_MISSING',
          statusMessage: 'A permission is missing for Payments. Reconnect to grant it.',
          statusAction: 'FIX_PERMISSIONS',
        }
      : {}),
    provider: {
      ...base.provider,
      directions: ['IMPORT', 'EXPORT', 'TWO_WAY'],
      entities: base.provider.entities.map((entity) =>
        entity.key === 'chart_of_accounts' ? { ...entity, directions: ['IMPORT'] } : entity,
      ),
      options: [
        {
          key: 'create_missing_clients',
          label: 'Create clients that do not exist yet',
          help: 'New QuickBooks customers become LVP Pro clients.',
          type: 'TOGGLE',
          choices: [],
          defaultValue: true,
          afterConnect: false,
        },
        {
          key: 'income_account',
          label: 'Default income account',
          help: null,
          type: 'SELECT',
          choices: [
            { value: 'services', label: 'Services income' },
            { value: 'sales', label: 'Sales income' },
          ],
          defaultValue: 'services',
          afterConnect: true,
        },
        {
          key: 'classes',
          label: 'Track by class',
          help: 'Classes read from the connected company.',
          type: 'MULTI_SELECT',
          choices: [
            { value: 'tax', label: 'Tax' },
            { value: 'bookkeeping', label: 'Bookkeeping' },
            { value: 'advisory', label: 'Advisory' },
          ],
          defaultValue: [],
          afterConnect: true,
        },
      ],
      permissions: [
        { key: 'profile', label: 'Read the company profile', entity: null, required: true },
        { key: 'invoices', label: 'Read and write invoices', entity: 'invoices', required: true },
        { key: 'payments', label: 'Read and write payments', entity: 'payments', required: true },
        { key: 'expenses', label: 'Read expenses and bills', entity: 'expenses', required: false },
      ],
    },
    // Chart of Accounts (import only) starts off, so turning it on limits the direction.
    entities: base.entities.filter((key) => key !== 'employees' && key !== 'chart_of_accounts'),
    options: { create_missing_clients: true, income_account: 'services', classes: ['tax'] },
  });
}

const SCOPES = [
  {
    scope: 'client',
    label: 'Client fields',
    localFields: [
      ['client_name', 'Client Name'],
      ['email', 'Email'],
      ['phone', 'Phone'],
      ['billing_address', 'Billing Address'],
    ],
    externalFields: [
      ['customer_name', 'Customer Name'],
      ['primary_email', 'Primary Email'],
      ['primary_phone', 'Primary Phone'],
      ['bill_addr', 'Billing Address'],
      ['display_name', 'Display Name'],
    ],
    pairs: [
      ['client_name', 'customer_name'],
      ['email', 'primary_email'],
      ['phone', 'primary_phone'],
    ],
  },
  {
    scope: 'invoice',
    label: 'Invoice fields',
    localFields: [
      ['invoice_number', 'Invoice Number'],
      ['invoice_date', 'Invoice Date'],
      ['amount', 'Amount'],
      ['due_date', 'Due Date'],
    ],
    externalFields: [
      ['doc_number', 'Invoice Number'],
      ['txn_date', 'Invoice Date'],
      ['total_amount', 'Total Amount'],
      ['due_date', 'Due Date'],
    ],
    pairs: [
      ['invoice_number', 'doc_number'],
      ['invoice_date', 'txn_date'],
      ['amount', 'total_amount'],
    ],
  },
] as const;

export function mappingsFixture(empty = false) {
  const field = ([key, label]: readonly [string, string]) => ({ key, label });
  return IntegrationMappings.parse({
    scopes: SCOPES.map((s) => ({
      scope: s.scope,
      label: s.label,
      localFields: s.localFields.map(field),
      externalFields: s.externalFields.map(field),
      pairs: empty
        ? []
        : s.pairs.map(([local, external]) => ({
            scope: s.scope,
            localField: local,
            localLabel: s.localFields.find(([key]) => key === local)?.[1] ?? local,
            externalField: external,
            externalLabel: s.externalFields.find(([key]) => key === external)?.[1] ?? external,
            direction: 'TWO_WAY',
          })),
    })),
  });
}

export function permissionsFixture(state: 'data' | 'attention' | 'empty' = 'data') {
  const items = manageTabsConnection().provider.permissions.map((p) => ({
    ...p,
    granted: !(state === 'attention' && p.key === 'payments'),
  }));
  return IntegrationPermissionList.parse({
    items: state === 'empty' ? [] : items,
    needsReconnect: state === 'attention',
  });
}

const RUNS: [string, string, IntegrationSyncRunStatus, number, number, boolean][] = [
  ['invoices', 'Invoices', 'SUCCEEDED', 42, 0, false],
  ['payments', 'Payments', 'SUCCEEDED', 18, 0, true],
  ['vendors', 'Vendors', 'FAILED', 2, 2, false],
  ['test', 'Connection test', 'SUCCEEDED', 0, 0, true],
  ['expenses', 'Expenses', 'PARTIAL', 36, 3, false],
  ['customers', 'Customers', 'SUCCEEDED', 28, 0, false],
];

/** 30 runs, newest first: six kinds repeated five times, two hours apart. */
export function historyRuns(): IntegrationSyncRun[] {
  return Array.from({ length: 30 }, (_, i) => {
    const [entity, entityLabel, status, recordCount, failedCount, manual] = RUNS[i % RUNS.length]!;
    const when = at(-30 - i * 120);
    return {
      id: `66666666-6666-4666-8666-${String(i + 1).padStart(12, '0')}`,
      entity,
      entityLabel,
      status,
      manual,
      requestedBy: manual
        ? { userId: '22222222-2222-4222-8222-222222222222', name: 'Synthetic Owner' }
        : null,
      recordCount,
      failedCount,
      errorCode: status === 'FAILED' || status === 'PARTIAL' ? 'SYNC_FAILED' : null,
      errorMessage:
        status === 'FAILED'
          ? 'The provider rejected two vendor records.'
          : status === 'PARTIAL'
            ? 'Three expenses had no matching category.'
            : null,
      startedAt: when,
      finishedAt: at(-29 - i * 120),
      createdAt: when,
    };
  });
}

export function historyFixture(params: URLSearchParams, empty = false) {
  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? '25');
  const status = params.get('status');
  const entity = params.get('entity');
  const manual = params.get('manual');
  const rows = (empty ? [] : historyRuns()).filter(
    (run) =>
      (!status || run.status === status) &&
      (!entity || run.entity === entity) &&
      (manual === null || String(run.manual) === manual),
  );
  return IntegrationHistoryPage.parse({
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
  });
}

export function runFixture(runId: string) {
  const run = historyRuns().find((r) => r.id === runId) ?? historyRuns()[0]!;
  return IntegrationSyncRunDetail.parse({
    ...run,
    guidance:
      run.status === 'SUCCEEDED'
        ? []
        : [
            'Open the records in QuickBooks Online and check that each has a name.',
            'Run the sync again after fixing them; records already synced are not duplicated.',
          ],
  });
}

export function healthFixture(state: 'data' | 'attention' | 'empty' = 'data') {
  if (state === 'empty')
    return IntegrationConnectionHealth.parse({
      ok: true,
      summary: 'No checks have run yet.',
      checks: [],
      suggestions: [],
      checkedAt: null,
    });
  const failing = state === 'attention';
  return IntegrationConnectionHealth.parse({
    ok: !failing,
    summary: failing
      ? 'A permission is missing and one sync failed.'
      : 'Connection is active and working properly.',
    checks: [
      { key: 'AUTHENTICATION', label: 'Authentication valid', ok: true, message: null },
      { key: 'API', label: 'API connection healthy', ok: true, message: null },
      {
        key: 'DATA_SYNC',
        label: failing ? 'A recent sync failed' : 'Data syncing as expected',
        ok: !failing,
        message: failing ? 'Vendors failed 2 hours ago.' : null,
      },
      { key: 'RECENT_ERRORS', label: 'No recent errors', ok: true, message: null },
      {
        key: 'PERMISSIONS',
        label: failing ? 'Payments permission missing' : 'Permissions granted',
        ok: !failing,
        message: failing ? 'Reconnect to grant access to payments.' : null,
      },
    ],
    suggestions: failing
      ? ['Reconnect to grant the missing permission.', 'Open Sync History to see the failed run.']
      : [],
    checkedAt: at(-1),
  });
}

/** A `custom_api` connection and its setup (no secret: only the last four characters). */
export function customConnectionFixture() {
  const base = integrationManageFixture();
  return IntegrationConnectionDetail.parse({
    ...base,
    id: CUSTOM_INTEGRATION_ID,
    provider: {
      ...base.provider,
      provider: 'custom_api',
      name: 'API & Webhooks',
      category: 'CUSTOM',
      summary: 'Custom connections',
      description: 'Send LVP Pro events to your own systems over a signed https webhook.',
      logo: 'custom_api',
      badge: null,
      authMethod: 'NONE',
      entities: [],
      frequencies: [],
      learnMoreUrl: null,
    },
    accountLabel: null,
    accountIdMasked: null,
    connectionType: 'Custom webhook',
    direction: 'EXPORT',
    syncMode: 'MANUAL',
    syncEveryMinutes: null,
    nextSyncAt: null,
    entities: [],
    recentRuns: [],
    mappingPreview: [],
  });
}

export function customConfigFixture() {
  return CustomIntegrationConfig.parse({
    connectionId: CUSTOM_INTEGRATION_ID,
    enabled: true,
    name: 'Practice data warehouse',
    documentationUrl: 'https://docs.example.test/webhooks',
    authMethod: 'HMAC_SIGNATURE',
    endpointUrl: 'https://hooks.example.test/lvp',
    events: ['client.created', 'invoice.paid'],
    secretLast4: '9f2c',
    secretRotatedAt: at(-60 * 24 * 3),
    inboundUrl: `https://app.example.test/api/v1/integrations/inbound/${CUSTOM_INTEGRATION_ID}`,
  });
}

export function customEventsFixture() {
  return CustomIntegrationEventList.parse({
    items: [
      { key: 'client.created', label: 'Client created', module: 'Clients' },
      { key: 'client.updated', label: 'Client updated', module: 'Clients' },
      { key: 'invoice.paid', label: 'Invoice paid', module: 'Invoices' },
      { key: 'appointment.booked', label: 'Appointment booked', module: 'Appointments' },
    ],
  });
}

export { MANAGE_INTEGRATION_ID };
