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
 *   that Super Admin; the platform's row (with the person) commits with it. The firm's row
 *   ("Firmivra Support", no person in its metadata) follows in the firm's scope, which the admin
 *   scope can't write.
 * - An Owner's answer runs in the firm's scope with the row locked, and the firm's row commits
 *   with it. The platform reads the outcome from the grant itself.
 * - A support read (the firm's audit log) locks the grant in the read's transaction and writes
 *   the firm's row there (audit-viewer); the platform's row follows (`logViewed`).
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
        select: { id: true, name: true, slug: true },
      });
      if (!firm) throw supportErrors.notFound();
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
      );
      return { row, firm, names: await namesIn(tx, [adminUserId]) };
    });
    const { row, firm, names } = created;
    await this.firmRow(businessId, adminUserId, 'support.requested', row.id);
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
    const now = Date.now();
    const items = rows.slice(0, q.limit).flatMap((row) => {
      const firm = firms.get(row.businessId);
      return firm ? [toAdmin(row, firm, names, now)] : [];
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
    const now = Date.now();
    return {
      items: rows.slice(0, q.limit).map((row) => toFirm(row, names, now)),
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
    const { row, names, now } = await this.db.withScope(
      { kind: 'business', businessId },
      async (tx) => {
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
        const row = await tx.supportAccessGrant.update({
          where: { id: current.id },
          data,
          select: grantSelect,
        });
        await this.audit.logIn(
          tx,
          DECIDED[decision],
          { type: 'support_access_grant', id: row.id },
          decision === 'approve' ? { hours } : {},
        );
        const approver = row.grantedByUserId ? [row.grantedByUserId] : [];
        return { row, names: await namesIn(tx, approver), now };
      },
    );
    return toFirm(row, names, now);
  }

  /**
   * The platform's row for a support read, as the Super Admin. A firm's scope writes only the
   * firm's rows, so this one can't share the read's transaction until R0's support scope (R8
   * Needs): it follows the commit, and a failure is logged by id while the read stands. The
   * firm's row, in the read's transaction, already names the grant.
   */
  async logViewed(
    adminUserId: string,
    businessId: string,
    grantId: string,
    view: string,
  ): Promise<void> {
    try {
      await this.db.withScope({ kind: 'admin', adminUserId }, (tx) =>
        this.audit.logIn(tx, 'support.viewed', { type: view }, { businessId, view, grantId }),
      );
    } catch {
      this.logger.warn(`Could not log support.viewed for firm ${businessId} (grant ${grantId})`);
    }
  }

  /**
   * The firm's row for a Super Admin's ask, as "Firmivra Support": the actor is the Super Admin,
   * whom the firm's log viewer shows only as Firmivra Support (no person, no IP), and the
   * metadata never names them. Written after the ask, in the firm's scope; a failure is logged
   * by id and the ask stands.
   */
  private async firmRow(
    businessId: string,
    adminUserId: string,
    action: string,
    grantId: string,
  ): Promise<void> {
    try {
      await this.audit.log(
        action,
        { type: 'support_access_grant', id: grantId },
        {},
        { businessId, actorUserId: adminUserId },
      );
    } catch {
      this.logger.warn(`Could not log ${action} for firm ${businessId} (request ${grantId})`);
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

/** One page of `support_access_grants g`, open ones first, then newest. */
function page(tx: TxClient, q: ListQuery, offset: number, businessId?: string) {
  const conditions = [
    businessId ? Prisma.sql`g.business_id = ${businessId}::uuid` : null,
    q.status ? STATUS_SQL[q.status] : null,
  ].filter((c): c is Prisma.Sql => c !== null);
  const where = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
    : Prisma.empty;
  return tx.$queryRaw<GrantRow[]>`
    SELECT ${GRANT_COLUMNS} FROM support_access_grants g
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
