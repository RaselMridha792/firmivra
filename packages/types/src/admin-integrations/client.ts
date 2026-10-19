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

const BASE = '/admin/integrations';
const platform = (id: string) => `${BASE}/platform/${parseInput(AdminIntegrationId, id)}`;
const catalog = (id: string) => `${BASE}/catalog/${parseInput(AdminCatalogItemId, id)}`;
const Uuid = z.uuid();

/**
 * `api.adminIntegrations` (apps/web/src/lib/api.ts), part 1: the Integrations dashboard, platform
 * integrations and the customer catalog. The method names are the screens' (Tumit's mock). 401
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
  };
}

export type AdminIntegrationsClient = ReturnType<typeof createAdminIntegrationsClient>;
