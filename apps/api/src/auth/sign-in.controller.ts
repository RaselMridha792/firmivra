import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { Body, Controller, HttpCode, Module, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  type AuthSite,
  ForgotPasswordRequest,
  MfaRequest,
  MfaSetupRequest,
  type MfaSetupResponse,
  type OkResponse,
  ResetPasswordRequest,
  SignInRequest,
  type SignInResult,
  SignOutRequest,
} from '@firmivra/types';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { MeModule } from '../me/me.controller.js';
import { MeService } from '../me/me.service.js';
import { ChallengeSessions } from './challenge-session.js';
import { Public } from './decorators.js';
import {
  CognitoIdentityProvider,
  cognitoPoolsFromEnv,
} from './identity/cognito-identity.provider.js';
import { IDENTITY_PROVIDER } from './identity/identity-provider.js';
import { LocalIdentityProvider } from './identity/local-identity.provider.js';
import { poolSecrets } from './sealed.js';
import { RefreshEnvelopes, SessionService } from './session.service.js';
import { type SignInOutcome, SignInService } from './sign-in.service.js';
import { TokenService } from './token.service.js';

/** Per client IP (the viewer's, see configure-app.ts). Step 7 adds per-email limits. */
const ATTEMPTS = { default: { limit: 10, ttl: 60_000 } };
const REFRESHES = { default: { limit: 30, ttl: 60_000 } };

/**
 * The firm and the Super Admin site have the same routes (docs/api/auth.yaml). @Public() sits on
 * each handler, never on the class, so a route added later is not public by accident.
 */
abstract class SignInRoutes {
  constructor(
    private readonly site: AuthSite,
    private readonly signIns: SignInService,
    private readonly sessions: SessionService,
    private readonly me: MeService,
  ) {}

  @Post('sign-in')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async signIn(
    @Body(new ZodValidationPipe(SignInRequest)) body: z.output<typeof SignInRequest>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignInResult> {
    return this.finish(res, await this.signIns.signIn(this.site, body.email, body.password));
  }

  @Post('mfa')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async mfa(
    @Body(new ZodValidationPipe(MfaRequest)) body: z.output<typeof MfaRequest>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignInResult> {
    return this.finish(res, await this.signIns.mfa(this.site, body.session, body.code));
  }

  @Post('mfa/setup')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  mfaSetup(
    @Body(new ZodValidationPipe(MfaSetupRequest)) body: z.output<typeof MfaSetupRequest>,
  ): Promise<MfaSetupResponse> {
    return this.signIns.startMfaSetup(this.site, body.session);
  }

  /** Public: the access cookie may have expired. Reads only the refresh cookie. */
  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle(REFRESHES)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OkResponse> {
    await this.sessions.refresh(req, res, this.site);
    return { ok: true };
  }

  @Post('sign-out')
  @Public()
  @HttpCode(200)
  async signOut(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OkResponse> {
    // Sign-out always succeeds; a body it cannot read only means "not everywhere".
    const parsed = SignOutRequest.optional().safeParse(body);
    const everywhere = parsed.success && parsed.data?.everywhere === true;
    await this.sessions.end(req, res, this.site, everywhere);
    return { ok: true };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordRequest))
    body: z.output<typeof ForgotPasswordRequest>,
  ): Promise<OkResponse> {
    await this.signIns.forgotPassword(this.site, body.email);
    return { ok: true };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordRequest)) body: z.output<typeof ResetPasswordRequest>,
  ): Promise<OkResponse> {
    await this.signIns.resetPassword(this.site, body.email, body.code, body.password);
    return { ok: true };
  }

  private async finish(res: Response, outcome: SignInOutcome): Promise<SignInResult> {
    if (outcome.kind === 'step') return outcome.result;
    await this.sessions.start(res, this.site, outcome);
    return { status: 'SIGNED_IN', me: await this.me.load(outcome.userId) };
  }
}

/** Firm site: /api/v1/auth/* (staff pool). */
@Controller('auth')
export class StaffSignInController extends SignInRoutes {
  constructor(signIns: SignInService, sessions: SessionService, me: MeService) {
    super('firm', signIns, sessions, me);
  }
}

/** Super Admin site: /api/v1/admin/auth/* (admins pool). */
@Controller('admin/auth')
export class AdminSignInController extends SignInRoutes {
  constructor(signIns: SignInService, sessions: SessionService, me: MeService) {
    super('admin', signIns, sessions, me);
  }
}

@Module({
  imports: [MeModule],
  controllers: [StaffSignInController, AdminSignInController],
  providers: [
    SignInService,
    SessionService,
    {
      provide: RefreshEnvelopes,
      inject: [ENV],
      useFactory: (env: Env) => new RefreshEnvelopes(poolSecrets(env)),
    },
    {
      provide: ChallengeSessions,
      inject: [ENV],
      useFactory: (env: Env) => ChallengeSessions.fromEnv(env),
    },
    {
      provide: IDENTITY_PROVIDER,
      inject: [ENV, TokenService],
      useFactory: (env: Env, tokens: TokenService) =>
        env.AUTH_MODE === 'local'
          ? new LocalIdentityProvider(tokens)
          : new CognitoIdentityProvider(
              new CognitoIdentityProviderClient({ region: env.COGNITO_REGION }),
              cognitoPoolsFromEnv(env),
            ),
    },
  ],
})
export class SignInModule {}
