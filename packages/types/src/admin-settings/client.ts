import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse, PlatformBrandAssetKind } from '../schemas.js';
import {
  AdminEmailStatus,
  AdminSystemHealth,
  AdminBrandAsset,
  AdminBrandAssetList,
  AdminBrandAssetTicket,
  AdminBrandingSection,
  AdminDefaultSetVersions,
  AdminEmailSection,
  AdminFeature,
  AdminFeatureEmergencyRequest,
  AdminFeatureKey,
  AdminFeatureList,
  AdminFeatureOverride,
  AdminFeatureOverrideList,
  AdminFeatureQuery,
  AdminFirmDefaultSet,
  AdminGeneralSection,
  AdminJob,
  AdminJobKey,
  AdminJobList,
  AdminLegalHold,
  AdminLegalHoldList,
  AdminMaintenanceList,
  AdminMaintenanceWindow,
  AdminRetentionPolicy,
  AdminRetentionPolicyList,
  AdminRetentionRun,
  AdminRetentionRunList,
  AdminSecretKey,
  AdminSecretRef,
  AdminSecretRefList,
  AdminSettingsOverview,
  AdminTestEmailRequest,
  AdminTestEmailResult,
  AdminUserDefaultSet,
  ConfirmAdminBrandAssetRequest,
  CreateAdminBrandAssetUploadRequest,
  CreateAdminFeatureRequest,
  CreateAdminLegalHoldRequest,
  CreateAdminMaintenanceRequest,
  CreateAdminRetentionRunRequest,
  PauseAdminJobRequest,
  ReleaseAdminLegalHoldRequest,
  SaveAdminBrandingRequest,
  SaveAdminEmailRequest,
  SaveAdminFirmDefaultsRequest,
  SaveAdminGeneralRequest,
  SaveAdminUserDefaultsRequest,
  SetAdminBrandAssetRequest,
  SetAdminFeatureOverrideRequest,
  SetAdminSecretRefRequest,
  UpdateAdminFeatureRequest,
  UpdateAdminMaintenanceRequest,
  UpdateAdminRetentionPolicyRequest,
} from './schemas.js';

const BASE = '/admin/system-settings';
const id = (value: string) => parseInput(z.uuid(), value);
const category = (value: string) => parseInput(z.string().regex(/^[a-z][a-z0-9_]{0,59}$/), value);
const post = (body: unknown = {}) => ({ method: 'POST', body });
const put = (body: unknown) => ({ method: 'PUT', body });
const patch = (body: unknown) => ({ method: 'PATCH', body });

/**
 * `api.adminSettings` (apps/web/src/lib/api.ts): Super Admin System Settings (R55). Every save
 * names the version it started from (409 SAVE_CONFLICT otherwise). Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createAdminSettingsClient(request: ApiRequest) {
  return {
    overview: async (): Promise<AdminSettingsOverview> => request(AdminSettingsOverview, BASE),

    // General, Branding, Email & Notifications
    general: async (): Promise<AdminGeneralSection> =>
      request(AdminGeneralSection, `${BASE}/general`),
    saveGeneral: async (body: SaveAdminGeneralRequest): Promise<AdminGeneralSection> =>
      request(
        AdminGeneralSection,
        `${BASE}/general`,
        put(parseInput(SaveAdminGeneralRequest, body)),
      ),
    branding: async (): Promise<AdminBrandingSection> =>
      request(AdminBrandingSection, `${BASE}/branding`),
    saveBranding: async (body: SaveAdminBrandingRequest): Promise<AdminBrandingSection> =>
      request(
        AdminBrandingSection,
        `${BASE}/branding`,
        put(parseInput(SaveAdminBrandingRequest, body)),
      ),
    email: async (): Promise<AdminEmailSection> => request(AdminEmailSection, `${BASE}/email`),
    saveEmail: async (body: SaveAdminEmailRequest): Promise<AdminEmailSection> =>
      request(AdminEmailSection, `${BASE}/email`, put(parseInput(SaveAdminEmailRequest, body))),
    /** Send Test Email: the provider's answer (`accepted: false` with the reason when no sender is configured). */
    /** Email Delivery Status: the sender, the last test, and the 24-hour figures (null for now). */
    emailStatus: async (): Promise<AdminEmailStatus> =>
      request(AdminEmailStatus, `${BASE}/email/status`),
    /** The platform's services as the API can check them now. */
    health: async (): Promise<AdminSystemHealth> => request(AdminSystemHealth, `${BASE}/health`),
    testEmail: async (body: AdminTestEmailRequest): Promise<AdminTestEmailResult> =>
      request(
        AdminTestEmailResult,
        `${BASE}/email/test`,
        post(parseInput(AdminTestEmailRequest, body)),
      ),

    // Brand assets (the documents' three-step upload)
    brandAssets: async (kind?: PlatformBrandAssetKind): Promise<AdminBrandAssetList> =>
      request(
        AdminBrandAssetList,
        `${BASE}/branding/assets${toQuery({ kind: kind ? parseInput(PlatformBrandAssetKind, kind) : undefined })}`,
      ),
    createBrandAssetUpload: async (
      body: CreateAdminBrandAssetUploadRequest,
    ): Promise<AdminBrandAssetTicket> =>
      request(
        AdminBrandAssetTicket,
        `${BASE}/branding/assets/uploads`,
        post(parseInput(CreateAdminBrandAssetUploadRequest, body)),
      ),
    confirmBrandAssetUpload: async (
      body: ConfirmAdminBrandAssetRequest,
    ): Promise<AdminBrandAsset> =>
      request(
        AdminBrandAsset,
        `${BASE}/branding/assets/uploads/confirm`,
        post(parseInput(ConfirmAdminBrandAssetRequest, body)),
      ),
    /** Use this asset for its kind (409 ASSET_NOT_READY until it is CLEAN). */
    setBrandAsset: async (
      kind: PlatformBrandAssetKind,
      body: SetAdminBrandAssetRequest,
    ): Promise<AdminBrandingSection> =>
      request(
        AdminBrandingSection,
        `${BASE}/branding/current/${parseInput(PlatformBrandAssetKind, kind)}`,
        put(parseInput(SetAdminBrandAssetRequest, body)),
      ),
    /** Back to Firmivra's built-in asset. */
    resetBrandAsset: async (kind: PlatformBrandAssetKind): Promise<AdminBrandingSection> =>
      request(
        AdminBrandingSection,
        `${BASE}/branding/current/${parseInput(PlatformBrandAssetKind, kind)}`,
        {
          method: 'DELETE',
        },
      ),

    // Secrets (references only)
    secrets: async (): Promise<AdminSecretRefList> =>
      request(AdminSecretRefList, `${BASE}/secrets`),
    setSecret: async (key: string, body: SetAdminSecretRefRequest): Promise<AdminSecretRef> =>
      request(
        AdminSecretRef,
        `${BASE}/secrets/${parseInput(AdminSecretKey, key)}`,
        put(parseInput(SetAdminSecretRefRequest, body)),
      ),
    removeSecret: async (key: string): Promise<OkResponse> =>
      request(OkResponse, `${BASE}/secrets/${parseInput(AdminSecretKey, key)}`, {
        method: 'DELETE',
      }),

    // Feature Management
    features: async (query: AdminFeatureQuery = {}): Promise<AdminFeatureList> =>
      request(AdminFeatureList, `${BASE}/features${toQuery(parseInput(AdminFeatureQuery, query))}`),
    createFeature: async (body: CreateAdminFeatureRequest): Promise<AdminFeature> =>
      request(AdminFeature, `${BASE}/features`, post(parseInput(CreateAdminFeatureRequest, body))),
    updateFeature: async (key: string, body: UpdateAdminFeatureRequest): Promise<AdminFeature> =>
      request(
        AdminFeature,
        `${BASE}/features/${parseInput(AdminFeatureKey, key)}`,
        patch(parseInput(UpdateAdminFeatureRequest, body)),
      ),
    emergency: async (key: string, body: AdminFeatureEmergencyRequest): Promise<AdminFeature> =>
      request(
        AdminFeature,
        `${BASE}/features/${parseInput(AdminFeatureKey, key)}/emergency`,
        post(parseInput(AdminFeatureEmergencyRequest, body)),
      ),
    featureOverrides: async (key: string): Promise<AdminFeatureOverrideList> =>
      request(
        AdminFeatureOverrideList,
        `${BASE}/features/${parseInput(AdminFeatureKey, key)}/firms`,
      ),
    setFeatureOverride: async (
      key: string,
      businessId: string,
      body: SetAdminFeatureOverrideRequest,
    ): Promise<AdminFeatureOverride> =>
      request(
        AdminFeatureOverride,
        `${BASE}/features/${parseInput(AdminFeatureKey, key)}/firms/${id(businessId)}`,
        put(parseInput(SetAdminFeatureOverrideRequest, body)),
      ),
    removeFeatureOverride: async (key: string, businessId: string): Promise<OkResponse> =>
      request(
        OkResponse,
        `${BASE}/features/${parseInput(AdminFeatureKey, key)}/firms/${id(businessId)}`,
        {
          method: 'DELETE',
        },
      ),

    // Data & Retention
    retention: async (): Promise<AdminRetentionPolicyList> =>
      request(AdminRetentionPolicyList, `${BASE}/retention`),
    updateRetention: async (
      cat: string,
      body: UpdateAdminRetentionPolicyRequest,
    ): Promise<AdminRetentionPolicy> =>
      request(
        AdminRetentionPolicy,
        `${BASE}/retention/${category(cat)}`,
        patch(parseInput(UpdateAdminRetentionPolicyRequest, body)),
      ),
    retentionRuns: async (): Promise<AdminRetentionRunList> =>
      request(AdminRetentionRunList, `${BASE}/retention/runs`),
    createRetentionRun: async (
      cat: string,
      body: CreateAdminRetentionRunRequest = {},
    ): Promise<AdminRetentionRun> =>
      request(
        AdminRetentionRun,
        `${BASE}/retention/${category(cat)}/runs`,
        post(parseInput(CreateAdminRetentionRunRequest, body)),
      ),
    cancelRetentionRun: async (runId: string): Promise<AdminRetentionRun> =>
      request(AdminRetentionRun, `${BASE}/retention/runs/${id(runId)}/cancel`, post()),
    holds: async (): Promise<AdminLegalHoldList> => request(AdminLegalHoldList, `${BASE}/holds`),
    createHold: async (body: CreateAdminLegalHoldRequest): Promise<AdminLegalHold> =>
      request(AdminLegalHold, `${BASE}/holds`, post(parseInput(CreateAdminLegalHoldRequest, body))),
    releaseHold: async (
      holdId: string,
      body: ReleaseAdminLegalHoldRequest,
    ): Promise<AdminLegalHold> =>
      request(
        AdminLegalHold,
        `${BASE}/holds/${id(holdId)}/release`,
        post(parseInput(ReleaseAdminLegalHoldRequest, body)),
      ),

    // Maintenance and background jobs
    maintenance: async (): Promise<AdminMaintenanceList> =>
      request(AdminMaintenanceList, `${BASE}/maintenance`),
    scheduleMaintenance: async (
      body: CreateAdminMaintenanceRequest,
    ): Promise<AdminMaintenanceWindow> =>
      request(
        AdminMaintenanceWindow,
        `${BASE}/maintenance`,
        post(parseInput(CreateAdminMaintenanceRequest, body)),
      ),
    updateMaintenance: async (
      windowId: string,
      body: UpdateAdminMaintenanceRequest,
    ): Promise<AdminMaintenanceWindow> =>
      request(
        AdminMaintenanceWindow,
        `${BASE}/maintenance/${id(windowId)}`,
        patch(parseInput(UpdateAdminMaintenanceRequest, body)),
      ),
    /** "Enable Maintenance Mode" starts a window now; complete ends it. */
    startMaintenance: async (windowId: string): Promise<AdminMaintenanceWindow> =>
      request(AdminMaintenanceWindow, `${BASE}/maintenance/${id(windowId)}/start`, post()),
    completeMaintenance: async (windowId: string): Promise<AdminMaintenanceWindow> =>
      request(AdminMaintenanceWindow, `${BASE}/maintenance/${id(windowId)}/complete`, post()),
    cancelMaintenance: async (windowId: string): Promise<AdminMaintenanceWindow> =>
      request(AdminMaintenanceWindow, `${BASE}/maintenance/${id(windowId)}/cancel`, post()),
    jobs: async (): Promise<AdminJobList> => request(AdminJobList, `${BASE}/jobs`),
    pauseJob: async (key: string, body: PauseAdminJobRequest): Promise<AdminJob> =>
      request(
        AdminJob,
        `${BASE}/jobs/${parseInput(AdminJobKey, key)}/pause`,
        post(parseInput(PauseAdminJobRequest, body)),
      ),
    resumeJob: async (key: string): Promise<AdminJob> =>
      request(AdminJob, `${BASE}/jobs/${parseInput(AdminJobKey, key)}/resume`, post()),

    // Defaults for new firms and users
    firmDefaults: async (): Promise<AdminFirmDefaultSet> =>
      request(AdminFirmDefaultSet, `${BASE}/defaults/firm`),
    saveFirmDefaults: async (body: SaveAdminFirmDefaultsRequest): Promise<AdminFirmDefaultSet> =>
      request(
        AdminFirmDefaultSet,
        `${BASE}/defaults/firm`,
        post(parseInput(SaveAdminFirmDefaultsRequest, body)),
      ),
    userDefaults: async (): Promise<AdminUserDefaultSet> =>
      request(AdminUserDefaultSet, `${BASE}/defaults/user`),
    saveUserDefaults: async (body: SaveAdminUserDefaultsRequest): Promise<AdminUserDefaultSet> =>
      request(
        AdminUserDefaultSet,
        `${BASE}/defaults/user`,
        post(parseInput(SaveAdminUserDefaultsRequest, body)),
      ),
    defaultVersions: async (kind: 'firm' | 'user'): Promise<AdminDefaultSetVersions> =>
      request(
        AdminDefaultSetVersions,
        `${BASE}/defaults/${parseInput(z.enum(['firm', 'user']), kind)}/versions`,
      ),
  };
}
export type AdminSettingsClient = ReturnType<typeof createAdminSettingsClient>;
