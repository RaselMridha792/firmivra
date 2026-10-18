import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type ComplianceApplicabilityRule,
  type ComplianceApplicabilityRulePage,
  ComplianceApplicabilityRulesQuery,
  type ComplianceCalendar,
  type ComplianceCalendarDiff,
  type ComplianceCalendarEntry,
  ComplianceCalendarEntryId,
  ComplianceCalendarEntryInput,
  ComplianceCalendarId,
  type ComplianceCalendarPage,
  ComplianceCalendarsQuery,
  type ComplianceDeadline,
  type ComplianceLogPage,
  ComplianceLogsQuery,
  type ComplianceOk,
  type ComplianceRecurrence,
  ComplianceRecurrenceId,
  type ComplianceRecurrencePage,
  type ComplianceRecurrencePreview,
  ComplianceRecurrencesQuery,
  type ComplianceRuleEvaluation,
  ComplianceRuleId,
  type ComplianceSettings,
  ComplianceSuggestionId,
  type ComplianceSuggestionPage,
  ComplianceSuggestionsQuery,
  ConfirmSuggestionRequest,
  CreateApplicabilityRuleRequest,
  CreateComplianceRecurrenceRequest,
  DismissSuggestionRequest,
  GenerateSuggestionsRequest,
  type GenerateSuggestionsResult,
  ImportComplianceCalendarRequest,
  PreviewRecurrenceRequest,
  UpdateApplicabilityRuleRequest,
  UpdateComplianceCalendarEntryRequest,
  UpdateComplianceCalendarRequest,
  UpdateComplianceRecurrenceRequest,
  UpdateComplianceSettingsRequest,
} from '@firmivra/types';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { actorOf } from '../workspaces/common.js';
import { ComplianceCalendarsService } from './compliance-calendars.service.js';
import { ComplianceRecurrencesService } from './compliance-recurrences.service.js';
import { ComplianceRulesService } from './compliance-rules.service.js';
import { ComplianceSettingsService } from './compliance-settings.service.js';

const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const calendarId = pipe(ComplianceCalendarId);
const entryId = pipe(ComplianceCalendarEntryId);
const recurrenceId = pipe(ComplianceRecurrenceId);
const ruleId = pipe(ComplianceRuleId);
const suggestionId = pipe(ComplianceSuggestionId);

/**
 * The Calendar Library, recurring definitions, applicability rules, suggestions, logs and
 * settings of Compliance & Deadlines (contract in packages/types/src/compliance). Staff read (and
 * work the suggestions queue for the clients they reach); Owner and Admin change the library,
 * the definitions, the rules and the settings. Fixed paths come before `:id` ones.
 */
@Controller('business/compliance')
@Access('COMPLIANCE')
@Roles(...FIRM_STAFF)
export class ComplianceLibraryController {
  constructor(
    private readonly calendars: ComplianceCalendarsService,
    private readonly recurrences: ComplianceRecurrencesService,
    private readonly rules: ComplianceRulesService,
    private readonly settings: ComplianceSettingsService,
  ) {}

  // ---------- Calendar library ----------

  @Get('calendars')
  listCalendars(
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(ComplianceCalendarsQuery)) q: z.output<typeof ComplianceCalendarsQuery>,
  ): Promise<ComplianceCalendarPage> {
    return this.calendars.list(tenant.businessId, q);
  }

  @Post('calendars')
  @Roles(...FIRM_MANAGERS)
  importCalendar(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(ImportComplianceCalendarRequest))
    body: z.output<typeof ImportComplianceCalendarRequest>,
  ): Promise<ComplianceCalendar> {
    return this.calendars.importCalendar(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Post('calendars/import-preview')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  @Access('COMPLIANCE', 'VIEW')
  previewImport(
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(ImportComplianceCalendarRequest))
    body: z.output<typeof ImportComplianceCalendarRequest>,
  ): Promise<ComplianceCalendarDiff> {
    return this.calendars.previewImport(tenant.businessId, body);
  }

  @Get('calendars/:id')
  getCalendar(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', calendarId) id: string,
  ): Promise<ComplianceCalendar> {
    return this.calendars.get(tenant.businessId, id);
  }

  @Patch('calendars/:id')
  @Roles(...FIRM_MANAGERS)
  updateCalendar(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', calendarId) id: string,
    @Body(pipe(UpdateComplianceCalendarRequest))
    body: z.output<typeof UpdateComplianceCalendarRequest>,
  ): Promise<ComplianceCalendar> {
    return this.calendars.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get('calendars/:id/compare/:otherId')
  @Roles(...FIRM_MANAGERS)
  compare(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', calendarId) id: string,
    @Param('otherId', calendarId) otherId: string,
  ): Promise<ComplianceCalendarDiff> {
    return this.calendars.compare(tenant.businessId, id, otherId);
  }

  @Post('calendars/:id/verify')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  verify(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', calendarId) id: string,
  ): Promise<ComplianceCalendar> {
    return this.calendars.verify(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('calendars/:id/publish')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  @Access('COMPLIANCE', 'APPROVE')
  publish(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', calendarId) id: string,
  ): Promise<ComplianceCalendar> {
    return this.calendars.publish(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('calendars/:id/rollback')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  @Access('COMPLIANCE', 'APPROVE')
  rollback(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', calendarId) id: string,
  ): Promise<ComplianceCalendar> {
    return this.calendars.rollback(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('calendars/:id/archive')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  archiveCalendar(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', calendarId) id: string,
  ): Promise<ComplianceCalendar> {
    return this.calendars.archive(tenant.businessId, id);
  }

  @Post('calendars/:id/entries')
  @Roles(...FIRM_MANAGERS)
  addEntry(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', calendarId) id: string,
    @Body(pipe(ComplianceCalendarEntryInput)) body: z.output<typeof ComplianceCalendarEntryInput>,
  ): Promise<ComplianceCalendarEntry> {
    return this.calendars.addEntry(tenant.businessId, id, body);
  }

  @Patch('calendars/:id/entries/:entryId')
  @Roles(...FIRM_MANAGERS)
  updateEntry(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', calendarId) id: string,
    @Param('entryId', entryId) entry: string,
    @Body(pipe(UpdateComplianceCalendarEntryRequest))
    body: z.output<typeof UpdateComplianceCalendarEntryRequest>,
  ): Promise<ComplianceCalendarEntry> {
    return this.calendars.updateEntry(tenant.businessId, id, entry, body);
  }

  @Delete('calendars/:id/entries/:entryId')
  @Roles(...FIRM_MANAGERS)
  deleteEntry(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', calendarId) id: string,
    @Param('entryId', entryId) entry: string,
  ): Promise<ComplianceOk> {
    return this.calendars.deleteEntry(tenant.businessId, id, entry);
  }

  // ---------- Recurring definitions ----------

  @Get('recurrences')
  listRecurrences(
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(ComplianceRecurrencesQuery)) q: z.output<typeof ComplianceRecurrencesQuery>,
  ): Promise<ComplianceRecurrencePage> {
    return this.recurrences.list(tenant.businessId, q);
  }

  @Post('recurrences')
  @Roles(...FIRM_MANAGERS)
  createRecurrence(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(CreateComplianceRecurrenceRequest))
    body: z.output<typeof CreateComplianceRecurrenceRequest>,
  ): Promise<ComplianceRecurrence> {
    return this.recurrences.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Post('recurrences/preview')
  @HttpCode(200)
  @Access('COMPLIANCE', 'VIEW')
  previewRecurrence(
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(PreviewRecurrenceRequest)) body: z.output<typeof PreviewRecurrenceRequest>,
  ): Promise<ComplianceRecurrencePreview> {
    return this.recurrences.preview(tenant.businessId, body);
  }

  @Get('recurrences/:id')
  getRecurrence(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', recurrenceId) id: string,
  ): Promise<ComplianceRecurrence> {
    return this.recurrences.get(tenant.businessId, id);
  }

  @Patch('recurrences/:id')
  @Roles(...FIRM_MANAGERS)
  updateRecurrence(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', recurrenceId) id: string,
    @Body(pipe(UpdateComplianceRecurrenceRequest))
    body: z.output<typeof UpdateComplianceRecurrenceRequest>,
  ): Promise<ComplianceRecurrence> {
    return this.recurrences.update(tenant.businessId, id, body);
  }

  @Post('recurrences/:id/pause')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  pauseRecurrence(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', recurrenceId) id: string,
  ): Promise<ComplianceRecurrence> {
    return this.recurrences.pause(tenant.businessId, id);
  }

  @Post('recurrences/:id/resume')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  resumeRecurrence(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', recurrenceId) id: string,
  ): Promise<ComplianceRecurrence> {
    return this.recurrences.resume(tenant.businessId, id);
  }

  @Post('recurrences/:id/end')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  endRecurrence(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', recurrenceId) id: string,
  ): Promise<ComplianceRecurrence> {
    return this.recurrences.end(tenant.businessId, id);
  }

  @Post('recurrences/:id/archive')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  archiveRecurrence(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', recurrenceId) id: string,
  ): Promise<ComplianceRecurrence> {
    return this.recurrences.archive(tenant.businessId, id);
  }

  // ---------- Applicability rules ----------

  @Get('applicability-rules')
  listRules(
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(ComplianceApplicabilityRulesQuery))
    q: z.output<typeof ComplianceApplicabilityRulesQuery>,
  ): Promise<ComplianceApplicabilityRulePage> {
    return this.rules.list(tenant.businessId, q);
  }

  @Post('applicability-rules')
  @Roles(...FIRM_MANAGERS)
  createRule(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(CreateApplicabilityRuleRequest))
    body: z.output<typeof CreateApplicabilityRuleRequest>,
  ): Promise<ComplianceApplicabilityRule> {
    return this.rules.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Get('applicability-rules/:id')
  getRule(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ruleId) id: string,
  ): Promise<ComplianceApplicabilityRule> {
    return this.rules.get(tenant.businessId, id);
  }

  @Patch('applicability-rules/:id')
  @Roles(...FIRM_MANAGERS)
  updateRule(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ruleId) id: string,
    @Body(pipe(UpdateApplicabilityRuleRequest))
    body: z.output<typeof UpdateApplicabilityRuleRequest>,
  ): Promise<ComplianceApplicabilityRule> {
    return this.rules.update(tenant.businessId, id, body);
  }

  @Post('applicability-rules/:id/evaluate')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  @Access('COMPLIANCE', 'VIEW')
  evaluate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ruleId) id: string,
  ): Promise<ComplianceRuleEvaluation> {
    return this.rules.evaluate(tenant.businessId, actorOf(auth, tenant), id);
  }

  // ---------- Suggestions ----------

  @Get('suggestions')
  suggestions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(ComplianceSuggestionsQuery)) q: z.output<typeof ComplianceSuggestionsQuery>,
  ): Promise<ComplianceSuggestionPage> {
    return this.rules.suggestions(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Post('suggestions')
  @HttpCode(200)
  generate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(GenerateSuggestionsRequest)) body: z.output<typeof GenerateSuggestionsRequest>,
  ): Promise<GenerateSuggestionsResult> {
    return this.rules.generate(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Post('suggestions/:id/confirm')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  confirm(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', suggestionId) id: string,
    @Body(pipe(ConfirmSuggestionRequest.default({})))
    body: z.output<typeof ConfirmSuggestionRequest>,
  ): Promise<ComplianceDeadline> {
    return this.rules.confirm(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('suggestions/:id/dismiss')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  dismiss(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', suggestionId) id: string,
    @Body(pipe(DismissSuggestionRequest)) body: z.output<typeof DismissSuggestionRequest>,
  ): Promise<ComplianceOk> {
    return this.rules.dismiss(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  // ---------- Logs and settings ----------

  @Get('logs')
  logs(
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(ComplianceLogsQuery)) q: z.output<typeof ComplianceLogsQuery>,
  ): Promise<ComplianceLogPage> {
    return this.settings.logs(tenant.businessId, q);
  }

  @Get('settings')
  getSettings(@CurrentTenant() tenant: TenantContext): Promise<ComplianceSettings> {
    return this.settings.settings(tenant.businessId);
  }

  @Patch('settings')
  @Roles(...FIRM_MANAGERS)
  updateSettings(
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(UpdateComplianceSettingsRequest))
    body: z.output<typeof UpdateComplianceSettingsRequest>,
  ): Promise<ComplianceSettings> {
    return this.settings.update(tenant.businessId, body);
  }
}
