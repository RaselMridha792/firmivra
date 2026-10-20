import {
  IntegrationCard,
  IntegrationCategory,
  IntegrationMarketplace,
  IntegrationMarketplaceQuery,
  IntegrationRequestRow,
  IntegrationsOverview,
  type CreateIntegrationRequest,
} from '@firmivra/types';

// Synthetic contract fixtures only: not imported by the screen or used as production fallback.
const catalog: { key: string; name: string; category: IntegrationCategory; summary: string }[] = [
  {
    key: 'quickbooks',
    name: 'QuickBooks Online',
    category: 'ACCOUNTING_FINANCE',
    summary: 'Sync invoices, expenses, customers and more.',
  },
  {
    key: 'microsoft365',
    name: 'Microsoft 365',
    category: 'PRODUCTIVITY',
    summary: 'Sync email, calendar, contacts and files.',
  },
  {
    key: 'stripe',
    name: 'Stripe',
    category: 'PAYMENTS',
    summary: 'Accept online payments and view transactions.',
  },
  {
    key: 'zoom',
    name: 'Zoom',
    category: 'SCHEDULING',
    summary: 'Sync virtual appointments and meeting links.',
  },
  {
    key: 'google_workspace',
    name: 'Google Workspace',
    category: 'PRODUCTIVITY',
    summary: 'Gmail, Drive and Calendar sync.',
  },
  {
    key: 'textmagic',
    name: 'Textmagic',
    category: 'COMMUNICATION',
    summary: 'SMS and client communications.',
  },
  {
    key: 'plaid',
    name: 'Plaid Bank Feeds',
    category: 'ACCOUNTING_FINANCE',
    summary: 'Secure bank account connections.',
  },
  {
    key: 'dropbox_sign',
    name: 'Dropbox Sign',
    category: 'E_SIGNATURE',
    summary: 'Send and sign documents electronically.',
  },
  {
    key: 'tax_software',
    name: 'Tax Preparation Software',
    category: 'TAX_SOFTWARE',
    summary: 'Import and sync tax return data.',
  },
  {
    key: 'payroll',
    name: 'Payroll Providers',
    category: 'PAYROLL_HR',
    summary: 'Sync payroll and employee data.',
  },
  {
    key: 'website_forms',
    name: 'Website & Lead Forms',
    category: 'CRM_LEADS',
    summary: 'Capture and sync leads from your website.',
  },
  {
    key: 'custom_api',
    name: 'API & Webhooks',
    category: 'CUSTOM',
    summary: 'Connect via API or webhook for custom workflows.',
  },
  {
    key: 'xero',
    name: 'Xero',
    category: 'ACCOUNTING_FINANCE',
    summary: 'Online accounting software.',
  },
  {
    key: 'square',
    name: 'Square',
    category: 'PAYMENTS',
    summary: 'Accept in-person and online payments.',
  },
  {
    key: 'shopify',
    name: 'Shopify',
    category: 'ECOMMERCE',
    summary: 'Sync orders and customer data.',
  },
  {
    key: 'hubspot',
    name: 'HubSpot',
    category: 'CRM_LEADS',
    summary: 'Sync contacts and marketing data.',
  },
  {
    key: 'calendly',
    name: 'Calendly',
    category: 'SCHEDULING',
    summary: 'Sync appointments and availability.',
  },
  {
    key: 'mailchimp',
    name: 'Mailchimp',
    category: 'MARKETING',
    summary: 'Email marketing and automations.',
  },
];
const at = '2026-10-18T10:00:00Z';
export const marketplaceConnectionId = '00000000-0000-4000-8000-000000002001';
export function marketplaceFixture(
  input: IntegrationMarketplaceQuery = {},
  empty = false,
): IntegrationMarketplace {
  const query = IntegrationMarketplaceQuery.parse(input);
  const items = empty
    ? []
    : catalog.map((provider, index) =>
        IntegrationCard.parse({
          provider: {
            provider: provider.key,
            name: provider.name,
            category: provider.category,
            summary: provider.summary,
            logo: provider.key,
            featured: index < 4,
            badge: index === 0 ? 'MOST_POPULAR' : index === 1 ? 'RECOMMENDED' : null,
            popularity: 100 - index,
            comingSoon: provider.key === 'payroll',
            multipleConnections: false,
          },
          status: index === 0 ? 'CONNECTED' : 'AVAILABLE',
          action:
            index === 0
              ? 'MANAGE'
              : ['tax_software', 'custom_api'].includes(provider.key)
                ? 'CONFIGURE'
                : 'CONNECT',
          connections:
            index === 0
              ? [
                  {
                    id: marketplaceConnectionId,
                    provider: provider.key,
                    environment: 'LIVE',
                    status: 'CONNECTED',
                    issue: null,
                    statusMessage: null,
                    statusAction: null,
                    accountLabel: 'Synthetic test company',
                    direction: 'TWO_WAY',
                    syncMode: 'AUTO',
                    syncEveryMinutes: 15,
                    connectedAt: at,
                    lastSyncAt: at,
                    nextSyncAt: null,
                  },
                ]
              : [],
        }),
      );
  const filtered = items.filter(
    (item) =>
      (!query.category || query.category === item.provider.category) &&
      (!query.search ||
        `${item.provider.name} ${item.provider.summary}`
          .toLowerCase()
          .includes(query.search.toLowerCase())),
  );
  filtered.sort((a, b) =>
    query.sort === 'name'
      ? a.provider.name.localeCompare(b.provider.name)
      : query.sort === 'category'
        ? a.provider.category.localeCompare(b.provider.category) ||
          a.provider.name.localeCompare(b.provider.name)
        : b.provider.popularity - a.provider.popularity,
  );
  return IntegrationMarketplace.parse({
    categories: IntegrationCategory.options.map((category) => ({
      category,
      count: items.filter((item) => item.provider.category === category).length,
    })),
    featured: filtered.filter((item) => item.provider.featured),
    items: filtered,
    total: filtered.length,
  });
}
export function marketplacePermissions(canManage = true): IntegrationsOverview {
  return IntegrationsOverview.parse({
    summary: {
      connected: 0,
      needsAttention: 0,
      available: 0,
      paused: 0,
      total: 0,
      lastCheckAt: null,
      allOperational: true,
    },
    items: [],
    health: { operational: 0, authorizationIssues: 0, failedSyncs: 0, recordsPending: 0 },
    mapping: [],
    recent: [],
    canManage,
  });
}
export function integrationRequestFixture(body: CreateIntegrationRequest): IntegrationRequestRow {
  return IntegrationRequestRow.parse({
    id: '00000000-0000-4000-8000-000000002002',
    providerName: body.providerName,
    websiteUrl: body.websiteUrl || null,
    category: body.category ?? null,
    connectTo: body.connectTo,
    businessReason: body.businessReason || null,
    status: 'NEW',
    requestedBy: { userId: '00000000-0000-4000-8000-000000000101', name: 'Mock User' },
    statusChangedAt: null,
    createdAt: at,
  });
}
