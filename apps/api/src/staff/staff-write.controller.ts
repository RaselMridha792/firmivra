import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import type {
  CreateStaffResponse,
  StaffActionResult,
  StaffCompensation,
  StaffDetail,
  StaffNote,
  StaffPermissions,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  CreateStaffBody,
  LockStaffBody,
  SetStaffNoteBody,
  SetStaffPermissionsBody,
  StaffActionBody,
  StaffCompensationBody,
  StaffIdParam,
  UpdateStaffBody,
} from './staff-input.js';
import { StaffActionsService } from './staff-actions.service.js';
import { StaffPermissionsService } from './staff-permissions.service.js';
import { StaffRecordsService } from './staff-records.service.js';
import { StaffWriteService } from './staff-write.service.js';
import { staffActorOf } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;
const idPipe = new ZodValidationPipe(StaffIdParam);

/**
 * Staff Management's changes (R55; contract in packages/types/src/staff): Create and Edit Staff,
 * the account actions, a member's permissions, notes and pay. Owner and Admin only; the target
 * must be a role the actor manages, never themselves.
 */
@Controller('business/staff')
@Access('STAFF_MANAGEMENT', 'EDIT')
@Roles(...FIRM_MANAGERS)
export class StaffWriteController {
  constructor(
    private readonly write: StaffWriteService,
    private readonly actions: StaffActionsService,
    private readonly permissions: StaffPermissionsService,
    private readonly records: StaffRecordsService,
  ) {}

  @Post()
  @Access('STAFF_MANAGEMENT', 'CREATE')
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateStaffBody)) body: Out<typeof CreateStaffBody>,
  ): Promise<CreateStaffResponse> {
    return this.write.create(tenant, staffActorOf(auth, tenant), body);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateStaffBody)) body: Out<typeof UpdateStaffBody>,
  ): Promise<StaffDetail> {
    return this.write.update(tenant, staffActorOf(auth, tenant), id, body);
  }

  // ---------- Account actions ----------

  @Post(':id/lock')
  @HttpCode(200)
  lock(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(LockStaffBody)) body: Out<typeof LockStaffBody>,
  ): Promise<StaffActionResult> {
    return this.actions.lock(staffActorOf(auth, tenant), id, body.reason);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  unlock(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffActionResult> {
    return this.actions.unlock(staffActorOf(auth, tenant), id);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StaffActionBody)) body: Out<typeof StaffActionBody>,
  ): Promise<StaffActionResult> {
    return this.actions.deactivate(staffActorOf(auth, tenant), id, !!body.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffActionResult> {
    return this.actions.reactivate(staffActorOf(auth, tenant), id);
  }

  @Post(':id/invite/resend')
  @HttpCode(200)
  resendInvite(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffActionResult> {
    return this.actions.resendInvite(staffActorOf(auth, tenant), id);
  }

  @Post(':id/invite/revoke')
  @HttpCode(200)
  revokeInvite(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffActionResult> {
    return this.actions.revokeInvite(staffActorOf(auth, tenant), id);
  }

  // ---------- Permissions ----------

  @Put(':id/permissions')
  setPermissions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SetStaffPermissionsBody)) body: Out<typeof SetStaffPermissionsBody>,
  ): Promise<StaffPermissions> {
    return this.permissions.set(
      staffActorOf(auth, tenant),
      id,
      body.grants,
      body.acknowledgeEscalation ?? false,
    );
  }

  @Post(':id/permissions/copy-from/:fromId')
  @HttpCode(200)
  copyPermissions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('fromId', idPipe) fromId: string,
  ): Promise<StaffPermissions> {
    return this.permissions.copy(staffActorOf(auth, tenant), id, fromId);
  }

  // ---------- Notes and pay ----------

  @Get(':id/notes')
  @Access('STAFF_MANAGEMENT', 'VIEW')
  async note(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<{ note: StaffNote | null }> {
    return { note: await this.records.note(staffActorOf(auth, tenant), id) };
  }

  @Put(':id/notes')
  async setNote(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SetStaffNoteBody)) body: Out<typeof SetStaffNoteBody>,
  ): Promise<{ note: StaffNote | null }> {
    return { note: await this.records.setNote(staffActorOf(auth, tenant), id, body.text) };
  }

  @Get(':id/compensation')
  @Access('STAFF_MANAGEMENT', 'VIEW')
  compensation(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffCompensation> {
    return this.records.compensation(staffActorOf(auth, tenant), id);
  }

  @Put(':id/compensation')
  setCompensation(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StaffCompensationBody)) body: Out<typeof StaffCompensationBody>,
  ): Promise<StaffCompensation> {
    return this.records.setCompensation(staffActorOf(auth, tenant), id, body);
  }
}
