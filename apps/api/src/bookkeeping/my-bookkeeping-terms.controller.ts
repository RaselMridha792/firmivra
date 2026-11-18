import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  AcceptMyBookkeepingTermsRequest,
  BookkeepingTermsId,
  DeclineMyBookkeepingTermsRequest,
  type MyBookkeepingTerms,
  type MyBookkeepingTermsList,
  type OkResponse,
} from '@firmivra/types';
import type { z } from 'zod';
import { portalLogin } from '../appointments/request-actors.js';
import { CurrentTenant, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MyBookkeepingTermsService } from './my-bookkeeping-terms.service.js';

const termsId = new ZodValidationPipe(BookkeepingTermsId);

/**
 * Client Portal BK-CP3 (R55): the signed-in client's bookkeeping terms at one firm, under My
 * Services. The firm comes from the slug and the client from the session (TenantGuard), never
 * from the URL.
 */
@Controller('portal/:firmSlug/me/bookkeeping-terms')
@Roles('CLIENT')
export class MyBookkeepingTermsController {
  constructor(private readonly mine: MyBookkeepingTermsService) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<MyBookkeepingTermsList> {
    const me = portalLogin(tenant);
    return { items: await this.mine.list(me.businessId, me.clientAccountId) };
  }

  @Get(':termsId')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('termsId', termsId) id: string,
  ): Promise<MyBookkeepingTerms> {
    const me = portalLogin(tenant);
    return this.mine.get(me.businessId, me.clientAccountId, id);
  }

  /** Accept the version waiting for the client's answer, exactly as sent. */
  @Post(':termsId/accept')
  @HttpCode(200)
  accept(
    @CurrentTenant() tenant: TenantContext,
    @Param('termsId', termsId) id: string,
    @Body(new ZodValidationPipe(AcceptMyBookkeepingTermsRequest))
    body: z.output<typeof AcceptMyBookkeepingTermsRequest>,
  ): Promise<MyBookkeepingTerms> {
    const me = portalLogin(tenant);
    return this.mine.accept(me.businessId, me.clientAccountId, id, body);
  }

  /** Decline it: back to the firm as a draft. */
  @Post(':termsId/decline')
  @HttpCode(200)
  decline(
    @CurrentTenant() tenant: TenantContext,
    @Param('termsId', termsId) id: string,
    @Body(new ZodValidationPipe(DeclineMyBookkeepingTermsRequest))
    body: z.output<typeof DeclineMyBookkeepingTermsRequest>,
  ): Promise<OkResponse> {
    const me = portalLogin(tenant);
    return this.mine.decline(me.businessId, me.clientAccountId, id, body);
  }
}
