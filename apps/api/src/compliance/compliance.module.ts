import { Module } from '@nestjs/common';
import { ComplianceCalendarsService } from './compliance-calendars.service.js';
import { ComplianceDeadlineActionsService } from './compliance-deadline-actions.service.js';
import { ComplianceDeadlinesService } from './compliance-deadlines.service.js';
import { ComplianceLibraryController } from './compliance-library.controller.js';
import { ComplianceRecurrencesService } from './compliance-recurrences.service.js';
import { ComplianceRulesService } from './compliance-rules.service.js';
import { ComplianceSettingsService } from './compliance-settings.service.js';
import { ClientComplianceController, ComplianceController } from './compliance.controller.js';

/** The firm's Compliance & Deadlines (contract in packages/types/src/compliance). */
@Module({
  controllers: [ComplianceController, ClientComplianceController, ComplianceLibraryController],
  providers: [
    ComplianceDeadlinesService,
    ComplianceDeadlineActionsService,
    ComplianceCalendarsService,
    ComplianceRecurrencesService,
    ComplianceRulesService,
    ComplianceSettingsService,
  ],
})
export class ComplianceModule {}
