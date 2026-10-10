import { Body, Controller, HttpCode, Module, Param, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  type Invoice,
  InvoiceId,
  OfflinePaymentId,
  RecordOfflinePaymentRequest,
  VoidOfflinePaymentRequest,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../../auth/decorators.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { actorOf, InvoicesModule } from '../invoices/invoices.module.js';
import { OfflinePaymentsService } from './offline-payments.service.js';

const idPipe = new ZodValidationPipe(InvoiceId);

/** Check and cash payments on an invoice (R7): Owner and Admin; Staff 403 before the body is read. */
@Controller('business/invoices')
@Roles(...FIRM_MANAGERS)
export class OfflinePaymentsController {
  constructor(private readonly offline: OfflinePaymentsService) {}

  @Post(':id/offline-payments')
  @HttpCode(200)
  record(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RecordOfflinePaymentRequest))
    body: z.output<typeof RecordOfflinePaymentRequest>,
  ): Promise<Invoice> {
    return this.offline.record(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/offline-payments/:offlinePaymentId/void')
  @HttpCode(200)
  void(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('offlinePaymentId', new ZodValidationPipe(OfflinePaymentId)) offlinePaymentId: string,
    @Body(new ZodValidationPipe(VoidOfflinePaymentRequest))
    body: z.output<typeof VoidOfflinePaymentRequest>,
  ): Promise<Invoice> {
    return this.offline.void(tenant.businessId, actorOf(auth, tenant), id, offlinePaymentId, body);
  }
}

@Module({
  imports: [InvoicesModule],
  controllers: [OfflinePaymentsController],
  providers: [OfflinePaymentsService],
})
export class OfflinePaymentsModule {}
