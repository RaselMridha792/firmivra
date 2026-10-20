import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApplyBillingCreditRequest,
  type BillingAdmin,
  type BillingCreditNote,
  BillingCreditNoteId,
  type BillingCreditNotePage,
  BillingCreditNotesQuery,
  type BillingCreditNoteSummary,
  BillingDocumentKind,
  type BillingEstimate,
  BillingEstimateId,
  type BillingEstimatePage,
  BillingEstimatesQuery,
  type BillingEstimateSummary,
  type BillingFirm,
  BillingFirmId,
  type BillingInvoiceDetail,
  BillingInvoiceId,
  type BillingInvoicePage,
  BillingInvoicesQuery,
  type BillingInvoiceSummary,
  type BillingItem,
  type BillingNextNumber,
  type BillingOk,
  type BillingPayment,
  BillingPaymentId,
  type BillingPaymentPage,
  BillingPaymentsQuery,
  type BillingPaymentSummary,
  type BillingRecurring,
  type BillingRecurringCounts,
  BillingRecurringId,
  type BillingRecurringPage,
  BillingRecurringQuery,
  type BillingSettings,
  RecordBillingPaymentRequest,
  RefundBillingCreditRequest,
  RefundBillingPaymentRequest,
  SaveBillingCreditNoteRequest,
  SaveBillingEstimateRequest,
  SaveBillingInvoiceRequest,
  SaveBillingProfileRequest,
  SaveBillingRecurringRequest,
  SendBillingRequest,
  SetBillingEstimateStatusRequest,
  SetBillingRecurringStatusRequest,
  UpdateBillingSettingsRequest,
  VoidBillingRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BillingSettingsService } from './billing-settings.service.js';
import { BillingService } from './billing.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const pipe = (schema: z.ZodType) => new ZodValidationPipe(schema);
const KindQuery = z.strictObject({ kind: BillingDocumentKind });
const FirmQuery = z.strictObject({ firmId: BillingFirmId });

/**
 * Super Admin Billing (R60 on R0's B3; contract `packages/types/src/admin-billing`), under
 * /api/v1/admin/billing: Firmivra bills firms. Super Admins only. Fixed paths come before `:id`.
 */
@Controller('admin/billing')
@Roles('SUPER_ADMIN')
export class AdminBillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly settings: BillingSettingsService,
  ) {}

  // ---------- Reference ----------

  @Get('firms')
  firms(): Promise<BillingFirm[]> {
    return this.settings.firms();
  }

  @Get('firms/:id')
  firm(@Param('id', pipe(BillingFirmId)) id: string): Promise<BillingFirm> {
    return this.settings.firm(id);
  }

  @Put('firms/:id/billing-profile')
  saveProfile(
    @Param('id', pipe(BillingFirmId)) id: string,
    @Body(pipe(SaveBillingProfileRequest)) body: Out<typeof SaveBillingProfileRequest>,
  ): Promise<BillingFirm> {
    return this.settings.saveProfile(id, body);
  }

  @Get('admins')
  admins(): Promise<BillingAdmin[]> {
    return this.settings.admins();
  }

  @Get('items')
  items(): Promise<BillingItem[]> {
    return this.settings.items();
  }

  @Get('next-number')
  nextNumber(@Query(pipe(KindQuery)) q: Out<typeof KindQuery>): Promise<BillingNextNumber> {
    return this.settings.nextNumber(q.kind);
  }

  @Get('settings')
  readSettings(): Promise<BillingSettings> {
    return this.settings.settings();
  }

  @Put('settings')
  updateSettings(
    @Body(pipe(UpdateBillingSettingsRequest)) body: Out<typeof UpdateBillingSettingsRequest>,
  ): Promise<BillingSettings> {
    return this.settings.update(body);
  }

  // ---------- Invoices ----------

  @Get('invoices')
  invoices(
    @Query(pipe(BillingInvoicesQuery)) q: Out<typeof BillingInvoicesQuery>,
  ): Promise<BillingInvoicePage> {
    return this.billing.invoices(q);
  }

  @Get('invoices/summary')
  invoiceSummary(
    @Query(pipe(BillingInvoicesQuery)) q: Out<typeof BillingInvoicesQuery>,
  ): Promise<BillingInvoiceSummary> {
    return this.billing.invoiceSummary(q);
  }

  @Post('invoices')
  createInvoice(
    @Body(pipe(SaveBillingInvoiceRequest)) body: Out<typeof SaveBillingInvoiceRequest>,
  ): Promise<BillingInvoiceDetail> {
    return this.billing.createInvoice(body);
  }

  @Get('invoices/:id')
  invoice(@Param('id', pipe(BillingInvoiceId)) id: string): Promise<BillingInvoiceDetail> {
    return this.billing.invoice(id);
  }

  @Patch('invoices/:id')
  updateInvoice(
    @Param('id', pipe(BillingInvoiceId)) id: string,
    @Body(pipe(SaveBillingInvoiceRequest)) body: Out<typeof SaveBillingInvoiceRequest>,
  ): Promise<BillingInvoiceDetail> {
    return this.billing.updateInvoice(id, body);
  }

  @Post('invoices/:id/send')
  @HttpCode(200)
  sendInvoice(
    @Param('id', pipe(BillingInvoiceId)) id: string,
    @Body(pipe(SendBillingRequest)) body: Out<typeof SendBillingRequest>,
  ): Promise<BillingInvoiceDetail> {
    return this.billing.sendInvoice(id, body);
  }

  @Post('invoices/:id/duplicate')
  duplicateInvoice(@Param('id', pipe(BillingInvoiceId)) id: string): Promise<BillingInvoiceDetail> {
    return this.billing.duplicateInvoice(id);
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  voidInvoice(
    @Param('id', pipe(BillingInvoiceId)) id: string,
    @Body(pipe(VoidBillingRequest)) body: Out<typeof VoidBillingRequest>,
  ): Promise<BillingInvoiceDetail> {
    return this.billing.voidInvoice(id, body);
  }

  @Post('invoices/:id/payments')
  recordPayment(
    @Param('id', pipe(BillingInvoiceId)) id: string,
    @Body(pipe(RecordBillingPaymentRequest)) body: Out<typeof RecordBillingPaymentRequest>,
  ): Promise<BillingPayment> {
    return this.billing.recordPayment(id, body);
  }

  // ---------- Payments ----------

  @Get('payments')
  payments(
    @Query(pipe(BillingPaymentsQuery)) q: Out<typeof BillingPaymentsQuery>,
  ): Promise<BillingPaymentPage> {
    return this.billing.payments(q);
  }

  @Get('payments/summary')
  paymentSummary(
    @Query(pipe(BillingPaymentsQuery)) q: Out<typeof BillingPaymentsQuery>,
  ): Promise<BillingPaymentSummary> {
    return this.billing.paymentSummary(q);
  }

  @Get('payments/:id')
  payment(@Param('id', pipe(BillingPaymentId)) id: string): Promise<BillingPayment> {
    return this.billing.payment(id);
  }

  @Post('payments/:id/refunds')
  @HttpCode(200)
  refund(
    @Param('id', pipe(BillingPaymentId)) id: string,
    @Body(pipe(RefundBillingPaymentRequest)) body: Out<typeof RefundBillingPaymentRequest>,
  ): Promise<BillingPayment> {
    return this.billing.refundPayment(id, body);
  }

  // ---------- Credit notes ----------

  @Get('credit-notes')
  creditNotes(
    @Query(pipe(BillingCreditNotesQuery)) q: Out<typeof BillingCreditNotesQuery>,
  ): Promise<BillingCreditNotePage> {
    return this.billing.creditNotes(q);
  }

  @Get('credit-notes/summary')
  creditSummary(
    @Query(pipe(BillingCreditNotesQuery)) q: Out<typeof BillingCreditNotesQuery>,
  ): Promise<BillingCreditNoteSummary> {
    return this.billing.creditNoteSummary(q);
  }

  @Get('credit-notes/available')
  available(@Query(pipe(FirmQuery)) q: Out<typeof FirmQuery>): Promise<BillingCreditNote[]> {
    return this.billing.availableCredits(q.firmId);
  }

  @Post('credit-notes')
  createCredit(
    @Body(pipe(SaveBillingCreditNoteRequest)) body: Out<typeof SaveBillingCreditNoteRequest>,
  ): Promise<BillingCreditNote> {
    return this.billing.createCreditNote(body);
  }

  @Get('credit-notes/:id')
  creditNote(@Param('id', pipe(BillingCreditNoteId)) id: string): Promise<BillingCreditNote> {
    return this.billing.creditNote(id);
  }

  @Patch('credit-notes/:id')
  updateCredit(
    @Param('id', pipe(BillingCreditNoteId)) id: string,
    @Body(pipe(SaveBillingCreditNoteRequest)) body: Out<typeof SaveBillingCreditNoteRequest>,
  ): Promise<BillingCreditNote> {
    return this.billing.updateCreditNote(id, body);
  }

  @Post('credit-notes/:id/issue')
  @HttpCode(200)
  issueCredit(@Param('id', pipe(BillingCreditNoteId)) id: string): Promise<BillingCreditNote> {
    return this.billing.issueCreditNote(id);
  }

  @Post('credit-notes/:id/apply')
  @HttpCode(200)
  applyCredit(
    @Param('id', pipe(BillingCreditNoteId)) id: string,
    @Body(pipe(ApplyBillingCreditRequest)) body: Out<typeof ApplyBillingCreditRequest>,
  ): Promise<BillingCreditNote> {
    return this.billing.applyCredit(id, body);
  }

  @Post('credit-notes/:id/refund')
  @HttpCode(200)
  refundCredit(
    @Param('id', pipe(BillingCreditNoteId)) id: string,
    @Body(pipe(RefundBillingCreditRequest)) body: Out<typeof RefundBillingCreditRequest>,
  ): Promise<BillingCreditNote> {
    return this.billing.refundCreditNote(id, body);
  }

  @Post('credit-notes/:id/void')
  @HttpCode(200)
  voidCredit(
    @Param('id', pipe(BillingCreditNoteId)) id: string,
    @Body(pipe(VoidBillingRequest)) body: Out<typeof VoidBillingRequest>,
  ): Promise<BillingCreditNote> {
    return this.billing.voidCreditNote(id, body);
  }

  // ---------- Estimates ----------

  @Get('estimates')
  estimates(
    @Query(pipe(BillingEstimatesQuery)) q: Out<typeof BillingEstimatesQuery>,
  ): Promise<BillingEstimatePage> {
    return this.billing.estimates(q);
  }

  @Get('estimates/summary')
  estimateSummary(
    @Query(pipe(BillingEstimatesQuery)) q: Out<typeof BillingEstimatesQuery>,
  ): Promise<BillingEstimateSummary> {
    return this.billing.estimateSummary(q);
  }

  @Post('estimates')
  createEstimate(
    @Body(pipe(SaveBillingEstimateRequest)) body: Out<typeof SaveBillingEstimateRequest>,
  ): Promise<BillingEstimate> {
    return this.billing.createEstimate(body);
  }

  @Get('estimates/:id')
  estimate(@Param('id', pipe(BillingEstimateId)) id: string): Promise<BillingEstimate> {
    return this.billing.estimate(id);
  }

  @Patch('estimates/:id')
  updateEstimate(
    @Param('id', pipe(BillingEstimateId)) id: string,
    @Body(pipe(SaveBillingEstimateRequest)) body: Out<typeof SaveBillingEstimateRequest>,
  ): Promise<BillingEstimate> {
    return this.billing.updateEstimate(id, body);
  }

  @Delete('estimates/:id')
  deleteEstimate(@Param('id', pipe(BillingEstimateId)) id: string): Promise<BillingOk> {
    return this.billing.deleteEstimate(id);
  }

  @Post('estimates/:id/send')
  @HttpCode(200)
  sendEstimate(
    @Param('id', pipe(BillingEstimateId)) id: string,
    @Body(pipe(SendBillingRequest)) body: Out<typeof SendBillingRequest>,
  ): Promise<BillingEstimate> {
    return this.billing.sendEstimate(id, body);
  }

  @Post('estimates/:id/status')
  @HttpCode(200)
  estimateStatus(
    @Param('id', pipe(BillingEstimateId)) id: string,
    @Body(pipe(SetBillingEstimateStatusRequest)) body: Out<typeof SetBillingEstimateStatusRequest>,
  ): Promise<BillingEstimate> {
    return this.billing.setEstimateStatus(id, body);
  }

  @Post('estimates/:id/duplicate')
  duplicateEstimate(@Param('id', pipe(BillingEstimateId)) id: string): Promise<BillingEstimate> {
    return this.billing.duplicateEstimate(id);
  }

  @Post('estimates/:id/convert')
  convertEstimate(@Param('id', pipe(BillingEstimateId)) id: string): Promise<BillingInvoiceDetail> {
    return this.billing.convertEstimate(id);
  }

  // ---------- Recurring ----------

  @Get('recurring')
  recurring(
    @Query(pipe(BillingRecurringQuery)) q: Out<typeof BillingRecurringQuery>,
  ): Promise<BillingRecurringPage> {
    return this.billing.recurringSchedules(q);
  }

  @Get('recurring/counts')
  recurringCounts(
    @Query(pipe(BillingRecurringQuery)) q: Out<typeof BillingRecurringQuery>,
  ): Promise<BillingRecurringCounts> {
    return this.billing.recurringCounts(q);
  }

  @Post('recurring')
  createRecurring(
    @Body(pipe(SaveBillingRecurringRequest)) body: Out<typeof SaveBillingRecurringRequest>,
  ): Promise<BillingRecurring> {
    return this.billing.createRecurring(body);
  }

  @Get('recurring/:id')
  schedule(@Param('id', pipe(BillingRecurringId)) id: string): Promise<BillingRecurring> {
    return this.billing.recurringSchedule(id);
  }

  @Patch('recurring/:id')
  updateRecurring(
    @Param('id', pipe(BillingRecurringId)) id: string,
    @Body(pipe(SaveBillingRecurringRequest)) body: Out<typeof SaveBillingRecurringRequest>,
  ): Promise<BillingRecurring> {
    return this.billing.updateRecurring(id, body);
  }

  @Post('recurring/:id/status')
  @HttpCode(200)
  recurringStatus(
    @Param('id', pipe(BillingRecurringId)) id: string,
    @Body(pipe(SetBillingRecurringStatusRequest))
    body: Out<typeof SetBillingRecurringStatusRequest>,
  ): Promise<BillingRecurring> {
    return this.billing.setRecurringStatus(id, body);
  }

  @Post('recurring/:id/run')
  runRecurring(@Param('id', pipe(BillingRecurringId)) id: string): Promise<BillingInvoiceDetail> {
    return this.billing.runRecurring(id);
  }
}
