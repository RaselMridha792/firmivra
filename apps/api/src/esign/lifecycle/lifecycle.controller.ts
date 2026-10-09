import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  EsignRemindBody,
  EsignRequestId,
  type EsignRequestDetail,
  EsignVoidBody,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../../auth/decorators.js';
import { RequiresModule } from '../../common/modules/requires-module.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { actorOf } from '../requests/requests.controller.js';
import { EsignLifecycleService } from './lifecycle.service.js';

const idPipe = new ZodValidationPipe(EsignRequestId);

/** Remind and void a sent request (packages/types/src/esign/schemas.ts). */
@Controller('esign/requests/:id')
@Roles(...FIRM_STAFF)
@RequiresModule('esign')
export class EsignLifecycleController {
  constructor(private readonly lifecycle: EsignLifecycleService) {}

  @Post('remind')
  @HttpCode(200)
  remind(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(EsignRemindBody)) body: z.output<typeof EsignRemindBody>,
  ): Promise<EsignRequestDetail> {
    const actor = actorOf(auth, tenant);
    return this.lifecycle.remind(tenant.businessId, actor, id, body.recipientId);
  }

  @Post('void')
  @HttpCode(200)
  void(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(EsignVoidBody)) body: z.output<typeof EsignVoidBody>,
  ): Promise<EsignRequestDetail> {
    return this.lifecycle.void(tenant.businessId, actorOf(auth, tenant), id, body.reason);
  }
}
