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
  type CreateAdminTeamMemberRequest,
  type ResendAdminTeamInvitationRequest,
  type UpdateAdminTeamMemberRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import {
  buildContext,
  heldRoleId,
  type MemberRow,
  refuse,
  type TeamContext,
} from './team-context.js';
import type { InviteChannels } from './team-invitation.js';
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

// What Add Team Member, an edit, a bulk change, a resend or the department head's decision would
// do, decided from the context alone (docs/work/R60-team.md, "Team API" and "Team invitations"):
// the hierarchy checks in their order, the row as it will be, the overrides relative to its role
// and one audit entry per kind of change (ids and codes only). The services write the plan in
// the same admin transaction.

type Out<S extends z.ZodType> = z.output<S>;
export type UpdateBody = Out<typeof UpdateAdminTeamMemberRequest>;
export type BulkAction = Out<typeof AdminTeamBulkRequest>['action'];
export type DecisionBody = Out<typeof AdminTeamDecisionRequest>;
export type CreateBody = Out<typeof CreateAdminTeamMemberRequest>;
export type ResendBody = Out<typeof ResendAdminTeamInvitationRequest>;

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

/** A changed name ("First Last", as the API reads it back) or phone (E.164, or null: none). */
export interface ProfileChange {
  name?: string;
  phone?: string | null;
}

export interface Plan {
  id: string;
  before: MemberRow;
  /** The row as it will be, with its overrides relative to its role. */
  after: MemberRow;
  overridesChanged: boolean;
  events: AuditEvent[];
  /** Edit Team Member only: the name and phone saved on the person's login (`users`). */
  profile?: ProfileChange;
}

/** A plan (null: nothing to change), or the contract code that refuses it. */
export type Planned = { plan: Plan | null } | { refused: AdminTeamErrorCode };

const normalName = (name: string) => name.trim().replace(/\s+/g, ' ');

/**
 * Edit Team Member's version, name and phone: 409 CONFLICT when the row changed since
 * `expectedUpdatedAt`; then the name ("First Last", the one field the login holds) and phone that
 * differ from the login's, or null when neither does ("Mary Ann" / "Smith" for "Mary Ann Smith"
 * is the same name). Yourself: always (name and phone are all you may change on your own row).
 * Anyone else: someone you reach (403 PEER_PROTECTED, DEPARTMENT_NOT_ALLOWED), with `team.edit`
 * (403 FORBIDDEN).
 */
export function planProfile(ctx: TeamContext, id: string, body: UpdateBody): ProfileChange | null {
  const m = ctx.members.get(id)!;
  const user = ctx.users.get(id)!;
  if (body.expectedUpdatedAt !== undefined) {
    if (Date.parse(body.expectedUpdatedAt) !== m.updatedAt.getTime()) throw refuse('CONFLICT');
  }
  const change: ProfileChange = {};
  if (body.firstName !== undefined || body.lastName !== undefined) {
    const parts = adminTeamNameParts(user.name);
    const next = normalName(
      `${body.firstName ?? parts.firstName} ${body.lastName ?? parts.lastName}`,
    );
    if (next !== normalName(user.name)) change.name = next;
  }
  if (body.phone !== undefined && (body.phone ?? null) !== (user.phone ?? null))
    change.phone = body.phone ?? null;
  if (change.name === undefined && change.phone === undefined) return null;
  if (id !== ctx.actor.id) {
    const r = reach(ctx.actor, ctx.chart, ctx.chart.people.get(id)!);
    if (r !== 'OK') throw refuse(r === 'SELF' ? 'SELF_CHANGE' : r);
    if (!holds(ctx.actor, KEYS.EDIT)) throw refuse('FORBIDDEN');
  }
  return change;
}

/**
 * The edit's plan with the name and phone added: the login's columns, the member row's version
 * moved on (so `expectedUpdatedAt` covers them, and a Pending Invitation link made before is
 * void), and a `platform_member.profile_updated` entry with the field names only, never the
 * values.
 */
export function withProfile(
  ctx: TeamContext,
  id: string,
  plan: Plan | null,
  profile: ProfileChange,
): Plan {
  const m = ctx.members.get(id)!;
  const base: Plan = plan ?? {
    id,
    before: m,
    after: { ...m, updatedAt: new Date(ctx.now) },
    overridesChanged: false,
    events: [],
  };
  const fields = [
    ...(profile.name !== undefined ? ['name'] : []),
    ...(profile.phone !== undefined ? ['phone'] : []),
  ];
  return {
    ...base,
    profile,
    events: [{ action: ACTIONS.PROFILE_UPDATED, metadata: { fields } }, ...base.events],
  };
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
 * REJECT: Inactive. The invitation (APPROVE's `invite`) is made and sent by the service once the
 * decision is written (TeamInviteService).
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
        // A link is made (its own `.invited` entry) when either channel is chosen.
        invitationSent: body.invite.email || body.invite.sms,
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

/** What Add Team Member writes once checked: the login's details and the org-chart row. */
export interface CreatePlan {
  /** Lower case (the contract's `Email`). */
  email: string;
  /** "First Last", the one name field the login holds. */
  name: string;
  phone: string | null;
  row: {
    roleId: string;
    departmentId: string;
    reportsToId: string | null;
    scope: AdminTeamScope;
    scopeIds: string[];
    status: 'PENDING_INVITATION' | 'PENDING_DEPARTMENT_HEAD_APPROVAL';
    /** The VP / Director role a hire waits for (the same as `roleId`), or null. */
    intendedRoleId: string | null;
  };
  /** What differs from the role's template: ALLOW for an extra key, DENY for one taken away. */
  overrides: { key: string; state: 'ALLOW' | 'DENY' }[];
  /** `platform_member.created`, ids and codes only. */
  created: AuditEvent;
  /** Who the invitation goes to; null sends none (a hire waiting for the department head, or neither chosen). */
  invite: InviteChannels | null;
}

/**
 * Add Team Member, checked in order: `team.create` (403 FORBIDDEN), a role of the chosen open
 * department (422 ROLE_NOT_IN_DEPARTMENT), custom scope ids that exist (422
 * CUSTOM_SCOPE_INVALID), `team.change_permissions` for a scope or keys beyond the role's (403
 * FORBIDDEN), the department (403 DEPARTMENT_NOT_ALLOWED), the role's gate (403 ROLE_CEILING;
 * HR's VP / Director hires wait for the department head), the scope and permission ceilings (403
 * SCOPE_CEILING, 422 UNKNOWN_PERMISSION, 403 PERMISSION_CEILING), a supervisor the caller sees
 * (422 SUPERVISOR_INVALID), and last the email (409 EMAIL_TAKEN for a Super Admin or anyone with
 * an org-chart row). Only ADMIN-pool logins are in the context: a staff or client login with the
 * same email is someone else in another pool, never looked at. An ADMIN-pool login with no
 * org-chart row (a create that failed half-way) is not taken: the service reuses it.
 */
export function planCreate(ctx: TeamContext, body: CreateBody): CreatePlan {
  const actor = ctx.actor;
  if (!holds(actor, KEYS.CREATE)) throw refuse('FORBIDDEN');
  const role = ctx.roles.get(body.roleId);
  const department = ctx.departments.get(body.departmentId);
  if (!role || !department?.isActive || role.departmentId !== department.id)
    throw refuse('ROLE_NOT_IN_DEPARTMENT');

  const scope = body.scope ?? role.defaultScope;
  const custom = body.customScope;
  if (
    custom &&
    (custom.departmentIds.some((d) => !ctx.departments.has(d)) ||
      custom.memberIds.some((u) => !ctx.members.has(u)))
  )
    throw refuse('CUSTOM_SCOPE_INVALID');
  const scopeIds =
    scope === 'CUSTOM' && custom ? [...custom.departmentIds, ...custom.memberIds] : [];
  const scopeGiven = scope !== role.defaultScope || scopeIds.length > 0;
  const keys = new Set(body.permissions ?? role.template);
  const keysGiven = body.permissions !== undefined && !sameKeys(keys, role.template);
  if ((scopeGiven || keysGiven) && !holds(actor, KEYS.CHANGE_PERMISSIONS))
    throw refuse('FORBIDDEN');

  if (!departmentAllowed(actor, department.id)) throw refuse('DEPARTMENT_NOT_ALLOWED');
  const gate = roleGate(actor, role);
  if (gate === 'no') throw refuse('ROLE_CEILING');
  if (
    scopeGiven &&
    (scope === 'CUSTOM'
      ? !actor.unrestricted
      : scope !== role.defaultScope && !assignableScopes(actor).includes(scope))
  )
    throw refuse('SCOPE_CEILING');
  if (keysGiven) {
    const known = new Set([...ctx.catalogKeys, ...role.template]);
    if ([...keys].some((k) => !known.has(k))) throw refuse('UNKNOWN_PERMISSION');
    if (
      !actor.unrestricted &&
      [...keys].some((k) => !role.template.includes(k) && !actor.keys.has(k))
    )
      throw refuse('PERMISSION_CEILING');
  }
  const reportsToId = body.reportsToId ?? null;
  if (
    reportsToId !== null &&
    (!visiblePerson(ctx, reportsToId) ||
      !supervisorValid(ctx.chart, reportsToId, role, null, ctx.executiveDepartmentId))
  )
    throw refuse('SUPERVISOR_INVALID');

  const login = ctx.rows.users.find((u) => u.email === body.email);
  if (
    login &&
    (ctx.rows.members.some((m) => m.userId === login.id) ||
      ctx.rows.admins.some((a) => a.userId === login.id && a.role === 'SUPER_ADMIN'))
  )
    throw refuse('EMAIL_TAKEN');

  const status = gate === 'approval' ? 'PENDING_DEPARTMENT_HEAD_APPROVAL' : 'PENDING_INVITATION';
  const diff = keyDiff(role.template, keys);
  return {
    email: body.email,
    name: normalName(`${body.firstName} ${body.lastName}`),
    phone: body.phone ?? null,
    row: {
      roleId: role.id,
      departmentId: department.id,
      reportsToId,
      scope,
      scopeIds,
      status,
      intendedRoleId: status === 'PENDING_DEPARTMENT_HEAD_APPROVAL' ? role.id : null,
    },
    overrides: keysGiven ? overridesFor(role.template, keys) : [],
    created: {
      action: ACTIONS.CREATED,
      metadata: {
        roleId: role.id,
        departmentId: department.id,
        reportsToId,
        scope,
        ...(scopeIds.length ? { scopeIds } : {}),
        status,
        ...(keysGiven ? diff : {}),
      },
    },
    invite:
      status === 'PENDING_INVITATION' && (body.invite.email || body.invite.sms)
        ? { email: body.invite.email, sms: body.invite.sms && Boolean(body.phone) }
        : null,
  };
}

/**
 * Resend Invitation: who gets a new link. The request needs `team.create` (403 FORBIDDEN); each
 * person is then skipped with a reason (NOT_FOUND outside the directory, without a name; SELF;
 * OUT_OF_REACH; NOT_PENDING_INVITATION). Everyone else gets it by email, and by text when asked
 * and they have a phone (people without one still get the email). The daily caps are the
 * service's (RATE_LIMITED), counted in the database.
 */
export function planResend(
  ctx: TeamContext,
  ids: readonly string[],
): { targets: string[]; skipped: AdminTeamSkipped[] } {
  if (!holds(ctx.actor, KEYS.CREATE)) throw refuse('FORBIDDEN');
  const targets: string[] = [];
  const skipped: AdminTeamSkipped[] = [];
  for (const id of ids) {
    const person = visiblePerson(ctx, id);
    if (!person) {
      skipped.push({ id, name: null, reason: 'NOT_FOUND' });
      continue;
    }
    const skip = (reason: AdminTeamSkipReason) =>
      skipped.push({ id, name: ctx.nameOf(id), reason });
    const r = reach(ctx.actor, ctx.chart, person);
    if (r !== 'OK') skip(r === 'SELF' ? 'SELF' : 'OUT_OF_REACH');
    else if (person.status !== 'PENDING_INVITATION') skip('NOT_PENDING_INVITATION');
    else targets.push(id);
  }
  return { targets, skipped };
}
