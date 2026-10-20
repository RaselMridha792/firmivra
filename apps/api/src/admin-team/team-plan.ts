import {
  ADMIN_TEAM_ACTIVITY_ACTIONS as ACTIONS,
  ADMIN_TEAM_KEYS as KEYS,
  type AdminTeamBulkRequest,
  type AdminTeamDecisionRequest,
  type AdminTeamErrorCode,
  type AdminTeamScope,
  type AdminTeamSettableStatus,
  type AdminTeamSkipped,
  type AdminTeamSkipReason,
  type AdminTeamStatus,
  adminTeamNameParts,
  type UpdateAdminTeamMemberRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import {
  buildContext,
  heldRoleId,
  invalid,
  type MemberRow,
  refuse,
  type TeamContext,
} from './team-context.js';
import {
  assignableScopes,
  departmentAllowed,
  holds,
  keyDiff,
  levelNumber,
  overridesFor,
  reach,
  reactivatedStatus,
  roleGate,
  sameKeys,
  statusProblem,
  supervisorValid,
} from './team-rules.js';
import { canDecide, visiblePerson } from './team-views.js';

// What an edit, a bulk change or the department head's decision would do to one member, decided
// from the context alone (docs/work/R60-team.md, "Team API"): the hierarchy checks in their
// order, the row as it will be, the overrides relative to its role and one audit entry per kind
// of change (ids and codes only). The services write the plan in the same admin transaction.

type Out<S extends z.ZodType> = z.output<S>;
export type UpdateBody = Out<typeof UpdateAdminTeamMemberRequest>;
export type BulkAction = Out<typeof AdminTeamBulkRequest>['action'];
export type DecisionBody = Out<typeof AdminTeamDecisionRequest>;

/** The fields of one member a change sets (as Edit Team Member or a bulk action sends them). */
export interface Change {
  departmentId?: string | undefined;
  roleId?: string | undefined;
  reportsToId?: string | null | undefined;
  scope?: AdminTeamScope | undefined;
  customScope?: { departmentIds: string[]; memberIds: string[] } | undefined;
  permissions?: string[] | undefined;
  status?: AdminTeamSettableStatus | undefined;
}

export interface AuditEvent {
  action: string;
  metadata: Record<string, unknown>;
}

export interface Plan {
  id: string;
  before: MemberRow;
  /** The row as it will be, with its overrides relative to its role. */
  after: MemberRow;
  overridesChanged: boolean;
  events: AuditEvent[];
}

/** A plan (null: nothing to change), or the contract code that refuses it. */
export type Planned = { plan: Plan | null } | { refused: AdminTeamErrorCode };

export const NAME_LOCKED =
  'Names and phone numbers of team members cannot be changed here yet. Ask the person to update them.';

const normalName = (name: string) => name.trim().replace(/\s+/g, ' ');

/**
 * Edit Team Member's name and phone and `expectedUpdatedAt`. Names and phones live on the login
 * (`users`), which admin scope may read but not change (R0's users policies), so a value that
 * differs is 400 on its field until R0 lets admin scope write them; the same value is no change.
 */
export function checkProfile(ctx: TeamContext, id: string, body: UpdateBody): void {
  const m = ctx.members.get(id)!;
  const user = ctx.users.get(id)!;
  if (body.expectedUpdatedAt !== undefined) {
    if (Date.parse(body.expectedUpdatedAt) !== m.updatedAt.getTime()) throw refuse('CONFLICT');
  }
  const parts = adminTeamNameParts(user.name);
  if (body.firstName !== undefined || body.lastName !== undefined) {
    const next = normalName(
      `${body.firstName ?? parts.firstName} ${body.lastName ?? parts.lastName}`,
    );
    if (next !== normalName(user.name))
      throw invalid(
        body.firstName !== undefined && body.firstName !== parts.firstName
          ? 'firstName'
          : 'lastName',
        NAME_LOCKED,
      );
  }
  if (body.phone !== undefined && (body.phone ?? null) !== (user.phone ?? null))
    throw invalid('phone', NAME_LOCKED);
}

/**
 * One member's change, checked in order: in the directory (404), the change itself (a role in
 * the chosen department), reach (yourself, a peer or above, a CEO-level member, another
 * department), a hire waiting for the department head, the key each kind of change needs, the
 * role's gate, the scope and permission ceilings, the supervisor and the status rules. A new role
 * loads its template and default scope unless they come with it, and drops a supervisor no longer
 * valid. `hasPassword`: the login can sign in already (reactivation to ACTIVE needs it).
 */
export function planChange(
  ctx: TeamContext,
  id: string,
  change: Change,
  hasPassword: boolean,
): Planned {
  const actor = ctx.actor;
  const person = visiblePerson(ctx, id);
  const m = ctx.members.get(id);
  if (!person || !m) return { refused: 'NOT_FOUND' };
  const heldId = heldRoleId(m);
  const held = ctx.roles.get(heldId)!;

  // ---- What would change ----
  const departmentId = change.departmentId ?? m.departmentId;
  const roleChanged = change.roleId !== undefined && change.roleId !== heldId;
  const departmentChanged = departmentId !== m.departmentId;
  let role = held;
  if (roleChanged || departmentChanged) {
    const next = change.roleId === undefined ? undefined : ctx.roles.get(change.roleId);
    const department = ctx.departments.get(departmentId);
    if (
      !next ||
      !department ||
      next.departmentId !== departmentId ||
      (departmentChanged && !department.isActive)
    )
      return { refused: 'ROLE_NOT_IN_DEPARTMENT' };
    role = next;
  }

  const baseScope = roleChanged ? role.defaultScope : m.scope;
  const scope = change.scope ?? baseScope;
  const custom = change.customScope;
  if (custom && scope !== 'CUSTOM') return { refused: 'CUSTOM_SCOPE_INVALID' };
  if (
    custom &&
    (custom.departmentIds.some((d) => !ctx.departments.has(d)) ||
      custom.memberIds.some((u) => !ctx.members.has(u)))
  )
    return { refused: 'CUSTOM_SCOPE_INVALID' };
  const currentIds = m.scope === 'CUSTOM' ? m.scopeIds : [];
  const scopeIds =
    scope !== 'CUSTOM'
      ? []
      : custom
        ? [...custom.departmentIds, ...custom.memberIds]
        : roleChanged
          ? []
          : [...currentIds];
  const scopeGiven =
    (change.scope !== undefined && change.scope !== baseScope) ||
    (custom !== undefined && !sameKeys(scopeIds, currentIds));

  const currentKeys = ctx.keysOf(id);
  const baseKeys = roleChanged ? new Set(role.template) : currentKeys;
  const keys = change.permissions ? new Set(change.permissions) : baseKeys;
  const keysGiven = change.permissions !== undefined && !sameKeys(keys, baseKeys);
  const reportsGiven = change.reportsToId !== undefined && change.reportsToId !== m.reportsToId;
  const statusChanged = change.status !== undefined && change.status !== m.status;
  if (
    !roleChanged &&
    !departmentChanged &&
    !scopeGiven &&
    !keysGiven &&
    !reportsGiven &&
    !statusChanged
  )
    return { plan: null };

  // ---- Who may ----
  const r = reach(actor, ctx.chart, person);
  if (r === 'SELF') return { refused: 'SELF_CHANGE' };
  if (r !== 'OK') return { refused: r };
  if (
    m.status === 'PENDING_DEPARTMENT_HEAD_APPROVAL' &&
    (roleChanged || departmentChanged || statusChanged)
  )
    return { refused: 'PENDING_APPROVAL' };
  const missing = (needed: boolean, key: string) => needed && !holds(actor, key);
  if (
    missing(departmentChanged, KEYS.ASSIGN_DEPARTMENT) ||
    missing(roleChanged && !departmentChanged, KEYS.CHANGE_ROLE) ||
    missing(reportsGiven, KEYS.EDIT) ||
    missing(statusChanged, KEYS.DEACTIVATE) ||
    missing(scopeGiven || keysGiven, KEYS.CHANGE_PERMISSIONS)
  )
    return { refused: 'FORBIDDEN' };
  if (roleChanged) {
    if (!departmentAllowed(actor, role.departmentId)) return { refused: 'DEPARTMENT_NOT_ALLOWED' };
    // Approval is for hires only: an existing member never waits for the department head.
    if (roleGate(actor, role) !== 'direct') return { refused: 'ROLE_CEILING' };
  }
  if (
    scopeGiven &&
    (scope === 'CUSTOM'
      ? !actor.unrestricted
      : scope !== m.scope && !assignableScopes(actor).includes(scope))
  )
    return { refused: 'SCOPE_CEILING' };
  if (keysGiven) {
    const known = new Set([...ctx.catalogKeys, ...role.template, ...currentKeys]);
    if ([...keys].some((k) => !known.has(k))) return { refused: 'UNKNOWN_PERMISSION' };
    const fresh = [...keys].filter((k) => !role.template.includes(k) && !currentKeys.has(k));
    if (!actor.unrestricted && fresh.some((k) => !actor.keys.has(k)))
      return { refused: 'PERMISSION_CEILING' };
  }
  let reportsToId = m.reportsToId;
  if (reportsGiven) {
    const next = change.reportsToId ?? null;
    if (next !== null && !supervisorValid(ctx.chart, next, role, id, ctx.executiveDepartmentId))
      return { refused: 'SUPERVISOR_INVALID' };
    reportsToId = next;
  } else if (
    roleChanged &&
    reportsToId &&
    !supervisorValid(ctx.chart, reportsToId, role, id, ctx.executiveDepartmentId)
  ) {
    reportsToId = null;
  }
  let status: AdminTeamStatus = m.status;
  if (statusChanged && change.status) {
    const problem = statusProblem(m.status, change.status);
    if (problem) return { refused: problem };
    // Back to ACTIVE only by someone who may give the person's role directly.
    if (change.status === 'ACTIVE' && roleGate(actor, role) !== 'direct')
      return { refused: 'ROLE_CEILING' };
    status = reactivatedStatus(change.status, hasPassword);
  }

  // ---- The row and its audit entries ----
  const events: AuditEvent[] = [];
  if (departmentChanged)
    events.push({
      action: ACTIONS.DEPARTMENT_CHANGED,
      metadata: { from: m.departmentId, to: departmentId },
    });
  if (roleChanged)
    events.push({ action: ACTIONS.ROLE_CHANGED, metadata: { from: heldId, to: role.id } });
  if (reportsToId !== m.reportsToId)
    events.push({
      action: ACTIONS.REPORTS_TO_CHANGED,
      metadata: {
        from: m.reportsToId,
        to: reportsToId,
        ...(reportsGiven ? {} : { cause: 'ROLE_CHANGED' }),
      },
    });
  if (scope !== m.scope || !sameKeys(scopeIds, currentIds))
    events.push({
      action: ACTIONS.SCOPE_CHANGED,
      metadata: { from: m.scope, to: scope, ...(scope === 'CUSTOM' ? { scopeIds } : {}) },
    });
  const diff = keyDiff(currentKeys, keys);
  if (diff.granted.length || diff.revoked.length)
    events.push({ action: ACTIONS.PERMISSIONS_CHANGED, metadata: diff });
  if (status !== m.status)
    events.push({
      action: ACTIONS.STATUS_CHANGED,
      metadata: {
        from: m.status,
        to: status,
        ...(status !== change.status ? { requested: change.status } : {}),
      },
    });
  const overridesChanged = roleChanged || !sameKeys(currentKeys, keys);
  const after: MemberRow = {
    ...m,
    roleId: roleChanged ? role.id : m.roleId,
    departmentId,
    reportsToId,
    scope,
    scopeIds,
    status,
    overrides: overridesChanged ? overridesFor(role.template, keys) : m.overrides,
    updatedAt: new Date(ctx.now),
  };
  return { plan: { id, before: m, after, overridesChanged, events } };
}

/** The skip reason a refusal of one person in a bulk change reads as. */
const SKIP: Partial<Record<AdminTeamErrorCode, AdminTeamSkipReason>> = {
  NOT_FOUND: 'NOT_FOUND',
  SELF_CHANGE: 'SELF',
  PEER_PROTECTED: 'OUT_OF_REACH',
  DEPARTMENT_NOT_ALLOWED: 'OUT_OF_REACH',
  FORBIDDEN: 'OUT_OF_REACH',
  ROLE_CEILING: 'ROLE_CEILING',
  ROLE_NOT_IN_DEPARTMENT: 'NOT_IN_DEPARTMENT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  STATUS_NOT_ALLOWED: 'STATUS_NOT_ALLOWED',
};

export interface BulkPlan {
  plans: Plan[];
  unchanged: number;
  skipped: AdminTeamSkipped[];
}

/** The rows with one member's row replaced, for the next person's checks. */
const withMember = (ctx: TeamContext, row: MemberRow): TeamContext =>
  buildContext(
    { ...ctx.rows, members: ctx.rows.members.map((m) => (m.userId === row.userId ? row : m)) },
    ctx.actor.id,
    ctx.now,
  );

/**
 * Change Department, Role or Status for several people, each on their own: the request's own
 * problems refuse it whole (an unknown role, a role outside the chosen department, a key the
 * member lacks, a department outside their authority); people out of reach are skipped with a
 * reason, and people already as asked counted apart. Highest level first, each person's checks
 * seeing the changes before them (a supervisor changed in the same request).
 */
export function planBulk(
  start: TeamContext,
  ids: readonly string[],
  action: BulkAction,
  passwords: ReadonlySet<string>,
): BulkPlan {
  const actor = start.actor;
  if (action.type === 'STATUS') {
    if (!holds(actor, KEYS.DEACTIVATE)) throw refuse('FORBIDDEN');
  } else {
    const role = start.roles.get(action.roleId);
    if (action.type === 'DEPARTMENT') {
      const department = start.departments.get(action.departmentId);
      if (!role || !department?.isActive || role.departmentId !== department.id)
        throw refuse('ROLE_NOT_IN_DEPARTMENT');
      if (!holds(actor, KEYS.ASSIGN_DEPARTMENT)) throw refuse('FORBIDDEN');
    } else {
      if (!role) throw refuse('ROLE_NOT_IN_DEPARTMENT');
      if (!holds(actor, KEYS.CHANGE_ROLE)) throw refuse('FORBIDDEN');
    }
    if (!departmentAllowed(actor, role.departmentId)) throw refuse('DEPARTMENT_NOT_ALLOWED');
  }

  const level = (id: string) => {
    const p = start.chart.people.get(id);
    return p ? levelNumber(p.level) : Number.MAX_SAFE_INTEGER;
  };
  const order = ids
    .map((id, at) => ({ id, at }))
    .sort((a, b) => level(a.id) - level(b.id) || a.at - b.at);
  const skips = new Map<string, AdminTeamSkipped>();
  const plans: Plan[] = [];
  let unchanged = 0;
  let ctx = start;
  for (const { id } of order) {
    const person = visiblePerson(ctx, id);
    const m = ctx.members.get(id);
    if (!person || !m) {
      skips.set(id, { id, name: null, reason: 'NOT_FOUND' });
      continue;
    }
    const skip = (reason: AdminTeamSkipReason) =>
      skips.set(id, { id, name: ctx.nameOf(id), reason });
    const r = reach(actor, ctx.chart, person);
    if (r !== 'OK') {
      skip(r === 'SELF' ? 'SELF' : 'OUT_OF_REACH');
      continue;
    }
    if (m.status === 'PENDING_DEPARTMENT_HEAD_APPROVAL') {
      skip('PENDING_APPROVAL');
      continue;
    }
    let change: Change;
    if (action.type === 'STATUS') {
      change = { status: action.status };
    } else {
      const role = ctx.roles.get(action.roleId)!;
      if (action.type === 'ROLE' && role.departmentId !== m.departmentId) {
        skip('NOT_IN_DEPARTMENT');
        continue;
      }
      if (heldRoleId(m) === role.id && m.departmentId === role.departmentId) {
        unchanged += 1;
        continue;
      }
      const gate = roleGate(actor, role);
      if (gate !== 'direct') {
        skip(gate === 'approval' ? 'NEEDS_APPROVAL' : 'ROLE_CEILING');
        continue;
      }
      change =
        action.type === 'ROLE'
          ? { roleId: role.id }
          : { departmentId: action.departmentId, roleId: role.id };
    }
    const result = planChange(ctx, id, change, passwords.has(id));
    if ('refused' in result) {
      skip(SKIP[result.refused] ?? 'OUT_OF_REACH');
    } else if (!result.plan) {
      unchanged += 1;
    } else {
      plans.push(result.plan);
      ctx = withMember(ctx, result.plan.after);
    }
  }
  return {
    plans,
    unchanged,
    skipped: ids.flatMap((id) => {
      const s = skips.get(id);
      return s ? [s] : [];
    }),
  };
}

/**
 * The department's Chief Officer (or the CEO) decides a VP / Director hire HR entered. APPROVE:
 * the intended role or another VP / Director role in its department, then Pending Invitation
 * (a new role loads its template and default scope and drops a supervisor no longer valid).
 * REJECT: Inactive. The invitation itself waits for R2's admin-invite service: nothing is sent.
 */
export function planDecision(ctx: TeamContext, id: string, body: DecisionBody): Plan {
  const person = visiblePerson(ctx, id);
  const m = ctx.members.get(id);
  if (!person || !m) throw refuse('NOT_FOUND');
  if (m.status !== 'PENDING_DEPARTMENT_HEAD_APPROVAL' || !m.intendedRoleId)
    throw refuse('NOT_PENDING_APPROVAL');
  if (id === ctx.actor.id) throw refuse('SELF_CHANGE');
  if (!canDecide(ctx, person)) throw refuse('FORBIDDEN');
  const intended = ctx.roles.get(m.intendedRoleId)!;
  const from = m.status;
  if (body.decision === 'REJECT') {
    return {
      id,
      before: m,
      after: {
        ...m,
        roleId: intended.id,
        status: 'INACTIVE',
        intendedRoleId: null,
        updatedAt: new Date(ctx.now),
      },
      overridesChanged: false,
      events: [
        {
          action: ACTIONS.REJECTED,
          metadata: {
            intendedRoleId: intended.id,
            from,
            to: 'INACTIVE',
            reasonGiven: Boolean(body.reason),
          },
        },
      ],
    };
  }
  const role = ctx.roles.get(body.roleId ?? intended.id);
  if (!role || role.level !== 'VP_DIRECTOR' || role.departmentId !== intended.departmentId)
    throw refuse('ROLE_NOT_ALLOWED');
  if (body.invite.sms && !ctx.users.get(id)?.phone) throw refuse('PHONE_REQUIRED');
  const roleChanged = role.id !== intended.id;
  const currentKeys = ctx.keysOf(id);
  const keys = roleChanged ? new Set(role.template) : currentKeys;
  const scope = roleChanged ? role.defaultScope : m.scope;
  const scopeIds = scope === 'CUSTOM' && !roleChanged ? m.scopeIds : [];
  const reportsToId =
    m.reportsToId && supervisorValid(ctx.chart, m.reportsToId, role, id, ctx.executiveDepartmentId)
      ? m.reportsToId
      : null;
  const events: AuditEvent[] = [
    {
      action: ACTIONS.APPROVED,
      metadata: {
        intendedRoleId: intended.id,
        roleId: role.id,
        from,
        to: 'PENDING_INVITATION',
        invite: { email: body.invite.email, sms: body.invite.sms },
        // R2's admin-invite service sends it once it exists (docs/work/R60-team.md, Needs).
        invitationSent: false,
      },
    },
  ];
  if (reportsToId !== m.reportsToId)
    events.push({
      action: ACTIONS.REPORTS_TO_CHANGED,
      metadata: { from: m.reportsToId, to: reportsToId, cause: 'ROLE_CHANGED' },
    });
  if (scope !== m.scope)
    events.push({ action: ACTIONS.SCOPE_CHANGED, metadata: { from: m.scope, to: scope } });
  const diff = keyDiff(currentKeys, keys);
  if (diff.granted.length || diff.revoked.length)
    events.push({ action: ACTIONS.PERMISSIONS_CHANGED, metadata: diff });
  return {
    id,
    before: m,
    after: {
      ...m,
      roleId: role.id,
      departmentId: role.departmentId,
      reportsToId,
      scope,
      scopeIds,
      status: 'PENDING_INVITATION',
      intendedRoleId: null,
      approvedById: ctx.actor.id,
      overrides: roleChanged ? overridesFor(role.template, keys) : m.overrides,
      updatedAt: new Date(ctx.now),
    },
    overridesChanged: roleChanged,
    events,
  };
}
