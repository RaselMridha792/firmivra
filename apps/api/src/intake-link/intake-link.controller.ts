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
  ConfirmUploadRequest,
  CreateIntakeUploadRequest,
  type IntakeAgreementBlock,
  IntakeKey,
  type IntakeUpload,
  type LinkIntake,
  type OkResponse,
  type UploadTicket,
  OpenIntakeLinkRequest,
  type SavedIntakeStep,
  SaveIntakeStepRequest,
  SubmitIntakeRequest,
} from '@firmivra/types';
import { AgreementsModule } from '../agreements/agreements.controller.js';
import { Public } from '../auth/decorators.js';
import { poolSecrets } from '../auth/sealed.js';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import { networkOf } from '../common/network.js';
import { requestContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { FieldEncryptionModule } from '../field-encryption/field-encryption.service.js';
import { INTAKE_SIGNING, type IntakeSigner } from '../intake/intake-signing.js';
import { IntakesModule } from '../intake/intakes.controller.js';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { IntakeLinkCookies } from './intake-link-cookies.js';
import { IntakeLinkService } from './intake-link.service.js';
import { LINK_UPLOAD_PROVIDERS, LinkUploadsService } from './link-uploads.service.js';

/** An opening viewer's network (networkOf: /24 or /48), as Begin Online's resume link counts. */
const byNetwork = (req: Record<string, unknown>) =>
  networkOf(typeof req['ip'] === 'string' ? req['ip'] : undefined);

/** Per viewer, in memory (see configure-app.ts), as Begin Online's routes are limited. */
export const INTAKE_LINK_THROTTLE = {
  open: { default: { limit: 10, ttl: 60_000, getTracker: byNetwork } },
  save: { default: { limit: 30, ttl: 60_000 } },
  submit: { default: { limit: 5, ttl: 60_000 } },
  upload: { default: { limit: 30, ttl: 60_000 } },
};

/**
 * A lead's secure intake link on the firm's portal site, signed out (contract:
 * packages/types/src/intake/link.ts, `api.intakeLink(slug)`). Every route is public: the firm
 * comes from the slug, the intake from the link's token (`open`) and then this browser's HttpOnly
 * cookie. Writes are JSON from the portal's own origin (crossSiteGuard) and rate limited.
 */
@Controller('portal/:firmSlug/intake-link')
export class IntakeLinkController {
  constructor(
    private readonly links: IntakeLinkService,
    private readonly uploads: LinkUploadsService,
    @Inject(INTAKE_SIGNING) private readonly signing: IntakeSigner,
  ) {}

  /** `open(token)` */
  @Post('open')
  @Public()
  @HttpCode(200)
  @Throttle(INTAKE_LINK_THROTTLE.open)
  open(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(OpenIntakeLinkRequest))
    body: z.output<typeof OpenIntakeLinkRequest>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LinkIntake> {
    return this.links.open(slug, body.token, res);
  }

  /** `get()` */
  @Get()
  @Public()
  get(@Param('firmSlug') slug: string, @Req() req: Request): Promise<LinkIntake> {
    return this.links.get(slug, req);
  }

  /** `agreements()` */
  @Get('agreements')
  @Public()
  agreements(@Param('firmSlug') slug: string, @Req() req: Request): Promise<IntakeAgreementBlock> {
    return this.links.agreements(slug, req);
  }

  /** `saveStep(step, body)` */
  @Put('steps/:step')
  @Public()
  @Throttle(INTAKE_LINK_THROTTLE.save)
  saveStep(
    @Param('firmSlug') slug: string,
    @Param('step', new ZodValidationPipe(IntakeKey)) step: string,
    @Body(new ZodValidationPipe(SaveIntakeStepRequest))
    body: z.output<typeof SaveIntakeStepRequest>,
    @Req() req: Request,
  ): Promise<SavedIntakeStep> {
    return this.links.saveStep(slug, req, step, body.answers);
  }

  /** `submit(body)` */
  @Post('submit')
  @Public()
  @HttpCode(200)
  @Throttle(INTAKE_LINK_THROTTLE.submit)
  submit(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(SubmitIntakeRequest)) body: z.output<typeof SubmitIntakeRequest>,
    @Req() req: Request,
  ): Promise<LinkIntake> {
    const context = requestContext.getStore();
    return this.links.submit(slug, req, body, this.signing, {
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    });
  }

  /** `createUpload(body)`: a ticket for an upload field of the link's open form (Leads item n). */
  @Post('uploads')
  @Public()
  @HttpCode(200)
  @Throttle(INTAKE_LINK_THROTTLE.upload)
  createUpload(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(CreateIntakeUploadRequest))
    body: z.output<typeof CreateIntakeUploadRequest>,
    @Req() req: Request,
  ): Promise<UploadTicket> {
    return this.uploads.ticket(slug, req, body);
  }

  /** `confirmUpload(body)` */
  @Post('uploads/confirm')
  @Public()
  @HttpCode(200)
  @Throttle(INTAKE_LINK_THROTTLE.upload)
  confirmUpload(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(ConfirmUploadRequest)) body: z.output<typeof ConfirmUploadRequest>,
    @Req() req: Request,
  ): Promise<IntakeUpload> {
    return this.uploads.confirm(slug, req, body.uploadToken);
  }

  /** `removeUpload(uploadId)`: only a file of this browser's link intake, while it is open. */
  @Delete('uploads/:uploadId')
  @Public()
  @Throttle(INTAKE_LINK_THROTTLE.upload)
  removeUpload(
    @Param('firmSlug') slug: string,
    @Param('uploadId') id: string,
    @Req() req: Request,
  ): Promise<OkResponse> {
    return this.uploads.remove(slug, req, id);
  }
}

@Module({
  imports: [
    PortalInfoModule,
    FieldEncryptionModule,
    IntakesModule,
    AgreementsModule,
    NotificationsModule,
  ],
  controllers: [IntakeLinkController],
  providers: [
    IntakeLinkService,
    LinkUploadsService,
    ...LINK_UPLOAD_PROVIDERS,
    {
      provide: IntakeLinkCookies,
      inject: [ENV],
      useFactory: (env: Env) => new IntakeLinkCookies(poolSecrets(env)),
    },
  ],
})
export class IntakeLinkModule {}
