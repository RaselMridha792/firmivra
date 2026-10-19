import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import type {
  StaffDetail,
  StaffFormOptions,
  StaffListResponse,
  StaffPermissions,
  StaffSummary,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { StaffIdParam, StaffListQ } from './staff-input.js';
import { StaffReadService } from './staff-read.service.js';

type Out<S extends z.ZodType> = z.output<S>;

/**
 * The Staff Management directory (contract in packages/types/src/staff). Everyone with the grid's
 * Staff Management view reads. Static routes come before ':id'. Never a portal route.
 */
@Controller('business/staff')
@Access('STAFF_MANAGEMENT')
@Roles(...FIRM_STAFF)
export class StaffController {
  constructor(private readonly read: StaffReadService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(StaffListQ)) q: Out<typeof StaffListQ>,
  ): Promise<StaffListResponse> {
    return this.read.list(tenant, auth.userId, q);
  }

  @Get('summary')
  summary(@CurrentTenant() tenant: TenantContext): Promise<StaffSummary> {
    return this.read.summary(tenant);
  }

  @Get('options')
  options(@CurrentTenant() tenant: TenantContext): Promise<StaffFormOptions> {
    return this.read.options(tenant);
  }

  @Get('import/template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="staff-import-template.csv"')
  importTemplate(): string {
    return this.read.importTemplate();
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(StaffIdParam)) id: string,
  ): Promise<StaffDetail> {
    return this.read.get(tenant, auth.userId, id);
  }

  @Get(':id/permissions')
  permissions(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(StaffIdParam)) id: string,
  ): Promise<StaffPermissions> {
    return this.read.permissions(tenant, id);
  }
}
