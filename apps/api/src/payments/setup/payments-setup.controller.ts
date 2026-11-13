import { Body, Controller, Get, HttpCode, Module, Post, Put } from '@nestjs/common';
import {
  type AcceptedPayments,
  type PaymentsSetup,
  SaveAcceptedPaymentsRequest,
  StartOnboardingRequest,
  type StripeOnboardingLink,
} from '@firmivra/types';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../../auth/decorators.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AcceptedPaymentsService } from './accepted-payments.service.js';
import { PaymentsSetupService } from './payments-setup.service.js';

/**
 * Settings > Payments: the firm's Stripe Connect account (packages/types/src/payments/setup.ts).
 * The Owner and Admins read and sync; only the Owner connects (Admin 403); Staff 403 on every route. An
 * ACTIVE firm only; the firm comes from TenantGuard.
 */
@Controller('business/payments/setup')
export class PaymentsSetupController {
  constructor(
    private readonly setup: PaymentsSetupService,
    private readonly accepted: AcceptedPaymentsService,
  ) {}

  @Get()
  @Roles(...FIRM_MANAGERS)
  get(@CurrentTenant() tenant: TenantContext): Promise<PaymentsSetup> {
    return this.setup.get(tenant.businessId);
  }

  @Post('sync')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  sync(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(StartOnboardingRequest)) _body: StartOnboardingRequest,
  ): Promise<PaymentsSetup> {
    return this.setup.sync(tenant.businessId);
  }

  @Post('onboarding')
  @HttpCode(200)
  @Roles('OWNER')
  start(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(StartOnboardingRequest)) _body: StartOnboardingRequest,
  ): Promise<StripeOnboardingLink> {
    return this.setup.start(tenant.businessId);
  }

  @Post('onboarding/refresh')
  @HttpCode(200)
  @Roles('OWNER')
  refresh(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(StartOnboardingRequest)) _body: StartOnboardingRequest,
  ): Promise<StripeOnboardingLink> {
    return this.setup.refresh(tenant.businessId);
  }

  /** Accepted Client Payments (PAY-3): the Owner and Admins read and change it. */
  @Get('accepted')
  @Roles(...FIRM_MANAGERS)
  acceptedPayments(@CurrentTenant() tenant: TenantContext): Promise<AcceptedPayments> {
    return this.accepted.get(tenant.businessId);
  }

  @Put('accepted')
  @Roles(...FIRM_MANAGERS)
  saveAccepted(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveAcceptedPaymentsRequest))
    body: z.output<typeof SaveAcceptedPaymentsRequest>,
  ): Promise<AcceptedPayments> {
    return this.accepted.save(tenant.businessId, auth.userId, body);
  }
}

@Module({
  controllers: [PaymentsSetupController],
  providers: [PaymentsSetupService, AcceptedPaymentsService],
})
export class PaymentsSetupModule {}
