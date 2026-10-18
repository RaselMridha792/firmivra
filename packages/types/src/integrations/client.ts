import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  ConnectIntegrationRequest,
  ConnectIntegrationResult,
  CreateIntegrationRequest,
  CustomIntegrationConfig,
  CustomIntegrationEventList,
  CustomIntegrationTestResult,
  DisconnectIntegrationRequest,
  IntegrationActivityPage,
  IntegrationActivityQuery,
  IntegrationConnectionDetail,
  IntegrationConnectionHealth,
  IntegrationConnectionId,
  IntegrationConnectionSummary,
  IntegrationHistoryPage,
  IntegrationHistoryQuery,
  IntegrationMappings,
  IntegrationMarketplace,
  IntegrationMarketplaceQuery,
  IntegrationPermissionList,
  IntegrationProviderDetail,
  IntegrationProviderKey,
  IntegrationRequestList,
  IntegrationRequestRow,
  IntegrationsOverview,
  IntegrationsQuery,
  IntegrationSyncRun,
  IntegrationSyncRunDetail,
  IntegrationSyncRunId,
  IntegrationTestResult,
  ReconnectIntegrationRequest,
  RotateCustomSecretRequest,
  SaveCustomIntegrationRequest,
  SaveIntegrationMappingsRequest,
  SyncIntegrationRequest,
  UpdateIntegrationSettingsRequest,
} from './schemas.js';

const BASE = '/business/integrations';
const provider = (key: string) => `${BASE}/providers/${parseInput(IntegrationProviderKey, key)}`;
const connection = (id: string) => `${BASE}/connections/${parseInput(IntegrationConnectionId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.integrations` (apps/web/src/lib/api.ts): the Integrations module (contract in
 * ./schemas.ts). Everyone with the permission grid's INTEGRATIONS view reads; connecting,
 * configuring, syncing and disconnecting need Create, Edit or Manage (403 FORBIDDEN). Providers
 * are codes from the API catalog (`overview()` and `marketplace()` list them; no screen
 * hard-codes one). Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before
 * anything is sent. No business id is ever sent, and no secret ever comes back. Starting an OAuth
 * connection answers `{ mode: 'REDIRECT', url }`: send the browser to `url`.
 */
export function createIntegrationsClient(request: ApiRequest) {
  return {
    // ----- Main page and marketplace -----
    overview: async (query: IntegrationsQuery = {}): Promise<IntegrationsOverview> =>
      request(IntegrationsOverview, `${BASE}${toQuery(parseInput(IntegrationsQuery, query))}`),
    activity: async (query: IntegrationActivityQuery = {}): Promise<IntegrationActivityPage> =>
      request(
        IntegrationActivityPage,
        `${BASE}/activity${toQuery(parseInput(IntegrationActivityQuery, query))}`,
      ),
    marketplace: async (query: IntegrationMarketplaceQuery = {}): Promise<IntegrationMarketplace> =>
      request(
        IntegrationMarketplace,
        `${BASE}/marketplace${toQuery(parseInput(IntegrationMarketplaceQuery, query))}`,
      ),

    // ----- Connect and configure -----
    provider: async (key: string): Promise<IntegrationProviderDetail> =>
      request(IntegrationProviderDetail, provider(key)),
    /** 409 ALREADY_CONNECTED, NOT_SUPPORTED, COMING_SOON; 400 CREDENTIALS_REJECTED. */
    connect: async (
      key: string,
      body: ConnectIntegrationRequest = {},
    ): Promise<ConnectIntegrationResult> =>
      request(
        ConnectIntegrationResult,
        `${provider(key)}/connect`,
        post(parseInput(ConnectIntegrationRequest, body)),
      ),

    // ----- Manage a connection -----
    connection: async (id: string): Promise<IntegrationConnectionDetail> =>
      request(IntegrationConnectionDetail, connection(id)),
    updateSettings: async (
      id: string,
      body: UpdateIntegrationSettingsRequest,
    ): Promise<IntegrationConnectionDetail> =>
      request(IntegrationConnectionDetail, `${connection(id)}/settings`, {
        method: 'PATCH',
        body: parseInput(UpdateIntegrationSettingsRequest, body),
      }),
    /** Sync Now. 409 SYNC_IN_PROGRESS, NOT_CONNECTED. */
    sync: async (id: string, body: SyncIntegrationRequest = {}): Promise<IntegrationSyncRun> =>
      request(
        IntegrationSyncRun,
        `${connection(id)}/sync`,
        post(parseInput(SyncIntegrationRequest, body)),
      ),
    pause: async (id: string): Promise<IntegrationConnectionSummary> =>
      request(IntegrationConnectionSummary, `${connection(id)}/pause`, post()),
    resume: async (id: string): Promise<IntegrationConnectionSummary> =>
      request(IntegrationConnectionSummary, `${connection(id)}/resume`, post()),
    /** Run Connection Test. */
    test: async (id: string): Promise<IntegrationTestResult> =>
      request(IntegrationTestResult, `${connection(id)}/test`, post()),
    health: async (id: string): Promise<IntegrationConnectionHealth> =>
      request(IntegrationConnectionHealth, `${connection(id)}/health`),
    /** Reconnect / Fix: as `connect`, for this connection. */
    reconnect: async (
      id: string,
      body: ReconnectIntegrationRequest = {},
    ): Promise<ConnectIntegrationResult> =>
      request(
        ConnectIntegrationResult,
        `${connection(id)}/reconnect`,
        post(parseInput(ReconnectIntegrationRequest, body)),
      ),
    /** Imported records stay; history is kept. */
    disconnect: async (
      id: string,
      body: DisconnectIntegrationRequest,
    ): Promise<IntegrationConnectionSummary> =>
      request(
        IntegrationConnectionSummary,
        `${connection(id)}/disconnect`,
        post(parseInput(DisconnectIntegrationRequest, body)),
      ),
    history: async (
      id: string,
      query: IntegrationHistoryQuery = {},
    ): Promise<IntegrationHistoryPage> =>
      request(
        IntegrationHistoryPage,
        `${connection(id)}/history${toQuery(parseInput(IntegrationHistoryQuery, query))}`,
      ),
    run: async (id: string, runId: string): Promise<IntegrationSyncRunDetail> =>
      request(
        IntegrationSyncRunDetail,
        `${connection(id)}/history/${parseInput(IntegrationSyncRunId, runId)}`,
      ),
    mappings: async (id: string): Promise<IntegrationMappings> =>
      request(IntegrationMappings, `${connection(id)}/mappings`),
    saveMappings: async (
      id: string,
      body: SaveIntegrationMappingsRequest,
    ): Promise<IntegrationMappings> =>
      request(IntegrationMappings, `${connection(id)}/mappings`, {
        method: 'PUT',
        body: parseInput(SaveIntegrationMappingsRequest, body),
      }),
    permissions: async (id: string): Promise<IntegrationPermissionList> =>
      request(IntegrationPermissionList, `${connection(id)}/permissions`),

    // ----- Custom API & Webhooks (the `custom_api` provider) -----
    customEvents: async (): Promise<CustomIntegrationEventList['items']> =>
      (await request(CustomIntegrationEventList, `${BASE}/custom-events`)).items,
    custom: async (id: string): Promise<CustomIntegrationConfig> =>
      request(CustomIntegrationConfig, `${connection(id)}/custom`),
    saveCustom: async (
      id: string,
      body: SaveCustomIntegrationRequest,
    ): Promise<CustomIntegrationConfig> =>
      request(CustomIntegrationConfig, `${connection(id)}/custom`, {
        method: 'PATCH',
        body: parseInput(SaveCustomIntegrationRequest, body),
      }),
    /** Write-only: the answer has the last 4 characters, never the secret. */
    rotateCustomSecret: async (
      id: string,
      body: RotateCustomSecretRequest,
    ): Promise<CustomIntegrationConfig> =>
      request(
        CustomIntegrationConfig,
        `${connection(id)}/custom/secret`,
        post(parseInput(RotateCustomSecretRequest, body)),
      ),
    testCustom: async (id: string): Promise<CustomIntegrationTestResult> =>
      request(CustomIntegrationTestResult, `${connection(id)}/custom/test`, post()),

    // ----- Request an integration -----
    requests: async (): Promise<IntegrationRequestList['items']> =>
      (await request(IntegrationRequestList, '/business/integration-requests')).items,
    request: async (body: CreateIntegrationRequest): Promise<IntegrationRequestRow> =>
      request(
        IntegrationRequestRow,
        '/business/integration-requests',
        post(parseInput(CreateIntegrationRequest, body)),
      ),
  };
}
export type IntegrationsClient = ReturnType<typeof createIntegrationsClient>;
