import { Controller, Get, Patch, Post, HttpCode, Param, Body, Query, Module } from '@nestjs/common';
import { z } from 'zod';
import { ChangeTeamRoleRequest, ListTeamMembersQuery } from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TeamService } from './team.service.js';
import { InviteResender, PendingInviteResender } from './invite-resender.js';
@Controller('business/team')
@Roles('OWNER', 'ADMIN')
export class TeamController {
  constructor(private readonly team: TeamService) {}
  @Get() list(
    @Query(new ZodValidationPipe(ListTeamMembersQuery))
    query: z.output<typeof ListTeamMembersQuery>,
  ) {
    return this.team.list(query);
  }
  @Patch(':id/role') role(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(ChangeTeamRoleRequest))
    body: z.output<typeof ChangeTeamRoleRequest>,
  ) {
    return this.team.role(id, body);
  }
  @Post(':id/deactivate') @HttpCode(200) deactivate(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return this.team.deactivate(id);
  }
  @Post(':id/resend-invite') @HttpCode(202) resend(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return this.team.resend(id);
  }
}
@Module({
  controllers: [TeamController],
  providers: [TeamService, { provide: InviteResender, useClass: PendingInviteResender }],
})
export class TeamModule {}
