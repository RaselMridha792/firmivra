import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  StaffActionResult,
  StaffActivityPage,
  StaffLoginHistory,
  StaffSecurity,
  StaffSessionItem,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from '../auth/identity/identity-provider.js';
import { DATABASE } from '../database/database.module.js';
import { day, notFound } from '../workspaces/common.js';
import type { StaffAccessBody, StaffCursorQ } from './staff-input.js';
import { mfaOf } from './staff-read.service.js';
import { StaffWriteService } from './staff-write.service.js';
import {
  assertManages,
  lockTarget,
  mapStaffDbError,
  requireManager,
  revokeSessions,
  type StaffActor,
  staffConflict,
  type Target,
  targetSelect,
} from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;

/** The refresh token's life: a session not seen for longer is over. */
const SESSION_DAYS = 7;
/** "Active now": seen in the last five minutes. */
const ACTIVE_NOW_MS = 5 * 60 * 1000;
const LOGIN_ACTIONS = ['auth.signed_in', 'auth.sign_in_failed'];

/** The screen's words for the audit actions of a member's activity; others are shown as is. */
const LABELS: Record<string, string> = {
  'auth.signed_in': 'Logged in',
  'auth.sign_in_failed': 'Failed sign-in',
  'auth.signed_out': 'Logged out',
  'membership.invited': 'Invited',
  'membership.role_changed': 'Role changed',
  'membership.deactivated': 'Account deactivated',
  'membership.invite_revoked': 'Invitation revoked',
  'staff.created': 'Account created',
  'staff.updated': 'Profile updated',
  'staff.locked': 'Account locked',
  'staff.unlocked': 'Account unlocked',
  'staff.reactivated': 'Account reactivated',
  'staff.permissions_saved': 'Permissions changed',
  'staff.security_saved': 'Security settings changed',
  'staff.sessions_revoked': 'Signed out of sessions',
  'staff.password_reset_sent': 'Password reset sent',
  'staff.mfa_reset': 'MFA reset',
  'staff.note_saved': 'Notes updated',
  'staff.compensation_saved': 'Pay updated',
  'client.viewed': 'Viewed client records',
};
const labelOf = (action: string) =>
  LABELS[action] ?? action.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** A page's position: the last row's time and id, opaque to the screen. */
const encodeCursor = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | undefined {
  if (!cursor) return undefined;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const when = new Date(at ?? '');
  if (!id || Number.isNaN(when.getTime()) || !/^[0-9a-f-]{36}$/i.test(id))
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'This page link is not valid',
      details: [{ path: 'cursor', message: 'Start from the first page' }],
    });
  return { at: when, id };
}
const before = (c: { at: Date; id: string } | undefined): Prisma.AuditLogWhereInput =>
  c ? { OR: [{ createdAt: { lt: c.at } }, { createdAt: c.at, id: { lt: c.id } }] } : {};

/**
 * Staff Account Access & Security (R55): the sign-in rules, Active Sessions, Login History,
 * activity, and the high-risk resets. Owner and Admin; a change needs a role the actor manages.
 * Never a password, code or token in a request, an answer or the audit log.
 */
@Injectable()
export class StaffSecurityService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly audit: AuditService,
    private readonly write: StaffWriteService,
  ) {}

  private inFirm<T>(actor: StaffActor, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope(
      { kind: 'business', businessId: actor.businessId },
      async (tx) => {
        await requireManager(tx, actor);
        return fn(tx);
      },
    );
  }

  private async find(tx: TxClient, businessId: string, id: string): Promise<Target> {
    const row = await tx.membership.findFirst({ where: { businessId, id }, select: targetSelect });
    if (!row) throw notFound();
    return row as Target;
  }

  get(actor: StaffActor, id: string): Promise<StaffSecurity> {
    const { businessId } = actor;
    return this.inFirm(actor, async (tx) => {
      const m = await this.find(tx, businessId, id);
      const [s, profile, lastSession] = await Promise.all([
        tx.staffSecuritySettings.findUnique({
          where: { businessId_membershipId: { businessId, membershipId: id } },
        }),
        tx.staffProfile.findUnique({
          where: { businessId_membershipId: { businessId, membershipId: id } },
          select: { accessLevel: true },
        }),
        tx.staffSession.findFirst({
          where: { businessId, membershipId: id },
          orderBy: { createdAt: 'desc' },
          select: { device: true, place: true },
        }),
      ]);
      return {
        status: m.status,
        accessLevel: profile?.accessLevel ?? 'STANDARD_USER',
        role: m.role,
        lastLogin: s?.lastLoginAt
          ? {
              at: s.lastLoginAt.toISOString(),
              device: lastSession?.device ?? null,
              place: lastSession?.place ?? null,
            }
          : null,
        mfaRequired: true,
        mfa: mfaOf(m.status),
        passwordChangedAt: s?.passwordChangedAt?.toISOString() ?? null,
        requirePasswordChange: s?.requirePasswordChange ?? true,
        allowedAuthMethods: s?.allowedAuthMethods ?? ['AUTHENTICATOR_APP', 'BACKUP_CODES'],
        restrictDevices: s?.restrictDevices ?? false,
        autoLogoutMinutes: s?.autoLogoutMinutes ?? null,
        disableOn: day(s?.disableOn ?? null),
        accessLocation: s?.accessLocation ?? 'ANYWHERE',
        allowedIps: s?.allowedIps ?? [],
        allowedCountries: s?.allowedCountries ?? [],
        maxConcurrentSessions: s?.maxConcurrentSessions ?? 1,
        signOutOtherSessions: s?.signOutOtherSessions ?? false,
        allowTrustedDevices: s?.allowTrustedDevices ?? false,
        recoveryEmail: s?.recoveryEmail ?? null,
        recoveryEmailVerified: !!s?.recoveryEmailVerifiedAt,
        notices: {
          newDeviceLogin: s?.notifyNewDeviceLogin ?? true,
          failedLogins: s?.notifyFailedLogins ?? true,
          passwordChanges: s?.notifyPasswordChanges ?? true,
          securityAlerts: s?.notifySecurityAlerts ?? true,
          lockouts: s?.notifyLockouts ?? true,
        },
        lockedAt: s?.lockedAt?.toISOString() ?? null,
        lockedReason: s?.lockedReason ?? null,
      };
    });
  }

  /**
   * Saves the sign-in rules. A location rule needs its list: ALLOWED_IPS with no address, or
   * ALLOWED_COUNTRIES with no country, would lock the member out (400).
   */
  async update(
    actor: StaffActor,
    id: string,
    body: Out<typeof StaffAccessBody>,
  ): Promise<StaffSecurity> {
    const { businessId } = actor;
    try {
      await this.inFirm(actor, async (tx) => {
        const target = await lockTarget(tx, businessId, id);
        assertManages(actor, target);
        const now = await tx.staffSecuritySettings.findUnique({
          where: { businessId_membershipId: { businessId, membershipId: id } },
          select: { accessLocation: true, allowedIps: true, allowedCountries: true },
        });
        const location = body.accessLocation ?? now?.accessLocation ?? 'ANYWHERE';
        if (location === 'ALLOWED_IPS' && !(body.allowedIps ?? now?.allowedIps ?? []).length)
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'Add at least one IP address',
            details: [{ path: 'allowedIps', message: 'Add at least one IP address' }],
          });
        if (
          location === 'ALLOWED_COUNTRIES' &&
          !(body.allowedCountries ?? now?.allowedCountries ?? []).length
        )
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'Add at least one country',
            details: [{ path: 'allowedCountries', message: 'Add at least one country' }],
          });
        await this.write.writeAccess(tx, businessId, id, body);
        await this.audit.logIn(
          tx,
          'staff.security_saved',
          { type: 'membership', id },
          {
            fields: Object.keys(body)
              .filter((k) => (body as Record<string, unknown>)[k] !== undefined)
              .sort(),
          },
          { businessId },
        );
      });
    } catch (e) {
      throw mapStaffDbError(e);
    }
    return this.get(actor, id);
  }

  sessions(actor: StaffActor, id: string): Promise<StaffSessionItem[]> {
    const { businessId } = actor;
    return this.inFirm(actor, async (tx) => {
      await this.find(tx, businessId, id);
      const since = new Date(Date.now() - SESSION_DAYS * 86_400_000);
      const rows = await tx.staffSession.findMany({
        where: { businessId, membershipId: id, revokedAt: null, lastActiveAt: { gte: since } },
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
      }));
    });
  }

  /** Sign out one session (Active Sessions' row menu). Repeating is harmless. */
  async revokeSession(
    actor: StaffActor,
    id: string,
    sessionId: string,
  ): Promise<StaffActionResult> {
    const { businessId } = actor;
    return this.inFirm(actor, async (tx) => {
      const target = await this.find(tx, businessId, id);
      assertManages(actor, target);
      const session = await tx.staffSession.findFirst({
        where: { businessId, membershipId: id, id: sessionId },
        select: { revokedAt: true },
      });
      if (!session) throw notFound();
      const { count } = await tx.staffSession.updateMany({
        where: { businessId, id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count)
        await this.audit.logIn(
          tx,
          'staff.sessions_revoked',
          { type: 'membership', id },
          { sessionId, sessionsRevoked: count },
          { businessId },
        );
      return { ok: true, status: target.status, sessionsRevoked: count, invitation: null };
    });
  }

  /** Sign Out All Sessions: every session of the member at this firm. */
  revokeAll(actor: StaffActor, id: string, reasonGiven: boolean): Promise<StaffActionResult> {
    const { businessId } = actor;
    return this.inFirm(actor, async (tx) => {
      const target = await this.find(tx, businessId, id);
      assertManages(actor, target);
      const sessionsRevoked = await revokeSessions(tx, businessId, id);
      await this.audit.logIn(
        tx,
        'staff.sessions_revoked',
        { type: 'membership', id },
        { all: true, sessionsRevoked, reasonGiven },
        { businessId },
      );
      return { ok: true, status: target.status, sessionsRevoked, invitation: null };
    });
  }

  /** The member's login and their (signed-in) status, for a reset: someone who can sign in. */
  private async signInTarget(actor: StaffActor, id: string) {
    const { businessId } = actor;
    return this.inFirm(actor, async (tx) => {
      const target = await this.find(tx, businessId, id);
      assertManages(actor, target);
      if (target.status !== 'ACTIVE' && target.status !== 'LOCKED')
        throw staffConflict(
          'NOT_ACTIVE',
          target.status === 'INVITED'
            ? 'This person has not set a password yet: resend the invitation instead'
            : 'Reactivate this member first',
        );
      const user = await tx.user.findUnique({
        where: { id: target.userId },
        select: { cognitoSub: true },
      });
      if (!user) throw notFound();
      return { target, sub: user.cognitoSub };
    });
  }

  /**
   * Reset Password: the identity service emails the person a reset code; nobody ever sees a
   * password. The person's other sessions end when they set the new one.
   */
  async resetPassword(
    actor: StaffActor,
    id: string,
    reasonGiven: boolean,
  ): Promise<StaffActionResult> {
    const { target, sub } = await this.signInTarget(actor, id);
    await this.identity.forgotPassword('STAFF', sub);
    await this.database.withScope(
      { kind: 'business', businessId: actor.businessId },
      async (tx) => {
        await tx.staffSecuritySettings.upsert({
          where: {
            businessId_membershipId: { businessId: actor.businessId, membershipId: id },
          },
          create: { businessId: actor.businessId, membershipId: id, requirePasswordChange: true },
          update: { requirePasswordChange: true },
        });
        await this.audit.logIn(
          tx,
          'staff.password_reset_sent',
          { type: 'membership', id },
          { reasonGiven },
          { businessId: actor.businessId },
        );
      },
    );
    return { ok: true, status: target.status, sessionsRevoked: 0, invitation: null };
  }

  /**
   * Reset MFA (high risk): the login's authenticator is forgotten, so the next sign-in sets one
   * up again, and every session ends. The login is the person's at every firm they work for.
   */
  async resetMfa(actor: StaffActor, id: string, reasonGiven: boolean): Promise<StaffActionResult> {
    const { target, sub } = await this.signInTarget(actor, id);
    await this.identity.resetMfa('STAFF', sub);
    const sessionsRevoked = await this.database.withScope(
      { kind: 'business', businessId: actor.businessId },
      async (tx) => {
        const n = await revokeSessions(tx, actor.businessId, id);
        await this.audit.logIn(
          tx,
          'staff.mfa_reset',
          { type: 'membership', id },
          { reasonGiven, sessionsRevoked: n },
          { businessId: actor.businessId },
        );
        return n;
      },
    );
    return { ok: true, status: target.status, sessionsRevoked, invitation: null };
  }

  /**
   * Login History: the firm's sign-in rows for the member (`auth.signed_in`, `auth.sign_in_failed`),
   * newest first. IP and device are telemetry from the request; place needs an IP lookup.
   */
  loginHistory(
    actor: StaffActor,
    id: string,
    q: Out<typeof StaffCursorQ>,
  ): Promise<StaffLoginHistory> {
    const { businessId } = actor;
    return this.inFirm(actor, async (tx) => {
      const m = await this.find(tx, businessId, id);
      const rows = await tx.auditLog.findMany({
        where: {
          AND: [
            { businessId, actorUserId: m.userId, action: { in: LOGIN_ACTIONS } },
            before(decodeCursor(q.cursor)),
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: { id: true, createdAt: true, action: true, ip: true, userAgent: true },
      });
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => ({
          at: r.createdAt.toISOString(),
          outcome: r.action === 'auth.signed_in' ? ('SUCCESS' as const) : ('FAILED' as const),
          place: null,
          ip: r.ip,
          device: r.userAgent?.slice(0, 100) ?? null,
        })),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    });
  }

  /** Recent Activity and Activity & Audit: rows by the member, and about them. */
  activity(actor: StaffActor, id: string, q: Out<typeof StaffCursorQ>): Promise<StaffActivityPage> {
    const { businessId } = actor;
    return this.inFirm(actor, async (tx) => {
      const m = await this.find(tx, businessId, id);
      const rows = await tx.auditLog.findMany({
        where: {
          AND: [
            { businessId },
            {
              OR: [{ actorUserId: m.userId }, { entityType: 'membership', entityId: id }],
            },
            before(decodeCursor(q.cursor)),
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: { id: true, createdAt: true, action: true, actorUserId: true },
      });
      const page = rows.slice(0, q.limit);
      const others = [
        ...new Set(
          page.flatMap((r) => (r.actorUserId && r.actorUserId !== m.userId ? [r.actorUserId] : [])),
        ),
      ];
      const names = new Map(
        (others.length
          ? await tx.membership.findMany({
              where: { businessId, userId: { in: others } },
              select: { userId: true, user: { select: { name: true } } },
            })
          : []
        ).map((x) => [x.userId, x.user.name]),
      );
      const last = page.at(-1);
      return {
        items: page.map((r) => ({
          id: r.id,
          at: r.createdAt.toISOString(),
          action: r.action,
          label: labelOf(r.action),
          actorName:
            r.actorUserId && r.actorUserId !== m.userId ? (names.get(r.actorUserId) ?? null) : null,
        })),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    });
  }
}
