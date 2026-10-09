import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { type PaymentsSetup, setupRequirementsDue } from '@firmivra/types';
import { DATABASE } from '../../database/database.module.js';
import { STRIPE_GATEWAY, type StripeGateway } from '../stripe/stripe-gateway.js';

type AccountRow = {
  onboardingStatus: 'PENDING' | 'RESTRICTED' | 'COMPLETE';
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  updatedAt: Date;
};

/** The answer for a firm's `stripe_accounts` row, or for none (not connected). */
export function toPaymentsSetup(row: AccountRow | null): PaymentsSetup {
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
    message: 'Stripe is not answering right now. Nothing was changed. Try again in a moment.',
  });

/**
 * Settings > Payments (docs/api/invoices.yaml, "Stripe Connect setup"). The firm's
 * `stripe_accounts` row is read and written only in its own business scope.
 */
@Injectable()
export class PaymentsSetupService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway | null,
  ) {}

  /** The Stripe gateway, or 503 when this environment has no Stripe. */
  protected gateway(): StripeGateway {
    if (!this.stripe) throw providerUnavailable();
    return this.stripe;
  }

  async get(businessId: string): Promise<PaymentsSetup> {
    this.gateway();
    const row = await this.database.withScope({ kind: 'business', businessId }, (tx) =>
      tx.stripeAccount.findUnique({ where: { businessId } }),
    );
    return toPaymentsSetup(row);
  }
}
