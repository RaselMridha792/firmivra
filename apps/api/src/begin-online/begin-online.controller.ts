import { Body, Controller, Get, Module, Param, Post, Put, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  type BeginDraft,
  type BeginOnlineForm,
  type BeginOnlineServiceList,
  SaveDraftStepRequest,
  StartDraftRequest,
} from '@firmivra/types';
import { Public } from '../auth/decorators.js';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FieldEncryptionModule } from '../field-encryption/field-encryption.service.js';
import { BeginOnlineService } from './begin-online.service.js';

/** Per viewer IP, in memory (see configure-app.ts): a new draft is the scarce one. */
export const BEGIN_ONLINE_THROTTLE = {
  start: { default: { limit: 5, ttl: 60_000 } },
  save: { default: { limit: 60, ttl: 60_000 } },
};

/**
 * Begin Online on a firm's portal site (contract: packages/types/src/begin-online), signed out:
 * every route is public; the firm comes from the slug and the draft from its HttpOnly cookie.
 * Writes are JSON from the portal's own origin (crossSiteGuard) and rate limited per IP.
 */
@Controller('portal/:firmSlug/begin-online')
export class BeginOnlineController {
  constructor(private readonly beginOnline: BeginOnlineService) {}

  @Get('services')
  @Public()
  async services(@Param('firmSlug') slug: string): Promise<BeginOnlineServiceList> {
    return { items: await this.beginOnline.services(slug) };
  }

  @Get('services/:serviceId/form')
  @Public()
  form(
    @Param('firmSlug') slug: string,
    @Param('serviceId') serviceId: string,
  ): Promise<BeginOnlineForm> {
    return this.beginOnline.form(slug, serviceId);
  }

  @Post('drafts')
  @Public()
  @Throttle(BEGIN_ONLINE_THROTTLE.start)
  start(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(StartDraftRequest)) body: z.output<typeof StartDraftRequest>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BeginDraft> {
    return this.beginOnline.start(slug, body, res);
  }

  @Get('drafts/current')
  @Public()
  current(@Param('firmSlug') slug: string, @Req() req: Request): Promise<BeginDraft> {
    return this.beginOnline.current(slug, req);
  }

  @Put('drafts/current/steps/:stepKey')
  @Public()
  @Throttle(BEGIN_ONLINE_THROTTLE.save)
  saveStep(
    @Param('firmSlug') slug: string,
    @Param('stepKey') stepKey: string,
    @Body(new ZodValidationPipe(SaveDraftStepRequest)) body: z.output<typeof SaveDraftStepRequest>,
    @Req() req: Request,
  ): Promise<BeginDraft> {
    return this.beginOnline.saveStep(slug, stepKey, body.answers, req);
  }
}

@Module({
  imports: [PortalInfoModule, FieldEncryptionModule],
  controllers: [BeginOnlineController],
  providers: [BeginOnlineService],
})
export class BeginOnlineModule {}
