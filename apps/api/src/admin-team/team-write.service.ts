import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type {
  AdminTeamBulkRequest,
  AdminTeamBulkResult,
  AdminTeamMember,
  AdminTeamMemberResult,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from '../auth/identity/identity-provider.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { asTeamError, loadContext, refuse, type TeamContext } from './team-context.js';
import { type IssuedLink, TeamInviteService } from './team-invite.service.js';
import {
  type DecisionBody,
  type Plan,
  planBulk,
  planChange,
  planDecision,
  planProfile,
  type UpdateBody,
  withProfile,
} from './team-plan.js';
import { extrasFor } from './team-read.service.js';
import { memberView, visiblePerson } from './team-views.js';

type Out<S extends z.ZodType> = z.output<S>;

/** Statuses a person is reactivated from (ACTIVE then needs a login with a password). */
const OFF_STATUSES = ['SUSPENDED', 'INACTIVE', 'DEACTIVATED'] as const;
/** Cognito lookups at a time, for a bulk reactivation. */
const LOOKUPS_AT_ONCE = 10;

/**
 * Super Admin Team changes (R60 on R0's stage A tables), in the Super Admin's admin scope: Edit
 * Team Member (with the name and phone on the person's login), the bulk Change Department, Role
 * and Status, and the department head's decision (APPROVE sends the invitation through
 * TeamInviteService). Each lands with one audit entry per kind of change (`platform_member.<kind>`,
 * ids, codes and field names only), or not at all. Add Team Member and Resend Invitation are
 * TeamInviteService's.
 */
@Injectable()
export class TeamWriteService {
  private readonly logger = new Logger(TeamWriteService.name);

  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly invites: TeamInviteService,
  ) {}

  async update(id: string, body: UpdateBody): Promise<AdminTeamMember> {
    const passwords = body.status === 'ACTIVE' ? await this.passwords([id]) : new Set<string>();
    return this.run(async (tx, ctx) => {
      if (!visiblePerson(ctx, id)) throw refuse('NOT_FOUND');
      const profile = planProfile(ctx, id, body);
      const result = planChange(ctx, id, body, passwords.has(id));
      if ('refused' in result) throw refuse(result.refused);
      const plan = profile ? withProfile(ctx, id, result.plan, profile) : result.plan;
      if (plan) await this.apply(tx, ctx, plan, false);
      return this.view(tx, id);
    });
  }

  async bulk(body: Out<typeof AdminTeamBulkRequest>): Promise<AdminTeamBulkResult> {
    const passwords =
      body.action.type === 'STATUS' && body.action.status === 'ACTIVE'
        ? await this.passwords(body.ids)
        : new Set<string>();
    return this.run(async (tx, ctx) => {
      const { plans, unchanged, skipped } = planBulk(ctx, body.ids, body.action, passwords);
      for (const plan of plans) await this.apply(tx, ctx, plan, true);
      return { updated: plans.length, unchanged, skipped };
    });
  }

  /**
   * The decision, and with APPROVE the invitation to the channels chosen: its link is made in
   * the same transaction (429 RATE_LIMITED past the daily caps refuses the decision too; approve
   * with neither channel and resend later) and sent once it commits.
   */
  async decide(id: string, body: DecisionBody): Promise<AdminTeamMemberResult> {
    const done = await this.run(async (tx, ctx) => {
      await this.apply(tx, ctx, planDecision(ctx, id, body), false);
      let link: IssuedLink | null = null;
      if (body.decision === 'APPROVE' && (body.invite.email || body.invite.sms)) {
        const user = ctx.users.get(id)!;
        const issued = await this.invites.issue(tx, id, body.invite, 'APPROVAL', {
          name: user.name,
          email: user.email,
          phone: user.phone,
        });
        if (issued === 'RATE_LIMITED') throw refuse('RATE_LIMITED');
        if (issued === 'NOT_PENDING_INVITATION') throw refuse('CONFLICT');
        link = issued;
      }
      return { member: await this.view(tx, id), link };
    });
    const invitation = done.link ? await this.invites.deliver(done.link) : null;
    return { member: done.member, invitation };
  }

  // ---------- Helpers ----------

  /** One change in admin scope, with the database's refusals as contract errors. */
  private async run<T>(work: (tx: TxClient, ctx: TeamContext) => Promise<T>): Promise<T> {
    try {
      return await this.admin.transaction(async (tx) =>
        work(tx, await loadContext(tx, this.admin.adminUserId)),
      );
    } catch (error) {
      throw asTeamError(error);
    }
  }

  /**
   * Writes the plan: the member row only if nobody changed it since it was read (409 CONFLICT
   * otherwise), the overrides relative to its role, and its audit entries.
   */
  private async apply(tx: TxClient, ctx: TeamContext, plan: Plan, bulk: boolean): Promise<void> {
    const { before, after } = plan;
    const written = await tx.platformMember.updateMany({
      where: { userId: plan.id, updatedAt: before.updatedAt },
      data: {
        roleDefinitionId: after.roleId,
        departmentId: after.departmentId,
        reportsToUserId: after.reportsToId,
        scopeType: after.scope,
        scopeIds: after.scopeIds,
        status: after.status,
        intendedRoleDefinitionId: after.intendedRoleId,
        approvedByUserId: after.approvedById,
        updatedAt: new Date(),
      },
    });
    if (written.count !== 1) throw refuse('CONFLICT');
    if (plan.profile) {
      // The login's name and phone (users_admin_team_update: an org-chart login, admin scope).
      const saved = await tx.user.updateMany({
        where: { id: plan.id, pool: 'ADMIN' },
        data: plan.profile,
      });
      if (saved.count !== 1) throw refuse('FORBIDDEN');
    }
    if (plan.overridesChanged) {
      await tx.platformMemberPermissionOverride.deleteMany({
        where: { platformMemberId: plan.id },
      });
      if (after.overrides.length)
        await tx.platformMemberPermissionOverride.createMany({
          data: after.overrides.map((o) => ({
            platformMemberId: plan.id,
            permissionKey: o.key,
            state: o.state,
            grantedByUserId: ctx.actor.id,
          })),
        });
    }
    for (const event of plan.events)
      await this.audit.logIn(
        tx,
        event.action,
        { type: 'platform_member', id: plan.id },
        bulk ? { ...event.metadata, bulk: true } : event.metadata,
        { businessId: null },
      );
  }

  private async view(tx: TxClient, id: string): Promise<AdminTeamMember> {
    const ctx = await loadContext(tx, this.admin.adminUserId);
    return memberView(ctx, id, await extrasFor(tx, ctx, [id]));
  }

  /**
   * The people being reactivated whose login has a password (the identity adapter's read,
   * before the transaction). A lookup that fails counts as no password: they go back to
   * Pending Invitation, which grants nothing.
   */
  private async passwords(ids: readonly string[]): Promise<Set<string>> {
    const off = await this.admin.db.platformMember.findMany({
      where: { userId: { in: [...ids] }, status: { in: [...OFF_STATUSES] } },
      select: { userId: true },
    });
    if (off.length === 0) return new Set();
    const logins = await this.admin.db.user.findMany({
      where: { id: { in: off.map((m) => m.userId) }, pool: 'ADMIN' },
      select: { id: true, cognitoSub: true },
    });
    const found = new Set<string>();
    for (let i = 0; i < logins.length; i += LOOKUPS_AT_ONCE) {
      await Promise.all(
        logins.slice(i, i + LOOKUPS_AT_ONCE).map(async (u) => {
          try {
            if (await this.identity.hasPassword('ADMIN', u.cognitoSub)) found.add(u.id);
          } catch {
            this.logger.warn(`Could not read whether team member ${u.id} has a password`);
          }
        }),
      );
    }
    return found;
  }
}
