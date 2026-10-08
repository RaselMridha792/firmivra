import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@firmivra/db';
import type { SupportAccessStatus } from '@firmivra/types';

/** A request or grant as the database keeps it (R0's support_access_grants). */
export interface GrantRow {
  id: string;
  businessId: string;
  adminUserId: string;
  grantedByUserId: string | null;
  reason: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** The columns as GrantRow names them, for raw queries over `support_access_grants g`. */
export const GRANT_COLUMNS = Prisma.sql`
  g.id::text AS id, g.business_id::text AS "businessId", g.admin_user_id::text AS "adminUserId",
  g.granted_by_user_id::text AS "grantedByUserId", g.reason, g.expires_at AS "expiresAt",
  g.revoked_at AS "revokedAt", g.created_at AS "createdAt"`;

/**
 * The status, derived from the row: there is no status column, and expiry needs no job. An
 * approval sets the approver and the expiry; a decline or revoke sets revoked_at (R0's trigger
 * keeps both final).
 */
export function statusOf(
  row: Pick<GrantRow, 'grantedByUserId' | 'expiresAt' | 'revokedAt'>,
  now: number,
): SupportAccessStatus {
  if (row.revokedAt) return row.grantedByUserId ? 'REVOKED' : 'DECLINED';
  if (!row.grantedByUserId) return 'PENDING';
  return row.expiresAt && row.expiresAt.getTime() > now ? 'ACTIVE' : 'EXPIRED';
}

/** The same rule in SQL over `support_access_grants g`, on the database's clock. */
export const STATUS_SQL: Record<SupportAccessStatus, Prisma.Sql> = {
  PENDING: Prisma.sql`(g.revoked_at IS NULL AND g.granted_by_user_id IS NULL)`,
  ACTIVE: Prisma.sql`(g.revoked_at IS NULL AND g.granted_by_user_id IS NOT NULL AND g.expires_at > now())`,
  EXPIRED: Prisma.sql`(g.revoked_at IS NULL AND g.granted_by_user_id IS NOT NULL AND g.expires_at <= now())`,
  DECLINED: Prisma.sql`(g.revoked_at IS NOT NULL AND g.granted_by_user_id IS NULL)`,
  REVOKED: Prisma.sql`(g.revoked_at IS NOT NULL AND g.granted_by_user_id IS NOT NULL)`,
};

/** Open ones first: pending (0), then active (1), then the rest (2). */
export const RANK_SQL = Prisma.sql`CASE WHEN ${STATUS_SQL.PENDING} THEN 0 WHEN ${STATUS_SQL.ACTIVE} THEN 1 ELSE 2 END`;

export const supportErrors = {
  notFound: () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' }),
  open: () =>
    new ConflictException({
      code: 'SUPPORT_REQUEST_OPEN',
      message: 'You already have an open support access request for this firm',
    }),
  decided: () =>
    new ConflictException({
      code: 'SUPPORT_REQUEST_DECIDED',
      message: 'This support access request was already answered',
    }),
  notActive: () =>
    new ConflictException({
      code: 'SUPPORT_GRANT_NOT_ACTIVE',
      message: 'This support access grant is not active',
    }),
  ownerOnly: () =>
    new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Only an Owner answers support access requests',
    }),
  badCursor: () =>
    new BadRequestException({ code: 'VALIDATION_FAILED', message: 'This cursor is not valid' }),
};

/** Support access lists are short: the cursor is an offset, opaque to the screens. */
export const encodeOffset = (offset: number): string =>
  Buffer.from(`o:${offset}`).toString('base64url');

export function decodeOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = /^o:(\d{1,6})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!match) throw supportErrors.badCursor();
  return Number(match[1]);
}
