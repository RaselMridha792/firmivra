import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type OkResponse,
  type ProjectDeadline,
  ProjectDeadlineId,
  type ProjectDeadlineList,
  ProjectDeadlinesQuery,
  SaveProjectDeadlineRequest,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { type DeadlineActor, ProjectDeadlinesService } from './project-deadlines.service.js';

const who = (auth: AuthContext, tenant: TenantContext): DeadlineActor => ({
  userId: auth.userId,
  tenant,
});
const idPipe = () => new ZodValidationPipe(ProjectDeadlineId);

/**
 * Tax Planning Review 2, Project Deadlines (contract in
 * packages/types/src/tax-planning/project-deadlines.ts): everyone with Tax Planning keeps their
 * own deadlines and sees the ones shared with them. The firm comes from TenantGuard and the
 * owner is always the caller, never the body.
 */
@Controller('business/tax-planning/project-deadlines')
@Access('TAX_PLANNING')
@Roles(...FIRM_STAFF)
export class ProjectDeadlinesController {
  constructor(private readonly deadlines: ProjectDeadlinesService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ProjectDeadlinesQuery)) q: z.output<typeof ProjectDeadlinesQuery>,
  ): Promise<ProjectDeadlineList> {
    return { items: await this.deadlines.list(who(auth, tenant), q) };
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe()) id: string,
  ): Promise<ProjectDeadline> {
    return this.deadlines.get(who(auth, tenant), id);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveProjectDeadlineRequest))
    body: z.output<typeof SaveProjectDeadlineRequest>,
  ): Promise<ProjectDeadline> {
    return this.deadlines.create(who(auth, tenant), body);
  }

  @Put(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe()) id: string,
    @Body(new ZodValidationPipe(SaveProjectDeadlineRequest))
    body: z.output<typeof SaveProjectDeadlineRequest>,
  ): Promise<ProjectDeadline> {
    return this.deadlines.update(who(auth, tenant), id, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe()) id: string,
  ): Promise<ProjectDeadline> {
    return this.deadlines.setCompleted(who(auth, tenant), id, true);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe()) id: string,
  ): Promise<ProjectDeadline> {
    return this.deadlines.setCompleted(who(auth, tenant), id, false);
  }

  @Delete(':id')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe()) id: string,
  ): Promise<OkResponse> {
    await this.deadlines.remove(who(auth, tenant), id);
    return { ok: true };
  }
}
