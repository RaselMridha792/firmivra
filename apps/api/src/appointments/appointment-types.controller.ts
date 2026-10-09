import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type AppointmentType,
  AppointmentTypeId,
  type AppointmentTypeList,
  AppointmentTypesQuery,
} from '@firmivra/types';
import { CurrentTenant, FIRM_MANAGERS, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AppointmentTypesService } from './appointment-types.service.js';
import { CreateTypeBody, idParam, UpdateTypeBody } from './appointments.input.js';

const idPipe = new ZodValidationPipe(idParam(AppointmentTypeId));

/**
 * The firm's appointment types (R12 step 2). Everyone at the firm reads; Owner and Admin create,
 * edit, archive and restore (Staff: 403). The firm comes from TenantGuard.
 */
@Controller('business/appointment-types')
@Roles(...FIRM_STAFF)
export class AppointmentTypesController {
  constructor(private readonly types: AppointmentTypesService) {}

  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(AppointmentTypesQuery)) q: z.output<typeof AppointmentTypesQuery>,
  ): Promise<AppointmentTypeList> {
    return { items: await this.types.list(tenant.businessId, q) };
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateTypeBody)) body: z.output<typeof CreateTypeBody>,
    // The request as sent (checked above): which fields it named, for the audit row.
    @Body() sent: object,
  ): Promise<AppointmentType> {
    return this.types.create(tenant.businessId, body, Object.keys(sent));
  }

  @Patch(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTypeBody)) body: z.output<typeof UpdateTypeBody>,
  ): Promise<AppointmentType> {
    return this.types.update(tenant.businessId, id, body);
  }

  @Post(':id/archive')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  archive(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<AppointmentType> {
    return this.types.setArchived(tenant.businessId, id, true);
  }

  @Post(':id/restore')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  restore(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<AppointmentType> {
    return this.types.setArchived(tenant.businessId, id, false);
  }
}
