import Stripe from 'stripe';

/**
 * What Firmivra asks of Stripe, as a narrow port: the real SDK behind `createStripeGateway`, an
 * in-memory one in `FakeStripeGateway` (tests, and STRIPE_MODE=fake). Inject it with
 * `@Inject(STRIPE_GATEWAY) stripe: StripeGateway | null`; null means no Stripe in this
 * environment (answer 503 PAYMENT_PROVIDER_UNAVAILABLE). Every method rejects when Stripe does not
 * answer or refuses; callers turn that into 503 and log only `stripeErrorName(error)`.
 */
export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');

/** The Stripe API version every call uses. Change it only together with the code that reads answers. */
export const STRIPE_API_VERSION = '2026-09-30.endive';
/**
 * Each call to Stripe gives up after this long, with no retry by the SDK: calls that hold an
 * invoice's row (Pay Now, cancel) make at most three of them inside a transaction capped at 30 s.
 * A retry is the caller's: an account or refund create carries a key that repeats across the
 * client's retries; a Checkout Session's key is new each attempt, and one left behind by a failed
 * attempt is expired (see CheckoutService), never paid.
 */
export const STRIPE_TIMEOUT_MS = 8_000;

/** The fields of a connected account that Firmivra keeps (see `toOnboardingState`). */
export interface ConnectedAccount {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements?: {
    currently_due?: string[] | null;
    past_due?: string[] | null;
    disabled_reason?: string | null;
  } | null;
}

export interface CreateAccountParams {
  businessId: string;
  /** Two-letter country of the firm. */
  country: string;
  /** The firm's contact email, prefilled on Stripe's form. */
  email: string | null;
}

export interface AccountLinkParams {
  accountId: string;
  returnUrl: string;
  refreshUrl: string;
}

export interface OnboardingLink {
  url: string;
  expiresAt: Date;
}

export interface CheckoutParams {
  /** The firm's connected account; the session runs on it (the Stripe-Account header). */
  accountId: string;
  invoiceId: string;
  paymentId: string;
  /** The line's name: the invoice number. */
  description: string;
  amountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

/** The fields of a Checkout Session Firmivra reads. */
export interface CheckoutSession {
  id: string;
  /** Null once the session is complete or expired. */
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  amountTotal: number;
  expiresAt: Date;
}

export interface StripeGateway {
  /** A Standard connected account. The same idempotency key answers the same account again. */
  createAccount(params: CreateAccountParams, idempotencyKey: string): Promise<ConnectedAccount>;
  retrieveAccount(accountId: string): Promise<ConnectedAccount>;
  /** A one-time Account Link to Stripe's hosted onboarding (`account_onboarding`). */
  createAccountLink(params: AccountLinkParams): Promise<OnboardingLink>;
  /** Stripe Checkout (mode payment, one line) on the connected account. */
  createCheckoutSession(params: CheckoutParams, idempotencyKey: string): Promise<CheckoutSession>;
  retrieveCheckoutSession(accountId: string, sessionId: string): Promise<CheckoutSession>;
  /** Ends an open session, so it can no longer be paid. */
  expireCheckoutSession(accountId: string, sessionId: string): Promise<CheckoutSession>;
}

/** The SDK's error type and code (`StripeConnectionError`, `idempotency_key_in_use`), never its message. */
export function stripeErrorName(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    return error.code ? `${error.type}:${error.code}` : error.type;
  }
  return error instanceof Error ? error.name : 'unknown';
}

const pick = (account: Stripe.Account): ConnectedAccount => ({
  id: account.id,
  charges_enabled: account.charges_enabled ?? false,
  payouts_enabled: account.payouts_enabled ?? false,
  details_submitted: account.details_submitted ?? false,
  requirements: account.requirements
    ? {
        currently_due: account.requirements.currently_due,
        past_due: account.requirements.past_due,
        disabled_reason: account.requirements.disabled_reason,
      }
    : null,
});

const session = (s: Stripe.Checkout.Session): CheckoutSession => ({
  id: s.id,
  url: s.url ?? null,
  status: s.status === 'complete' ? 'complete' : s.status === 'expired' ? 'expired' : 'open',
  amountTotal: s.amount_total ?? 0,
  expiresAt: new Date(s.expires_at * 1000),
});

/** The real Stripe, with the platform's key, a pinned API version and an 8 s timeout. */
export function createStripeGateway(secretKey: string): StripeGateway {
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    timeout: STRIPE_TIMEOUT_MS,
    maxNetworkRetries: 0,
    appInfo: { name: 'Firmivra' },
  });
  return {
    createAccount: async ({ businessId, country, email }, idempotencyKey) =>
      pick(
        await stripe.accounts.create(
          {
            type: 'standard',
            country,
            ...(email ? { email } : {}),
            metadata: { business_id: businessId },
          },
          { idempotencyKey },
        ),
      ),
    retrieveAccount: async (accountId) => pick(await stripe.accounts.retrieve(accountId)),
    createAccountLink: async ({ accountId, returnUrl, refreshUrl }) => {
      const link = await stripe.accountLinks.create({
        account: accountId,
        return_url: returnUrl,
        refresh_url: refreshUrl,
        type: 'account_onboarding',
      });
      return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
    },
    createCheckoutSession: async (p, idempotencyKey) => {
      const metadata = { invoice_id: p.invoiceId, payment_id: p.paymentId };
      return session(
        await stripe.checkout.sessions.create(
          {
            mode: 'payment',
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: p.currency,
                  unit_amount: p.amountCents,
                  product_data: { name: p.description },
                },
              },
            ],
            client_reference_id: p.invoiceId,
            metadata,
            payment_intent_data: { metadata },
            expires_at: Math.floor(p.expiresAt.getTime() / 1000),
            success_url: p.successUrl,
            cancel_url: p.cancelUrl,
          },
          { stripeAccount: p.accountId, idempotencyKey },
        ),
      );
    },
    retrieveCheckoutSession: async (accountId, sessionId) =>
      session(await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: accountId })),
    expireCheckoutSession: async (accountId, sessionId) =>
      session(await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: accountId })),
  };
}
