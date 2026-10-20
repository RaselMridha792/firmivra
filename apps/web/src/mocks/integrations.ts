import {
  IntegrationCard,
  IntegrationsOverview,
  IntegrationsQuery,
  type IntegrationCategory,
} from '@firmivra/types';

// Synthetic fixtures for the Integrations List's browser tests; never production fallback data.
const providers: { code: string; name: string; category: IntegrationCategory; summary: string }[] =
  [
    {
      code: 'quickbooks',
      name: 'QuickBooks Online',
      category: 'ACCOUNTING_FINANCE',
      summary: 'Accounting, expenses and invoices',
    },
    {
      code: 'stripe',
      name: 'Stripe',
      category: 'PAYMENTS',
      summary: 'Online payments and transactions',
    },
    {
      code: 'microsoft365',
      name: 'Microsoft 365',
      category: 'PRODUCTIVITY',
      summary: 'Outlook email and calendar',
    },
    {
      code: 'textmagic',
      name: 'Textmagic',
      category: 'COMMUNICATION',
      summary: 'SMS and client communications',
    },
    {
      code: 'google_workspace',
      name: 'Google Workspace',
      category: 'PRODUCTIVITY',
      summary: 'Gmail, Drive and Calendar',
    },
    { code: 'zoom', name: 'Zoom', category: 'SCHEDULING', summary: 'Virtual appointments' },
    {
      code: 'plaid',
      name: 'Plaid Bank Feeds',
      category: 'ACCOUNTING_FINANCE',
      summary: 'Secure bookkeeping feeds',
    },
    {
      code: 'dropbox_sign',
      name: 'Dropbox Sign',
      category: 'E_SIGNATURE',
      summary: 'Electronic signatures',
    },
    {
      code: 'tax_software',
      name: 'Tax Preparation Software',
      category: 'TAX_SOFTWARE',
      summary: 'Tax return workflow',
    },
    {
      code: 'payroll',
      name: 'Payroll Providers',
      category: 'PAYROLL_HR',
      summary: 'Payroll and reporting',
    },
    {
      code: 'website_forms',
      name: 'Website & Lead Forms',
      category: 'CRM_LEADS',
      summary: 'Intake and consultation leads',
    },
    {
      code: 'custom_api',
      name: 'API & Webhooks',
      category: 'CUSTOM',
      summary: 'Custom connections',
    },
  ];
const at = '2026-10-18T09:42:00Z';
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export function integrationOverviewFixture(
  input: IntegrationsQuery = {},
  empty = false,
): IntegrationsOverview {
  const query = IntegrationsQuery.parse(input);
  const cards = providers.map((provider, index) =>
    IntegrationCard.parse({
      provider: {
        provider: provider.code,
        name: provider.name,
        category: provider.category,
        summary: provider.summary,
        logo: provider.code,
        featured: index < 4,
        badge: null,
        popularity: 100 - index,
        comingSoon: false,
        multipleConnections: false,
      },
      status: index < 3 ? 'CONNECTED' : index === 3 ? 'NEEDS_ATTENTION' : 'AVAILABLE',
      action:
        index < 3
          ? 'MANAGE'
          : index === 3
            ? 'RECONNECT'
            : ['tax_software', 'payroll', 'custom_api'].includes(provider.code)
              ? 'CONFIGURE'
              : 'CONNECT',
      connections:
        index < 4
          ? [
              {
                id: id(index + 1),
                provider: provider.code,
                environment: query.environment,
                status: index === 3 ? 'NEEDS_ATTENTION' : 'CONNECTED',
                issue: index === 3 ? 'AUTHORIZATION_EXPIRED' : null,
                statusMessage: index === 3 ? 'Authorization expired' : null,
                statusAction: index === 3 ? 'RECONNECT' : null,
                accountLabel: 'Synthetic test account',
                direction: index < 2 ? 'TWO_WAY' : 'IMPORT',
                syncMode: index === 3 ? 'MANUAL' : 'AUTO',
                syncEveryMinutes: index === 3 ? null : 15,
                connectedAt: at,
                lastSyncAt: at,
                nextSyncAt: null,
              },
            ]
          : [],
    }),
  );
  const scoped = empty
    ? []
    : cards.filter((card) => !query.category || card.provider.category === query.category);
  const connected = scoped.filter((card) => card.status === 'CONNECTED').length;
  const attention = scoped.filter((card) => card.status === 'NEEDS_ATTENTION').length;
  return IntegrationsOverview.parse({
    summary: {
      connected,
      needsAttention: attention,
      available: scoped.filter((card) => card.status === 'AVAILABLE').length,
      paused: 0,
      total: scoped.length,
      lastCheckAt: empty ? null : at,
      allOperational: attention === 0,
    },
    items: scoped.filter(
      (card) =>
        (query.tab === 'all' ||
          (query.tab === 'connected'
            ? card.status === 'CONNECTED'
            : query.tab === 'attention'
              ? card.status === 'NEEDS_ATTENTION'
              : card.status === 'AVAILABLE')) &&
        (!query.search ||
          `${card.provider.name} ${card.provider.summary}`
            .toLowerCase()
            .includes(query.search.toLowerCase())),
    ),
    health: {
      operational: connected,
      authorizationIssues: attention,
      failedSyncs: 0,
      recordsPending: empty ? 0 : 3,
    },
    mapping: empty
      ? []
      : [
          { scope: 'clients', label: 'Client fields', mappedFields: 12 },
          { scope: 'leads', label: 'Lead fields', mappedFields: 8 },
          { scope: 'services', label: 'Service interest', mappedFields: 6 },
        ],
    recent: empty
      ? []
      : [
          {
            id: id(100),
            provider: 'quickbooks',
            providerName: 'QuickBooks Online',
            kind: 'SYNC',
            ok: true,
            message: 'QuickBooks Online sync completed',
            at,
          },
          {
            id: id(101),
            provider: 'textmagic',
            providerName: 'Textmagic',
            kind: 'ERROR',
            ok: false,
            message: 'Textmagic authorization expired',
            at,
          },
        ],
    canManage: true,
  });
}
