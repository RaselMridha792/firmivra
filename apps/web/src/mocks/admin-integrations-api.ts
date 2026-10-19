import type {
  AdminApiKey,
  AdminExportJob,
  AdminIntegrationsClient,
  AdminIssuedApiKey,
  AdminUsageReport,
  AdminWebhookEndpoint,
  AdminWebhookWithSecret,
} from '@firmivra/types';
import {
  adminIntegrations as mock,
  INTEGRATION_STATUSES,
  type IntegrationStatus,
  type LogQuery,
} from './admin-integrations';

/**
 * `api.adminIntegrations` in mock mode: the contract (packages/types/src/admin-integrations) over
 * Tumit's mock store (admin-integrations.ts). The adapter reads the contract's text flags and
 * comma-separated statuses, turns the log export into a B1 export job, and leaves out what B8
 * keeps nothing for (a key's peak and limited calls, alerts, the plan distribution, a delivery's
 * payload, a webhook's integration), so the screens see what the API returns.
 */

type Client = AdminIntegrationsClient;
/** A mock result as the contract's type (the mock's types are its own copies of the same shapes). */
const contract = <K extends keyof Client>(value: unknown) =>
  value as Awaited<ReturnType<Client[K]>>;
/** The paging fields are coerced by the contract, so their input type is `unknown`. */
const num = (value: unknown) => (value === undefined ? undefined : Number(value));
const flag = (value: string | undefined) => (value === undefined ? undefined : value === 'true');
const statusesOf = (value: string | undefined): IntegrationStatus[] | undefined =>
  value
    ?.split(',')
    .map((part) => INTEGRATION_STATUSES.find((status) => status === part))
    .filter((status): status is IntegrationStatus => status !== undefined);

function keyOf<T extends AdminApiKey>(key: T): T {
  return { ...key, usage24h: { ...key.usage24h, peakPerMinute: null, rateLimited: null } };
}
const issuedOf = (issued: AdminIssuedApiKey): AdminIssuedApiKey => ({
  ...issued,
  key: keyOf(issued.key),
});
const endpointOf = (endpoint: AdminWebhookEndpoint): AdminWebhookEndpoint => ({
  ...endpoint,
  integration: null,
});
const withSecretOf = (result: AdminWebhookWithSecret): AdminWebhookWithSecret => ({
  ...result,
  endpoint: endpointOf(result.endpoint),
});
const reportOf = (report: AdminUsageReport): AdminUsageReport => ({
  ...report,
  planDistribution: [],
  alerts: [],
});

export function createAdminIntegrationsMock(): AdminIntegrationsClient {
  // The mock's shapes are the contract's (the contract followed Tumit's names); the overrides
  // below are where the two differ.
  const base = mock as unknown as AdminIntegrationsClient;
  const exports: AdminExportJob[] = [];
  return {
    ...base,
    listPlatform: async (query = {}) =>
      contract<'listPlatform'>(
        await mock.listPlatform({
          ...query,
          page: num(query.page),
          pageSize: num(query.pageSize),
          status: statusesOf(query.status),
          includeRemoved: flag(query.includeRemoved),
          descending: flag(query.descending),
        }),
      ),
    listCatalog: async (query = {}) =>
      contract<'listCatalog'>(
        await mock.listCatalog({
          ...query,
          page: num(query.page),
          pageSize: num(query.pageSize),
          descending: flag(query.descending),
        }),
      ),

    listApiKeys: async (query = {}) => (await base.listApiKeys(query)).map(keyOf),
    createApiKey: async (body) => issuedOf(await base.createApiKey(body)),
    rotateApiKey: async (id) => issuedOf(await base.rotateApiKey(id)),
    revokeApiKey: async (id, body) => keyOf(await base.revokeApiKey(id, body)),

    listWebhooks: async (query = {}) => (await base.listWebhooks(query)).map(endpointOf),
    createWebhook: async (body) => withSecretOf(await base.createWebhook(body)),
    updateWebhook: async (id, body) => withSecretOf(await base.updateWebhook(id, body)),
    webhookDeliveries: async (id, query = {}) => {
      const page = await base.webhookDeliveries(id, query);
      return { ...page, items: page.items.map((item) => ({ ...item, payload: null })) };
    },
    redeliver: async (deliveryId) => ({ ...(await base.redeliver(deliveryId)), payload: null }),

    listLogs: async (query = {}) =>
      contract<'listLogs'>(
        await mock.listLogs({
          ...query,
          page: num(query.page),
          pageSize: num(query.pageSize),
          platformOnly: flag(query.platformOnly),
          descending: flag(query.descending),
        }),
      ),
    exportLogs: async (body = {}) => {
      const query: LogQuery = { ...body.query };
      const file = await mock.exportLogs({ query, format: 'CSV' });
      const now = new Date().toISOString();
      const job: AdminExportJob = {
        id: file.jobId,
        title: 'Integration logs',
        format: 'CSV',
        status: 'COMPLETED',
        rowCount: file.rowCount,
        errorCode: null,
        createdAt: now,
        finishedAt: now,
        expiresAt: file.expiresAt,
      };
      exports.unshift(job);
      return job;
    },
    logExports: async () => {
      await mock.access();
      return [...exports];
    },

    usage: async (query = {}) => reportOf(await base.usage(query)),
    platformUsage: async (id, query = {}) => reportOf(await base.platformUsage(id, query)),
  };
}
