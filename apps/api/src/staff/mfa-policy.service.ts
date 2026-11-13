import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Param,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Database, TxClient } from '@firmivra/db';
import {
  type MfaPolicy,
  SetStaffSecurityAdminRequest,
  type StaffSecurityAdmin,
  UpdateMfaPolicyRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { httpError } from '../auth/auth-errors.js';
import {
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import {
  AuthFlowError,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from '../auth/identity/identity-provider.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from '../workspaces/common.js';
import { StaffIdParam } from './staff-input.js';
import {
  assertActsOn,
  lockTarget,
  requireManager,
  type StaffActor,
  staffActorOf,
} from './staff.common.js';

// SM14 part C, SEC-6: the firm's two-factor requirement and its security administrators. Changing
// the requirement takes an Owner, or an Admin who is a security administrator, a fresh sign-in
// (the current password, as the kiosk exit and My Profile check it), a confirm and an audit row.
// Off is only a documented, approved exception (the database refuses an off without one), and
// sign-in still asks every staff login for a code: the staff user pool requires it.

const onlySecurity = () =>
  new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'Only an Owner or a security administrator can change the two-factor requirement',
  });
const wrongPassword = () =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Your current password is not right',
    details: [{ path: 'currentPassword', message: 'Your current password is not right' }],
  });

type Member = { id: string; userId: string; role: string; isSecurityAdmin: boolean };
const maySet = (m: Member | null) =>
  !!m && (m.role === 'OWNER' || (m.role === 'ADMIN' && m.isSecurityAdmin));

@Injectable()
export class MfaPolicyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
  ) {}

  get(businessId: string, userId: string): Promise<MfaPolicy> {
    return this.db.withScope({ kind: 'business', businessId }, (tx) =>
      this.view(tx, businessId, userId),
    );
  }

  async update(
    businessId: string,
    auth: AuthContext,
    body: z.output<typeof UpdateMfaPolicyRequest>,
  ): Promise<MfaPolicy> {
    const me = await this.db.withScope({ kind: 'business', businessId }, (tx) =>
      this.me(tx, businessId, auth.userId),
    );
    if (!maySet(me)) throw onlySecurity();
    if (!(await this.passwordOk(auth.cognitoSub, body.currentPassword))) {
      await this.audit.log(
        'security.mfa_requirement_change_failed',
        { type: 'staff_security_defaults', id: businessId },
        { reason: 'CURRENT_PASSWORD' },
        { businessId },
      );
      throw wrongPassword();
    }
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      // Read again in the change's transaction: someone demoted a moment ago can no longer act.
      if (!maySet(await this.me(tx, businessId, auth.userId))) throw onlySecurity();
      const exception = body.required
        ? { mfaExceptionNote: null, mfaExceptionApprovedByUserId: null, mfaExceptionAt: null }
        : {
            mfaExceptionNote: body.note ?? null,
            mfaExceptionApprovedByUserId: auth.userId,
            mfaExceptionAt: new Date(),
          };
      const data = { mfaRequired: body.required, ...exception, updatedByUserId: auth.userId };
      await tx.staffSecurityDefaults.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
      });
      // Never the note's text: the row says whether one was recorded.
      await this.audit.logIn(
        tx,
        'security.mfa_requirement_changed',
        { type: 'staff_security_defaults', id: businessId },
        { required: body.required, exceptionRecorded: !body.required },
        { businessId },
      );
      return this.view(tx, businessId, auth.userId);
    });
  }

  /** Whether `id` is a security administrator, and whether the actor may change it. */
  securityAdmin(actor: StaffActor, id: string): Promise<StaffSecurityAdmin> {
    const { businessId } = actor;
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      const target = await tx.membership.findFirst({
        where: { businessId, id },
        select: { role: true, userId: true, isSecurityAdmin: true },
      });
      if (!target) throw notFound();
      let canChange = false;
      if (target.role === 'ADMIN' && target.userId !== actor.userId) {
        try {
          const tiers = await assertActsOn(tx, actor, target, 'edit');
          canChange = tiers.actor === 'ORIGINAL_OWNER' || tiers.actor === 'OWNER';
        } catch {
          canChange = false;
        }
      }
      return { securityAdmin: target.isSecurityAdmin, canChange };
    });
  }

  /**
   * Grant or take away security administration: owner-level only (SM14's rule: never yourself,
   * never the Original Owner), on an Admin. Confirmed and audited.
   */
  async setSecurityAdmin(
    actor: StaffActor,
    id: string,
    value: boolean,
  ): Promise<StaffSecurityAdmin> {
    const { businessId } = actor;
    await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      await requireManager(tx, actor);
      const target = await lockTarget(tx, businessId, id);
      const tiers = await assertActsOn(tx, actor, target, 'edit');
      if (tiers.actor !== 'ORIGINAL_OWNER' && tiers.actor !== 'OWNER') throw onlySecurity();
      if (target.role !== 'ADMIN') {
        throw new ConflictException({
          code: 'NOT_ADMIN',
          message: 'Only an Admin can be a security administrator',
        });
      }
      const now = await tx.membership.findFirst({
        where: { businessId, id },
        select: { isSecurityAdmin: true },
      });
      if (now?.isSecurityAdmin === value) return;
      await tx.membership.updateMany({
        where: { businessId, id, role: 'ADMIN' },
        data: { isSecurityAdmin: value },
      });
      await this.audit.logIn(
        tx,
        'staff.security_admin_changed',
        { type: 'membership', id },
        { securityAdmin: value },
        { businessId },
      );
    });
    return this.securityAdmin(actor, id);
  }

  private async view(tx: TxClient, businessId: string, userId: string): Promise<MfaPolicy> {
    const [row, me] = await Promise.all([
      tx.staffSecurityDefaults.findUnique({
        where: { businessId },
        select: {
          mfaRequired: true,
          mfaExceptionNote: true,
          mfaExceptionApprovedByUserId: true,
          mfaExceptionAt: true,
        },
      }),
      this.me(tx, businessId, userId),
    ]);
    const approver = row?.mfaExceptionApprovedByUserId
      ? await tx.user.findUnique({
          where: { id: row.mfaExceptionApprovedByUserId },
          select: { id: true, name: true },
        })
      : null;
    const required = row?.mfaRequired ?? true;
    return {
      required,
      exception:
        !required && row?.mfaExceptionNote && row.mfaExceptionAt
          ? {
              note: row.mfaExceptionNote,
              approvedBy: approver ? { userId: approver.id, name: approver.name } : null,
              at: row.mfaExceptionAt.toISOString(),
            }
          : null,
      canChange: maySet(me),
      enforcedAtSignIn: true,
    };
  }

  private me(tx: TxClient, businessId: string, userId: string): Promise<Member | null> {
    return tx.membership.findFirst({
      where: { businessId, userId, status: 'ACTIVE' },
      select: { id: true, userId: true, role: true, isSecurityAdmin: true },
    });
  }

  /** True for the member's own password (as the kiosk's exit checks it). */
  private async passwordOk(cognitoSub: string, password: string): Promise<boolean> {
    try {
      const step = await this.identity.signIn('STAFF', cognitoSub, password);
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

const UpdateBody = UpdateMfaPolicyRequest;
const AdminBody = SetStaffSecurityAdminRequest;

/** The firm's two-factor requirement: every member reads it; the rule decides who changes it. */
@Controller('business/security/mfa-policy')
@Roles(...FIRM_STAFF)
export class MfaPolicyController {
  constructor(private readonly policy: MfaPolicyService) {}

  @Get()
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<MfaPolicy> {
    return this.policy.get(tenant.businessId, auth.userId);
  }

  /** A wrong current password counts: 5 tries in 15 minutes from one address. */
  @Put()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdateBody)) body: z.output<typeof UpdateBody>,
  ): Promise<MfaPolicy> {
    return this.policy.update(tenant.businessId, auth, body);
  }
}

/** A member's security administration (Access & Security): owner-level changes it. */
@Controller('business/staff')
@Roles(...FIRM_MANAGERS)
export class StaffSecurityAdminController {
  constructor(private readonly policy: MfaPolicyService) {}

  @Get(':id/security-admin')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(StaffIdParam)) id: string,
  ): Promise<StaffSecurityAdmin> {
    return this.policy.securityAdmin(staffActorOf(auth, tenant), id);
  }

  @Put(':id/security-admin')
  set(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(StaffIdParam)) id: string,
    @Body(new ZodValidationPipe(AdminBody)) body: z.output<typeof AdminBody>,
  ): Promise<StaffSecurityAdmin> {
    return this.policy.setSecurityAdmin(staffActorOf(auth, tenant), id, body.securityAdmin);
  }
}
