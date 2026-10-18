import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type ConsentView,
  CommunicationSegmentId,
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
  ConsentQ,
  CreateSegmentBody,
  PreviewSegmentBody,
  SegmentMembersQ,
  SegmentsQ,
  SetConsentBody,
  SetSegmentMembersBody,
  UpdateSegmentBody,
} from './communications-input.js';
import { CommunicationSegmentsService } from './communications-segments.service.js';

type Out<S extends z.ZodType> = z.output<S>;

const segmentPipe = new ZodValidationPipe(CommunicationSegmentId);

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
  constructor(private readonly segments: CommunicationSegmentsService) {}

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
}
