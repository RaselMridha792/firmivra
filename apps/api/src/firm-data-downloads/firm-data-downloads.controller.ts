import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { Response } from 'express';
import { FirmId } from '@firmivra/types';
import { Public, Roles } from '../auth/decorators.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FirmDataDownloadsService } from './firm-data-downloads.service.js';

const Token = z
  .string()
  .min(40)
  .max(60)
  .regex(/^[A-Za-z0-9_-]+$/);
const CodeRequest = z.object({ code: z.string().length(6) });
const GrantRequest = z.object({ reason: z.string().trim().min(1).max(1000) });
const RevokeRequest = z.object({ reason: z.string().trim().min(1).max(1000) });
const FileId = z.uuid();
const bearer = (value?: string) => (value?.startsWith('Bearer ') ? value.slice(7) : '');
const linkToken = (headers: Record<string, string | string[] | undefined>) =>
  Token.parse(
    Array.isArray(headers['x-download-link'])
      ? headers['x-download-link'][0]
      : headers['x-download-link'],
  );

@Controller('admin/firms/:businessId/download-access')
@Roles('SUPER_ADMIN')
export class AdminFirmDataDownloadsController {
  constructor(
    private readonly downloads: FirmDataDownloadsService,
    private readonly admin: AdminPrisma,
  ) {}

  @Get()
  list(@Param('businessId', new ZodValidationPipe(FirmId)) businessId: string) {
    return this.downloads.adminList(businessId);
  }

  @Post()
  @HttpCode(200)
  grant(
    @Param('businessId', new ZodValidationPipe(FirmId)) businessId: string,
    @Body(new ZodValidationPipe(GrantRequest)) body: z.output<typeof GrantRequest>,
  ) {
    return this.downloads.createGrant(businessId, 'REQUESTED', this.admin.adminUserId, body.reason);
  }

  @Post(':grantId/revoke')
  @HttpCode(200)
  revoke(
    @Param('businessId', new ZodValidationPipe(FirmId)) businessId: string,
    @Param('grantId', new ZodValidationPipe(z.uuid())) grantId: string,
    @Body(new ZodValidationPipe(RevokeRequest)) body: z.output<typeof RevokeRequest>,
  ) {
    return this.downloads.revoke(businessId, grantId, this.admin.adminUserId, body.reason);
  }
}

/** Public endpoints carry only an unguessable link token, then a short-lived verified session. */
@Controller('closed-firm-download')
export class ClosedFirmDownloadController {
  constructor(private readonly downloads: FirmDataDownloadsService) {}

  @Post('request-code')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  requestCode(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.downloads.sendCode(linkToken(headers));
  }

  @Post('verify-code')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyCode(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(CodeRequest)) body: z.output<typeof CodeRequest>,
  ) {
    return this.downloads.verifyCode(linkToken(headers), body.code);
  }

  @Get('clients')
  @Public()
  clients(@Headers('authorization') authorization?: string) {
    return this.downloads.clients(bearer(authorization));
  }

  @Get('files')
  @Public()
  files(@Headers('authorization') authorization?: string) {
    return this.downloads.files(bearer(authorization));
  }

  @Post('files/:fileId/link')
  @Public()
  @HttpCode(200)
  fileLink(
    @Param('fileId', new ZodValidationPipe(FileId)) fileId: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.downloads.fileLink(bearer(authorization), fileId);
  }

  @Get('clients.csv')
  @Public()
  async clientsCsv(
    @Headers('authorization') authorization: string | undefined,
    @Res() response: Response,
  ) {
    const file = await this.downloads.clientsCsv(bearer(authorization));
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="clients.csv"');
    response.setHeader('Content-Length', String(file.bytes));
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(file.content);
  }
}
