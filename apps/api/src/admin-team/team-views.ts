import {
  ADMIN_TEAM_KEYS,
  ADMIN_TEAM_STATUS_ORDER,
  type AdminTeamAccessLevel,
  type AdminTeamCapabilities,
  type AdminTeamFilterOptions,
  type AdminTeamMember,
  type AdminTeamMemberActions,
  type AdminTeamViewer,
  adminTeamAccessLevel,
  adminTeamNameParts,
} from '@firmivra/types';
import { heldRoleId, type TeamContext } from './team-context.js';
import {
  holds,
  isHr,
  orderKeys,
  type Person,
  reach,
  sameKeys,
  sees,
  statusTargets,
} from './team-rules.js';

// The Team module's answers built from the context (docs/work/R60-team.md, "Team API"): the
// directory's people, one member with what the signed-in member may do with them, the viewer,
// their rights and the filters' values.

/** What the views read beside the org chart: sign-ins and invitation links, from the audit rows. */
export interface MemberExtras {
  /** The newest `auth.signed_in` of each person. */
  signedIn: ReadonlyMap<string, Date>;
  /** The newest `platform_member.invited` of each person: when it went out and expires. */
  invitations: ReadonlyMap<string, { sentAt: Date; expiresAt: Date }>;
}
export const NO_EXTRAS: MemberExtras = { signedIn: new Map(), invitations: new Map() };

/** The people the signed-in member may see, as the org chart has them. */
export const visiblePeople = (ctx: TeamContext): Person[] =>
  [...ctx.chart.people.values()].filter((p) => sees(ctx.actor, ctx.chart, p));

/** Someone the signed-in member may see, or undefined (the route answers 404). */
export function visiblePerson(ctx: TeamContext, id: string): Person | undefined {
  const person = ctx.chart.people.get(id);
  return person && sees(ctx.actor, ctx.chart, person) ? person : undefined;
}

/**
 * The CEO, or the department's ACTIVE Chief Officer, decides a hire waiting for them (the
 * signed-in member's row is ACTIVE, or they would not be signed in to the Team module).
 */
export function canDecide(ctx: TeamContext, target: Person): boolean {
  if (target.status !== 'PENDING_DEPARTMENT_HEAD_APPROVAL') return false;
  if (ctx.actor.unrestricted) return true;
  const me = ctx.actor.person;
  const intended = ctx.members.get(target.id);
  const role = intended ? ctx.roles.get(heldRoleId(intended)) : undefined;
  return (
    me?.level === 'CHIEF_OFFICER' &&
    me.status === 'ACTIVE' &&
    me.departmentId === (role?.departmentId ?? target.departmentId)
  );
}

/** What the signed-in member may do in the Team module. */
export function capabilities(ctx: TeamContext): AdminTeamCapabilities {
  const a = ctx.actor;
  return {
    add: holds(a, ADMIN_TEAM_KEYS.CREATE),
    edit: holds(a, ADMIN_TEAM_KEYS.EDIT),
    changeRole: holds(a, ADMIN_TEAM_KEYS.CHANGE_ROLE),
    changeDepartment: holds(a, ADMIN_TEAM_KEYS.ASSIGN_DEPARTMENT),
    changeStatus: holds(a, ADMIN_TEAM_KEYS.DEACTIVATE),
    customizePermissions: holds(a, ADMIN_TEAM_KEYS.CHANGE_PERMISSIONS),
    // The CEO and the Chief Officers (each for their own department's hires).
    approve: a.unrestricted || a.person?.level === 'CHIEF_OFFICER',
  };
}

/** What the signed-in member may do with one person. */
export function memberActions(ctx: TeamContext, target: Person): AdminTeamMemberActions {
  const a = ctx.actor;
  const ok = reach(a, ctx.chart, target) === 'OK';
  const waiting = target.status === 'PENDING_DEPARTMENT_HEAD_APPROVAL';
  return {
    // Yourself: your name and phone only (every other flag stays false: you never reach yourself).
    edit: target.id === a.id || (ok && holds(a, ADMIN_TEAM_KEYS.EDIT)),
    changeRole: ok && !waiting && holds(a, ADMIN_TEAM_KEYS.CHANGE_ROLE),
    changeDepartment: ok && !waiting && holds(a, ADMIN_TEAM_KEYS.ASSIGN_DEPARTMENT),
    changeStatus:
      ok && holds(a, ADMIN_TEAM_KEYS.DEACTIVATE) && statusTargets(target.status).length > 0,
    customizePermissions: ok && holds(a, ADMIN_TEAM_KEYS.CHANGE_PERMISSIONS),
    approve: canDecide(ctx, target),
    resendInvitation:
      ok && target.status === 'PENDING_INVITATION' && holds(a, ADMIN_TEAM_KEYS.CREATE),
    message: target.id !== a.id && target.status !== 'DEACTIVATED',
  };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** One member as the directory, the profile panel and Edit Team Member show them. */
export function memberView(ctx: TeamContext, id: string, extras: MemberExtras): AdminTeamMember {
  const m = ctx.members.get(id)!;
  const user = ctx.users.get(id)!;
  const person = ctx.chart.people.get(id)!;
  const roleId = heldRoleId(m);
  const role = ctx.roles.get(roleId)!;
  const keys = ctx.keysOf(id);
  const parts = adminTeamNameParts(user.name);
  const invitation = m.status === 'PENDING_INVITATION' ? extras.invitations.get(id) : undefined;
  return {
    id,
    firstName: parts.firstName,
    lastName: parts.lastName,
    name: user.name,
    email: user.email,
    phone: user.phone,
    department: ctx.departmentRef(m.departmentId),
    role: ctx.roleRef(roleId),
    intendedRole:
      m.status === 'PENDING_DEPARTMENT_HEAD_APPROVAL' && m.intendedRoleId
        ? ctx.roleRef(m.intendedRoleId)
        : null,
    accessLevel: adminTeamAccessLevel(role.level),
    reportsTo: ctx.personRef(m.reportsToId),
    scope: m.scope,
    customScope:
      m.scope === 'CUSTOM'
        ? {
            departments: m.scopeIds
              .filter((i) => ctx.departments.has(i))
              .map((i) => ctx.departmentRef(i)),
            members: m.scopeIds
              .filter((i) => ctx.members.has(i))
              .map((i) => ({ id: i, name: ctx.nameOf(i) })),
          }
        : null,
    permissions: orderKeys(keys, ctx.catalogKeys),
    customPermissions: !sameKeys(keys, role.template),
    status: m.status,
    invitedBy: ctx.personRef(m.invitedById),
    approvedBy: ctx.personRef(m.approvedById),
    invitation: invitation
      ? { sentAt: invitation.sentAt.toISOString(), expiresAt: invitation.expiresAt.toISOString() }
      : null,
    lastSignedInAt: iso(extras.signedIn.get(id)),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    isYou: id === ctx.actor.id,
    allowed: memberActions(ctx, person),
  };
}

/** The signed-in member. */
export function viewerOf(ctx: TeamContext): AdminTeamViewer {
  const a = ctx.actor;
  const own = ctx.members.get(a.id);
  return {
    id: a.id,
    name: ctx.nameOf(a.id),
    role: own ? ctx.roleRef(heldRoleId(own)) : null,
    department: own ? ctx.departmentRef(own.departmentId) : null,
    scope: own?.scope ?? 'COMPANY',
    unrestricted: a.unrestricted,
    permissions: orderKeys(own ? ctx.keysOf(a.id) : ctx.catalogKeys, ctx.catalogKeys),
  };
}

const ACCESS_LEVELS: readonly AdminTeamAccessLevel[] = ['SUPER_ADMIN', 'ADMIN', 'STANDARD'];
const byName = <T extends { name: string; id: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** The directory filters' values: only what the signed-in member may see. */
export function filtersOf(ctx: TeamContext, people: readonly Person[]): AdminTeamFilterOptions {
  const everyDepartment = ctx.actor.unrestricted || isHr(ctx.actor);
  const departmentIds = new Set(people.map((p) => p.departmentId));
  const departments = [...ctx.departments.values()]
    .filter((d) => departmentIds.has(d.id) || (everyDepartment && d.isActive))
    .map((d) => ({ id: d.id, code: d.code, name: d.name }))
    .sort(byName);
  const roleIds = new Set(people.map((p) => heldRoleId(ctx.members.get(p.id)!)));
  const roles = [...roleIds]
    .map((id) => ctx.roles.get(id)!)
    .map((r) => ({ id: r.id, title: r.title, departmentId: r.departmentId }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const supervisorIds = new Set(people.flatMap((p) => (p.reportsToId ? [p.reportsToId] : [])));
  return {
    departments,
    roles,
    statuses: [...ADMIN_TEAM_STATUS_ORDER],
    accessLevels: [...ACCESS_LEVELS],
    supervisors: [...supervisorIds].map((id) => ({ id, name: ctx.nameOf(id) })).sort(byName),
  };
}
