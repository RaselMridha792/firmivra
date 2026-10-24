import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  DepartmentId,
  StaffTeamId,
  type Department,
  type DepartmentDetail,
  type DepartmentListResponse,
  type DepartmentMembers,
  type DepartmentSummary,
  type OrgChart,
  type StaffTeam,
  type StaffTeamDetail,
  type StaffTeamList,
} from '@firmivra/types';
import type { z } from 'zod';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  CreateDepartmentBody,
  CreateTeamBody,
  DepartmentListQ,
  SetDepartmentMembersBody,
  SetTeamMembersBody,
  TeamListQ,
  UpdateDepartmentBody,
  UpdateTeamBody,
} from './departments-input.js';
import { DepartmentsService } from './departments.service.js';

type Out<S extends z.ZodType> = z.output<S>;

const departmentPipe = new ZodValidationPipe(DepartmentId);
const teamPipe = new ZodValidationPipe(StaffTeamId);

/**
 * Teams & Departments and the org chart. Everyone with the grid's Staff Management view reads;
 * only Owner and Admin change (403 FORBIDDEN for the others). Never a portal route.
 */
@Controller('business')
@Access('STAFF_MANAGEMENT')
@Roles(...FIRM_STAFF)
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get('departments')
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(DepartmentListQ)) q: Out<typeof DepartmentListQ>,
  ): Promise<DepartmentListResponse> {
    return this.departments.list(tenant, q);
  }

  @Get('departments/summary')
  summary(@CurrentTenant() tenant: TenantContext): Promise<DepartmentSummary> {
    return this.departments.summary(tenant);
  }

  @Post('departments')
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateDepartmentBody)) body: Out<typeof CreateDepartmentBody>,
  ): Promise<Department> {
    return this.departments.create(tenant, auth.userId, body);
  }

  @Get('departments/:id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', departmentPipe) id: string,
  ): Promise<DepartmentDetail> {
    return this.departments.get(tenant, id);
  }

  /** Manage Members on a department (Octavia's SM13): read as the department. */
  @Get('departments/:id/members')
  members(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', departmentPipe) id: string,
  ): Promise<DepartmentMembers> {
    return this.departments.departmentMembers(tenant, id);
  }

  @Put('departments/:id/members')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  setDepartmentMembers(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', departmentPipe) id: string,
    @Body(new ZodValidationPipe(SetDepartmentMembersBody))
    body: Out<typeof SetDepartmentMembersBody>,
  ): Promise<DepartmentMembers> {
    return this.departments.setDepartmentMembers(tenant, auth.userId, id, body);
  }

  @Patch('departments/:id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', departmentPipe) id: string,
    @Body(new ZodValidationPipe(UpdateDepartmentBody)) body: Out<typeof UpdateDepartmentBody>,
  ): Promise<Department> {
    return this.departments.update(tenant, auth.userId, id, body);
  }

  @Get('teams')
  teams(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TeamListQ)) q: Out<typeof TeamListQ>,
  ): Promise<StaffTeamList> {
    return this.departments.teams(tenant, q);
  }

  @Post('teams')
  @Roles(...FIRM_MANAGERS)
  createTeam(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateTeamBody)) body: Out<typeof CreateTeamBody>,
  ): Promise<StaffTeam> {
    return this.departments.createTeam(tenant, auth.userId, body);
  }

  @Get('teams/:id')
  team(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', teamPipe) id: string,
  ): Promise<StaffTeamDetail> {
    return this.departments.team(tenant, id);
  }

  @Patch('teams/:id')
  @Roles(...FIRM_MANAGERS)
  updateTeam(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', teamPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTeamBody)) body: Out<typeof UpdateTeamBody>,
  ): Promise<StaffTeam> {
    return this.departments.updateTeam(tenant, auth.userId, id, body);
  }

  @Put('teams/:id/members')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  setMembers(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', teamPipe) id: string,
    @Body(new ZodValidationPipe(SetTeamMembersBody)) body: Out<typeof SetTeamMembersBody>,
  ): Promise<StaffTeamDetail> {
    return this.departments.setTeamMembers(tenant, auth.userId, id, body);
  }

  @Get('org-chart')
  orgChart(@CurrentTenant() tenant: TenantContext): Promise<OrgChart> {
    return this.departments.orgChart(tenant);
  }
}
