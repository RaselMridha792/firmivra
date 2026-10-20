import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type {
  StaffActionResult,
  StaffActivityPage,
  StaffLoginHistory,
  StaffSecurity,
  StaffSessionList,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  StaffAccessBody,
  StaffActionBody,
  StaffCursorQ,
  StaffIdParam,
  StaffSessionIdParam,
} from './staff-input.js';
import { StaffSecurityService } from './staff-security.service.js';
import { staffActorOf } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;
const idPipe = new ZodValidationPipe(StaffIdParam);

/**
 * Staff Account Access & Security (R55; contract in packages/types/src/staff): sign-in rules,
 * Active Sessions, Login History, activity, and the password and MFA resets. Owner and Admin.
 */
@Controller('business/staff')
@Access('STAFF_MANAGEMENT', 'EDIT')
@Roles(...FIRM_MANAGERS)
export class StaffSecurityController {
  constructor(private readonly security: StaffSecurityService) {}

  @Get(':id/security')
  @Access('STAFF_MANAGEMENT', 'VIEW')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffSecurity> {
    return this.security.get(staffActorOf(auth, tenant), id);
  }

  @Put(':id/security')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StaffAccessBody)) body: Out<typeof StaffAccessBody>,
  ): Promise<StaffSecurity> {
    return this.security.update(staffActorOf(auth, tenant), id, body);
  }

  @Get(':id/sessions')
  @Access('STAFF_MANAGEMENT', 'VIEW')
  async sessions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffSessionList> {
    return { items: await this.security.sessions(staffActorOf(auth, tenant), id) };
  }

  @Post(':id/sessions/revoke-all')
  @HttpCode(200)
  revokeAll(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StaffActionBody)) body: Out<typeof StaffActionBody>,
  ): Promise<StaffActionResult> {
    return this.security.revokeAll(staffActorOf(auth, tenant), id, !!body.reason);
  }

  @Post(':id/sessions/:sessionId/revoke')
  @HttpCode(200)
  revokeSession(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('sessionId', new ZodValidationPipe(StaffSessionIdParam)) sessionId: string,
  ): Promise<StaffActionResult> {
    return this.security.revokeSession(staffActorOf(auth, tenant), id, sessionId);
  }

  @Get(':id/login-history')
  @Access('STAFF_MANAGEMENT', 'VIEW')
  loginHistory(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(StaffCursorQ)) q: Out<typeof StaffCursorQ>,
  ): Promise<StaffLoginHistory> {
    return this.security.loginHistory(staffActorOf(auth, tenant), id, q);
  }

  @Get(':id/activity')
  @Access('STAFF_MANAGEMENT', 'VIEW')
  activity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(StaffCursorQ)) q: Out<typeof StaffCursorQ>,
  ): Promise<StaffActivityPage> {
    return this.security.activity(staffActorOf(auth, tenant), id, q);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StaffActionBody)) body: Out<typeof StaffActionBody>,
  ): Promise<StaffActionResult> {
    return this.security.resetPassword(staffActorOf(auth, tenant), id, !!body.reason);
  }

  @Post(':id/reset-mfa')
  @HttpCode(200)
  resetMfa(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StaffActionBody)) body: Out<typeof StaffActionBody>,
  ): Promise<StaffActionResult> {
    return this.security.resetMfa(staffActorOf(auth, tenant), id, !!body.reason);
  }
}
