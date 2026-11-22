import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  ADMIN_TEAM_ACTIVITY_ACTIONS as ACTIONS,
  type AdminTeamInvitationResult,
  type AdminTeamInvitationSent,
  type AdminTeamMember,
  type AdminTeamMemberResult,
  type PlatformRole,
} from '@firmivra/types';
import { isUniqueViolation } from '../appointments/errors.js';
import { AuditService } from '../audit/audit.service.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from '../auth/identity/identity-provider.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { errorName } from '../notifications/notifier.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { asTeamError, loadContext, refuse, type TeamContext } from './team-context.js';
import {
  type InviteChannels,
  invitationEmail,
  invitationExpiry,
  invitationLink,
  invitationSms,
  overLimit,
  TEAM_INVITE_LIMITS,
  TeamInvitationTokens,
} from './team-invitation.js';
import { type CreateBody, planCreate, planResend, type ResendBody } from './team-plan.js';
import { extrasFor } from './team-read.service.js';
import { memberView } from './team-views.js';

const ENTITY = 'platform_member';

/**
 * Every invitation transaction takes this lock before it counts, so two requests never pass the
 * same count (the caps are the platform's, not a firm's: one key for all of them).
 */
const lockInvitations = (tx: TxClient) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin-team-invite', 0))`;

/** How the link came about, in its audit entry. */
type Via = 'CREATE' | 'RESEND' | 'APPROVAL';

/** Who a link goes to: the login's name, email and phone. */
export interface Recipient {
  name: string;
  email: string;
  phone: string | null;
}

/** A link made in an admin transaction, to seal and send once that transaction commits. */
export interface IssuedLink {
  userId: string;
  /** The member row's `updated_at` the token holds. */
  memberUpdatedAt: Date;
  expiresAt: Date;
  channels: InviteChannels;
  to: Recipient;
}

/** Why no link was made for a person (the contract's skip reasons). */
export type NotIssued = 'RATE_LIMITED' | 'NOT_PENDING_INVITATION';

/**
 * Add Team Member, Resend Invitation and the invitation the department head's APPROVE sends
 * (R60 builds the admin invite in the Team module: Rasel, Oct 20; docs/work/R60-team.md, "Team
 * invitations"). The ADMIN-pool login through the identity adapter, its `users` and
 * `platform_admins` rows in platform scope (`adminUserFor`, nothing else there), and everything
 * else in the Super Admin's admin scope: the org-chart row, its overrides, the audit rows and the
 * links. A link is a sealed value (`TeamInvitationTokens`) sent by email (and text) through
 * NotifyService after its transaction commits; it is never logged or stored.
 */
@Injectable()
export class TeamInviteService {
  private readonly logger = new Logger(TeamInviteService.name);

  constructor(
    private readonly admin: AdminPrisma,
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    private readonly tokens: TeamInvitationTokens,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Add Team Member. The checks run before any login is made (nobody without the right, and no
   * capped day, creates a Cognito login), then again where the row is written. The login and its
   * admin row are made, or reused from a create that failed half-way; the org-chart row, its
   * overrides, `platform_member.created` and (unless the hire waits for the department head, or
   * no channel is chosen) the link and its `platform_member.invited` land together, or not at
   * all. A row written by a parallel create for the same person first is 409 EMAIL_TAKEN.
   */
  async create(body: CreateBody): Promise<AdminTeamMemberResult> {
    const checked = await this.run(async (tx, ctx) => {
      const plan = planCreate(ctx, body);
      if (plan.invite) {
        const login = ctx.rows.users.find((u) => u.email === plan.email);
        if (overLimit(await this.sentToday(tx, login?.id ?? null))) throw refuse('RATE_LIMITED');
      }
      return plan;
    });
    const userId = await this.adminUserFor(checked.email, checked.name, checked.phone);
    const link = await this.run(async (tx, ctx) => {
      // On the rows as they are now: the login just made (or reused) is in them.
      const plan = planCreate(ctx, body);
      const at = new Date();
      try {
        await tx.platformMember.create({
          data: {
            userId,
            roleDefinitionId: plan.row.roleId,
            departmentId: plan.row.departmentId,
            reportsToUserId: plan.row.reportsToId,
            scopeType: plan.row.scope,
            scopeIds: plan.row.scopeIds,
            status: plan.row.status,
            intendedRoleDefinitionId: plan.row.intendedRoleId,
            invitedByUserId: ctx.actor.id,
            createdAt: at,
            updatedAt: at,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw refuse('EMAIL_TAKEN');
        throw error;
      }
      if (plan.overrides.length)
        await tx.platformMemberPermissionOverride.createMany({
          data: plan.overrides.map((o) => ({
            platformMemberId: userId,
            permissionKey: o.key,
            state: o.state,
            grantedByUserId: ctx.actor.id,
          })),
        });
      // A reused login keeps the name and phone typed the first time: save these. Admin scope
      // may, now that the person has an org-chart row (users_admin_team_update).
      const login = ctx.users.get(userId);
      if (login && (login.name !== plan.name || (login.phone ?? null) !== plan.phone)) {
        const saved = await tx.user.updateMany({
          where: { id: userId, pool: 'ADMIN' },
          data: { name: plan.name, phone: plan.phone },
        });
        if (saved.count !== 1) throw refuse('FORBIDDEN');
      }
      await this.audit.logIn(
        tx,
        plan.created.action,
        { type: ENTITY, id: userId },
        plan.created.metadata,
        { businessId: null },
      );
      if (!plan.invite) return null;
      const issued = await this.issue(tx, userId, plan.invite, 'CREATE', {
        name: plan.name,
        email: plan.email,
        phone: plan.phone,
      });
      if (issued === 'RATE_LIMITED') throw refuse('RATE_LIMITED');
      if (issued === 'NOT_PENDING_INVITATION') throw refuse('CONFLICT');
      return issued;
    });
    const invitation = link ? await this.deliver(link) : null;
    return { member: await this.member(userId), invitation };
  }

  /**
   * Resend Invitation: a new link for each person still Pending Invitation (their older links
   * stop working), each with its own `platform_member.invited`, all in one transaction; then each
   * is sent. `sent` counts the people at least one channel took. A person whose every send failed
   * is neither sent nor skipped (the contract has no reason for it; the log has their id).
   */
  async resend(body: ResendBody): Promise<AdminTeamInvitationResult> {
    const { links, skipped } = await this.run(async (tx, ctx) => {
      const plan = planResend(ctx, body.ids);
      const made: IssuedLink[] = [];
      const left = [...plan.skipped];
      for (const id of plan.targets) {
        const user = ctx.users.get(id)!;
        const issued = await this.issue(
          tx,
          id,
          { email: true, sms: body.sms && Boolean(user.phone) },
          'RESEND',
          { name: user.name, email: user.email, phone: user.phone },
        );
        if (typeof issued === 'string') left.push({ id, name: ctx.nameOf(id), reason: issued });
        else made.push(issued);
      }
      const at = new Map(body.ids.map((id, i) => [id, i]));
      return { links: made, skipped: left.sort((a, b) => at.get(a.id)! - at.get(b.id)!) };
    });
    let sent = 0;
    for (const link of links) {
      const out = await this.deliver(link);
      if (out.email || out.sms) sent += 1;
    }
    return { sent, skipped };
  }

  /**
   * A new link for a member still Pending Invitation, in the caller's admin transaction: under
   * the invitations lock and within the daily caps (TEAM_INVITE_LIMITS), the member row touched
   * (the token holds its new `updated_at`, so every older link stops matching) and its
   * `platform_member.invited` entry: the channels, the expiry and how, never the token or the
   * link. `deliver` seals and sends it once the transaction commits.
   */
  async issue(
    tx: TxClient,
    userId: string,
    channels: InviteChannels,
    via: Via,
    to: Recipient,
  ): Promise<IssuedLink | NotIssued> {
    await lockInvitations(tx);
    if (overLimit(await this.sentToday(tx, userId))) return 'RATE_LIMITED';
    const row = await tx.platformMember.findUnique({
      where: { userId },
      select: { status: true, updatedAt: true },
    });
    if (row?.status !== 'PENDING_INVITATION') return 'NOT_PENDING_INVITATION';
    // Later than the row's version, so a link made in the same millisecond is void too.
    const memberUpdatedAt = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
    const touched = await tx.platformMember.updateMany({
      where: { userId, status: 'PENDING_INVITATION', updatedAt: row.updatedAt },
      data: { updatedAt: memberUpdatedAt },
    });
    if (touched.count !== 1) return 'NOT_PENDING_INVITATION';
    const expiresAt = invitationExpiry(memberUpdatedAt.getTime());
    await this.audit.logIn(
      tx,
      ACTIONS.INVITED,
      { type: ENTITY, id: userId },
      {
        channels: [...(channels.email ? ['EMAIL'] : []), ...(channels.sms ? ['SMS'] : [])],
        expiresAt: expiresAt.toISOString(),
        via,
      },
      { businessId: null },
    );
    return { userId, memberUpdatedAt, expiresAt, channels, to };
  }

  /**
   * Seals the link and hands it to NotifyService: R6's generic Firmivra email and text
   * (`platform.message-email`, `platform.message-sms`) until R6 adds team-invite templates. The
   * answer says which channels took it. A failed send is logged with the member's id and the
   * error's name only (never the address or the link); the link stands and Resend makes another.
   */
  async deliver(link: IssuedLink): Promise<AdminTeamInvitationSent> {
    const token = await this.tokens.seal(link.userId, link.memberUpdatedAt, link.expiresAt);
    const url = invitationLink(this.env.ADMIN_BASE_URL, token);
    const email =
      link.channels.email &&
      (await this.sent(link.userId, 'email', () =>
        this.notify.send({
          template: 'platform.message-email',
          to: link.to.email,
          businessId: null,
          data: invitationEmail(link.to.name, url, link.expiresAt),
        }),
      ));
    const phone = link.to.phone;
    const sms =
      link.channels.sms &&
      phone !== null &&
      (await this.sent(link.userId, 'text', () =>
        this.notify.send({
          template: 'platform.message-sms',
          to: phone,
          businessId: null,
          data: invitationSms(url),
        }),
      ));
    return { email, sms, expiresAt: link.expiresAt.toISOString() };
  }

  // ---------- Helpers ----------

  private async sent(userId: string, channel: string, send: () => Promise<void>) {
    try {
      await send();
      return true;
    } catch (error) {
      this.logger.warn(
        `Team invitation ${channel} for member ${userId} not sent: ${errorName(error)}`,
      );
      return false;
    }
  }

  /** The links sent in the last day: by the platform, and to this person (if known). */
  private async sentToday(
    tx: TxClient,
    userId: string | null,
  ): Promise<{ platform: number; person: number }> {
    const where = {
      action: ACTIONS.INVITED,
      entityType: ENTITY,
      businessId: null,
      createdAt: { gt: new Date(Date.now() - TEAM_INVITE_LIMITS.windowMs) },
    };
    const [platform, person] = await Promise.all([
      tx.auditLog.count({ where }),
      userId ? tx.auditLog.count({ where: { ...where, entityId: userId } }) : Promise.resolve(0),
    ]);
    return { platform, person };
  }

  /**
   * The ADMIN-pool login of a new team member and its `platform_admins` row (TEAM_MEMBER), made
   * if needed; returns the user id.
   *
   * Platform scope, for these two inserts and the lookup only: Rasel's decision (Oct 20) that
   * R60 builds the admin invite in the Team module, with platform scope for the `users` and
   * `platform_admins` inserts only (`users_insert` and `platform_admins_access` allow them in no
   * other scope). The org-chart row, its overrides and the audit rows stay in admin scope.
   *
   * As `staffUserFor` (auth/invites.service.ts): an ADMIN-pool login with this email is reused
   * (the caller has refused anyone already on the team, so it is a create that failed half-way;
   * its admin row is added if missing). A new login gets both rows in one transaction. When a
   * parallel create wins the `users_pool_email_staff_admin_key` race, the other request's row is
   * read and the Cognito login made here disabled (the API may not delete Cognito users); when the
   * transaction fails for any other reason, that login is disabled too. Only the ADMIN pool is
   * read: staff and client logins with the same email are other people.
   */
  private async adminUserFor(email: string, name: string, phone: string | null): Promise<string> {
    const platform = this.db.forPlatform();
    const find = () =>
      platform.user.findFirst({
        where: { email, pool: 'ADMIN' },
        select: { id: true, platformAdmin: { select: { role: true } } },
      });
    const withAdminRow = async (user: {
      id: string;
      platformAdmin: { role: PlatformRole } | null;
    }): Promise<string> => {
      if (user.platformAdmin?.role === 'SUPER_ADMIN') throw refuse('EMAIL_TAKEN');
      if (!user.platformAdmin) {
        try {
          await platform.platformAdmin.create({ data: { userId: user.id, role: 'TEAM_MEMBER' } });
        } catch (error) {
          // A parallel create added it first.
          if (!isUniqueViolation(error)) throw error;
        }
      }
      return user.id;
    };
    const existing = await find();
    if (existing) return withAdminRow(existing);
    const sub = await this.identity.createUser('ADMIN', email);
    try {
      return await this.db.withScope({ kind: 'platform' }, async (tx) => {
        const user = await tx.user.create({
          data: { cognitoSub: sub, pool: 'ADMIN', email, name, phone },
          select: { id: true },
        });
        await tx.platformAdmin.create({ data: { userId: user.id, role: 'TEAM_MEMBER' } });
        return user.id;
      });
    } catch (error) {
      const raced = isUniqueViolation(error) ? await find() : null;
      // No row points to the Cognito login made for this request: disable it, so it can never
      // be used. On any other failure too (both inserts rolled back), so a retry leaves no
      // stray logins behind.
      if (!raced) {
        await this.identity.disableUser('ADMIN', sub).catch((failure: unknown) => {
          this.logger.warn(`Could not disable an unused ADMIN login: ${errorName(failure)}`);
        });
        throw error;
      }
      await this.identity.disableUser('ADMIN', sub);
      return withAdminRow(raced);
    }
  }

  private member(id: string): Promise<AdminTeamMember> {
    return this.run(async (tx, ctx) => memberView(ctx, id, await extrasFor(tx, ctx, [id])));
  }

  /** One unit of work in admin scope, with the database's refusals as contract errors. */
  private async run<T>(work: (tx: TxClient, ctx: TeamContext) => Promise<T>): Promise<T> {
    try {
      return await this.admin.transaction(async (tx) =>
        work(tx, await loadContext(tx, this.admin.adminUserId)),
      );
    } catch (error) {
      throw asTeamError(error);
    }
  }
}
