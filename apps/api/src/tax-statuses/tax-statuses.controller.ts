import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  Module,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CreateTaxStatusRequest,
  RenameTaxStatusRequest,
  OrderTaxStatusesRequest,
  ListTaxStatusesQuery,
} from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TaxStatusesService } from './tax-statuses.service.js';
@Controller('business/tax-statuses')
@Roles('OWNER', 'ADMIN')
export class TaxStatusesController {
  constructor(private readonly statuses: TaxStatusesService) {}
  @Get() @Roles('OWNER', 'ADMIN', 'STAFF') list(
    @Query(new ZodValidationPipe(ListTaxStatusesQuery))
    query: z.output<typeof ListTaxStatusesQuery>,
  ) {
    return this.statuses.list(query);
  }
  @Post() create(
    @Body(new ZodValidationPipe(CreateTaxStatusRequest))
    body: z.output<typeof CreateTaxStatusRequest>,
  ) {
    return this.statuses.create(body.name);
  }
  @Put('order') order(
    @Body(new ZodValidationPipe(OrderTaxStatusesRequest))
    body: z.output<typeof OrderTaxStatusesRequest>,
  ) {
    return this.statuses.order(body.ids);
  }
  @Patch(':id') rename(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(RenameTaxStatusRequest))
    body: z.output<typeof RenameTaxStatusRequest>,
  ) {
    return this.statuses.rename(id, body.name);
  }
  @Post(':id/archive') @HttpCode(200) archive(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return this.statuses.archive(id);
  }
}
@Module({ controllers: [TaxStatusesController], providers: [TaxStatusesService] })
export class TaxStatusesModule {}
