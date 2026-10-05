import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { Body, Controller, HttpCode, Inject, Module, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  type AuthSite,
  MfaRequest,
  MfaSetupRequest,
  type MfaSetupResponse,
  SignInRequest,
  type SignInResult,
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
import { type SignInOutcome, SignInService } from './sign-in.service.js';
import { setSessionCookies } from './site.js';
import { TokenService } from './token.service.js';

/** Per client IP (the viewer's, see configure-app.ts). Step 7 adds per-email limits. */
const ATTEMPTS = { default: { limit: 10, ttl: 60_000 } };

/** sign-in, mfa and mfa/setup; the same routes on the firm and the Super Admin site. */
abstract class SignInRoutes {
  constructor(
    private readonly site: AuthSite,
    private readonly signIns: SignInService,
    private readonly me: MeService,
    private readonly env: Env,
  ) {}

  @Post('sign-in')
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async signIn(
    @Body(new ZodValidationPipe(SignInRequest)) body: z.output<typeof SignInRequest>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignInResult> {
    return this.finish(res, await this.signIns.signIn(this.site, body.email, body.password));
  }

  @Post('mfa')
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  async mfa(
    @Body(new ZodValidationPipe(MfaRequest)) body: z.output<typeof MfaRequest>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignInResult> {
    return this.finish(res, await this.signIns.mfa(this.site, body.session, body.code));
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @Throttle(ATTEMPTS)
  mfaSetup(
    @Body(new ZodValidationPipe(MfaSetupRequest)) body: z.output<typeof MfaSetupRequest>,
  ): Promise<MfaSetupResponse> {
    return this.signIns.startMfaSetup(this.site, body.session);
  }

  private async finish(res: Response, outcome: SignInOutcome): Promise<SignInResult> {
    if (outcome.kind === 'step') return outcome.result;
    setSessionCookies(res, this.site, outcome.tokens, this.env.NODE_ENV === 'production');
    return { status: 'SIGNED_IN', me: await this.me.load(outcome.userId) };
  }
}

/** Firm site: /api/v1/auth/* (staff pool). */
@Controller('auth')
@Public()
export class StaffSignInController extends SignInRoutes {
  constructor(signIns: SignInService, me: MeService, @Inject(ENV) env: Env) {
    super('firm', signIns, me, env);
  }
}

/** Super Admin site: /api/v1/admin/auth/* (admins pool). */
@Controller('admin/auth')
@Public()
export class AdminSignInController extends SignInRoutes {
  constructor(signIns: SignInService, me: MeService, @Inject(ENV) env: Env) {
    super('admin', signIns, me, env);
  }
}

@Module({
  imports: [MeModule],
  controllers: [StaffSignInController, AdminSignInController],
  providers: [
    SignInService,
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
