import { Body, Controller, Get, Put } from '@nestjs/common';
import type { StaffSecurityDefaults } from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SaveStaffSecurityDefaultsBody } from './staff-input.js';
import { StaffSecurityDefaultsService } from './staff-security-defaults.service.js';
import { staffActorOf } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;

/** Staff Settings > New Accounts & Security: what every new staff account starts from. */
@Controller('business/staff-security-defaults')
@Access('STAFF_MANAGEMENT')
@Roles(...FIRM_MANAGERS)
export class StaffSecurityDefaultsController {
  constructor(private readonly defaults: StaffSecurityDefaultsService) {}

  @Get()
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<StaffSecurityDefaults> {
    return this.defaults.get(staffActorOf(auth, tenant));
  }

  @Put()
  save(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveStaffSecurityDefaultsBody))
    body: Out<typeof SaveStaffSecurityDefaultsBody>,
  ): Promise<StaffSecurityDefaults> {
    return this.defaults.save(staffActorOf(auth, tenant), body);
  }
}
