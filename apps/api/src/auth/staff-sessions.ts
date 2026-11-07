import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { Database } from '@firmivra/db';
import { deviceOf } from '../admin-audit/classify.js';
import { AuditService } from '../audit/audit.service.js';
import { canonicalIp } from '../common/network.js';
import { DATABASE } from '../database/database.module.js';

/** Login History's row: the first request of a staff session in this firm (SM4). */
export const FIRM_SESSION_STARTED = 'auth.firm_session_started';

/** lastActiveAt moves at most once a minute. */
const TOUCH_MS = 60_000;

/**
 * The row's key: a SHA-256 of the firm and the sign-in's id (Cognito `origin_jti`, locally the
 * `sid` claim), never the id or a token. With the firm in it, one sign-in has its own row in each
 * of the person's firms, and no firm's row matches another firm's.
 */
export const sessionKey = (businessId: string, session: string) =>
  createHash('sha256').update(`${businessId}:${session}`).digest('hex');

/** "Chrome on macOS", up to 100 characters. */
export function deviceLabel(userAgent: string | undefined): string {
  const { browser, os } = deviceOf(userAgent ?? null);
  if (!browser && !os) return 'Unknown device';
  return `${browser ?? 'Browser'} on ${os ?? 'an unknown system'}`.slice(0, 100);
}

const revoked = () =>
  new UnauthorizedException({
    code: 'SESSION_REVOKED',
    message: 'This session was signed out. Sign in again.',
  });

/**
 * SM4: staff sessions per firm (staff_sessions, firm-scoped with RLS). The tenant guard calls
 * `check` on every staff request to a firm route: a session the firm ended answers 401
 * SESSION_REVOKED, and a failed lookup fails the request too (closed). Otherwise the row is
 * created on the session's first request in the firm, with an `auth.firm_session_started` audit
 * row for Login History, or its lastActiveAt moves (at most once a minute). Those writes never
 * fail the request: an error is logged and the request goes on.
 * Staff pool only: the guard never calls it for a client or a Super Admin.
 */
@Injectable()
export class StaffSessions {
  private readonly logger = new Logger(StaffSessions.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async check(
    req: Request,
    businessId: string,
    membershipId: string,
    session: string,
  ): Promise<void> {
    const tokenHash = sessionKey(businessId, session);
    const row = await this.db.forBusiness(businessId).staffSession.findFirst({
      where: { tokenHash },
      select: { id: true, membershipId: true, revokedAt: true, lastActiveAt: true },
    });
    // Another membership's row under this key cannot be this person's session: closed.
    if (row && (row.revokedAt || row.membershipId !== membershipId)) throw revoked();
    try {
      if (!row) await this.start(req, businessId, membershipId, tokenHash);
      else if (Date.now() - row.lastActiveAt.getTime() >= TOUCH_MS) {
        await this.db.forBusiness(businessId).staffSession.updateMany({
          where: { id: row.id, revokedAt: null },
          data: { lastActiveAt: new Date() },
        });
      }
    } catch (e) {
      this.logger.warn(
        `Staff session not recorded (${e instanceof Error ? e.constructor.name : 'error'})`,
      );
    }
  }

  private async start(
    req: Request,
    businessId: string,
    membershipId: string,
    tokenHash: string,
  ): Promise<void> {
    const device = deviceLabel(req.get('user-agent'));
    const ip = canonicalIp(req.ip);
    await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      // Two first requests at once: the second waits, then finds the first one's row.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tokenHash}))) AS l`;
      const made = await tx.staffSession.findFirst({
        where: { tokenHash },
        select: { id: true },
      });
      if (made) return;
      const { id } = await tx.staffSession.create({
        data: {
          businessId,
          membershipId,
          tokenHash,
          device,
          // One form per address (no ::ffff: prefix); an odd one is left out.
          ip: ip === 'unknown' ? null : ip,
        },
        select: { id: true },
      });
      // The directory's Last Login. Only an existing row: a new one would take the defaults
      // (require a password change) that Create Staff sets on purpose.
      await tx.staffSecuritySettings.updateMany({
        where: { businessId, membershipId },
        data: { lastLoginAt: new Date() },
      });
      await this.audit.logIn(
        tx,
        FIRM_SESSION_STARTED,
        { type: 'staff_session', id },
        { membershipId, device },
        { businessId },
      );
    });
  }
}
