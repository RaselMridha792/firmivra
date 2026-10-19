import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type AdminCommBroadcast,
  AdminCommBroadcastId,
  type AdminCommBroadcastSummary,
  type AdminCommBroadcastTestSent,
  type AdminCommMediaTicket,
  type AdminCommSegment,
  type AdminCommSegmentCount,
  AdminCommSegmentId,
  CreateAdminCommBroadcastRequest,
  CreateAdminCommMediaRequest,
  CreateAdminCommSegmentRequest,
  ListAdminCommBroadcastRecipientsQuery,
  type ListAdminCommBroadcastRecipientsResponse,
  ListAdminCommBroadcastsQuery,
  type ListAdminCommBroadcastsResponse,
  ListAdminCommMediaQuery,
  type ListAdminCommMediaResponse,
  ListAdminCommSegmentsQuery,
  type ListAdminCommSegmentsResponse,
  type OkResponse,
  ScheduleAdminCommBroadcastRequest,
  SendAdminCommBroadcastRequest,
  TestAdminCommBroadcastRequest,
  UpdateAdminCommBroadcastRequest,
  UpdateAdminCommSegmentRequest,
} from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CommBroadcastsService } from './comm-broadcasts.service.js';

const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);
const BroadcastId = pipe(AdminCommBroadcastId);
const SegmentId = pipe(AdminCommSegmentId);

/**
 * Super Admin broadcasts, audiences and files (contract:
 * packages/types/src/admin-communications/broadcasts.ts). Static routes come before `:id`.
 */
@Controller('admin/communications')
@Roles('SUPER_ADMIN')
export class AdminBroadcastsController {
  constructor(private readonly broadcasts: CommBroadcastsService) {}

  @Get('broadcasts')
  list(
    @Query(pipe(ListAdminCommBroadcastsQuery)) q: z.output<typeof ListAdminCommBroadcastsQuery>,
  ): Promise<ListAdminCommBroadcastsResponse> {
    return this.broadcasts.list(q);
  }

  @Get('broadcasts/summary')
  summary(): Promise<AdminCommBroadcastSummary> {
    return this.broadcasts.summary();
  }

  @Post('broadcasts')
  @HttpCode(200)
  create(
    @Body(pipe(CreateAdminCommBroadcastRequest))
    b: z.output<typeof CreateAdminCommBroadcastRequest>,
  ): Promise<AdminCommBroadcast> {
    return this.broadcasts.create(b);
  }

  @Get('broadcasts/:id')
  get(@Param('id', BroadcastId) id: string): Promise<AdminCommBroadcast> {
    return this.broadcasts.get(id);
  }

  @Patch('broadcasts/:id')
  update(
    @Param('id', BroadcastId) id: string,
    @Body(pipe(UpdateAdminCommBroadcastRequest))
    b: z.output<typeof UpdateAdminCommBroadcastRequest>,
  ): Promise<AdminCommBroadcast> {
    return this.broadcasts.update(id, b);
  }

  @Post('broadcasts/:id/test')
  @HttpCode(200)
  test(
    @Param('id', BroadcastId) id: string,
    @Body(pipe(TestAdminCommBroadcastRequest)) b: z.output<typeof TestAdminCommBroadcastRequest>,
  ): Promise<AdminCommBroadcastTestSent> {
    return this.broadcasts.test(id, b);
  }

  @Post('broadcasts/:id/schedule')
  @HttpCode(200)
  schedule(
    @Param('id', BroadcastId) id: string,
    @Body(pipe(ScheduleAdminCommBroadcastRequest))
    b: z.output<typeof ScheduleAdminCommBroadcastRequest>,
  ): Promise<AdminCommBroadcast> {
    return this.broadcasts.schedule(id, b);
  }

  @Post('broadcasts/:id/send')
  @HttpCode(200)
  send(
    @Param('id', BroadcastId) id: string,
    @Body(pipe(SendAdminCommBroadcastRequest)) _b: z.output<typeof SendAdminCommBroadcastRequest>,
  ): Promise<AdminCommBroadcast> {
    return this.broadcasts.send(id);
  }

  @Post('broadcasts/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', BroadcastId) id: string): Promise<AdminCommBroadcast> {
    return this.broadcasts.cancel(id);
  }

  @Post('broadcasts/:id/retry')
  @HttpCode(200)
  retry(
    @Param('id', BroadcastId) id: string,
    @Body(pipe(SendAdminCommBroadcastRequest)) _b: z.output<typeof SendAdminCommBroadcastRequest>,
  ): Promise<AdminCommBroadcast> {
    return this.broadcasts.retry(id);
  }

  @Post('broadcasts/:id/duplicate')
  @HttpCode(200)
  duplicate(@Param('id', BroadcastId) id: string): Promise<AdminCommBroadcast> {
    return this.broadcasts.duplicate(id);
  }

  @Post('broadcasts/:id/archive')
  @HttpCode(200)
  archive(@Param('id', BroadcastId) id: string): Promise<AdminCommBroadcast> {
    return this.broadcasts.archive(id);
  }

  @Delete('broadcasts/:id')
  remove(@Param('id', BroadcastId) id: string): Promise<OkResponse> {
    return this.broadcasts.remove(id);
  }

  @Get('broadcasts/:id/recipients')
  recipients(
    @Param('id', BroadcastId) id: string,
    @Query(pipe(ListAdminCommBroadcastRecipientsQuery))
    q: z.output<typeof ListAdminCommBroadcastRecipientsQuery>,
  ): Promise<ListAdminCommBroadcastRecipientsResponse> {
    return this.broadcasts.recipients(id, q);
  }

  // ----- Audiences -----

  @Get('segments')
  segments(
    @Query(pipe(ListAdminCommSegmentsQuery)) q: z.output<typeof ListAdminCommSegmentsQuery>,
  ): Promise<ListAdminCommSegmentsResponse> {
    return this.broadcasts.segments(q);
  }

  @Post('segments')
  @HttpCode(200)
  createSegment(
    @Body(pipe(CreateAdminCommSegmentRequest)) b: z.output<typeof CreateAdminCommSegmentRequest>,
  ): Promise<AdminCommSegment> {
    return this.broadcasts.createSegment(b);
  }

  @Patch('segments/:id')
  updateSegment(
    @Param('id', SegmentId) id: string,
    @Body(pipe(UpdateAdminCommSegmentRequest)) b: z.output<typeof UpdateAdminCommSegmentRequest>,
  ): Promise<AdminCommSegment> {
    return this.broadcasts.updateSegment(id, b);
  }

  @Post('segments/:id/count')
  @HttpCode(200)
  count(@Param('id', SegmentId) id: string): Promise<AdminCommSegmentCount> {
    return this.broadcasts.count(id);
  }

  // ----- Files -----

  @Get('media')
  media(
    @Query(pipe(ListAdminCommMediaQuery)) q: z.output<typeof ListAdminCommMediaQuery>,
  ): Promise<ListAdminCommMediaResponse> {
    return this.broadcasts.media(q);
  }

  @Post('media')
  @HttpCode(200)
  createMedia(
    @Body(pipe(CreateAdminCommMediaRequest)) b: z.output<typeof CreateAdminCommMediaRequest>,
  ): Promise<AdminCommMediaTicket> {
    return this.broadcasts.createMedia(b);
  }
}
