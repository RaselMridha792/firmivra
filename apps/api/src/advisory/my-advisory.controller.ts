import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  AdvisoryPlanId,
  AdvisoryResourceKey,
  ApproveMyAdvisoryPlanRequest,
  type MyAdvisory,
  type MyAdvisoryPlan,
  type MyAdvisoryResourcePdf,
} from '@firmivra/types';
import type { z } from 'zod';
import { portalLogin } from '../appointments/request-actors.js';
import { CurrentAuth, CurrentTenant, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MyAdvisoryService } from './my-advisory.service.js';

/** The signed-in login: the firm from the slug, the client from the session (never the URL). */
const caller = (auth: AuthContext, tenant: TenantContext) => {
  const me = portalLogin(tenant);
  return { businessId: me.businessId, clientAccountId: me.clientAccountId, userId: auth.userId };
};

/**
 * BA-CP (Client Portal Review One): the signed-in client's Business Advisory, under My Services.
 * What the firm marked for the client only; another client's or firm's plan is 404. B10: the
 * client approves the plan sent for their approval (409 when it isn't waiting, or another version).
 */
@Controller('portal/:firmSlug/me/advisory')
@Roles('CLIENT')
export class MyAdvisoryController {
  constructor(private readonly mine: MyAdvisoryService) {}

  @Get()
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<MyAdvisory> {
    return this.mine.get(caller(auth, tenant));
  }

  @Get('plans/:id')
  plan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(AdvisoryPlanId)) id: string,
  ): Promise<MyAdvisoryPlan> {
    return this.mine.plan(caller(auth, tenant), id);
  }

  /** B10: approve the exact version awaiting the client's approval. */
  @Post('plans/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(AdvisoryPlanId)) id: string,
    @Body(new ZodValidationPipe(ApproveMyAdvisoryPlanRequest))
    body: z.output<typeof ApproveMyAdvisoryPlanRequest>,
  ): Promise<MyAdvisoryPlan> {
    return this.mine.approve(caller(auth, tenant), id, body);
  }

  /** B28: the PDF of a resource the firm sent as a PDF, behind a 5-minute link. */
  @Get('resources/:key/pdf')
  resourcePdf(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('key', new ZodValidationPipe(AdvisoryResourceKey)) key: string,
  ): Promise<MyAdvisoryResourcePdf> {
    return this.mine.resourcePdf(caller(auth, tenant), key);
  }
}
