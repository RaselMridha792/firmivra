import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { StripeOnboardingStatus } from '../db-enums.js';

// Stripe Connect setup (R7): Settings > Payments in the firm workspace. Each firm is paid into its
// own Stripe account (a Standard connected account that Firmivra creates and the firm's Owner
// finishes on Stripe's hosted onboarding, through an Account Link). Until that account can take
// charges, clients see no Pay Now (`paymentsEnabled` false on the invoice lists).
// Routes: /api/v1/business/payments/setup. The Owner and Admins read it; only the Owner connects
// (Admin 403 FORBIDDEN on the onboarding calls). Staff never see the page: every call is 403.
// Errors in the order the API checks them: 415 and 403 ORIGIN_NOT_ALLOWED (changes, before
// sign-in), 401, the tenant guard (400 BUSINESS_REQUIRED, 404), 403 BUSINESS_INACTIVE or
// BUSINESS_SETUP_REQUIRED (an ACTIVE firm only), 403 FORBIDDEN (role), 400 VALIDATION_FAILED, 409
// (PaymentsSetupErrorCode), 503 PAYMENT_PROVIDER_UNAVAILABLE (Stripe did not answer, or the
// environment has no Stripe key).

const DateTime = z.iso.datetime({ offset: true });

/**
 * GET /business/payments/setup (Owner and Admin): the firm's Stripe account as Firmivra last
 * heard from Stripe (onboarding and Stripe's `account.updated` webhook keep it current).
 */
export const PaymentsSetup = z.object({
  /** A Stripe account was created for the firm (onboarding started). */
  connected: z.boolean(),
  /**
   * Null until connected. PENDING: onboarding not finished, or Stripe is reviewing it;
   * RESTRICTED: Stripe needs more from the firm; COMPLETE: charges and payouts both work.
   */
  onboardingStatus: StripeOnboardingStatus.nullable(),
  /** Clients can pay online (Pay Now) exactly when this is true. */
  chargesEnabled: z.boolean(),
  /** Stripe pays out to the firm's bank account. */
  payoutsEnabled: z.boolean(),
  /** The Owner finished Stripe's onboarding form at least once. */
  detailsSubmitted: z.boolean(),
  /**
   * The Owner has something to do at Stripe: onboarding not finished, or Stripe asks for more
   * (RESTRICTED). False while Stripe reviews what was sent, and once COMPLETE.
   */
  requirementsDue: z.boolean(),
  /** When Firmivra last stored Stripe's answer; null until connected. */
  updatedAt: DateTime.nullable(),
});
export type PaymentsSetup = z.infer<typeof PaymentsSetup>;

/** What the page shows, from `paymentsSetupStage()`. */
export const PaymentsSetupStage = z.enum([
  'NOT_CONNECTED',
  /** Started, the form not finished: "Continue setup". */
  'ONBOARDING',
  /** Sent; Stripe is checking it. Nothing to do. */
  'IN_REVIEW',
  /** Stripe needs more: "Update details". */
  'NEEDS_ATTENTION',
  'CONNECTED',
]);
export type PaymentsSetupStage = z.infer<typeof PaymentsSetupStage>;

export const PAYMENTS_SETUP_STAGE_LABELS: Readonly<Record<PaymentsSetupStage, string>> = {
  NOT_CONNECTED: 'Not connected',
  ONBOARDING: 'Setup not finished',
  IN_REVIEW: 'In review at Stripe',
  NEEDS_ATTENTION: 'Needs attention',
  CONNECTED: 'Connected',
};

/** The Owner has something to do at Stripe (the API's `requirementsDue`). */
export function setupRequirementsDue(
  setup: Pick<PaymentsSetup, 'connected' | 'onboardingStatus' | 'detailsSubmitted'>,
): boolean {
  if (!setup.connected || setup.onboardingStatus === 'COMPLETE') return false;
  return setup.onboardingStatus === 'RESTRICTED' || !setup.detailsSubmitted;
}

/** One stage for the page, the same in the mock and on the API's answers. */
export function paymentsSetupStage(setup: PaymentsSetup): PaymentsSetupStage {
  if (!setup.connected) return 'NOT_CONNECTED';
  if (setup.onboardingStatus === 'COMPLETE') return 'CONNECTED';
  if (setup.onboardingStatus === 'RESTRICTED') return 'NEEDS_ATTENTION';
  return setup.detailsSubmitted ? 'IN_REVIEW' : 'ONBOARDING';
}

/** POST .../onboarding and .../onboarding/refresh take no fields at all. */
export const StartOnboardingRequest = z.strictObject({});
export type StartOnboardingRequest = z.input<typeof StartOnboardingRequest>;

/**
 * Stripe's hosted onboarding only: https, the host exactly connect.stripe.com, no port and no user
 * part, so a bug or a tampered answer can never send the Owner to a lookalike page.
 */
const StripeOnboardingUrl = z
  .url({ protocol: /^https$/, hostname: /^connect\.stripe\.com$/ })
  .refine((url) => {
    const u = new URL(url);
    return u.port === '' && u.username === '' && u.password === '';
  }, 'Not a Stripe onboarding link');

/** Mock mode's link: it opens nothing, so the page stays where it is. */
const MockOnboardingUrl = z
  .string()
  .regex(/^mock:stripe-onboarding\//, 'Not a Stripe onboarding link');

/** Where to send the Owner's browser: Stripe's onboarding for the firm's account, until `expiresAt`. */
export const StripeOnboardingLink = z.object({
  url: z.union([StripeOnboardingUrl, MockOnboardingUrl]),
  expiresAt: DateTime,
});
export type StripeOnboardingLink = z.infer<typeof StripeOnboardingLink>;

/**
 * Stripe sends the Owner back to /settings/payments with `?stripe=return` (left Stripe's form,
 * finished or not) or `?stripe=refresh` (the link expired or was used: call
 * `api.paymentsSetup.refresh()` and go again). Parse the page's search params with this; anything
 * else reads as no return.
 */
export const StripeOnboardingReturn = z.object({
  stripe: z.enum(['return', 'refresh']).optional().catch(undefined),
});
export type StripeOnboardingReturn = z.infer<typeof StripeOnboardingReturn>;

/** Stable `error.code` values of the setup routes, besides the generic ones in ApiError. */
export const PaymentsSetupErrorCode = z.enum([
  /** 409 (refresh): the firm has no Stripe account yet; start onboarding first. */
  'PAYMENTS_NOT_SET_UP',
  /** 409: charges and payouts already work; the firm manages its account in Stripe's dashboard. */
  'PAYMENTS_ALREADY_SET_UP',
  /** 503: Stripe did not answer, or payments are not configured here. Nothing changed at Stripe. */
  'PAYMENT_PROVIDER_UNAVAILABLE',
]);
export type PaymentsSetupErrorCode = z.infer<typeof PaymentsSetupErrorCode>;

/** What the Owner sees: `errorMessage(error, PAYMENTS_SETUP_ERRORS)` on Settings > Payments. */
export const PAYMENTS_SETUP_ERRORS = {
  PAYMENTS_NOT_SET_UP: 'Stripe is not connected yet. Choose "Connect Stripe" to start.',
  PAYMENTS_ALREADY_SET_UP:
    'Stripe is already connected. Manage your account in your Stripe dashboard.',
  PAYMENT_PROVIDER_UNAVAILABLE:
    'Stripe is not answering right now. Nothing was changed. Try again in a moment.',
} as const satisfies Record<PaymentsSetupErrorCode, string>;

const BASE = '/business/payments/setup';

/**
 * `api.paymentsSetup` (apps/web/src/lib/api.ts): Settings > Payments. Connect:
 *   const { url } = await api.paymentsSetup.start();
 *   window.location.assign(url); // Stripe's onboarding; a `mock:` link (mock mode) opens nothing
 * Stripe sends the Owner back with `?stripe=...` (see `StripeOnboardingReturn`).
 */
export function createPaymentsSetupClient(request: ApiRequest) {
  return {
    /** Owner and Admin. */
    get: async (): Promise<PaymentsSetup> => request(PaymentsSetup, BASE),
    /**
     * Owner only. Creates the firm's Stripe account the first time (a double click makes one),
     * then answers a fresh onboarding link. 409 PAYMENTS_ALREADY_SET_UP; 503.
     */
    start: async (): Promise<StripeOnboardingLink> =>
      request(StripeOnboardingLink, `${BASE}/onboarding`, {
        method: 'POST',
        body: parseInput(StartOnboardingRequest, {}),
      }),
    /**
     * Owner only. A new link for the account already made (after `?stripe=refresh`); never
     * creates one. 409 PAYMENTS_NOT_SET_UP or PAYMENTS_ALREADY_SET_UP; 503.
     */
    refresh: async (): Promise<StripeOnboardingLink> =>
      request(StripeOnboardingLink, `${BASE}/onboarding/refresh`, {
        method: 'POST',
        body: parseInput(StartOnboardingRequest, {}),
      }),
  };
}

export type PaymentsSetupClient = ReturnType<typeof createPaymentsSetupClient>;
