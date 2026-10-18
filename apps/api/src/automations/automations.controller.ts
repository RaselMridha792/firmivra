import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  type AutomationCatalog,
  type AutomationLogExport,
  type AutomationOverview,
  type AutomationPreview,
  type AutomationRuleDetail,
  AutomationRuleId,
  type AutomationRulePage,
  type AutomationRunDetail,
  AutomationRunId,
  type AutomationRunPage,
  type AutomationRunsSummary,
  type AutomationSettingsView,
  type AutomationStartersResult,
  type AutomationTemplateDetail,
  AutomationTemplateId,
  type AutomationTemplatePage,
  type AutomationVersionDetail,
  type ImportAutomationTemplateRequest,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ActivateBody,
  CreateRuleBody,
  CreateTemplateBody,
  ExportBody,
  ImportBody,
  PauseBody,
  PreviewBody,
  RerunBody,
  RulesQuery,
  RunsQuery,
  SaveAsTemplateBody,
  SaveDefinitionBody,
  SettingsBody,
  TemplatesQuery,
  TestBody,
  UpdateRuleBody,
  UpdateTemplateBody,
  UseTemplateBody,
} from './automations-input.js';
import { AutomationsOverviewService } from './overview.service.js';
import { RulesService } from './rules.service.js';
import { RunsService } from './runs.service.js';
import { TemplatesService } from './templates.service.js';

type Out<S extends z.ZodType> = z.output<S>;

const rulePipe = new ZodValidationPipe(AutomationRuleId);
const templatePipe = new ZodValidationPipe(AutomationTemplateId);
const runPipe = new ZodValidationPipe(AutomationRunId);
const versionPipe = new ZodValidationPipe(z.coerce.number().int().min(1).max(1_000_000));

const who = (auth: AuthContext, tenant: TenantContext) => {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, tenant, businessId: tenant.businessId };
};

/**
 * Automations (contract in packages/types/src/automations). Everyone with the AUTOMATIONS view
 * reads; the services check Create, Edit, Approve, Export and Manage (403 FORBIDDEN). A rule acts
 * through the other modules' own services, as its owner. Never a portal route.
 */
@Controller('business/automations')
@Access('AUTOMATIONS')
@Roles(...FIRM_STAFF)
export class AutomationsController {
  constructor(
    private readonly overviewService: AutomationsOverviewService,
    private readonly rules: RulesService,
    private readonly templates: TemplatesService,
    private readonly runs: RunsService,
  ) {}

  @Get('overview')
  overview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AutomationOverview> {
    const w = who(auth, tenant);
    return this.overviewService.overview(w.businessId, w.tenant, w.userId);
  }

  @Get('catalog')
  catalog(): AutomationCatalog {
    return this.overviewService.catalog();
  }

  // ----- Rules -----

  @Get('rules')
  listRules(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(RulesQuery)) q: Out<typeof RulesQuery>,
  ): Promise<AutomationRulePage> {
    const w = who(auth, tenant);
    return this.rules.list(w.businessId, w.tenant, w.userId, q);
  }

  @Post('rules')
  createRule(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateRuleBody)) body: Out<typeof CreateRuleBody>,
  ): Promise<AutomationRuleDetail> {
    const w = who(auth, tenant);
    return this.rules.create(w.businessId, w.tenant, w.userId, body);
  }

  @Post('rules/validate')
  @HttpCode(200)
  validate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(PreviewBody)) body: Out<typeof PreviewBody>,
  ): Promise<AutomationPreview> {
    const w = who(auth, tenant);
    return this.rules.validate(w.businessId, w.tenant, w.userId, body);
  }

  @Get('rules/:id')
  getRule(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', rulePipe) id: string,
  ): Promise<AutomationRuleDetail> {
    const w = who(auth, tenant);
    return this.rules.get(w.businessId, w.tenant, w.userId, id);
  }

  @Patch('rules/:id')
  updateRule(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', rulePipe) id: string,
    @Body(new ZodValidationPipe(UpdateRuleBody)) body: Out<typeof UpdateRuleBody>,
  ): Promise<AutomationRuleDetail> {
    const w = who(auth, tenant);
    return this.rules.update(w.businessId, w.tenant, w.userId, id, body);
  }

  @Put('rules/:id/definition')
  saveDefinition(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', rulePipe) id: string,
    @Body(new ZodValidationPipe(SaveDefinitionBody)) body: Out<typeof SaveDefinitionBody>,
  ): Promise<AutomationRuleDetail> {
    const w = who(auth, tenant);
    return this.rules.saveDefinition(w.businessId, w.tenant, w.userId, id, body);
  }

  @Get('rules/:id/versions/:version')
  version(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', rulePipe) id: string,
    @Param('version', versionPipe) version: number,
  ): Promise<AutomationVersionDetail> {
    const w = who(auth, tenant);
    return this.rules.version(w.businessId, w.tenant, w.userId, id, version);
  }

  @Post('rules/:id/activate')
  @HttpCode(200)
  activate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', rulePipe) id: string,
    @Body(new ZodValidationPipe(ActivateBody)) body: Out<typeof ActivateBody>,
  ): Promise<AutomationRuleDetail> {
    const w = who(auth, tenant);
    return this.rules.activate(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('rules/:id/pause')
  @HttpCode(200)
  pause(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', rulePipe) id: string,
    @Body(new ZodValidationPipe(PauseBody)) body: Out<typeof PauseBody>,
  ): Promise<AutomationRuleDetail> {
    const w = who(auth, tenant);
    return this.rules.pause(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('rules/:id/duplicate')
  duplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', rulePipe) id: string,
  ): Promise<AutomationRuleDetail> {
    const w = who(auth, tenant);
    return this.rules.duplicate(w.businessId, w.tenant, w.userId, id);
  }

  @Post('rules/:id/archive')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', rulePipe) id: string,
  ): Promise<AutomationRuleDetail> {
    const w = who(auth, tenant);
    return this.rules.setArchived(w.businessId, w.tenant, w.userId, id, true);
  }

  @Post('rules/:id/restore')
  @HttpCode(200)
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', rulePipe) id: string,
  ): Promise<AutomationRuleDetail> {
    const w = who(auth, tenant);
    return this.rules.setArchived(w.businessId, w.tenant, w.userId, id, false);
  }

  @Post('rules/:id/test')
  @HttpCode(200)
  test(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', rulePipe) id: string,
    @Body(new ZodValidationPipe(TestBody)) body: Out<typeof TestBody>,
  ): Promise<AutomationPreview> {
    const w = who(auth, tenant);
    return this.rules.test(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('rules/:id/save-as-template')
  saveAsTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', rulePipe) id: string,
    @Body(new ZodValidationPipe(SaveAsTemplateBody)) body: Out<typeof SaveAsTemplateBody>,
  ): Promise<AutomationTemplateDetail> {
    const w = who(auth, tenant);
    return this.rules.saveAsTemplate(w.businessId, w.tenant, w.userId, id, body);
  }

  // ----- Templates -----

  @Get('templates')
  listTemplates(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TemplatesQuery)) q: Out<typeof TemplatesQuery>,
  ): Promise<AutomationTemplatePage> {
    const w = who(auth, tenant);
    return this.templates.list(w.businessId, w.tenant, w.userId, q);
  }

  @Post('templates')
  createTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateTemplateBody)) body: Out<typeof CreateTemplateBody>,
  ): Promise<AutomationTemplateDetail> {
    const w = who(auth, tenant);
    return this.templates.create(w.businessId, w.tenant, w.userId, body);
  }

  @Post('templates/import')
  importTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ImportBody)) body: Out<typeof ImportBody>,
  ): Promise<AutomationTemplateDetail> {
    const w = who(auth, tenant);
    return this.templates.import(w.businessId, w.tenant, w.userId, body);
  }

  @Post('templates/starters')
  @HttpCode(200)
  starters(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AutomationStartersResult> {
    const w = who(auth, tenant);
    return this.templates.installStarters(w.businessId, w.tenant, w.userId);
  }

  @Get('templates/:id')
  getTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', templatePipe) id: string,
  ): Promise<AutomationTemplateDetail> {
    const w = who(auth, tenant);
    return this.templates.get(w.businessId, w.tenant, w.userId, id);
  }

  @Patch('templates/:id')
  updateTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', templatePipe) id: string,
    @Body(new ZodValidationPipe(UpdateTemplateBody)) body: Out<typeof UpdateTemplateBody>,
  ): Promise<AutomationTemplateDetail> {
    const w = who(auth, tenant);
    return this.templates.update(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('templates/:id/archive')
  @HttpCode(200)
  archiveTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', templatePipe) id: string,
  ): Promise<AutomationTemplateDetail> {
    const w = who(auth, tenant);
    return this.templates.setArchived(w.businessId, w.tenant, w.userId, id, true);
  }

  @Post('templates/:id/restore')
  @HttpCode(200)
  restoreTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', templatePipe) id: string,
  ): Promise<AutomationTemplateDetail> {
    const w = who(auth, tenant);
    return this.templates.setArchived(w.businessId, w.tenant, w.userId, id, false);
  }

  @Post('templates/:id/use')
  useTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', templatePipe) id: string,
    @Body(new ZodValidationPipe(UseTemplateBody)) body: Out<typeof UseTemplateBody>,
  ): Promise<AutomationRuleDetail> {
    const w = who(auth, tenant);
    return this.rules.useTemplate(w.businessId, w.tenant, w.userId, id, body);
  }

  @Get('templates/:id/export')
  exportTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', templatePipe) id: string,
  ): Promise<ImportAutomationTemplateRequest> {
    const w = who(auth, tenant);
    return this.templates.export(
      w.businessId,
      w.tenant,
      w.userId,
      id,
    ) as Promise<ImportAutomationTemplateRequest>;
  }

  // ----- Logs -----

  @Get('runs')
  listRuns(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(RunsQuery)) q: Out<typeof RunsQuery>,
  ): Promise<AutomationRunPage> {
    const w = who(auth, tenant);
    return this.runs.list(w.businessId, w.tenant, w.userId, q);
  }

  @Get('runs/summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(RunsQuery)) q: Out<typeof RunsQuery>,
  ): Promise<AutomationRunsSummary> {
    const w = who(auth, tenant);
    return this.runs.summary(w.businessId, w.tenant, w.userId, q);
  }

  @Post('runs/export')
  @HttpCode(200)
  exportRuns(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ExportBody)) body: Out<typeof ExportBody>,
  ): Promise<AutomationLogExport> {
    const w = who(auth, tenant);
    return this.runs.export(w.businessId, w.tenant, w.userId, body);
  }

  @Get('runs/:id')
  getRun(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runPipe) id: string,
  ): Promise<AutomationRunDetail> {
    const w = who(auth, tenant);
    return this.runs.get(w.businessId, w.tenant, w.userId, id);
  }

  @Post('runs/:id/rerun')
  @HttpCode(200)
  rerun(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runPipe) id: string,
    @Body(new ZodValidationPipe(RerunBody)) body: Out<typeof RerunBody>,
  ): Promise<AutomationRunDetail> {
    const w = who(auth, tenant);
    return this.runs.rerun(w.businessId, w.tenant, w.userId, id, body);
  }

  // ----- Settings -----

  @Get('settings')
  settings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AutomationSettingsView> {
    const w = who(auth, tenant);
    return this.overviewService.settings(w.businessId, w.tenant, w.userId);
  }

  @Put('settings')
  saveSettings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SettingsBody)) body: Out<typeof SettingsBody>,
  ): Promise<AutomationSettingsView> {
    const w = who(auth, tenant);
    return this.overviewService.saveSettings(w.businessId, w.tenant, w.userId, body);
  }
}
