import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import {
  type PaymentsSetup,
  PAYMENTS_SETUP_ERRORS,
  setupRequirementsDue,
  type StripeOnboardingLink,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DATABASE } from '../../database/database.module.js';
import { StripeAccountsWriter, toOnboardingState } from '../stripe/stripe-accounts.js';
import { STRIPE_GATEWAY, stripeErrorName, type StripeGateway } from '../stripe/stripe-gateway.js';

type AccountRow = {
  accountId: string;
  onboardingStatus: 'PENDING' | 'RESTRICTED' | 'COMPLETE';
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  updatedAt: Date;
};

/** The answer for a firm's `stripe_accounts` row, or for none (not connected). */
export function toPaymentsSetup(row: Omit<AccountRow, 'accountId'> | null): PaymentsSetup {
  const setup = {
    connected: row !== null,
    onboardingStatus: row?.onboardingStatus ?? null,
    chargesEnabled: row?.chargesEnabled ?? false,
    payoutsEnabled: row?.payoutsEnabled ?? false,
    detailsSubmitted: row?.detailsSubmitted ?? false,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
  return { ...setup, requirementsDue: setupRequirementsDue(setup) };
}

export const providerUnavailable = () =>
  new ServiceUnavailableException({
    code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    message: PAYMENTS_SETUP_ERRORS.PAYMENT_PROVIDER_UNAVAILABLE,
  });
const setupConflict = (code: 'PAYMENTS_NOT_SET_UP' | 'PAYMENTS_ALREADY_SET_UP') =>
  new ConflictException({ code, message: PAYMENTS_SETUP_ERRORS[code] });

/**
 * Settings > Payments (docs/api/invoices.yaml, "Stripe Connect setup"). The firm's
 * `stripe_accounts` row is read in its own business scope and written only through
 * `StripeAccountsWriter` (platform scope). The firm always comes from TenantGuard.
 */
@Injectable()
export class PaymentsSetupService {
  private readonly logger = new Logger('PaymentsSetup');

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway | null,
    @Inject(ENV) private readonly env: Env,
    private readonly accounts: StripeAccountsWriter,
    private readonly audit: AuditService,
  ) {}

  /** The Stripe gateway, or 503 when this environment has no Stripe. */
  protected gateway(): StripeGateway {
    if (!this.stripe) throw providerUnavailable();
    return this.stripe;
  }

  private row(businessId: string): Promise<AccountRow | null> {
    return this.database.withScope({ kind: 'business', businessId }, (tx) =>
      tx.stripeAccount.findUnique({ where: { businessId } }),
    );
  }

  /** A Stripe call; any failure is 503 with nothing changed, logged by error type only. */
  private async call<T>(what: string, businessId: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.warn(`Stripe ${what} failed for firm ${businessId}: ${stripeErrorName(error)}`);
      throw providerUnavailable();
    }
  }

  async get(businessId: string): Promise<PaymentsSetup> {
    this.gateway();
    return toPaymentsSetup(await this.row(businessId));
  }

  /** POST .../onboarding: the firm's account the first time (one, even on a double click), then a link. */
  async start(businessId: string): Promise<StripeOnboardingLink> {
    const stripe = this.gateway();
    const { row, created } = await this.accounts.ensure(businessId, () =>
      this.call('accounts.create', businessId, () =>
        stripe.createAccount(
          { businessId, country: 'US', email: null },
          `fv-connect-${businessId}`,
        ),
      ),
    );
    if (created) {
      await this.audit.log(
        'payments.stripe_account_created',
        { type: 'stripe_account', id: row.id },
        { accountId: row.accountId },
      );
    }
    if (row.onboardingStatus === 'COMPLETE') throw setupConflict('PAYMENTS_ALREADY_SET_UP');
    return this.link(stripe, businessId, row);
  }

  /** POST .../onboarding/refresh: a new link for the account already made, with its state stored. */
  async refresh(businessId: string): Promise<StripeOnboardingLink> {
    const stripe = this.gateway();
    const row = await this.row(businessId);
    if (!row) throw setupConflict('PAYMENTS_NOT_SET_UP');
    const account = await this.call('accounts.retrieve', businessId, () =>
      stripe.retrieveAccount(row.accountId),
    );
    const updated = await this.accounts.update(
      businessId,
      row.accountId,
      toOnboardingState(account),
    );
    if (updated.onboardingStatus === 'COMPLETE') throw setupConflict('PAYMENTS_ALREADY_SET_UP');
    return this.link(stripe, businessId, updated);
  }

  private async link(
    stripe: StripeGateway,
    businessId: string,
    row: { id?: string; accountId: string },
  ): Promise<StripeOnboardingLink> {
    const page = `${this.env.APP_BASE_URL.replace(/\/$/, '')}/settings/payments`;
    const link = await this.call('accountLinks.create', businessId, () =>
      stripe.createAccountLink({
        accountId: row.accountId,
        returnUrl: `${page}?stripe=return`,
        refreshUrl: `${page}?stripe=refresh`,
      }),
    );
    await this.audit.log(
      'payments.onboarding_link_created',
      { type: 'stripe_account', id: row.id },
      { accountId: row.accountId },
    );
    return { url: link.url, expiresAt: link.expiresAt.toISOString() };
  }
}
