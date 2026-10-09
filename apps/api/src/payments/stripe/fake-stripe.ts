import { randomBytes } from 'node:crypto';
import type {
  AccountLinkParams,
  ConnectedAccount,
  CreateAccountParams,
  OnboardingLink,
  StripeGateway,
} from './stripe-gateway.js';

/** What Stripe's SDK throws when it gets no answer; the fake throws it while `down`. */
export class FakeStripeUnavailable extends Error {
  override name = 'StripeConnectionError';
}

/**
 * An in-memory Stripe for tests and STRIPE_MODE=fake: accounts keyed by idempotency key (the same
 * key answers the same account, as Stripe does), links on connect.stripe.com that open nothing.
 * Tests set `down`, change an account with `update`, and count calls in `calls`.
 */
export class FakeStripeGateway implements StripeGateway {
  readonly accounts = new Map<string, ConnectedAccount>();
  readonly calls: { method: keyof StripeGateway; accountId?: string; params?: unknown }[] = [];
  private readonly byKey = new Map<string, string>();
  down = false;
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

  /** As if the Owner did something at Stripe. */
  update(accountId: string, changes: Partial<Omit<ConnectedAccount, 'id'>>): void {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('No such account (fake)');
    this.accounts.set(accountId, { ...account, ...changes });
  }
}
