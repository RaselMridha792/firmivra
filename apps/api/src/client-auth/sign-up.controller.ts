import { Body, Controller, Get, HttpCode, Module, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  ChangeEmailRequest,
  ChangePhoneRequest,
  ResendCodeRequest,
  SignUpRequest,
  type SignUpState,
  VerifyCodeRequest,
} from '@firmivra/types';
import { Public } from '../auth/decorators.js';
import { poolSecrets } from '../auth/sealed.js';
import { SignInModule } from '../auth/sign-in.controller.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { CLIENT_CODE_SENDER, LogClientCodeSender } from './client-code-sender.js';
import { PortalInfoModule } from './portal-info.controller.js';
import { SignUpSessions } from './sign-up-session.js';
import { SignUpService } from './sign-up.service.js';
import { VerificationCodesService } from './verification-codes.service.js';

/** Per viewer IP (see configure-app.ts). */
const ATTEMPTS = { default: { limit: 10, ttl: 60_000 } };

/** Client sign-up on a firm's portal (docs/api/client-auth.yaml), signed out. */
@Controller('portal/:firmSlug/auth/sign-up')
export class SignUpController {
  constructor(private readonly signUps: SignUpService) {}

  @Post()
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  signUp(
    @Param('firmSlug') firmSlug: string,
    @Body(new ZodValidationPipe(SignUpRequest)) body: z.output<typeof SignUpRequest>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignUpState> {
    return this.signUps.signUp(firmSlug, body, req, res);
  }

  @Get()
  @Public()
  state(@Param('firmSlug') firmSlug: string, @Req() req: Request): Promise<SignUpState> {
    return this.signUps.state(firmSlug, req);
  }

  @Post('verify-email')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  verifyEmail(
    @Param('firmSlug') firmSlug: string,
    @Body(new ZodValidationPipe(VerifyCodeRequest)) body: z.output<typeof VerifyCodeRequest>,
    @Req() req: Request,
  ): Promise<SignUpState> {
    return this.signUps.verifyEmail(firmSlug, body.code, req);
  }

  @Post('verify-phone')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  verifyPhone(
    @Param('firmSlug') firmSlug: string,
    @Body(new ZodValidationPipe(VerifyCodeRequest)) body: z.output<typeof VerifyCodeRequest>,
    @Req() req: Request,
  ): Promise<SignUpState> {
    return this.signUps.verifyPhone(firmSlug, body.code, req);
  }

  @Post('resend')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  resend(
    @Param('firmSlug') firmSlug: string,
    @Body(new ZodValidationPipe(ResendCodeRequest)) body: z.output<typeof ResendCodeRequest>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignUpState> {
    return this.signUps.resend(firmSlug, body.channel, req, res);
  }

  @Post('change-email')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  changeEmail(
    @Param('firmSlug') firmSlug: string,
    @Body(new ZodValidationPipe(ChangeEmailRequest)) body: z.output<typeof ChangeEmailRequest>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignUpState> {
    return this.signUps.changeEmail(firmSlug, body.email, req, res);
  }

  @Post('change-phone')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  changePhone(
    @Param('firmSlug') firmSlug: string,
    @Body(new ZodValidationPipe(ChangePhoneRequest)) body: z.output<typeof ChangePhoneRequest>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignUpState> {
    return this.signUps.changePhone(firmSlug, body.phone, req, res);
  }
}

@Module({
  imports: [SignInModule, PortalInfoModule],
  controllers: [SignUpController],
  providers: [
    SignUpService,
    VerificationCodesService,
    {
      provide: SignUpSessions,
      inject: [ENV],
      useFactory: (env: Env) => new SignUpSessions(poolSecrets(env)),
    },
    {
      provide: CLIENT_CODE_SENDER,
      inject: [ENV],
      useFactory: (env: Env) => new LogClientCodeSender(env.AUTH_MODE === 'local'),
    },
  ],
  // The firm's sign-ups queue (step 4) sends its notices through the same sender.
  exports: [CLIENT_CODE_SENDER],
})
export class SignUpModule {}
