import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  AddDeadlineDocumentRequest,
  AddDeadlineLinkRequest,
  CreateDeadlineTaskRequest,
  LinkDeadlineTaskRequest,
  BulkDeadlinesRequest,
  BulkDeadlinesResult,
  ClientCompliance,
  ClientComplianceQuery,
  CompleteComplianceDeadlineRequest,
  ComplianceAtRiskList,
  ComplianceByClientPage,
  ComplianceByClientQuery,
  ComplianceCalendarMonth,
  ComplianceCalendarMonthQuery,
  ComplianceDeadline,
  ComplianceDeadlineId,
  ComplianceDeadlinePage,
  ComplianceDeadlinesQuery,
  ComplianceOk,
  ComplianceSummary,
  CreateComplianceDeadlineRequest,
  ExtensionRequest,
  NotApplicableRequest,
  ReassignRequest,
  SaveDeadlineAsTemplateRequest,
  SaveRemindersRequest,
  UpdateComplianceDeadlineRequest,
} from './schemas.js';
import {
  ComplianceCalendar,
  ComplianceCalendarDiff,
  ComplianceCalendarEntry,
  ComplianceCalendarEntryId,
  ComplianceCalendarEntryInput,
  ComplianceCalendarId,
  ComplianceCalendarPage,
  ComplianceCalendarsQuery,
  ImportComplianceCalendarRequest,
  UpdateComplianceCalendarEntryRequest,
  UpdateComplianceCalendarRequest,
} from './library.js';
import {
  ComplianceApplicabilityRule,
  ComplianceApplicabilityRulePage,
  ComplianceApplicabilityRulesQuery,
  ComplianceLogPage,
  ComplianceLogsQuery,
  ComplianceRecurrence,
  ComplianceRecurrenceId,
  ComplianceRecurrencePage,
  ComplianceRecurrencePreview,
  ComplianceRecurrencesQuery,
  ComplianceRuleEvaluation,
  ComplianceRuleId,
  ComplianceSettings,
  ComplianceSuggestionId,
  ComplianceSuggestionPage,
  ComplianceSuggestionsQuery,
  ConfirmSuggestionRequest,
  CreateApplicabilityRuleRequest,
  CreateComplianceRecurrenceRequest,
  DismissSuggestionRequest,
  GenerateSuggestionsRequest,
  GenerateSuggestionsResult,
  PreviewRecurrenceRequest,
  UpdateApplicabilityRuleRequest,
  UpdateComplianceRecurrenceRequest,
  UpdateComplianceSettingsRequest,
} from './rules.js';

const BASE = '/business/compliance';
const deadline = (id: string) => `${BASE}/deadlines/${parseInput(ComplianceDeadlineId, id)}`;
const calendar = (id: string) => `${BASE}/calendars/${parseInput(ComplianceCalendarId, id)}`;
const recurrence = (id: string) => `${BASE}/recurrences/${parseInput(ComplianceRecurrenceId, id)}`;
const rule = (id: string) => `${BASE}/applicability-rules/${parseInput(ComplianceRuleId, id)}`;
const suggestion = (id: string) => `${BASE}/suggestions/${parseInput(ComplianceSuggestionId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });
const patch = (body: unknown) => ({ method: 'PATCH', body });

/**
 * `api.compliance`: the firm's Compliance & Deadlines. Everyone with the COMPLIANCE view reads and
 * prepares deadlines (Staff only those of clients assigned to them: 404 NOT_FOUND otherwise);
 * Owner and Admin manage the calendar library, recurring definitions, applicability rules and
 * settings, and may move a government date (403 FORBIDDEN otherwise). Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent. The deadlines CSV
 * (`GET /business/compliance/deadlines/export`, same filters as the list) is a download: open it
 * as a link, not through here.
 */
export function createComplianceClient(request: ApiRequest) {
  return {
    // Overview
    summary: async (): Promise<ComplianceSummary> =>
      request(ComplianceSummary, `${BASE}/deadlines/summary`),
    atRisk: async (): Promise<ComplianceAtRiskList> =>
      request(ComplianceAtRiskList, `${BASE}/deadlines/at-risk`),
    month: async (query: ComplianceCalendarMonthQuery = {}): Promise<ComplianceCalendarMonth> =>
      request(
        ComplianceCalendarMonth,
        `${BASE}/deadlines/calendar${toQuery(parseInput(ComplianceCalendarMonthQuery, query))}`,
      ),
    byClient: async (query: ComplianceByClientQuery = {}): Promise<ComplianceByClientPage> =>
      request(
        ComplianceByClientPage,
        `${BASE}/deadlines/by-client${toQuery(parseInput(ComplianceByClientQuery, query))}`,
      ),
    clientCompliance: async (
      clientId: string,
      query: ClientComplianceQuery = {},
    ): Promise<ClientCompliance> =>
      request(
        ClientCompliance,
        `/business/clients/${parseInput(ComplianceDeadlineId, clientId)}/compliance${toQuery(parseInput(ClientComplianceQuery, query))}`,
      ),

    // Deadlines
    deadlines: async (query: ComplianceDeadlinesQuery = {}): Promise<ComplianceDeadlinePage> =>
      request(
        ComplianceDeadlinePage,
        `${BASE}/deadlines${toQuery(parseInput(ComplianceDeadlinesQuery, query))}`,
      ),
    createDeadline: async (body: CreateComplianceDeadlineRequest): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${BASE}/deadlines`,
        post(parseInput(CreateComplianceDeadlineRequest, body)),
      ),
    getDeadline: async (id: string): Promise<ComplianceDeadline> =>
      request(ComplianceDeadline, deadline(id)),
    updateDeadline: async (
      id: string,
      body: UpdateComplianceDeadlineRequest,
    ): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        deadline(id),
        patch(parseInput(UpdateComplianceDeadlineRequest, body)),
      ),
    startDeadline: async (id: string): Promise<ComplianceDeadline> =>
      request(ComplianceDeadline, `${deadline(id)}/in-progress`, post()),
    waitOnClient: async (id: string): Promise<ComplianceDeadline> =>
      request(ComplianceDeadline, `${deadline(id)}/waiting-on-client`, post()),
    completeDeadline: async (
      id: string,
      body: CompleteComplianceDeadlineRequest = {},
    ): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${deadline(id)}/complete`,
        post(parseInput(CompleteComplianceDeadlineRequest, body)),
      ),
    reopenDeadline: async (id: string): Promise<ComplianceDeadline> =>
      request(ComplianceDeadline, `${deadline(id)}/reopen`, post()),
    notApplicable: async (id: string, body: NotApplicableRequest): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${deadline(id)}/not-applicable`,
        post(parseInput(NotApplicableRequest, body)),
      ),
    reassign: async (id: string, body: ReassignRequest): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${deadline(id)}/reassign`,
        post(parseInput(ReassignRequest, body)),
      ),
    archiveDeadline: async (id: string): Promise<ComplianceDeadline> =>
      request(ComplianceDeadline, `${deadline(id)}/archive`, post()),
    fileExtension: async (id: string, body: ExtensionRequest): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${deadline(id)}/extension`,
        post(parseInput(ExtensionRequest, body)),
      ),
    saveReminders: async (id: string, body: SaveRemindersRequest): Promise<ComplianceDeadline> =>
      request(ComplianceDeadline, `${deadline(id)}/reminders`, {
        method: 'PUT',
        body: parseInput(SaveRemindersRequest, body),
      }),
    addTask: async (
      id: string,
      body: CreateDeadlineTaskRequest = {},
    ): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${deadline(id)}/tasks`,
        post(parseInput(CreateDeadlineTaskRequest, body)),
      ),
    linkTask: async (id: string, body: LinkDeadlineTaskRequest): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${deadline(id)}/tasks/link`,
        post(parseInput(LinkDeadlineTaskRequest, body)),
      ),
    removeTask: async (id: string, taskId: string): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${deadline(id)}/tasks/${parseInput(ComplianceDeadlineId, taskId)}`,
        { method: 'DELETE' },
      ),
    addDocument: async (
      id: string,
      body: AddDeadlineDocumentRequest,
    ): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${deadline(id)}/documents`,
        post(parseInput(AddDeadlineDocumentRequest, body)),
      ),
    removeDocument: async (id: string, documentId: string): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${deadline(id)}/documents/${parseInput(ComplianceDeadlineId, documentId)}`,
        { method: 'DELETE' },
      ),
    addLink: async (id: string, body: AddDeadlineLinkRequest): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${deadline(id)}/links`,
        post(parseInput(AddDeadlineLinkRequest, body)),
      ),
    removeLink: async (id: string, relatedId: string): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${deadline(id)}/links/${parseInput(ComplianceDeadlineId, relatedId)}`,
        { method: 'DELETE' },
      ),
    saveAsTemplate: async (
      id: string,
      body: SaveDeadlineAsTemplateRequest,
    ): Promise<ComplianceRecurrence> =>
      request(
        ComplianceRecurrence,
        `${deadline(id)}/save-as-template`,
        post(parseInput(SaveDeadlineAsTemplateRequest, body)),
      ),
    bulk: async (body: BulkDeadlinesRequest): Promise<BulkDeadlinesResult> =>
      request(
        BulkDeadlinesResult,
        `${BASE}/deadlines/bulk`,
        post(parseInput(BulkDeadlinesRequest, body)),
      ),

    // Calendar library
    calendars: async (query: ComplianceCalendarsQuery = {}): Promise<ComplianceCalendarPage> =>
      request(
        ComplianceCalendarPage,
        `${BASE}/calendars${toQuery(parseInput(ComplianceCalendarsQuery, query))}`,
      ),
    importCalendar: async (body: ImportComplianceCalendarRequest): Promise<ComplianceCalendar> =>
      request(
        ComplianceCalendar,
        `${BASE}/calendars`,
        post(parseInput(ImportComplianceCalendarRequest, body)),
      ),
    previewImport: async (body: ImportComplianceCalendarRequest): Promise<ComplianceCalendarDiff> =>
      request(
        ComplianceCalendarDiff,
        `${BASE}/calendars/import-preview`,
        post(parseInput(ImportComplianceCalendarRequest, body)),
      ),
    getCalendar: async (id: string): Promise<ComplianceCalendar> =>
      request(ComplianceCalendar, calendar(id)),
    updateCalendar: async (
      id: string,
      body: UpdateComplianceCalendarRequest,
    ): Promise<ComplianceCalendar> =>
      request(
        ComplianceCalendar,
        calendar(id),
        patch(parseInput(UpdateComplianceCalendarRequest, body)),
      ),
    compareCalendars: async (id: string, otherId: string): Promise<ComplianceCalendarDiff> =>
      request(
        ComplianceCalendarDiff,
        `${calendar(id)}/compare/${parseInput(ComplianceCalendarId, otherId)}`,
      ),
    verifyCalendar: async (id: string): Promise<ComplianceCalendar> =>
      request(ComplianceCalendar, `${calendar(id)}/verify`, post()),
    publishCalendar: async (id: string): Promise<ComplianceCalendar> =>
      request(ComplianceCalendar, `${calendar(id)}/publish`, post()),
    rollbackCalendar: async (id: string): Promise<ComplianceCalendar> =>
      request(ComplianceCalendar, `${calendar(id)}/rollback`, post()),
    archiveCalendar: async (id: string): Promise<ComplianceCalendar> =>
      request(ComplianceCalendar, `${calendar(id)}/archive`, post()),
    addEntry: async (
      id: string,
      body: ComplianceCalendarEntryInput,
    ): Promise<ComplianceCalendarEntry> =>
      request(
        ComplianceCalendarEntry,
        `${calendar(id)}/entries`,
        post(parseInput(ComplianceCalendarEntryInput, body)),
      ),
    updateEntry: async (
      id: string,
      entryId: string,
      body: UpdateComplianceCalendarEntryRequest,
    ): Promise<ComplianceCalendarEntry> =>
      request(
        ComplianceCalendarEntry,
        `${calendar(id)}/entries/${parseInput(ComplianceCalendarEntryId, entryId)}`,
        patch(parseInput(UpdateComplianceCalendarEntryRequest, body)),
      ),
    deleteEntry: async (id: string, entryId: string): Promise<ComplianceOk> =>
      request(
        ComplianceOk,
        `${calendar(id)}/entries/${parseInput(ComplianceCalendarEntryId, entryId)}`,
        { method: 'DELETE' },
      ),

    // Recurring definitions
    recurrences: async (
      query: ComplianceRecurrencesQuery = {},
    ): Promise<ComplianceRecurrencePage> =>
      request(
        ComplianceRecurrencePage,
        `${BASE}/recurrences${toQuery(parseInput(ComplianceRecurrencesQuery, query))}`,
      ),
    createRecurrence: async (
      body: CreateComplianceRecurrenceRequest,
    ): Promise<ComplianceRecurrence> =>
      request(
        ComplianceRecurrence,
        `${BASE}/recurrences`,
        post(parseInput(CreateComplianceRecurrenceRequest, body)),
      ),
    previewRecurrence: async (
      body: PreviewRecurrenceRequest,
    ): Promise<ComplianceRecurrencePreview> =>
      request(
        ComplianceRecurrencePreview,
        `${BASE}/recurrences/preview`,
        post(parseInput(PreviewRecurrenceRequest, body)),
      ),
    getRecurrence: async (id: string): Promise<ComplianceRecurrence> =>
      request(ComplianceRecurrence, recurrence(id)),
    updateRecurrence: async (
      id: string,
      body: UpdateComplianceRecurrenceRequest,
    ): Promise<ComplianceRecurrence> =>
      request(
        ComplianceRecurrence,
        recurrence(id),
        patch(parseInput(UpdateComplianceRecurrenceRequest, body)),
      ),
    pauseRecurrence: async (id: string): Promise<ComplianceRecurrence> =>
      request(ComplianceRecurrence, `${recurrence(id)}/pause`, post()),
    resumeRecurrence: async (id: string): Promise<ComplianceRecurrence> =>
      request(ComplianceRecurrence, `${recurrence(id)}/resume`, post()),
    endRecurrence: async (id: string): Promise<ComplianceRecurrence> =>
      request(ComplianceRecurrence, `${recurrence(id)}/end`, post()),
    archiveRecurrence: async (id: string): Promise<ComplianceRecurrence> =>
      request(ComplianceRecurrence, `${recurrence(id)}/archive`, post()),

    // Applicability rules and suggestions
    rules: async (
      query: ComplianceApplicabilityRulesQuery = {},
    ): Promise<ComplianceApplicabilityRulePage> =>
      request(
        ComplianceApplicabilityRulePage,
        `${BASE}/applicability-rules${toQuery(parseInput(ComplianceApplicabilityRulesQuery, query))}`,
      ),
    createRule: async (
      body: CreateApplicabilityRuleRequest,
    ): Promise<ComplianceApplicabilityRule> =>
      request(
        ComplianceApplicabilityRule,
        `${BASE}/applicability-rules`,
        post(parseInput(CreateApplicabilityRuleRequest, body)),
      ),
    getRule: async (id: string): Promise<ComplianceApplicabilityRule> =>
      request(ComplianceApplicabilityRule, rule(id)),
    updateRule: async (
      id: string,
      body: UpdateApplicabilityRuleRequest,
    ): Promise<ComplianceApplicabilityRule> =>
      request(
        ComplianceApplicabilityRule,
        rule(id),
        patch(parseInput(UpdateApplicabilityRuleRequest, body)),
      ),
    evaluateRule: async (id: string): Promise<ComplianceRuleEvaluation> =>
      request(ComplianceRuleEvaluation, `${rule(id)}/evaluate`, post()),
    suggestions: async (
      query: ComplianceSuggestionsQuery = {},
    ): Promise<ComplianceSuggestionPage> =>
      request(
        ComplianceSuggestionPage,
        `${BASE}/suggestions${toQuery(parseInput(ComplianceSuggestionsQuery, query))}`,
      ),
    generateSuggestions: async (
      body: GenerateSuggestionsRequest,
    ): Promise<GenerateSuggestionsResult> =>
      request(
        GenerateSuggestionsResult,
        `${BASE}/suggestions`,
        post(parseInput(GenerateSuggestionsRequest, body)),
      ),
    confirmSuggestion: async (
      id: string,
      body: ConfirmSuggestionRequest = {},
    ): Promise<ComplianceDeadline> =>
      request(
        ComplianceDeadline,
        `${suggestion(id)}/confirm`,
        post(parseInput(ConfirmSuggestionRequest, body)),
      ),
    dismissSuggestion: async (id: string, body: DismissSuggestionRequest): Promise<ComplianceOk> =>
      request(
        ComplianceOk,
        `${suggestion(id)}/dismiss`,
        post(parseInput(DismissSuggestionRequest, body)),
      ),

    // Logs and settings
    logs: async (query: ComplianceLogsQuery = {}): Promise<ComplianceLogPage> =>
      request(ComplianceLogPage, `${BASE}/logs${toQuery(parseInput(ComplianceLogsQuery, query))}`),
    settings: async (): Promise<ComplianceSettings> =>
      request(ComplianceSettings, `${BASE}/settings`),
    updateSettings: async (body: UpdateComplianceSettingsRequest): Promise<ComplianceSettings> =>
      request(
        ComplianceSettings,
        `${BASE}/settings`,
        patch(parseInput(UpdateComplianceSettingsRequest, body)),
      ),
  };
}

export type ComplianceClient = ReturnType<typeof createComplianceClient>;
