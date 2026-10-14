import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { UploadTicket } from '../documents/schemas.js';
import { MembershipRole, OkResponse } from '../schemas.js';
import {
  CreateDepartmentRequest,
  CreateStaffTeamRequest,
  Department,
  DepartmentDetail,
  DepartmentId,
  DepartmentListQuery,
  DepartmentListResponse,
  DepartmentSummary,
  OrgChart,
  SetStaffTeamMembersRequest,
  StaffTeam,
  StaffTeamDetail,
  StaffTeamId,
  StaffTeamList,
  StaffTeamListQuery,
  UpdateDepartmentRequest,
  UpdateStaffTeamRequest,
} from './departments.js';
import {
  CreateCustomRoleRequest,
  CustomRole,
  PermissionModuleList,
  RoleList,
  RolePermissions,
  SaveRolePermissionsRequest,
} from './roles.js';
import {
  ConfirmStaffDocumentUploadRequest,
  CreateStaffDocumentUploadRequest,
  CreateStaffRequest,
  CreateStaffResponse,
  LockStaffRequest,
  SaveStaffDraftRequest,
  SetStaffNoteRequest,
  SetStaffPermissionsRequest,
  StaffAccessInput,
  StaffActionResult,
  StaffActivityPage,
  StaffCompensation,
  StaffCompensationInput,
  StaffCursorQuery,
  StaffDetail,
  StaffDocument,
  StaffDocumentId,
  StaffDocumentLink,
  StaffDocumentList,
  StaffDraft,
  StaffDraftId,
  StaffDraftList,
  StaffFormOptions,
  StaffId,
  StaffImportPreview,
  StaffImportPreviewRequest,
  StaffImportRequest,
  StaffImportResult,
  StaffListQuery,
  StaffListResponse,
  StaffLoginHistory,
  StaffNote,
  StaffPermissions,
  StaffSecurity,
  StaffSecurityActionRequest,
  StaffSessionId,
  StaffSessionList,
  StaffSummary,
  UpdateStaffDocumentRequest,
  UpdateStaffRequest,
} from './schemas.js';

const STAFF = '/business/staff';
const DRAFTS = '/business/staff-drafts';
const one = (id: string) => `${STAFF}/${parseInput(StaffId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });
const put = (body: unknown) => ({ method: 'PUT', body });

/** The note's GET answers null when there is none. */
const MaybeNote = z.object({ note: StaffNote.nullable() });

/**
 * `api.staff` (apps/web/src/lib/api.ts): Staff Management for Owner and Admin (Manager reads).
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 * The business is the signed-in firm (server side): never sent in a path, query or body.
 * `baseUrl` ('/api/v1' in the browser) prefixes the plain download links.
 */
export function createStaffClient(request: ApiRequest, baseUrl = '') {
  return {
    // Directory
    list: async (query: StaffListQuery = {}): Promise<StaffListResponse> =>
      request(StaffListResponse, `${STAFF}${toQuery(parseInput(StaffListQuery, query))}`),
    summary: async (): Promise<StaffSummary> => request(StaffSummary, `${STAFF}/summary`),
    options: async (): Promise<StaffFormOptions> => request(StaffFormOptions, `${STAFF}/options`),

    // One member
    get: async (id: string): Promise<StaffDetail> => request(StaffDetail, one(id)),
    /** Submit & Send Invitation. Retrying with the same idempotencyKey never duplicates. */
    create: async (body: CreateStaffRequest): Promise<CreateStaffResponse> =>
      request(CreateStaffResponse, STAFF, post(parseInput(CreateStaffRequest, body))),
    /** Save Changes. 409 SAVE_CONFLICT when someone saved first. */
    update: async (id: string, body: UpdateStaffRequest): Promise<StaffDetail> =>
      request(StaffDetail, one(id), {
        method: 'PATCH',
        body: parseInput(UpdateStaffRequest, body),
      }),

    // Access & Security
    security: async (id: string): Promise<StaffSecurity> =>
      request(StaffSecurity, `${one(id)}/security`),
    updateSecurity: async (id: string, body: StaffAccessInput): Promise<StaffSecurity> =>
      request(StaffSecurity, `${one(id)}/security`, put(parseInput(StaffAccessInput, body))),
    sessions: async (id: string): Promise<StaffSessionList['items']> =>
      (await request(StaffSessionList, `${one(id)}/sessions`)).items,
    revokeSession: async (id: string, sessionId: string): Promise<StaffActionResult> =>
      request(
        StaffActionResult,
        `${one(id)}/sessions/${parseInput(StaffSessionId, sessionId)}/revoke`,
        post(),
      ),
    signOutAll: async (id: string, body: StaffSecurityActionRequest): Promise<StaffActionResult> =>
      request(
        StaffActionResult,
        `${one(id)}/sessions/revoke-all`,
        post(parseInput(StaffSecurityActionRequest, body)),
      ),
    loginHistory: async (id: string, query: StaffCursorQuery = {}): Promise<StaffLoginHistory> =>
      request(
        StaffLoginHistory,
        `${one(id)}/login-history${toQuery(parseInput(StaffCursorQuery, query))}`,
      ),
    activity: async (id: string, query: StaffCursorQuery = {}): Promise<StaffActivityPage> =>
      request(
        StaffActivityPage,
        `${one(id)}/activity${toQuery(parseInput(StaffCursorQuery, query))}`,
      ),
    /** Secure reset link by email; nobody ever sees a password. */
    resetPassword: async (
      id: string,
      body: StaffSecurityActionRequest,
    ): Promise<StaffActionResult> =>
      request(
        StaffActionResult,
        `${one(id)}/reset-password`,
        post(parseInput(StaffSecurityActionRequest, body)),
      ),
    /** High risk: the member enrols MFA again at next sign-in; sessions are signed out. */
    resetMfa: async (id: string, body: StaffSecurityActionRequest): Promise<StaffActionResult> =>
      request(
        StaffActionResult,
        `${one(id)}/reset-mfa`,
        post(parseInput(StaffSecurityActionRequest, body)),
      ),
    lock: async (id: string, body: LockStaffRequest): Promise<StaffActionResult> =>
      request(StaffActionResult, `${one(id)}/lock`, post(parseInput(LockStaffRequest, body))),
    unlock: async (id: string): Promise<StaffActionResult> =>
      request(StaffActionResult, `${one(id)}/unlock`, post()),
    /** Ends access, keeps the record. 409 LAST_ACTIVE_OWNER for the last active owner. */
    deactivate: async (id: string, body: StaffSecurityActionRequest): Promise<StaffActionResult> =>
      request(
        StaffActionResult,
        `${one(id)}/deactivate`,
        post(parseInput(StaffSecurityActionRequest, body)),
      ),
    reactivate: async (id: string): Promise<StaffActionResult> =>
      request(StaffActionResult, `${one(id)}/reactivate`, post()),
    /** A fresh activation link; the old one stops working. Never a second account. */
    resendInvite: async (id: string): Promise<StaffActionResult> =>
      request(StaffActionResult, `${one(id)}/invite/resend`, post()),
    revokeInvite: async (id: string): Promise<StaffActionResult> =>
      request(StaffActionResult, `${one(id)}/invite/revoke`, post()),

    // Permissions (step 2 and the Permissions tab)
    permissions: async (id: string): Promise<StaffPermissions> =>
      request(StaffPermissions, `${one(id)}/permissions`),
    setPermissions: async (
      id: string,
      body: SetStaffPermissionsRequest,
    ): Promise<StaffPermissions> =>
      request(
        StaffPermissions,
        `${one(id)}/permissions`,
        put(parseInput(SetStaffPermissionsRequest, body)),
      ),
    /** "Copy Permissions from Another Staff Member": copies `fromId`'s grid onto `id`. */
    copyPermissions: async (id: string, fromId: string): Promise<StaffPermissions> =>
      request(
        StaffPermissions,
        `${one(id)}/permissions/copy-from/${parseInput(StaffId, fromId)}`,
        post(),
      ),

    // Notes and pay
    note: async (id: string): Promise<StaffNote | null> =>
      (await request(MaybeNote, `${one(id)}/notes`)).note,
    setNote: async (id: string, body: SetStaffNoteRequest): Promise<StaffNote | null> =>
      (await request(MaybeNote, `${one(id)}/notes`, put(parseInput(SetStaffNoteRequest, body))))
        .note,
    /** Owner and Admin only (403 otherwise). */
    compensation: async (id: string): Promise<StaffCompensation> =>
      request(StaffCompensation, `${one(id)}/compensation`),
    setCompensation: async (id: string, body: StaffCompensationInput): Promise<StaffCompensation> =>
      request(
        StaffCompensation,
        `${one(id)}/compensation`,
        put(parseInput(StaffCompensationInput, body)),
      ),

    // Staff documents (Owner and Admin only)
    documents: async (id: string): Promise<StaffDocument[]> =>
      (await request(StaffDocumentList, `${one(id)}/documents`)).items,
    createDocumentUpload: async (
      id: string,
      body: CreateStaffDocumentUploadRequest,
    ): Promise<UploadTicket> =>
      request(
        UploadTicket,
        `${one(id)}/documents/uploads`,
        post(parseInput(CreateStaffDocumentUploadRequest, body)),
      ),
    confirmDocumentUpload: async (
      id: string,
      body: ConfirmStaffDocumentUploadRequest,
    ): Promise<StaffDocument> =>
      request(
        StaffDocument,
        `${one(id)}/documents/uploads/confirm`,
        post(parseInput(ConfirmStaffDocumentUploadRequest, body)),
      ),
    /** View / Download: 409 DOCUMENT_NOT_READY until the scan is CLEAN. */
    documentLink: async (id: string, docId: string): Promise<StaffDocumentLink> =>
      request(
        StaffDocumentLink,
        `${one(id)}/documents/${parseInput(StaffDocumentId, docId)}/download`,
      ),
    reclassifyDocument: async (
      id: string,
      docId: string,
      body: UpdateStaffDocumentRequest,
    ): Promise<StaffDocument> =>
      request(StaffDocument, `${one(id)}/documents/${parseInput(StaffDocumentId, docId)}`, {
        method: 'PATCH',
        body: parseInput(UpdateStaffDocumentRequest, body),
      }),
    archiveDocument: async (id: string, docId: string): Promise<StaffDocument> =>
      request(
        StaffDocument,
        `${one(id)}/documents/${parseInput(StaffDocumentId, docId)}/archive`,
        post(),
      ),

    // Drafts (no account, no invite)
    drafts: async (): Promise<StaffDraft[]> => (await request(StaffDraftList, DRAFTS)).items,
    draft: async (draftId: string): Promise<StaffDraft> =>
      request(StaffDraft, `${DRAFTS}/${parseInput(StaffDraftId, draftId)}`),
    createDraft: async (body: SaveStaffDraftRequest): Promise<StaffDraft> =>
      request(StaffDraft, DRAFTS, post(parseInput(SaveStaffDraftRequest, body))),
    saveDraft: async (draftId: string, body: SaveStaffDraftRequest): Promise<StaffDraft> =>
      request(
        StaffDraft,
        `${DRAFTS}/${parseInput(StaffDraftId, draftId)}`,
        put(parseInput(SaveStaffDraftRequest, body)),
      ),
    deleteDraft: async (draftId: string): Promise<OkResponse> =>
      request(OkResponse, `${DRAFTS}/${parseInput(StaffDraftId, draftId)}`, { method: 'DELETE' }),

    // Bulk Upload Staff
    /** The CSV template's address (a plain download link). */
    importTemplateUrl: (): string => `${baseUrl}${STAFF}/import/template`,
    previewImport: async (body: StaffImportPreviewRequest): Promise<StaffImportPreview> =>
      request(
        StaffImportPreview,
        `${STAFF}/import/preview`,
        post(parseInput(StaffImportPreviewRequest, body)),
      ),
    import: async (body: StaffImportRequest): Promise<StaffImportResult> =>
      request(StaffImportResult, `${STAFF}/import`, post(parseInput(StaffImportRequest, body))),
  };
}
export type StaffClient = ReturnType<typeof createStaffClient>;

const department = (id: string) => `/business/departments/${parseInput(DepartmentId, id)}`;
const team = (id: string) => `/business/teams/${parseInput(StaffTeamId, id)}`;

/** `api.departments`: Teams & Departments and the org chart. Owner and Admin change. */
export function createDepartmentsClient(request: ApiRequest) {
  return {
    list: async (query: DepartmentListQuery = {}): Promise<DepartmentListResponse> =>
      request(
        DepartmentListResponse,
        `/business/departments${toQuery(parseInput(DepartmentListQuery, query))}`,
      ),
    summary: async (): Promise<DepartmentSummary> =>
      request(DepartmentSummary, '/business/departments/summary'),
    get: async (id: string): Promise<DepartmentDetail> => request(DepartmentDetail, department(id)),
    create: async (body: CreateDepartmentRequest): Promise<Department> =>
      request(Department, '/business/departments', post(parseInput(CreateDepartmentRequest, body))),
    update: async (id: string, body: UpdateDepartmentRequest): Promise<Department> =>
      request(Department, department(id), {
        method: 'PATCH',
        body: parseInput(UpdateDepartmentRequest, body),
      }),

    teams: async (query: StaffTeamListQuery = {}): Promise<StaffTeam[]> =>
      (
        await request(
          StaffTeamList,
          `/business/teams${toQuery(parseInput(StaffTeamListQuery, query))}`,
        )
      ).items,
    team: async (id: string): Promise<StaffTeamDetail> => request(StaffTeamDetail, team(id)),
    createTeam: async (body: CreateStaffTeamRequest): Promise<StaffTeam> =>
      request(StaffTeam, '/business/teams', post(parseInput(CreateStaffTeamRequest, body))),
    updateTeam: async (id: string, body: UpdateStaffTeamRequest): Promise<StaffTeam> =>
      request(StaffTeam, team(id), {
        method: 'PATCH',
        body: parseInput(UpdateStaffTeamRequest, body),
      }),
    setTeamMembers: async (
      id: string,
      body: SetStaffTeamMembersRequest,
    ): Promise<StaffTeamDetail> =>
      request(
        StaffTeamDetail,
        `${team(id)}/members`,
        put(parseInput(SetStaffTeamMembersRequest, body)),
      ),

    orgChart: async (): Promise<OrgChart> => request(OrgChart, '/business/org-chart'),
  };
}
export type DepartmentsClient = ReturnType<typeof createDepartmentsClient>;

const role = (r: MembershipRole) => `/business/roles/${parseInput(MembershipRole, r)}/permissions`;

/** `api.roles`: roles and their permission grid (Create Staff step 2, Settings > Users & Roles). */
export function createRolesClient(request: ApiRequest) {
  return {
    list: async (): Promise<RoleList> => request(RoleList, '/business/roles'),
    permissions: async (r: MembershipRole): Promise<RolePermissions> =>
      request(RolePermissions, role(r)),
    /** Save Changes. 409 PERMISSION_ESCALATION: ask, then resend with acknowledgeEscalation. */
    savePermissions: async (
      r: MembershipRole,
      body: SaveRolePermissionsRequest,
    ): Promise<RolePermissions> =>
      request(RolePermissions, role(r), put(parseInput(SaveRolePermissionsRequest, body))),
    /** Reset to Default: removes the firm's changes to this role. */
    resetPermissions: async (r: MembershipRole): Promise<RolePermissions> =>
      request(RolePermissions, role(r), { method: 'DELETE' }),
    modules: async (): Promise<PermissionModuleList> =>
      request(PermissionModuleList, '/business/permission-modules'),
    /** Not built yet (needs a custom_roles table): 501 NOT_IMPLEMENTED until then. */
    createCustom: async (body: CreateCustomRoleRequest): Promise<CustomRole> =>
      request(
        CustomRole,
        '/business/roles/custom',
        post(parseInput(CreateCustomRoleRequest, body)),
      ),
  };
}
export type RolesClient = ReturnType<typeof createRolesClient>;
