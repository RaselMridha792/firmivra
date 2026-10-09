import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type Database,
  databaseErrorCode,
  isDbError,
  type Prisma,
  type TxClient,
} from '@firmivra/db';
import type { MembershipRole, TeamMember } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { InvitesService, lockStaffInvites } from '../auth/invites.service.js';
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
  joinedAt: true,
  createdAt: true,
  // The newest invite, open or not: its typed name and email until the person joins (#52), and,
  // while it is open, when it was sent and expires (an expired one still shows, for Resend).
  invites: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      name: true,
      email: true,
      createdAt: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
    },
  },
} satisfies Prisma.MembershipSelect;

type MemberRow = {
  id: string;
  userId: string;
  role: MembershipRole;
  status: TeamMember['status'];
  joinedAt: Date | null;
  createdAt: Date;
  invites: {
    name: string | null;
    email: string | null;
    createdAt: Date;
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
  }[];
};

type Person = { id: string; name: string; email: string };

/** Joined: the database stamped joined_at, the member is active, or their invite was used. */
const hasJoined = (row: Pick<MemberRow, 'joinedAt' | 'status' | 'invites'>) =>
  row.joinedAt !== null || row.status === 'ACTIVE' || !!row.invites[0]?.acceptedAt;

/**
 * Whose user row the firm may read for this member: a joined person, or an invited one whose
 * newest invite lacks what was typed (invites made before #52). Anyone else's user row is never
 * read: it may soon be hidden until the person joins (R0's staged change), and the typed name
 * and email are what the firm sees.
 */
export const needsUserRow = (row: Pick<MemberRow, 'joinedAt' | 'status' | 'invites'>) =>
  hasJoined(row) || !row.invites[0]?.name || !row.invites[0]?.email;

/**
 * Who the firm sees: until the person joins, the name and email the inviter typed on the newest
 * invite (#52: never the person's own user row, which another firm or the person may have filled
 * in); the user row only for what an invite made before #52 lacks, as R2's resend does. Once the
 * person has joined, their user row. `user` is that row when it was read (and visible).
 */
export function shownPerson(
  row: Pick<MemberRow, 'userId' | 'joinedAt' | 'status' | 'invites'>,
  user: Person | undefined,
): Person {
  const latest = row.invites[0];
  if (hasJoined(row) || !latest) {
    return user ?? { id: row.userId, name: '', email: '' };
  }
  return {
    id: row.userId,
    name: latest.name ?? user?.name ?? '',
    email: latest.email ?? user?.email ?? '',
  };
}

/** The user rows the firm may read for these members (see needsUserRow), by id. */
async function usersOf(
  rows: MemberRow[],
  read: (ids: string[]) => Promise<Person[]>,
): Promise<Map<string, Person>> {
  const ids = rows.filter(needsUserRow).map((r) => r.userId);
  if (ids.length === 0) return new Map();
  return new Map((await read(ids)).map((u) => [u.id, u]));
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

/** The member changed between our read and our write (another request got there first). */
class MemberChanged extends Error {}

/** Postgres gave up one of two transactions waiting on each other: safe to run again. */
const isDeadlock = (e: unknown) =>
  databaseErrorCode(e) === '40P01' || (e as { code?: string }).code === 'P2034';
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
    const users = await usersOf(rows, this.readUsers(businessId));
    // Sorted by the name the firm sees (the typed one until the person joins).
    return rows.map((row) => this.toMember(row, users, actor)).sort(byRoleThenName);
  }

  /** Owners only (the route allows OWNER), for ACTIVE members. */
  async changeRole(
    businessId: string,
    actor: TeamActor,
    memberId: string,
    role: MembershipRole,
  ): Promise<TeamMember> {
    const row = await this.change(businessId, actor, async (tx) => {
      const target = await this.find(tx, businessId, memberId);
      assertManageable(actor, target);
      if (target.status !== 'ACTIVE') {
        throw new ConflictException({
          code: 'NOT_ACTIVE',
          message: 'Invite this person again to change their role',
        });
      }
      if (target.role === role) return target;
      // Only if the member is still as we read them (not deactivated or changed meanwhile).
      await this.updateIfUnchanged(tx, businessId, target, { role });
      // With the change, so both land or neither does (and a retry writes it once).
      await this.audit.logIn(
        tx,
        'membership.role_changed',
        { type: 'membership', id: memberId },
        { from: target.role, to: role },
        { businessId },
      );
      return this.find(tx, businessId, memberId);
    });
    return this.member(businessId, row, actor);
  }

  /**
   * Ends access to this firm only and cancels an open invite. Repeating is harmless. The open
   * invite is revoked first, then the membership changed: the lock order of activation (R2's
   * use()) and resend. While an activation holds those invite rows (it sets the password in
   * Cognito under OUTSIDE_CALL_LIMITS, #92), this waits; if that outlasts this transaction's own
   * time limit, the answer is 503 SERVICE_BUSY (the global P2028 mapping) and nothing changed.
   */
  async deactivate(businessId: string, actor: TeamActor, memberId: string): Promise<TeamMember> {
    const row = await this.change(businessId, actor, async (tx) => {
      const target = await this.find(tx, businessId, memberId);
      assertManageable(actor, target);
      if (target.status === 'DEACTIVATED') return target;
      // InvitesService's lock: a resend making a link either commits first (and its link is
      // revoked below) or waits and then finds the member deactivated.
      await lockStaffInvites(tx, businessId, target.userId);
      await tx.invite.updateMany({
        where: { businessId, membershipId: memberId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.updateIfUnchanged(tx, businessId, target, { status: 'DEACTIVATED' });
      // With the change, so both land or neither does (and a retry writes it once).
      await this.audit.logIn(
        tx,
        'membership.deactivated',
        { type: 'membership', id: memberId },
        { role: target.role },
        { businessId },
      );
      return this.find(tx, businessId, memberId);
    });
    return this.member(businessId, row, actor);
  }

  /** A new link for an invited member, through R2's InvitesService (which audits it). */
  async resendInvite(businessId: string, actor: TeamActor, memberId: string): Promise<TeamMember> {
    const firm = this.database.forBusiness(businessId);
    await this.database.withScope({ kind: 'business', businessId }, (tx) =>
      this.assertActor(tx, businessId, actor),
    );
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
    return this.member(businessId, row, actor);
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
    // Once more if the member changed under us or Postgres broke a deadlock: the second run
    // reads the new state and answers from it (409, 403 or nothing to do).
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
          await this.assertActor(tx, businessId, actor);
          return fn(tx);
        });
      } catch (e) {
        if (isDbError(e, 'LAST_ACTIVE_OWNER')) {
          throw new ConflictException({
            code: 'LAST_ACTIVE_OWNER',
            message: 'The firm needs at least one active owner',
          });
        }
        if ((e instanceof MemberChanged || isDeadlock(e)) && attempt < 2) continue;
        if (e instanceof MemberChanged) {
          throw new ConflictException({
            code: 'CONFLICT',
            message: 'This person was just changed by someone else. Reload and try again.',
          });
        }
        throw e;
      }
    }
  }

  /** The actor is still an active Owner or Admin (and still an Owner if they acted as one). */
  private async assertActor(tx: TxClient, businessId: string, actor: TeamActor): Promise<void> {
    const self = await tx.membership.findFirst({
      where: { businessId, userId: actor.userId, status: 'ACTIVE' },
      select: { role: true },
    });
    if (!self || (self.role !== 'OWNER' && self.role !== 'ADMIN')) throw forbidden();
    if (actor.role === 'OWNER' && self.role !== 'OWNER') throw forbidden();
  }

  /** Writes only while the member's role and status are as read; else MemberChanged. */
  private async updateIfUnchanged(
    tx: TxClient,
    businessId: string,
    target: MemberRow,
    data: { role?: MembershipRole; status?: 'DEACTIVATED' },
  ): Promise<void> {
    const { count } = await tx.membership.updateMany({
      where: { businessId, id: target.id, role: target.role, status: target.status },
      data,
    });
    if (count !== 1) throw new MemberChanged();
  }

  private async find(tx: TxClient, businessId: string, memberId: string): Promise<MemberRow> {
    const row = await tx.membership.findFirst({
      where: { businessId, id: memberId },
      select: memberSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  /** One member as the firm sees it, with the user row only where it may be read. */
  private async member(businessId: string, row: MemberRow, actor: TeamActor) {
    const users = await usersOf([row], this.readUsers(businessId));
    return this.toMember(row, users, actor);
  }

  private readUsers(businessId: string) {
    const firm = this.database.forBusiness(businessId);
    return (ids: string[]) =>
      firm.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      });
  }

  private toMember(row: MemberRow, users: Map<string, Person>, actor: TeamActor): TeamMember {
    // The open invite of an invited member (the newest invite; resend revokes the one before).
    const latest = row.invites[0];
    const invite =
      row.status === 'INVITED' && latest && !latest.acceptedAt && !latest.revokedAt
        ? latest
        : undefined;
    return {
      id: row.id,
      user: shownPerson(row, users.get(row.userId)),
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
