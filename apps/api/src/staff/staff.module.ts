import { Module } from '@nestjs/common';
import { StaffReadService } from './staff-read.service.js';
import { StaffController } from './staff.controller.js';

/**
 * The Staff Management directory (R55; contract in packages/types/src/staff): the list, summary,
 * form options, one member's details and the import template. Writes (invite, change, security,
 * permissions, documents, drafts and the import itself) come in the next steps.
 */
@Module({
  controllers: [StaffController],
  providers: [StaffReadService],
})
export class StaffModule {}
