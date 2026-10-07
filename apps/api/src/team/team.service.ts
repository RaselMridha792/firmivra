import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Database, isDbError, type TxClient } from '@firmivra/db';
import type { MembershipRole, TeamMember } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { InvitesService } from '../auth/invites.service.js';
import { DATABASE } from '../database/database.module.js';

/** Who acts: the signed-in member, as TenantGuard resolved them. */
export interface TeamActor {
  userId: string;
  role: MembershipRole;
}

const ROLE_ORDER: Record<MembershipRole, number> = { OWNER: 0, ADMIN: 1, STAFF: 2 };

const memberSelect = {
  id: true,
  userId: true,
  role: true,
  status: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
  // The newest open invite (an expired one still shows, so the screen can offer Resend).
  invites: {
    where: { acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { createdAt: true, expiresAt: true },
  },
} as const;

type MemberRow = {
  id: string;
  userId: string;
  role: MembershipRole;
  status: TeamMember['status'];
  createdAt: Date;
  user: { id: string; name: string; email: string };
  invites: { createdAt: Date; expiresAt: Date }[];
};

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });

/** Ordering for the team list: Owners, then Admins, then Staff, each by name. */
export function byRoleThenName(
  a: { role: MembershipRole; user: { name: string } },
  b: { role: MembershipRole; user: { name: string } },
): number {
  return ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.user.name.localeCompare(b.user.name);
}

/** Admins manage Staff only; nobody acts on themselves. */
export function assertManageable(
  actor: TeamActor,
  target: { role: MembershipRole; userId: string },
) {
  if (actor.role === 'ADMIN' && target.role !== 'STAFF') throw forbidden();
  if (target.userId === actor.userId) {
    throw new ConflictException({
      code: 'CANNOT_CHANGE_SELF',
      message: 'You cannot change your own access',
    });
  }
}

/**
 * The firm's team (T03; contract in packages/types/src/team). Business scope only, with
 * `businessId` from TenantGuard. Inviting and resending go through R2's InvitesService. Audit
 * entries carry roles and ids only, never names or emails.
 */
@Injectable()
export class TeamService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly invites: InvitesService,
  ) {}

  async list(businessId: string, actor: TeamActor): Promise<TeamMember[]> {
    const rows = await this.database
      .forBusiness(businessId)
      .membership.findMany({ where: { businessId }, select: memberSelect });
    return rows.sort(byRoleThenName).map((row) => this.toMember(row, actor));
  }

  /** Owners only (the route allows OWNER), for ACTIVE members. */
  async changeRole(
    businessId: string,
    actor: TeamActor,
    memberId: string,
    role: MembershipRole,
  ): Promise<TeamMember> {
    const { row, from } = await this.change(businessId, actor, async (tx) => {
      const target = await this.find(tx, businessId, memberId);
      assertManageable(actor, target);
      if (target.status !== 'ACTIVE') {
        throw new ConflictException({
          code: 'NOT_ACTIVE',
          message: 'Invite this person again to change their role',
        });
      }
      if (target.role === role) return { row: target, from: role };
      const updated = await tx.membership.update({
        where: { businessId_id: { businessId, id: memberId } },
        data: { role },
        select: memberSelect,
      });
      return { row: updated, from: target.role };
    });
    if (from !== role) {
      await this.audit.log(
        'membership.role_changed',
        { type: 'membership', id: memberId },
        { from, to: role },
      );
    }
    return this.toMember(row, actor);
  }

  /** Ends access to this firm only and cancels an open invite. Repeating is harmless. */
  async deactivate(businessId: string, actor: TeamActor, memberId: string): Promise<TeamMember> {
    const { row, changed } = await this.change(businessId, actor, async (tx) => {
      const target = await this.find(tx, businessId, memberId);
      assertManageable(actor, target);
      if (target.status === 'DEACTIVATED') return { row: target, changed: false };
      await tx.invite.updateMany({
        where: { businessId, membershipId: memberId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const updated = await tx.membership.update({
        where: { businessId_id: { businessId, id: memberId } },
        data: { status: 'DEACTIVATED' },
        select: memberSelect,
      });
      return { row: updated, changed: true };
    });
    if (changed) {
      await this.audit.log(
        'membership.deactivated',
        { type: 'membership', id: memberId },
        { role: row.role },
      );
    }
    return this.toMember(row, actor);
  }

  /** A new link for an invited member, through R2's InvitesService (which audits it). */
  async resendInvite(businessId: string, actor: TeamActor, memberId: string): Promise<TeamMember> {
    const firm = this.database.forBusiness(businessId);
    const target = await firm.membership.findFirst({
      where: { businessId, id: memberId },
      select: { role: true, userId: true, status: true },
    });
    if (!target) throw notFound();
    assertManageable(actor, target);
    if (target.status !== 'INVITED') {
      throw new ConflictException({
        code: 'NOT_INVITED',
        message: 'This person has no open invite',
      });
    }
    await this.invites.resendInvite({ businessId, membershipId: memberId, invitedBy: actor });
    const row = await firm.membership.findFirstOrThrow({
      where: { businessId, id: memberId },
      select: memberSelect,
    });
    return this.toMember(row, actor);
  }

  /**
   * A change in the firm's scope. The actor's own membership is read again inside the
   * transaction, so someone demoted or deactivated a moment ago can no longer act.
   */
  private async change<T>(
    businessId: string,
    actor: TeamActor,
    fn: (tx: TxClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        const self = await tx.membership.findFirst({
          where: { businessId, userId: actor.userId, status: 'ACTIVE' },
          select: { role: true },
        });
        if (!self || (self.role !== 'OWNER' && self.role !== 'ADMIN')) throw forbidden();
        if (actor.role === 'OWNER' && self.role !== 'OWNER') throw forbidden();
        return fn(tx);
      });
    } catch (e) {
      if (isDbError(e, 'LAST_ACTIVE_OWNER')) {
        throw new ConflictException({
          code: 'LAST_ACTIVE_OWNER',
          message: 'The firm needs at least one active owner',
        });
      }
      throw e;
    }
  }

  private async find(tx: TxClient, businessId: string, memberId: string): Promise<MemberRow> {
    const row = await tx.membership.findFirst({
      where: { businessId, id: memberId },
      select: memberSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  private toMember(row: MemberRow, actor: TeamActor): TeamMember {
    const invite = row.status === 'INVITED' ? row.invites[0] : undefined;
    return {
      id: row.id,
      // Until #52's invites.name: the user row's name (R2 follow-up shows the typed name).
      user: { id: row.user.id, name: row.user.name, email: row.user.email },
      role: row.role,
      status: row.status,
      invite: invite
        ? { sentAt: invite.createdAt.toISOString(), expiresAt: invite.expiresAt.toISOString() }
        : null,
      isYou: row.userId === actor.userId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
