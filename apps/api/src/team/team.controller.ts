import { Body, Controller, Get, HttpCode, Module, Param, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  ChangeTeamRoleRequest,
  type ListTeamResponse,
  type TeamMember,
  TeamMemberId,
} from '@firmivra/types';
import {
  AllowBusinessStatuses,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  Roles,
} from '../auth/decorators.js';
import { SignInModule } from '../auth/sign-in.controller.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { type TeamActor, TeamService } from './team.service.js';

const idPipe = new ZodValidationPipe(TeamMemberId);

const actorOf = (auth: AuthContext, tenant: TenantContext): TeamActor => {
  // @Roles excludes clients on every route here.
  if (tenant.kind !== 'staff') throw new Error('unreachable: team routes are for firm staff');
  return { userId: auth.userId, role: tenant.role };
};

/**
 * The firm's team (T03; docs/api/team.yaml). Owner and Admin, also while the firm is Pending
 * Setup (the setup wizard's "Team and access" step). Role changes are for Owners only.
 */
@Controller('business/team')
@AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @Roles(...FIRM_MANAGERS)
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<ListTeamResponse> {
    return { items: await this.team.list(tenant.businessId, actorOf(auth, tenant)) };
  }

  @Patch(':id')
  @Roles('OWNER')
  changeRole(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ChangeTeamRoleRequest))
    body: z.output<typeof ChangeTeamRoleRequest>,
  ): Promise<TeamMember> {
    return this.team.changeRole(tenant.businessId, actorOf(auth, tenant), id, body.role);
  }

  @Post(':id/deactivate')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  deactivate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TeamMember> {
    return this.team.deactivate(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/resend-invite')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  resendInvite(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TeamMember> {
    return this.team.resendInvite(tenant.businessId, actorOf(auth, tenant), id);
  }
}

@Module({ imports: [SignInModule], controllers: [TeamController], providers: [TeamService] })
export class TeamModule {}
