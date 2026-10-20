import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type AdminTeamActivityList,
  AdminTeamActivityQuery,
  AdminTeamBulkRequest,
  type AdminTeamBulkResult,
  AdminTeamDecisionRequest,
  type AdminTeamFormOptions,
  type AdminTeamMember,
  AdminTeamMemberId,
  type AdminTeamMemberPage,
  type AdminTeamMemberResult,
  AdminTeamMembersQuery,
  type AdminTeamMeta,
  type AdminTeamSummary,
  UpdateAdminTeamMemberRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TeamReadService } from './team-read.service.js';
import { TeamWriteService } from './team-write.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const memberId = pipe(AdminTeamMemberId);

/**
 * Super Admin Team (R60 on R0's stage A tables; contract `packages/types/src/admin-team`), under
 * /api/v1/admin/team: the signed-in member and the catalog, the KPIs, the directory, one member
 * and their trail, the forms' choices, Edit Team Member, the bulk changes and the department
 * head's decision. Super Admins only today; the hierarchy rules apply from the caller's own
 * org-chart row. Fixed paths come before `:id`. Add Team Member (`POST /members`) and Resend
 * Invitation (`POST /members/invitations`) are not registered: they create or need ADMIN-pool
 * logins, which wait for R2's admin-invite service (docs/work/R60-team.md).
 */
@Controller('admin/team')
@Roles('SUPER_ADMIN')
export class AdminTeamController {
  constructor(
    private readonly reads: TeamReadService,
    private readonly writes: TeamWriteService,
  ) {}

  @Get('meta')
  meta(): Promise<AdminTeamMeta> {
    return this.reads.meta();
  }

  @Get('summary')
  summary(): Promise<AdminTeamSummary> {
    return this.reads.summary();
  }

  @Get('form-options')
  formOptions(): Promise<AdminTeamFormOptions> {
    return this.reads.formOptions();
  }

  @Get('members')
  members(
    @Query(pipe(AdminTeamMembersQuery)) q: Out<typeof AdminTeamMembersQuery>,
  ): Promise<AdminTeamMemberPage> {
    return this.reads.members(q);
  }

  @Post('members/bulk')
  @HttpCode(200)
  bulk(
    @Body(pipe(AdminTeamBulkRequest)) body: Out<typeof AdminTeamBulkRequest>,
  ): Promise<AdminTeamBulkResult> {
    return this.writes.bulk(body);
  }

  @Get('members/:id')
  member(@Param('id', memberId) id: string): Promise<AdminTeamMember> {
    return this.reads.member(id);
  }

  @Patch('members/:id')
  update(
    @Param('id', memberId) id: string,
    @Body(pipe(UpdateAdminTeamMemberRequest)) body: Out<typeof UpdateAdminTeamMemberRequest>,
  ): Promise<AdminTeamMember> {
    return this.writes.update(id, body);
  }

  @Get('members/:id/activity')
  activity(
    @Param('id', memberId) id: string,
    @Query(pipe(AdminTeamActivityQuery)) q: Out<typeof AdminTeamActivityQuery>,
  ): Promise<AdminTeamActivityList> {
    return this.reads.activity(id, q);
  }

  @Get('members/:id/form-options')
  memberFormOptions(@Param('id', memberId) id: string): Promise<AdminTeamFormOptions> {
    return this.reads.formOptions(id);
  }

  @Post('members/:id/decision')
  @HttpCode(200)
  decide(
    @Param('id', memberId) id: string,
    @Body(pipe(AdminTeamDecisionRequest)) body: Out<typeof AdminTeamDecisionRequest>,
  ): Promise<AdminTeamMemberResult> {
    return this.writes.decide(id, body);
  }
}
