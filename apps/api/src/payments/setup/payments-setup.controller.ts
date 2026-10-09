import { Controller, Get, Module } from '@nestjs/common';
import type { PaymentsSetup } from '@firmivra/types';
import { CurrentTenant, FIRM_MANAGERS, Roles } from '../../auth/decorators.js';
import type { TenantContext } from '../../common/request-context.js';
import { PaymentsSetupService } from './payments-setup.service.js';

/**
 * Settings > Payments: the firm's Stripe Connect account (packages/types/src/payments/setup.ts).
 * The Owner and Admins read; Staff 403. An ACTIVE firm only; the firm comes from TenantGuard.
 */
@Controller('business/payments/setup')
export class PaymentsSetupController {
  constructor(private readonly setup: PaymentsSetupService) {}

  @Get()
  @Roles(...FIRM_MANAGERS)
  get(@CurrentTenant() tenant: TenantContext): Promise<PaymentsSetup> {
    return this.setup.get(tenant.businessId);
  }
}

@Module({ controllers: [PaymentsSetupController], providers: [PaymentsSetupService] })
export class PaymentsSetupModule {}
