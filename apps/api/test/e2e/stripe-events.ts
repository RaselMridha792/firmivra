// Signed Stripe test events for the webhook e2e tests (R7).
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Stripe from 'stripe';
import { TEST_WEBHOOK_SECRET } from './invoice-setup.js';

export const stripeEvent = (type: string, account: string | null, object: object) => ({
  id: `evt_${randomBytes(10).toString('hex')}`,
  object: 'event',
  type,
  account,
  api_version: '2026-09-30.endive',
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  pending_webhooks: 1,
  request: null,
  data: { object },
});

/** Posts the event to the webhook, signed with the test apps' secret. */
export const deliverEvent = (app: INestApplication, body: object) => {
  const payload = JSON.stringify(body);
  return request(app.getHttpServer())
    .post('/api/v1/webhooks/stripe')
    .set('content-type', 'application/json')
    .set(
      'stripe-signature',
      Stripe.webhooks.generateTestHeaderString({ payload, secret: TEST_WEBHOOK_SECRET }),
    )
    .send(payload);
};
