import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  SignerAcceptConsentBody,
  SignerAccessCodeBody,
  type SignerCodeSent,
  type SignerConsent,
  SignerAdoptBody,
  SignerDeclineBody,
  type SignerEnvelope,
  SignerFinishBody,
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

/** The signer pages' API (docs/api/esign.yaml): public, the token then the cookie. */
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

  @Post('session/end')
  @HttpCode(200)
  end(@Param('firmSlug') slug: string, @Res({ passthrough: true }) res: Response) {
    return this.signer.end(slug, res);
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

  @Get('envelope')
  async envelope(@Param('firmSlug') slug: string, @Req() req: Request): Promise<SignerEnvelope> {
    return this.signer.envelope(await this.signer.call(slug, req, 'SIGN'));
  }

  /** The bytes for the page viewer on the portal only: never cached, never framed elsewhere. */
  @Get('packet')
  @Header('Cache-Control', 'no-store')
  @Header('Cross-Origin-Resource-Policy', 'same-origin')
  @Header('Content-Disposition', 'attachment')
  async packet(@Param('firmSlug') slug: string, @Req() req: Request): Promise<StreamableFile> {
    const bytes = await this.signer.packet(await this.signer.call(slug, req, 'SIGN'));
    return new StreamableFile(bytes, { type: 'application/pdf', length: bytes.byteLength });
  }

  @Post('adopt')
  @HttpCode(200)
  async adopt(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(SignerAdoptBody)) body: Out<typeof SignerAdoptBody>,
    @Req() req: Request,
  ): Promise<SignerEnvelope> {
    return this.signer.adopt(await this.signer.call(slug, req, 'SIGN'), body);
  }

  @Post('finish')
  @HttpCode(200)
  async finish(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(SignerFinishBody)) body: Out<typeof SignerFinishBody>,
    @Req() req: Request,
  ): Promise<SignerState> {
    return this.signer.finish(await this.signer.call(slug, req, 'SIGN'), body.values);
  }

  @Post('decline')
  @HttpCode(200)
  async decline(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(SignerDeclineBody)) body: Out<typeof SignerDeclineBody>,
    @Req() req: Request,
  ): Promise<SignerState> {
    const call = await this.signer.call(slug, req, 'CONSENT', 'SIGN');
    return this.signer.decline(call, body.reason ?? null);
  }
}
