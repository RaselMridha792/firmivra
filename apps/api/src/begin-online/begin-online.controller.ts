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
  type BeginOnlineFormItem,
  type BeginReceived,
  type BeginSubmitted,
  ConfirmUploadRequest,
  CreateIntakeUploadRequest,
  EmailResumeLinkRequest,
  type IntakeUpload,
  type OkResponse,
  ResumeBeginDraftRequest,
  type SavedIntakeStep,
  SaveIntakeStepRequest,
  StartBeginDraftRequest,
  SubmitIntakeRequest,
  type UploadTicket,
} from '@firmivra/types';
import { Public } from '../auth/decorators.js';
import { poolSecrets } from '../auth/sealed.js';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import { requestContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { FieldEncryptionModule } from '../field-encryption/field-encryption.service.js';
import { INTAKE_SIGNING, type IntakeSigner } from '../intake/intake-signing.js';
import { IntakesModule } from '../intake/intakes.controller.js';
import { BeginOnlineSweep } from './begin-online-sweep.js';
import { BeginOnlineService } from './begin-online.service.js';
import { DraftSubmitService } from './draft-submit.service.js';
import { DRAFT_UPLOAD_PROVIDERS, DraftUploadsService } from './draft-uploads.service.js';
import { DraftCookies } from './drafts.js';
import { ResumeLinksService } from './resume-links.service.js';

/** Per viewer IP, in memory (see configure-app.ts): a new draft is the scarce one. */
export const BEGIN_ONLINE_THROTTLE = {
  start: { default: { limit: 5, ttl: 60_000 } },
  /** Autosave: one save every 2 seconds at most, within the public write limit. */
  save: { default: { limit: 30, ttl: 60_000 } },
  /** Emails: few per IP (the per-address and per-firm limits are counted in the database). */
  resumeLink: { default: { limit: 5, ttl: 600_000 } },
  resume: { default: { limit: 10, ttl: 60_000 } },
  upload: { default: { limit: 30, ttl: 60_000 } },
  submit: { default: { limit: 5, ttl: 60_000 } },
};

/**
 * Begin Online on a firm's portal site, signed out (contract B: packages/types/src/begin-online,
 * `api.beginOnline(slug)`). Every route is public; the firm comes from the slug, the service from
 * its page path (`annual-tax`...) and the draft from this browser's HttpOnly cookie for that
 * service. Writes are JSON from the portal's own origin (crossSiteGuard) and rate limited per IP.
 */
@Controller('portal/:firmSlug/begin')
export class BeginOnlineController {
  constructor(
    private readonly beginOnline: BeginOnlineService,
    private readonly links: ResumeLinksService,
    private readonly uploads: DraftUploadsService,
    private readonly submits: DraftSubmitService,
    @Inject(INTAKE_SIGNING) private readonly signing: IntakeSigner,
  ) {}

  /** `forms()` */
  @Get('forms')
  @Public()
  async forms(@Param('firmSlug') slug: string): Promise<{ items: BeginOnlineFormItem[] }> {
    return { items: await this.beginOnline.forms(slug) };
  }

  /** `form(form)` */
  @Get('forms/:formPath')
  @Public()
  form(@Param('firmSlug') slug: string, @Param('formPath') path: string): Promise<BeginOnlineForm> {
    return this.beginOnline.form(slug, path);
  }

  /** `start(form, body)` */
  @Post(':formPath/draft')
  @Public()
  @Throttle(BEGIN_ONLINE_THROTTLE.start)
  start(
    @Param('firmSlug') slug: string,
    @Param('formPath') path: string,
    @Body(new ZodValidationPipe(StartBeginDraftRequest))
    body: z.output<typeof StartBeginDraftRequest>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BeginDraft> {
    return this.beginOnline.start(slug, path, body, res);
  }

  /** `get(form)` */
  @Get(':formPath/draft')
  @Public()
  get(
    @Param('firmSlug') slug: string,
    @Param('formPath') path: string,
    @Req() req: Request,
  ): Promise<BeginDraft> {
    return this.beginOnline.get(slug, path, req);
  }

  /** `saveStep(form, step, body)` */
  @Put(':formPath/draft/steps/:step')
  @Public()
  @Throttle(BEGIN_ONLINE_THROTTLE.save)
  saveStep(
    @Param('firmSlug') slug: string,
    @Param('formPath') path: string,
    @Param('step') step: string,
    @Body(new ZodValidationPipe(SaveIntakeStepRequest))
    body: z.output<typeof SaveIntakeStepRequest>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SavedIntakeStep> {
    return this.beginOnline.saveStep(slug, path, step, body.answers, req, res);
  }

  /** `emailResumeLink(body)` */
  @Post('resume-link')
  @Public()
  @HttpCode(200)
  @Throttle(BEGIN_ONLINE_THROTTLE.resumeLink)
  resumeLink(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(EmailResumeLinkRequest))
    body: z.output<typeof EmailResumeLinkRequest>,
  ): Promise<BeginReceived> {
    return this.links.emailLinks(slug, body.email);
  }

  /** `resume(body)` */
  @Post('resume')
  @Public()
  @HttpCode(200)
  @Throttle(BEGIN_ONLINE_THROTTLE.resume)
  resume(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(ResumeBeginDraftRequest))
    body: z.output<typeof ResumeBeginDraftRequest>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BeginDraft> {
    return this.links.resume(slug, body.token, res);
  }

  /** `uploads(form)` */
  @Get(':formPath/draft/uploads')
  @Public()
  async listUploads(
    @Param('firmSlug') slug: string,
    @Param('formPath') path: string,
    @Req() req: Request,
  ): Promise<{ items: IntakeUpload[] }> {
    return { items: await this.uploads.list(slug, path, req) };
  }

  /** `createUpload(form, body)` */
  @Post(':formPath/draft/uploads')
  @Public()
  @HttpCode(200)
  @Throttle(BEGIN_ONLINE_THROTTLE.upload)
  createUpload(
    @Param('firmSlug') slug: string,
    @Param('formPath') path: string,
    @Body(new ZodValidationPipe(CreateIntakeUploadRequest))
    body: z.output<typeof CreateIntakeUploadRequest>,
    @Req() req: Request,
  ): Promise<UploadTicket> {
    return this.uploads.ticket(slug, path, req, body);
  }

  /** `confirmUpload(form, body)` */
  @Post(':formPath/draft/uploads/confirm')
  @Public()
  @HttpCode(200)
  @Throttle(BEGIN_ONLINE_THROTTLE.upload)
  confirmUpload(
    @Param('firmSlug') slug: string,
    @Param('formPath') path: string,
    @Body(new ZodValidationPipe(ConfirmUploadRequest)) body: z.output<typeof ConfirmUploadRequest>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IntakeUpload> {
    return this.uploads.confirm(slug, path, req, res, body.uploadToken);
  }

  /** `removeUpload(form, uploadId)` */
  @Delete(':formPath/draft/uploads/:uploadId')
  @Public()
  @Throttle(BEGIN_ONLINE_THROTTLE.upload)
  removeUpload(
    @Param('firmSlug') slug: string,
    @Param('formPath') path: string,
    @Param('uploadId') id: string,
    @Req() req: Request,
  ): Promise<OkResponse> {
    return this.uploads.remove(slug, path, req, id);
  }

  /** `submit(form, body)` */
  @Post(':formPath/draft/submit')
  @Public()
  @HttpCode(200)
  @Throttle(BEGIN_ONLINE_THROTTLE.submit)
  submit(
    @Param('firmSlug') slug: string,
    @Param('formPath') path: string,
    @Body(new ZodValidationPipe(SubmitIntakeRequest)) body: z.output<typeof SubmitIntakeRequest>,
    @Req() req: Request,
  ): Promise<BeginSubmitted> {
    const context = requestContext.getStore();
    return this.submits.submit(slug, path, req, body, this.signing, {
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    });
  }
}

@Module({
  imports: [PortalInfoModule, FieldEncryptionModule, IntakesModule],
  controllers: [BeginOnlineController],
  providers: [
    BeginOnlineService,
    BeginOnlineSweep,
    ResumeLinksService,
    DraftUploadsService,
    DraftSubmitService,
    ...DRAFT_UPLOAD_PROVIDERS,
    {
      provide: DraftCookies,
      inject: [ENV],
      useFactory: (env: Env) => new DraftCookies(poolSecrets(env)),
    },
  ],
})
export class BeginOnlineModule {}
