import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  CancelInvoiceRequest,
  CreateInvoiceRequest,
  type Invoice,
  InvoiceId,
  type InvoiceList,
  ListInvoicesQuery,
  UpdateInvoiceRequest,
} from '@firmivra/types';
import {
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../../auth/decorators.js';
import type { ClientsActor } from '../../clients/clients.service.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { NotificationsModule } from '../../notifications/notifications.controller.js';
import { InvoiceNotices } from './invoice-notices.js';
import { InvoicesService } from './invoices.service.js';
import { MyInvoicesController } from './my-invoices.controller.js';
import { MyInvoicesService } from './my-invoices.service.js';

const idPipe = new ZodValidationPipe(InvoiceId);
/** send takes no fields at all. */
const SendInvoiceRequest = z.strictObject({});

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

  @Post()
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateInvoiceRequest)) body: z.output<typeof CreateInvoiceRequest>,
  ): Promise<Invoice> {
    return this.invoices.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Post(':id/send')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SendInvoiceRequest)) _body: z.output<typeof SendInvoiceRequest>,
  ): Promise<Invoice> {
    return this.invoices.send(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CancelInvoiceRequest)) body: z.output<typeof CancelInvoiceRequest>,
  ): Promise<Invoice> {
    return this.invoices.cancel(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Put(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateInvoiceRequest)) body: z.output<typeof UpdateInvoiceRequest>,
  ): Promise<Invoice> {
    return this.invoices.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [InvoicesController, MyInvoicesController],
  providers: [InvoicesService, MyInvoicesService, InvoiceNotices],
  exports: [InvoicesService, MyInvoicesService, InvoiceNotices],
})
export class InvoicesModule {}
