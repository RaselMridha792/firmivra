import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { UploadTicket } from '../documents/schemas.js';
import {
  BrandAssetKind,
  BrandingSettings,
  ConfirmBrandAssetUploadRequest,
  CreateBrandAssetUploadRequest,
  ResetBrandingRequest,
  UpdateBrandingRequest,
} from './branding.js';
import { SettingsOverview } from './overview.js';
import {
  FirmUserList,
  InviteUserRequest,
  InviteUserResponse,
  UsersQuery,
  UsersSummary,
} from './users.js';

const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/** `api.settingsOverview`: Settings > Overview. Owner and Admin only. */
export function createSettingsOverviewClient(request: ApiRequest) {
  return {
    get: async (): Promise<SettingsOverview> =>
      request(SettingsOverview, '/business/settings/overview'),
  };
}
export type SettingsOverviewClient = ReturnType<typeof createSettingsOverviewClient>;

/**
 * `api.branding`: Company Profile & Branding beyond api.settings (see branding.ts). Owner and
 * Admin only. The company logo stays api.settings.createLogoUpload.
 */
export function createBrandingClient(request: ApiRequest) {
  return {
    get: async (): Promise<BrandingSettings> => request(BrandingSettings, '/business/branding'),
    /** Save Changes. 409 SAVE_CONFLICT; 400 LOW_CONTRAST. */
    update: async (body: UpdateBrandingRequest): Promise<BrandingSettings> =>
      request(BrandingSettings, '/business/branding', {
        method: 'PATCH',
        body: parseInput(UpdateBrandingRequest, body),
      }),
    createAssetUpload: async (body: CreateBrandAssetUploadRequest): Promise<UploadTicket> =>
      request(
        UploadTicket,
        '/business/branding/assets/uploads',
        post(parseInput(CreateBrandAssetUploadRequest, body)),
      ),
    /** Checks the stored file and makes it active; the previous one stays until this succeeds. */
    confirmAssetUpload: async (body: ConfirmBrandAssetUploadRequest): Promise<BrandingSettings> =>
      request(
        BrandingSettings,
        '/business/branding/assets/uploads/confirm',
        post(parseInput(ConfirmBrandAssetUploadRequest, body)),
      ),
    /** Remove (falls back to the default). Repeating is harmless. */
    removeAsset: async (kind: BrandAssetKind): Promise<BrandingSettings> =>
      request(BrandingSettings, `/business/branding/assets/${parseInput(BrandAssetKind, kind)}`, {
        method: 'DELETE',
      }),
    reset: async (body: ResetBrandingRequest): Promise<BrandingSettings> =>
      request(
        BrandingSettings,
        '/business/branding/reset',
        post(parseInput(ResetBrandingRequest, body)),
      ),
  };
}
export type BrandingClient = ReturnType<typeof createBrandingClient>;

/** `api.users`: Settings > Users & Roles' table and Invite User. Owner and Admin only. */
/** `baseUrl` ('/api/v1' in the browser) prefixes the export download link. */
export function createUsersClient(request: ApiRequest, baseUrl = '') {
  /** The query as URL values: a selection's ids go as one comma-separated value. */
  const values = (query: UsersQuery) => {
    const { ids, ...rest } = parseInput(UsersQuery, query);
    return { ...rest, ...(ids ? { ids: ids.join(',') } : {}) };
  };
  return {
    list: async (query: UsersQuery = {}): Promise<FirmUserList> =>
      request(FirmUserList, `/business/users${toQuery(values(query))}`),
    summary: async (): Promise<UsersSummary> => request(UsersSummary, '/business/users/summary'),
    /** Export: a CSV download link with the same filters (audited by the API). */
    exportUrl: (query: UsersQuery = {}): string => {
      const { page: _page, pageSize: _size, ...filters } = values(query);
      return `${baseUrl}/business/users/export${toQuery(filters)}`;
    },
    invite: async (body: InviteUserRequest): Promise<InviteUserResponse> =>
      request(
        InviteUserResponse,
        '/business/users/invite',
        post(parseInput(InviteUserRequest, body)),
      ),
  };
}
export type UsersClient = ReturnType<typeof createUsersClient>;
