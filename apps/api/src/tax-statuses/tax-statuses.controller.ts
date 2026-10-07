import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  CreateTaxStatusRequest,
  ListTaxStatusesQuery,
  type ListTaxStatusesResponse,
  OrderTaxStatusesRequest,
  RenameTaxStatusRequest,
  type TaxStatus,
  TaxStatusId,
} from '@firmivra/types';
import { CurrentTenant, FIRM_MANAGERS, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TaxStatusesService } from './tax-statuses.service.js';

const idPipe = new ZodValidationPipe(TaxStatusId);

/**
 * The firm's tax statuses (T04; contract in packages/types/src/tax-statuses). Staff list them;
 * Owner and Admin add, rename, reorder and archive. The firm comes from TenantGuard.
 */
@Controller('business/tax-statuses')
export class TaxStatusesController {
  constructor(private readonly taxStatuses: TaxStatusesService) {}

  @Get()
  @Roles(...FIRM_STAFF)
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListTaxStatusesQuery))
    query: z.output<typeof ListTaxStatusesQuery>,
  ): Promise<ListTaxStatusesResponse> {
    return { items: await this.taxStatuses.list(tenant.businessId, query.includeArchived) };
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateTaxStatusRequest))
    body: z.output<typeof CreateTaxStatusRequest>,
  ): Promise<TaxStatus> {
    return this.taxStatuses.create(tenant.businessId, body.name);
  }

  @Put('order')
  @Roles(...FIRM_MANAGERS)
  async reorder(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(OrderTaxStatusesRequest))
    body: z.output<typeof OrderTaxStatusesRequest>,
  ): Promise<ListTaxStatusesResponse> {
    return { items: await this.taxStatuses.reorder(tenant.businessId, body.ids) };
  }

  @Patch(':id')
  @Roles(...FIRM_MANAGERS)
  rename(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RenameTaxStatusRequest))
    body: z.output<typeof RenameTaxStatusRequest>,
  ): Promise<TaxStatus> {
    return this.taxStatuses.rename(tenant.businessId, id, body.name);
  }

  @Post(':id/archive')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  archive(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxStatus> {
    return this.taxStatuses.archive(tenant.businessId, id);
  }
}

@Module({ controllers: [TaxStatusesController], providers: [TaxStatusesService] })
export class TaxStatusesModule {}
