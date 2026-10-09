import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  CreateEsignRequestBody,
  EsignRequestId,
  type EsignRequestDetail,
  type EsignStatus,
  type OkResponse,
  UpdateEsignRequestBody,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../../auth/decorators.js';
import { RequiresModule } from '../../common/modules/requires-module.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { type EsignActor, EsignRequestsService } from './requests.service.js';

const idPipe = new ZodValidationPipe(EsignRequestId);

/** The firm comes from TenantGuard; firm roles only (see @Roles). */
function actorOf(auth: AuthContext, tenant: TenantContext): EsignActor {
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
  constructor(private readonly requests: EsignRequestsService) {}

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateEsignRequestBody))
    body: z.output<typeof CreateEsignRequestBody>,
  ): Promise<EsignRequestDetail> {
    return this.requests.create(tenant.businessId, actorOf(auth, tenant), body);
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
}
