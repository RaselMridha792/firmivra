import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  ActivateAdminPlatformRequest,
  AdminCatalogItem,
  AdminCatalogItemId,
  AdminCatalogPreview,
  AdminConfirmAccessLoss,
  AdminConnectionTestResult,
  AdminFirmOption,
  AdminIntegrationAccess,
  AdminIntegrationId,
  AdminIntegrationSummary,
  AdminPlanOption,
  AdminPlatformIntegrationDetail,
  AdminPlatformRun,
  AdminProviderTemplate,
  AdminUsageRangeQuery,
  CreateAdminCatalogRequest,
  CreateAdminPlatformRequest,
  DisableAdminPlatformRequest,
  ListAdminCatalogQuery,
  ListAdminCatalogResponse,
  ListAdminFirmOptionsQuery,
  ListAdminPlatformQuery,
  ListAdminPlatformResponse,
  ListAdminPlatformRunsQuery,
  ListAdminPlatformRunsResponse,
  PutAdminCatalogFirmRequest,
  PutAdminCredentialsRequest,
  RemoveAdminPlatformRequest,
  UpdateAdminCatalogRequest,
  UpdateAdminPlatformRequest,
} from './schemas.js';
import {
  AdminApiKey,
  AdminApiKeyId,
  AdminExportJob,
  AdminIntegrationLogId,
  AdminIssuedApiKey,
  AdminLogFacets,
  AdminLogRecord,
  AdminUsageQuery,
  AdminUsageReport,
  AdminWebhookDelivery,
  AdminWebhookDeliveryId,
  AdminWebhookEndpoint,
  AdminWebhookId,
  AdminWebhookWithSecret,
  CreateAdminApiKeyRequest,
  CreateAdminWebhookRequest,
  ExportAdminLogsRequest,
  ListAdminApiKeysQuery,
  ListAdminIntegrationAuditQuery,
  ListAdminIntegrationAuditResponse,
  ListAdminIntegrationLogsQuery,
  ListAdminIntegrationLogsResponse,
  ListAdminWebhookDeliveriesQuery,
  ListAdminWebhookDeliveriesResponse,
  ListAdminWebhooksQuery,
  RevokeAdminApiKeyRequest,
  UpdateAdminWebhookRequest,
} from './operations.js';

const BASE = '/admin/integrations';
const platform = (id: string) => `${BASE}/platform/${parseInput(AdminIntegrationId, id)}`;
const catalog = (id: string) => `${BASE}/catalog/${parseInput(AdminCatalogItemId, id)}`;
const apiKey = (id: string) => `${BASE}/api-keys/${parseInput(AdminApiKeyId, id)}`;
const webhook = (id: string) => `${BASE}/webhooks/${parseInput(AdminWebhookId, id)}`;
const Uuid = z.uuid();

/**
 * `api.adminIntegrations` (apps/web/src/lib/api.ts). Part 1: the Integrations dashboard, platform
 * integrations and the customer catalog. Part 2: API keys, webhooks and deliveries, the
 * integration log and its export, usage, and the module's audit trail. The method names are the screens' (Tumit's mock). 401
 * without the Super Admin site's session, 403 for anyone else; credentials, activation, disable,
 * enable and remove are a SUPER_ADMIN's (403 FORBIDDEN otherwise). Errors:
 * `errorMessage(error, ADMIN_INTEGRATION_ERRORS)`.
 */
export function createAdminIntegrationsClient(request: ApiRequest) {
  const post = <T extends z.ZodType>(schema: T, path: string, body: unknown = {}) =>
    request(schema, path, { method: 'POST', body });
  return {
    /** What the signed-in admin may do here. */
    access: async (): Promise<AdminIntegrationAccess> =>
      request(AdminIntegrationAccess, `${BASE}/access`),
    /** The dashboard's cards. */
    summary: async (): Promise<AdminIntegrationSummary> =>
      request(AdminIntegrationSummary, `${BASE}/summary`),
    /** The provider definitions the wizard offers (kept in code by the API). */
    providers: async (): Promise<AdminProviderTemplate[]> =>
      request(z.array(AdminProviderTemplate), `${BASE}/providers`),
    plans: async (): Promise<AdminPlanOption[]> =>
      request(z.array(AdminPlanOption), `${BASE}/plans`),
    /** The firm picker of a catalog entry's firm rules (at most 20). */
    firmOptions: async (search?: string): Promise<AdminFirmOption[]> =>
      request(
        z.array(AdminFirmOption),
        `${BASE}/firm-options${toQuery(parseInput(ListAdminFirmOptionsQuery, search ? { search } : {}))}`,
      ),

    // ----- Platform integrations -----
    listPlatform: async (query: ListAdminPlatformQuery = {}): Promise<ListAdminPlatformResponse> =>
      request(
        ListAdminPlatformResponse,
        `${BASE}/platform${toQuery(parseInput(ListAdminPlatformQuery, query))}`,
      ),
    getPlatform: async (id: string): Promise<AdminPlatformIntegrationDetail> =>
      request(AdminPlatformIntegrationDetail, platform(id)),
    /** A DRAFT. 409 DUPLICATE_CONNECTION. */
    createPlatform: async (
      body: CreateAdminPlatformRequest,
    ): Promise<AdminPlatformIntegrationDetail> =>
      post(
        AdminPlatformIntegrationDetail,
        `${BASE}/platform`,
        parseInput(CreateAdminPlatformRequest, body),
      ),
    /** 409 CONFLICT, DUPLICATE_CONNECTION, CONFIRMATION_REQUIRED or INVALID_STATE (removed). */
    updatePlatform: async (
      id: string,
      body: UpdateAdminPlatformRequest,
    ): Promise<AdminPlatformIntegrationDetail> =>
      request(AdminPlatformIntegrationDetail, platform(id), {
        method: 'PATCH',
        body: parseInput(UpdateAdminPlatformRequest, body),
      }),
    /** Super Admin. Values go to the secret store; only masked hints come back. */
    putCredentials: async (
      id: string,
      body: PutAdminCredentialsRequest,
    ): Promise<AdminPlatformIntegrationDetail> =>
      request(AdminPlatformIntegrationDetail, `${platform(id)}/credentials`, {
        method: 'PUT',
        body: parseInput(PutAdminCredentialsRequest, body),
      }),
    /** A connection test, recorded as a run and a log entry. 409 CREDENTIALS_REQUIRED. */
    testPlatform: async (id: string): Promise<AdminConnectionTestResult> =>
      post(AdminConnectionTestResult, `${platform(id)}/test`),
    /** OAuth providers (Super Admin): the account link again. */
    reconnectPlatform: async (id: string): Promise<AdminConnectionTestResult> =>
      post(AdminConnectionTestResult, `${platform(id)}/reconnect`),
    /** Super Admin. 409 TEST_REQUIRED or INVALID_STATE. */
    activatePlatform: async (
      id: string,
      body: ActivateAdminPlatformRequest = {},
    ): Promise<AdminPlatformIntegrationDetail> =>
      post(
        AdminPlatformIntegrationDetail,
        `${platform(id)}/activate`,
        parseInput(ActivateAdminPlatformRequest, body),
      ),
    /** Super Admin. 409 INVALID_STATE. */
    disablePlatform: async (
      id: string,
      body: DisableAdminPlatformRequest = {},
    ): Promise<AdminPlatformIntegrationDetail> =>
      post(
        AdminPlatformIntegrationDetail,
        `${platform(id)}/disable`,
        parseInput(DisableAdminPlatformRequest, body),
      ),
    /** Super Admin: an explicit re-enable, never automatic. */
    enablePlatform: async (id: string): Promise<AdminPlatformIntegrationDetail> =>
      post(AdminPlatformIntegrationDetail, `${platform(id)}/enable`),
    /** Super Admin; final. A critical one needs its name typed (409 CONFIRMATION_REQUIRED). */
    removePlatform: async (
      id: string,
      body: RemoveAdminPlatformRequest = {},
    ): Promise<AdminPlatformIntegrationDetail> =>
      post(
        AdminPlatformIntegrationDetail,
        `${platform(id)}/remove`,
        parseInput(RemoveAdminPlatformRequest, body),
      ),
    /** Queues a sync now (the worker runs it). 409 INVALID_STATE unless active. */
    syncPlatform: async (id: string): Promise<AdminPlatformRun> =>
      post(AdminPlatformRun, `${platform(id)}/sync`),
    platformRuns: async (
      id: string,
      query: ListAdminPlatformRunsQuery = {},
    ): Promise<ListAdminPlatformRunsResponse> =>
      request(
        ListAdminPlatformRunsResponse,
        `${platform(id)}/runs${toQuery(parseInput(ListAdminPlatformRunsQuery, query))}`,
      ),

    // ----- Catalog -----
    listCatalog: async (query: ListAdminCatalogQuery = {}): Promise<ListAdminCatalogResponse> =>
      request(
        ListAdminCatalogResponse,
        `${BASE}/catalog${toQuery(parseInput(ListAdminCatalogQuery, query))}`,
      ),
    getCatalog: async (id: string): Promise<AdminCatalogItem> =>
      request(AdminCatalogItem, catalog(id)),
    /** Starts DISABLED, on all plans. 409 DUPLICATE_PROVIDER. */
    createCatalog: async (body: CreateAdminCatalogRequest): Promise<AdminCatalogItem> =>
      post(AdminCatalogItem, `${BASE}/catalog`, parseInput(CreateAdminCatalogRequest, body)),
    /** 409 CONFLICT or ACCESS_LOSS (resend with `confirmAccessLoss`). */
    updateCatalog: async (id: string, body: UpdateAdminCatalogRequest): Promise<AdminCatalogItem> =>
      request(AdminCatalogItem, catalog(id), {
        method: 'PATCH',
        body: parseInput(UpdateAdminCatalogRequest, body),
      }),
    putCatalogPlan: async (id: string, planId: string): Promise<AdminCatalogItem> =>
      request(AdminCatalogItem, `${catalog(id)}/plans/${parseInput(Uuid, planId)}`, {
        method: 'PUT',
        body: {},
      }),
    /** 409 ACCESS_LOSS when connected firms lose it. */
    deleteCatalogPlan: async (
      id: string,
      planId: string,
      body: AdminConfirmAccessLoss = {},
    ): Promise<AdminCatalogItem> =>
      request(AdminCatalogItem, `${catalog(id)}/plans/${parseInput(Uuid, planId)}`, {
        method: 'DELETE',
        body: parseInput(AdminConfirmAccessLoss, body),
      }),
    putCatalogFirm: async (
      id: string,
      businessId: string,
      body: PutAdminCatalogFirmRequest,
    ): Promise<AdminCatalogItem> =>
      request(AdminCatalogItem, `${catalog(id)}/firms/${parseInput(Uuid, businessId)}`, {
        method: 'PUT',
        body: parseInput(PutAdminCatalogFirmRequest, body),
      }),
    /** Back to the plan default. */
    deleteCatalogFirm: async (
      id: string,
      businessId: string,
      body: AdminConfirmAccessLoss = {},
    ): Promise<AdminCatalogItem> =>
      request(AdminCatalogItem, `${catalog(id)}/firms/${parseInput(Uuid, businessId)}`, {
        method: 'DELETE',
        body: parseInput(AdminConfirmAccessLoss, body),
      }),
    previewCatalog: async (id: string): Promise<AdminCatalogPreview> =>
      request(AdminCatalogPreview, `${catalog(id)}/preview`),

    // ----- API keys (issuing, rotating and revoking are a SUPER_ADMIN's) -----
    /** Metadata only (prefix and last four), newest first. */
    listApiKeys: async (query: ListAdminApiKeysQuery = {}): Promise<AdminApiKey[]> =>
      request(
        z.array(AdminApiKey),
        `${BASE}/api-keys${toQuery(parseInput(ListAdminApiKeysQuery, query))}`,
      ),
    /** The full key comes back once, here; only its hash is kept. */
    createApiKey: async (body: CreateAdminApiKeyRequest): Promise<AdminIssuedApiKey> =>
      post(AdminIssuedApiKey, `${BASE}/api-keys`, parseInput(CreateAdminApiKeyRequest, body)),
    /** A new key naming the old one, which is revoked. 409 INVALID_STATE unless active. */
    rotateApiKey: async (id: string): Promise<AdminIssuedApiKey> =>
      post(AdminIssuedApiKey, `${apiKey(id)}/rotate`),
    /** Once. 409 INVALID_STATE when already revoked. */
    revokeApiKey: async (id: string, body: RevokeAdminApiKeyRequest = {}): Promise<AdminApiKey> =>
      post(AdminApiKey, `${apiKey(id)}/revoke`, parseInput(RevokeAdminApiKeyRequest, body)),

    // ----- Webhooks -----
    listWebhooks: async (query: ListAdminWebhooksQuery = {}): Promise<AdminWebhookEndpoint[]> =>
      request(
        z.array(AdminWebhookEndpoint),
        `${BASE}/webhooks${toQuery(parseInput(ListAdminWebhooksQuery, query))}`,
      ),
    /** Super Admin. The signing secret comes back once, here. */
    createWebhook: async (body: CreateAdminWebhookRequest): Promise<AdminWebhookWithSecret> =>
      post(AdminWebhookWithSecret, `${BASE}/webhooks`, parseInput(CreateAdminWebhookRequest, body)),
    /** `rotateSecret` (Super Admin) returns the new signing secret once. */
    updateWebhook: async (
      id: string,
      body: UpdateAdminWebhookRequest,
    ): Promise<AdminWebhookWithSecret> =>
      request(AdminWebhookWithSecret, webhook(id), {
        method: 'PATCH',
        body: parseInput(UpdateAdminWebhookRequest, body),
      }),
    webhookDeliveries: async (
      id: string,
      query: ListAdminWebhookDeliveriesQuery = {},
    ): Promise<ListAdminWebhookDeliveriesResponse> =>
      request(
        ListAdminWebhookDeliveriesResponse,
        `${webhook(id)}/deliveries${toQuery(parseInput(ListAdminWebhookDeliveriesQuery, query))}`,
      ),
    /** After the team's confirmation: a later attempt of the same event (PENDING until sent). */
    redeliver: async (deliveryId: string): Promise<AdminWebhookDelivery> =>
      post(
        AdminWebhookDelivery,
        `${BASE}/deliveries/${parseInput(AdminWebhookDeliveryId, deliveryId)}/redeliver`,
      ),

    // ----- The integration log -----
    listLogs: async (
      query: ListAdminIntegrationLogsQuery = {},
    ): Promise<ListAdminIntegrationLogsResponse> =>
      request(
        ListAdminIntegrationLogsResponse,
        `${BASE}/logs${toQuery(parseInput(ListAdminIntegrationLogsQuery, query))}`,
      ),
    /** The filter choices, from the log itself. */
    logFacets: async (): Promise<AdminLogFacets> => request(AdminLogFacets, `${BASE}/logs/facets`),
    getLog: async (id: string): Promise<AdminLogRecord> =>
      request(AdminLogRecord, `${BASE}/logs/${parseInput(AdminIntegrationLogId, id)}`),
    /** 202: a queued B1 export job; the export worker makes the file. */
    exportLogs: async (body: ExportAdminLogsRequest = {}): Promise<AdminExportJob> =>
      post(AdminExportJob, `${BASE}/logs/export`, parseInput(ExportAdminLogsRequest, body)),
    /** My recent integration log exports, newest first. */
    logExports: async (): Promise<AdminExportJob[]> =>
      request(z.array(AdminExportJob), `${BASE}/logs/exports`),

    // ----- Usage (the daily rollup) -----
    usage: async (query: AdminUsageQuery = {}): Promise<AdminUsageReport> =>
      request(AdminUsageReport, `${BASE}/usage${toQuery(parseInput(AdminUsageQuery, query))}`),
    /** One platform integration's usage in its own units. */
    platformUsage: async (
      id: string,
      query: AdminUsageRangeQuery = {},
    ): Promise<AdminUsageReport> =>
      request(
        AdminUsageReport,
        `${platform(id)}/usage${toQuery(parseInput(AdminUsageRangeQuery, query))}`,
      ),

    // ----- The module's audit trail -----
    /** Newest first; `targetId` narrows it to one record. */
    auditTrail: async (
      query: ListAdminIntegrationAuditQuery = {},
    ): Promise<ListAdminIntegrationAuditResponse> =>
      request(
        ListAdminIntegrationAuditResponse,
        `${BASE}/audit${toQuery(parseInput(ListAdminIntegrationAuditQuery, query))}`,
      ),
  };
}

export type AdminIntegrationsClient = ReturnType<typeof createAdminIntegrationsClient>;
