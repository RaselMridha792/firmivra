import { Controller, Get, Param, Query, Module } from '@nestjs/common';
import { z } from 'zod';
import { ListAdminApplicationsQuery, ListAdminApplicationHistoryQuery } from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApplicationsService } from './applications.service.js';
@Controller('admin/applications')
@Roles('SUPER_ADMIN')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}
  @Get() list(
    @Query(new ZodValidationPipe(ListAdminApplicationsQuery))
    query: z.output<typeof ListAdminApplicationsQuery>,
  ) {
    return this.applications.list(query);
  }
  @Get(':id') detail(@Param('id', new ZodValidationPipe(z.uuid())) id: string) {
    return this.applications.detail(id);
  }
  @Get(':id/history') history(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Query(new ZodValidationPipe(ListAdminApplicationHistoryQuery))
    query: z.output<typeof ListAdminApplicationHistoryQuery>,
  ) {
    return this.applications.history(id, query);
  }
}
@Module({ controllers: [ApplicationsController], providers: [ApplicationsService] })
export class ApplicationsModule {}
