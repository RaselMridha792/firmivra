import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  type PipeTransform,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import {
  ESIGN_BULK_MAX,
  ESIGN_ERRORS,
  type EsignBulkBatch,
  EsignBulkSendBody,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../../auth/decorators.js';
import { RequiresModule } from '../../common/modules/requires-module.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { actorOf } from '../requests/requests.controller.js';
import { templateIdPipe } from '../templates/templates.controller.js';
import { EsignBulkService } from './bulk.service.js';

/** More than ESIGN_BULK_MAX clients is 400 BULK_LIMIT (its own code), then the contract's checks. */
class BulkBodyPipe implements PipeTransform<unknown, z.output<typeof EsignBulkSendBody>> {
  private readonly zod = new ZodValidationPipe(EsignBulkSendBody);
  transform(value: unknown) {
    const clients = (value as { clients?: unknown } | null)?.clients;
    if (Array.isArray(clients) && clients.length > ESIGN_BULK_MAX) {
      throw new BadRequestException({ code: 'BULK_LIMIT', message: ESIGN_ERRORS.BULK_LIMIT });
    }
    return this.zod.transform(value);
  }
}

/** Bulk send (contract 3: packages/types/src/esign/extras.ts, docs/api/esign.yaml). */
@Controller('esign')
@Roles(...FIRM_STAFF)
@RequiresModule('esign')
export class EsignBulkController {
  constructor(private readonly bulk: EsignBulkService) {}

  /** 202: the batch; the job runner makes and sends the requests. */
  @Post('templates/:templateId/bulk-send')
  @HttpCode(202)
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('templateId', templateIdPipe) templateId: string,
    @Body(new BulkBodyPipe()) body: z.output<typeof EsignBulkSendBody>,
  ): Promise<EsignBulkBatch> {
    return this.bulk.send(tenant.businessId, actorOf(auth, tenant), templateId, body);
  }

  @Get('bulk/:batchId')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('batchId', new ZodValidationPipe(z.uuid())) batchId: string,
  ): Promise<EsignBulkBatch> {
    return this.bulk.get(tenant.businessId, actorOf(auth, tenant), batchId);
  }
}
