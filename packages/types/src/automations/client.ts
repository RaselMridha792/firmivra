import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  ActivateAutomationRuleRequest,
  AutomationCatalog,
  AutomationLogExport,
  AutomationOverview,
  AutomationPreview,
  AutomationRuleDetail,
  AutomationRuleId,
  AutomationRulePage,
  AutomationRunDetail,
  AutomationRunId,
  AutomationRunPage,
  AutomationRunsQuery,
  AutomationRunsSummary,
  AutomationRulesQuery,
  AutomationRuleVersionNumber,
  AutomationSettingsView,
  AutomationStartersResult,
  AutomationTemplateDetail,
  AutomationTemplateId,
  AutomationTemplatePage,
  AutomationTemplatesQuery,
  AutomationVersionDetail,
  CreateAutomationRuleRequest,
  CreateAutomationTemplateRequest,
  ExportAutomationLogsRequest,
  ImportAutomationTemplateRequest,
  PauseAutomationRuleRequest,
  PreviewAutomationRequest,
  RerunAutomationRequest,
  SaveAutomationDefinitionRequest,
  SaveAutomationSettingsRequest,
  SaveRuleAsTemplateRequest,
  TestAutomationRuleRequest,
  UpdateAutomationRuleRequest,
  UpdateAutomationTemplateRequest,
  UseAutomationTemplateRequest,
} from './schemas.js';

const BASE = '/business/automations';
const rule = (id: string) => `${BASE}/rules/${parseInput(AutomationRuleId, id)}`;
const template = (id: string) => `${BASE}/templates/${parseInput(AutomationTemplateId, id)}`;
const run = (id: string) => `${BASE}/runs/${parseInput(AutomationRunId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.automations` (apps/web/src/lib/api.ts): the Automation module (contract in ./schemas.ts).
 * Everyone with the permission grid's AUTOMATIONS view reads; creating, editing, activating,
 * testing, retrying, exporting and settings need Create, Edit or Manage (403 FORBIDDEN). What a
 * rule can start from and do comes from `catalog()`; no screen hard-codes an event or an action.
 * Saving a definition makes a new version; a run keeps the version it used. Test and validate are
 * dry runs with no side effects. Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED')
 * before anything is sent. No business id is ever sent.
 */
export function createAutomationsClient(request: ApiRequest) {
  return {
    // ----- Overview and catalog -----
    overview: async (): Promise<AutomationOverview> =>
      request(AutomationOverview, `${BASE}/overview`),
    catalog: async (): Promise<AutomationCatalog> => request(AutomationCatalog, `${BASE}/catalog`),

    // ----- Rules -----
    rules: async (query: AutomationRulesQuery = {}): Promise<AutomationRulePage> =>
      request(
        AutomationRulePage,
        `${BASE}/rules${toQuery(parseInput(AutomationRulesQuery, query))}`,
      ),
    /** 409 DUPLICATE_NAME; with `activate`, 409 NOT_READY. */
    createRule: async (body: CreateAutomationRuleRequest): Promise<AutomationRuleDetail> =>
      request(
        AutomationRuleDetail,
        `${BASE}/rules`,
        post(parseInput(CreateAutomationRuleRequest, body)),
      ),
    rule: async (id: string): Promise<AutomationRuleDetail> =>
      request(AutomationRuleDetail, rule(id)),
    updateRule: async (
      id: string,
      body: UpdateAutomationRuleRequest,
    ): Promise<AutomationRuleDetail> =>
      request(AutomationRuleDetail, rule(id), {
        method: 'PATCH',
        body: parseInput(UpdateAutomationRuleRequest, body),
      }),
    /** Saves a new version. 409 SAVE_CONFLICT, NOT_READY (an active rule). */
    saveDefinition: async (
      id: string,
      body: SaveAutomationDefinitionRequest,
    ): Promise<AutomationRuleDetail> =>
      request(AutomationRuleDetail, `${rule(id)}/definition`, {
        method: 'PUT',
        body: parseInput(SaveAutomationDefinitionRequest, body),
      }),
    version: async (id: string, version: number): Promise<AutomationVersionDetail> =>
      request(
        AutomationVersionDetail,
        `${rule(id)}/versions/${parseInput(AutomationRuleVersionNumber, version)}`,
      ),
    /** 409 NOT_READY with the checks that block. */
    activate: async (
      id: string,
      body: ActivateAutomationRuleRequest = {},
    ): Promise<AutomationRuleDetail> =>
      request(
        AutomationRuleDetail,
        `${rule(id)}/activate`,
        post(parseInput(ActivateAutomationRuleRequest, body)),
      ),
    pause: async (
      id: string,
      body: PauseAutomationRuleRequest = {},
    ): Promise<AutomationRuleDetail> =>
      request(
        AutomationRuleDetail,
        `${rule(id)}/pause`,
        post(parseInput(PauseAutomationRuleRequest, body)),
      ),
    /** A draft copy with no history. */
    duplicateRule: async (id: string): Promise<AutomationRuleDetail> =>
      request(AutomationRuleDetail, `${rule(id)}/duplicate`, post()),
    archiveRule: async (id: string): Promise<AutomationRuleDetail> =>
      request(AutomationRuleDetail, `${rule(id)}/archive`, post()),
    restoreRule: async (id: string): Promise<AutomationRuleDetail> =>
      request(AutomationRuleDetail, `${rule(id)}/restore`, post()),
    /** The Review step on an unsaved definition: a dry run with the checks. */
    validate: async (body: PreviewAutomationRequest): Promise<AutomationPreview> =>
      request(
        AutomationPreview,
        `${BASE}/rules/validate`,
        post(parseInput(PreviewAutomationRequest, body)),
      ),
    /** Test / Preview a saved rule: a dry run with no side effects. */
    testRule: async (
      id: string,
      body: TestAutomationRuleRequest = {},
    ): Promise<AutomationPreview> =>
      request(
        AutomationPreview,
        `${rule(id)}/test`,
        post(parseInput(TestAutomationRuleRequest, body)),
      ),
    saveRuleAsTemplate: async (
      id: string,
      body: SaveRuleAsTemplateRequest,
    ): Promise<AutomationTemplateDetail> =>
      request(
        AutomationTemplateDetail,
        `${rule(id)}/save-as-template`,
        post(parseInput(SaveRuleAsTemplateRequest, body)),
      ),

    // ----- Templates -----
    templates: async (query: AutomationTemplatesQuery = {}): Promise<AutomationTemplatePage> =>
      request(
        AutomationTemplatePage,
        `${BASE}/templates${toQuery(parseInput(AutomationTemplatesQuery, query))}`,
      ),
    createTemplate: async (
      body: CreateAutomationTemplateRequest,
    ): Promise<AutomationTemplateDetail> =>
      request(
        AutomationTemplateDetail,
        `${BASE}/templates`,
        post(parseInput(CreateAutomationTemplateRequest, body)),
      ),
    template: async (id: string): Promise<AutomationTemplateDetail> =>
      request(AutomationTemplateDetail, template(id)),
    updateTemplate: async (
      id: string,
      body: UpdateAutomationTemplateRequest,
    ): Promise<AutomationTemplateDetail> =>
      request(AutomationTemplateDetail, template(id), {
        method: 'PATCH',
        body: parseInput(UpdateAutomationTemplateRequest, body),
      }),
    archiveTemplate: async (id: string): Promise<AutomationTemplateDetail> =>
      request(AutomationTemplateDetail, `${template(id)}/archive`, post()),
    restoreTemplate: async (id: string): Promise<AutomationTemplateDetail> =>
      request(AutomationTemplateDetail, `${template(id)}/restore`, post()),
    /** Makes a DRAFT rule for review. 409 TEMPLATE_UNAVAILABLE. */
    useTemplate: async (
      id: string,
      body: UseAutomationTemplateRequest = {},
    ): Promise<AutomationRuleDetail> =>
      request(
        AutomationRuleDetail,
        `${template(id)}/use`,
        post(parseInput(UseAutomationTemplateRequest, body)),
      ),
    importTemplate: async (
      body: ImportAutomationTemplateRequest,
    ): Promise<AutomationTemplateDetail> =>
      request(
        AutomationTemplateDetail,
        `${BASE}/templates/import`,
        post(parseInput(ImportAutomationTemplateRequest, body)),
      ),
    exportTemplate: async (id: string): Promise<ImportAutomationTemplateRequest> =>
      request(ImportAutomationTemplateRequest, `${template(id)}/export`),
    /** The popular starter templates; safe to repeat. */
    installStarters: async (): Promise<AutomationStartersResult> =>
      request(AutomationStartersResult, `${BASE}/templates/starters`, post()),

    // ----- Logs -----
    runs: async (query: AutomationRunsQuery = {}): Promise<AutomationRunPage> =>
      request(AutomationRunPage, `${BASE}/runs${toQuery(parseInput(AutomationRunsQuery, query))}`),
    runsSummary: async (
      query: Omit<AutomationRunsQuery, 'page' | 'pageSize' | 'tab'> = {},
    ): Promise<AutomationRunsSummary> =>
      request(
        AutomationRunsSummary,
        `${BASE}/runs/summary${toQuery(parseInput(AutomationRunsQuery, query))}`,
      ),
    runDetail: async (id: string): Promise<AutomationRunDetail> =>
      request(AutomationRunDetail, run(id)),
    /** Retries the failed, retryable actions only. 409 RERUN_NOT_ALLOWED, INTEGRATION_INACTIVE. */
    rerun: async (id: string, body: RerunAutomationRequest): Promise<AutomationRunDetail> =>
      request(
        AutomationRunDetail,
        `${run(id)}/rerun`,
        post(parseInput(RerunAutomationRequest, body)),
      ),
    /** 403 FORBIDDEN without the Export capability; 409 TOO_MANY_ROWS. */
    exportLogs: async (body: ExportAutomationLogsRequest): Promise<AutomationLogExport> =>
      request(
        AutomationLogExport,
        `${BASE}/runs/export`,
        post(parseInput(ExportAutomationLogsRequest, body)),
      ),

    // ----- Settings -----
    settings: async (): Promise<AutomationSettingsView> =>
      request(AutomationSettingsView, `${BASE}/settings`),
    saveSettings: async (body: SaveAutomationSettingsRequest): Promise<AutomationSettingsView> =>
      request(AutomationSettingsView, `${BASE}/settings`, {
        method: 'PUT',
        body: parseInput(SaveAutomationSettingsRequest, body),
      }),
  };
}
export type AutomationsClient = ReturnType<typeof createAutomationsClient>;
