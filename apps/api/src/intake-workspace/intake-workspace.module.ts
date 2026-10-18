import { Module } from '@nestjs/common';
import { IntakeLibraryService } from './intake-library.service.js';
import { IntakeSettingsService } from './intake-settings.service.js';
import { IntakeFormsController, IntakeSettingsController } from './intake-workspace.controller.js';
import { IntakeWorkspaceService } from './intake-workspace.service.js';

/**
 * The Intake Forms workspace (R55; contract in packages/types/src/intake/workspace.ts): the
 * forms sent (summary, table), the form library, and the firm's settings. The assigned-form routes
 * (`/business/intakes`) live in IntakesController, before its ':id' route, and use this module's
 * service.
 */
@Module({
  controllers: [IntakeFormsController, IntakeSettingsController],
  providers: [IntakeWorkspaceService, IntakeLibraryService, IntakeSettingsService],
  exports: [IntakeWorkspaceService],
})
export class IntakeWorkspaceModule {}
