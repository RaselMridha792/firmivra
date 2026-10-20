import {
  ADMIN_COMM_ERRORS,
  ADMIN_COMM_SMS_MAX,
  ADMIN_TEAM_ACTIVITY_LABELS,
  ADMIN_TEAM_ERRORS,
  ADMIN_TEAM_KEYS,
  ADMIN_TEAM_LEVEL_NUMBERS,
  ADMIN_TEAM_SCOPES,
  ADMIN_TEAM_SKIP_REASON_LABELS,
  AdminTeamMemberId,
  AdminTeamSettableStatus,
  adminTeamActivityText,
  adminTeamSamePermissions,
  ApiRequestError,
  CreateAdminTeamMemberRequest,
  UpdateAdminTeamMemberRequest,
  type AdminCommMessage,
  type AdminTeamActivityEntry,
  type AdminTeamBulkAction,
  type AdminTeamErrorCode,
  type AdminTeamFormRole,
  type AdminTeamLevel,
  type AdminTeamMember as ApiMember,
  type AdminTeamMeta,
  type AdminTeamModule,
  type AdminTeamScope,
  type AdminTeamSort,
  type AdminTeamStatus,
} from '@firmivra/types';
import { api } from '../../../../../lib/api';
import { errorMessage as baseErrorMessage } from '../../../../../lib/errors';
import { mocked } from '../../../../../lib/mock';
import type * as Mock from '../../../../../mocks/admin-team';
import {
  ACCESS_SCOPES as MOCK_ACCESS_SCOPES,
  adminTeam as mockTeam,
  checkMember as mockCheckMember,
  checkMessage,
  defaultScope as mockDefaultScope,
  grantable as mockGrantable,
  memberToSave as mockMemberToSave,
  PERMISSION_ACTIONS,
  plainText,
  roleById as mockRoleById,
  roleTemplate as mockRoleTemplate,
  supervisorsFor as mockSupervisorsFor,
  TEAM_ERROR_MESSAGES as MOCK_ERROR_MESSAGES,
  TEAM_MODULES as MOCK_TEAM_MODULES,
} from '../../../../../mocks/admin-team';

// The Team screens' data (R60): `api.adminTeam` (contract packages/types/src/admin-team), under
// the names and shapes the screens were built with (mocks/admin-team.ts). Mock mode
// (NEXT_PUBLIC_API_MOCK=adminTeam) keeps the mock. What differs from the mock
// (docs/work/R60-team.md, "Team screens") is handled here:
// - Levels are numbers again (ADMIN_TEAM_LEVEL_NUMBERS); ids and the catalog are the database's.
// - Permissions are keys: the grid reads them by `meta().modules` (each key's column), and keys
//   with no column are kept as they are.
// - The hire waiting for the department head reads as the mock's Pending Approval.
// - Job title is the role's title; locations, teams, presence and groups have no data: empty.
// - A message to one member goes through Communications (email and text); other messages, Add Team
//   Member, Resend Invitation and custom groups answer 422.

const MODULE = 'adminTeam';
const MOCKED = mocked(MODULE);

// ---------- Types the screens use ----------

export type {
  AccessLevel,
  AuthorityLevel,
  Availability,
  BulkChange,
  CreateTeamGroup,
  FormPerson,
  FormRole,
  MemberActions,
  MemberFieldErrors,
  MemberStatus,
  MessageAudience,
  MessageChannel,
  MessageFieldErrors,
  MessageOptions,
  MessagePriority,
  MessageTarget,
  ModuleKey,
  PermissionAction,
  SendMessageResult,
  SendTeamMessage,
  TeamFilterOptions,
  TeamGroup,
  TeamPermissions,
  TeamPersonRef,
  TeamQuery,
  TeamRole,
  TeamSort,
  TeamSummary,
  TeamView,
} from '../../../../../mocks/admin-team';

type MemberStatus = Mock.MemberStatus;
type TeamPermissions = Mock.TeamPermissions;

/** The mock's eight, and the database's OWN_RECORDS (the database has no LOCATION scope). */
export type AccessScope = Mock.AccessScope | AdminTeamScope;
export type SaveTeamMember = Omit<Mock.SaveTeamMember, 'scope'> & { scope: AccessScope | '' };
export type MemberFormOptions = Omit<Mock.MemberFormOptions, 'scopes'> & { scopes: AccessScope[] };
/** `changeDepartment`: Change Department's own right on the API (the mock gave it with roles). */
export type TeamCapabilities = Mock.TeamCapabilities & { changeDepartment?: boolean };
export type TeamViewer = Omit<Mock.TeamViewer, 'can'> & { can: TeamCapabilities };
export type AdminTeamMember = Omit<Mock.AdminTeamMember, 'scope' | 'availability'> & {
  scope: AccessScope;
  /** No presence is stored on the API: null. */
  availability: Mock.Availability | null;
  /** The department's code (REVENUE_SALES …) on the API: the title badge's colour. */
  departmentCode?: string;
};
/** `invitationSent`: false while the API sends no invitation on approval (R2's service). */
export type DecidedMember = AdminTeamMember & { invitationSent?: boolean };
/** `unchanged`: people already as asked, counted apart on the API. */
export type BulkResult = Mock.BulkResult & { unchanged?: number };
export type TeamActivityKind =
  Mock.TeamActivityKind | 'ACTIVATED' | 'REPORTS_TO_CHANGED' | 'MAPPED_TO_CEO';
/** `actor` is null for the platform itself (R0's bootstrap). */
export type TeamActivity = Omit<Mock.TeamActivity, 'kind' | 'actor'> & {
  kind: TeamActivityKind;
  actor: Mock.TeamPersonRef | null;
};
export type TeamModule = (typeof MOCK_TEAM_MODULES)[number];
export interface TeamPage {
  items: AdminTeamMember[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------- Constants and labels ----------

export {
  ACCESS_LEVELS,
  accessLevelOf,
  ACTION_REQUIRES,
  ATTACHMENT_RULES,
  AUTHORITY_LEVELS,
  AVAILABILITY,
  blankMember,
  checkMessage,
  MEMBER_STATUSES,
  MESSAGE_CHANNELS,
  MESSAGE_LIMIT,
  MESSAGE_PRIORITIES,
  MODULE_ORDER,
  PERMISSION_ACTIONS,
  samePermissions,
} from '../../../../../mocks/admin-team';

/** The database's seven scopes on the API (OWN_RECORDS, no LOCATION); the mock's eight. */
export const ACCESS_SCOPES: readonly { id: AccessScope; label: string; description: string }[] =
  MOCKED ? MOCK_ACCESS_SCOPES : ADMIN_TEAM_SCOPES;

export const TEAM_ERROR_MESSAGES: Readonly<Record<string, string>> = MOCKED
  ? MOCK_ERROR_MESSAGES
  : ADMIN_TEAM_ERRORS;

/**
 * Add Team Member has no API route yet (R2's admin-invite service, R60-team note 30), so `can.add`
 * is false for everyone: the Add page keeps its form (its submit answers 422) instead of the
 * no-permission line. Turn on with the route.
 */
export const ADD_MEMBER_AVAILABLE = MOCKED;

// ---------- Errors ----------

/** A message written for the screen (a feature not available yet, a check made here). */
class TeamNotice extends ApiRequestError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = 'TeamNotice';
  }
}
const notYet = (message: string) => new TeamNotice(422, 'NOT_SUPPORTED_YET', message);

/** A refusal with a message for each form field it names; the form shows them by the fields. */
class TeamFieldError extends ApiRequestError {
  constructor(
    readonly fields: Mock.MemberFieldErrors,
    from: ApiRequestError,
  ) {
    super(from.status, from.code, from.message, from.requestId, from.retryAfter, from.details);
    this.name = 'TeamFieldError';
  }
}

/** lib/errors' errorMessage; the messages written here read as written. */
export function errorMessage(error: unknown, overrides: Record<string, string> = {}): string {
  if (error instanceof TeamNotice) return error.message;
  return baseErrorMessage(error, overrides);
}

/** The form fields a refusal names (Edit Team Member puts each message by its field). */
export const fieldErrorsOf = (error: unknown): Mock.MemberFieldErrors | undefined =>
  error instanceof TeamFieldError ? error.fields : undefined;

type Field = keyof SaveTeamMember;
/** The request's fields (a 400's `details` path) as the form's. */
const FIELD_PATHS: Readonly<Record<string, Field>> = {
  firstName: 'firstName',
  lastName: 'lastName',
  email: 'email',
  phone: 'phone',
  departmentId: 'departmentId',
  roleId: 'roleId',
  reportsToId: 'reportsToId',
  scope: 'scope',
  customScope: 'scope',
  status: 'status',
  invite: 'invite',
};
/** The database's refusals that belong to one field (note 26). */
const FIELD_CODES: Partial<Record<AdminTeamErrorCode, Field>> = {
  EMAIL_TAKEN: 'email',
  ROLE_NOT_IN_DEPARTMENT: 'roleId',
  SUPERVISOR_INVALID: 'reportsToId',
  SCOPE_CEILING: 'scope',
  CUSTOM_SCOPE_INVALID: 'scope',
  STATUS_NOT_ALLOWED: 'status',
  PHONE_REQUIRED: 'invite',
};

/** An API refusal on form fields as a TeamFieldError; anything else as it was. */
function withFields(error: unknown): unknown {
  if (!(error instanceof ApiRequestError)) return error;
  const fields: Mock.MemberFieldErrors = {};
  for (const detail of error.details ?? []) {
    const field = FIELD_PATHS[detail.path.split('.')[0] ?? ''];
    if (field) fields[field] ??= detail.message;
  }
  const coded = FIELD_CODES[error.code as AdminTeamErrorCode];
  if (coded) fields[coded] ??= ADMIN_TEAM_ERRORS[error.code as AdminTeamErrorCode];
  return Object.keys(fields).length ? new TeamFieldError(fields, error) : error;
}

interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}
interface Checked {
  safeParse(
    value: unknown,
  ): { success: true } | { success: false; error: { issues: readonly Issue[] } };
}

/** The first message of a value's check, or undefined when it passes. */
function issueOf(schema: Checked, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

/** The contract's checks before sending: by the fields they name, else as one message. */
function check(schema: Checked, value: unknown): void {
  const result = schema.safeParse(value);
  if (result.success) return;
  const issues = result.error.issues;
  const first = issues[0]?.message ?? 'Check the details and try again.';
  const details = issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  const error = new ApiRequestError(400, 'VALIDATION_FAILED', first, undefined, undefined, details);
  const fielded = withFields(error);
  throw fielded === error ? new TeamNotice(400, 'VALIDATION_FAILED', first) : fielded;
}

// ---------- Names ----------

const levelOf = (level: AdminTeamLevel) => ADMIN_TEAM_LEVEL_NUMBERS[level] as Mock.AuthorityLevel;

/**
 * The hire waiting for the department head is the mock's Pending Approval (note 8), and so is the
 * database's own Pending Approval, which no route sets.
 */
const statusOut = (status: AdminTeamStatus): MemberStatus =>
  status === 'PENDING_DEPARTMENT_HEAD_APPROVAL' ? 'PENDING_APPROVAL' : status;
const statusesIn = (status: MemberStatus): AdminTeamStatus[] =>
  status === 'PENDING_APPROVAL'
    ? ['PENDING_DEPARTMENT_HEAD_APPROVAL', 'PENDING_APPROVAL']
    : [status];
const statusesOut = (statuses: readonly AdminTeamStatus[]): MemberStatus[] => [
  ...new Set(statuses.map(statusOut)),
];
const settable = (status: string): status is AdminTeamSettableStatus =>
  (AdminTeamSettableStatus.options as readonly string[]).includes(status);
const apiScope = (scope: string): scope is AdminTeamScope =>
  ADMIN_TEAM_SCOPES.some((entry) => entry.id === scope);

/** The table's sort keys. Nobody has a location, so Location sorts by name (the mock's ties). */
const SORTS: Readonly<Record<Mock.TeamSort, AdminTeamSort>> = {
  name: 'NAME',
  department: 'DEPARTMENT',
  jobTitle: 'ROLE',
  accessLevel: 'ACCESS_LEVEL',
  location: 'NAME',
  status: 'STATUS',
  availability: 'LAST_SIGNED_IN',
};

/** A link with an id that is not a member's reads as not found, as the mock answers. */
function memberIdOf(id: string): string {
  if (!AdminTeamMemberId.safeParse(id).success)
    throw new ApiRequestError(404, 'NOT_FOUND', 'Team member not found');
  return id;
}

// ---------- The catalog and the permission grid ----------

let catalog: AdminTeamModule[] | undefined;
let loadingMeta: Promise<AdminTeamMeta> | undefined;

/** meta() once for the calls made together (viewer and filters); the catalog is kept. */
function loadMeta(): Promise<AdminTeamMeta> {
  loadingMeta ??= api.adminTeam.meta().then(
    (meta) => {
      catalog = meta.modules;
      loadingMeta = undefined;
      return meta;
    },
    (error: unknown) => {
      loadingMeta = undefined;
      throw error;
    },
  );
  return loadingMeta;
}
async function loadCatalog(): Promise<AdminTeamModule[]> {
  return catalog ?? (await loadMeta()).modules;
}

const ACTIONS = PERMISSION_ACTIONS.map((entry) => entry.id);
let modulesOf: { from: AdminTeamModule[]; rows: TeamModule[] } | undefined;

/**
 * The permission grid's rows: on the API the catalog's modules with the columns their keys sit in
 * (the Team row has six, Support's four); the mock's before the catalog loads (the form's frame).
 */
export function teamModules(): TeamModule[] {
  if (MOCKED || !catalog) return MOCK_TEAM_MODULES;
  if (modulesOf?.from !== catalog)
    modulesOf = {
      from: catalog,
      rows: catalog.map((row) => ({
        id: row.id,
        label: row.label,
        description: row.description,
        actions: ACTIONS.filter((action) => row.permissions.some((key) => key.action === action)),
      })),
    };
  return modulesOf.rows;
}

/** The grid's value from keys: each key in its module's column. */
function keysToGrid(keys: readonly string[]): TeamPermissions {
  const held = new Set(keys);
  const grid: TeamPermissions = {};
  for (const row of catalog ?? []) {
    const actions = ACTIONS.filter((action) =>
      row.permissions.some((key) => key.action === action && held.has(key.key)),
    );
    if (actions.length) grid[row.id] = actions;
  }
  return grid;
}
/** The keys of the grid's ticked boxes. */
const gridToKeys = (grid: TeamPermissions): string[] =>
  (catalog ?? []).flatMap((row) =>
    row.permissions
      .filter((key) => key.action !== null && grid[row.id]?.includes(key.action))
      .map((key) => key.key),
  );
/** Keys the grid has no box for (team.view_profile, org.view …): kept as they are. */
function offGrid(keys: readonly string[]): string[] {
  const boxes = new Set(
    (catalog ?? []).flatMap((row) =>
      row.permissions.filter((key) => key.action !== null).map((key) => key.key),
    ),
  );
  return keys.filter((key) => !boxes.has(key));
}

// ---------- The form's roles ----------

/** Every role the forms were offered: their templates and default scopes. */
const formRoles = new Map<string, AdminTeamFormRole>();
let executiveDepartmentId: string | null = null;

export const roleById = (id: string): Mock.TeamRole | undefined => {
  if (MOCKED) return mockRoleById(id);
  const role = formRoles.get(id);
  return role
    ? {
        id: role.id,
        departmentId: role.departmentId,
        title: role.title,
        level: levelOf(role.level),
      }
    : undefined;
};

/** The role's standard permissions as the grid shows them. */
export const roleTemplate = (roleId: string): TeamPermissions =>
  MOCKED ? mockRoleTemplate(roleId) : keysToGrid(formRoles.get(roleId)?.template ?? []);

/** The scope loaded with a role: the database's `default_scope_type`; the mock's level rule. */
export function roleDefaultScope(roleId: string): AccessScope | undefined {
  if (!MOCKED) return formRoles.get(roleId)?.defaultScope;
  const role = mockRoleById(roleId);
  return role ? mockDefaultScope(role.level) : undefined;
}

/** A role's template plus the signed-in admin's own access: the most they may grant with it. */
export function grantable(
  roleId: string,
  viewerPermissions: TeamPermissions,
  unrestricted: boolean,
): TeamPermissions {
  if (MOCKED) return mockGrantable(roleId, viewerPermissions, unrestricted);
  const template = roleTemplate(roleId);
  const result: TeamPermissions = {};
  for (const area of teamModules()) {
    const actions = unrestricted
      ? area.actions
      : area.actions.filter(
          (action) =>
            template[area.id]?.includes(action) || viewerPermissions[area.id]?.includes(action),
        );
    if (actions.length) result[area.id] = actions;
  }
  return result;
}

/** Valid supervisors for a role: a higher level, in its department or Executive, or the CEO. */
export function supervisorsFor(
  people: Mock.FormPerson[],
  departmentId: string,
  level: Mock.AuthorityLevel,
): Mock.FormPerson[] {
  if (MOCKED) return mockSupervisorsFor(people, departmentId, level);
  return people.filter(
    (person) =>
      person.level < level &&
      (person.departmentId === departmentId ||
        person.departmentId === executiveDepartmentId ||
        person.level === 1),
  );
}

const FIELDS = CreateAdminTeamMemberRequest.shape;
const JOB_TITLE_FIXED = "The role's title is the job title for now. Clear this field to save.";

/**
 * The form's checks, one message per field. On the API: the contract's rules for names, email and
 * phone (E.164), a role of the chosen department, and no job title of its own (note 4).
 */
export function checkMember(
  input: SaveTeamMember,
  mode: 'create' | 'edit',
): Mock.MemberFieldErrors {
  if (MOCKED) return mockCheckMember(input as Mock.SaveTeamMember, mode);
  const found: Partial<Record<Field, string | undefined>> = {
    firstName: issueOf(FIELDS.firstName, input.firstName),
    lastName: issueOf(FIELDS.lastName, input.lastName),
    phone: issueOf(FIELDS.phone, input.phone),
  };
  if (mode === 'create' && issueOf(FIELDS.email, input.email))
    found.email = 'Enter an email address like name@company.com';
  const role = formRoles.get(input.roleId);
  const title = input.jobTitle.trim();
  if (title && title !== role?.title) found.jobTitle = JOB_TITLE_FIXED;
  if (!input.departmentId) found.departmentId = 'Choose a department';
  if (!input.roleId) found.roleId = 'Choose a role';
  else if (!role || role.departmentId !== input.departmentId)
    found.roleId = 'Choose a role in this department';
  if (!input.scope) found.scope = 'Choose an access scope';
  if (!input.status) found.status = 'Choose a status';
  if (input.invite.sms && !input.phone.trim())
    found.invite = 'Add a phone number to send a text invitation';
  const errors: Mock.MemberFieldErrors = {};
  for (const [field, message] of Object.entries(found) as [Field, string | undefined][])
    if (message) errors[field] = message;
  return errors;
}

/** The edit form's starting values from a member. */
export const memberToSave = (member: AdminTeamMember): SaveTeamMember =>
  MOCKED
    ? mockMemberToSave(member as Mock.AdminTeamMember)
    : {
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        phone: member.phone ?? '',
        jobTitle: member.jobTitle,
        departmentId: member.departmentId,
        roleId: member.roleId,
        reportsToId: member.reportsTo?.id ?? '',
        locationId: '',
        teamId: '',
        scope: member.scope,
        status: member.status,
        permissions: structuredClone(member.permissions),
        invite: { email: false, sms: false },
      };

// ---------- Members ----------

/** The newest read of each member: Edit Team Member's base (what changed, `expectedUpdatedAt`). */
const membersRead = new Map<string, ApiMember>();

/** One member as the screens show them (the catalog is loaded first). */
function memberOut(member: ApiMember): AdminTeamMember {
  membersRead.set(member.id, member);
  const allowed = member.allowed;
  return {
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    name: member.name,
    email: member.email,
    phone: member.phone,
    jobTitle: member.role.title,
    departmentId: member.department.id,
    departmentName: member.department.name,
    departmentCode: member.department.code,
    roleId: member.role.id,
    roleTitle: member.role.title,
    level: levelOf(member.role.level),
    accessLevel: member.accessLevel,
    reportsTo: member.reportsTo,
    locationId: null,
    locationName: null,
    teamId: null,
    teamName: null,
    scope: member.scope,
    permissions: keysToGrid(member.permissions),
    customPermissions: member.customPermissions,
    status: statusOut(member.status),
    availability: null,
    invitedBy: member.invitedBy,
    approvedBy: member.approvedBy,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    lastActiveAt: member.lastSignedInAt,
    isYou: member.isYou,
    allowed: {
      edit: allowed.edit,
      changeRole: allowed.changeRole,
      changeStatus: allowed.changeStatus,
      // Remove from Team is Deactivated: Change Status's right (note 13).
      remove: allowed.changeStatus && member.status !== 'DEACTIVATED',
      approve: allowed.approve,
      resendInvite: allowed.resendInvitation,
      message: allowed.message,
    },
  };
}

/** Everyone the signed-in admin may see (the org chart is small): the message recipients. */
async function everyone(): Promise<ApiMember[]> {
  const people: ApiMember[] = [];
  for (let page = 1; ; page += 1) {
    const result = await api.adminTeam.members({ page, pageSize: 100 });
    people.push(...result.items);
    if (result.page < page || result.page * result.pageSize >= result.total) break;
  }
  for (const person of people) membersRead.set(person.id, person);
  return people;
}

/** "Role changed: Account Executive → Sales Manager": the screen joins label and values. */
function activityOut(entry: AdminTeamActivityEntry, memberId: string): TeamActivity {
  const joined = entry.kind !== 'PERMISSIONS_CHANGED' && entry.previousValue && entry.newValue;
  return {
    id: entry.id,
    memberId,
    kind: entry.kind,
    summary: joined ? ADMIN_TEAM_ACTIVITY_LABELS[entry.kind] : adminTeamActivityText(entry),
    previousValue: joined ? entry.previousValue : null,
    newValue: joined ? entry.newValue : null,
    actor: entry.actor,
    approver: entry.approver,
    at: entry.at,
  };
}

/**
 * Edit Team Member's request: only what differs from the member as read. A new role sends its
 * scope and supervisor as the form shows them, and leaves the keys out when the grid is the new
 * role's template, so the API loads the whole template (note 20).
 */
function updateOf(base: ApiMember, body: SaveTeamMember): UpdateAdminTeamMemberRequest {
  const request: UpdateAdminTeamMemberRequest = { expectedUpdatedAt: base.updatedAt };
  if (body.firstName.trim() !== base.firstName) request.firstName = body.firstName;
  if (body.lastName.trim() !== base.lastName) request.lastName = body.lastName;
  if (body.phone.trim() !== (base.phone ?? '')) request.phone = body.phone.trim();
  const roleChanged = body.roleId !== base.role.id;
  if (body.departmentId !== base.department.id) request.departmentId = body.departmentId;
  if (roleChanged || request.departmentId) request.roleId = body.roleId;
  const reportsToId = body.reportsToId || null;
  if (roleChanged || reportsToId !== (base.reportsTo?.id ?? null))
    request.reportsToId = reportsToId;
  if (body.scope && (roleChanged || body.scope !== base.scope)) {
    if (!apiScope(body.scope))
      throw new TeamFieldError(
        { scope: 'Choose an access scope' },
        new ApiRequestError(400, 'VALIDATION_FAILED', 'Choose an access scope'),
      );
    request.scope = body.scope;
  }
  const grid = gridToKeys(body.permissions);
  const kept = adminTeamSamePermissions(grid, gridToKeys(keysToGrid(base.permissions)));
  if (roleChanged) {
    const template = formRoles.get(body.roleId)?.template ?? [];
    if (!adminTeamSamePermissions(grid, gridToKeys(keysToGrid(template))))
      request.permissions = [...grid, ...offGrid(kept ? base.permissions : template)];
  } else if (!kept) request.permissions = [...grid, ...offGrid(base.permissions)];
  if (body.status && body.status !== statusOut(base.status)) {
    if (!settable(body.status))
      throw new TeamFieldError(
        { status: 'Choose a status' },
        new ApiRequestError(400, 'VALIDATION_FAILED', 'Choose a status'),
      );
    request.status = body.status;
  }
  return request;
}

// ---------- Messages ----------

/** Communications' refusal in its own words. */
function commError(error: unknown): unknown {
  if (error instanceof ApiRequestError && error.code in ADMIN_COMM_ERRORS)
    return new TeamNotice(
      error.status,
      error.code,
      ADMIN_COMM_ERRORS[error.code as keyof typeof ADMIN_COMM_ERRORS],
    );
  return error;
}

// ---------- The client ----------

let view: Mock.TeamView = 'card';

const real = {
  viewer: async (): Promise<TeamViewer> => {
    const meta = await loadMeta();
    const { viewer, can } = meta;
    const keys = new Set(viewer.permissions);
    return {
      id: viewer.id,
      name: viewer.name,
      level: viewer.role ? levelOf(viewer.role.level) : 1,
      departmentId: viewer.department?.id ?? '',
      roleTitle: viewer.role?.title ?? '',
      can: {
        add: can.add,
        editMembers: can.edit,
        changeRoles: can.changeRole,
        changeDepartment: can.changeDepartment,
        changeStatus: can.changeStatus,
        remove: can.changeStatus,
        customizePermissions: can.customizePermissions,
        manageGroups: keys.has(ADMIN_TEAM_KEYS.CREATE_GROUP),
        messageCompany: keys.has(ADMIN_TEAM_KEYS.MESSAGE_COMPANY),
        announce:
          keys.has(ADMIN_TEAM_KEYS.ANNOUNCE_COMPANY) ||
          keys.has(ADMIN_TEAM_KEYS.ANNOUNCE_DEPARTMENT),
      },
    };
  },

  summary: async (): Promise<Mock.TeamSummary> => {
    const summary = await api.adminTeam.summary();
    return {
      total: summary.total,
      addedLastMonth: summary.addedLast30Days,
      admins: summary.admins,
      standard: summary.standard,
      active: summary.active,
      inactive: summary.inactive,
    };
  },

  /** The filters' values: no locations or teams are stored. */
  filterOptions: async (): Promise<Mock.TeamFilterOptions> => {
    const { filters } = await loadMeta();
    return {
      departments: filters.departments.map(({ id, name }) => ({ id, name })),
      roles: filters.roles.map(({ id, title }) => ({ id, title })),
      statuses: statusesOut(filters.statuses),
      locations: [],
      teams: [],
      accessLevels: filters.accessLevels,
      supervisors: filters.supervisors,
    };
  },

  members: async (query: Mock.TeamQuery = {}): Promise<TeamPage> => {
    const pageSize = query.pageSize ?? 12;
    // Nobody has a location or a team.
    if (query.locationId || query.teamId) return { items: [], total: 0, page: 1, pageSize };
    await loadCatalog();
    const page = await api.adminTeam.members({
      search: query.search,
      departmentId: query.departmentId,
      roleId: query.roleId,
      statuses: query.status ? statusesIn(query.status) : undefined,
      accessLevel: query.accessLevel,
      reportsToId: query.reportsToId,
      sort: SORTS[query.sort ?? 'name'],
      dir: query.descending ? 'desc' : 'asc',
      page: query.page,
      pageSize,
    });
    return { ...page, items: page.items.map(memberOut) };
  },

  member: async (id: string): Promise<AdminTeamMember> => {
    await loadCatalog();
    return memberOut(await api.adminTeam.member(memberIdOf(id)));
  },

  activity: async (id: string): Promise<TeamActivity[]> =>
    (await api.adminTeam.activity(memberIdOf(id))).map((entry) => activityOut(entry, id)),

  /** Add's choices (and the bulk dialogs'), or Edit's for one person. */
  formOptions: async (memberId?: string): Promise<MemberFormOptions> => {
    const [options] = await Promise.all([
      api.adminTeam.formOptions(memberId === undefined ? undefined : memberIdOf(memberId)),
      loadCatalog(),
    ]);
    for (const role of options.roles) formRoles.set(role.id, role);
    executiveDepartmentId = options.executiveDepartmentId;
    return {
      departments: options.departments.map(({ id, name }) => ({ id, name })),
      departmentLocked: options.departmentLocked,
      roles: options.roles.map((role) => ({
        id: role.id,
        departmentId: role.departmentId,
        title: role.title,
        level: levelOf(role.level),
        needsApproval: role.needsApproval,
      })),
      supervisors: options.supervisors.map((person) => ({
        id: person.id,
        name: person.name,
        roleTitle: person.roleTitle,
        departmentId: person.departmentId,
        level: levelOf(person.level),
      })),
      locations: [],
      teams: [],
      scopes: options.scopes,
      viewerPermissions: keysToGrid(options.ceiling),
      unrestricted: options.unrestricted,
      canCustomize: options.canCustomize,
      // A new member starts as Pending Invitation (note 9); Edit: the status and its moves.
      statuses: memberId === undefined ? ['PENDING_INVITATION'] : statusesOut(options.statuses),
    };
  },

  /** No route yet (note 30): the form's submit shows this. */
  createMember: async (_body: SaveTeamMember): Promise<AdminTeamMember> => {
    throw notYet('Adding team members is not available yet.');
  },

  /** Name and phone answer 400 on their field until R0 lets admin scope save them (note 38). */
  updateMember: async (id: string, body: SaveTeamMember): Promise<AdminTeamMember> => {
    await loadCatalog();
    const base = membersRead.get(id) ?? (await api.adminTeam.member(memberIdOf(id)));
    const request = updateOf(base, body);
    if (Object.keys(request).length === 1) return memberOut(base);
    check(UpdateAdminTeamMemberRequest, request);
    try {
      return memberOut(await api.adminTeam.updateMember(id, request));
    } catch (error) {
      throw withFields(error);
    }
  },

  bulkUpdate: async (memberIds: string[], change: Mock.BulkChange): Promise<BulkResult> => {
    let action: AdminTeamBulkAction;
    if (change.kind === 'department')
      action = { type: 'DEPARTMENT', departmentId: change.departmentId, roleId: change.roleId };
    else if (change.kind === 'role') action = { type: 'ROLE', roleId: change.roleId };
    else if (settable(change.status)) action = { type: 'STATUS', status: change.status };
    else throw new TeamNotice(400, 'VALIDATION_FAILED', 'Choose a status.');
    const body = { ids: memberIds, confirmedCount: memberIds.length, action };
    const result = await api.adminTeam.bulkUpdate(body);
    return {
      updated: result.updated,
      unchanged: result.unchanged,
      skipped: result.skipped.map((entry) => ({
        id: entry.id,
        // Someone outside the signed-in admin's directory has no name here.
        name: entry.name ?? 'one person',
        reason: ADMIN_TEAM_SKIP_REASON_LABELS[entry.reason],
      })),
    };
  },

  /** No route yet (note 30); the menus hide it (`allowed.resendInvitation`). */
  resendInvitation: async (_memberIds: string[]): Promise<{ sent: number }> => {
    throw notYet('Invitations cannot be resent yet.');
  },

  /** The decision sends no invitation yet (note 36): `invitationSent` says so. */
  decideApproval: async (id: string, decision: 'APPROVE' | 'REJECT'): Promise<DecidedMember> => {
    await loadCatalog();
    const result = await api.adminTeam.decideApproval(memberIdOf(id), { decision });
    return { ...memberOut(result.member), invitationSent: result.invitation !== null };
  },

  /** No table keeps it (note 28): the choice lasts while the page is open. */
  viewPreference: async (): Promise<Mock.TeamView> => view,
  setViewPreference: async (next: Mock.TeamView): Promise<Mock.TeamView> => {
    view = next === 'list' ? 'list' : 'card';
    return view;
  },

  /**
   * The recipients from the directory and the rights from the signed-in admin's keys. No
   * locations, teams or custom groups are stored: their lists stay empty.
   */
  messageOptions: async (): Promise<Mock.MessageOptions> => {
    const [meta, people] = await Promise.all([loadMeta(), everyone()]);
    const keys = new Set(meta.viewer.permissions);
    const reachable = people.filter((person) => person.allowed.message);
    return {
      audiences: [
        { id: 'COMPANY', allowed: keys.has(ADMIN_TEAM_KEYS.MESSAGE_COMPANY) },
        { id: 'DEPARTMENT', allowed: keys.has(ADMIN_TEAM_KEYS.MESSAGE_DEPARTMENT) },
        { id: 'LOCATION', allowed: true },
        { id: 'MEMBERS', allowed: true },
        { id: 'GROUP', allowed: true },
      ],
      departments: meta.filters.departments.map(({ id, name }) => ({
        id,
        name,
        memberCount: reachable.filter((person) => person.department.id === id).length,
      })),
      locations: [],
      teams: [],
      members: reachable
        .map((person) => ({
          id: person.id,
          name: person.name,
          jobTitle: person.role.title,
          departmentName: person.department.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      groups: [],
      canAnnounce:
        keys.has(ADMIN_TEAM_KEYS.ANNOUNCE_COMPANY) || keys.has(ADMIN_TEAM_KEYS.ANNOUNCE_DEPARTMENT),
      canCreateGroup: keys.has(ADMIN_TEAM_KEYS.CREATE_GROUP),
    };
  },

  /** No table keeps custom groups (R0's Needs). */
  createGroup: async (_body: Mock.CreateTeamGroup): Promise<Mock.TeamGroup> => {
    throw notYet('Custom groups are not available yet.');
  },

  /**
   * A message to one member goes out through Communications (`contact` TEAM): by email and by
   * text, in one thread. In-app delivery has no route: it counts as unavailable. Anything the
   * Communications message has no field for is refused rather than dropped.
   */
  sendMessage: async (body: Mock.SendTeamMessage): Promise<Mock.SendMessageResult> => {
    const problem = Object.values(checkMessage(body)).find(Boolean);
    if (problem) throw new TeamNotice(400, 'VALIDATION_FAILED', problem);
    const target =
      body.audience === 'MEMBERS' && body.targets.length === 1 ? body.targets[0] : null;
    if (target?.kind !== 'member')
      throw notYet(
        'Team messages are not available yet. Send to one team member at a time, by email or text message.',
      );
    if (body.announcement) throw notYet('Announcements are not available yet.');
    if (body.attachments.length)
      throw notYet('Attachments cannot be sent to team members yet. Remove the files to send.');
    if (body.priority !== 'NORMAL')
      throw notYet('Message priority cannot be saved yet. Choose Normal to send.');
    if (!body.allowReplies)
      throw notYet('Replies cannot be turned off yet. Allow replies to send.');
    const outward = body.channels.filter((channel) => channel !== 'IN_APP');
    if (outward.length === 0)
      throw notYet(
        'In-app messages to team members are not available yet. Send it by email or text message.',
      );
    const person =
      membersRead.get(target.id) ?? (await api.adminTeam.member(memberIdOf(target.id)));
    if (!person.allowed.message)
      throw new TeamNotice(403, 'FORBIDDEN', ADMIN_TEAM_ERRORS.FORBIDDEN);
    const text = plainText(body.body);
    if (outward.includes('SMS') && person.phone && text.length > ADMIN_COMM_SMS_MAX)
      throw new TeamNotice(
        400,
        'VALIDATION_FAILED',
        `A text message is at most ${ADMIN_COMM_SMS_MAX.toLocaleString('en-US')} characters.`,
      );
    const sent = new Set<Mock.MessageChannel>();
    let first: AdminCommMessage | undefined;
    let failure: unknown;
    for (const channel of outward) {
      if (channel === 'SMS' && !person.phone) continue;
      try {
        const message = await api.adminCommunications.messages.create({
          ...(first
            ? { conversationId: first.conversationId }
            : { contact: { type: 'TEAM' as const, userId: person.id } }),
          channel: channel === 'EMAIL' ? 'EMAIL' : 'SMS',
          ...(channel === 'EMAIL' ? { subject: body.subject.trim() } : {}),
          body: channel === 'EMAIL' ? body.body : text,
          mode: 'SEND',
          idempotencyKey: crypto.randomUUID(),
        });
        first ??= message;
        if (message.status !== 'FAILED') sent.add(channel);
      } catch (error) {
        // No address for this channel: unavailable for them, as the result counts it.
        if (!(error instanceof ApiRequestError && error.code === 'NO_DESTINATION'))
          failure ??= error;
      }
    }
    if (!first)
      throw (
        commError(failure) ??
        new TeamNotice(409, 'NO_DESTINATION', ADMIN_COMM_ERRORS.NO_DESTINATION)
      );
    if (sent.size === 0)
      throw new TeamNotice(
        502,
        'SEND_FAILED',
        'The message could not be delivered. It is in Communications, where you can send it again.',
      );
    return {
      id: first.id,
      recipients: 1,
      channels: body.channels.map((channel) => ({
        channel,
        sent: sent.has(channel) ? 1 : 0,
        unavailable: sent.has(channel) ? 0 : 1,
      })),
      announcement: false,
    };
  },
};

/** What the Team screens call: the API, or the mock in mock mode. */
export const adminTeam: typeof real = MOCKED ? (mockTeam as unknown as typeof real) : real;
