import { Body, Controller, HttpCode, Module, Param, Post } from '@nestjs/common';
import { type CheckoutLink, InvoiceId, PayInvoiceRequest } from '@firmivra/types';
import { CurrentTenant, Roles } from '../../auth/decorators.js';
import type { TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { portalLogin } from '../invoices/my-invoices.controller.js';
import { CheckoutService } from './checkout.service.js';

/** Pay Now on the portal (R7). The client comes from the session; the body has no fields. */
@Controller('portal/:firmSlug/me/invoices')
@Roles('CLIENT')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post(':id/checkout')
  @HttpCode(200)
  pay(
    @CurrentTenant() tenant: TenantContext,
    @Param('firmSlug') firmSlug: string,
    @Param('id', new ZodValidationPipe(InvoiceId)) id: string,
    @Body(new ZodValidationPipe(PayInvoiceRequest)) _body: PayInvoiceRequest,
  ): Promise<CheckoutLink> {
    const me = portalLogin(tenant);
    return this.checkout.start(me.businessId, me.clientAccountId, firmSlug, id);
  }
}

@Module({
  imports: [InvoicesModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
