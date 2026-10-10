import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, Prisma, type TxClient } from '@firmivra/db';
import type {
  AdminSupportAccess,
  AdminSupportAccessList,
  FirmSupportAccess,
  FirmSupportAccessList,
  SupportAccessStatus,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  decodeOffset,
  encodeOffset,
  GRANT_COLUMNS,
  type GrantRow,
  RANK_SQL,
  STATUS_SQL,
  statusOf,
  supportErrors,
} from './grants.js';
import { isLockTimeout, supportScopeErrors } from './support-scope.js';

const HOUR = 60 * 60_000;
type Firm = { id: string; name: string; slug: string };
type ListQuery = { status?: SupportAccessStatus; cursor?: string; limit: number };
type Decision = 'approve' | 'decline' | 'revoke';
const DECIDED: Record<Decision, string> = {
  approve: 'support.approved',
  decline: 'support.declined',
  revoke: 'support.revoked',
};

/**
 * Support access (R8 step 1; contract in packages/types/src/support-access): a Super Admin asks
 * a firm, one of its Owners approves for at most 72 hours (R0's trigger judges that on the
 * database's clock), and the grant ends when it expires or is revoked. Each action is logged
 * where its side can see it:
 * - A Super Admin's ask runs in the admin scope, so the database stores it only as a request by
 *   that Super Admin. The platform's row (with the person) and the firm's row ("Firmivra Support":
 *   no person in its metadata, no IP or user agent, written by R0's app_log_support_request)
 *   both commit with it, or neither does.
 * - An Owner's answer runs in the firm's scope with the row locked, and the firm's row commits
 *   with it. The platform's copy (the Owner, ids only) follows, since the firm's scope can't
 *   write it.
 */
@Injectable()
export class SupportAccessService {
  private readonly logger = new Logger(SupportAccessService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** POST /admin/firms/{businessId}/support-access: one open request per firm and Super Admin. */
  async request(
    adminUserId: string,
    businessId: string,
    reason: string,
  ): Promise<AdminSupportAccess> {
    const created = await this.db.withScope({ kind: 'admin', adminUserId }, async (tx) => {
      const firm = await tx.business.findUnique({
        where: { id: businessId },
        select: { id: true, name: true, slug: true, status: true },
      });
      if (!firm) throw supportErrors.notFound();
      // Only an active firm's Owners can see and answer the ask.
      if (firm.status !== 'ACTIVE') throw supportErrors.firmNotActive();
      // Parallel asks by one Super Admin for one firm meet on this key: the second is the same
      // 409, never a second open request.
      const key = `fv-support-access:${businessId}:${adminUserId}`;
      const [locked] = await tx.$queryRaw<{ ok: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS ok`;
      if (locked?.ok !== true) throw supportErrors.open();
      const [open] = await tx.$queryRaw<{ id: string }[]>`
        SELECT g.id::text AS id FROM support_access_grants g
        WHERE g.business_id = ${businessId}::uuid AND g.admin_user_id = ${adminUserId}::uuid
          AND (${STATUS_SQL.PENDING} OR ${STATUS_SQL.ACTIVE})
        LIMIT 1`;
      if (open) throw supportErrors.open();
      const row = await tx.supportAccessGrant.create({
        data: { businessId, adminUserId, reason },
        select: grantSelect,
      });
      // The platform's row, with the person: the admin scope writes it only as this Super Admin.
      await this.audit.logIn(
        tx,
        'support.requested',
        { type: 'support_access_grant', id: row.id },
        { businessId },
        { businessId: null },
      );
      // The firm's row, from the admin scope, which can't write it directly (issue #215).
      await tx.$executeRaw`SELECT app_log_support_request(${businessId}::uuid, ${row.id}::uuid)`;
      return { row, firm, names: await namesIn(tx, [adminUserId]) };
    });
    const { row, firm, names } = created;
    // R6 tells the firm's Owners; until it has a template, the ask is logged by id.
    this.logger.log(`Support access requested for firm ${businessId} (request ${row.id})`);
    return toAdmin(row, firm, names, Date.now());
  }

  /** GET /admin/support-access: every firm's requests, or one firm's; open ones first. */
  async adminList(
    adminUserId: string,
    q: ListQuery & { businessId?: string },
  ): Promise<AdminSupportAccessList> {
    const offset = decodeOffset(q.cursor);
    const { rows, firms, names } = await this.db.withScope(
      { kind: 'admin', adminUserId },
      async (tx) => {
        const rows = await page(tx, q, offset, q.businessId);
        const firms = await tx.business.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.businessId))] } },
          select: { id: true, name: true, slug: true },
        });
        const names = await namesIn(
          tx,
          rows.map((r) => r.adminUserId),
        );
        return { rows, firms: new Map(firms.map((f) => [f.id, f])), names };
      },
    );
    const items = rows.slice(0, q.limit).flatMap((row) => {
      const firm = firms.get(row.businessId);
      return firm ? [toAdmin(row, firm, names, row.dbNow.getTime())] : [];
    });
    return {
      items,
      nextCursor: rows.length > q.limit ? encodeOffset(offset + q.limit) : null,
    };
  }

  /** GET /business/support-access: the firm's requests (Owner and Admin); open ones first. */
  async firmList(businessId: string, q: ListQuery): Promise<FirmSupportAccessList> {
    const offset = decodeOffset(q.cursor);
    const { rows, names } = await this.db.withScope(
      { kind: 'business', businessId },
      async (tx) => {
        const rows = await page(tx, q, offset, businessId);
        const approvers = rows.flatMap((r) => (r.grantedByUserId ? [r.grantedByUserId] : []));
        return { rows, names: await namesIn(tx, approvers) };
      },
    );
    return {
      items: rows.slice(0, q.limit).map((row) => toFirm(row, names, row.dbNow.getTime())),
      nextCursor: rows.length > q.limit ? encodeOffset(offset + q.limit) : null,
    };
  }

  /**
   * An Owner's answer, in the firm's scope with the row locked: approve a pending request for
   * `hours` from now, decline a pending one, or revoke an active grant. The database's clock
   * decides (now() is the transaction's, as in R0's trigger), and the firm's row commits with
   * the answer.
   */
  async decide(
    businessId: string,
    ownerUserId: string,
    id: string,
    decision: Decision,
    hours = 24,
  ): Promise<FirmSupportAccess> {
    const { row, names, now } = await this.db
      .withScope({ kind: 'business', businessId }, async (tx) => {
        // A support read holds the grant (R0's app_enter_support_scope); a revoke waits for it
        // at most this long, then the Owner tries again (409), never a held connection.
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
        const [current] = await tx.$queryRaw<(GrantRow & { dbNow: Date })[]>`
          SELECT ${GRANT_COLUMNS}, now() AS "dbNow" FROM support_access_grants g
          WHERE g.business_id = ${businessId}::uuid AND g.id = ${id}::uuid
          FOR UPDATE`;
        if (!current) throw supportErrors.notFound();
        const now = current.dbNow.getTime();
        const status = statusOf(current, now);
        let data: Prisma.SupportAccessGrantUpdateInput;
        if (decision === 'revoke') {
          if (status !== 'ACTIVE') throw supportErrors.notActive();
          data = { revokedAt: new Date(now) };
        } else {
          if (status !== 'PENDING') throw supportErrors.decided();
          data =
            decision === 'approve'
              ? { grantedByUserId: ownerUserId, expiresAt: new Date(now + hours * HOUR) }
              : { revokedAt: new Date(now) };
        }
        const row = await tx.supportAccessGrant
          .update({ where: { id: current.id }, data, select: grantSelect })
          .catch((e: unknown) => {
            // R0's trigger has the last word on who approves: an Owner removed or demoted after
            // this request's role check is refused there.
            if (e instanceof Error && e.message.includes('only an active owner')) {
              throw supportErrors.ownerOnly();
            }
            throw e;
          });
        await this.audit.logIn(
          tx,
          DECIDED[decision],
          { type: 'support_access_grant', id: row.id },
          decision === 'approve' ? { hours } : {},
        );
        const approver = row.grantedByUserId ? [row.grantedByUserId] : [];
        return { row, names: await namesIn(tx, approver), now };
      })
      .catch((e: unknown) => {
        throw isLockTimeout(e) ? supportScopeErrors.busy() : e;
      });
    await this.platformCopy(
      DECIDED[decision],
      row.id,
      decision === 'approve' ? { businessId, hours } : { businessId },
    );
    return toFirm(row, names, now);
  }

  /**
   * The platform's copy of an Owner's answer, after the answer commits (the firm's scope writes
   * only the firm's rows): the Owner as the actor, the grant as the record, ids only. Best
   * effort: a failure is a warning with the grant id, and the answer stands.
   */
  private async platformCopy(
    action: string,
    grantId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.log(action, { type: 'support_access_grant', id: grantId }, metadata, {
        businessId: null,
      });
    } catch {
      this.logger.warn(`Could not copy ${action} to the platform's log (grant ${grantId})`);
    }
  }
}

const grantSelect = {
  id: true,
  businessId: true,
  adminUserId: true,
  grantedByUserId: true,
  reason: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} satisfies Prisma.SupportAccessGrantSelect;

/**
 * One page of `support_access_grants g`, open ones first, then newest. Each row carries the
 * transaction's now(), which the filter and the order used, so its status is labelled by the
 * same clock (a grant expiring during the request never lists as ACTIVE but labelled EXPIRED).
 */
function page(tx: TxClient, q: ListQuery, offset: number, businessId?: string) {
  const conditions = [
    businessId ? Prisma.sql`g.business_id = ${businessId}::uuid` : null,
    q.status ? STATUS_SQL[q.status] : null,
  ].filter((c): c is Prisma.Sql => c !== null);
  const where = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
    : Prisma.empty;
  return tx.$queryRaw<(GrantRow & { dbNow: Date })[]>`
    SELECT ${GRANT_COLUMNS}, now() AS "dbNow" FROM support_access_grants g
    ${where}
    ORDER BY ${RANK_SQL}, g.created_at DESC, g.id DESC
    LIMIT ${q.limit + 1} OFFSET ${offset}`;
}

/**
 * Names of the users this scope may read: in the firm's scope its own people, in the admin scope
 * the Super Admins (row-level security decides).
 */
async function namesIn(tx: TxClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const users = await tx.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toFirm(row: GrantRow, names: Map<string, string>, now: number): FirmSupportAccess {
  return {
    id: row.id,
    reason: row.reason,
    status: statusOf(row, now),
    requestedAt: row.createdAt.toISOString(),
    approvedBy: row.grantedByUserId
      ? { userId: row.grantedByUserId, name: names.get(row.grantedByUserId) ?? '' }
      : null,
    expiresAt: iso(row.expiresAt),
    endedAt: iso(row.revokedAt),
  };
}

function toAdmin(
  row: GrantRow,
  firm: Firm,
  names: Map<string, string>,
  now: number,
): AdminSupportAccess {
  return {
    id: row.id,
    firm,
    admin: { userId: row.adminUserId, name: names.get(row.adminUserId) ?? '' },
    reason: row.reason,
    status: statusOf(row, now),
    requestedAt: row.createdAt.toISOString(),
    expiresAt: iso(row.expiresAt),
    endedAt: iso(row.revokedAt),
  };
}
