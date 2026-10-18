import { Module } from '@nestjs/common';
import { SignInModule } from '../auth/sign-in.controller.js';
import { StaffActionsService } from './staff-actions.service.js';
import { StaffDraftsController } from './staff-drafts.controller.js';
import { StaffPermissionsService } from './staff-permissions.service.js';
import { StaffReadService } from './staff-read.service.js';
import { StaffRecordsService } from './staff-records.service.js';
import { StaffSecurityController } from './staff-security.controller.js';
import { StaffSecurityService } from './staff-security.service.js';
import { StaffWriteController } from './staff-write.controller.js';
import { StaffWriteService } from './staff-write.service.js';
import { StaffController } from './staff.controller.js';

/**
 * Staff Management (R55; contract in packages/types/src/staff): the directory and one member
 * (read), Create and Edit Staff, the account actions, a member's permissions, notes, pay and
 * drafts, and Account Access & Security. Invites and resets go through R2's InvitesService and
 * identity adapter (SignInModule). Documents and the import come in the next step.
 */
@Module({
  imports: [SignInModule],
  controllers: [
    StaffController,
    StaffWriteController,
    StaffSecurityController,
    StaffDraftsController,
  ],
  providers: [
    StaffReadService,
    StaffWriteService,
    StaffActionsService,
    StaffPermissionsService,
    StaffRecordsService,
    StaffSecurityService,
  ],
})
export class StaffModule {}
