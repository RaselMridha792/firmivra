import { Module } from '@nestjs/common';
import { SignInModule } from '../auth/sign-in.controller.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { AdminTeamController } from './admin-team.controller.js';
import { TeamInvitationTokens } from './team-invitation.js';
import { TeamInviteService } from './team-invite.service.js';
import { TeamReadService } from './team-read.service.js';
import { TeamWriteService } from './team-write.service.js';

/**
 * Super Admin Team (R60 on R0's stage A org chart): Firmivra's own people, under
 * /api/v1/admin/team, in the Super Admin's admin scope. The identity adapter (R2's SignInModule)
 * creates a new member's ADMIN-pool login, disables one lost to a race, and answers whether a
 * login has a password, for reactivation. `TeamInvitationTokens` is exported for R2's activation
 * (or built with `TeamInvitationTokens.fromEnv`, to keep SignInModule free of this module).
 */
@Module({
  imports: [SignInModule],
  controllers: [AdminTeamController],
  providers: [
    AdminPrisma,
    TeamReadService,
    TeamWriteService,
    TeamInviteService,
    {
      provide: TeamInvitationTokens,
      inject: [ENV],
      useFactory: (env: Env) => TeamInvitationTokens.fromEnv(env),
    },
  ],
  exports: [TeamInvitationTokens],
})
export class AdminTeamModule {}
