import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import {
  type ApplicationResponseRequestView,
  type ApplicationResponseSession,
  CreateApplicationResponseUploadRequest,
  OpenApplicationResponseRequest,
  SendApplicationResponseCodeRequest,
  type SendApplicationResponseCodeResponse,
  SubmitApplicationResponseRequest,
  type SubmitApplicationResponseResponse,
  type UploadPutTicket,
  VerifyApplicationResponseCodeRequest,
} from '@firmivra/types';
import { Public } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApplyRespondService } from './apply-respond.service.js';

/**
 * The applicant's answer to a request for more information (SA-APP-F04), on the firm site's
 * /apply/respond page: public, no session, JSON from the firm site's own origin (the cross-site
 * guard), each route held to a burst per IP; the per-request limits are in the service.
 */
@Controller('firm-applications/respond')
export class ApplyRespondController {
  constructor(private readonly respond: ApplyRespondService) {}

  @Post('open')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  open(
    @Body(new ZodValidationPipe(OpenApplicationResponseRequest))
    body: z.output<typeof OpenApplicationResponseRequest>,
  ): Promise<ApplicationResponseRequestView> {
    return this.respond.open(body.token);
  }

  @Post('code')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  code(
    @Body(new ZodValidationPipe(SendApplicationResponseCodeRequest))
    body: z.output<typeof SendApplicationResponseCodeRequest>,
  ): Promise<SendApplicationResponseCodeResponse> {
    return this.respond.sendCode(body.token);
  }

  @Post('verify')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(
    @Body(new ZodValidationPipe(VerifyApplicationResponseCodeRequest))
    body: z.output<typeof VerifyApplicationResponseCodeRequest>,
  ): Promise<ApplicationResponseSession> {
    return this.respond.verify(body.token, body.code);
  }

  @Post('uploads')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  upload(
    @Body(new ZodValidationPipe(CreateApplicationResponseUploadRequest))
    body: z.output<typeof CreateApplicationResponseUploadRequest>,
  ): Promise<UploadPutTicket> {
    return this.respond.ticket(body);
  }

  @Post()
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(
    @Body(new ZodValidationPipe(SubmitApplicationResponseRequest))
    body: z.output<typeof SubmitApplicationResponseRequest>,
  ): Promise<SubmitApplicationResponseResponse> {
    return this.respond.submit(body);
  }
}
