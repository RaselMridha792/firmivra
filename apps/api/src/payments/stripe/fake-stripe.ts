import { randomBytes } from 'node:crypto';
import type {
  AccountLinkParams,
  CheckoutParams,
  CheckoutSession,
  StripeRefund,
  ConnectedAccount,
  CreateAccountParams,
  OnboardingLink,
  StripeGateway,
} from './stripe-gateway.js';

/** What Stripe's SDK throws when it gets no answer; the fake throws it while `down`. */
export class FakeStripeUnavailable extends Error {
  override name = 'StripeConnectionError';
}

/** What Stripe's SDK throws for an id the account does not have (`resource_missing`). */
export class FakeStripeMissing extends Error {
  override name = 'StripeInvalidRequestError:resource_missing';
}

/** What Stripe's SDK throws for a charge already refunded in full (in the dashboard, say). */
export class FakeStripeAlreadyRefunded extends Error {
  override name = 'StripeInvalidRequestError:charge_already_refunded';
}

/**
 * An in-memory Stripe for tests and STRIPE_MODE=fake: accounts keyed by idempotency key (the same
 * key answers the same account, as Stripe does), links on connect.stripe.com that open nothing.
 * Tests set `down`, change an account with `update`, and count calls in `calls`.
 */
export class FakeStripeGateway implements StripeGateway {
  readonly accounts = new Map<string, ConnectedAccount>();
  /** Checkout Sessions with the account they run on and their params. */
  readonly sessions = new Map<
    string,
    CheckoutSession & { accountId: string; params: CheckoutParams }
  >();
  private readonly sessionsByKey = new Map<string, string>();
  readonly calls: { method: keyof StripeGateway; accountId?: string; params?: unknown }[] = [];
  private readonly byKey = new Map<string, string>();
  down = false;
  /** A test-mode key, like every key outside production. */
  readonly livemode = false;
  /** What the next refund creates throw while set, as Stripe's SDK would. */
  refundError: Error | null = null;
  /** Milliseconds each call waits, to make two requests overlap in a test. */
  delayMs = 0;

  private async answer(): Promise<void> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.down) throw new FakeStripeUnavailable('Stripe did not answer (fake)');
  }

  async createAccount(params: CreateAccountParams, idempotencyKey: string) {
    this.calls.push({ method: 'createAccount', params: { ...params, idempotencyKey } });
    await this.answer();
    const known = this.byKey.get(idempotencyKey);
    if (known) return { ...this.accounts.get(known)! };
    const account: ConnectedAccount = {
      id: `acct_fake${randomBytes(8).toString('hex')}`,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: {
        currently_due: ['business_profile.url'],
        past_due: [],
        disabled_reason: null,
      },
    };
    this.accounts.set(account.id, account);
    this.byKey.set(idempotencyKey, account.id);
    return { ...account };
  }

  async retrieveAccount(accountId: string) {
    this.calls.push({ method: 'retrieveAccount', accountId });
    await this.answer();
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('No such account (fake)');
    return { ...account };
  }

  async createAccountLink(params: AccountLinkParams): Promise<OnboardingLink> {
    this.calls.push({ method: 'createAccountLink', accountId: params.accountId, params });
    await this.answer();
    if (!this.accounts.has(params.accountId)) throw new Error('No such account (fake)');
    return {
      url: `https://connect.stripe.com/setup/s/${params.accountId}/${randomBytes(6).toString('hex')}`,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    };
  }

  async createCheckoutSession(params: CheckoutParams, idempotencyKey: string) {
    this.calls.push({ method: 'createCheckoutSession', accountId: params.accountId, params });
    await this.answer();
    const known = this.sessionsByKey.get(idempotencyKey);
    if (known) return this.view(known);
    const id = `cs_fake${randomBytes(8).toString('hex')}`;
    this.sessions.set(id, {
      id,
      url: `https://checkout.stripe.com/c/pay/${id}`,
      status: 'open',
      amountTotal: params.amountCents,
      expiresAt: params.expiresAt,
      paymentIntentId: `pi_${id.slice(3)}`,
      accountId: params.accountId,
      params,
    });
    this.sessionsByKey.set(idempotencyKey, id);
    return this.view(id);
  }

  async retrieveCheckoutSession(accountId: string, sessionId: string) {
    this.calls.push({ method: 'retrieveCheckoutSession', accountId, params: { sessionId } });
    await this.answer();
    return this.view(sessionId, accountId);
  }

  async expireCheckoutSession(accountId: string, sessionId: string) {
    this.calls.push({ method: 'expireCheckoutSession', accountId, params: { sessionId } });
    await this.answer();
    const s = this.sessions.get(sessionId);
    if (!s || s.accountId !== accountId || s.status !== 'open') {
      throw new Error('Only an open session can be expired (fake)');
    }
    this.sessions.set(sessionId, { ...s, status: 'expired', url: null });
    return this.view(sessionId);
  }

  /** Failure codes by payment intent, for `retrievePaymentIntent`. */
  readonly failureCodes = new Map<string, string>();
  /** Refunds by id, with the account, the payment intent and the charge they belong to. */
  readonly refunds = new Map<
    string,
    StripeRefund & { accountId: string; paymentIntentId: string; chargeId: string }
  >();
  private readonly refundsByKey = new Map<string, string>();

  async retrievePaymentIntent(accountId: string, paymentIntentId: string) {
    this.calls.push({ method: 'retrievePaymentIntent', accountId, params: { paymentIntentId } });
    await this.answer();
    const s = [...this.sessions.values()].find(
      (x) => x.paymentIntentId === paymentIntentId && x.accountId === accountId,
    );
    if (!s) throw new FakeStripeMissing('No such payment intent (fake)');
    return {
      paymentId: s.params.paymentId,
      failureCode: this.failureCodes.get(paymentIntentId) ?? null,
    };
  }

  async createRefund(
    accountId: string,
    params: { paymentIntentId: string; amountCents: number; refundKey: string },
    idempotencyKey: string,
  ) {
    this.calls.push({ method: 'createRefund', accountId, params: { ...params, idempotencyKey } });
    await this.answer();
    if (this.refundError) throw this.refundError;
    const known = this.refundsByKey.get(idempotencyKey);
    if (known) return this.refundView(known);
    const id = `re_fake${randomBytes(8).toString('hex')}`;
    this.refunds.set(id, {
      id,
      amountCents: params.amountCents,
      status: 'pending',
      created: Math.floor(Date.now() / 1000) + this.refunds.size,
      refundKey: params.refundKey,
      accountId,
      paymentIntentId: params.paymentIntentId,
      chargeId: chargeOf(params.paymentIntentId),
    });
    this.refundsByKey.set(idempotencyKey, id);
    return this.refundView(id);
  }

  async listRefunds(accountId: string, by: { charge: string } | { paymentIntent: string }) {
    this.calls.push({ method: 'listRefunds', accountId, params: by });
    await this.answer();
    return [...this.refunds.values()]
      .filter(
        (r) =>
          r.accountId === accountId &&
          ('charge' in by ? r.chargeId === by.charge : r.paymentIntentId === by.paymentIntent),
      )
      .sort((a, b) => a.created - b.created)
      .map((r) => this.refundView(r.id));
  }

  /** As if Stripe settled (or failed) a refund, or the firm refunded in its own dashboard. */
  setRefund(id: string, status: string) {
    const r = this.refunds.get(id);
    if (!r) throw new Error('No such refund (fake)');
    this.refunds.set(id, { ...r, status });
  }

  /** A refund made in the firm's Stripe dashboard (no refund key). */
  dashboardRefund(accountId: string, paymentIntentId: string, amountCents: number) {
    const id = `re_dash${randomBytes(8).toString('hex')}`;
    this.refunds.set(id, {
      id,
      amountCents,
      status: 'succeeded',
      created: Math.floor(Date.now() / 1000) + this.refunds.size,
      refundKey: null,
      accountId,
      paymentIntentId,
      chargeId: chargeOf(paymentIntentId),
    });
    return id;
  }

  private refundView(id: string): StripeRefund {
    const { accountId: _a, paymentIntentId: _p, chargeId: _c, ...r } = this.refunds.get(id)!;
    return { ...r };
  }

  /** As if the client paid (or the session ran out) at Stripe. */
  setSession(
    sessionId: string,
    changes: Partial<Pick<CheckoutSession, 'status' | 'expiresAt' | 'paymentIntentId'>>,
  ) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('No such session (fake)');
    const status = changes.status ?? s.status;
    this.sessions.set(sessionId, { ...s, ...changes, url: status === 'open' ? s.url : null });
  }

  private view(sessionId: string, accountId?: string): CheckoutSession {
    const s = this.sessions.get(sessionId);
    // Stripe answers "no such session" for another account's session.
    if (!s || (accountId && s.accountId !== accountId)) throw new Error('No such session (fake)');
    const { accountId: _account, params: _params, ...session } = s;
    return { ...session };
  }

  /** As if the Owner did something at Stripe. */
  update(accountId: string, changes: Partial<Omit<ConnectedAccount, 'id'>>): void {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('No such account (fake)');
    this.accounts.set(accountId, { ...account, ...changes });
  }
}

/** The fake's charge of a payment intent. */
export const chargeOf = (paymentIntentId: string) => `ch_${paymentIntentId.slice(3)}`;
