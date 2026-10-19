import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import {
  AdminAssignAlertRequest,
  type AdminAuditEventDetail,
  AdminAuditEventId,
  type AdminAuditEventPage,
  AdminAuditEventQuery,
  type AdminAuditExport,
  AdminAuditExportRequest,
  type AdminAuditFacets,
  type AdminAuditNote,
  AdminAuditNoteId,
  AdminAuditNoteRequest,
  AdminAuditRespondRequest,
  type AdminAuditRespondResult,
  type AdminAuditSummary,
  AdminAuditSummaryQuery,
  AdminCloseAlertRequest,
  AdminResolveAlertRequest,
  type AdminSecurityAlert,
  AdminSecurityAlertId,
  type AdminSecurityAlertPage,
  AdminSecurityAlertQuery,
  type AdminSecuritySettingsRecord,
  SaveAdminSecuritySettingsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { AdminAuditActionsService } from './admin-audit-actions.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminSecurityPolicyService } from './admin-security-policy.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const eventId = pipe(AdminAuditEventId);
const alertId = pipe(AdminSecurityAlertId);
const noteId = pipe(AdminAuditNoteId);

/**
 * Super Admin Audit & Security (R55; contract in packages/types/src/admin-audit): the cross-firm
 * event log, Event Details, response actions, investigation notes, security alerts, exports and
 * the platform security policy. Super Admin only. Static paths come before ':id' ones.
 */
@Controller('admin/audit')
@Roles('SUPER_ADMIN')
export class AdminAuditController {
  constructor(
    private readonly events: AdminAuditService,
    private readonly actions: AdminAuditActionsService,
    private readonly policy: AdminSecurityPolicyService,
  ) {}

  @Get('facets')
  facets(): Promise<AdminAuditFacets> {
    return this.events.facets();
  }

  @Get('summary')
  summary(
    @Query(pipe(AdminAuditSummaryQuery)) q: Out<typeof AdminAuditSummaryQuery>,
  ): Promise<AdminAuditSummary> {
    return this.events.summary(q);
  }

  @Get('events')
  list(
    @Query(pipe(AdminAuditEventQuery)) q: Out<typeof AdminAuditEventQuery>,
  ): Promise<AdminAuditEventPage> {
    return this.events.events(q);
  }

  @Post('exports')
  @HttpCode(200)
  export(
    @Body(pipe(AdminAuditExportRequest)) body: Out<typeof AdminAuditExportRequest>,
  ): Promise<AdminAuditExport> {
    return this.events.export(body);
  }

  @Get('policy')
  settings(): Promise<AdminSecuritySettingsRecord> {
    return this.policy.get();
  }

  @Put('policy')
  saveSettings(
    @Body(pipe(SaveAdminSecuritySettingsRequest))
    body: Out<typeof SaveAdminSecuritySettingsRequest>,
  ): Promise<AdminSecuritySettingsRecord> {
    return this.policy.save(body);
  }

  @Get('alerts')
  alerts(
    @Query(pipe(AdminSecurityAlertQuery)) q: Out<typeof AdminSecurityAlertQuery>,
  ): Promise<AdminSecurityAlertPage> {
    return this.actions.alerts(q);
  }

  @Post('alerts/:id/acknowledge')
  @HttpCode(200)
  acknowledge(@Param('id', alertId) id: string): Promise<AdminSecurityAlert> {
    return this.actions.acknowledge(id);
  }

  @Post('alerts/:id/resolve')
  @HttpCode(200)
  resolve(
    @Param('id', alertId) id: string,
    @Body(pipe(AdminResolveAlertRequest)) body: Out<typeof AdminResolveAlertRequest>,
  ): Promise<AdminSecurityAlert> {
    return this.actions.resolve(id, body.note);
  }

  @Post('alerts/:id/dismiss')
  @HttpCode(200)
  dismiss(
    @Param('id', alertId) id: string,
    @Body(pipe(AdminCloseAlertRequest)) body: Out<typeof AdminCloseAlertRequest>,
  ): Promise<AdminSecurityAlert> {
    return this.actions.dismiss(id, body);
  }

  @Post('alerts/:id/assign')
  @HttpCode(200)
  assign(
    @Param('id', alertId) id: string,
    @Body(pipe(AdminAssignAlertRequest)) body: Out<typeof AdminAssignAlertRequest>,
  ): Promise<AdminSecurityAlert> {
    return this.actions.assign(id, body);
  }

  @Post('notes/:id/edit')
  editNote(
    @Param('id', noteId) id: string,
    @Body(pipe(AdminAuditNoteRequest)) body: Out<typeof AdminAuditNoteRequest>,
  ): Promise<AdminAuditNote> {
    return this.actions.editNote(id, body);
  }

  @Post('notes/:id/retract')
  @HttpCode(200)
  retractNote(@Param('id', noteId) id: string): Promise<AdminAuditNote> {
    return this.actions.retractNote(id);
  }

  @Get('events/:id')
  event(@Param('id', eventId) id: string): Promise<AdminAuditEventDetail> {
    return this.events.detail(id);
  }

  @Post('events/:id/respond')
  @HttpCode(200)
  respond(
    @Param('id', eventId) id: string,
    @Body(pipe(AdminAuditRespondRequest)) body: Out<typeof AdminAuditRespondRequest>,
  ): Promise<AdminAuditRespondResult> {
    return this.actions.respond(id, body);
  }

  @Post('events/:id/notes')
  addNote(
    @Param('id', eventId) id: string,
    @Body(pipe(AdminAuditNoteRequest)) body: Out<typeof AdminAuditNoteRequest>,
  ): Promise<AdminAuditNote> {
    return this.actions.addNote(id, body);
  }
}

@Module({
  controllers: [AdminAuditController],
  providers: [AdminPrisma, AdminAuditService, AdminAuditActionsService, AdminSecurityPolicyService],
})
export class AdminAuditModule {}
