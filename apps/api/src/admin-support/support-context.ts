import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type {
  SupportAgent,
  SupportAgentRole,
  SupportChannel,
  SupportErrorCode,
  SupportNotificationEvent,
  SupportNotificationRecipient,
  SupportPermission,
  SupportPermissionGrid,
} from '@firmivra/types';
import { SUPPORT_CLIENT_EVENTS, SupportPermission as PermissionEnum } from '@firmivra/types';
import { colorOf, type SupportHours, targetOf } from './sla.js';

// What every Support read and write needs, loaded once per request in admin scope: the team and
// its permission grid, the clock settings, the priorities and categories, and the mappings
// between the contract and the B2 rows (docs/work/R60-backend.md, "Support contract").

export const supportError = (
  status: 400 | 403 | 404 | 409 | 410 | 422,
  code: SupportErrorCode | 'VALIDATION_FAILED',
  message: string,
) => {
  const body = { code, message };
  switch (status) {
    case 400:
      return new BadRequestException(body);
    case 403:
      return new ForbiddenException(body);
    case 404:
      return new NotFoundException(body);
    case 409:
      return new ConflictException(body);
    case 422:
      return new UnprocessableEntityException(body);
    default:
      return new ConflictException(body);
  }
};
export const notFound = (what = 'Ticket') => supportError(404, 'NOT_FOUND', `${what} not found`);
export const invalid = (message: string) => supportError(400, 'VALIDATION_FAILED', message);

/** The `support.*` permission keys in `platform_role_permissions`. */
export const SUPPORT_KEYS: Readonly<Record<SupportPermission, string>> = {
  VIEW_ALL: 'support.view_all',
  VIEW_OWN: 'support.view_own',
  ASSIGN: 'support.assign',
  ESCALATE: 'support.escalate',
  RESOLVE: 'support.resolve',
  CLOSE: 'support.close',
  MERGE: 'support.merge',
  EDIT_SETTINGS: 'support.edit_settings',
  DELETE: 'support.delete',
  VIEW_INTERNAL_NOTES: 'support.view_internal_notes',
  MANAGE_CANNED: 'support.manage_canned',
};

const DEPARTMENT = 'CUSTOMER_SUCCESS_SUPPORT';
/** The role definitions each support role's grid is stored on (seed-platform-team.ts codes). */
export const ROLE_CODES: Readonly<Record<SupportAgentRole, readonly string[]>> = {
  OWNER: ['EXECUTIVE_CEO'],
  LEAD: [`${DEPARTMENT}_CUSTOMER_SUPPORT_MANAGER`],
  AGENT: [
    `${DEPARTMENT}_CUSTOMER_SUPPORT_REPRESENTATIVE`,
    `${DEPARTMENT}_TECHNICAL_SUPPORT_SPECIALIST`,
  ],
};

/** The spec's grid, for a role with no `support.*` row yet. */
export const DEFAULT_GRID: SupportPermissionGrid = {
  OWNER: [...PermissionEnum.options],
  LEAD: [
    'VIEW_ALL',
    'VIEW_OWN',
    'ASSIGN',
    'ESCALATE',
    'RESOLVE',
    'CLOSE',
    'MERGE',
    'VIEW_INTERNAL_NOTES',
    'MANAGE_CANNED',
  ],
  AGENT: ['VIEW_OWN', 'ESCALATE', 'RESOLVE', 'VIEW_INTERNAL_NOTES'],
};

/** Contract events and their `support_notification_rules.event` keys. */
export const EVENT_KEYS: Readonly<Record<SupportNotificationEvent, string>> = {
  NEW_TICKET: 'ticket.created',
  ASSIGNED: 'ticket.assigned',
  REASSIGNED: 'ticket.reassigned',
  REPLY: 'ticket.replied',
  ESCALATED: 'ticket.escalated',
  SLA_WARNING: 'sla.warning',
  SLA_BREACH: 'sla.breached',
  RESOLVED: 'ticket.resolved',
  CLOSED: 'ticket.closed',
  REOPENED: 'ticket.reopened',
  CUSTOMER_RESPONSE: 'ticket.customer_replied',
};
/** Recipients other than the assignee, as role keys on the rule. */
export const RECIPIENT_KEYS: Readonly<
  Record<Exclude<SupportNotificationRecipient, 'ASSIGNEE'>, string>
> = {
  ADMINS: 'support.view_all',
  LEAD: 'support.escalate',
  CLIENT: 'firm.contact',
};
export const CHANNEL_ORDER: readonly SupportChannel[] = ['IN_APP', 'EMAIL', 'SMS'];
export const isClientEvent = (event: SupportNotificationEvent) =>
  SUPPORT_CLIENT_EVENTS.includes(event);

export interface PriorityRow {
  id: string;
  name: string;
  description: string;
  color: ReturnType<typeof colorOf>;
  targetMinutes: number;
  resolutionTargetMinutes: number | null;
  active: boolean;
  rank: number;
  code: string;
}
export interface CategoryRow {
  id: string;
  name: string;
  description: string;
  active: boolean;
}
export interface EscalationRow {
  id: string;
  kind: 'SLA_BREACH' | 'HIGH_PRIORITY_UNRESOLVED' | 'CRITICAL_IMMEDIATE';
  priorityId: string | null;
  thresholdMinutes: number | null;
  notifyUserId: string | null;
  channels: string[];
  isActive: boolean;
}

export interface SupportContext {
  now: number;
  me: SupportAgent;
  permissions: ReadonlySet<SupportPermission>;
  agents: SupportAgent[];
  grid: SupportPermissionGrid;
  hours: SupportHours;
  pauseWhileWaiting: boolean;
  reassignAfterMinutes: number | null;
  roundRobin: boolean;
  lastAssignedUserId: string | null;
  priorities: PriorityRow[];
  categories: CategoryRow[];
  escalation: EscalationRow[];
  /** A team member's name by user id (a former member keeps a name on history). */
  nameOf(userId: string | null): string;
  /** Whether the user is on the Super Admin team (a platform admin). */
  isTeam(userId: string): boolean;
}

export const hhmm = (time: Date) => time.toISOString().slice(11, 16);
/** ISO weekday (1 = Monday) to the contract's (0 = Sunday). */
export const dayOfIso = (iso: number) => iso % 7;
export const isoOfDay = (day: number) => (day === 0 ? 7 : day);

/** Which support role a member's row gives, or null when the member is not on the support team. */
function roleOf(code: string | undefined): SupportAgentRole | null {
  if (!code) return null;
  if (ROLE_CODES.LEAD.includes(code)) return 'LEAD';
  if (ROLE_CODES.AGENT.includes(code)) return 'AGENT';
  return null;
}

/** The grid as stored: a role's ALLOW keys; a role with no `support.*` row reads the default. */
export async function loadGrid(tx: TxClient): Promise<SupportPermissionGrid> {
  const codes = Object.values(ROLE_CODES).flat();
  const roles = await tx.platformRoleDefinition.findMany({
    where: { code: { in: codes } },
    select: {
      code: true,
      permissions: {
        where: { permissionKey: { startsWith: 'support.' } },
        select: { permissionKey: true, state: true },
      },
    },
  });
  const byKey = new Map(
    Object.entries(SUPPORT_KEYS).map(([perm, key]) => [key, perm as SupportPermission]),
  );
  const grid = { ...DEFAULT_GRID };
  for (const role of ['OWNER', 'LEAD', 'AGENT'] as const) {
    const rows = roles
      .filter((r) => ROLE_CODES[role].includes(r.code))
      .flatMap((r) => r.permissions);
    if (rows.length === 0) continue;
    const allowed = new Set<SupportPermission>();
    for (const row of rows) {
      const perm = byKey.get(row.permissionKey);
      if (perm && row.state === 'ALLOW') allowed.add(perm);
    }
    grid[role] = PermissionEnum.options.filter((p) => allowed.has(p));
  }
  return grid;
}

/** The support team: every Super Admin (OWNER) and the support department's members. */
export async function loadTeam(
  tx: TxClient,
): Promise<{ agents: SupportAgent[]; names: Map<string, string> }> {
  const admins = await tx.platformAdmin.findMany({
    select: {
      userId: true,
      role: true,
      member: {
        select: { status: true, roleDefinition: { select: { code: true } } },
      },
    },
  });
  const users = await tx.user.findMany({
    where: { id: { in: admins.map((a) => a.userId) } },
    select: { id: true, name: true, email: true },
  });
  const userOf = new Map(users.map((u) => [u.id, u]));
  const names = new Map(users.map((u) => [u.id, u.name]));
  const agents: SupportAgent[] = [];
  for (const a of admins) {
    const user = userOf.get(a.userId);
    const role: SupportAgentRole | null =
      a.role === 'SUPER_ADMIN' ? 'OWNER' : roleOf(a.member?.roleDefinition.code);
    if (!role || !user) continue;
    const active = role === 'OWNER' || a.member?.status === 'ACTIVE';
    agents.push({
      id: a.userId,
      name: user.name,
      email: user.email,
      role,
      active,
      available: active,
    });
  }
  const order: Record<SupportAgentRole, number> = { OWNER: 0, LEAD: 1, AGENT: 2 };
  agents.sort((x, y) => order[x.role] - order[y.role] || x.name.localeCompare(y.name));
  return { agents, names };
}

/** Everything a Support request needs, in the caller's admin scope. */
export async function loadContext(
  tx: TxClient,
  adminUserId: string,
  now = Date.now(),
): Promise<SupportContext> {
  const [team, grid, settings, holidays, priorities, categories, escalation] = await Promise.all([
    loadTeam(tx),
    loadGrid(tx),
    tx.supportSettings.findUnique({ where: { id: 1 } }),
    tx.supportHoliday.findMany({ orderBy: { date: 'asc' }, select: { date: true } }),
    tx.supportPriority.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    tx.supportCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    tx.supportEscalationRule.findMany({ orderBy: { createdAt: 'asc' } }),
  ]);
  const me = team.agents.find((a) => a.id === adminUserId);
  if (!me) throw supportError(403, 'FORBIDDEN', 'Not a support team member');
  const opens = settings ? hhmm(settings.opensAt) : '09:00';
  const closes = settings ? hhmm(settings.closesAt) : '17:00';
  const working = new Set((settings?.workingDays ?? [1, 2, 3, 4, 5]).map(dayOfIso));
  const hours: SupportHours = {
    timeZone: settings?.timeZone ?? 'America/New_York',
    days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      open: working.has(day),
      start: opens,
      end: closes,
    })),
    holidays: holidays.map((h) => h.date.toISOString().slice(0, 10)),
    clock: settings?.slaMode === 'CALENDAR' ? 'CALENDAR' : 'BUSINESS',
  };
  return {
    now,
    me,
    permissions: new Set(grid[me.role]),
    agents: team.agents,
    grid,
    hours,
    pauseWhileWaiting: settings?.pauseWhileWaiting ?? true,
    reassignAfterMinutes: settings?.reassignAfterMinutes ?? null,
    roundRobin: settings?.roundRobin ?? false,
    lastAssignedUserId: settings?.lastAssignedUserId ?? null,
    priorities: priorities.map((p, i) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      color: colorOf(p.color),
      targetMinutes: p.responseTargetMinutes,
      resolutionTargetMinutes: p.resolutionTargetMinutes,
      active: p.isActive,
      rank: i + 1,
      code: p.code,
    })),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? '',
      active: c.isActive,
    })),
    escalation: escalation.map((r) => ({
      id: r.id,
      kind: r.kind,
      priorityId: r.priorityId,
      thresholdMinutes: r.thresholdMinutes,
      notifyUserId: r.notifyUserId,
      channels: r.channels,
      isActive: r.isActive,
    })),
    nameOf: (userId) => (userId ? (team.names.get(userId) ?? 'Former team member') : 'System'),
    isTeam: (userId) => team.names.has(userId),
  };
}

/** 403 FORBIDDEN unless the caller's support role allows it. */
export function need(ctx: SupportContext, permission: SupportPermission): void {
  if (!ctx.permissions.has(permission))
    throw supportError(403, 'FORBIDDEN', 'Your support role does not allow this');
}

/** The rule of a kind (the first, as seeded). */
export const ruleOf = (ctx: SupportContext, kind: EscalationRow['kind']) =>
  ctx.escalation.find((r) => r.kind === kind);

/** The members round robin picks from: active, available, not the Owner, with any permission. */
export function roundRobinPool(ctx: SupportContext): SupportAgent[] {
  return ctx.agents.filter(
    (a) => a.active && a.available && a.role !== 'OWNER' && ctx.grid[a.role].length > 0,
  );
}

/** The next member after the last one assigned, or null when the pool is empty. */
export function nextRoundRobin(ctx: SupportContext, exceptId?: string | null): SupportAgent | null {
  const pool = roundRobinPool(ctx).filter((a) => a.id !== exceptId);
  if (pool.length === 0) return null;
  const last = pool.findIndex((a) => a.id === ctx.lastAssignedUserId);
  return pool[(last + 1) % pool.length] ?? null;
}

export { targetOf };
