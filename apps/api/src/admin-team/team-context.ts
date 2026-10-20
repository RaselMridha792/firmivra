import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { databaseErrorCode, type TxClient } from '@firmivra/db';
import {
  ADMIN_TEAM_ERRORS,
  type AdminTeamDepartmentRef,
  type AdminTeamErrorCode,
  type AdminTeamLevel,
  type AdminTeamModule,
  type AdminTeamPersonRef,
  type AdminTeamRoleRef,
  type AdminTeamScope,
  type AdminTeamStatus,
} from '@firmivra/types';
import {
  type Actor,
  catalogKeysOf,
  effectiveKeys,
  EXECUTIVE_DEPARTMENT_CODE,
  type OrgChart,
  orgChart,
  type OverrideRow,
  type Person,
  teamCatalog,
} from './team-rules.js';

// What every Team read and write needs, in the Super Admin's admin scope: the errors, the org
// chart's rows (departments, roles with their templates, members with their overrides, the
// platform admins and their logins) and the signed-in member, built once per request
// (docs/work/R60-team.md, "Team API").

type Status = 400 | 403 | 404 | 409 | 422 | 429;

/** The HTTP status each contract code answers with. */
const STATUS: Readonly<Record<AdminTeamErrorCode, Status>> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  EMAIL_TAKEN: 409,
  ROLE_CEILING: 403,
  PERMISSION_CEILING: 403,
  SCOPE_CEILING: 403,
  DEPARTMENT_NOT_ALLOWED: 403,
  SELF_CHANGE: 403,
  PEER_PROTECTED: 403,
  ROLE_NOT_IN_DEPARTMENT: 422,
  ROLE_NOT_ALLOWED: 422,
  SUPERVISOR_INVALID: 422,
  UNKNOWN_PERMISSION: 422,
  CUSTOM_SCOPE_INVALID: 422,
  STATUS_NOT_ALLOWED: 409,
  PENDING_APPROVAL: 409,
  NOT_PENDING_APPROVAL: 409,
  PHONE_REQUIRED: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
};
export const statusOf = (code: AdminTeamErrorCode): Status => STATUS[code];

/** A contract error with its status and message. */
export function refuse(code: AdminTeamErrorCode, message = ADMIN_TEAM_ERRORS[code]) {
  const body = { code, message };
  switch (STATUS[code]) {
    case 403:
      return new ForbiddenException(body);
    case 404:
      return new NotFoundException(body);
    case 409:
      return new ConflictException(body);
    case 422:
      return new UnprocessableEntityException(body);
    case 429:
      return new HttpException(body, HttpStatus.TOO_MANY_REQUESTS);
    default:
      return new BadRequestException(body);
  }
}

/** 400 VALIDATION_FAILED on one field, as the validation pipe answers. */
export const invalid = (path: string, message: string) =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message, details: [{ path, message }] });

/** The database's own message behind a Prisma error (the pg adapter keeps it), or ''. */
function databaseMessage(error: unknown): string {
  const cause = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta
    ?.driverAdapterError?.cause as { originalMessage?: unknown; message?: unknown } | undefined;
  const message = cause?.originalMessage ?? cause?.message;
  return typeof message === 'string' ? message : '';
}

/** R0's trigger messages on `platform_members` (r0_platform_team_hierarchy) and their codes. */
const TRIGGER_MESSAGES: readonly [string, AdminTeamErrorCode][] = [
  ['a CEO-level member must be a SUPER_ADMIN', 'ROLE_CEILING'],
  ['may only belong to a CEO-level member', 'PEER_PROTECTED'],
];

/**
 * A backstop for a database refusal the checks before it missed: the trigger's rule as its
 * contract code, a unique index or a foreign key as CONFLICT (something changed meanwhile), a
 * row-level security refusal as FORBIDDEN. Anything else is rethrown as it was.
 */
export function asTeamError(error: unknown): unknown {
  if (error instanceof HttpException) return error;
  const sqlState = databaseErrorCode(error);
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (prismaCode === 'P2025') return refuse('NOT_FOUND');
  if (prismaCode === 'P2002' || sqlState === '23505') return refuse('CONFLICT');
  if (prismaCode === 'P2003' || sqlState === '23503') return refuse('CONFLICT');
  if (sqlState === '42501') return refuse('FORBIDDEN');
  if (sqlState === '23514') {
    const message = databaseMessage(error);
    const hit = TRIGGER_MESSAGES.find(([text]) => message.includes(text));
    return hit
      ? refuse(hit[1])
      : new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'The database refused this change',
        });
  }
  return error;
}

// ---------- The rows ----------

export interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
export interface RoleRow {
  id: string;
  code: string;
  title: string;
  level: AdminTeamLevel;
  departmentId: string;
  defaultScope: AdminTeamScope;
  /** The role's ALLOW keys (`platform_role_permissions`). */
  template: string[];
}
export interface MemberRow {
  userId: string;
  roleId: string;
  departmentId: string;
  reportsToId: string | null;
  scope: AdminTeamScope;
  scopeIds: string[];
  status: AdminTeamStatus;
  intendedRoleId: string | null;
  invitedById: string | null;
  approvedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  overrides: OverrideRow[];
}
export interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  cognitoSub: string;
}
export interface AdminRow {
  userId: string;
  role: 'SUPER_ADMIN' | 'TEAM_MEMBER';
}
export interface TeamRows {
  departments: DepartmentRow[];
  roles: RoleRow[];
  members: MemberRow[];
  admins: AdminRow[];
  users: UserRow[];
}

/** The role a member holds; while waiting for the department head, the intended one. */
export const heldRoleId = (m: Pick<MemberRow, 'status' | 'roleId' | 'intendedRoleId'>) =>
  m.status === 'PENDING_DEPARTMENT_HEAD_APPROVAL' && m.intendedRoleId ? m.intendedRoleId : m.roleId;

export interface TeamContext {
  now: number;
  rows: TeamRows;
  actor: Actor;
  chart: OrgChart;
  departments: ReadonlyMap<string, DepartmentRow>;
  roles: ReadonlyMap<string, RoleRow>;
  /** Org-chart rows with a readable login and a known role (the directory's people). */
  members: ReadonlyMap<string, MemberRow>;
  users: ReadonlyMap<string, UserRow>;
  executiveDepartmentId: string | null;
  modules: AdminTeamModule[];
  catalogKeys: string[];
  /** A member's effective keys: their role's template with their overrides. */
  keysOf(memberId: string): Set<string>;
  /** A person's name by user id ("Former team member" when the login is gone). */
  nameOf(userId: string): string;
  personRef(userId: string | null): AdminTeamPersonRef | null;
  departmentRef(id: string): AdminTeamDepartmentRef;
  roleRef(id: string): AdminTeamRoleRef;
}

/**
 * The context from the rows, for the signed-in admin. 403 FORBIDDEN unless they are a platform
 * admin with an ACTIVE org-chart row, or a Super Admin without one yet (treated as the CEO).
 */
export function buildContext(rows: TeamRows, actorId: string, now = Date.now()): TeamContext {
  const departments = new Map(rows.departments.map((d) => [d.id, d]));
  const roles = new Map(rows.roles.map((r) => [r.id, r]));
  const users = new Map(rows.users.map((u) => [u.id, u]));
  const members = new Map(
    rows.members
      .filter((m) => users.has(m.userId) && roles.has(heldRoleId(m)))
      .map((m) => [m.userId, m]),
  );
  const people: Person[] = [...members.values()].map((m) => {
    const role = roles.get(heldRoleId(m))!;
    return {
      id: m.userId,
      level: role.level,
      departmentId: m.departmentId,
      roleCode: role.code,
      scope: m.scope,
      scopeIds: m.scopeIds,
      status: m.status,
      reportsToId: m.reportsToId,
    };
  });
  const chart = orgChart(people);
  const modules = teamCatalog();
  const catalogKeys = catalogKeysOf(modules);
  const keysOf = (memberId: string): Set<string> => {
    const m = members.get(memberId);
    if (!m) return new Set();
    return effectiveKeys(roles.get(heldRoleId(m))?.template ?? [], m.overrides);
  };

  const admin = rows.admins.find((a) => a.userId === actorId);
  if (!admin) throw refuse('FORBIDDEN');
  const own = rows.members.find((m) => m.userId === actorId);
  let actor: Actor;
  if (own) {
    const person = chart.people.get(actorId);
    if (!person || own.status !== 'ACTIVE') throw refuse('FORBIDDEN');
    actor = {
      id: actorId,
      person,
      unrestricted: person.level === 'CEO',
      keys: keysOf(actorId),
    };
  } else if (admin.role === 'SUPER_ADMIN') {
    actor = { id: actorId, person: null, unrestricted: true, keys: new Set(catalogKeys) };
  } else {
    throw refuse('FORBIDDEN');
  }

  const nameOf = (userId: string) => users.get(userId)?.name ?? 'Former team member';
  return {
    now,
    rows,
    actor,
    chart,
    departments,
    roles,
    members,
    users,
    executiveDepartmentId:
      rows.departments.find((d) => d.code === EXECUTIVE_DEPARTMENT_CODE)?.id ?? null,
    modules,
    catalogKeys,
    keysOf,
    nameOf,
    personRef: (userId) => (userId ? { id: userId, name: nameOf(userId) } : null),
    departmentRef: (id) => {
      const d = departments.get(id);
      return { id, code: d?.code ?? '', name: d?.name ?? 'Former department' };
    },
    roleRef: (id) => {
      const r = roles.get(id);
      return {
        id,
        code: r?.code ?? '',
        title: r?.title ?? 'Former role',
        level: r?.level ?? 'INDIVIDUAL_CONTRIBUTOR',
      };
    },
  };
}

/** The org chart's rows in admin scope (every table here is the platform's, never a firm's). */
export async function loadRows(tx: TxClient): Promise<TeamRows> {
  const [departments, roles, members, admins] = await Promise.all([
    tx.platformDepartment.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
    tx.platformRoleDefinition.findMany({
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        code: true,
        title: true,
        level: true,
        departmentId: true,
        defaultScopeType: true,
        permissions: { where: { state: 'ALLOW' }, select: { permissionKey: true } },
      },
    }),
    tx.platformMember.findMany({
      select: {
        userId: true,
        roleDefinitionId: true,
        departmentId: true,
        reportsToUserId: true,
        scopeType: true,
        scopeIds: true,
        status: true,
        intendedRoleDefinitionId: true,
        invitedByUserId: true,
        approvedByUserId: true,
        createdAt: true,
        updatedAt: true,
        permissionOverrides: { select: { permissionKey: true, state: true } },
      },
    }),
    tx.platformAdmin.findMany({ select: { userId: true, role: true } }),
  ]);
  const users = await tx.user.findMany({
    where: { id: { in: admins.map((a) => a.userId) }, pool: 'ADMIN' },
    select: { id: true, name: true, email: true, phone: true, cognitoSub: true },
  });
  return {
    departments,
    roles: roles.map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      level: r.level,
      departmentId: r.departmentId,
      defaultScope: r.defaultScopeType,
      template: r.permissions.map((p) => p.permissionKey).sort(),
    })),
    members: members.map((m) => ({
      userId: m.userId,
      roleId: m.roleDefinitionId,
      departmentId: m.departmentId,
      reportsToId: m.reportsToUserId,
      scope: m.scopeType,
      scopeIds: m.scopeIds,
      status: m.status,
      intendedRoleId: m.intendedRoleDefinitionId,
      invitedById: m.invitedByUserId,
      approvedById: m.approvedByUserId,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      overrides: m.permissionOverrides.map((o) => ({ key: o.permissionKey, state: o.state })),
    })),
    admins: admins.map((a) => ({ userId: a.userId, role: a.role })),
    users,
  };
}

export async function loadContext(
  tx: TxClient,
  actorId: string,
  now = Date.now(),
): Promise<TeamContext> {
  return buildContext(await loadRows(tx), actorId, now);
}
