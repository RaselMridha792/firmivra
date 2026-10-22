import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import type {
  CustomRole,
  CustomRoleDetail,
  MembershipRole,
  PermissionModuleList,
  RoleList,
  RolePermissions,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CustomRolesService } from './custom-roles.service.js';
import {
  CreateCustomRoleBody,
  CustomRoleParam,
  RoleParam,
  SaveRoleBody,
  UpdateCustomRoleBody,
} from './roles-input.js';
import { RolesService } from './roles.service.js';

type Out<S extends z.ZodType> = z.output<S>;

const rolePipe = new ZodValidationPipe(RoleParam);
const customPipe = new ZodValidationPipe(CustomRoleParam);

/**
 * Roles and the permission grid (Create Staff step 2, Settings > Users & Roles), and the firm's
 * own roles (Create Custom Role). Owner and Admin only.
 */
@Controller('business')
@Access('STAFF_MANAGEMENT')
@Roles(...FIRM_MANAGERS)
export class RolesController {
  constructor(
    private readonly roles: RolesService,
    private readonly custom: CustomRolesService,
  ) {}

  @Get('roles')
  list(@CurrentTenant() tenant: TenantContext): Promise<RoleList> {
    return this.roles.list(tenant);
  }

  @Post('roles/custom')
  createCustom(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateCustomRoleBody)) body: Out<typeof CreateCustomRoleBody>,
  ): Promise<CustomRole> {
    return this.custom.create(tenant, auth.userId, body);
  }

  @Get('roles/custom/:id')
  customRole(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', customPipe) id: string,
  ): Promise<CustomRoleDetail> {
    return this.custom.get(tenant, id);
  }

  @Patch('roles/custom/:id')
  updateCustom(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', customPipe) id: string,
    @Body(new ZodValidationPipe(UpdateCustomRoleBody)) body: Out<typeof UpdateCustomRoleBody>,
  ): Promise<CustomRoleDetail> {
    return this.custom.update(tenant, auth.userId, id, body);
  }

  @Post('roles/custom/:id/archive')
  @HttpCode(200)
  archiveCustom(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', customPipe) id: string,
  ): Promise<CustomRole> {
    return this.custom.archive(tenant, auth.userId, id);
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
