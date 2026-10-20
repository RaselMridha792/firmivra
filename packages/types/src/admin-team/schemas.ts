import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { Phone } from '../client-auth/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import { PlatformMemberStatus, PlatformRoleLevel, PlatformScopeType } from '../db-enums.js';

// Super Admin Team (R0 stage A, CREATING_TEAM 20261016_r0: `platform_admins`, `platform_members`,
// `platform_departments`, `platform_role_definitions`, `platform_role_permissions`,
// `platform_member_permission_overrides`; the history in `audit_logs`; notes on this contract in
// docs/work/R60-team.md). Firmivra's own people: the directory (KPIs, cards and table, filters,
// bulk actions, the profile panel), Add Team Member and Edit Team Member.
// Routes: /api/v1/admin/team/... (the Super Admin site's session only).
// A team member is a Super Admin site login (the ADMIN Cognito pool, a `users` row) with a
// `platform_admins` row (SUPER_ADMIN for the CEO level only, TEAM_MEMBER below it) and an org-chart
// row (`platform_members`). Department, role, level, scope and permissions come from these tables
// on every request, never from Cognito. The API enforces the hierarchy (who may add, change or
// approve whom, and what they may grant); the screens only show what `meta`, `formOptions` and each
// member's `allowed` say. Times are ISO with an offset. Responses are plain objects (a field the
// API adds later is dropped); requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const Id = z.uuid();
const count = z.number().int().min(0);

/** A team member's id: their user id (`users.id`, `platform_members.user_id`). */
export const AdminTeamMemberId = Id;
export const AdminTeamDepartmentId = Id;
export const AdminTeamRoleId = Id;

/** Several values in one query parameter: an array in, `a,b` on the wire, an array out. */
const listOf = <T extends z.ZodType>(item: T, max: number) =>
  z
    .preprocess(
      (value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value),
      z.array(item).max(max),
    )
    .optional();

const unique = (values: readonly string[]) => new Set(values).size === values.length;

// ---------- Labels and enums ----------

/** The database's seven statuses (`platform_members.status`). */
export const AdminTeamStatus = PlatformMemberStatus;
export type AdminTeamStatus = z.infer<typeof PlatformMemberStatus>;
export const ADMIN_TEAM_STATUS_LABELS: Readonly<Record<AdminTeamStatus, string>> = {
  PENDING_INVITATION: 'Pending Invitation',
  PENDING_APPROVAL: 'Pending Approval',
  PENDING_DEPARTMENT_HEAD_APPROVAL: 'Pending Department Head Approval',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  INACTIVE: 'Inactive',
  DEACTIVATED: 'Deactivated',
};
/** The Status filter's order and the table's status sort. */
export const ADMIN_TEAM_STATUS_ORDER: readonly AdminTeamStatus[] = [
  'PENDING_INVITATION',
  'PENDING_DEPARTMENT_HEAD_APPROVAL',
  'PENDING_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'INACTIVE',
  'DEACTIVATED',
];
/** Counted as inactive on the KPI card (pending people are neither active nor inactive). */
export const ADMIN_TEAM_INACTIVE_STATUSES: readonly AdminTeamStatus[] = [
  'SUSPENDED',
  'INACTIVE',
  'DEACTIVATED',
];

/**
 * The statuses an edit, the bulk Change Status and Remove from Team may set. Remove from Team is
 * DEACTIVATED: the person keeps their history and can be reactivated. Pending Invitation is left
 * by activating (the person sets their password), Pending Department Head Approval by the
 * decision, never by an edit.
 */
export const AdminTeamSettableStatus = z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE', 'DEACTIVATED']);
export type AdminTeamSettableStatus = z.infer<typeof AdminTeamSettableStatus>;

/** The authority level, stored on the role apart from its title (`platform_role_definitions`). */
export const AdminTeamLevel = PlatformRoleLevel;
export type AdminTeamLevel = z.infer<typeof PlatformRoleLevel>;
export const ADMIN_TEAM_LEVEL_LABELS: Readonly<Record<AdminTeamLevel, string>> = {
  CEO: 'CEO / Owner / Super Admin',
  CHIEF_OFFICER: 'Chief Officer / C-Suite',
  VP_DIRECTOR: 'Vice President / Director',
  MANAGER: 'Manager',
  LEAD_SUPERVISOR: 'Lead / Supervisor',
  INDIVIDUAL_CONTRIBUTOR: 'Individual Contributor / Staff',
};
/** Level 1 is the top (the hierarchy doc's numbering). */
export const ADMIN_TEAM_LEVEL_NUMBERS: Readonly<Record<AdminTeamLevel, number>> = {
  CEO: 1,
  CHIEF_OFFICER: 2,
  VP_DIRECTOR: 3,
  MANAGER: 4,
  LEAD_SUPERVISOR: 5,
  INDIVIDUAL_CONTRIBUTOR: 6,
};

/** The directory's "Permission Level" column, from the authority level. */
export const AdminTeamAccessLevel = z.enum(['SUPER_ADMIN', 'ADMIN', 'STANDARD']);
export type AdminTeamAccessLevel = z.infer<typeof AdminTeamAccessLevel>;
export const ADMIN_TEAM_ACCESS_LEVEL_LABELS: Readonly<Record<AdminTeamAccessLevel, string>> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  STANDARD: 'Standard',
};
/** CEO: Super Admin (their `platform_admins` row is SUPER_ADMIN); Chief Officer to Manager: Admin. */
export const adminTeamAccessLevel = (level: AdminTeamLevel): AdminTeamAccessLevel =>
  level === 'CEO'
    ? 'SUPER_ADMIN'
    : ADMIN_TEAM_LEVEL_NUMBERS[level] <= ADMIN_TEAM_LEVEL_NUMBERS.MANAGER
      ? 'ADMIN'
      : 'STANDARD';

/** Where a member's authority applies (`platform_members.scope_type`), broadest first. */
export const AdminTeamScope = PlatformScopeType;
export type AdminTeamScope = z.infer<typeof PlatformScopeType>;
export const ADMIN_TEAM_SCOPES: readonly {
  id: AdminTeamScope;
  label: string;
  description: string;
}[] = [
  { id: 'COMPANY', label: 'Entire Company', description: 'All departments, teams and people' },
  { id: 'DEPARTMENT', label: 'Department', description: 'Their own department' },
  { id: 'DIVISION', label: 'Division', description: 'A division inside their department' },
  { id: 'TEAM', label: 'Team', description: 'Their assigned team' },
  { id: 'DIRECT_REPORTS', label: 'Direct Reports', description: 'People who report to them' },
  { id: 'OWN_RECORDS', label: 'Own Records Only', description: 'Their own work and profile' },
  { id: 'CUSTOM', label: 'Custom Scope', description: 'Chosen departments or people' },
];
/** 0 is the broadest; nobody gives a scope broader than their own (403 SCOPE_CEILING). */
export const adminTeamScopeRank = (scope: AdminTeamScope): number =>
  ADMIN_TEAM_SCOPES.findIndex((entry) => entry.id === scope);

/** The sidebar's modules (team docx §11): the permission catalog's rows. */
export const AdminTeamModuleId = z.enum([
  'dashboard',
  'sales',
  'crm',
  'pipeline',
  'team',
  'subscriptions',
  'billing',
  'support',
  'reports',
  'notifications',
  'audit',
  'settings',
]);
export type AdminTeamModuleId = z.infer<typeof AdminTeamModuleId>;

/** The granular actions (team docx §12): the Advanced permissions grid's columns. */
export const AdminTeamAction = z.enum([
  'view',
  'create',
  'edit',
  'delete',
  'assign',
  'approve',
  'export',
  'manage',
]);
export type AdminTeamAction = z.infer<typeof AdminTeamAction>;
export const ADMIN_TEAM_ACTION_LABELS: Readonly<Record<AdminTeamAction, string>> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  assign: 'Assign',
  approve: 'Approve',
  export: 'Export',
  manage: 'Manage',
};

/**
 * The Team module's own permission keys: R0's role template (`platform_role_permissions`, the
 * hierarchy doc §15). The API decides every Team action with these and the levels; screens read
 * `meta().can` and each member's `allowed` instead.
 */
export const ADMIN_TEAM_KEYS = {
  VIEW: 'team.view',
  VIEW_PROFILE: 'team.view_profile',
  VIEW_ORG: 'org.view',
  CREATE: 'team.create',
  EDIT: 'team.edit',
  DEACTIVATE: 'team.deactivate',
  ASSIGN_DEPARTMENT: 'team.assign_department',
  ASSIGN_TEAM: 'team.assign_team',
  CHANGE_ROLE: 'team.change_role',
  CHANGE_PERMISSIONS: 'team.change_permissions',
  CREATE_GROUP: 'team.create_group',
  CREATE_ROLE: 'team.create_role',
  ANNOUNCE_COMPANY: 'team.announce_company',
  ANNOUNCE_DEPARTMENT: 'team.announce_department',
  MESSAGE_COMPANY: 'team.message_company',
  MESSAGE_DEPARTMENT: 'team.message_department',
  MESSAGE_TEAM: 'team.message_team',
} as const;

/** A permission key as the database stores it (`module.action`, lower case). */
export const AdminTeamPermissionKey = z
  .string()
  .max(100, 'Choose a permission from the list')
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'Choose a permission from the list');
export type AdminTeamPermissionKey = z.infer<typeof AdminTeamPermissionKey>;

/** A member's or a role's granted keys: each once. */
const PermissionKeys = z
  .array(AdminTeamPermissionKey)
  .max(300, 'Choose at most 300 permissions')
  .refine(unique, 'A permission is chosen twice');

// ---------- References ----------

const Person = z.object({ id: Id, name: z.string() });
export type AdminTeamPersonRef = z.infer<typeof Person>;

/** A platform department; `code` is the same in every environment (e.g. REVENUE_SALES). */
export const AdminTeamDepartmentRef = z.object({ id: Id, code: z.string(), name: z.string() });
export type AdminTeamDepartmentRef = z.infer<typeof AdminTeamDepartmentRef>;

/** A role definition: its title is the member's job title; the level is the authority. */
export const AdminTeamRoleRef = z.object({
  id: Id,
  code: z.string(),
  title: z.string(),
  level: AdminTeamLevel,
});
export type AdminTeamRoleRef = z.infer<typeof AdminTeamRoleRef>;

// ---------- The permission catalog ----------

export const AdminTeamPermission = z.object({
  key: AdminTeamPermissionKey,
  label: z.string(),
  /** The grid column it sits in; null for a key of its own (shown under the grid). */
  action: AdminTeamAction.nullable(),
  /** Keys that granting this one also needs (create needs view): the form adds them. */
  requires: z.array(AdminTeamPermissionKey),
});
export type AdminTeamPermission = z.infer<typeof AdminTeamPermission>;

/** One module and the keys it offers, in display order. */
export const AdminTeamModule = z.object({
  id: AdminTeamModuleId,
  label: z.string(),
  description: z.string(),
  permissions: z.array(AdminTeamPermission),
});
export type AdminTeamModule = z.infer<typeof AdminTeamModule>;

/** Every key in the catalog. */
export const adminTeamCatalogKeys = (modules: readonly AdminTeamModule[]): string[] =>
  modules.flatMap((entry) => entry.permissions.map((permission) => permission.key));

/** True when both grant the same keys. */
export function adminTeamSamePermissions(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((key) => left.has(key));
}

/**
 * The most the signed-in member may grant with a role: the role's template, plus the keys they
 * hold themselves (`formOptions().ceiling`); every key when unrestricted (the CEO). The API checks
 * the same (403 PERMISSION_CEILING).
 */
export function adminTeamGrantable(
  template: readonly string[],
  options: { ceiling: readonly string[]; unrestricted: boolean },
  modules: readonly AdminTeamModule[],
): string[] {
  const allowed = new Set([...template, ...options.ceiling]);
  return adminTeamCatalogKeys(modules).filter((key) => options.unrestricted || allowed.has(key));
}

// ---------- Who is signed in ----------

/** What the signed-in member may do in the Team module (the API decides; screens only hide). */
export const AdminTeamCapabilities = z.object({
  /** Add Team Member (`team.create`). */
  add: z.boolean(),
  /** Edit someone below them (`team.edit`); everyone may edit their own name and phone. */
  edit: z.boolean(),
  /** Change Role (`team.change_role`). */
  changeRole: z.boolean(),
  /** Change Department (`team.assign_department`). */
  changeDepartment: z.boolean(),
  /** Change Status, Suspend, Reactivate and Remove from Team (`team.deactivate`). */
  changeStatus: z.boolean(),
  /** Grant or revoke keys beyond a role's template, and change scope (`team.change_permissions`). */
  customizePermissions: z.boolean(),
  /** Decide VP / Director hires waiting for the department head (the CEO and Chief Officers). */
  approve: z.boolean(),
});
export type AdminTeamCapabilities = z.infer<typeof AdminTeamCapabilities>;

export const AdminTeamViewer = z.object({
  id: Id,
  name: z.string(),
  /** Null for a Super Admin with no org-chart row yet: treated as the CEO. */
  role: AdminTeamRoleRef.nullable(),
  department: AdminTeamDepartmentRef.nullable(),
  scope: AdminTeamScope,
  /** The CEO (or a Super Admin with no org-chart row): no ceiling. */
  unrestricted: z.boolean(),
  /** Their effective keys: the role's template with their own overrides. */
  permissions: z.array(AdminTeamPermissionKey),
});
export type AdminTeamViewer = z.infer<typeof AdminTeamViewer>;

/** The directory filters' values: only what the signed-in member may see. */
export const AdminTeamFilterOptions = z.object({
  departments: z.array(AdminTeamDepartmentRef),
  /** The roles of the people they see, by title. */
  roles: z.array(z.object({ id: Id, title: z.string(), departmentId: Id })),
  statuses: z.array(AdminTeamStatus),
  accessLevels: z.array(AdminTeamAccessLevel),
  /** People someone they see reports to, by name. */
  supervisors: z.array(Person),
});
export type AdminTeamFilterOptions = z.infer<typeof AdminTeamFilterOptions>;

/** The signed-in member, their rights, the permission catalog and the filters. */
export const AdminTeamMeta = z.object({
  viewer: AdminTeamViewer,
  can: AdminTeamCapabilities,
  modules: z.array(AdminTeamModule),
  filters: AdminTeamFilterOptions,
});
export type AdminTeamMeta = z.infer<typeof AdminTeamMeta>;

// ---------- The directory ----------

/** What the signed-in member may do with one person. */
export const AdminTeamMemberActions = z.object({
  /** Open Edit Team Member: someone below them, or themselves (name and phone only). */
  edit: z.boolean(),
  changeRole: z.boolean(),
  changeDepartment: z.boolean(),
  /** Suspend, Reactivate and Remove from Team. */
  changeStatus: z.boolean(),
  customizePermissions: z.boolean(),
  /** Approve or reject their VP / Director role (the department's Chief Officer or the CEO). */
  approve: z.boolean(),
  resendInvitation: z.boolean(),
  /** Not them and not deactivated: a message goes through `api.adminCommunications`. */
  message: z.boolean(),
});
export type AdminTeamMemberActions = z.infer<typeof AdminTeamMemberActions>;

/** CUSTOM scope only: the departments and people it covers (`platform_members.scope_ids`). */
export const AdminTeamCustomScope = z.object({
  departments: z.array(AdminTeamDepartmentRef),
  members: z.array(Person),
});
export type AdminTeamCustomScope = z.infer<typeof AdminTeamCustomScope>;

export const AdminTeamMember = z.object({
  id: Id,
  /** Split from the login's one name field (first word / the rest) until it holds both. */
  firstName: z.string(),
  lastName: z.string(),
  name: z.string(),
  /** Their sign-in: never changed here. */
  email: z.string(),
  /** E.164; null when none. */
  phone: z.string().nullable(),
  department: AdminTeamDepartmentRef,
  /**
   * The role held; its title is the job title. While waiting for the department head, the intended
   * role (it grants nothing until approved).
   */
  role: AdminTeamRoleRef,
  /** PENDING_DEPARTMENT_HEAD_APPROVAL only: the VP / Director role HR entered. */
  intendedRole: AdminTeamRoleRef.nullable(),
  accessLevel: AdminTeamAccessLevel,
  reportsTo: Person.nullable(),
  scope: AdminTeamScope,
  customScope: AdminTeamCustomScope.nullable(),
  /** Effective keys: the role's template with the member's overrides. */
  permissions: z.array(AdminTeamPermissionKey),
  /** The member has overrides ("Custom Permissions Applied"). */
  customPermissions: z.boolean(),
  status: AdminTeamStatus,
  invitedBy: Person.nullable(),
  approvedBy: Person.nullable(),
  /** The newest invitation link while Pending Invitation; null otherwise or before the first. */
  invitation: z.object({ sentAt: DateTime, expiresAt: DateTime }).nullable(),
  /** Their newest sign-in to the Super Admin site; null before the first. */
  lastSignedInAt: DateTime.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
  isYou: z.boolean(),
  allowed: AdminTeamMemberActions,
});
export type AdminTeamMember = z.infer<typeof AdminTeamMember>;

/** The table's sort keys; the default is the name. */
export const AdminTeamSort = z.enum([
  'NAME',
  'DEPARTMENT',
  'ROLE',
  'ACCESS_LEVEL',
  'STATUS',
  'ADDED',
  'LAST_SIGNED_IN',
]);
export type AdminTeamSort = z.infer<typeof AdminTeamSort>;

/** The directory: the people the signed-in member may see, filtered, sorted and paged. */
export const AdminTeamMembersQuery = z.strictObject({
  /** Name, email, phone, department, role title or status. */
  search: SearchText.optional(),
  departmentId: Id.optional(),
  roleId: Id.optional(),
  /** Any of these statuses. */
  statuses: listOf(AdminTeamStatus, 7),
  accessLevel: AdminTeamAccessLevel.optional(),
  /** People who report to this person. */
  reportsToId: Id.optional(),
  sort: AdminTeamSort.optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  /** 12 by default. */
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export type AdminTeamMembersQuery = z.input<typeof AdminTeamMembersQuery>;

export const AdminTeamMemberPage = z.object({
  items: z.array(AdminTeamMember),
  total: count,
  page: count.min(1),
  pageSize: count.min(1),
});
export type AdminTeamMemberPage = z.infer<typeof AdminTeamMemberPage>;

/** The KPI row, counted from the people the signed-in member may see (no filters). */
export const AdminTeamSummary = z.object({
  total: count,
  /** Added in the last 30 days: the "vs. last month" line. */
  addedLast30Days: count,
  /** Super Admin and Admin access levels. */
  admins: count,
  standard: count,
  active: count,
  /** ADMIN_TEAM_INACTIVE_STATUSES. */
  inactive: count,
  /** The three pending statuses. */
  pending: count,
  byStatus: z.record(AdminTeamStatus, count),
});
export type AdminTeamSummary = z.infer<typeof AdminTeamSummary>;

// ---------- The audit trail ----------

/** One kind per audit action the Team API writes (`audit_logs`, entity `platform_member`). */
export const AdminTeamActivityKind = z.enum([
  'CREATED',
  'INVITED',
  'ACTIVATED',
  'PROFILE_UPDATED',
  'DEPARTMENT_CHANGED',
  'ROLE_CHANGED',
  'REPORTS_TO_CHANGED',
  'SCOPE_CHANGED',
  'PERMISSIONS_CHANGED',
  'STATUS_CHANGED',
  'APPROVED',
  'REJECTED',
  'MAPPED_TO_CEO',
]);
export type AdminTeamActivityKind = z.infer<typeof AdminTeamActivityKind>;

/** The audit action each kind reads (`platform_member.mapped_to_ceo` is R0's bootstrap). */
export const ADMIN_TEAM_ACTIVITY_ACTIONS: Readonly<Record<AdminTeamActivityKind, string>> = {
  CREATED: 'platform_member.created',
  INVITED: 'platform_member.invited',
  ACTIVATED: 'platform_member.activated',
  PROFILE_UPDATED: 'platform_member.profile_updated',
  DEPARTMENT_CHANGED: 'platform_member.department_changed',
  ROLE_CHANGED: 'platform_member.role_changed',
  REPORTS_TO_CHANGED: 'platform_member.reports_to_changed',
  SCOPE_CHANGED: 'platform_member.scope_changed',
  PERMISSIONS_CHANGED: 'platform_member.permissions_changed',
  STATUS_CHANGED: 'platform_member.status_changed',
  APPROVED: 'platform_member.approved',
  REJECTED: 'platform_member.rejected',
  MAPPED_TO_CEO: 'platform_member.mapped_to_ceo',
};

export const ADMIN_TEAM_ACTIVITY_LABELS: Readonly<Record<AdminTeamActivityKind, string>> = {
  CREATED: 'Added to the team',
  INVITED: 'Invitation sent',
  ACTIVATED: 'Account activated',
  PROFILE_UPDATED: 'Profile details updated',
  DEPARTMENT_CHANGED: 'Department changed',
  ROLE_CHANGED: 'Role changed',
  REPORTS_TO_CHANGED: 'Supervisor changed',
  SCOPE_CHANGED: 'Access scope changed',
  PERMISSIONS_CHANGED: 'Permissions changed',
  STATUS_CHANGED: 'Status changed',
  APPROVED: 'Role approved',
  REJECTED: 'Role assignment rejected',
  MAPPED_TO_CEO: 'Existing Super Admin mapped to CEO',
};

/** Actor, target (the member), action, previous and new value, time and approver (docx §22). */
export const AdminTeamActivityEntry = z.object({
  id: Id,
  kind: AdminTeamActivityKind,
  at: DateTime,
  /** Null for the platform itself (a bootstrap or a job). */
  actor: Person.nullable(),
  /** Display values at the time: role titles, department names, status labels, a person's name. */
  previousValue: z.string().nullable(),
  newValue: z.string().nullable(),
  /** PERMISSIONS_CHANGED: the keys granted and revoked; empty otherwise. */
  granted: z.array(AdminTeamPermissionKey),
  revoked: z.array(AdminTeamPermissionKey),
  /** APPROVED and REJECTED: who decided. */
  approver: Person.nullable(),
  /** REJECTED: the reason given, if any. */
  reason: z.string().nullable(),
});
export type AdminTeamActivityEntry = z.infer<typeof AdminTeamActivityEntry>;

export const AdminTeamActivityQuery = z.strictObject({
  /** Newest first; 50 by default. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type AdminTeamActivityQuery = z.input<typeof AdminTeamActivityQuery>;

export const AdminTeamActivityList = z.object({ items: z.array(AdminTeamActivityEntry) });
export type AdminTeamActivityList = z.infer<typeof AdminTeamActivityList>;

/** "Role changed: Account Executive → Sales Manager"; "Permissions changed: granted team.create". */
export function adminTeamActivityText(entry: AdminTeamActivityEntry): string {
  const label = ADMIN_TEAM_ACTIVITY_LABELS[entry.kind];
  if (entry.kind === 'PERMISSIONS_CHANGED') {
    const parts = [
      entry.granted.length ? `granted ${entry.granted.join(', ')}` : '',
      entry.revoked.length ? `revoked ${entry.revoked.join(', ')}` : '',
    ].filter(Boolean);
    return parts.length ? `${label}: ${parts.join('; ')}` : label;
  }
  if (entry.previousValue && entry.newValue)
    return `${label}: ${entry.previousValue} → ${entry.newValue}`;
  if (entry.newValue) return `${label}: ${entry.newValue}`;
  return label;
}

// ---------- The form's choices ----------

/** A role the signed-in member may give (the person's current role always shows on edit). */
export const AdminTeamFormRole = z.object({
  id: Id,
  code: z.string(),
  departmentId: Id,
  title: z.string(),
  level: AdminTeamLevel,
  /** Loaded with the role (`default_scope_type`). */
  defaultScope: AdminTeamScope,
  /** HR entering a VP / Director hire: saved as Pending Department Head Approval. */
  needsApproval: z.boolean(),
  /** The role's standard keys, loaded when the role is chosen. */
  template: z.array(AdminTeamPermissionKey),
});
export type AdminTeamFormRole = z.infer<typeof AdminTeamFormRole>;

/** A possible supervisor. */
export const AdminTeamFormPerson = z.object({
  id: Id,
  name: z.string(),
  roleTitle: z.string(),
  departmentId: Id,
  level: AdminTeamLevel,
});
export type AdminTeamFormPerson = z.infer<typeof AdminTeamFormPerson>;

/**
 * What Add Team Member, Edit Team Member and the bulk dialogs may offer the signed-in member:
 * lower levels see fewer departments, roles, scopes and permissions (docx §24).
 */
export const AdminTeamFormOptions = z.object({
  departments: z.array(AdminTeamDepartmentRef),
  /** One department, prefilled and locked (a department manager adding to their own team). */
  departmentLocked: z.boolean(),
  roles: z.array(AdminTeamFormRole),
  /**
   * Active and invited people, highest level first; on edit never the person themselves or anyone
   * who reports to them.
   */
  supervisors: z.array(AdminTeamFormPerson),
  /** Executive's id: its people may supervise any department. */
  executiveDepartmentId: Id.nullable(),
  /** The scopes they may give, broadest first (the person's current one always shows on edit). */
  scopes: z.array(AdminTeamScope),
  /** Their own keys: what they may grant beyond a role's template (every key when unrestricted). */
  ceiling: z.array(AdminTeamPermissionKey),
  unrestricted: z.boolean(),
  /** May change keys beyond the template, and the scope on edit. */
  canCustomize: z.boolean(),
  /** Edit only: the person's status and those they may set now; empty on Add. */
  statuses: z.array(AdminTeamStatus),
});
export type AdminTeamFormOptions = z.infer<typeof AdminTeamFormOptions>;

/**
 * Valid supervisors for a role (docx §8): a higher level, in the role's department or Executive,
 * or the CEO. The API also refuses circular lines (422 SUPERVISOR_INVALID).
 */
export function adminTeamSupervisorsFor(
  people: readonly AdminTeamFormPerson[],
  role: Pick<AdminTeamFormRole, 'departmentId' | 'level'>,
  executiveDepartmentId: string | null,
): AdminTeamFormPerson[] {
  const rank = ADMIN_TEAM_LEVEL_NUMBERS[role.level];
  return people.filter(
    (person) =>
      ADMIN_TEAM_LEVEL_NUMBERS[person.level] < rank &&
      (person.departmentId === role.departmentId ||
        person.departmentId === executiveDepartmentId ||
        person.level === 'CEO'),
  );
}

/** How the login's one name field reads back: the first word, then the rest. */
export function adminTeamNameParts(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const space = trimmed.indexOf(' ');
  return space === -1
    ? { firstName: trimmed, lastName: '' }
    : { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) };
}

// ---------- Changes ----------

const Name = (empty: string) => text(50, 'one', empty);

/** CUSTOM scope only: the departments and people it covers (at most 200 together). */
const CustomScopeInput = z
  .strictObject({
    departmentIds: z.array(Id).max(50).refine(unique, 'A department is chosen twice'),
    memberIds: z.array(Id).max(200).refine(unique, 'A person is chosen twice'),
  })
  .refine((scope) => scope.departmentIds.length + scope.memberIds.length <= 200, {
    message: 'Choose at most 200 departments and people',
    path: ['memberIds'],
  });

/** Who gets the invitation link: email by default; SMS needs a phone. */
const InviteChoice = z
  .strictObject({ email: z.boolean(), sms: z.boolean() })
  .default({ email: true, sms: false });

const CUSTOM_ONLY = {
  message: 'Choose departments or people only for a custom scope',
  path: ['customScope'],
};

/**
 * Add Team Member (docx §4, §19). Creates the person's Super Admin site login (the ADMIN Cognito
 * pool, no password yet, nothing sent by Cognito), their `platform_admins` row (TEAM_MEMBER) and
 * their org-chart row as Pending Invitation, or Pending Department Head Approval when HR enters a
 * VP / Director role (`needsApproval`). Left out: the scope is the role's default, the
 * permissions its template. 409 EMAIL_TAKEN when the email belongs to someone on the team.
 */
export const CreateAdminTeamMemberRequest = z
  .strictObject({
    firstName: Name('Enter a first name'),
    lastName: Name('Enter a last name'),
    email: Email,
    /** E.164 once parsed. Left out, null or '': none. */
    phone: clearable(Phone),
    departmentId: Id,
    /** A role in that department (422 ROLE_NOT_IN_DEPARTMENT). */
    roleId: Id,
    /** null: no direct supervisor. */
    reportsToId: Id.nullable().default(null),
    scope: AdminTeamScope.optional(),
    customScope: CustomScopeInput.optional(),
    /** The full set of keys; the API stores what differs from the template as overrides. */
    permissions: PermissionKeys.optional(),
    /** Ignored while the role waits for the department head: the decision sends it. */
    invite: InviteChoice,
  })
  .refine((body) => body.customScope === undefined || body.scope === 'CUSTOM', CUSTOM_ONLY)
  .refine((body) => !body.invite.sms || Boolean(body.phone), {
    message: 'Add a phone number to send a text invitation',
    path: ['invite'],
  });
export type CreateAdminTeamMemberRequest = z.input<typeof CreateAdminTeamMemberRequest>;

/**
 * Edit Team Member (docx §21). Only the fields given change, and a field equal to its current
 * value is no change, so the whole form can be sent back. A new role (and department, which needs
 * a role in it) loads that role's template and default scope unless `permissions` and `scope` come
 * with it, and drops a supervisor no longer valid. Yourself: name and phone only (403
 * SELF_CHANGE). 409 CONFLICT when the person changed since `expectedUpdatedAt`.
 */
export const UpdateAdminTeamMemberRequest = z
  .strictObject({
    firstName: Name('Enter a first name').optional(),
    lastName: Name('Enter a last name').optional(),
    phone: clearable(Phone),
    departmentId: Id.optional(),
    roleId: Id.optional(),
    reportsToId: Id.nullable().optional(),
    scope: AdminTeamScope.optional(),
    customScope: CustomScopeInput.optional(),
    permissions: PermissionKeys.optional(),
    status: AdminTeamSettableStatus.optional(),
    expectedUpdatedAt: DateTime.optional(),
  })
  .refine(
    (body) =>
      Object.entries(body).some(
        ([key, value]) => key !== 'expectedUpdatedAt' && value !== undefined,
      ),
    'Change at least one thing',
  )
  .refine((body) => body.departmentId === undefined || body.roleId !== undefined, {
    message: 'Choose a role in the new department',
    path: ['roleId'],
  })
  .refine(
    (body) => body.customScope === undefined || body.scope === undefined || body.scope === 'CUSTOM',
    CUSTOM_ONLY,
  );
export type UpdateAdminTeamMemberRequest = z.input<typeof UpdateAdminTeamMemberRequest>;

/** Why a person in a bulk change or a resend was left out. */
export const AdminTeamSkipReason = z.enum([
  'NOT_FOUND',
  'SELF',
  'OUT_OF_REACH',
  'ROLE_CEILING',
  'NOT_IN_DEPARTMENT',
  'NEEDS_APPROVAL',
  'PENDING_APPROVAL',
  'STATUS_NOT_ALLOWED',
  'NOT_PENDING_INVITATION',
  'NO_PHONE',
  'RATE_LIMITED',
]);
export type AdminTeamSkipReason = z.infer<typeof AdminTeamSkipReason>;
export const ADMIN_TEAM_SKIP_REASON_LABELS: Readonly<Record<AdminTeamSkipReason, string>> = {
  NOT_FOUND: 'Not found',
  SELF: "You can't change yourself",
  OUT_OF_REACH: 'Outside your authority',
  ROLE_CEILING: 'Role above your authority',
  NOT_IN_DEPARTMENT: 'Not in that role’s department',
  NEEDS_APPROVAL: 'This role needs the department head',
  PENDING_APPROVAL: 'Waiting for the department head',
  STATUS_NOT_ALLOWED: 'Not possible in their status',
  NOT_PENDING_INVITATION: 'Not waiting for an invitation',
  NO_PHONE: 'No phone number',
  RATE_LIMITED: 'Too many invitations today',
};

export const AdminTeamSkipped = z.object({
  id: Id,
  /** Null when the person is not someone the signed-in member may see. */
  name: z.string().nullable(),
  reason: AdminTeamSkipReason,
});
export type AdminTeamSkipped = z.infer<typeof AdminTeamSkipped>;

const SelectedIds = z
  .array(Id)
  .min(1, 'Select one or more team members first.')
  .max(100, 'Select at most 100 team members at a time.')
  .refine(unique, 'A team member is selected twice.');

/**
 * Change Department (with a role in it), Change Role (people of that role's department) or Change
 * Status. A new role resets the person's permissions and scope to the role's template and
 * default. Remove from Team is STATUS DEACTIVATED.
 */
export const AdminTeamBulkAction = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('DEPARTMENT'), departmentId: Id, roleId: Id }),
  z.strictObject({ type: z.literal('ROLE'), roleId: Id }),
  z.strictObject({ type: z.literal('STATUS'), status: AdminTeamSettableStatus }),
]);
export type AdminTeamBulkAction = z.input<typeof AdminTeamBulkAction>;

/** Each person is changed on their own (one audit entry each); people out of reach are skipped. */
export const AdminTeamBulkRequest = z
  .strictObject({
    ids: SelectedIds,
    /** The number of people the admin confirmed. */
    confirmedCount: z.number().int().min(1),
    action: AdminTeamBulkAction,
  })
  .refine((body) => body.confirmedCount === body.ids.length, {
    message: 'Confirm the number of team members again.',
    path: ['confirmedCount'],
  });
export type AdminTeamBulkRequest = z.input<typeof AdminTeamBulkRequest>;

export const AdminTeamBulkResult = z.object({
  updated: count,
  /** Already as asked. */
  unchanged: count,
  skipped: z.array(AdminTeamSkipped),
});
export type AdminTeamBulkResult = z.infer<typeof AdminTeamBulkResult>;

/** A new 7-day link for each person still Pending Invitation; the older links stop working. */
export const ResendAdminTeamInvitationRequest = z.strictObject({
  ids: SelectedIds,
  /** Also by text message, to people with a phone. */
  sms: z.boolean().default(false),
});
export type ResendAdminTeamInvitationRequest = z.input<typeof ResendAdminTeamInvitationRequest>;

export const AdminTeamInvitationResult = z.object({
  /** People whose new link went to the email (and SMS) sender. */
  sent: count,
  skipped: z.array(AdminTeamSkipped),
});
export type AdminTeamInvitationResult = z.infer<typeof AdminTeamInvitationResult>;

/**
 * The department's Chief Officer (or the CEO) decides a VP / Director hire HR entered (hierarchy
 * doc §17 and §18). APPROVE: the intended role, or another VP / Director role in the department
 * (422 ROLE_NOT_ALLOWED), then Pending Invitation and the invitation goes out. REJECT: Inactive.
 * 409 NOT_PENDING_APPROVAL unless the person waits for the department head.
 */
export const AdminTeamDecisionRequest = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('APPROVE'),
    roleId: Id.optional(),
    invite: InviteChoice,
  }),
  z.strictObject({
    decision: z.literal('REJECT'),
    reason: text(500, 'many', 'Add a reason').optional(),
  }),
]);
export type AdminTeamDecisionRequest = z.input<typeof AdminTeamDecisionRequest>;

/** What an invitation sent: the channels it went to and when its link stops working. */
export const AdminTeamInvitationSent = z.object({
  email: z.boolean(),
  sms: z.boolean(),
  expiresAt: DateTime,
});
export type AdminTeamInvitationSent = z.infer<typeof AdminTeamInvitationSent>;

/** Add Team Member and the decision: the person, and the invitation if one went out. */
export const AdminTeamMemberResult = z.object({
  member: AdminTeamMember,
  invitation: AdminTeamInvitationSent.nullable(),
});
export type AdminTeamMemberResult = z.infer<typeof AdminTeamMemberResult>;

// ---------- Errors ----------

export const AdminTeamErrorCode = z.enum([
  'NOT_FOUND',
  'FORBIDDEN',
  'EMAIL_TAKEN',
  'ROLE_CEILING',
  'PERMISSION_CEILING',
  'SCOPE_CEILING',
  'DEPARTMENT_NOT_ALLOWED',
  'SELF_CHANGE',
  'PEER_PROTECTED',
  'ROLE_NOT_IN_DEPARTMENT',
  'ROLE_NOT_ALLOWED',
  'SUPERVISOR_INVALID',
  'UNKNOWN_PERMISSION',
  'CUSTOM_SCOPE_INVALID',
  'STATUS_NOT_ALLOWED',
  'PENDING_APPROVAL',
  'NOT_PENDING_APPROVAL',
  'PHONE_REQUIRED',
  'CONFLICT',
  'RATE_LIMITED',
]);
export type AdminTeamErrorCode = z.infer<typeof AdminTeamErrorCode>;

/** Messages for `errorMessage(error, ADMIN_TEAM_ERRORS)`. */
export const ADMIN_TEAM_ERRORS: Readonly<Record<AdminTeamErrorCode, string>> = {
  NOT_FOUND: "We couldn't find this team member. Refresh to see the latest.",
  FORBIDDEN: "You don't have permission to do this.",
  EMAIL_TAKEN: 'Someone on the team already uses this email address.',
  ROLE_CEILING: "You can't assign this role: it is above your authority.",
  PERMISSION_CEILING: 'You can only grant access that you have yourself.',
  SCOPE_CEILING: "You can't give a wider access scope than your own.",
  DEPARTMENT_NOT_ALLOWED: 'This department is outside your authority.',
  SELF_CHANGE: "You can't change your own role, access or status.",
  PEER_PROTECTED: 'Only someone above this person in the hierarchy can change them.',
  ROLE_NOT_IN_DEPARTMENT: 'Choose a role in this department.',
  ROLE_NOT_ALLOWED: 'Choose a Vice President / Director role in this department.',
  SUPERVISOR_INVALID: 'Choose a supervisor above this role who does not report to this person.',
  UNKNOWN_PERMISSION: 'Choose permissions from the list.',
  CUSTOM_SCOPE_INVALID: 'Choose departments and people from the list for a custom scope.',
  STATUS_NOT_ALLOWED: "That status isn't possible for this person right now.",
  PENDING_APPROVAL: "This person's role is waiting for the department head. Decide it first.",
  NOT_PENDING_APPROVAL: 'This person is not waiting for a role approval.',
  PHONE_REQUIRED: 'Add a phone number to send a text invitation.',
  CONFLICT: 'Someone changed this team member meanwhile. Reload to see the latest.',
  RATE_LIMITED: 'Too many invitations today. Try again tomorrow.',
};
