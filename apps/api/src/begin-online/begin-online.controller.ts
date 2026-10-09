import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  type BeginDraft,
  type BeginOnlineForm,
  type BeginOnlineServiceList,
  ConfirmUploadRequest,
  CreateDraftUploadRequest,
  type DraftSubmitted,
  type DraftUpload,
  ResumeDraftRequest,
  type ResumeLinkSent,
  SaveDraftStepRequest,
  type UploadTicket,
  StartDraftRequest,
  SubmitDraftRequest,
} from '@firmivra/types';
import { Public } from '../auth/decorators.js';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FieldEncryptionModule } from '../field-encryption/field-encryption.service.js';
import { BeginOnlineService } from './begin-online.service.js';
import { DRAFT_UPLOAD_PROVIDERS, DraftUploadsService } from './draft-uploads.service.js';
import { DraftSubmitService } from './draft-submit.service.js';
import { ResumeLinksService } from './resume-links.service.js';
import { INTAKE_SIGNING, type IntakeSigner, PLACEHOLDER_SIGNING } from './signing.js';
import { requestContext } from '../common/request-context.js';

/** Per viewer IP, in memory (see configure-app.ts): a new draft is the scarce one. */
export const BEGIN_ONLINE_THROTTLE = {
  start: { default: { limit: 5, ttl: 60_000 } },
  /** Autosave: one save every 2 seconds at most, within the public write limit. */
  save: { default: { limit: 30, ttl: 60_000 } },
  /** Emails: few per IP (the per-draft and per-firm limits are counted in the database). */
  resumeLink: { default: { limit: 5, ttl: 600_000 } },
  resume: { default: { limit: 10, ttl: 60_000 } },
  upload: { default: { limit: 30, ttl: 60_000 } },
  submit: { default: { limit: 5, ttl: 60_000 } },
};

/**
 * Begin Online on a firm's portal site (contract: packages/types/src/begin-online), signed out:
 * every route is public; the firm comes from the slug and the draft from its HttpOnly cookie.
 * Writes are JSON from the portal's own origin (crossSiteGuard) and rate limited per IP.
 */
@Controller('portal/:firmSlug/begin-online')
export class BeginOnlineController {
  constructor(
    private readonly beginOnline: BeginOnlineService,
    private readonly links: ResumeLinksService,
    private readonly uploads: DraftUploadsService,
    private readonly submits: DraftSubmitService,
    @Inject(INTAKE_SIGNING) private readonly signing: IntakeSigner,
  ) {}

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

  @Post('drafts/current/resume-link')
  @Public()
  @HttpCode(200)
  @Throttle(BEGIN_ONLINE_THROTTLE.resumeLink)
  resumeLink(
    @Param('firmSlug') slug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ResumeLinkSent> {
    return this.links.send(slug, req, res);
  }

  @Post('drafts/resume')
  @Public()
  @HttpCode(200)
  @Throttle(BEGIN_ONLINE_THROTTLE.resume)
  resume(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(ResumeDraftRequest)) body: z.output<typeof ResumeDraftRequest>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BeginDraft> {
    return this.links.resume(slug, body.token, res);
  }

  @Post('drafts/current/submit')
  @Public()
  @HttpCode(200)
  @Throttle(BEGIN_ONLINE_THROTTLE.submit)
  submit(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(SubmitDraftRequest)) body: z.output<typeof SubmitDraftRequest>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DraftSubmitted> {
    const context = requestContext.getStore();
    const signature = {
      ...body,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    };
    return this.submits.submit(slug, req, res, (tx, ids) => this.signing.sign(tx, ids, signature));
  }

  @Post('drafts/current/uploads')
  @Public()
  @HttpCode(200)
  @Throttle(BEGIN_ONLINE_THROTTLE.upload)
  createUpload(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(CreateDraftUploadRequest))
    body: z.output<typeof CreateDraftUploadRequest>,
    @Req() req: Request,
  ): Promise<UploadTicket> {
    return this.uploads.ticket(slug, req, body);
  }

  @Post('drafts/current/uploads/confirm')
  @Public()
  @HttpCode(200)
  @Throttle(BEGIN_ONLINE_THROTTLE.upload)
  confirmUpload(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(ConfirmUploadRequest)) body: z.output<typeof ConfirmUploadRequest>,
    @Req() req: Request,
  ): Promise<DraftUpload> {
    return this.uploads.confirm(slug, req, body.uploadToken);
  }

  @Delete('drafts/current/uploads/:id')
  @Public()
  @Throttle(BEGIN_ONLINE_THROTTLE.upload)
  deleteUpload(
    @Param('firmSlug') slug: string,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    return this.uploads.remove(slug, req, id);
  }
}

@Module({
  imports: [PortalInfoModule, FieldEncryptionModule],
  controllers: [BeginOnlineController],
  providers: [
    BeginOnlineService,
    ResumeLinksService,
    DraftUploadsService,
    DraftSubmitService,
    ...DRAFT_UPLOAD_PROVIDERS,
    // R14's intake signing service replaces this placeholder (see signing.ts).
    PLACEHOLDER_SIGNING,
  ],
})
export class BeginOnlineModule {}
