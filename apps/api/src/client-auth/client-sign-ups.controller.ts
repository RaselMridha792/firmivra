import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  ApproveSignUpRequest,
  type ApproveSignUpResponse,
  type ClientSignUpList,
  ClientSignUpsQuery,
  DeclineSignUpRequest,
  type DeclineSignUpResponse,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import { SignInModule } from '../auth/sign-in.controller.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ClientSignUpsService } from './client-sign-ups.service.js';
import { SignUpModule } from './sign-up.controller.js';

/** Both bodies are optional: an empty POST approves (new record) or declines (no reason). */
const ApproveBody = ApproveSignUpRequest.optional();
const DeclineBody = DeclineSignUpRequest.optional();

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

  @Post(':clientAccountId/approve')
  @HttpCode(200)
  approve(
    @Param('clientAccountId') clientAccountId: string,
    @Body(new ZodValidationPipe(ApproveBody)) body: z.output<typeof ApproveBody>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ApproveSignUpResponse> {
    return this.signUps.approve(
      { businessId: tenant.businessId, userId: auth.userId },
      clientAccountId,
      body?.clientId,
    );
  }

  @Post(':clientAccountId/decline')
  @HttpCode(200)
  decline(
    @Param('clientAccountId') clientAccountId: string,
    @Body(new ZodValidationPipe(DeclineBody)) body: z.output<typeof DeclineBody>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DeclineSignUpResponse> {
    return this.signUps.decline(
      { businessId: tenant.businessId, userId: auth.userId },
      clientAccountId,
      body?.reason,
    );
  }
}

@Module({
  imports: [SignInModule, SignUpModule],
  controllers: [ClientSignUpsController],
  providers: [ClientSignUpsService],
})
export class ClientSignUpsModule {}
