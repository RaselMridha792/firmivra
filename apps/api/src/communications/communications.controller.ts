import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type AnnouncementLocationList,
  type AudienceCandidatePage,
  type AudienceSummary,
  CommunicationId,
  type CommunicationDetail,
  type CommunicationActivityPage,
  type CommunicationExport,
  type CommunicationPage,
  type CommunicationRecipientPage,
  type CommunicationResults,
  type RenderedTemplate,
  type CommunicationReview,
  type CommunicationSenderList,
  type CommunicationsOverview,
  type ConsentView,
  CommunicationSegmentId,
  type SelectAllAudienceResult,
  type SegmentDetail,
  type SegmentFieldList,
  type SegmentMemberPage,
  type SegmentPage,
  type SegmentPreview,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ActivityQ,
  AudienceCandidatesQ,
  ExportBody,
  FollowUpBody,
  PreviewBody,
  RecipientsQ,
  UseTemplateBody,
  CancelBody,
  CommunicationsQ,
  ConsentQ,
  CreateCommunicationBody,
  RescheduleBody,
  ScheduleBody,
  SelectAllAudienceBody,
  SendBody,
  SetAudienceBody,
  UpdateCommunicationBody,
  CreateSegmentBody,
  PreviewSegmentBody,
  SegmentMembersQ,
  SegmentsQ,
  SetConsentBody,
  SetSegmentMembersBody,
  UpdateSegmentBody,
} from './communications-input.js';
import { CommunicationSegmentsService } from './communications-segments.service.js';
import { CommunicationResultsService } from './communications-results.service.js';
import { CommunicationsService } from './communications.service.js';

type Out<S extends z.ZodType> = z.output<S>;

const segmentPipe = new ZodValidationPipe(CommunicationSegmentId);
const idPipe = new ZodValidationPipe(CommunicationId);

const who = (auth: AuthContext, tenant: TenantContext) => {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, tenant };
};

/**
 * Communications (contract in packages/types/src/communications). Everyone with the grid's view
 * reads; creating, editing, segments and consent need Create, Edit or Manage (403 FORBIDDEN).
 * Staff reach only the clients and leads assigned to them. Never a portal route.
 */
@Controller('business/communications')
@Access('COMMUNICATIONS')
@Roles(...FIRM_STAFF)
export class CommunicationsController {
  constructor(
    private readonly segments: CommunicationSegmentsService,
    private readonly campaigns: CommunicationsService,
    private readonly results: CommunicationResultsService,
  ) {}

  // ----- Overview, lists, readiness -----

  @Get('overview')
  overview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CommunicationsOverview> {
    const w = who(auth, tenant);
    return this.campaigns.overview(w.tenant, w.userId);
  }

  @Get('senders')
  senders(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CommunicationSenderList> {
    const w = who(auth, tenant);
    return this.campaigns.senders(w.tenant, w.userId);
  }

  @Get('announcement-locations')
  announcementLocations(): AnnouncementLocationList {
    return this.campaigns.announcementLocations();
  }

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(CommunicationsQ)) q: Out<typeof CommunicationsQ>,
  ): Promise<CommunicationPage> {
    const w = who(auth, tenant);
    return this.campaigns.list(w.tenant, w.userId, q);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateCommunicationBody)) body: Out<typeof CreateCommunicationBody>,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.create(w.tenant, w.userId, body);
  }

  // ----- Audience (Choose Recipients) -----

  @Get('audience/candidates')
  candidates(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(AudienceCandidatesQ)) q: Out<typeof AudienceCandidatesQ>,
  ): Promise<AudienceCandidatePage> {
    const w = who(auth, tenant);
    return this.campaigns.candidates(w.tenant, w.userId, q);
  }

  @Post('audience/select-all')
  @HttpCode(200)
  selectAll(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SelectAllAudienceBody)) body: Out<typeof SelectAllAudienceBody>,
  ): Promise<SelectAllAudienceResult> {
    const w = who(auth, tenant);
    return this.campaigns.selectAll(w.tenant, w.userId, body);
  }

  // ----- Segments and lists -----

  @Get('segments/fields')
  segmentFields(@CurrentTenant() tenant: TenantContext): SegmentFieldList {
    return this.segments.fields(tenant);
  }

  @Get('segments')
  listSegments(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(SegmentsQ)) q: Out<typeof SegmentsQ>,
  ): Promise<SegmentPage> {
    const w = who(auth, tenant);
    return this.segments.list(w.tenant, w.userId, q);
  }

  @Post('segments')
  createSegment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateSegmentBody)) body: Out<typeof CreateSegmentBody>,
  ): Promise<SegmentDetail> {
    const w = who(auth, tenant);
    return this.segments.create(w.tenant, w.userId, body);
  }

  @Post('segments/preview')
  @HttpCode(200)
  previewSegment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(PreviewSegmentBody)) body: Out<typeof PreviewSegmentBody>,
  ): Promise<SegmentPreview> {
    const w = who(auth, tenant);
    return this.segments.preview(w.tenant, w.userId, body);
  }

  @Get('segments/:id')
  getSegment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', segmentPipe) id: string,
  ): Promise<SegmentDetail> {
    const w = who(auth, tenant);
    return this.segments.get(w.tenant, w.userId, id);
  }

  @Patch('segments/:id')
  updateSegment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', segmentPipe) id: string,
    @Body(new ZodValidationPipe(UpdateSegmentBody)) body: Out<typeof UpdateSegmentBody>,
  ): Promise<SegmentDetail> {
    const w = who(auth, tenant);
    return this.segments.update(w.tenant, w.userId, id, body);
  }

  @Get('segments/:id/members')
  segmentMembers(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', segmentPipe) id: string,
    @Query(new ZodValidationPipe(SegmentMembersQ)) q: Out<typeof SegmentMembersQ>,
  ): Promise<SegmentMemberPage> {
    const w = who(auth, tenant);
    return this.segments.members(w.tenant, w.userId, id, q);
  }

  @Put('segments/:id/members')
  setSegmentMembers(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', segmentPipe) id: string,
    @Body(new ZodValidationPipe(SetSegmentMembersBody)) body: Out<typeof SetSegmentMembersBody>,
  ): Promise<SegmentDetail> {
    const w = who(auth, tenant);
    return this.segments.setMembers(w.tenant, w.userId, id, body);
  }

  @Post('segments/:id/duplicate')
  duplicateSegment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', segmentPipe) id: string,
  ): Promise<SegmentDetail> {
    const w = who(auth, tenant);
    return this.segments.duplicate(w.tenant, w.userId, id);
  }

  @Post('segments/:id/archive')
  @HttpCode(200)
  archiveSegment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', segmentPipe) id: string,
  ): Promise<SegmentDetail> {
    const w = who(auth, tenant);
    return this.segments.setArchived(w.tenant, w.userId, id, true);
  }

  @Post('segments/:id/restore')
  @HttpCode(200)
  restoreSegment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', segmentPipe) id: string,
  ): Promise<SegmentDetail> {
    const w = who(auth, tenant);
    return this.segments.setArchived(w.tenant, w.userId, id, false);
  }

  // ----- Consent -----

  @Get('consent')
  getConsent(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ConsentQ)) q: Out<typeof ConsentQ>,
  ): Promise<ConsentView> {
    const w = who(auth, tenant);
    return this.segments.consent(w.tenant, w.userId, q);
  }

  @Put('consent')
  setConsent(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SetConsentBody)) body: Out<typeof SetConsentBody>,
  ): Promise<ConsentView> {
    const w = who(auth, tenant);
    return this.segments.setConsent(w.tenant, w.userId, body);
  }

  // ----- One communication (these come last: ':id' must not shadow the routes above) -----

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.get(w.tenant, w.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateCommunicationBody)) body: Out<typeof UpdateCommunicationBody>,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.update(w.tenant, w.userId, id, body);
  }

  @Get(':id/audience')
  audience(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<AudienceSummary> {
    const w = who(auth, tenant);
    return this.campaigns.audienceOf(w.tenant, w.userId, id);
  }

  @Put(':id/audience')
  setAudience(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SetAudienceBody)) body: Out<typeof SetAudienceBody>,
  ): Promise<AudienceSummary> {
    const w = who(auth, tenant);
    return this.campaigns.setAudience(w.tenant, w.userId, id, body);
  }

  @Get(':id/review')
  review(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CommunicationReview> {
    const w = who(auth, tenant);
    return this.campaigns.review(w.tenant, w.userId, id);
  }

  @Post(':id/send')
  @HttpCode(200)
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SendBody)) body: Out<typeof SendBody>,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.send(w.tenant, w.userId, id, body);
  }

  @Post(':id/schedule')
  @HttpCode(200)
  schedule(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ScheduleBody)) body: Out<typeof ScheduleBody>,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.schedule(w.tenant, w.userId, id, body);
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  reschedule(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RescheduleBody)) body: Out<typeof RescheduleBody>,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.reschedule(w.tenant, w.userId, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CancelBody)) body: Out<typeof CancelBody>,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.cancel(w.tenant, w.userId, id, body);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.setPaused(w.tenant, w.userId, id, true);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.setPaused(w.tenant, w.userId, id, false);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.setArchived(w.tenant, w.userId, id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.setArchived(w.tenant, w.userId, id, false);
  }

  @Post(':id/duplicate')
  duplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.duplicate(w.tenant, w.userId, id);
  }

  @Post(':id/use-template')
  @HttpCode(200)
  useTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UseTemplateBody)) body: Out<typeof UseTemplateBody>,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.campaigns.useTemplate(w.tenant, w.userId, id, body);
  }

  @Post(':id/preview')
  @HttpCode(200)
  preview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(PreviewBody)) body: Out<typeof PreviewBody>,
  ): Promise<RenderedTemplate> {
    const w = who(auth, tenant);
    return this.campaigns.preview(w.tenant, w.userId, id, body);
  }

  @Get(':id/results')
  resultsOf(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CommunicationResults> {
    const w = who(auth, tenant);
    return this.results.results(w.tenant, w.userId, id);
  }

  @Get(':id/recipients')
  recipients(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(RecipientsQ)) q: Out<typeof RecipientsQ>,
  ): Promise<CommunicationRecipientPage> {
    const w = who(auth, tenant);
    return this.results.recipients(w.tenant, w.userId, id, q);
  }

  @Get(':id/activity')
  activity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(ActivityQ)) q: Out<typeof ActivityQ>,
  ): Promise<CommunicationActivityPage> {
    const w = who(auth, tenant);
    return this.results.activity(w.tenant, w.userId, id, q);
  }

  @Post(':id/export')
  @HttpCode(200)
  exportResults(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ExportBody)) body: Out<typeof ExportBody>,
  ): Promise<CommunicationExport> {
    const w = who(auth, tenant);
    return this.results.export(w.tenant, w.userId, id, body);
  }

  @Post(':id/resend-failed')
  resendFailed(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.results.resendFailed(w.tenant, w.userId, id);
  }

  @Post(':id/follow-up')
  followUp(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(FollowUpBody)) body: Out<typeof FollowUpBody>,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.results.followUp(w.tenant, w.userId, id, body);
  }

  @Post(':id/expire')
  @HttpCode(200)
  expire(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CommunicationDetail> {
    const w = who(auth, tenant);
    return this.results.expire(w.tenant, w.userId, id);
  }
}
