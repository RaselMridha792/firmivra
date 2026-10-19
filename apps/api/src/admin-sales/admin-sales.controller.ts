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
import {
  AssignSalesOpportunityRequest,
  CreateSalesFollowUpRequest,
  CreateSalesOpportunityRequest,
  CreateSalesPipelineRequest,
  CreateSalesTargetRequest,
  LinkSalesTransactionRequest,
  LogSalesActivityRequest,
  MoveSalesStageRequest,
  type SalesAttentionSettings,
  SalesBulkRequest,
  type SalesBulkResult,
  type SalesCenterSummary,
  SalesDuplicateCheckRequest,
  type SalesDuplicateList,
  type SalesFeedList,
  SalesFeedQuery,
  type SalesFollowUp,
  SalesFollowUpId,
  type SalesFollowUpList,
  type SalesLeadSources,
  type SalesMeta,
  type SalesNote,
  SalesNoteId,
  type SalesOk,
  SalesOpportunitiesQuery,
  type SalesOpportunity,
  SalesOpportunityId,
  type SalesOpportunityPage,
  type SalesOpportunityRecord,
  SalesPeriodQuery,
  type SalesPipeline,
  SalesPipelineId,
  type SalesPipelineList,
  type SalesPipelineSummary,
  type SalesPlanList,
  type SalesRevenueByPlan,
  type SalesStageCounts,
  type SalesSubscriptionList,
  SalesSubscriptionsQuery,
  SalesSummaryQuery,
  type SalesTag,
  SalesTagId,
  type SalesTarget,
  SalesTargetId,
  type SalesTargetList,
  SalesTargetsQuery,
  SalesUpcomingQuery,
  SaveSalesAttentionSettingsRequest,
  SaveSalesNoteRequest,
  SaveSalesPipelineRequest,
  SaveSalesTagRequest,
  UpdateSalesFollowUpRequest,
  UpdateSalesOpportunityRequest,
  UpdateSalesTargetRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SalesAnalyticsService } from './sales-analytics.service.js';
import { SalesRecordsService } from './sales-records.service.js';
import { SalesSetupService } from './sales-setup.service.js';
import { SalesTargetsService } from './sales-targets.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const opportunityId = pipe(SalesOpportunityId);

/**
 * Super Admin Sales (R60 on R0's B5 and D1; contract `packages/types/src/admin-sales`), under
 * /api/v1/admin/sales: the Sales Center, the Sales Pipeline (board, list, KPIs, analytics), the
 * opportunity record, the pipeline builder, tags, the attention settings and targets. Super
 * Admins only (every sales permission today). Fixed paths come before `:id`.
 */
@Controller('admin/sales')
@Roles('SUPER_ADMIN')
export class AdminSalesController {
  constructor(
    private readonly records: SalesRecordsService,
    private readonly analytics: SalesAnalyticsService,
    private readonly setup: SalesSetupService,
    private readonly targetsService: SalesTargetsService,
  ) {}

  // ---------- Pickers and the Sales Center ----------

  @Get('meta')
  meta(): Promise<SalesMeta> {
    return this.setup.meta();
  }

  @Get('plans')
  plans(): Promise<SalesPlanList> {
    return this.setup.plans();
  }

  @Get('center')
  center(
    @Query(pipe(SalesPeriodQuery)) q: Out<typeof SalesPeriodQuery>,
  ): Promise<SalesCenterSummary> {
    return this.analytics.center(q);
  }

  @Get('analytics/stages')
  stageCounts(
    @Query(pipe(SalesPeriodQuery)) q: Out<typeof SalesPeriodQuery>,
  ): Promise<SalesStageCounts> {
    return this.analytics.stageCounts(q);
  }

  @Get('analytics/revenue-by-plan')
  revenueByPlan(
    @Query(pipe(SalesPeriodQuery)) q: Out<typeof SalesPeriodQuery>,
  ): Promise<SalesRevenueByPlan> {
    return this.analytics.revenueByPlan(q);
  }

  @Get('analytics/lead-sources')
  leadSources(
    @Query(pipe(SalesPeriodQuery)) q: Out<typeof SalesPeriodQuery>,
  ): Promise<SalesLeadSources> {
    return this.analytics.leadSources(q);
  }

  @Get('activity')
  activity(@Query(pipe(SalesFeedQuery)) q: Out<typeof SalesFeedQuery>): Promise<SalesFeedList> {
    return this.analytics.activity(q);
  }

  @Get('follow-ups')
  upcoming(
    @Query(pipe(SalesUpcomingQuery)) q: Out<typeof SalesUpcomingQuery>,
  ): Promise<SalesFollowUpList> {
    return this.analytics.upcoming(q);
  }

  @Get('report')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="firmivra-sales-report.csv"')
  async report(
    @Query(pipe(SalesPeriodQuery)) q: Out<typeof SalesPeriodQuery>,
  ): Promise<StreamableFile> {
    return new StreamableFile(Buffer.from(await this.analytics.report(q), 'utf8'), {
      type: 'text/csv; charset=utf-8',
    });
  }

  @Get('summary')
  summary(
    @Query(pipe(SalesSummaryQuery)) q: Out<typeof SalesSummaryQuery>,
  ): Promise<SalesPipelineSummary> {
    return this.records.summary(q);
  }

  @Get('subscriptions')
  subscriptions(
    @Query(pipe(SalesSubscriptionsQuery)) q: Out<typeof SalesSubscriptionsQuery>,
  ): Promise<SalesSubscriptionList> {
    return this.records.subscriptions(q);
  }

  // ---------- Opportunities ----------

  @Get('opportunities')
  list(
    @Query(pipe(SalesOpportunitiesQuery)) q: Out<typeof SalesOpportunitiesQuery>,
  ): Promise<SalesOpportunityPage> {
    return this.records.list(q);
  }

  @Post('opportunities/duplicate-check')
  @HttpCode(200)
  duplicates(
    @Body(pipe(SalesDuplicateCheckRequest)) body: Out<typeof SalesDuplicateCheckRequest>,
  ): Promise<SalesDuplicateList> {
    return this.records.duplicates(body);
  }

  @Post('opportunities/bulk')
  @HttpCode(200)
  bulk(@Body(pipe(SalesBulkRequest)) body: Out<typeof SalesBulkRequest>): Promise<SalesBulkResult> {
    return this.records.bulk(body);
  }

  @Post('opportunities')
  create(
    @Body(pipe(CreateSalesOpportunityRequest)) body: Out<typeof CreateSalesOpportunityRequest>,
  ): Promise<SalesOpportunity> {
    return this.records.create(body);
  }

  @Get('opportunities/:id')
  get(@Param('id', opportunityId) id: string): Promise<SalesOpportunityRecord> {
    return this.records.detail(id);
  }

  @Patch('opportunities/:id')
  update(
    @Param('id', opportunityId) id: string,
    @Body(pipe(UpdateSalesOpportunityRequest)) body: Out<typeof UpdateSalesOpportunityRequest>,
  ): Promise<SalesOpportunity> {
    return this.records.update(id, body);
  }

  @Post('opportunities/:id/stage')
  @HttpCode(200)
  move(
    @Param('id', opportunityId) id: string,
    @Body(pipe(MoveSalesStageRequest)) body: Out<typeof MoveSalesStageRequest>,
  ): Promise<SalesOpportunity> {
    return this.records.move(id, body);
  }

  @Post('opportunities/:id/assign')
  @HttpCode(200)
  assign(
    @Param('id', opportunityId) id: string,
    @Body(pipe(AssignSalesOpportunityRequest)) body: Out<typeof AssignSalesOpportunityRequest>,
  ): Promise<SalesOpportunity> {
    return this.records.assign(id, body);
  }

  @Post('opportunities/:id/transaction')
  @HttpCode(200)
  link(
    @Param('id', opportunityId) id: string,
    @Body(pipe(LinkSalesTransactionRequest)) body: Out<typeof LinkSalesTransactionRequest>,
  ): Promise<SalesOpportunity> {
    return this.records.link(id, body);
  }

  @Post('opportunities/:id/activities')
  logOutreach(
    @Param('id', opportunityId) id: string,
    @Body(pipe(LogSalesActivityRequest)) body: Out<typeof LogSalesActivityRequest>,
  ): Promise<SalesOpportunity> {
    return this.records.logActivity(id, body);
  }

  @Post('opportunities/:id/notes')
  addNote(
    @Param('id', opportunityId) id: string,
    @Body(pipe(SaveSalesNoteRequest)) body: Out<typeof SaveSalesNoteRequest>,
  ): Promise<SalesNote> {
    return this.records.addNote(id, body);
  }

  @Post('opportunities/:id/follow-ups')
  addFollowUp(
    @Param('id', opportunityId) id: string,
    @Body(pipe(CreateSalesFollowUpRequest)) body: Out<typeof CreateSalesFollowUpRequest>,
  ): Promise<SalesFollowUp> {
    return this.records.addFollowUp(id, body);
  }

  // ---------- Notes and follow-ups ----------

  @Patch('notes/:id')
  updateNote(
    @Param('id', pipe(SalesNoteId)) id: string,
    @Body(pipe(SaveSalesNoteRequest)) body: Out<typeof SaveSalesNoteRequest>,
  ): Promise<SalesNote> {
    return this.records.updateNote(id, body);
  }

  @Delete('notes/:id')
  deleteNote(@Param('id', pipe(SalesNoteId)) id: string): Promise<SalesOk> {
    return this.records.deleteNote(id);
  }

  @Patch('follow-ups/:id')
  updateFollowUp(
    @Param('id', pipe(SalesFollowUpId)) id: string,
    @Body(pipe(UpdateSalesFollowUpRequest)) body: Out<typeof UpdateSalesFollowUpRequest>,
  ): Promise<SalesFollowUp> {
    return this.records.updateFollowUp(id, body);
  }

  @Post('follow-ups/:id/complete')
  @HttpCode(200)
  complete(@Param('id', pipe(SalesFollowUpId)) id: string): Promise<SalesFollowUp> {
    return this.records.end(id, 'COMPLETED');
  }

  @Post('follow-ups/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', pipe(SalesFollowUpId)) id: string): Promise<SalesFollowUp> {
    return this.records.end(id, 'CANCELLED');
  }

  // ---------- The pipeline builder ----------

  @Get('pipelines')
  pipelines(): Promise<SalesPipelineList> {
    return this.setup.pipelines();
  }

  @Post('pipelines')
  createPipeline(
    @Body(pipe(CreateSalesPipelineRequest)) body: Out<typeof CreateSalesPipelineRequest>,
  ): Promise<SalesPipeline> {
    return this.setup.createPipeline(body);
  }

  @Put('pipelines/:id')
  savePipeline(
    @Param('id', pipe(SalesPipelineId)) id: string,
    @Body(pipe(SaveSalesPipelineRequest)) body: Out<typeof SaveSalesPipelineRequest>,
  ): Promise<SalesPipeline> {
    return this.setup.savePipeline(id, body);
  }

  // ---------- Tags and attention settings ----------

  @Post('tags')
  createTag(
    @Body(pipe(SaveSalesTagRequest)) body: Out<typeof SaveSalesTagRequest>,
  ): Promise<SalesTag> {
    return this.setup.saveTag(null, body);
  }

  @Patch('tags/:id')
  updateTag(
    @Param('id', pipe(SalesTagId)) id: string,
    @Body(pipe(SaveSalesTagRequest)) body: Out<typeof SaveSalesTagRequest>,
  ): Promise<SalesTag> {
    return this.setup.saveTag(id, body);
  }

  @Delete('tags/:id')
  deleteTag(@Param('id', pipe(SalesTagId)) id: string): Promise<SalesOk> {
    return this.setup.deleteTag(id);
  }

  @Get('attention-settings')
  attention(): Promise<SalesAttentionSettings> {
    return this.setup.attention();
  }

  @Put('attention-settings')
  saveAttention(
    @Body(pipe(SaveSalesAttentionSettingsRequest))
    body: Out<typeof SaveSalesAttentionSettingsRequest>,
  ): Promise<SalesAttentionSettings> {
    return this.setup.saveAttention(body);
  }

  // ---------- Targets ----------

  @Get('targets')
  targets(
    @Query(pipe(SalesTargetsQuery)) q: Out<typeof SalesTargetsQuery>,
  ): Promise<SalesTargetList> {
    return this.targetsService.list(q);
  }

  @Post('targets')
  createTarget(
    @Body(pipe(CreateSalesTargetRequest)) body: Out<typeof CreateSalesTargetRequest>,
  ): Promise<SalesTarget> {
    return this.targetsService.create(body);
  }

  @Patch('targets/:id')
  updateTarget(
    @Param('id', pipe(SalesTargetId)) id: string,
    @Body(pipe(UpdateSalesTargetRequest)) body: Out<typeof UpdateSalesTargetRequest>,
  ): Promise<SalesTarget> {
    return this.targetsService.update(id, body);
  }

  @Post('targets/:id/archive')
  @HttpCode(200)
  archiveTarget(@Param('id', pipe(SalesTargetId)) id: string): Promise<SalesTarget> {
    return this.targetsService.archive(id);
  }
}
