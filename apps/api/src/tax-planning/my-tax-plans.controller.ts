import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApproveMyTaxPlanRequest,
  CreateMyTaxPlanRequest,
  type MyTaxPlan,
  type MyTaxPlanList,
  TaxPlanId,
} from '@firmivra/types';
import type { z } from 'zod';
import { portalLogin } from '../appointments/request-actors.js';
import { CurrentTenant, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MyTaxPlansService } from './my-tax-plans.service.js';

const idPipe = new ZodValidationPipe(TaxPlanId);

/**
 * P4-8 (Tax Planning Review 2): the signed-in client's tax plans at one firm, in the portal. The
 * firm comes from the slug and the client from the session (TenantGuard), never from the URL.
 */
@Controller('portal/:firmSlug/me/tax-plans')
@Roles('CLIENT')
export class MyTaxPlansController {
  constructor(private readonly mine: MyTaxPlansService) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<MyTaxPlanList> {
    const me = portalLogin(tenant);
    return { items: await this.mine.list(me.businessId, me.clientAccountId) };
  }

  @Get(':id')
  get(@CurrentTenant() tenant: TenantContext, @Param('id', idPipe) id: string): Promise<MyTaxPlan> {
    const me = portalLogin(tenant);
    return this.mine.get(me.businessId, me.clientAccountId, id);
  }

  /** Ask a Question, Request a Revision or Request a Meeting. */
  @Post(':id/requests')
  @HttpCode(200)
  ask(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CreateMyTaxPlanRequest))
    body: z.output<typeof CreateMyTaxPlanRequest>,
  ): Promise<MyTaxPlan> {
    const me = portalLogin(tenant);
    return this.mine.ask(me.businessId, me.clientAccountId, id, body);
  }

  /** Approve the exact version awaiting the client's review. */
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ApproveMyTaxPlanRequest))
    body: z.output<typeof ApproveMyTaxPlanRequest>,
  ): Promise<MyTaxPlan> {
    const me = portalLogin(tenant);
    return this.mine.approve(me.businessId, me.clientAccountId, id, body);
  }
}
