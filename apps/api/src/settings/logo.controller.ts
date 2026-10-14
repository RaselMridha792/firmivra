import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Provider,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ConfirmLogoUploadRequest,
  CreateLogoUploadRequest,
  type FirmSettings,
  type UploadTicket,
} from '@firmivra/types';
import {
  AllowBusinessStatuses,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  Public,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { poolSecrets } from '../auth/sealed.js';
import { LogoService, LogoUploadTokens } from './logo.service.js';
import { SettingsService } from './settings.service.js';

/** The firm's logo: Owner and Admin, also while the firm is Pending Setup. */
@Controller('business/logo')
@Roles(...FIRM_MANAGERS)
@AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')
export class FirmLogoController {
  constructor(
    private readonly logo: LogoService,
    private readonly settings: SettingsService,
  ) {}

  @Post('uploads')
  ticket(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateLogoUploadRequest)) body: CreateLogoUploadRequest,
  ): Promise<UploadTicket> {
    return this.logo.ticket(tenant.businessId, auth.userId, body);
  }

  @Post('uploads/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(ConfirmLogoUploadRequest)) body: ConfirmLogoUploadRequest,
  ): Promise<FirmSettings> {
    await this.logo.confirm(tenant.businessId, auth.userId, body);
    return this.settings.get(tenant.businessId);
  }

  @Delete()
  async remove(@CurrentTenant() tenant: TenantContext): Promise<FirmSettings> {
    await this.logo.remove(tenant.businessId);
    return this.settings.get(tenant.businessId);
  }
}

/** Public like the portal's info (branding shows on the sign-in page); no logo is 404. */
@Controller('portal/:firmSlug/logo')
export class PortalLogoController {
  constructor(
    private readonly portal: PortalInfoService,
    private readonly logo: LogoService,
  ) {}

  @Get()
  @Public()
  // Helmet's default keeps other sites from embedding a response; this image is for them.
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'public, max-age=3600')
  async get(
    @Param('firmSlug') firmSlug: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const firm = await this.portal.activeFirm(firmSlug);
    const { bytes, contentType, version } = await this.logo.stored(firm.id);
    res.setHeader('ETag', `"${version}"`);
    return new StreamableFile(bytes, { type: contentType, length: bytes.byteLength });
  }
}

/** Added to SettingsModule: R5's storage as DraftUploadsService provides it, and the ticket seal. */
export const LOGO_PROVIDERS: Provider[] = [
  LogoService,
  { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
  {
    provide: DOCUMENT_STORAGE,
    inject: [DOCUMENTS_CONFIG],
    useFactory: (config: DocumentsConfig) =>
      new S3DocumentStorage(createS3Client(config), config.bucket),
  },
  {
    provide: LogoUploadTokens,
    inject: [ENV],
    useFactory: (env: Env) => new LogoUploadTokens(poolSecrets(env)),
  },
];
