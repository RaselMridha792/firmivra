import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import type { z } from 'zod';
import { type Invoice, InvoiceId, type InvoiceList, ListInvoicesQuery } from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../../auth/decorators.js';
import type { ClientsActor } from '../../clients/clients.service.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { InvoicesService } from './invoices.service.js';

const idPipe = new ZodValidationPipe(InvoiceId);

export function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/**
 * The firm's invoices (R7 step 7). Reads: Owner, Admin and Staff (their clients only). Changes:
 * Owner and Admin; the role guard refuses Staff (403) before the body is read.
 */
@Controller('business/invoices')
@Roles(...FIRM_STAFF)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListInvoicesQuery)) q: z.output<typeof ListInvoicesQuery>,
  ): Promise<InvoiceList> {
    return this.invoices.list(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<Invoice> {
    return this.invoices.get(tenant.businessId, actorOf(auth, tenant), id);
  }
}

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
