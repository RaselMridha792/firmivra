import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  BulkDeadlinesRequest,
  type BulkDeadlinesResult,
  type ClientCompliance,
  ClientComplianceQuery,
  CompleteComplianceDeadlineRequest,
  type ComplianceAtRiskList,
  type ComplianceByClientPage,
  ComplianceByClientQuery,
  type ComplianceCalendarMonth,
  ComplianceCalendarMonthQuery,
  type ComplianceDeadline,
  ComplianceDeadlineId,
  type ComplianceDeadlinePage,
  ComplianceDeadlinesQuery,
  type ComplianceRecurrence,
  type ComplianceSummary,
  CreateComplianceDeadlineRequest,
  CreateDeadlineTaskRequest,
  ExtensionRequest,
  AddDeadlineDocumentRequest,
  AddDeadlineLinkRequest,
  LinkDeadlineTaskRequest,
  NotApplicableRequest,
  ReassignRequest,
  SaveDeadlineAsTemplateRequest,
  SaveRemindersRequest,
  UpdateComplianceDeadlineRequest,
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
import { ComplianceDeadlineActionsService } from './compliance-deadline-actions.service.js';
import { ComplianceDeadlinesService } from './compliance-deadlines.service.js';
import { ComplianceRecurrencesService } from './compliance-recurrences.service.js';

const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const id = pipe(ComplianceDeadlineId);
const uuid = pipe(ComplianceDeadlineId);

/**
 * The firm's deadlines (contract in packages/types/src/compliance). Everyone with the permission
 * grid's COMPLIANCE view reads and prepares; Staff reach only the deadlines of clients assigned
 * to them (404 otherwise). The firm comes from TenantGuard, never from the request. Fixed paths
 * come before `:id` ones.
 */
@Controller('business/compliance/deadlines')
@Access('COMPLIANCE')
@Roles(...FIRM_STAFF)
export class ComplianceController {
  constructor(
    private readonly reads: ComplianceDeadlinesService,
    private readonly actions: ComplianceDeadlineActionsService,
    private readonly recurrences: ComplianceRecurrencesService,
  ) {}

  // ---------- Overview and lists ----------

  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<ComplianceSummary> {
    return this.reads.summary(tenant.businessId, actorOf(auth, tenant));
  }

  @Get('at-risk')
  atRisk(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<ComplianceAtRiskList> {
    return this.reads.atRisk(tenant.businessId, actorOf(auth, tenant));
  }

  @Get('by-client')
  byClient(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(ComplianceByClientQuery)) q: z.output<typeof ComplianceByClientQuery>,
  ): Promise<ComplianceByClientPage> {
    return this.reads.byClient(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Get('calendar')
  month(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(ComplianceCalendarMonthQuery)) q: z.output<typeof ComplianceCalendarMonthQuery>,
  ): Promise<ComplianceCalendarMonth> {
    return this.reads.month(tenant.businessId, actorOf(auth, tenant), q);
  }

  /** The list's filters as a CSV (needs the grid's EXPORT). */
  @Get('export')
  @Access('COMPLIANCE', 'EXPORT')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="compliance-deadlines.csv"')
  async exportCsv(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(ComplianceDeadlinesQuery)) q: z.output<typeof ComplianceDeadlinesQuery>,
  ): Promise<StreamableFile> {
    const text = await this.reads.exportCsv(tenant.businessId, actorOf(auth, tenant), q);
    return new StreamableFile(Buffer.from(text, 'utf8'), { type: 'text/csv; charset=utf-8' });
  }

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(ComplianceDeadlinesQuery)) q: z.output<typeof ComplianceDeadlinesQuery>,
  ): Promise<ComplianceDeadlinePage> {
    return this.reads.list(tenant.businessId, actorOf(auth, tenant), q);
  }

  // ---------- Create, bulk ----------

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(CreateComplianceDeadlineRequest))
    body: z.output<typeof CreateComplianceDeadlineRequest>,
  ): Promise<ComplianceDeadline> {
    return this.actions.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Post('bulk')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  bulk(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(BulkDeadlinesRequest)) body: z.output<typeof BulkDeadlinesRequest>,
  ): Promise<BulkDeadlinesResult> {
    return this.actions.bulk(tenant.businessId, actorOf(auth, tenant), body);
  }

  // ---------- One deadline ----------

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
  ): Promise<ComplianceDeadline> {
    return this.reads.get(tenant.businessId, actorOf(auth, tenant), deadlineId);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Body(pipe(UpdateComplianceDeadlineRequest))
    body: z.output<typeof UpdateComplianceDeadlineRequest>,
  ): Promise<ComplianceDeadline> {
    return this.actions.update(tenant.businessId, actorOf(auth, tenant), deadlineId, body);
  }

  @Post(':id/in-progress')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  start(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
  ): Promise<ComplianceDeadline> {
    return this.actions.start(tenant.businessId, actorOf(auth, tenant), deadlineId);
  }

  @Post(':id/waiting-on-client')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  waitOnClient(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
  ): Promise<ComplianceDeadline> {
    return this.actions.waitOnClient(tenant.businessId, actorOf(auth, tenant), deadlineId);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  complete(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Body(pipe(CompleteComplianceDeadlineRequest.default({})))
    body: z.output<typeof CompleteComplianceDeadlineRequest>,
  ): Promise<ComplianceDeadline> {
    return this.actions.complete(tenant.businessId, actorOf(auth, tenant), deadlineId, body);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  reopen(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
  ): Promise<ComplianceDeadline> {
    return this.actions.reopen(tenant.businessId, actorOf(auth, tenant), deadlineId);
  }

  @Post(':id/not-applicable')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  notApplicable(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Body(pipe(NotApplicableRequest)) body: z.output<typeof NotApplicableRequest>,
  ): Promise<ComplianceDeadline> {
    return this.actions.notApplicable(tenant.businessId, actorOf(auth, tenant), deadlineId, body);
  }

  @Post(':id/reassign')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  reassign(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Body(pipe(ReassignRequest)) body: z.output<typeof ReassignRequest>,
  ): Promise<ComplianceDeadline> {
    return this.actions.reassign(tenant.businessId, actorOf(auth, tenant), deadlineId, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
  ): Promise<ComplianceDeadline> {
    return this.actions.archive(tenant.businessId, actorOf(auth, tenant), deadlineId);
  }

  @Post(':id/extension')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  extension(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Body(pipe(ExtensionRequest)) body: z.output<typeof ExtensionRequest>,
  ): Promise<ComplianceDeadline> {
    return this.actions.fileExtension(tenant.businessId, actorOf(auth, tenant), deadlineId, body);
  }

  @Put(':id/reminders')
  saveReminders(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Body(pipe(SaveRemindersRequest)) body: z.output<typeof SaveRemindersRequest>,
  ): Promise<ComplianceDeadline> {
    return this.actions.saveReminders(tenant.businessId, actorOf(auth, tenant), deadlineId, body);
  }

  // ---------- Tasks, documents, related deadlines ----------

  @Post(':id/tasks')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  addTask(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Body(pipe(CreateDeadlineTaskRequest.default({})))
    body: z.output<typeof CreateDeadlineTaskRequest>,
  ): Promise<ComplianceDeadline> {
    return this.actions.addTask(tenant.businessId, actorOf(auth, tenant), deadlineId, body);
  }

  @Post(':id/tasks/link')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  linkTask(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Body(pipe(LinkDeadlineTaskRequest)) body: z.output<typeof LinkDeadlineTaskRequest>,
  ): Promise<ComplianceDeadline> {
    return this.actions.linkTask(tenant.businessId, actorOf(auth, tenant), deadlineId, body);
  }

  @Delete(':id/tasks/:taskId')
  @Access('COMPLIANCE', 'EDIT')
  removeTask(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Param('taskId', uuid) taskId: string,
  ): Promise<ComplianceDeadline> {
    return this.actions.removeTask(tenant.businessId, actorOf(auth, tenant), deadlineId, taskId);
  }

  @Post(':id/documents')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  addDocument(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Body(pipe(AddDeadlineDocumentRequest)) body: z.output<typeof AddDeadlineDocumentRequest>,
  ): Promise<ComplianceDeadline> {
    return this.actions.addDocument(tenant.businessId, actorOf(auth, tenant), deadlineId, body);
  }

  @Delete(':id/documents/:documentId')
  @Access('COMPLIANCE', 'EDIT')
  removeDocument(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Param('documentId', uuid) documentId: string,
  ): Promise<ComplianceDeadline> {
    return this.actions.removeDocument(
      tenant.businessId,
      actorOf(auth, tenant),
      deadlineId,
      documentId,
    );
  }

  @Post(':id/links')
  @HttpCode(200)
  @Access('COMPLIANCE', 'EDIT')
  addLink(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Body(pipe(AddDeadlineLinkRequest)) body: z.output<typeof AddDeadlineLinkRequest>,
  ): Promise<ComplianceDeadline> {
    return this.actions.addLink(tenant.businessId, actorOf(auth, tenant), deadlineId, body);
  }

  @Delete(':id/links/:relatedId')
  @Access('COMPLIANCE', 'EDIT')
  removeLink(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Param('relatedId', uuid) relatedId: string,
  ): Promise<ComplianceDeadline> {
    return this.actions.removeLink(tenant.businessId, actorOf(auth, tenant), deadlineId, relatedId);
  }

  /** Save as Template (Frame 2): Owner and Admin, since a template is a firm-wide definition. */
  @Post(':id/save-as-template')
  @Roles(...FIRM_MANAGERS)
  saveAsTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', id) deadlineId: string,
    @Body(pipe(SaveDeadlineAsTemplateRequest))
    body: z.output<typeof SaveDeadlineAsTemplateRequest>,
  ): Promise<ComplianceRecurrence> {
    return this.recurrences.saveDeadlineAsTemplate(
      tenant.businessId,
      actorOf(auth, tenant),
      deadlineId,
      body,
    );
  }
}

/** A client's compliance view (the client record's Compliance tab). */
@Controller('business/clients')
@Access('COMPLIANCE')
@Roles(...FIRM_STAFF)
export class ClientComplianceController {
  constructor(private readonly reads: ComplianceDeadlinesService) {}

  @Get(':id/compliance')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', pipe(ComplianceDeadlineId)) clientId: string,
    @Query(pipe(ClientComplianceQuery)) q: z.output<typeof ClientComplianceQuery>,
  ): Promise<ClientCompliance> {
    return this.reads.clientView(tenant.businessId, actorOf(auth, tenant), clientId, q);
  }
}
