import { Module } from '@nestjs/common';
import { SignInModule } from '../auth/sign-in.controller.js';
import { StaffActionsService } from './staff-actions.service.js';
import { StaffDraftsController } from './staff-drafts.controller.js';
import { StaffPermissionsService } from './staff-permissions.service.js';
import { StaffReadService } from './staff-read.service.js';
import { StaffRecordsService } from './staff-records.service.js';
import { StaffWriteController } from './staff-write.controller.js';
import { StaffWriteService } from './staff-write.service.js';
import { StaffController } from './staff.controller.js';

/**
 * Staff Management (R55; contract in packages/types/src/staff): the directory and one member
 * (read), Create and Edit Staff, the account actions, a member's permissions, notes, pay and
 * drafts. Invites go through R2's InvitesService (SignInModule). Security, sessions, documents
 * and the import come in the next steps.
 */
@Module({
  imports: [SignInModule],
  controllers: [StaffController, StaffWriteController, StaffDraftsController],
  providers: [
    StaffReadService,
    StaffWriteService,
    StaffActionsService,
    StaffPermissionsService,
    StaffRecordsService,
  ],
})
export class StaffModule {}
