import { Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  ADMIN_TEAM_ACTIVITY_ACTIONS,
  ADMIN_TEAM_INACTIVE_STATUSES,
  ADMIN_TEAM_KEYS,
  ADMIN_TEAM_SCOPES,
  ADMIN_TEAM_STATUS_LABELS,
  ADMIN_TEAM_STATUS_ORDER,
  type AdminTeamAccessLevel,
  type AdminTeamActivityEntry,
  type AdminTeamActivityKind,
  type AdminTeamActivityList,
  type AdminTeamActivityQuery,
  type AdminTeamFormOptions,
  type AdminTeamFormRole,
  type AdminTeamMember,
  type AdminTeamMemberPage,
  type AdminTeamMembersQuery,
  type AdminTeamMeta,
  type AdminTeamScope,
  type AdminTeamSort,
  type AdminTeamStatus,
  type AdminTeamSummary,
  adminTeamAccessLevel,
} from '@firmivra/types';
import type { z } from 'zod';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { asTeamError, heldRoleId, loadContext, refuse, type TeamContext } from './team-context.js';
import {
  assignableScopes,
  below,
  byScopeRank,
  departmentAllowed,
  holds,
  levelNumber,
  orderKeys,
  type Person,
  reach,
  roleGate,
  statusTargets,
} from './team-rules.js';
import {
  capabilities,
  filtersOf,
  type MemberExtras,
  memberView,
  viewerOf,
  visiblePeople,
  visiblePerson,
} from './team-views.js';

type Out<S extends z.ZodType> = z.output<S>;

const DAY_MS = 86_400_000;
/** An invitation link lasts 7 days when its row does not say (contract: "A new 7-day link"). */
const INVITATION_DAYS = 7;
const SIGNED_IN = 'auth.signed_in';
const ENTITY = 'platform_member';

/** The newest sign-in and invitation link of each person, from the platform's audit rows. */
export async function extrasFor(
  tx: TxClient,
  ctx: TeamContext,
  ids: string[],
): Promise<MemberExtras> {
  if (ids.length === 0) return { signedIn: new Map(), invitations: new Map() };
  const invited = ids.filter((id) => ctx.members.get(id)?.status === 'PENDING_INVITATION');
  const [signIns, links] = await Promise.all([
    tx.auditLog.groupBy({
      by: ['entityId'],
      where: { action: SIGNED_IN, entityType: 'user', entityId: { in: ids }, businessId: null },
      _max: { createdAt: true },
    }),
    invited.length
      ? tx.auditLog.findMany({
          where: {
            action: ADMIN_TEAM_ACTIVITY_ACTIONS.INVITED,
            entityType: ENTITY,
            entityId: { in: invited },
            businessId: null,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { entityId: true, createdAt: true, metadata: true },
        })
      : Promise.resolve([]),
  ]);
  const signedIn = new Map<string, Date>();
  for (const s of signIns)
    if (s.entityId && s._max.createdAt) signedIn.set(s.entityId, s._max.createdAt);
  const invitations = new Map<string, { sentAt: Date; expiresAt: Date }>();
  for (const l of links) {
    if (!l.entityId || invitations.has(l.entityId)) continue;
    const said = (l.metadata as { expiresAt?: unknown } | null)?.expiresAt;
    const expires = typeof said === 'string' ? Date.parse(said) : Number.NaN;
    invitations.set(l.entityId, {
      sentAt: l.createdAt,
      expiresAt: new Date(
        Number.isFinite(expires) ? expires : l.createdAt.getTime() + INVITATION_DAYS * DAY_MS,
      ),
    });
  }
  return { signedIn, invitations };
}

const ACCESS_RANK: Readonly<Record<AdminTeamAccessLevel, number>> = {
  SUPER_ADMIN: 0,
  ADMIN: 1,
  STANDARD: 2,
};

/** The table's sort value of a member. */
const SORT: Readonly<Record<AdminTeamSort, (m: AdminTeamMember) => string | number>> = {
  NAME: (m) => m.name.toLocaleLowerCase('en-US'),
  DEPARTMENT: (m) => m.department.name.toLocaleLowerCase('en-US'),
  ROLE: (m) => m.role.title.toLocaleLowerCase('en-US'),
  ACCESS_LEVEL: (m) => ACCESS_RANK[m.accessLevel],
  STATUS: (m) => ADMIN_TEAM_STATUS_ORDER.indexOf(m.status),
  ADDED: (m) => Date.parse(m.createdAt),
  // Never signed in sorts after everyone who has.
  LAST_SIGNED_IN: (m) => (m.lastSignedInAt ? Date.parse(m.lastSignedInAt) : -1),
};

/** Sorts members by one key, the name and the id breaking ties. */
export function sortMembers(
  members: readonly AdminTeamMember[],
  sort: AdminTeamSort = 'NAME',
  dir: 'asc' | 'desc' = 'asc',
): AdminTeamMember[] {
  const value = SORT[sort];
  const sign = dir === 'desc' ? -1 : 1;
  const nullsLast = sort === 'LAST_SIGNED_IN';
  return [...members].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (nullsLast && (x === -1) !== (y === -1)) return x === -1 ? 1 : -1;
    const compared =
      typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return sign * compared || a.name.localeCompare(b.name, 'en-US') || a.id.localeCompare(b.id);
  });
}

/** Name, email, phone (and its digits), department, role title or status. */
export function matchesSearch(m: AdminTeamMember, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase('en-US');
  if (!needle) return true;
  return [
    m.name,
    m.email,
    m.phone ?? '',
    (m.phone ?? '').replace(/\D/g, ''),
    m.department.name,
    m.role.title,
    m.intendedRole?.title ?? '',
    ADMIN_TEAM_STATUS_LABELS[m.status],
    m.status,
  ]
    .join(' ')
    .toLocaleLowerCase('en-US')
    .includes(needle);
}

/** The KPI row from the people the signed-in member may see. */
export function summaryOf(
  people: readonly { status: AdminTeamStatus; level: Person['level']; createdAt: Date }[],
  now: number,
): AdminTeamSummary {
  const byStatus = Object.fromEntries(ADMIN_TEAM_STATUS_ORDER.map((s) => [s, 0])) as Record<
    AdminTeamStatus,
    number
  >;
  let admins = 0;
  let added = 0;
  for (const p of people) {
    byStatus[p.status] += 1;
    if (adminTeamAccessLevel(p.level) !== 'STANDARD') admins += 1;
    if (p.createdAt.getTime() >= now - 30 * DAY_MS) added += 1;
  }
  return {
    total: people.length,
    addedLast30Days: added,
    admins,
    standard: people.length - admins,
    active: byStatus.ACTIVE,
    inactive: ADMIN_TEAM_INACTIVE_STATUSES.reduce((n, s) => n + byStatus[s], 0),
    pending:
      byStatus.PENDING_INVITATION +
      byStatus.PENDING_APPROVAL +
      byStatus.PENDING_DEPARTMENT_HEAD_APPROVAL,
    byStatus,
  };
}

const KIND_BY_ACTION = new Map(
  Object.entries(ADMIN_TEAM_ACTIVITY_ACTIONS).map(([k, v]) => [v, k as AdminTeamActivityKind]),
);
const KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SCOPE_LABEL = new Map(ADMIN_TEAM_SCOPES.map((s) => [s.id, s.label]));

type Meta = Record<string, unknown>;
const text = (meta: Meta, key: string): string | null =>
  typeof meta[key] === 'string' ? (meta[key] as string) : null;
const keysIn = (meta: Meta, key: string): string[] =>
  Array.isArray(meta[key])
    ? (meta[key] as unknown[]).filter((k): k is string => typeof k === 'string' && KEY.test(k))
    : [];

/** One audit row as the person's trail shows it, display values resolved from today's catalog. */
export function activityEntry(
  ctx: TeamContext,
  row: {
    id: string;
    action: string;
    createdAt: Date;
    actorUserId: string | null;
    metadata: unknown;
  },
): AdminTeamActivityEntry | null {
  const kind = KIND_BY_ACTION.get(row.action);
  if (!kind) return null;
  const meta = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Meta;
  const role = (id: string | null) => (id ? ctx.roleRef(id).title : null);
  const department = (id: string | null) => (id ? ctx.departmentRef(id).name : null);
  const person = (id: string | null) => (id ? ctx.nameOf(id) : null);
  const status = (code: string | null) =>
    code && code in ADMIN_TEAM_STATUS_LABELS
      ? ADMIN_TEAM_STATUS_LABELS[code as AdminTeamStatus]
      : null;
  const scope = (code: string | null) =>
    code ? (SCOPE_LABEL.get(code as AdminTeamScope) ?? null) : null;
  let previousValue: string | null = null;
  let newValue: string | null = null;
  switch (kind) {
    case 'DEPARTMENT_CHANGED':
      previousValue = department(text(meta, 'from'));
      newValue = department(text(meta, 'to'));
      break;
    case 'ROLE_CHANGED':
      previousValue = role(text(meta, 'from'));
      newValue = role(text(meta, 'to'));
      break;
    case 'REPORTS_TO_CHANGED':
      previousValue = person(text(meta, 'from'));
      newValue = person(text(meta, 'to'));
      break;
    case 'SCOPE_CHANGED':
      previousValue = scope(text(meta, 'from'));
      newValue = scope(text(meta, 'to'));
      break;
    case 'STATUS_CHANGED':
      previousValue = status(text(meta, 'from'));
      newValue = status(text(meta, 'to'));
      break;
    case 'CREATED':
      newValue = role(text(meta, 'roleId'));
      break;
    case 'APPROVED': {
      const intended = text(meta, 'intendedRoleId');
      const final = text(meta, 'roleId');
      previousValue = intended && intended !== final ? role(intended) : null;
      newValue = role(final ?? intended);
      break;
    }
    case 'REJECTED':
      previousValue = role(text(meta, 'intendedRoleId'));
      break;
    default:
      break;
  }
  const actor = row.actorUserId ? ctx.personRef(row.actorUserId) : null;
  const reason = text(meta, 'reason');
  return {
    id: row.id,
    kind,
    at: row.createdAt.toISOString(),
    actor,
    previousValue,
    newValue,
    granted: kind === 'PERMISSIONS_CHANGED' ? keysIn(meta, 'granted') : [],
    revoked: kind === 'PERMISSIONS_CHANGED' ? keysIn(meta, 'revoked') : [],
    approver: kind === 'APPROVED' || kind === 'REJECTED' ? actor : null,
    reason: kind === 'REJECTED' && reason ? reason.slice(0, 500) : null,
  };
}

/**
 * Super Admin Team reads (R60 on R0's stage A tables), in the Super Admin's admin scope: the
 * signed-in member and the catalog (meta), the KPIs, the directory, one member, their audit trail
 * and the form's choices. Everyone outside the signed-in member's directory is 404.
 */
@Injectable()
export class TeamReadService {
  constructor(private readonly admin: AdminPrisma) {}

  meta(): Promise<AdminTeamMeta> {
    return this.read((_tx, ctx) =>
      Promise.resolve({
        viewer: viewerOf(ctx),
        can: capabilities(ctx),
        modules: ctx.modules,
        filters: filtersOf(ctx, visiblePeople(ctx)),
      }),
    );
  }

  summary(): Promise<AdminTeamSummary> {
    return this.read((_tx, ctx) =>
      Promise.resolve(
        summaryOf(
          visiblePeople(ctx).map((p) => ({
            status: p.status,
            level: p.level,
            createdAt: ctx.members.get(p.id)!.createdAt,
          })),
          ctx.now,
        ),
      ),
    );
  }

  members(q: Out<typeof AdminTeamMembersQuery>): Promise<AdminTeamMemberPage> {
    return this.read(async (tx, ctx) => {
      const people = visiblePeople(ctx);
      const extras = await extrasFor(
        tx,
        ctx,
        people.map((p) => p.id),
      );
      const statuses = q.statuses?.length ? new Set(q.statuses) : null;
      const rows = sortMembers(
        people
          .map((p) => memberView(ctx, p.id, extras))
          .filter(
            (m) =>
              (!q.search || matchesSearch(m, q.search)) &&
              (!q.departmentId || m.department.id === q.departmentId) &&
              (!q.roleId || m.role.id === q.roleId) &&
              (!statuses || statuses.has(m.status)) &&
              (!q.accessLevel || m.accessLevel === q.accessLevel) &&
              (!q.reportsToId || m.reportsTo?.id === q.reportsToId),
          ),
        q.sort,
        q.dir,
      );
      const pageSize = q.pageSize ?? 12;
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      const page = Math.min(q.page ?? 1, pages);
      return {
        items: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
        page,
        pageSize,
      };
    });
  }

  member(id: string): Promise<AdminTeamMember> {
    return this.read(async (tx, ctx) => {
      if (!visiblePerson(ctx, id)) throw refuse('NOT_FOUND');
      return memberView(ctx, id, await extrasFor(tx, ctx, [id]));
    });
  }

  activity(id: string, q: Out<typeof AdminTeamActivityQuery>): Promise<AdminTeamActivityList> {
    return this.read(async (tx, ctx) => {
      if (!visiblePerson(ctx, id)) throw refuse('NOT_FOUND');
      const rows = await tx.auditLog.findMany({
        where: {
          entityType: ENTITY,
          entityId: id,
          businessId: null,
          action: { in: Object.values(ADMIN_TEAM_ACTIVITY_ACTIONS) },
        } satisfies Prisma.AuditLogWhereInput,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit ?? 50,
        select: { id: true, action: true, createdAt: true, actorUserId: true, metadata: true },
      });
      return {
        items: rows.flatMap((r) => {
          const entry = activityEntry(ctx, r);
          return entry ? [entry] : [];
        }),
      };
    });
  }

  /** Add Team Member's and the bulk dialogs' choices, or (with an id) Edit Team Member's. */
  formOptions(memberId?: string): Promise<AdminTeamFormOptions> {
    return this.read((_tx, ctx) => Promise.resolve(formOptionsOf(ctx, memberId)));
  }

  private async read<T>(work: (tx: TxClient, ctx: TeamContext) => Promise<T>): Promise<T> {
    try {
      return await this.admin.transaction(async (tx) =>
        work(tx, await loadContext(tx, this.admin.adminUserId)),
      );
    } catch (error) {
      throw asTeamError(error);
    }
  }
}

/**
 * What the forms may offer the signed-in member (docx §24): departments and roles they may give
 * (on edit, the person's current ones always; never a role that would wait for the department
 * head, which is for hires only), active and invited supervisors highest level first (on edit
 * never the person or anyone below them), the scopes, the ceiling and, on edit, the statuses.
 */
export function formOptionsOf(ctx: TeamContext, memberId?: string): AdminTeamFormOptions {
  const actor = ctx.actor;
  const person = memberId === undefined ? undefined : visiblePerson(ctx, memberId);
  if (memberId !== undefined && !person) throw refuse('NOT_FOUND');
  const current = person ? ctx.members.get(person.id)! : undefined;
  const currentRoleId = current ? heldRoleId(current) : undefined;
  const reachOk = person ? reach(actor, ctx.chart, person) === 'OK' : true;
  const waiting = current?.status === 'PENDING_DEPARTMENT_HEAD_APPROVAL';
  // On edit: other roles only with the keys for them; on Add (and bulk) every role the member may give.
  const otherDepartments =
    !person || (reachOk && !waiting && holds(actor, ADMIN_TEAM_KEYS.ASSIGN_DEPARTMENT));
  const sameDepartment =
    !person || (reachOk && !waiting && holds(actor, ADMIN_TEAM_KEYS.CHANGE_ROLE));
  const departmentOk = (id: string) =>
    ctx.departments.get(id)?.isActive === true &&
    departmentAllowed(actor, id) &&
    (!current || (id === current.departmentId ? sameDepartment : otherDepartments));

  const roles: AdminTeamFormRole[] = [];
  for (const role of ctx.roles.values()) {
    const gate = role.id === currentRoleId ? 'direct' : roleGate(actor, role);
    const offered =
      role.id === currentRoleId ||
      (departmentOk(role.departmentId) && (gate === 'direct' || (!person && gate === 'approval')));
    if (!offered) continue;
    roles.push({
      id: role.id,
      code: role.code,
      departmentId: role.departmentId,
      title: role.title,
      level: role.level,
      defaultScope: role.defaultScope,
      needsApproval: role.id !== currentRoleId && gate === 'approval',
      template: orderKeys(role.template, ctx.catalogKeys),
    });
  }
  roles.sort(
    (a, b) =>
      levelNumber(a.level) - levelNumber(b.level) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
  const departmentIds = new Set(roles.map((r) => r.departmentId));
  if (current) departmentIds.add(current.departmentId);
  const departments = [...ctx.departments.values()]
    .filter((d) => departmentIds.has(d.id))
    .map((d) => ({ id: d.id, code: d.code, name: d.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const excluded = person ? below(ctx.chart, person.id).add(person.id) : new Set<string>();
  const supervisors = visiblePeople(ctx)
    .filter(
      (p) => !excluded.has(p.id) && (p.status === 'ACTIVE' || p.status === 'PENDING_INVITATION'),
    )
    .map((p) => ({
      id: p.id,
      name: ctx.nameOf(p.id),
      roleTitle: ctx.roleRef(heldRoleId(ctx.members.get(p.id)!)).title,
      departmentId: p.departmentId,
      level: p.level,
    }))
    .sort(
      (a, b) =>
        levelNumber(a.level) - levelNumber(b.level) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );

  const scopes: AdminTeamScope[] = byScopeRank([
    ...assignableScopes(actor),
    ...(current ? [current.scope] : []),
  ]);
  const statuses: AdminTeamStatus[] = [];
  if (person && current) {
    const allowed =
      reachOk && holds(actor, ADMIN_TEAM_KEYS.DEACTIVATE)
        ? statusTargets(current.status).filter(
            (s) =>
              s !== 'ACTIVE' ||
              roleGate(
                actor,
                ctx.roles.get(currentRoleId!) ?? { level: 'CEO', departmentId: '' },
              ) === 'direct',
          )
        : [];
    const set = new Set<AdminTeamStatus>([current.status, ...allowed]);
    statuses.push(...ADMIN_TEAM_STATUS_ORDER.filter((s) => set.has(s)));
  }
  return {
    departments,
    departmentLocked: departments.length === 1,
    roles,
    supervisors,
    executiveDepartmentId: ctx.executiveDepartmentId,
    scopes,
    ceiling: orderKeys(actor.unrestricted ? ctx.catalogKeys : actor.keys, ctx.catalogKeys),
    unrestricted: actor.unrestricted,
    canCustomize: holds(actor, ADMIN_TEAM_KEYS.CHANGE_PERMISSIONS),
    statuses,
  };
}
