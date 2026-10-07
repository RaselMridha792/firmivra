import { ConflictException, NotFoundException } from '@nestjs/common';
import { databaseErrorCode, type TxClient } from '@firmivra/db';
import type { MemberRef } from '@firmivra/types';
import type { ClientsActor } from '../clients/clients.service.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';

// Shared by the R12 tasks, workspaces and reports services.

export const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
export const conflict = (code: string, message: string) => new ConflictException({ code, message });
export const notAMember = () =>
  conflict('NOT_A_MEMBER', 'The assignee is not an active member of the firm');
/**
 * Rasel's rule of Oct 8 (q5): a client's task goes to a Staff member only when that client is
 * assigned to them. The code is in TaskErrorCode once contract PR #86 merges.
 */
export const clientNotAssigned = () =>
  conflict('CLIENT_NOT_ASSIGNED', 'This client is not assigned to that staff member');

/** The signed-in member as the services need them. Firm routes only (see @Roles). */
export function actorOf(
  auth: AuthContext | undefined,
  tenant: TenantContext | undefined,
): ClientsActor {
  if (!auth || tenant?.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/** The signed-in client login of a portal route (from the session, never the URL). */
export function clientAccountOf(tenant: TenantContext | undefined): string {
  if (tenant?.kind !== 'client') throw new Error('portal routes are for client logins');
  return tenant.clientAccountId;
}

/** A unique index refused the write (Prisma's P2002, or the raw SQLSTATE). */
export const isUniqueViolation = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 'P2002' || databaseErrorCode(error) === '23505';

/** A foreign key refused the write: the row it points at is gone. */
export const isForeignKeyViolation = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 'P2003' || databaseErrorCode(error) === '23503';

/** `YYYY-MM-DD` of a `@db.Date` column (stored at midnight UTC). */
export const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
/** The `@db.Date` value of a calendar day. */
export const toDay = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** The names of the keys a request or query sets, sorted (values never reach the audit log). */
export function sentFields<T extends object>(value: T, keys: readonly (keyof T & string)[]) {
  return keys.filter((key) => value[key] !== undefined).sort();
}

/** Whether the actor reaches a client: Owner and Admin every one, Staff those assigned to them. */
export const reachesClient = (actor: ClientsActor, client: { assignedUserId: string | null }) =>
  actor.role !== 'STAFF' || client.assignedUserId === actor.userId.toLowerCase();

/**
 * The client's row in this firm, locked FOR SHARE until the change commits, so its assignee
 * cannot change under the change (a reassignment waits for it, or has committed and is seen
 * here). Null when the firm has no such client.
 */
export async function lockClient(
  tx: TxClient,
  businessId: string,
  clientId: string,
): Promise<{ assignedUserId: string | null } | null> {
  const [row] = await tx.$queryRaw<{ assigned_user_id: string | null }[]>`
    SELECT assigned_user_id::text AS assigned_user_id FROM clients
    WHERE business_id = ${businessId}::uuid AND id = ${clientId}::uuid
    FOR SHARE`;
  return row ? { assignedUserId: row.assigned_user_id } : null;
}

/**
 * A task's assignee (Rasel, Oct 8, q5): an active member of this firm (409 NOT_A_MEMBER otherwise:
 * another firm's, a former member, an open invite or a client login), and a Staff member only
 * when the task's client is assigned to them (409 CLIENT_NOT_ASSIGNED; Owner and Admin always
 * may be). FOR SHARE keeps their status and role until the change commits.
 */
export async function checkAssignee(
  tx: TxClient,
  businessId: string,
  userId: string,
  client: { assignedUserId: string | null },
): Promise<void> {
  const [member] = await tx.$queryRaw<{ role: string; status: string }[]>`
    SELECT role::text AS role, status::text AS status FROM memberships
    WHERE business_id = ${businessId}::uuid AND user_id = ${userId}::uuid
    FOR SHARE`;
  if (!member || member.status !== 'ACTIVE') throw notAMember();
  if (member.role === 'STAFF' && client.assignedUserId !== userId.toLowerCase()) {
    throw clientNotAssigned();
  }
}

/**
 * Names of the firm members behind `userIds`, for `createdBy`. A former member keeps their name;
 * someone who never joined (an open invite) or is not a member (a client) has none.
 */
export async function memberNames(
  tx: TxClient,
  businessId: string,
  userIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const members = await tx.membership.findMany({
    where: { businessId, userId: { in: ids }, joinedAt: { not: null } },
    select: { userId: true, user: { select: { name: true } } },
  });
  return new Map(members.map((m) => [m.userId, m.user.name]));
}

export function memberRef(names: Map<string, string>, userId: string | null): MemberRef | null {
  const name = userId ? names.get(userId) : undefined;
  return userId && name !== undefined ? { userId, name } : null;
}

/** A to-one member relation (an assignee) as a MemberRef. */
export const assignee = (m: { userId: string; user: { name: string } } | null): MemberRef | null =>
  m ? { userId: m.userId, name: m.user.name } : null;
