import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import {
  CreateFirmBillingRequest,
  type FirmBillingInvoice,
  type FirmBillingInvoicePage,
  FirmBillingInvoicesQuery,
  type FirmBillingOverview,
  type FirmBillingRequest,
} from '@firmivra/types';
import type { Response } from 'express';
import { z } from 'zod';
import {
  AllowBusinessStatuses,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FirmBillingService } from './firm-billing.service.js';

const idPipe = new ZodValidationPipe(z.uuid().transform((v) => v.toLowerCase()));

/**
 * Settings > Billing & Subscriptions (`api.firmBilling`): the firm's Firmivra subscription, usage,
 * invoices and requests to Firmivra. Owner and Admin, also while Pending Setup.
 */
@Controller('business/billing')
@Roles(...FIRM_MANAGERS)
@AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')
export class FirmBillingController {
  constructor(private readonly billing: FirmBillingService) {}

  @Get()
  overview(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<FirmBillingOverview> {
    return this.billing.overview(tenant.businessId, auth.userId);
  }

  @Get('invoices')
  invoices(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(FirmBillingInvoicesQuery))
    query: z.output<typeof FirmBillingInvoicesQuery>,
  ): Promise<FirmBillingInvoicePage> {
    return this.billing.invoices(tenant.businessId, auth.userId, query);
  }

  @Get('invoices/:id')
  invoice(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
  ): Promise<FirmBillingInvoice> {
    return this.billing.invoice(tenant.businessId, auth.userId, id);
  }

  @Get('invoices/:id/pdf')
  async invoicePdf(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { bytes, fileName } = await this.billing.invoicePdf(tenant.businessId, auth.userId, id);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(bytes, { type: 'application/pdf', length: bytes.byteLength });
  }

  @Post('requests')
  request(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateFirmBillingRequest))
    body: z.output<typeof CreateFirmBillingRequest>,
  ): Promise<FirmBillingRequest> {
    return this.billing.request(tenant.businessId, auth.userId, body);
  }
}
