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
import type {
  EfileReport,
  OkResponse,
  TaxApprovalList,
  TaxAuthorizationList,
  TaxChecklist,
  TaxReturnDocumentList,
  TaxReturnExportLink,
  TaxReturnFilingList,
  TaxReturnActivityList,
  TaxReturnDetail,
  TaxReturnHistoryList,
  TaxReturnPage,
  TaxReturnSummary,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TaxReturnReviewService } from './review.service.js';
import {
  ApprovalBody,
  ApproveBody,
  AttemptBody,
  ChecklistItemBody,
  EfileQ,
  LinkAuthorizationBody,
  LinkDocumentBody,
  PaperFiledBody,
  ReturnApprovalBody,
  SetAuthorizationsBody,
  SetFilingsBody,
  UpdateAttemptBody,
  UpdateChecklistItemBody,
  UpdateFilingBody,
  WetSignatureBody,
  AmendBody,
  CarryForwardBody,
  CreateReturnBody,
  IdParam,
  ReturnsQ,
  StatusBody,
  SummaryQ,
  UpdateDetailsBody,
} from './workspace.input.js';
import { TaxReturnWorkspaceService } from './workspace.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const idPipe = new ZodValidationPipe(IdParam);

/**
 * The Tax Returns workspace (R55, `api.taxReturnWorkspace`), part 1. Registered before R10's
 * TaxReturnsController (which keeps PATCH and DELETE :id). Static routes before ':id'.
 */
@Controller('business/tax-returns')
@Access('TAX_RETURNS')
@Roles(...FIRM_STAFF)
export class TaxReturnWorkspaceController {
  constructor(
    private readonly returns: TaxReturnWorkspaceService,
    private readonly review: TaxReturnReviewService,
  ) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ReturnsQ)) q: Out<typeof ReturnsQ>,
  ): Promise<TaxReturnPage> {
    return this.returns.list(tenant, auth.userId, q);
  }

  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(SummaryQ)) q: Out<typeof SummaryQ>,
  ): Promise<TaxReturnSummary> {
    return this.returns.summary(tenant, auth.userId, q);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateReturnBody)) body: Out<typeof CreateReturnBody>,
  ): Promise<TaxReturnDetail> {
    return this.returns.create(tenant, auth.userId, body);
  }

  @Get('reports/efile')
  efileReport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(EfileQ)) q: Out<typeof EfileQ>,
  ): Promise<EfileReport> {
    return this.review.efileReport(tenant, auth.userId, q);
  }

  @Post('export')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EXPORT')
  exportList(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ReturnsQ)) q: Out<typeof ReturnsQ>,
  ): Promise<TaxReturnExportLink> {
    return this.review.exportList(tenant, auth.userId, q);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnDetail> {
    return this.returns.get(tenant, auth.userId, id);
  }

  @Patch(':id/details')
  updateDetails(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateDetailsBody)) body: Out<typeof UpdateDetailsBody>,
  ): Promise<TaxReturnDetail> {
    return this.returns.updateDetails(tenant, auth.userId, id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  changeStatus(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StatusBody)) body: Out<typeof StatusBody>,
  ): Promise<TaxReturnDetail> {
    return this.returns.changeStatus(tenant, auth.userId, id, body);
  }

  @Get(':id/history')
  async history(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnHistoryList> {
    return { items: await this.returns.history(tenant, auth.userId, id) };
  }

  @Get(':id/activity')
  async activity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnActivityList> {
    return { items: await this.returns.activity(tenant, auth.userId, id) };
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnDetail> {
    return this.returns.archive(tenant, auth.userId, id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnDetail> {
    return this.returns.archive(tenant, auth.userId, id, false);
  }

  @Post(':id/amend')
  amend(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AmendBody)) body: Out<typeof AmendBody>,
  ): Promise<TaxReturnDetail> {
    return this.returns.amend(tenant, auth.userId, id, body);
  }

  @Post(':id/carry-forward')
  carryForward(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CarryForwardBody)) body: Out<typeof CarryForwardBody>,
  ): Promise<TaxReturnDetail> {
    return this.returns.carryForward(tenant, auth.userId, id, body);
  }

  @Get(':id/filings')
  async filings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnFilingList> {
    return { items: await this.review.filings(tenant, auth.userId, id) };
  }

  @Put(':id/filings')
  async setFilings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SetFilingsBody)) body: Out<typeof SetFilingsBody>,
  ): Promise<TaxReturnFilingList> {
    return { items: await this.review.setFilings(tenant, auth.userId, id, body) };
  }

  @Patch(':id/filings/:filingId')
  async updateFiling(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('filingId', idPipe) filingId: string,
    @Body(new ZodValidationPipe(UpdateFilingBody)) body: Out<typeof UpdateFilingBody>,
  ): Promise<TaxReturnFilingList> {
    return { items: await this.review.updateFiling(tenant, auth.userId, id, filingId, body) };
  }

  @Post(':id/filings/:filingId/attempts')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  async recordAttempt(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('filingId', idPipe) filingId: string,
    @Body(new ZodValidationPipe(AttemptBody)) body: Out<typeof AttemptBody>,
  ): Promise<TaxReturnFilingList> {
    return { items: await this.review.recordAttempt(tenant, auth.userId, id, filingId, body) };
  }

  @Patch(':id/attempts/:attemptId')
  async updateAttempt(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('attemptId', idPipe) attemptId: string,
    @Body(new ZodValidationPipe(UpdateAttemptBody)) body: Out<typeof UpdateAttemptBody>,
  ): Promise<TaxReturnFilingList> {
    return { items: await this.review.updateAttempt(tenant, auth.userId, id, attemptId, body) };
  }

  @Post(':id/filings/:filingId/paper-filed')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  async paperFiled(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('filingId', idPipe) filingId: string,
    @Body(new ZodValidationPipe(PaperFiledBody)) body: Out<typeof PaperFiledBody>,
  ): Promise<TaxReturnFilingList> {
    return { items: await this.review.paperFiled(tenant, auth.userId, id, filingId, body) };
  }

  @Get(':id/checklist')
  async checklist(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxChecklist> {
    return { items: await this.review.checklist(tenant, auth.userId, id) };
  }

  @Post(':id/checklist')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  async addChecklistItem(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ChecklistItemBody)) body: Out<typeof ChecklistItemBody>,
  ): Promise<TaxChecklist> {
    return { items: await this.review.addChecklistItem(tenant, auth.userId, id, body) };
  }

  @Patch(':id/checklist/:itemId')
  async updateChecklistItem(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('itemId', idPipe) itemId: string,
    @Body(new ZodValidationPipe(UpdateChecklistItemBody)) body: Out<typeof UpdateChecklistItemBody>,
  ): Promise<TaxChecklist> {
    return { items: await this.review.updateChecklistItem(tenant, auth.userId, id, itemId, body) };
  }

  @Delete(':id/checklist/:itemId')
  @Access('TAX_RETURNS', 'EDIT')
  async removeChecklistItem(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('itemId', idPipe) itemId: string,
  ): Promise<TaxChecklist> {
    return { items: await this.review.removeChecklistItem(tenant, auth.userId, id, itemId) };
  }

  @Post(':id/final-validation')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  finalValidation(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnDetail> {
    return this.review.finalValidation(tenant, auth.userId, id);
  }

  @Get(':id/approvals')
  async approvals(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxApprovalList> {
    return { items: await this.review.approvals(tenant, auth.userId, id) };
  }

  @Post(':id/approvals')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  async addApproval(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ApprovalBody)) body: Out<typeof ApprovalBody>,
  ): Promise<TaxApprovalList> {
    return { items: await this.review.addApproval(tenant, auth.userId, id, body) };
  }

  @Post(':id/approvals/:approvalId/approve')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  async approve(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('approvalId', idPipe) approvalId: string,
    @Body(new ZodValidationPipe(ApproveBody)) body: Out<typeof ApproveBody>,
  ): Promise<TaxApprovalList> {
    return { items: await this.review.approve(tenant, auth.userId, id, approvalId, body) };
  }

  @Post(':id/approvals/:approvalId/return')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  async returnStep(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('approvalId', idPipe) approvalId: string,
    @Body(new ZodValidationPipe(ReturnApprovalBody)) body: Out<typeof ReturnApprovalBody>,
  ): Promise<TaxApprovalList> {
    return { items: await this.review.returnStep(tenant, auth.userId, id, approvalId, body) };
  }

  @Get(':id/authorizations')
  async authorizations(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxAuthorizationList> {
    return { items: await this.review.authorizations(tenant, auth.userId, id) };
  }

  @Put(':id/authorizations')
  async setAuthorizations(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SetAuthorizationsBody)) body: Out<typeof SetAuthorizationsBody>,
  ): Promise<TaxAuthorizationList> {
    return { items: await this.review.setAuthorizations(tenant, auth.userId, id, body) };
  }

  @Post(':id/authorizations/:authorizationId/link')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  async linkAuthorization(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('authorizationId', idPipe) authorizationId: string,
    @Body(new ZodValidationPipe(LinkAuthorizationBody)) body: Out<typeof LinkAuthorizationBody>,
  ): Promise<TaxAuthorizationList> {
    return {
      items: await this.review.linkAuthorization(tenant, auth.userId, id, authorizationId, body),
    };
  }

  @Post(':id/authorizations/:authorizationId/wet-signature')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  async wetSignature(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('authorizationId', idPipe) authorizationId: string,
    @Body(new ZodValidationPipe(WetSignatureBody)) body: Out<typeof WetSignatureBody>,
  ): Promise<TaxAuthorizationList> {
    return {
      items: await this.review.wetSignature(tenant, auth.userId, id, authorizationId, body),
    };
  }

  @Get(':id/documents')
  async documents(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnDocumentList> {
    return { items: await this.review.documents(tenant, auth.userId, id) };
  }

  @Post(':id/documents')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  async linkDocument(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(LinkDocumentBody)) body: Out<typeof LinkDocumentBody>,
  ): Promise<TaxReturnDocumentList> {
    return { items: await this.review.linkDocument(tenant, auth.userId, id, body) };
  }

  @Delete(':id/documents/:documentId')
  @Access('TAX_RETURNS', 'EDIT')
  unlinkDocument(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('documentId', idPipe) documentId: string,
  ): Promise<OkResponse> {
    return this.review.unlinkDocument(tenant, auth.userId, id, documentId);
  }
}
