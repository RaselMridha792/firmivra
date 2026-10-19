import { Inject, Injectable } from '@nestjs/common';
import { databaseErrorCode, type Database, type TxClient } from '@firmivra/db';
import type { StaffActionResult } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { InvitesService, lockStaffInvites } from '../auth/invites.service.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from '../workspaces/common.js';
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

/** The member changed between our read and our write: read again and decide once more. */
class MemberChanged extends Error {}

const result = (
  status: StaffActionResult['status'],
  sessionsRevoked = 0,
  invitation: StaffActionResult['invitation'] = null,
): StaffActionResult => ({ ok: true, status, sessionsRevoked, invitation });

/**
 * The account actions of Staff Management (R55): lock, unlock, deactivate, reactivate, resend
 * and revoke an invite. Each signs the member's sessions here out where it ends access; the
 * tenant guard refuses a member who is not ACTIVE on the next request anyway. A reason is kept
 * on the member (lock) and never in the audit log.
 */
@Injectable()
export class StaffActionsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly invites: InvitesService,
  ) {}

  /** A change in the firm's scope, run once more if the member changed under it. */
  private async change<T>(actor: StaffActor, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.database.withScope(
          { kind: 'business', businessId: actor.businessId },
          async (tx) => {
            await requireManager(tx, actor);
            return fn(tx);
          },
        );
      } catch (e) {
        const retry =
          e instanceof MemberChanged ||
          databaseErrorCode(e) === '40P01' ||
          (e as { code?: string }).code === 'P2034';
        if (retry && attempt < 2) continue;
        if (e instanceof MemberChanged)
          throw staffConflict(
            'CONFLICT',
            'This person was just changed by someone else. Reload and try again.',
          );
        throw mapStaffDbError(e);
      }
    }
  }

  private async find(tx: TxClient, businessId: string, id: string): Promise<Target> {
    const row = await tx.membership.findFirst({ where: { businessId, id }, select: targetSelect });
    if (!row) throw notFound();
    return row as Target;
  }

  private async move(
    tx: TxClient,
    businessId: string,
    target: Target,
    status: 'ACTIVE' | 'LOCKED' | 'DEACTIVATED',
  ) {
    const { count } = await tx.membership.updateMany({
      where: { businessId, id: target.id, status: target.status, role: target.role },
      data: { status },
    });
    if (count !== 1) throw new MemberChanged();
  }

  /** Lock Account: ACTIVE to LOCKED, with the reason; the last active owner is refused. */
  lock(actor: StaffActor, id: string, reason: string): Promise<StaffActionResult> {
    const { businessId } = actor;
    return this.change(actor, async (tx) => {
      const target = await lockTarget(tx, businessId, id);
      assertManages(actor, target);
      if (target.status === 'LOCKED') return result('LOCKED');
      if (target.status !== 'ACTIVE')
        throw staffConflict('NOT_ACTIVE', 'Only an active member can be locked');
      await this.move(tx, businessId, target, 'LOCKED');
      const at = new Date();
      await tx.staffSecuritySettings.upsert({
        where: { businessId_membershipId: { businessId, membershipId: id } },
        create: { businessId, membershipId: id, lockedAt: at, lockedReason: reason },
        update: { lockedAt: at, lockedReason: reason },
      });
      const sessionsRevoked = await revokeSessions(tx, businessId, id);
      await this.audit.logIn(
        tx,
        'staff.locked',
        { type: 'membership', id },
        { role: target.role, sessionsRevoked },
        { businessId },
      );
      return result('LOCKED', sessionsRevoked);
    });
  }

  /** Unlock: LOCKED to ACTIVE; the lock's time and reason are cleared. */
  unlock(actor: StaffActor, id: string): Promise<StaffActionResult> {
    const { businessId } = actor;
    return this.change(actor, async (tx) => {
      const target = await lockTarget(tx, businessId, id);
      assertManages(actor, target);
      if (target.status === 'ACTIVE') return result('ACTIVE');
      if (target.status !== 'LOCKED')
        throw staffConflict('NOT_LOCKED', 'This account is not locked');
      await this.move(tx, businessId, target, 'ACTIVE');
      await tx.staffSecuritySettings.updateMany({
        where: { businessId, membershipId: id },
        data: { lockedAt: null, lockedReason: null },
      });
      await this.audit.logIn(
        tx,
        'staff.unlocked',
        { type: 'membership', id },
        { role: target.role },
        { businessId },
      );
      return result('ACTIVE');
    });
  }

  /**
   * Deactivate: ends access to this firm only, keeps the record, cancels an open invite and
   * signs the sessions out. Repeating is harmless. The lock order is TeamService's (the
   * per-person invite lock, the invites, then the membership), shared with activation and resend.
   */
  deactivate(actor: StaffActor, id: string, reasonGiven: boolean): Promise<StaffActionResult> {
    const { businessId } = actor;
    return this.change(actor, async (tx) => {
      const target = await this.find(tx, businessId, id);
      assertManages(actor, target);
      if (target.status === 'DEACTIVATED') return result('DEACTIVATED');
      await lockStaffInvites(tx, businessId, target.userId);
      await tx.invite.updateMany({
        where: { businessId, membershipId: id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.move(tx, businessId, target, 'DEACTIVATED');
      const sessionsRevoked = await revokeSessions(tx, businessId, id);
      await this.audit.logIn(
        tx,
        'membership.deactivated',
        { type: 'membership', id },
        { role: target.role, reasonGiven, sessionsRevoked },
        { businessId },
      );
      return result('DEACTIVATED', sessionsRevoked);
    });
  }

  /** Revoke Invitation: the open link stops working and the member is DEACTIVATED (kept). */
  revokeInvite(actor: StaffActor, id: string): Promise<StaffActionResult> {
    const { businessId } = actor;
    return this.change(actor, async (tx) => {
      const target = await this.find(tx, businessId, id);
      assertManages(actor, target);
      if (target.status !== 'INVITED')
        throw staffConflict('NOT_INVITED', 'This person has no open invite');
      await lockStaffInvites(tx, businessId, target.userId);
      await tx.invite.updateMany({
        where: { businessId, membershipId: id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.move(tx, businessId, target, 'DEACTIVATED');
      await this.audit.logIn(
        tx,
        'membership.invite_revoked',
        { type: 'membership', id },
        { role: target.role },
        { businessId },
      );
      return result('DEACTIVATED');
    });
  }

  /** Resend Invitation: a fresh link through R2's InvitesService (which audits it). */
  async resendInvite(actor: StaffActor, id: string): Promise<StaffActionResult> {
    const { businessId } = actor;
    await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await requireManager(tx, actor);
      const target = await this.find(tx, businessId, id);
      assertManages(actor, target);
      if (target.status !== 'INVITED')
        throw staffConflict('NOT_INVITED', 'This person has no open invite');
    });
    const sent = await this.invites.resendInvite({
      businessId,
      membershipId: id,
      invitedBy: { userId: actor.userId, role: actor.role },
    });
    return result('INVITED', 0, {
      status: 'SENT',
      sentAt: new Date().toISOString(),
      expiresAt: sent.expiresAt,
    });
  }

  /**
   * Reactivate: someone who had joined is ACTIVE again at once. Someone who never joined gets a
   * new invite (INVITED), to their login's own email, through InvitesService.
   */
  async reactivate(actor: StaffActor, id: string): Promise<StaffActionResult> {
    const { businessId } = actor;
    const joined = await this.change(actor, async (tx) => {
      const target = await this.find(tx, businessId, id);
      assertManages(actor, target);
      if (target.status === 'ACTIVE' || target.status === 'INVITED')
        return { done: result(target.status) };
      if (target.status !== 'DEACTIVATED')
        throw staffConflict('NOT_DEACTIVATED', 'Only a deactivated member can be reactivated');
      if (!target.joinedAt) {
        const [user, latest] = await Promise.all([
          tx.user.findUnique({
            where: { id: target.userId },
            select: { name: true, email: true },
          }),
          tx.invite.findFirst({
            where: { businessId, membershipId: id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { name: true },
          }),
        ]);
        if (!user) throw notFound();
        return {
          invite: { email: user.email, name: latest?.name ?? user.name, role: target.role },
        };
      }
      await this.move(tx, businessId, target, 'ACTIVE');
      await this.audit.logIn(
        tx,
        'staff.reactivated',
        { type: 'membership', id },
        { role: target.role, to: 'ACTIVE' },
        { businessId },
      );
      return { done: result('ACTIVE') };
    });
    if (joined.done) return joined.done;
    const invite = await this.invites.createInvite({
      businessId,
      email: joined.invite.email,
      name: joined.invite.name,
      role: joined.invite.role,
      invitedBy: { userId: actor.userId, role: actor.role },
      delivery: 'try',
    });
    await this.audit.log(
      'staff.reactivated',
      { type: 'membership', id },
      { role: joined.invite.role, to: 'INVITED', inviteId: invite.id },
      { businessId },
    );
    return result(
      'INVITED',
      0,
      invite.emailed
        ? { status: 'SENT', sentAt: new Date().toISOString(), expiresAt: invite.expiresAt }
        : { status: 'FAILED', sentAt: null, expiresAt: null },
    );
  }
}
