import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  CreateEsignRequestBody,
  EsignPutFieldsBody,
  EsignPutPagePlanBody,
  EsignPutRecipientsBody,
  type EsignEventList,
  type EsignMergeValues,
  type EsignReadiness,
  EsignRequestId,
  type EsignRequestDetail,
  type EsignRequestList,
  type EsignStatus,
  type EsignSummary,
  ListEsignRequestsQuery,
  type OkResponse,
  UpdateEsignRequestBody,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../../auth/decorators.js';
import { RequiresModule } from '../../common/modules/requires-module.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { EsignListService } from './list.service.js';
import { EsignPrepareService } from './prepare.service.js';
import { type EsignActor, EsignRequestsService } from './requests.service.js';

const idPipe = new ZodValidationPipe(EsignRequestId);

/** The firm comes from TenantGuard; firm roles only (see @Roles). */
export function actorOf(auth: AuthContext, tenant: TenantContext): EsignActor {
  if (tenant.kind !== 'staff') throw new NotFoundException({ code: 'NOT_FOUND' });
  return { userId: auth.userId, role: tenant.role };
}

/** GET /esign/status: never MODULE_OFF, so it has no @RequiresModule. */
@Controller('esign')
@Roles(...FIRM_STAFF)
export class EsignStatusController {
  constructor(private readonly requests: EsignRequestsService) {}

  @Get('status')
  status(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<EsignStatus> {
    return this.requests.status(tenant.businessId, actorOf(auth, tenant));
  }
}

/** Firm Sign requests (contract: packages/types/src/esign/schemas.ts, docs/api/esign.yaml). */
@Controller('esign/requests')
@Roles(...FIRM_STAFF)
@RequiresModule('esign')
export class EsignRequestsController {
  constructor(
    private readonly requests: EsignRequestsService,
    private readonly prepare: EsignPrepareService,
    private readonly lists: EsignListService,
  ) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListEsignRequestsQuery))
    query: z.output<typeof ListEsignRequestsQuery>,
  ): Promise<EsignRequestList> {
    return this.lists.list(tenant.businessId, actorOf(auth, tenant), query);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateEsignRequestBody))
    body: z.output<typeof CreateEsignRequestBody>,
  ): Promise<EsignRequestDetail> {
    return this.requests.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  // Fixed paths go above @Get(':id'): declared after it, Nest would route them there and answer
  // 400 for the id.
  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<EsignSummary> {
    return this.lists.summary(tenant.businessId, actorOf(auth, tenant));
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<EsignRequestDetail> {
    return this.requests.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateEsignRequestBody))
    body: z.output<typeof UpdateEsignRequestBody>,
  ): Promise<EsignRequestDetail> {
    return this.requests.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Delete(':id')
  discard(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<OkResponse> {
    return this.requests.discard(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Put(':id/page-plan')
  putPagePlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(EsignPutPagePlanBody)) body: z.output<typeof EsignPutPagePlanBody>,
  ): Promise<EsignRequestDetail> {
    return this.requests.putPagePlan(tenant.businessId, actorOf(auth, tenant), id, body.pages);
  }

  @Put(':id/recipients')
  putRecipients(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(EsignPutRecipientsBody))
    body: z.output<typeof EsignPutRecipientsBody>,
  ): Promise<EsignRequestDetail> {
    return this.requests.putRecipients(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Put(':id/fields')
  putFields(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(EsignPutFieldsBody)) body: z.output<typeof EsignPutFieldsBody>,
  ): Promise<EsignRequestDetail> {
    return this.prepare.putFields(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get(':id/merge-values')
  mergeValues(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<EsignMergeValues> {
    return this.prepare.mergeValues(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Get(':id/events')
  events(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<EsignEventList> {
    return this.lists.events(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Get(':id/readiness')
  readiness(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<EsignReadiness> {
    return this.prepare.readiness(tenant.businessId, actorOf(auth, tenant), id);
  }
}
