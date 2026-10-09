import { Controller, Get, Param, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  InvoiceId,
  ListMyInvoicesQuery,
  type MyInvoiceDetail,
  type MyInvoiceList,
} from '@firmivra/types';
import { CurrentTenant, Roles } from '../../auth/decorators.js';
import type { TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { MyInvoicesService } from './my-invoices.service.js';

export function portalLogin(tenant: TenantContext) {
  if (tenant.kind !== 'client') throw new Error('portal routes are for clients');
  return tenant;
}

/**
 * The signed-in client's invoices at one firm (portal Receipts & Invoices, R7). The firm comes
 * from the slug and the client from the session (TenantGuard), never from the URL.
 */
@Controller('portal/:firmSlug/me/invoices')
@Roles('CLIENT')
export class MyInvoicesController {
  constructor(private readonly mine: MyInvoicesService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListMyInvoicesQuery)) q: z.output<typeof ListMyInvoicesQuery>,
  ): Promise<MyInvoiceList> {
    const me = portalLogin(tenant);
    return this.mine.list(me.businessId, me.clientAccountId, q);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(InvoiceId)) id: string,
  ): Promise<MyInvoiceDetail> {
    const me = portalLogin(tenant);
    return this.mine.get(me.businessId, me.clientAccountId, id);
  }
}
