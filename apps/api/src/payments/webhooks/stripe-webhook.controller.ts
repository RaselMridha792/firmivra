import { Controller, Headers, HttpCode, Module, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../auth/decorators.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { StripeWebhookService } from './stripe-webhook.service.js';

/**
 * POST /api/v1/webhooks/stripe: Stripe only, no session. The signature is checked on the raw body
 * (main.ts creates the app with `rawBody: true`); a bad or old one is 400 and nothing is recorded.
 * Everything verified is answered 200, including events Firmivra ignores. The per-IP limit does
 * not apply: Stripe sends from a few addresses in bursts, and the signature is the gate.
 */
@Controller('webhooks/stripe')
@Public()
@SkipThrottle()
export class StripeWebhookController {
  constructor(private readonly webhook: StripeWebhookService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const event = this.webhook.verify(req.rawBody, signature);
    await this.webhook.handle(event);
    return { received: true };
  }
}

@Module({
  imports: [InvoicesModule],
  controllers: [StripeWebhookController],
  providers: [StripeWebhookService],
})
export class StripeWebhookModule {}
