import { Controller, Get, Inject, Logger, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  IntegrationsService,
  IntegrationStateTokens,
  STATE_COOKIE,
} from './integrations.service.js';

const CallbackQuery = z.object({
  state: z.string().min(1).max(4_000),
  code: z.string().min(1).max(4_000).optional(),
  error: z.string().max(200).optional(),
});

/**
 * The provider's redirect back (the OAuth callback). It is a browser navigation, so it answers a
 * redirect to the screen, never JSON, and it never puts the code, the state or an error text in
 * the address it sends the browser to. The state is sealed and expires; the connection is made
 * only when the nonce in it matches the HttpOnly cookie the connect request set in the same
 * browser, so a code from someone else's authorization cannot be pushed into this firm.
 */
@Controller('integrations')
export class IntegrationsCallbackController {
  private readonly logger = new Logger(IntegrationsCallbackController.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly integrations: IntegrationsService,
    private readonly states: IntegrationStateTokens,
  ) {}

  @Get('callback')
  @Public()
  async callback(
    @Query(new ZodValidationPipe(CallbackQuery)) q: z.output<typeof CallbackQuery>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const base = this.env.APP_BASE_URL.replace(/\/+$/, '');
    const cookieNonce = (req.cookies as Record<string, string | undefined> | undefined)?.[
      STATE_COOKIE
    ];
    res.clearCookie(STATE_COOKIE, { path: '/api/v1/integrations' });
    const opened = await this.states.open(q.state, 'STAFF').catch(() => null);
    const claim = opened?.value;
    if (!claim || !cookieNonce || cookieNonce !== claim.nonce) {
      res.redirect(302, `${base}/integrations?result=failed`);
      return;
    }
    const back = (result: 'connected' | 'failed') =>
      `${base}/integrations/${encodeURIComponent(claim.provider)}/setup?result=${result}`;
    if (q.error || !q.code) {
      res.redirect(302, back('failed'));
      return;
    }
    try {
      await this.integrations.complete(claim, q.code);
      res.redirect(302, back('connected'));
    } catch (error) {
      this.logger.warn(
        `Integration ${claim.provider}: authorization did not complete (${(error as Error).name})`,
      );
      res.redirect(302, back('failed'));
    }
  }
}
