import { z } from 'zod';

/**
 * Stripe settings, read and checked by the Stripe module when the app starts.
 * STRIPE_SECRET_KEY (optional): the platform's secret or restricted key (Secrets Manager on AWS,
 * `.env` locally, never committed). Without it payments are off here: the setup, checkout and
 * refund routes answer 503 PAYMENT_PROVIDER_UNAVAILABLE.
 * STRIPE_MODE=fake (development and test only): an in-memory Stripe (`FakeStripeGateway`), for
 * working on payment screens without a key. `stripe` (the default) calls Stripe.
 */
const Schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
    STRIPE_MODE: z.enum(['stripe', 'fake']).default('stripe'),
    STRIPE_SECRET_KEY: z
      .string()
      .regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/, 'a Stripe secret (sk_) or restricted (rk_) key')
      .optional(),
  })
  .superRefine((env, ctx) => {
    const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
    if (env.STRIPE_MODE === 'fake' && !local) {
      ctx.addIssue({
        code: 'custom',
        path: ['STRIPE_MODE'],
        message: 'STRIPE_MODE=fake is only allowed when NODE_ENV is development or test',
      });
    }
  });

export type StripeConfig =
  | { mode: 'stripe'; secretKey: string }
  | { mode: 'fake' }
  /** No key: payments are not available in this environment. */
  | { mode: 'off' };

export function loadStripeConfig(
  raw: Record<string, string | undefined> = process.env,
): StripeConfig {
  // `KEY=` in .env arrives as an empty string; treat it as not set.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const result = Schema.safeParse(cleaned);
  if (!result.success) {
    // The message names the setting, never its value.
    throw new Error(`Invalid Stripe settings:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  if (env.STRIPE_MODE === 'fake') return { mode: 'fake' };
  return env.STRIPE_SECRET_KEY
    ? { mode: 'stripe', secretKey: env.STRIPE_SECRET_KEY }
    : { mode: 'off' };
}
