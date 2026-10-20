import { Module } from '@nestjs/common';
import { SignInModule } from '../auth/sign-in.controller.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { AdminTeamController } from './admin-team.controller.js';
import { TeamReadService } from './team-read.service.js';
import { TeamWriteService } from './team-write.service.js';

/**
 * Super Admin Team (R60 on R0's stage A org chart): Firmivra's own people, under
 * /api/v1/admin/team, in the Super Admin's admin scope. The identity adapter (R2's SignInModule)
 * answers only whether a login has a password, for reactivation.
 */
@Module({
  imports: [SignInModule],
  controllers: [AdminTeamController],
  providers: [AdminPrisma, TeamReadService, TeamWriteService],
})
export class AdminTeamModule {}
