import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  CreateStaffResponse,
  InvitationOutcome,
  StaffDetail,
  StaffDetailsInput,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { InvitesService } from '../auth/invites.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE, OUTSIDE_CALL_LIMITS } from '../database/database.module.js';
import { notFound, toDay } from '../workspaces/common.js';
import type { CreateStaffBody, UpdateStaffBody } from './staff-input.js';
import { writeMemberGrid } from './staff-permissions.service.js';
import { StaffReadService } from './staff-read.service.js';
import {
  assertManages,
  assertMayGive,
  invalid,
  lockTarget,
  mapStaffDbError,
  requireManager,
  type StaffActor,
  staffConflict,
  versionOf,
} from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;
type Details = z.output<typeof StaffDetailsInput>;
type Account = Out<typeof CreateStaffBody>['account'];

/** What the audit row of a create keeps to answer a retry: ids, the outcome, never a value. */
interface Created {
  idempotencyKey: string;
  invitation: InvitationOutcome;
}

const PROFILE_KEYS = [
  'employmentType',
  'workSchedule',
  'office',
  'hireDate',
  'endDate',
  'supervisorId',
  'timeZone',
  'employeeId',
  'primarySpecialty',
  'maxWorkload',
  'acceptsNewClients',
] as const;

/** The staff_profiles columns a request sets (undefined: unchanged; null: cleared). */
function profileData(
  account: Partial<Account> | undefined,
  details: Details | undefined,
): Prisma.StaffProfileUncheckedUpdateInput {
  const data: Prisma.StaffProfileUncheckedUpdateInput = {};
  if (account?.serviceAreas !== undefined) data.serviceAreas = account.serviceAreas;
  if (account?.accessLevel !== undefined) data.accessLevel = account.accessLevel;
  if (account?.accessStartsOn !== undefined)
    data.accessStartsOn = account.accessStartsOn === null ? null : toDay(account.accessStartsOn);
  for (const key of PROFILE_KEYS) {
    const value = details?.[key];
    if (value === undefined) continue;
    (data as Record<string, unknown>)[key] =
      (key === 'hireDate' || key === 'endDate') && typeof value === 'string' ? toDay(value) : value;
  }
  return data;
}

/** The names of the keys sent, for the audit row (never a value). */
const keysOf = (group: string, value: object | undefined) =>
  value
    ? Object.keys(value)
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => `${group}.${k}`)
    : [];

/**
 * Create Staff (Submit & Send Invitation) and Edit Staff (Save Changes), R55. The person is
 * invited through R2's InvitesService; the rest of the four steps is written in the same
 * request. Audit rows carry ids and field names only, never a name, email or pay value.
 */
@Injectable()
export class StaffWriteService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly invites: InvitesService,
    private readonly read: StaffReadService,
  ) {}

  /**
   * One transaction holds the idempotency key's lock from the first read to the audit row, so a
   * retry (or a double click) waits and then answers the first result, never a second member.
   * The invite itself commits in InvitesService's own transaction: if a later write fails, the
   * member stays INVITED (a retry then answers 409 DUPLICATE_EMAIL and routes to them).
   */
  async create(
    tenant: TenantContext,
    actor: StaffActor,
    body: Out<typeof CreateStaffBody>,
  ): Promise<CreateStaffResponse> {
    const { businessId } = actor;
    const a = body.account;
    let made: { id: string; invitation: InvitationOutcome };
    try {
      made = await this.database.withScope(
        { kind: 'business', businessId, actorUserId: actor.userId },
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-create:${businessId}:${body.idempotencyKey}`}, 0))`;
          const first = await this.firstResult(tx, actor, body.idempotencyKey);
          if (first) return first;
          const by = await requireManager(tx, actor);
          assertMayGive(actor, a.role);
          await this.assertNewEmail(tx, businessId, a.email);
          await this.checkRefs(tx, businessId, null, {
            departmentIds: a.departmentIds,
            details: body.details,
          });
          if (body.draftId) {
            const draft = await tx.staffDraft.findFirst({
              where: { businessId, id: body.draftId },
              select: { id: true },
            });
            if (!draft) throw notFound();
          }
          const gridInput = {
            businessId,
            role: a.role,
            grants: body.permissions ?? [],
            acknowledged: true,
            updatedById: by,
            fresh: true,
          };
          // Checked before the invite commits: a refused grid leaves no member behind.
          if (body.permissions?.length)
            await writeMemberGrid(tx, { ...gridInput, membershipId: by, dryRun: true });

          const invite = await this.invites.createInvite({
            businessId,
            email: a.email,
            name: `${a.firstName} ${a.lastName}`.trim(),
            role: a.role,
            invitedBy: { userId: actor.userId, role: actor.role },
            delivery: body.sendWelcomeEmail ? 'try' : 'skip',
          });
          const id = invite.membershipId;
          const invitation: InvitationOutcome = !body.sendWelcomeEmail
            ? { status: 'NOT_SENT', sentAt: null, expiresAt: null }
            : invite.emailed
              ? { status: 'SENT', sentAt: new Date().toISOString(), expiresAt: invite.expiresAt }
              : { status: 'FAILED', sentAt: null, expiresAt: null };

          await tx.membership.updateMany({
            where: { businessId, id },
            data: { jobTitle: a.jobTitle },
          });
          await tx.memberDepartment.createMany({
            data: a.departmentIds.map((departmentId) => ({
              businessId,
              membershipId: id,
              departmentId,
            })),
            skipDuplicates: true,
          });
          const profile = profileData(a, body.details);
          await tx.staffProfile.upsert({
            where: { businessId_membershipId: { businessId, membershipId: id } },
            create: {
              ...(profile as Prisma.StaffProfileUncheckedCreateInput),
              businessId,
              membershipId: id,
            },
            update: profile,
          });
          await this.setTeams(tx, businessId, id, body.details);
          await this.writeAccess(tx, businessId, id, body.access);
          if (body.compensation && Object.values(body.compensation).some((v) => v !== undefined))
            await this.writePay(tx, businessId, id, body.compensation);
          let grid = { changedCells: 0, escalated: false };
          if (body.permissions?.length)
            // Create Staff's step 2 is the Owner or Admin choosing the grid: no second confirm.
            grid = await writeMemberGrid(tx, { ...gridInput, membershipId: id });
          if (body.draftId)
            await tx.staffDraft.deleteMany({ where: { businessId, id: body.draftId } });
          await this.audit.logIn(
            tx,
            'staff.created',
            { type: 'membership', id },
            {
              idempotencyKey: body.idempotencyKey,
              inviteId: invite.id,
              role: a.role,
              departments: a.departmentIds.length,
              fields: [
                ...keysOf('details', body.details),
                ...keysOf('access', body.access),
                ...(body.compensation ? ['compensation'] : []),
              ],
              permissionCells: grid.changedCells,
              escalated: grid.escalated,
              draftId: body.draftId ?? null,
              invitation,
            },
            { businessId },
          );
          return { id, invitation };
        },
        // The invite calls Cognito and the email sender inside this transaction's time.
        OUTSIDE_CALL_LIMITS,
      );
    } catch (e) {
      throw mapStaffDbError(e);
    }
    return {
      staff: await this.read.get(tenant, actor.userId, made.id),
      invitation: made.invitation,
    };
  }

  /** The first create with this key by this person, or null. Someone else's key is 404. */
  private async firstResult(tx: TxClient, actor: StaffActor, idempotencyKey: string) {
    const row = await tx.auditLog.findFirst({
      where: {
        businessId: actor.businessId,
        action: 'staff.created',
        metadata: { path: ['idempotencyKey'], equals: idempotencyKey },
      },
      select: { entityId: true, actorUserId: true, metadata: true },
    });
    if (!row?.entityId) return null;
    if (row.actorUserId !== actor.userId) throw notFound();
    return { id: row.entityId, invitation: (row.metadata as unknown as Created).invitation };
  }

  /** 409 DUPLICATE_EMAIL: a member of this firm, or an open invite here, has this address. */
  private async assertNewEmail(tx: TxClient, businessId: string, email: string) {
    const [member, invite] = await Promise.all([
      tx.membership.findFirst({
        where: { businessId, user: { email: { equals: email, mode: 'insensitive' } } },
        select: { id: true },
      }),
      tx.invite.findFirst({
        where: {
          businessId,
          membershipId: { not: null },
          email: { equals: email, mode: 'insensitive' },
          acceptedAt: null,
          revokedAt: null,
        },
        select: { id: true },
      }),
    ]);
    if (member || invite)
      throw staffConflict('DUPLICATE_EMAIL', 'Someone at this firm already has this email');
  }

  /**
   * The departments, teams, supervisor and employee id a request names: in this firm (404),
   * active when newly given (409 GROUP_INACTIVE), and an employee id no one else here has.
   */
  private async checkRefs(
    tx: TxClient,
    businessId: string,
    membershipId: string | null,
    input: { departmentIds?: string[]; details?: Details },
  ) {
    const current = membershipId
      ? await tx.memberDepartment.findMany({
          where: { businessId, membershipId },
          select: { departmentId: true },
        })
      : [];
    const had = new Set(current.map((d) => d.departmentId));
    const added = (input.departmentIds ?? []).filter((d) => !had.has(d));
    if (added.length) {
      const found = await tx.department.findMany({
        where: { businessId, id: { in: added } },
        select: { id: true, status: true },
      });
      if (found.length !== new Set(added).size) throw notFound();
      if (found.some((d) => d.status !== 'ACTIVE'))
        throw staffConflict('GROUP_INACTIVE', 'Choose an active department');
    }
    const d = input.details;
    if (!d) return;
    if (d.primaryTeamId && d.primaryTeamId === d.backupTeamId)
      throw invalid('details.backupTeamId', 'Choose a backup team other than the primary team');
    for (const teamId of [d.primaryTeamId, d.backupTeamId]) {
      if (!teamId) continue;
      const team = await tx.team.findFirst({
        where: { businessId, id: teamId },
        select: { status: true },
      });
      if (!team) throw notFound();
      if (team.status !== 'ACTIVE') throw staffConflict('GROUP_INACTIVE', 'Choose an active team');
    }
    if (d.supervisorId) {
      if (d.supervisorId === membershipId)
        throw invalid('details.supervisorId', 'A member cannot supervise themselves');
      const boss = await tx.membership.findFirst({
        where: { businessId, id: d.supervisorId },
        select: { status: true },
      });
      if (!boss) throw notFound();
      if (boss.status !== 'ACTIVE')
        throw invalid('details.supervisorId', 'Choose an active member as supervisor');
    }
    if (d.employeeId) {
      const taken = await tx.staffProfile.findFirst({
        where: {
          businessId,
          employeeId: { equals: d.employeeId, mode: 'insensitive' },
          ...(membershipId ? { membershipId: { not: membershipId } } : {}),
        },
        select: { membershipId: true },
      });
      if (taken)
        throw staffConflict('CONFLICT', 'Another member at this firm has this employee ID');
    }
  }

  /** Primary and Backup Team: at most one of each (a team the member is in keeps the row). */
  private async setTeams(tx: TxClient, businessId: string, membershipId: string, d?: Details) {
    for (const [kind, teamId] of [
      ['PRIMARY', d?.primaryTeamId],
      ['BACKUP', d?.backupTeamId],
    ] as const) {
      if (teamId === undefined) continue;
      await tx.teamMember.updateMany({
        where: { businessId, membershipId, kind, ...(teamId ? { teamId: { not: teamId } } : {}) },
        data: { kind: 'MEMBER' },
      });
      if (teamId)
        await tx.teamMember.upsert({
          where: { teamId_membershipId: { teamId, membershipId } },
          create: { businessId, teamId, membershipId, kind },
          update: { kind },
        });
    }
  }

  /** Step 3 (staff_security_settings), shared with PUT security. */
  async writeAccess(
    tx: TxClient,
    businessId: string,
    membershipId: string,
    access: Out<typeof CreateStaffBody>['access'],
  ) {
    const data: Prisma.StaffSecuritySettingsUncheckedUpdateInput = {};
    if (access) {
      const { notices, disableOn, recoveryEmail, ...rest } = access;
      for (const [k, v] of Object.entries(rest))
        if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      if (disableOn !== undefined) data.disableOn = disableOn === null ? null : toDay(disableOn);
      if (recoveryEmail !== undefined) {
        data.recoveryEmail = recoveryEmail;
        data.recoveryEmailVerifiedAt = null;
      }
      if (notices) {
        data.notifyNewDeviceLogin = notices.newDeviceLogin;
        data.notifyFailedLogins = notices.failedLogins;
        data.notifyPasswordChanges = notices.passwordChanges;
        data.notifySecurityAlerts = notices.securityAlerts;
        data.notifyLockouts = notices.lockouts;
      }
    }
    await tx.staffSecuritySettings.upsert({
      where: { businessId_membershipId: { businessId, membershipId } },
      create: {
        ...(data as Prisma.StaffSecuritySettingsUncheckedCreateInput),
        businessId,
        membershipId,
      },
      update: data,
    });
  }

  /** Pay (staff_compensation): the transaction's scope names the acting Owner or Admin. */
  async writePay(
    tx: TxClient,
    businessId: string,
    membershipId: string,
    pay: NonNullable<Out<typeof CreateStaffBody>['compensation']>,
  ) {
    const data: Prisma.StaffCompensationUncheckedUpdateInput = {};
    if (pay.payType !== undefined) data.payType = pay.payType;
    if (pay.rateCents !== undefined)
      data.rateCents = pay.rateCents === null ? null : BigInt(pay.rateCents);
    if (pay.payFrequency !== undefined) data.payFrequency = pay.payFrequency;
    if (pay.commission !== undefined) data.commission = pay.commission;
    if (pay.payrollId !== undefined) data.payrollId = pay.payrollId;
    await tx.staffCompensation.upsert({
      where: { businessId_membershipId: { businessId, membershipId } },
      create: {
        ...(data as Prisma.StaffCompensationUncheckedCreateInput),
        businessId,
        membershipId,
      },
      update: data,
    });
  }

  /**
   * Save Changes. `version` must be GET's (409 SAVE_CONFLICT otherwise). The name and email are
   * the person's login, shared with their other firms: an edit that changes them is refused.
   */
  async update(
    tenant: TenantContext,
    actor: StaffActor,
    id: string,
    body: Out<typeof UpdateStaffBody>,
  ): Promise<StaffDetail> {
    const { businessId } = actor;
    const a = body.account;
    try {
      await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        await requireManager(tx, actor);
        const target = await lockTarget(tx, businessId, id);
        assertManages(actor, target);
        // Before the version: another firm's department, team or member is 404 either way.
        await this.checkRefs(tx, businessId, id, {
          departmentIds: a?.departmentIds,
          details: body.details,
        });
        const profile = await tx.staffProfile.findUnique({
          where: { businessId_membershipId: { businessId, membershipId: id } },
          select: { updatedAt: true },
        });
        if (versionOf(target.updatedAt, profile?.updatedAt) !== body.version)
          throw staffConflict(
            'SAVE_CONFLICT',
            'Someone saved this member after you opened it. Reload and apply your changes again.',
          );
        if (a?.firstName !== undefined || a?.lastName !== undefined || a?.email !== undefined) {
          const user = await tx.user.findUnique({
            where: { id: target.userId },
            select: { name: true, email: true },
          });
          const [first = '', ...rest] = (user?.name ?? '').trim().split(/\s+/);
          if (a.firstName !== undefined && a.firstName !== first)
            throw invalid('account.firstName', 'Only the person can change their name');
          if (a.lastName !== undefined && a.lastName !== rest.join(' '))
            throw invalid('account.lastName', 'Only the person can change their name');
          if (a.email !== undefined && a.email.toLowerCase() !== user?.email.toLowerCase())
            throw invalid(
              'account.email',
              'The sign-in email cannot be changed here: revoke the invite or deactivate, then add the person again',
            );
        }
        const memberData: Prisma.MembershipUpdateManyMutationInput = { updatedAt: new Date() };
        if (a?.jobTitle !== undefined) memberData.jobTitle = a.jobTitle;
        if (a?.role !== undefined && a.role !== target.role) {
          assertMayGive(actor, a.role);
          memberData.role = a.role;
        }
        const moved = await tx.membership.updateMany({
          where: { businessId, id, role: target.role, status: target.status },
          data: memberData,
        });
        if (moved.count !== 1) throw staffConflict('SAVE_CONFLICT', 'Reload and try again');
        if (a?.departmentIds) {
          await tx.memberDepartment.deleteMany({
            where: { businessId, membershipId: id, departmentId: { notIn: a.departmentIds } },
          });
          await tx.memberDepartment.createMany({
            data: a.departmentIds.map((departmentId) => ({
              businessId,
              membershipId: id,
              departmentId,
            })),
            skipDuplicates: true,
          });
        }
        const data = profileData(a, body.details);
        await tx.staffProfile.upsert({
          where: { businessId_membershipId: { businessId, membershipId: id } },
          create: {
            ...(data as Prisma.StaffProfileUncheckedCreateInput),
            businessId,
            membershipId: id,
          },
          update: data,
        });
        await this.setTeams(tx, businessId, id, body.details);
        if (memberData.role)
          await this.audit.logIn(
            tx,
            'membership.role_changed',
            { type: 'membership', id },
            { from: target.role, to: memberData.role },
            { businessId },
          );
        await this.audit.logIn(
          tx,
          'staff.updated',
          { type: 'membership', id },
          {
            fields: [...keysOf('account', a), ...keysOf('details', body.details)],
            notifyMember: body.notifyMember ?? false,
          },
          { businessId },
        );
      });
    } catch (e) {
      throw mapStaffDbError(e);
    }
    return this.read.get(tenant, actor.userId, id);
  }
}
