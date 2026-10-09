import { BadRequestException, Body, Controller, Delete, Param, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  ConfirmEsignUploadBody,
  CreateEsignUploadBody,
  ESIGN_ERRORS,
  ESIGN_UPLOAD_TYPES,
  EsignDocumentId,
  type EsignDocument,
  EsignRequestId,
  type EsignRequestDetail,
  type UploadTicket,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../../auth/decorators.js';
import { RequiresModule } from '../../common/modules/requires-module.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { EsignDocumentsService } from './documents.service.js';
import { actorOf } from './requests.controller.js';

const idPipe = new ZodValidationPipe(EsignRequestId);

/** Another type is 400 FILE_TYPE_NOT_ALLOWED, as the client answers before sending anything. */
class UploadBodyPipe extends ZodValidationPipe<typeof CreateEsignUploadBody> {
  constructor() {
    super(CreateEsignUploadBody);
  }
  override transform(value: unknown) {
    const type = (value as { contentType?: unknown } | null)?.contentType;
    if (typeof type === 'string' && !Object.hasOwn(ESIGN_UPLOAD_TYPES, type)) {
      throw new BadRequestException({
        code: 'FILE_TYPE_NOT_ALLOWED',
        message: ESIGN_ERRORS.FILE_TYPE_NOT_ALLOWED,
      });
    }
    return super.transform(value);
  }
}

/** A DRAFT's files (contract: packages/types/src/esign). */
@Controller('esign/requests/:id/documents')
@Roles(...FIRM_STAFF)
@RequiresModule('esign')
export class EsignDocumentsController {
  constructor(private readonly documents: EsignDocumentsService) {}

  @Post('uploads')
  createUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new UploadBodyPipe()) body: z.output<typeof CreateEsignUploadBody>,
  ): Promise<UploadTicket> {
    return this.documents.createUpload(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('uploads/confirm')
  confirmUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmEsignUploadBody))
    body: z.output<typeof ConfirmEsignUploadBody>,
  ): Promise<EsignDocument> {
    const actor = actorOf(auth, tenant);
    return this.documents.confirmUpload(tenant.businessId, actor, id, body.uploadToken);
  }

  @Delete(':documentId')
  remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('documentId', new ZodValidationPipe(EsignDocumentId)) documentId: string,
  ): Promise<EsignRequestDetail> {
    const actor = actorOf(auth, tenant);
    return this.documents.removeDocument(tenant.businessId, actor, id, documentId);
  }
}
