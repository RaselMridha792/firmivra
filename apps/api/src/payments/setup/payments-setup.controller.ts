import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import {
  type PaymentsSetup,
  StartOnboardingRequest,
  type StripeOnboardingLink,
} from '@firmivra/types';
import { CurrentTenant, FIRM_MANAGERS, Roles } from '../../auth/decorators.js';
import type { TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PaymentsSetupService } from './payments-setup.service.js';

/**
 * Settings > Payments: the firm's Stripe Connect account (packages/types/src/payments/setup.ts).
 * The Owner and Admins read; only the Owner connects (Admin 403); Staff 403 on every route. An
 * ACTIVE firm only; the firm comes from TenantGuard.
 */
@Controller('business/payments/setup')
export class PaymentsSetupController {
  constructor(private readonly setup: PaymentsSetupService) {}

  @Get()
  @Roles(...FIRM_MANAGERS)
  get(@CurrentTenant() tenant: TenantContext): Promise<PaymentsSetup> {
    return this.setup.get(tenant.businessId);
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
}

@Module({ controllers: [PaymentsSetupController], providers: [PaymentsSetupService] })
export class PaymentsSetupModule {}
