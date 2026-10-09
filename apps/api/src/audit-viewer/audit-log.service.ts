import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { AuditLogPage } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { deriveKey, poolSecrets } from '../auth/sealed.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import {
  actionFilter,
  type AuditLogFilters,
  type CursorScope,
  decodeCursor,
  encodeCursor,
  type KnownActors,
  resolveRange,
  toEntry,
  viewedMetadata,
} from './audit-log.logic.js';

/** HKDF label for the key that signs paging cursors (the readers are staff logins). */
const CURSOR_KEY_LABEL = 'fv-audit-cursor-v1';

/** Who reads: the firm from TenantGuard and the signed-in member. */
export interface AuditLogReader {
  businessId: string;
  userId: string;
}

/**
 * A Super Admin's read under a support grant (R8): `read` opens the firm's read-only support
 * scope (SupportScope.read), which itself logs `support.viewed` in both logs.
 */
export interface SupportRead {
  read: <T>(fn: (tx: TxClient) => Promise<T>) => Promise<T>;
}

/** Every column the viewer shows; never the user agent or the firm id. */
const rowSelect = {
  id: true,
  createdAt: true,
  action: true,
  actorUserId: true,
  entityType: true,
  entityId: true,
  metadata: true,
  ip: true,
  requestId: true,
} satisfies Prisma.AuditLogSelect;

/**
 * The firm's audit log (R12 step 4; contract in packages/types/src/audit-log). Reads run in the
 * firm's business scope with `businessId` from TenantGuard, so row-level security shows only this
 * firm's rows and only its own people. The first page of each read is itself audited; later
 * pages need a cursor signed for this firm, reader and filters, which only that page hands out.
 */
@Injectable()
export class AuditLogViewerService {
  private readonly cursorKey: Uint8Array;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    const secret = poolSecrets(env).STAFF;
    if (!secret) throw new Error('No key for audit log cursors');
    this.cursorKey = deriveKey(secret, 'STAFF', CURSOR_KEY_LABEL);
  }

  async list(
    reader: AuditLogReader,
    q: AuditLogFilters,
    support?: SupportRead,
  ): Promise<AuditLogPage> {
    const { businessId } = reader;
    const scope: CursorScope = { businessId, userId: reader.userId, filters: q };
    const after =
      q.cursor !== undefined ? decodeCursor(q.cursor, this.cursorKey, scope) : undefined;
    const range = resolveRange(q, new Date());
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        { businessId },
        { createdAt: { gte: range.from, lte: range.to } },
        actionFilter(q.action),
        q.actorUserId !== undefined ? { actorUserId: q.actorUserId } : {},
        q.entityType !== undefined ? { entityType: q.entityType } : {},
        q.entityId !== undefined ? { entityId: q.entityId } : {},
        after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {},
      ],
    };

    const inScope = <T>(fn: (tx: TxClient) => Promise<T>) =>
      support ? support.read(fn) : this.database.withScope({ kind: 'business', businessId }, fn);
    const { rows, known } = await inScope(async (tx) => {
      // The person filter finds only the firm's own people: filtering by a Super Admin's (or
      // anyone else's) id must not tell the firm that this id acted here.
      if (
        q.actorUserId !== undefined &&
        !(await this.isFirmPerson(tx, businessId, q.actorUserId))
      ) {
        return {
          rows: [],
          known: { supportAdmins: new Set(), people: new Map() } as KnownActors,
        };
      }
      const rows = await tx.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: rowSelect,
      });
      const ids = [
        ...new Set(rows.flatMap((r) => (r.actorUserId === null ? [] : [r.actorUserId]))),
      ];
      if (ids.length === 0) {
        return { rows, known: { supportAdmins: new Set(), people: new Map() } as KnownActors };
      }
      // Super Admins who asked this firm for support access: the firm sees their requests.
      const grants = await tx.supportAccessGrant.findMany({
        where: { businessId, adminUserId: { in: ids } },
        select: { adminUserId: true },
      });
      // Row-level security shows only this firm's members and clients.
      const people = await tx.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, pool: true, name: true },
      });
      const known: KnownActors = {
        supportAdmins: new Set(grants.map((g) => g.adminUserId)),
        people: new Map(people.map((p) => [p.id, { pool: p.pool, name: p.name }])),
      };
      return { rows, known };
    });

    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    // After the read, so the page never lists its own row. Later pages are the same read. A
    // support read is already in both logs (support.viewed, every page).
    if (after === undefined && !support) {
      await this.audit.log('audit_log.viewed', { type: 'audit_log' }, viewedMetadata(q, range));
    }
    return {
      items: page.map((row) => toEntry(row, known)),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last, this.cursorKey, scope) : null,
    };
  }

  /** A member or client of this firm the log names (row-level security shows only those). */
  private async isFirmPerson(tx: TxClient, businessId: string, userId: string): Promise<boolean> {
    const person = await tx.user.findFirst({
      where: { id: userId, pool: { not: 'ADMIN' } },
      select: { id: true },
    });
    if (!person) return false;
    const grant = await tx.supportAccessGrant.findFirst({
      where: { businessId, adminUserId: userId },
      select: { id: true },
    });
    return grant === null;
  }
}
