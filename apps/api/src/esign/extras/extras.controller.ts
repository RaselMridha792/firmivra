import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  EsignApprovalBody,
  type EsignApproverList,
  EsignRequestId,
  type EsignRequestDetail,
  SubmitEsignApprovalBody,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../../auth/decorators.js';
import { RequiresModule } from '../../common/modules/requires-module.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { actorOf } from '../requests/requests.controller.js';
import { EsignApprovalsService } from './approvals.service.js';

const idPipe = new ZodValidationPipe(EsignRequestId);

/** Firm Sign's extras (contract 3: packages/types/src/esign/extras.ts, docs/api/esign.yaml). */
@Controller('esign')
@Roles(...FIRM_STAFF)
@RequiresModule('esign')
export class EsignExtrasController {
  constructor(private readonly approvals: EsignApprovalsService) {}

  /** `confirm: true` is the review screen's explicit confirmation (the pipe checks it). */
  @Post('requests/:id/submit-for-approval')
  @HttpCode(200)
  submitForApproval(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SubmitEsignApprovalBody)) _body: SubmitEsignApprovalBody,
  ): Promise<EsignRequestDetail> {
    return this.approvals.submit(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('requests/:id/approval')
  @HttpCode(200)
  decideApproval(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(EsignApprovalBody)) body: z.output<typeof EsignApprovalBody>,
  ): Promise<EsignRequestDetail> {
    return this.approvals.decide(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get('approvers')
  approvers(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<EsignApproverList> {
    return this.approvals.approvers(tenant.businessId, actorOf(auth, tenant));
  }
}
