import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Provider,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  BrandAssetKind,
  type BrandingSettings,
  ConfirmBrandAssetUploadRequest,
  CreateBrandAssetUploadRequest,
  ResetBrandingRequest,
  UpdateBrandingRequest,
  type UploadTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Public, Roles } from '../auth/decorators.js';
import { poolSecrets } from '../auth/sealed.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { notFound } from '../storage/document-records.js';
import { BrandAssetsService, BrandAssetTokens, brandAssetOfPath } from './brand-assets.service.js';
import { BrandingService } from './branding.service.js';

type Out<S extends z.ZodType> = z.output<S>;

/** Company Profile & Branding (R42 contract, `api.branding`). Owner and Admin. */
@Controller('business/branding')
@Roles(...FIRM_MANAGERS)
export class BrandingController {
  constructor(
    private readonly branding: BrandingService,
    private readonly assets: BrandAssetsService,
  ) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext): Promise<BrandingSettings> {
    return this.branding.get(tenant.businessId);
  }

  @Patch()
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(UpdateBrandingRequest)) body: Out<typeof UpdateBrandingRequest>,
  ): Promise<BrandingSettings> {
    return this.branding.update(tenant.businessId, auth.userId, body);
  }

  @Post('assets/uploads')
  ticket(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateBrandAssetUploadRequest))
    body: Out<typeof CreateBrandAssetUploadRequest>,
  ): Promise<UploadTicket> {
    return this.assets.ticket(tenant.businessId, auth.userId, body);
  }

  @Post('assets/uploads/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(ConfirmBrandAssetUploadRequest))
    body: Out<typeof ConfirmBrandAssetUploadRequest>,
  ): Promise<BrandingSettings> {
    await this.assets.confirm(tenant.businessId, auth.userId, body);
    return this.branding.get(tenant.businessId);
  }

  @Delete('assets/:kind')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('kind', new ZodValidationPipe(BrandAssetKind)) kind: BrandAssetKind,
  ): Promise<BrandingSettings> {
    await this.assets.remove(tenant.businessId, auth.userId, kind);
    return this.branding.get(tenant.businessId);
  }

  @Post('reset')
  @HttpCode(200)
  reset(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(ResetBrandingRequest)) body: Out<typeof ResetBrandingRequest>,
  ): Promise<BrandingSettings> {
    return this.branding.reset(tenant.businessId, auth.userId, body);
  }
}

/**
 * The brand images' public addresses (the favicon and login background show before sign-in, the
 * email logo in emails): like the logo, public for an active firm; none is 404.
 */
@Controller('portal/:firmSlug/branding')
export class PortalBrandingController {
  constructor(
    private readonly portal: PortalInfoService,
    private readonly assets: BrandAssetsService,
  ) {}

  @Get(':asset')
  @Public()
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'public, max-age=3600')
  async get(
    @Param('firmSlug') firmSlug: string,
    @Param('asset') asset: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const kind = brandAssetOfPath(asset);
    if (!kind) throw notFound();
    const firm = await this.portal.activeFirm(firmSlug);
    const { bytes, contentType, version } = await this.assets.stored(firm.id, kind);
    res.setHeader('ETag', `"${version}"`);
    return new StreamableFile(bytes, { type: contentType, length: bytes.byteLength });
  }
}

/** Added to SettingsModule (the documents storage comes with LOGO_PROVIDERS). */
export const BRANDING_PROVIDERS: Provider[] = [
  BrandingService,
  BrandAssetsService,
  {
    provide: BrandAssetTokens,
    inject: [ENV],
    useFactory: (env: Env) => new BrandAssetTokens(poolSecrets(env)),
  },
];
