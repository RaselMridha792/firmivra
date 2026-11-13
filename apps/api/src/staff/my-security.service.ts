import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { MySecurityResult, MySessionItem } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { httpError } from '../auth/auth-errors.js';
import {
  AuthFlowError,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from '../auth/identity/identity-provider.js';
import { sessionKey } from '../auth/staff-sessions.js';
import type { AuthContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from '../workspaces/common.js';

/** The refresh token's life: a session not seen for longer is over. */
const SESSION_DAYS = 7;
/** "Active now": seen in the last five minutes. */
const ACTIVE_NOW_MS = 5 * 60 * 1000;

const wrongPassword = () =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Your current password is not right',
    details: [{ path: 'currentPassword', message: 'Your current password is not right' }],
  });

/**
 * SM14 part B: the signed-in member's own sessions and password in the selected firm (any staff
 * role). "This session" is the request's own row (SM4's key: the firm and the sign-in's id), so
 * Sign Out All Other Sessions keeps it. A dev token has no session: then every session is
 * "other". Each action is audited in the firm's log, never with a password.
 */
@Injectable()
export class MySecurityService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
  ) {}

  sessions(businessId: string, auth: AuthContext): Promise<MySessionItem[]> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      const me = await this.me(tx, businessId, auth.userId);
      const current = auth.session ? sessionKey(businessId, auth.session) : null;
      const since = new Date(Date.now() - SESSION_DAYS * 86_400_000);
      const rows = await tx.staffSession.findMany({
        where: { businessId, membershipId: me, revokedAt: null, lastActiveAt: { gte: since } },
        orderBy: [{ lastActiveAt: 'desc' }, { id: 'desc' }],
        take: 50,
      });
      return rows.map((r) => ({
        id: r.id,
        device: r.device,
        place: r.place,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
        lastActiveAt: r.lastActiveAt.toISOString(),
        activeNow: Date.now() - r.lastActiveAt.getTime() < ACTIVE_NOW_MS,
        current: r.tokenHash === current,
      }));
    });
  }

  /** Sign Out All Other Sessions: every open session of mine in this firm but this one. */
  signOutOthers(businessId: string, auth: AuthContext): Promise<MySecurityResult> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      const me = await this.me(tx, businessId, auth.userId);
      const sessionsRevoked = await this.endOthers(tx, businessId, me, auth);
      await this.audit.logIn(
        tx,
        'staff.own_sessions_signed_out',
        { type: 'membership', id: me },
        { sessionsRevoked },
        { businessId },
      );
      return { ok: true, sessionsRevoked };
    });
  }

  /**
   * Change My Password: the current password first (the staff pool's sign-in check, a fresh
   * sign-in), then the new one is set and my other sessions in this firm are signed out. A wrong
   * current password is audited too (no password in either row).
   */
  async changePassword(
    businessId: string,
    auth: AuthContext,
    body: { currentPassword: string; newPassword: string },
  ): Promise<MySecurityResult> {
    const me = await this.db.withScope({ kind: 'business', businessId }, (tx) =>
      this.me(tx, businessId, auth.userId),
    );
    if (!(await this.passwordOk(auth.cognitoSub, body.currentPassword))) {
      await this.audit.log(
        'staff.password_change_failed',
        { type: 'membership', id: me },
        { reason: 'CURRENT_PASSWORD' },
        { businessId },
      );
      throw wrongPassword();
    }
    await this.identity
      .setPassword('STAFF', auth.cognitoSub, body.newPassword)
      .catch((e: unknown) => {
        throw e instanceof AuthFlowError ? httpError(e.code) : e;
      });
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      // Only an existing settings row: a new one would take Create Staff's defaults.
      await tx.staffSecuritySettings.updateMany({
        where: { businessId, membershipId: me },
        data: { passwordChangedAt: new Date(), requirePasswordChange: false },
      });
      const sessionsRevoked = await this.endOthers(tx, businessId, me, auth);
      await this.audit.logIn(
        tx,
        'staff.password_changed',
        { type: 'membership', id: me },
        { sessionsRevoked },
        { businessId },
      );
      return { ok: true, sessionsRevoked };
    });
  }

  /** My active membership here (the tenant guard found it a moment ago). */
  private async me(tx: TxClient, businessId: string, userId: string): Promise<string> {
    const m = await tx.membership.findFirst({
      where: { businessId, userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!m) throw notFound();
    return m.id;
  }

  private async endOthers(
    tx: TxClient,
    businessId: string,
    membershipId: string,
    auth: AuthContext,
  ): Promise<number> {
    const current = auth.session ? sessionKey(businessId, auth.session) : null;
    const { count } = await tx.staffSession.updateMany({
      where: {
        businessId,
        membershipId,
        revokedAt: null,
        ...(current ? { NOT: { tokenHash: current } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** True for the member's own password (as the kiosk's exit checks it). */
  private async passwordOk(cognitoSub: string, password: string): Promise<boolean> {
    try {
      const step = await this.identity.signIn('STAFF', cognitoSub, password);
      // A sign-in that completed (no MFA asked) made tokens nobody uses: revoke them.
      if (step.kind === 'tokens' && step.tokens.refreshToken) {
        await this.identity.revoke('STAFF', step.tokens.refreshToken);
      }
      return true;
    } catch (error) {
      if (!(error instanceof AuthFlowError)) throw error;
      if (error.code === 'INVALID_CREDENTIALS') return false;
      throw httpError(error.code);
    }
  }
}
