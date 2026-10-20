import {
  ADMIN_TEAM_ACTION_LABELS,
  ADMIN_TEAM_KEYS,
  ADMIN_TEAM_LEVEL_NUMBERS,
  ADMIN_TEAM_SCOPES,
  type AdminTeamAction,
  type AdminTeamLevel,
  type AdminTeamModule,
  type AdminTeamModuleId,
  type AdminTeamPermission,
  type AdminTeamScope,
  type AdminTeamSettableStatus,
  type AdminTeamStatus,
  adminTeamCatalogKeys,
  adminTeamScopeRank,
  adminTeamSupervisorsFor,
  SUPPORT_PERMISSION_LABELS,
  type SupportPermission,
} from '@firmivra/types';
import { SUPPORT_KEYS } from '../admin-support/support-context.js';

// The Team module's hierarchy rules (docs/work/R60-team.md, "Rules the API enforces"; the
// hierarchy doc §17), as pure functions of the org chart: who sees whom, who reaches whom, which
// role, scope and keys a member may give, which status follows which, and the permission catalog.
// The API checks every one of them again, whatever the screen offered.

/** One person on the org chart, as the rules see them. */
export interface Person {
  id: string;
  /** The level of the role held (a pending hire's: the intended role's). */
  level: AdminTeamLevel;
  departmentId: string;
  roleCode: string;
  scope: AdminTeamScope;
  /** CUSTOM only: the department and user ids the scope covers. */
  scopeIds: readonly string[];
  status: AdminTeamStatus;
  reportsToId: string | null;
}

/** The signed-in member. */
export interface Actor {
  id: string;
  /** Null for a Super Admin with no org-chart row yet (treated as the CEO). */
  person: Person | null;
  /** The CEO, or a Super Admin with no org-chart row: no ceiling. */
  unrestricted: boolean;
  /** Their effective keys (every catalog key when unrestricted). */
  keys: ReadonlySet<string>;
}

export interface OrgChart {
  people: ReadonlyMap<string, Person>;
  /** Direct reports by supervisor id. */
  reports: ReadonlyMap<string, readonly string[]>;
}

export const levelNumber = (level: AdminTeamLevel): number => ADMIN_TEAM_LEVEL_NUMBERS[level];

export function orgChart(people: readonly Person[]): OrgChart {
  const reports = new Map<string, string[]>();
  for (const p of people) {
    if (!p.reportsToId) continue;
    reports.set(p.reportsToId, [...(reports.get(p.reportsToId) ?? []), p.id]);
  }
  return { people: new Map(people.map((p) => [p.id, p])), reports };
}

/** Everyone below this person in the reporting line (they never become their supervisor). */
export function below(chart: OrgChart, id: string): Set<string> {
  const found = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.pop()!;
    for (const next of chart.reports.get(current) ?? []) {
      if (next === id || found.has(next)) continue;
      found.add(next);
      queue.push(next);
    }
  }
  return found;
}

/** The CHRO and the Authorized HR / People Administrator: every department (by role code). */
export const HR_ROLE_CODES: readonly string[] = [
  'HR_PEOPLE_CHRO',
  'HR_PEOPLE_AUTHORIZED_HR_PEOPLE_ADMINISTRATOR',
];
export const EXECUTIVE_DEPARTMENT_CODE = 'EXECUTIVE';

export const isHr = (actor: Actor): boolean =>
  !actor.unrestricted && actor.person !== null && HR_ROLE_CODES.includes(actor.person.roleCode);

/** The signed-in member holds the key (the CEO holds every key). */
export const holds = (actor: Actor, key: string): boolean =>
  actor.unrestricted || actor.keys.has(key);

/**
 * The directory: the CEO, the CHRO and the HR administrator see everyone; others by their scope,
 * with `team.view` (COMPANY everyone; DEPARTMENT and DIVISION their department, the CEO and the
 * Chief Officers; TEAM their supervisor and everyone below them; DIRECT_REPORTS their supervisor
 * and direct reports; OWN_RECORDS their department; CUSTOM the departments and people listed).
 * Everyone sees themselves.
 */
export function sees(actor: Actor, chart: OrgChart, target: Person): boolean {
  if (actor.unrestricted || target.id === actor.id || isHr(actor)) return true;
  const me = actor.person;
  if (!me || !holds(actor, ADMIN_TEAM_KEYS.VIEW)) return false;
  switch (me.scope) {
    case 'COMPANY':
      return true;
    case 'DEPARTMENT':
    case 'DIVISION':
      return (
        target.departmentId === me.departmentId ||
        target.level === 'CEO' ||
        target.level === 'CHIEF_OFFICER'
      );
    case 'OWN_RECORDS':
      return target.departmentId === me.departmentId;
    case 'TEAM':
      return target.id === me.reportsToId || below(chart, me.id).has(target.id);
    case 'DIRECT_REPORTS':
      return target.id === me.reportsToId || target.reportsToId === me.id;
    case 'CUSTOM':
      return me.scopeIds.includes(target.id) || me.scopeIds.includes(target.departmentId);
  }
}

export type Reach = 'OK' | 'SELF' | 'PEER_PROTECTED' | 'DEPARTMENT_NOT_ALLOWED';

/**
 * Who changes whom: never yourself (name and phone only), never a CEO-level member, never a peer
 * or anyone above. The CEO reaches everyone else; HR every level below Chief Officer in any
 * department; others people below them in their own department and directory.
 */
export function reach(actor: Actor, chart: OrgChart, target: Person): Reach {
  if (target.id === actor.id) return 'SELF';
  if (target.level === 'CEO') return 'PEER_PROTECTED';
  if (actor.unrestricted) return 'OK';
  const me = actor.person;
  if (!me || levelNumber(target.level) <= levelNumber(me.level)) return 'PEER_PROTECTED';
  if (isHr(actor))
    return levelNumber(target.level) > levelNumber('CHIEF_OFFICER') ? 'OK' : 'PEER_PROTECTED';
  if (target.departmentId !== me.departmentId || !sees(actor, chart, target))
    return 'DEPARTMENT_NOT_ALLOWED';
  return 'OK';
}

/** May the member give this role: directly, as a hire that waits for the department head, or not. */
export type RoleGate = 'direct' | 'approval' | 'no';

/**
 * No route gives the CEO role. The CEO gives any other role; a Chief Officer VP / Director and
 * below in their department; HR any department, Manager and below directly and VP / Director as
 * a hire that waits for that department's Chief Officer (the CHRO gives HR's own directly); a
 * VP / Director Manager and below in their department; a Manager Lead / Supervisor and
 * Individual Contributor; Leads and Individual Contributors none.
 */
export function roleGate(
  actor: Actor,
  role: { level: AdminTeamLevel; departmentId: string },
): RoleGate {
  if (role.level === 'CEO') return 'no';
  if (actor.unrestricted) return 'direct';
  const me = actor.person;
  if (!me || role.level === 'CHIEF_OFFICER') return 'no';
  if (isHr(actor)) {
    if (levelNumber(role.level) >= levelNumber('MANAGER')) return 'direct';
    return me.level === 'CHIEF_OFFICER' && me.departmentId === role.departmentId
      ? 'direct'
      : 'approval';
  }
  if (role.departmentId !== me.departmentId) return 'no';
  return levelNumber(me.level) <= levelNumber('MANAGER') &&
    levelNumber(role.level) > levelNumber(me.level)
    ? 'direct'
    : 'no';
}

/** The CEO and HR place people in any department; everyone else only in their own. */
export const departmentAllowed = (actor: Actor, departmentId: string): boolean =>
  actor.unrestricted || isHr(actor) || actor.person?.departmentId === departmentId;

const SCOPE_IDS = ADMIN_TEAM_SCOPES.map((s) => s.id);

/** No scope broader than their own; HR DEPARTMENT and narrower; CUSTOM only the CEO. */
export function assignableScopes(actor: Actor): AdminTeamScope[] {
  if (actor.unrestricted) return [...SCOPE_IDS];
  const me = actor.person;
  if (!me) return [];
  const floor = isHr(actor) ? adminTeamScopeRank('DEPARTMENT') : adminTeamScopeRank(me.scope);
  return SCOPE_IDS.filter((s) => s !== 'CUSTOM' && adminTeamScopeRank(s) >= floor);
}

export const byScopeRank = (scopes: Iterable<AdminTeamScope>): AdminTeamScope[] =>
  [...new Set(scopes)].sort((a, b) => adminTeamScopeRank(a) - adminTeamScopeRank(b));

// ---------- Status ----------

const OFF: readonly AdminTeamSettableStatus[] = ['SUSPENDED', 'INACTIVE', 'DEACTIVATED'];
export const PENDING_STATUSES: readonly AdminTeamStatus[] = [
  'PENDING_INVITATION',
  'PENDING_APPROVAL',
  'PENDING_DEPARTMENT_HEAD_APPROVAL',
];

/**
 * The statuses an edit may set from this one. ACTIVE to SUSPENDED, INACTIVE or DEACTIVATED; from
 * those back to ACTIVE (or between them: Remove a suspended person); Pending Invitation (and the
 * database's own Pending Approval) to INACTIVE or DEACTIVATED only; a hire waiting for the
 * department head only through the decision.
 */
export function statusTargets(current: AdminTeamStatus): AdminTeamSettableStatus[] {
  switch (current) {
    case 'ACTIVE':
      return [...OFF];
    case 'SUSPENDED':
    case 'INACTIVE':
    case 'DEACTIVATED':
      return ['ACTIVE', ...OFF.filter((s) => s !== current)];
    case 'PENDING_INVITATION':
    case 'PENDING_APPROVAL':
      return ['INACTIVE', 'DEACTIVATED'];
    case 'PENDING_DEPARTMENT_HEAD_APPROVAL':
      return [];
  }
}

/** Why a status change is refused, or null. */
export function statusProblem(
  current: AdminTeamStatus,
  next: AdminTeamSettableStatus,
): 'PENDING_APPROVAL' | 'STATUS_NOT_ALLOWED' | null {
  if (current === next) return null;
  if (current === 'PENDING_DEPARTMENT_HEAD_APPROVAL') return 'PENDING_APPROVAL';
  return statusTargets(current).includes(next) ? null : 'STATUS_NOT_ALLOWED';
}

/** Back to ACTIVE only with a password; otherwise Pending Invitation (they need a new link). */
export const reactivatedStatus = (
  next: AdminTeamSettableStatus,
  hasPassword: boolean,
): AdminTeamStatus => (next === 'ACTIVE' && !hasPassword ? 'PENDING_INVITATION' : next);

// ---------- Reports To ----------

/**
 * A valid supervisor for a role: active or invited, a higher level, in the role's department or
 * Executive, or the CEO (`adminTeamSupervisorsFor`); never the person or anyone below them.
 */
export function supervisorValid(
  chart: OrgChart,
  supervisorId: string,
  role: { level: AdminTeamLevel; departmentId: string },
  personId: string | null,
  executiveDepartmentId: string | null,
): boolean {
  const supervisor = chart.people.get(supervisorId);
  if (!supervisor || supervisor.id === personId) return false;
  if (supervisor.status !== 'ACTIVE' && supervisor.status !== 'PENDING_INVITATION') return false;
  if (personId && below(chart, personId).has(supervisor.id)) return false;
  return (
    adminTeamSupervisorsFor(
      [
        {
          id: supervisor.id,
          name: '',
          roleTitle: '',
          departmentId: supervisor.departmentId,
          level: supervisor.level,
        },
      ],
      role,
      executiveDepartmentId,
    ).length === 1
  );
}

// ---------- Permission keys ----------

export interface OverrideRow {
  key: string;
  state: 'ALLOW' | 'DENY' | 'INHERIT';
}

/** The role's template with the member's overrides: ALLOW adds a key, DENY takes one away. */
export function effectiveKeys(template: readonly string[], overrides: readonly OverrideRow[]) {
  const keys = new Set(template);
  for (const o of overrides) {
    if (o.state === 'ALLOW') keys.add(o.key);
    else if (o.state === 'DENY') keys.delete(o.key);
  }
  return keys;
}

/** What differs from the template, stored per member: ALLOW for an extra key, DENY for one taken. */
export function overridesFor(
  template: readonly string[],
  desired: Iterable<string>,
): { key: string; state: 'ALLOW' | 'DENY' }[] {
  const want = new Set(desired);
  const base = new Set(template);
  return [
    ...[...want].filter((k) => !base.has(k)).map((key) => ({ key, state: 'ALLOW' as const })),
    ...[...base].filter((k) => !want.has(k)).map((key) => ({ key, state: 'DENY' as const })),
  ].sort((a, b) => a.key.localeCompare(b.key));
}

/** The keys granted and revoked between two sets, each sorted. */
export function keyDiff(before: Iterable<string>, after: Iterable<string>) {
  const old = new Set(before);
  const now = new Set(after);
  return {
    granted: [...now].filter((k) => !old.has(k)).sort(),
    revoked: [...old].filter((k) => !now.has(k)).sort(),
  };
}

export const sameKeys = (a: Iterable<string>, b: Iterable<string>): boolean => {
  const { granted, revoked } = keyDiff(a, b);
  return granted.length === 0 && revoked.length === 0;
};

// ---------- The catalog ----------

/** The sidebar's modules and their grid columns (the screens' catalog, team docx §11). */
const MODULES: readonly {
  id: AdminTeamModuleId;
  label: string;
  description: string;
  actions: readonly AdminTeamAction[];
}[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'View the platform dashboard',
    actions: ['view', 'export'],
  },
  {
    id: 'sales',
    label: 'Sales Center',
    description: 'Access to sales tools and resources',
    actions: ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export', 'manage'],
  },
  {
    id: 'crm',
    label: 'Leads / CRM',
    description: 'View and manage leads and customer data',
    actions: ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export', 'manage'],
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    description: 'Access to pipeline and deal management',
    actions: ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export', 'manage'],
  },
  {
    id: 'team',
    label: 'Team',
    description: 'View members, add users, edit users, change roles',
    actions: [],
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    description: 'View and manage subscriptions',
    actions: ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export', 'manage'],
  },
  {
    id: 'billing',
    label: 'Billing',
    description: 'Access to billing and invoices',
    actions: ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export', 'manage'],
  },
  {
    id: 'support',
    label: 'Support',
    description: 'View and manage support records',
    actions: [],
  },
  {
    id: 'reports',
    label: 'Reports & Analytics',
    description: 'View reports and analytics',
    actions: ['view', 'create', 'edit', 'delete', 'export'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Receive system notifications',
    actions: ['view', 'manage'],
  },
  {
    id: 'audit',
    label: 'Audit & Security',
    description: 'View security logs (limited access)',
    actions: ['view', 'export', 'manage'],
  },
  {
    id: 'settings',
    label: 'System Settings',
    description: 'View and change system configuration',
    actions: ['view', 'edit', 'manage'],
  },
];

/** Granting an action adds the one it needs (create needs view; delete and manage need edit). */
const ACTION_REQUIRES: Partial<Record<AdminTeamAction, AdminTeamAction>> = {
  create: 'view',
  edit: 'view',
  delete: 'edit',
  assign: 'view',
  approve: 'view',
  export: 'view',
  manage: 'edit',
};

/** R0's 17 Team keys: their labels and grid columns (the rest sit under the grid). */
const TEAM_PERMISSIONS: readonly [keyof typeof ADMIN_TEAM_KEYS, string, AdminTeamAction | null][] =
  [
    ['VIEW', 'View team members', 'view'],
    ['CREATE', 'Add team members', 'create'],
    ['EDIT', 'Edit team members', 'edit'],
    ['DEACTIVATE', 'Change status and remove from the team', 'delete'],
    ['CHANGE_ROLE', 'Change roles', 'assign'],
    ['CHANGE_PERMISSIONS', 'Change permissions and access scope', 'manage'],
    ['VIEW_PROFILE', 'View profiles', null],
    ['VIEW_ORG', 'View the org chart', null],
    ['ASSIGN_DEPARTMENT', 'Change department', null],
    ['ASSIGN_TEAM', 'Assign to a team', null],
    ['CREATE_GROUP', 'Create groups', null],
    ['CREATE_ROLE', 'Create roles', null],
    ['ANNOUNCE_COMPANY', 'Announce to the company', null],
    ['ANNOUNCE_DEPARTMENT', 'Announce to the department', null],
    ['MESSAGE_COMPANY', 'Message the company', null],
    ['MESSAGE_DEPARTMENT', 'Message the department', null],
    ['MESSAGE_TEAM', 'Message the team', null],
  ];
/** Team keys that also need `team.edit` (the rest need `team.view`; `team.view` and `org.view` none). */
const TEAM_NEEDS_EDIT = new Set<string>([
  ADMIN_TEAM_KEYS.DEACTIVATE,
  ADMIN_TEAM_KEYS.CHANGE_PERMISSIONS,
]);

/** Support's own keys (the ones its settings write on roles) and their grid columns. */
const SUPPORT_COLUMNS: Partial<Record<SupportPermission, AdminTeamAction>> = {
  VIEW_ALL: 'view',
  ASSIGN: 'assign',
  DELETE: 'delete',
  EDIT_SETTINGS: 'manage',
};

function teamPermissions(): AdminTeamPermission[] {
  return TEAM_PERMISSIONS.map(([name, label, action]) => {
    const key = ADMIN_TEAM_KEYS[name];
    const requires =
      key === ADMIN_TEAM_KEYS.VIEW || key === ADMIN_TEAM_KEYS.VIEW_ORG
        ? []
        : TEAM_NEEDS_EDIT.has(key)
          ? [ADMIN_TEAM_KEYS.EDIT]
          : [ADMIN_TEAM_KEYS.VIEW];
    return { key, label, action, requires };
  });
}

function supportPermissions(): AdminTeamPermission[] {
  return (Object.keys(SUPPORT_KEYS) as SupportPermission[]).map((name) => ({
    key: SUPPORT_KEYS[name],
    label: SUPPORT_PERMISSION_LABELS[name],
    action: SUPPORT_COLUMNS[name] ?? null,
    requires: [],
  }));
}

/**
 * The permission catalog `meta().modules`: the Team row has R0's keys, Support's row Support's
 * own `support.*` keys, the other modules `<module>.<action>` until their modules define keys.
 */
export function teamCatalog(): AdminTeamModule[] {
  return MODULES.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    permissions:
      m.id === 'team'
        ? teamPermissions()
        : m.id === 'support'
          ? supportPermissions()
          : m.actions.map((action) => {
              const needs = ACTION_REQUIRES[action];
              const required =
                needs && m.actions.includes(needs)
                  ? needs
                  : action !== 'view' && m.actions.includes('view')
                    ? 'view'
                    : null;
              return {
                key: `${m.id}.${action}`,
                label: ADMIN_TEAM_ACTION_LABELS[action],
                action,
                requires: required ? [`${m.id}.${required}`] : [],
              };
            }),
  }));
}

/** Keys in catalog order, then any others alphabetically. */
export function orderKeys(keys: Iterable<string>, catalogKeys: readonly string[]): string[] {
  const rank = new Map(catalogKeys.map((k, i) => [k, i]));
  return [...new Set(keys)].sort(
    (a, b) =>
      (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      a.localeCompare(b),
  );
}

export const catalogKeysOf = adminTeamCatalogKeys;
