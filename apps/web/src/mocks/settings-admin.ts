import {
  ApiRequestError,
  BRAND_ASSET_LIMITS,
  type BrandingClient,
  type BrandingSettings,
  ConfirmBrandAssetUploadRequest,
  CreateBrandAssetUploadRequest,
  InviteUserRequest,
  parseInput,
  ResetBrandingRequest,
  type SettingsOverview,
  type SettingsOverviewClient,
  UpdateBrandingRequest,
  UsersQuery,
  type UsersClient,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { addInvitedMember, listStaffRows, staffCounts } from './staff-management';

/**
 * Mock data for `api.settingsOverview`, `api.branding` and `api.users` (R42 contract, Settings).
 * Synthetic data only. Users & Roles reads the same members as `api.staff` (mocks/staff-management.ts), so an
 * invite shows in both. STAFF gets 403 FORBIDDEN, like the API. `empty: true`
 * (NEXT_PUBLIC_API_MOCK_EMPTY=settingsOverview,branding,users) gives no activity, default
 * branding and only the signed-in owner.
 */

type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const allowed = async (role: MockRole | undefined) => {
  await mockDelay();
  if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
};
const COMPANY = 'LVP Accounting & Taxes';

/** Settings > Overview in mock mode. Built on each call from the shared member rows. */
export function createSettingsOverviewMock(options: Options = {}): SettingsOverviewClient {
  return {
    get: async (): Promise<SettingsOverview> => {
      await allowed(options.role);
      const counts = staffCounts({ role: options.role, empty: options.empty });
      const today = new Date().toISOString().slice(0, 10);
      const at = (daysAgo: number, time: string) =>
        new Date(Date.parse(`${today}T${time}:00Z`) - daysAgo * 86_400_000).toISOString();
      return {
        staffUsers: { value: counts.total, addedThisMonth: counts.addedThisMonth },
        securityAlerts: options.empty ? 0 : 1,
        recentActivity: options.empty
          ? []
          : [
              {
                id: '0199c0a1-0000-7000-8000-000000000001',
                at: at(0, '13:42'),
                action: 'staff.documents_verified',
                label: 'Staff documents verified - Hana Kim',
                tone: 'success',
              },
              {
                id: '0199c0a1-0000-7000-8000-000000000002',
                at: at(0, '12:15'),
                action: 'staff.role_changed',
                label: 'Role changed to Manager - Lena Fischer',
                tone: 'warning',
              },
              {
                id: '0199c0a1-0000-7000-8000-000000000003',
                at: at(1, '15:00'),
                action: 'settings.branding_updated',
                label: 'Branding settings updated',
                tone: 'info',
              },
              {
                id: '0199c0a1-0000-7000-8000-000000000004',
                at: at(1, '14:00'),
                action: 'staff.invited',
                label: 'New staff user added - S. Whitley',
                tone: 'user',
              },
              {
                id: '0199c0a1-0000-7000-8000-000000000005',
                at: at(5, '06:00'),
                action: 'system.backup_completed',
                label: 'System backup completed successfully',
                tone: 'system',
              },
            ],
      };
    },
  };
}

function defaultBranding(): BrandingSettings {
  return {
    legalName: null,
    businessCategory: null,
    adminEmail: null,
    secondaryColor: null,
    backgroundColor: null,
    themeMode: 'LIGHT',
    sidebarStyle: 'SOLID',
    sidebarPosition: 'LEFT',
    showLogoText: true,
    roundedCorners: true,
    faviconUrl: null,
    loginBackgroundUrl: null,
    loginMessage: null,
    email: {
      logoUrl: null,
      fromName: null,
      replyToEmail: null,
      header: null,
      footer: null,
      disclaimer: null,
    },
    portal: { logoUrl: null, primaryColor: null, accentColor: null },
    documents: {
      showLetterhead: true,
      header: null,
      footer: null,
      signatureBlock: null,
      legalText: null,
    },
    preferences: {
      locale: 'en-US',
      currency: 'USD',
      dateFormat: 'MM/DD/YYYY',
      numberFormat: '1,234.56',
    },
    updatedAt: null,
    version: 'v1',
  };
}

function sampleBranding(): BrandingSettings {
  return {
    ...defaultBranding(),
    legalName: 'Sample Legal Name LLC',
    businessCategory: 'Accounting & Tax Services',
    adminEmail: 'admin@lvp.test',
    secondaryColor: '#d4af37',
    backgroundColor: '#f5f8ff',
    loginMessage: 'Welcome to Firmivra. Your trusted partner in tax and business growth.',
    email: {
      logoUrl: null,
      fromName: COMPANY,
      replyToEmail: 'support@lvp.test',
      header: null,
      footer: '100 Sample Road, Springfield, GA 30000',
      disclaimer:
        'This email may contain confidential information intended only for the recipient.',
    },
    documents: {
      showLetterhead: true,
      header: COMPANY,
      footer: '100 Sample Road, Springfield, GA 30000 | (555) 010-0100',
      signatureBlock: 'The team at LVP Accounting & Taxes',
      legalText: null,
    },
    updatedAt: '2026-10-13T15:00:00.000Z',
  };
}

const MOCK_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNkYPj/n4EIwDiqEAAqEAEA9xMPUgAAAABJRU5ErkJggg==';

/** Company Profile & Branding in mock mode. Contrast is checked loosely (same colour twice). */
export function createBrandingMock(options: Options = {}): BrandingClient {
  let state: BrandingSettings | undefined;
  const current = () => (state ??= options.empty ? defaultBranding() : sampleBranding());
  const uploads = new Map<string, CreateBrandAssetUploadRequest>();
  let n = 0;
  const bump = (b: BrandingSettings) => {
    b.version = `v${Number(b.version.slice(1)) + 1}`;
    b.updatedAt = new Date().toISOString();
  };
  const setAsset = (
    b: BrandingSettings,
    kind: CreateBrandAssetUploadRequest['kind'],
    url: string | null,
  ) => {
    if (kind === 'FAVICON') b.faviconUrl = url;
    if (kind === 'LOGIN_BACKGROUND') b.loginBackgroundUrl = url;
    if (kind === 'EMAIL_LOGO') b.email.logoUrl = url;
    if (kind === 'PORTAL_LOGO') b.portal.logoUrl = url;
  };
  return {
    get: async () => {
      await allowed(options.role);
      return structuredClone(current());
    },
    update: async (body) => {
      await allowed(options.role);
      const input = parseInput(UpdateBrandingRequest, body);
      const b = current();
      if (input.version !== b.version)
        throw fail(409, 'SAVE_CONFLICT', 'Someone saved the branding first');
      if (
        input.secondaryColor &&
        input.backgroundColor &&
        input.secondaryColor === input.backgroundColor
      ) {
        throw fail(400, 'LOW_CONTRAST', 'Choose colours that are readable on each other');
      }
      const { version: _v, email, portal, documents, preferences, ...top } = input;
      for (const [k, v] of Object.entries(top)) if (v !== undefined) Object.assign(b, { [k]: v });
      if (email)
        for (const [k, v] of Object.entries(email))
          if (v !== undefined) Object.assign(b.email, { [k]: v });
      if (portal)
        for (const [k, v] of Object.entries(portal))
          if (v !== undefined) Object.assign(b.portal, { [k]: v });
      if (documents)
        for (const [k, v] of Object.entries(documents))
          if (v !== undefined) Object.assign(b.documents, { [k]: v });
      if (preferences)
        for (const [k, v] of Object.entries(preferences))
          if (v !== undefined) Object.assign(b.preferences, { [k]: v });
      bump(b);
      return structuredClone(b);
    },
    createAssetUpload: async (body) => {
      await allowed(options.role);
      const input = parseInput(CreateBrandAssetUploadRequest, body);
      const limits = BRAND_ASSET_LIMITS[input.kind];
      if (!limits.contentTypes.includes(input.contentType) || input.sizeBytes > limits.maxBytes) {
        throw fail(
          400,
          'INVALID_ASSET',
          `Use ${limits.recommended}, up to ${limits.maxBytes / 1024 / 1024} MB`,
        );
      }
      n += 1;
      uploads.set(`mock-upload-${n}`, input);
      return {
        uploadToken: `mock-upload-${n}`,
        url: `mock:upload/${n}`,
        method: 'PUT',
        headers: { 'content-type': input.contentType },
        expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
      };
    },
    confirmAssetUpload: async (body) => {
      await allowed(options.role);
      const { uploadToken } = parseInput(ConfirmBrandAssetUploadRequest, body);
      const pending = uploads.get(uploadToken);
      if (!pending) throw fail(400, 'VALIDATION_FAILED', 'Upload the file again');
      uploads.delete(uploadToken);
      const b = current();
      setAsset(b, pending.kind, MOCK_IMAGE);
      bump(b);
      return structuredClone(b);
    },
    removeAsset: async (kind) => {
      await allowed(options.role);
      const b = current();
      setAsset(b, kind, null);
      bump(b);
      return structuredClone(b);
    },
    reset: async (body) => {
      await allowed(options.role);
      const { groups } = parseInput(ResetBrandingRequest, body);
      const b = current();
      const d = defaultBranding();
      if (groups.includes('THEME')) {
        Object.assign(b, {
          secondaryColor: d.secondaryColor,
          backgroundColor: d.backgroundColor,
          themeMode: d.themeMode,
          sidebarStyle: d.sidebarStyle,
          sidebarPosition: d.sidebarPosition,
          showLogoText: d.showLogoText,
          roundedCorners: d.roundedCorners,
          faviconUrl: d.faviconUrl,
        });
      }
      if (groups.includes('LOGIN'))
        Object.assign(b, { loginBackgroundUrl: null, loginMessage: null });
      if (groups.includes('EMAIL')) b.email = d.email;
      if (groups.includes('PORTAL')) b.portal = d.portal;
      if (groups.includes('DOCUMENTS')) b.documents = d.documents;
      bump(b);
      return structuredClone(b);
    },
  };
}

/** Settings > Users & Roles in mock mode, on the staff mock's rows. */
export function createUsersMock(options: Options = {}): UsersClient {
  const shared = { role: options.role, empty: options.empty };
  return {
    list: async (query = {}) => {
      await allowed(options.role);
      const q = parseInput(UsersQuery, query);
      const rows = listStaffRows(shared, q).map((r) => ({ ...r, company: COMPANY }));
      const start = (q.page - 1) * q.pageSize;
      return {
        items: rows.slice(start, start + q.pageSize),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    summary: async () => {
      await allowed(options.role);
      const c = staffCounts(shared);
      return {
        total: c.total,
        addedThisMonth: c.addedThisMonth,
        active: c.active,
        pendingInvitations: c.invited,
        roles: c.roles,
        customRoles: 0,
      };
    },
    exportUrl: () =>
      `data:text/csv;charset=utf-8,${encodeURIComponent('Name,Email,Role,Status\nSample User,sample@lvp.test,Staff,Active\n')}`,
    invite: async (body) => {
      await allowed(options.role);
      const input = parseInput(InviteUserRequest, body);
      if (options.role === 'ADMIN' && input.role === 'ADMIN') {
        throw fail(403, 'CANNOT_GRANT', 'You cannot invite this role');
      }
      const { member, invitation } = addInvitedMember(shared, input);
      const row = listStaffRows(shared, {}).find((r) => r.id === member.id);
      if (!row) throw fail(500, 'INTERNAL', 'The invite was not saved');
      return { user: { ...row, company: COMPANY }, invitation };
    },
  };
}
