import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  type DownloadLink,
  EsignRecipientId,
  ListMySignaturesQuery,
  type MySignatureList,
  type MySignaturesStatus,
  SignerCopyFile,
  type SignerState,
} from '@firmivra/types';
import { CurrentTenant, Roles } from '../../auth/decorators.js';
import { RequiresModule } from '../../common/modules/requires-module.js';
import type { TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { EsignCenterService, type PortalSigner } from './center.service.js';

const idPipe = new ZodValidationPipe(EsignRecipientId);

/** The client login from the session (TenantGuard's client account), never from the URL. */
function signerOf(tenant: TenantContext): PortalSigner {
  if (tenant.kind !== 'client') throw new NotFoundException({ code: 'NOT_FOUND' });
  return { businessId: tenant.businessId, clientAccountId: tenant.clientAccountId };
}

/**
 * The portal's Signature center (contract: `api.mySignatures(slug)` in
 * packages/types/src/esign/client.ts, docs/api/esign.yaml). `status` answers while Firm Sign is
 * off; every other route answers 403 MODULE_OFF then.
 */
@Controller('portal/:firmSlug/me/signatures')
@Roles('CLIENT')
export class EsignCenterController {
  constructor(private readonly center: EsignCenterService) {}

  @Get('status')
  status(@CurrentTenant() tenant: TenantContext): Promise<MySignaturesStatus> {
    return this.center.status(signerOf(tenant).businessId);
  }

  @Get()
  @RequiresModule('esign')
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListMySignaturesQuery))
    query: z.output<typeof ListMySignaturesQuery>,
  ): Promise<MySignatureList> {
    return this.center.list(signerOf(tenant), query.tab);
  }

  /** Sets the signer cookie (path /api/v1/portal/{slug}/sign); then the signer routes. */
  @Post(':recipientId/session')
  @HttpCode(200)
  @RequiresModule('esign')
  startSigning(
    @CurrentTenant() tenant: TenantContext,
    @Param('recipientId', idPipe) recipientId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignerState> {
    return this.center.startSigning(signerOf(tenant), recipientId, res);
  }

  /** `file`: the signed PDF (`final`, when left out) or the certificate. */
  @Get(':recipientId/download')
  @RequiresModule('esign')
  download(
    @CurrentTenant() tenant: TenantContext,
    @Param('recipientId', idPipe) recipientId: string,
    @Query('file', new ZodValidationPipe(SignerCopyFile.default('final'))) file: SignerCopyFile,
  ): Promise<DownloadLink> {
    return this.center.download(signerOf(tenant), recipientId, file);
  }
}
