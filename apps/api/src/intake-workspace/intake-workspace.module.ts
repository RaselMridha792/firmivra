import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { ReportsModule } from '../reports/reports.module.js';
import { IntakeBuilderService } from './intake-builder.service.js';
import { IntakeLibraryService } from './intake-library.service.js';
import { IntakeRecordService } from './intake-record.service.js';
import { IntakeSendService } from './intake-send.service.js';
import { IntakeSettingsService } from './intake-settings.service.js';
import { IntakeFormsController, IntakeSettingsController } from './intake-workspace.controller.js';
import { IntakeWorkspaceService } from './intake-workspace.service.js';

/**
 * The Intake Forms workspace (R55; contract in packages/types/src/intake/workspace.ts): the
 * forms sent (summary, table, send, drafts, one form's record and its More menu, the PDF), the
 * form library and builder, and the firm's settings. The assigned-form routes
 * (`/business/intakes`) live in IntakesController, static ones before its ':id' route, and use
 * this module's services. Export PDFs go under the firm's reports prefix (ReportsModule's store).
 */
@Module({
  imports: [NotificationsModule, ReportsModule],
  controllers: [IntakeFormsController, IntakeSettingsController],
  providers: [
    IntakeWorkspaceService,
    IntakeLibraryService,
    IntakeSettingsService,
    IntakeBuilderService,
    IntakeSendService,
    IntakeRecordService,
  ],
  exports: [IntakeWorkspaceService, IntakeSendService, IntakeRecordService],
})
export class IntakeWorkspaceModule {}
