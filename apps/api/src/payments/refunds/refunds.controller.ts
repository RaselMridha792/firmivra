import { Body, Controller, HttpCode, Module, Param, Post } from '@nestjs/common';
import type { z } from 'zod';
import { type Invoice, InvoiceId, PaymentId, RefundPaymentRequest } from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../../auth/decorators.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { actorOf, InvoicesModule } from '../invoices/invoices.module.js';
import { RefundsService } from './refunds.service.js';

/** Refunds of an invoice's payment (R7): Owner and Admin; Staff 403 before the body is read. */
@Controller('business/invoices')
@Roles(...FIRM_MANAGERS)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Post(':id/payments/:paymentId/refunds')
  @HttpCode(200)
  refund(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(InvoiceId)) id: string,
    @Param('paymentId', new ZodValidationPipe(PaymentId)) paymentId: string,
    @Body(new ZodValidationPipe(RefundPaymentRequest)) body: z.output<typeof RefundPaymentRequest>,
  ): Promise<Invoice> {
    return this.refunds.refund(tenant.businessId, actorOf(auth, tenant), id, paymentId, body);
  }
}

@Module({
  imports: [InvoicesModule],
  controllers: [RefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
