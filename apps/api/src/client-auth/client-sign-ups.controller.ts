import { Body, Controller, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  ApproveSignUpRequest,
  type ApproveSignUpResponse,
  type ClientSignUpDetail,
  type ClientSignUpList,
  ClientSignUpsQuery,
  type ClientSignUpSettings,
  DeclineSignUpRequest,
  type DeclineSignUpResponse,
  KeepSignUpPendingRequest,
  type KeepSignUpPendingResponse,
  LinkSignUpRequest,
  RecordSignUpChecksRequest,
  RestoreSignUpAccessRequest,
  type RestoreSignUpAccessResponse,
  SignUpNotAMatchRequest,
  type SignUpNotAMatchResponse,
  UpdateClientSignUpSettingsRequest,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import { SignInModule } from '../auth/sign-in.controller.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ClientSignUpsService } from './client-sign-ups.service.js';
import { SignUpModule } from './sign-up.controller.js';

/**
 * The firm's portal sign-ups (client-auth.yaml, "Firm side"): /api/v1/client-sign-ups, owner and
 * admins of the firm in `x-business-id`.
 */
@Controller('client-sign-ups')
@Roles(...FIRM_MANAGERS)
export class ClientSignUpsController {
  constructor(private readonly signUps: ClientSignUpsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ClientSignUpsQuery)) query: z.output<typeof ClientSignUpsQuery>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ClientSignUpList> {
    return this.signUps.list({ businessId: tenant.businessId, userId: auth.userId }, query);
  }

  /** Before `:clientAccountId`, so "settings" is never read as a request id. */
  @Get('settings')
  settings(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ClientSignUpSettings> {
    return this.signUps.settings({ businessId: tenant.businessId, userId: auth.userId });
  }

  @Patch('settings')
  updateSettings(
    @Body(new ZodValidationPipe(UpdateClientSignUpSettingsRequest))
    body: z.output<typeof UpdateClientSignUpSettingsRequest>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ClientSignUpSettings> {
    return this.signUps.updateSettings(
      { businessId: tenant.businessId, userId: auth.userId },
      body,
    );
  }

  @Get(':clientAccountId')
  get(
    @Param('clientAccountId') clientAccountId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ClientSignUpDetail> {
    return this.signUps.get(
      { businessId: tenant.businessId, userId: auth.userId },
      clientAccountId,
    );
  }

  @Post(':clientAccountId/approve')
  @HttpCode(200)
  approve(
    @Param('clientAccountId') clientAccountId: string,
    @Body(new ZodValidationPipe(ApproveSignUpRequest)) body: z.output<typeof ApproveSignUpRequest>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ApproveSignUpResponse> {
    return this.signUps.approve(
      { businessId: tenant.businessId, userId: auth.userId },
      clientAccountId,
      body,
    );
  }

  @Post(':clientAccountId/decline')
  @HttpCode(200)
  decline(
    @Param('clientAccountId') clientAccountId: string,
    @Body(new ZodValidationPipe(DeclineSignUpRequest)) body: z.output<typeof DeclineSignUpRequest>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DeclineSignUpResponse> {
    return this.signUps.decline(
      { businessId: tenant.businessId, userId: auth.userId },
      clientAccountId,
      body,
    );
  }

  /** Resolve Existing Account (Octavia's D2): the three checks for one candidate record. */
  @Post(':clientAccountId/checks')
  @HttpCode(200)
  recordChecks(
    @Param('clientAccountId') clientAccountId: string,
    @Body(new ZodValidationPipe(RecordSignUpChecksRequest))
    body: z.output<typeof RecordSignUpChecksRequest>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ClientSignUpDetail> {
    return this.signUps.recordChecks(
      { businessId: tenant.businessId, userId: auth.userId },
      clientAccountId,
      body,
    );
  }

  @Post(':clientAccountId/link')
  @HttpCode(200)
  link(
    @Param('clientAccountId') clientAccountId: string,
    @Body(new ZodValidationPipe(LinkSignUpRequest)) body: z.output<typeof LinkSignUpRequest>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ApproveSignUpResponse> {
    return this.signUps.link(
      { businessId: tenant.businessId, userId: auth.userId },
      clientAccountId,
      body,
    );
  }

  @Post(':clientAccountId/restore-access')
  @HttpCode(200)
  restoreAccess(
    @Param('clientAccountId') clientAccountId: string,
    @Body(new ZodValidationPipe(RestoreSignUpAccessRequest))
    body: z.output<typeof RestoreSignUpAccessRequest>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<RestoreSignUpAccessResponse> {
    return this.signUps.restoreAccess(
      { businessId: tenant.businessId, userId: auth.userId },
      clientAccountId,
      body,
    );
  }

  @Post(':clientAccountId/not-a-match')
  @HttpCode(200)
  notAMatch(
    @Param('clientAccountId') clientAccountId: string,
    @Body(new ZodValidationPipe(SignUpNotAMatchRequest))
    body: z.output<typeof SignUpNotAMatchRequest>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<SignUpNotAMatchResponse> {
    return this.signUps.notAMatch(
      { businessId: tenant.businessId, userId: auth.userId },
      clientAccountId,
      body,
    );
  }

  @Post(':clientAccountId/keep-pending')
  @HttpCode(200)
  keepPending(
    @Param('clientAccountId') clientAccountId: string,
    @Body(new ZodValidationPipe(KeepSignUpPendingRequest))
    body: z.output<typeof KeepSignUpPendingRequest>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<KeepSignUpPendingResponse> {
    return this.signUps.keepPending(
      { businessId: tenant.businessId, userId: auth.userId },
      clientAccountId,
      body,
    );
  }
}

@Module({
  imports: [SignInModule, SignUpModule],
  controllers: [ClientSignUpsController],
  providers: [ClientSignUpsService],
})
export class ClientSignUpsModule {}
