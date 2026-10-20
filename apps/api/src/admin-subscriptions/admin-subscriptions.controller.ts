import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  AddSubscriptionNoteRequest,
  ChangeBillingDateRequest,
  ChangeSubscriptionPlanRequest,
  CloseSubscriptionRequest,
  ConvertSubscriptionRequest,
  CreateSubscriptionRequest,
  ExtendSubscriptionTrialRequest,
  ReactivateSubscriptionRequest,
  ReverseCancellationRequest,
  SetSubscriptionPriceRequest,
  type SubscriptionAvailableFirmList,
  SubscriptionExportQuery,
  SubscriptionId,
  type SubscriptionMeta,
  type SubscriptionNote,
  type SubscriptionPage,
  type SubscriptionRecord,
  type SubscriptionResult,
  SubscriptionsQuery,
  type SubscriptionSummary,
  SubscriptionSummaryQuery,
  SuspendSubscriptionRequest,
  TurnOffAutoRenewRequest,
  UpdateSubscriptionLocationsRequest,
  UpdateSubscriptionSeatsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SubscriptionsChangeService } from './subscriptions-changes.service.js';
import { SubscriptionsReadService } from './subscriptions-reads.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const subscriptionId = pipe(SubscriptionId);

/**
 * Super Admin Subscriptions (R60 on R0's stage A, B3 and the MRR rollup; contract
 * `packages/types/src/admin-subscriptions`), under /api/v1/admin/subscriptions: the KPI row, the
 * table, the detail panel and its dialogs. Super Admins only. Fixed paths come before `:id`.
 */
@Controller('admin/subscriptions')
@Roles('SUPER_ADMIN')
export class AdminSubscriptionsController {
  constructor(
    private readonly reads: SubscriptionsReadService,
    private readonly changes: SubscriptionsChangeService,
  ) {}

  // ---------- Reads ----------

  @Get('meta')
  meta(): Promise<SubscriptionMeta> {
    return this.reads.meta();
  }

  @Get('summary')
  summary(
    @Query(pipe(SubscriptionSummaryQuery)) q: Out<typeof SubscriptionSummaryQuery>,
  ): Promise<SubscriptionSummary> {
    return this.reads.summary(q);
  }

  @Get('available-firms')
  availableFirms(): Promise<SubscriptionAvailableFirmList> {
    return this.reads.availableFirms();
  }

  @Get('export')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="firmivra-subscriptions.csv"')
  async export(
    @Query(pipe(SubscriptionExportQuery)) q: Out<typeof SubscriptionExportQuery>,
  ): Promise<StreamableFile> {
    return new StreamableFile(Buffer.from(await this.reads.exportCsv(q), 'utf8'), {
      type: 'text/csv; charset=utf-8',
    });
  }

  @Get()
  list(
    @Query(pipe(SubscriptionsQuery)) q: Out<typeof SubscriptionsQuery>,
  ): Promise<SubscriptionPage> {
    return this.reads.list(q);
  }

  @Get(':id')
  get(@Param('id', subscriptionId) id: string): Promise<SubscriptionRecord> {
    return this.reads.detail(id);
  }

  // ---------- Start and plan ----------

  @Post()
  create(
    @Body(pipe(CreateSubscriptionRequest)) body: Out<typeof CreateSubscriptionRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.create(body);
  }

  @Post(':id/plan')
  @HttpCode(200)
  changePlan(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(ChangeSubscriptionPlanRequest)) body: Out<typeof ChangeSubscriptionPlanRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.changePlan(id, body);
  }

  @Post(':id/seats')
  @HttpCode(200)
  updateSeats(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(UpdateSubscriptionSeatsRequest)) body: Out<typeof UpdateSubscriptionSeatsRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.updateSeats(id, body);
  }

  @Post(':id/locations')
  @HttpCode(200)
  updateLocations(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(UpdateSubscriptionLocationsRequest))
    body: Out<typeof UpdateSubscriptionLocationsRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.updateLocations(id, body);
  }

  // ---------- Trial ----------

  @Post(':id/extend-trial')
  @HttpCode(200)
  extendTrial(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(ExtendSubscriptionTrialRequest)) body: Out<typeof ExtendSubscriptionTrialRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.extendTrial(id, body);
  }

  @Post(':id/convert')
  @HttpCode(200)
  convert(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(ConvertSubscriptionRequest)) body: Out<typeof ConvertSubscriptionRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.convert(id, body);
  }

  // ---------- Renewal and lifecycle ----------

  @Post(':id/auto-renew/off')
  @HttpCode(200)
  turnOffAutoRenew(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(TurnOffAutoRenewRequest)) body: Out<typeof TurnOffAutoRenewRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.turnOffAutoRenew(id, body);
  }

  @Post(':id/auto-renew/on')
  @HttpCode(200)
  reverseCancellation(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(ReverseCancellationRequest)) body: Out<typeof ReverseCancellationRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.reverseCancellation(id, body);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  suspend(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(SuspendSubscriptionRequest)) body: Out<typeof SuspendSubscriptionRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.suspend(id, body);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(ReactivateSubscriptionRequest)) body: Out<typeof ReactivateSubscriptionRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.reactivate(id, body);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(CloseSubscriptionRequest)) body: Out<typeof CloseSubscriptionRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.close(id, body);
  }

  // ---------- Billing terms ----------

  @Post(':id/price')
  @HttpCode(200)
  setPrice(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(SetSubscriptionPriceRequest)) body: Out<typeof SetSubscriptionPriceRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.setPrice(id, body);
  }

  @Post(':id/billing-date')
  @HttpCode(200)
  changeBillingDate(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(ChangeBillingDateRequest)) body: Out<typeof ChangeBillingDateRequest>,
  ): Promise<SubscriptionResult> {
    return this.changes.changeBillingDate(id, body);
  }

  // ---------- Notes ----------

  @Post(':id/notes')
  addNote(
    @Param('id', subscriptionId) id: string,
    @Body(pipe(AddSubscriptionNoteRequest)) body: Out<typeof AddSubscriptionNoteRequest>,
  ): Promise<SubscriptionNote> {
    return this.changes.addNote(id, body);
  }
}
