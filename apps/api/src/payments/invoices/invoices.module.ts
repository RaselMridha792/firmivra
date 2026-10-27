import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AddInvoiceHistoryRequest,
  CancelInvoiceRequest,
  CorrectInvoiceRequest,
  CreateInvoiceRequest,
  type Invoice,
  InvoiceId,
  type InvoiceHistory,
  type InvoiceHistoryItem,
  type InvoiceList,
  type InvoicePdfLink,
  ListInvoicesQuery,
  PaymentMethodsQuery,
  type PaymentMethodsSummary,
  UpdateInvoiceRequest,
} from '@firmivra/types';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../../auth/decorators.js';
import type { ClientsActor } from '../../clients/clients.service.js';
import {
  type AuthContext,
  legacyFirmRole,
  type TenantContext,
} from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { NotificationsModule } from '../../notifications/notifications.controller.js';
import { InvoiceJobs } from './invoice-jobs.js';
import { InvoiceNotices } from './invoice-notices.js';
import { InvoicesService } from './invoices.service.js';
import { MyInvoicesController } from './my-invoices.controller.js';
import { MyInvoicesService } from './my-invoices.service.js';
import { PortalTabsModule } from '../../client-portal/portal-tabs.js';
import { ReportsModule } from '../../reports/reports.module.js';

const idPipe = new ZodValidationPipe(InvoiceId);
/** send takes no fields at all. */
const SendInvoiceRequest = z.strictObject({});

export function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: legacyFirmRole(tenant.role) };
}

/**
 * The firm's invoices (R7 step 7). Reads: Owner, Admin and Staff (their clients only). Changes:
 * Owner and Admin; the role guard refuses Staff (403) before the body is read.
 */
@Controller('business/invoices')
@Access('INVOICES_PAYMENTS')
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

  /** IP-F20: the money collected by method (declared before `:id`). */
  @Get('payment-methods')
  paymentMethods(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(PaymentMethodsQuery)) q: z.output<typeof PaymentMethodsQuery>,
  ): Promise<PaymentMethodsSummary> {
    return this.invoices.paymentMethods(tenant.businessId, actorOf(auth, tenant), q);
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

  /** IP-F09: the invoice's history (notes and logged activity). */
  @Get(':id/history')
  history(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<InvoiceHistory> {
    return this.invoices.history(tenant.businessId, actorOf(auth, tenant), id);
  }

  /** IP-F09: Add Note, Log Activity. */
  @Post(':id/history')
  @Roles(...FIRM_MANAGERS)
  addHistory(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AddInvoiceHistoryRequest))
    body: z.output<typeof AddInvoiceHistoryRequest>,
  ): Promise<InvoiceHistoryItem> {
    return this.invoices.addHistory(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  /** IP-F09: the invoice as a PDF, behind a short-lived link. */
  @Get(':id/pdf')
  pdf(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<InvoicePdfLink> {
    return this.invoices.pdf(tenant.businessId, actorOf(auth, tenant), id);
  }

  /** IP-F08: the dates of a scheduled or unpaid open invoice, with a reason once sent. */
  @Post(':id/correct')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  correct(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CorrectInvoiceRequest))
    body: z.output<typeof CorrectInvoiceRequest>,
  ): Promise<Invoice> {
    return this.invoices.correct(tenant.businessId, actorOf(auth, tenant), id, body);
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
  // ReportsModule: its file store keeps the invoice PDFs under the firm's reports prefix.
  imports: [NotificationsModule, PortalTabsModule, ReportsModule],
  controllers: [InvoicesController, MyInvoicesController],
  providers: [InvoicesService, MyInvoicesService, InvoiceNotices, InvoiceJobs],
  exports: [InvoicesService, MyInvoicesService, InvoiceNotices, InvoiceJobs],
})
export class InvoicesModule {}
