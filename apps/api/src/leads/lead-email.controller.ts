import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  StreamableFile,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  ConfirmEmailImageUploadRequest,
  CreateEmailImageUploadRequest,
  type EmailImage,
  type MessageSignature,
  SaveMessageSignatureRequest,
  type UploadPutTicket,
} from '@firmivra/types';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_STAFF,
  Public,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LeadEmailService } from './lead-email.service.js';

type Out<S extends z.ZodType> = z.output<S>;

/**
 * Inline images for a lead email (L4, leads/email.ts): the ticket and the confirm. Listed before
 * LeadsController in LeadsModule, so `messages/images` is never read as a lead's id.
 */
@Controller('business/leads/messages/images')
@Access('LEADS')
@Roles(...FIRM_STAFF)
export class LeadEmailImagesController {
  constructor(private readonly email: LeadEmailService) {}

  @Post()
  ticket(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateEmailImageUploadRequest))
    body: Out<typeof CreateEmailImageUploadRequest>,
  ): Promise<UploadPutTicket> {
    return this.email.imageTicket(tenant.businessId, auth.userId, body);
  }

  @Post('confirm')
  @HttpCode(200)
  confirm(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ConfirmEmailImageUploadRequest))
    body: Out<typeof ConfirmEmailImageUploadRequest>,
  ): Promise<EmailImage> {
    return this.email.confirmImage(tenant.businessId, auth.userId, body);
  }
}

/** The signed-in member's own email signature (message_signatures): any firm member. */
@Controller('business/me/message-signature')
@Roles(...FIRM_STAFF)
export class MessageSignatureController {
  constructor(private readonly email: LeadEmailService) {}

  @Get()
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<MessageSignature> {
    return this.email.signature(tenant.businessId, auth.userId);
  }

  @Put()
  save(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveMessageSignatureRequest))
    body: Out<typeof SaveMessageSignatureRequest>,
  ): Promise<MessageSignature> {
    return this.email.saveSignature(tenant.businessId, auth.userId, body);
  }
}

/**
 * An email image's public address (`{id}.{png|jpg|gif}`), as the brand logo's: an active firm's,
 * for any mail client. The id is random and the file never changes, so it is cached for a year.
 */
@Controller('portal/:firmSlug/email-images')
export class PortalEmailImagesController {
  constructor(private readonly email: LeadEmailService) {}

  @Get(':file')
  @Public()
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async get(
    @Param('firmSlug') firmSlug: string,
    @Param('file') file: string,
  ): Promise<StreamableFile> {
    const { bytes, contentType } = await this.email.publicImage(firmSlug, file);
    return new StreamableFile(bytes, { type: contentType, length: bytes.byteLength });
  }
}
