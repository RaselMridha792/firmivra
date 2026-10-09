import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  SignerAcceptConsentBody,
  SignerAccessCodeBody,
  type SignerCodeSent,
  type SignerConsent,
  SignerSessionBody,
  type SignerState,
  SignerVerifyCodeBody,
} from '@firmivra/types';
import { Public } from '../../auth/decorators.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { EsignSignerService } from './signer.service.js';

/** Per viewer IP, like the sign-in routes; the per-recipient code limits are the repository's. */
const ATTEMPTS = { default: { limit: 10, ttl: 60_000 } };
const SENDS = { default: { limit: 5, ttl: 60_000 } };
type Out<S extends z.ZodType> = z.output<S>;

/** The signer pages' API (docs/api/esign.yaml), slice 1: public, the token then the cookie. */
@Controller('portal/:firmSlug/sign')
@Public()
export class EsignSignerController {
  constructor(@Inject(EsignSignerService) private readonly signer: EsignSignerService) {}

  @Post('session')
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  session(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(SignerSessionBody)) body: Out<typeof SignerSessionBody>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignerState> {
    return this.signer.open(slug, body.token, res);
  }

  @Get('state')
  async state(@Param('firmSlug') slug: string, @Req() req: Request): Promise<SignerState> {
    return this.signer.state(await this.signer.call(slug, req));
  }

  @Post('code/send')
  @HttpCode(200)
  @Throttle(SENDS)
  async sendCode(@Param('firmSlug') slug: string, @Req() req: Request): Promise<SignerCodeSent> {
    return this.signer.sendCode(await this.signer.call(slug, req, 'VERIFY_EMAIL'));
  }

  @Post('code/verify')
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async verifyCode(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(SignerVerifyCodeBody)) body: Out<typeof SignerVerifyCodeBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignerState> {
    const call = await this.signer.call(slug, req, 'VERIFY_EMAIL');
    return this.signer.verify(call, 'EMAIL', body.code, res);
  }

  @Post('access-code')
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async accessCode(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(SignerAccessCodeBody)) body: Out<typeof SignerAccessCodeBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignerState> {
    const call = await this.signer.call(slug, req, 'VERIFY_ACCESS_CODE');
    return this.signer.verify(call, 'ACCESS', body.code, res);
  }

  @Get('consent')
  async consent(@Param('firmSlug') slug: string, @Req() req: Request): Promise<SignerConsent> {
    return this.signer.consent(await this.signer.call(slug, req, 'CONSENT'));
  }

  @Post('consent')
  @HttpCode(200)
  async acceptConsent(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(SignerAcceptConsentBody)) body: Out<typeof SignerAcceptConsentBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignerState> {
    const call = await this.signer.call(slug, req, 'CONSENT');
    return this.signer.acceptConsent(call, body.versionId, res);
  }
}
