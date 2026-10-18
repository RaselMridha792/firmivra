import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotImplementedException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type {
  MembershipRole,
  PermissionModuleList,
  RoleList,
  RolePermissions,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RoleParam, SaveRoleBody } from './roles-input.js';
import { RolesService } from './roles.service.js';

type Out<S extends z.ZodType> = z.output<S>;

const rolePipe = new ZodValidationPipe(RoleParam);

/**
 * Roles and the permission grid (Create Staff step 2, Settings > Users & Roles). Owner and Admin
 * only. A firm's own roles need a table that does not exist yet: creating one answers 501.
 */
@Controller('business')
@Access('STAFF_MANAGEMENT')
@Roles(...FIRM_MANAGERS)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  list(@CurrentTenant() tenant: TenantContext): Promise<RoleList> {
    return this.roles.list(tenant);
  }

  @Post('roles/custom')
  createCustom(): never {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED',
      message: 'Custom roles are not available yet',
    });
  }

  @Get('roles/:role/permissions')
  permissions(
    @CurrentTenant() tenant: TenantContext,
    @Param('role', rolePipe) role: MembershipRole,
  ): Promise<RolePermissions> {
    return this.roles.permissions(tenant, role);
  }

  @Put('roles/:role/permissions')
  save(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('role', rolePipe) role: MembershipRole,
    @Body(new ZodValidationPipe(SaveRoleBody)) body: Out<typeof SaveRoleBody>,
  ): Promise<RolePermissions> {
    return this.roles.save(tenant, auth.userId, role, body);
  }

  @Delete('roles/:role/permissions')
  @HttpCode(200)
  reset(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('role', rolePipe) role: MembershipRole,
  ): Promise<RolePermissions> {
    return this.roles.reset(tenant, auth.userId, role);
  }

  @Get('permission-modules')
  modules(): PermissionModuleList {
    return this.roles.modules();
  }
}
