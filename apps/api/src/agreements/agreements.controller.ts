import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  type AgreementFile,
  AgreementPathId,
  AgreementVersionNumber,
  type AgreementVersion,
  ConfirmUploadRequest,
  CreateAgreementRequest,
  CreateAgreementUploadRequest,
  type DownloadLink,
  type FirmAgreementDetail,
  type FirmAgreementList,
  type FirmAgreementSummary,
  type IntakeAgreementBlock,
  IntakeAgreementsQuery,
  type UploadTicket,
  PublishAgreementVersionRequest,
} from '@firmivra/types';
import {
  AllowBusinessStatuses,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  Public,
  Roles,
} from '../auth/decorators.js';
import { poolSecrets } from '../auth/sealed.js';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { AgreementFilesService, AgreementUploadTokens } from './agreement-files.service.js';
import { AGREEMENTS_CONFIG, agreementsConfig, AgreementsService } from './agreements.service.js';

const idPipe = new ZodValidationPipe(AgreementPathId);
/** A version in the path: plain digits ("2", not "02" or "2e0"). */
const versionPipe = new ZodValidationPipe(
  z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform(Number)
    .pipe(AgreementVersionNumber),
);

/**
 * The firm's intake agreements (docs/api/agreements.yaml), Settings > Terms & Privacy.
 * Owner and Admin, also while the firm is Pending Setup; the firm comes from TenantGuard.
 */
@Controller('business/agreements')
@Roles(...FIRM_MANAGERS)
@AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')
export class AgreementsController {
  constructor(
    private readonly agreements: AgreementsService,
    private readonly files: AgreementFilesService,
  ) {}

  /** PDF originals, step 1 of 3 (docs/api/agreements.yaml). */
  @Post('files/uploads')
  createUpload(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateAgreementUploadRequest))
    body: z.output<typeof CreateAgreementUploadRequest>,
  ): Promise<UploadTicket> {
    return this.files.ticket(tenant.businessId, auth.userId, body);
  }

  /** Step 3 of 3: checks the stored PDF and starts the scan. */
  @Post('files/confirm')
  confirmUpload(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(ConfirmUploadRequest)) body: z.output<typeof ConfirmUploadRequest>,
  ): Promise<AgreementFile> {
    return this.files.confirm(tenant.businessId, auth.userId, body.uploadToken);
  }

  @Get('files/:fileId')
  file(
    @CurrentTenant() tenant: TenantContext,
    @Param('fileId', idPipe) fileId: string,
  ): Promise<AgreementFile> {
    return this.files.file(tenant.businessId, fileId);
  }

  @Get('files/:fileId/download')
  download(
    @CurrentTenant() tenant: TenantContext,
    @Param('fileId', idPipe) fileId: string,
  ): Promise<DownloadLink> {
    return this.files.download(tenant.businessId, fileId);
  }

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<FirmAgreementList> {
    return this.agreements.list(tenant.businessId);
  }

  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateAgreementRequest))
    body: z.output<typeof CreateAgreementRequest>,
  ): Promise<FirmAgreementSummary> {
    return this.agreements.create(tenant.businessId, auth.userId, body);
  }

  @Get(':agreementId')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('agreementId', idPipe) agreementId: string,
  ): Promise<FirmAgreementDetail> {
    return this.agreements.get(tenant.businessId, agreementId);
  }

  @Get(':agreementId/versions/:version')
  getVersion(
    @CurrentTenant() tenant: TenantContext,
    @Param('agreementId', idPipe) agreementId: string,
    @Param('version', versionPipe) version: number,
  ): Promise<AgreementVersion> {
    return this.agreements.getVersion(tenant.businessId, agreementId, version);
  }

  @Post(':agreementId/versions')
  publish(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('agreementId', idPipe) agreementId: string,
    @Body(new ZodValidationPipe(PublishAgreementVersionRequest))
    body: z.output<typeof PublishAgreementVersionRequest>,
  ): Promise<AgreementVersion> {
    return this.agreements.publish(tenant.businessId, auth.userId, agreementId, body);
  }

  @Post(':agreementId/archive')
  @HttpCode(200)
  archive(
    @CurrentTenant() tenant: TenantContext,
    @Param('agreementId', idPipe) agreementId: string,
  ): Promise<FirmAgreementSummary> {
    return this.agreements.archive(tenant.businessId, agreementId);
  }
}

/** GET /api/v1/portal/{firmSlug}/intake-agreements?form=: public, for Begin Online. */
@Controller('portal/:firmSlug/intake-agreements')
export class PublicAgreementsController {
  constructor(
    private readonly agreements: AgreementsService,
    private readonly files: AgreementFilesService,
  ) {}

  @Get()
  @Public()
  block(
    @Param('firmSlug') firmSlug: string,
    @Query(new ZodValidationPipe(IntakeAgreementsQuery))
    query: z.output<typeof IntakeAgreementsQuery>,
  ): Promise<IntakeAgreementBlock> {
    return this.agreements.intakeBlock(firmSlug, query.form);
  }

  /** The current version's PDF original, as a 5-minute attachment link. */
  @Get(':agreementId/versions/:version/pdf')
  @Public()
  pdf(
    @Param('firmSlug') firmSlug: string,
    @Param('agreementId', idPipe) agreementId: string,
    @Param('version', versionPipe) version: number,
  ): Promise<DownloadLink> {
    return this.files.publicDownload(firmSlug, agreementId, version);
  }
}

/**
 * GET /api/v1/portal/{firmSlug}/me/intakes/{intakeId}/agreements: the signed-in client's portal
 * intake. The client comes from the session, never the URL; another client's intake answers 404.
 */
@Controller('portal/:firmSlug/me/intakes')
@Roles('CLIENT')
export class MyIntakeAgreementsController {
  constructor(private readonly agreements: AgreementsService) {}

  @Get(':intakeId/agreements')
  block(
    @CurrentTenant() tenant: TenantContext,
    @Param('intakeId', idPipe) intakeId: string,
  ): Promise<IntakeAgreementBlock> {
    if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
    return this.agreements.myIntakeBlock(tenant.businessId, tenant.clientAccountId, intakeId);
  }
}

@Module({
  imports: [PortalInfoModule],
  controllers: [AgreementsController, PublicAgreementsController, MyIntakeAgreementsController],
  providers: [
    AgreementsService,
    AgreementFilesService,
    // The documents bucket and settings, as DocumentsModule builds them (that module exports none).
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
    {
      provide: AgreementUploadTokens,
      inject: [ENV],
      useFactory: (env: Env) => new AgreementUploadTokens(poolSecrets(env)),
    },
    { provide: AGREEMENTS_CONFIG, useFactory: () => agreementsConfig() },
  ],
  exports: [AgreementsService, AgreementFilesService],
})
export class AgreementsModule {}
