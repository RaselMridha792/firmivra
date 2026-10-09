import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../../database/database.module.js';
import { STRIPE_TIMEOUT_MS } from './stripe-gateway.js';
import type { ConnectedAccount } from './stripe-gateway.js';

/** accounts.create is one try (no SDK retry) of up to STRIPE_TIMEOUT_MS while the lock is held. */
const ENSURE_LIMITS = { timeout: 2 * STRIPE_TIMEOUT_MS + 5_000 };

/** What Firmivra stores of a connected account (`stripe_accounts`). */
export interface OnboardingState {
  onboardingStatus: 'PENDING' | 'RESTRICTED' | 'COMPLETE';
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

/**
 * Stripe's account as Firmivra stores it, the same for onboarding and `account.updated`.
 * COMPLETE: charges and payouts both work. RESTRICTED: the form was sent and Stripe asks for more
 * (something past due, or the account is disabled for a reason other than its own review).
 * PENDING otherwise: not finished, or Stripe is reviewing it (`requirements.pending_verification`
 * or `under_review`), which the page shows as In review.
 */
export function toOnboardingState(account: ConnectedAccount): OnboardingState {
  const chargesEnabled = account.charges_enabled;
  const payoutsEnabled = account.payouts_enabled;
  const detailsSubmitted = account.details_submitted;
  const req = account.requirements ?? {};
  const reason = req.disabled_reason ?? null;
  // Stripe checking what was sent: `requirements.pending_verification`, or `under_review`.
  const inReview =
    reason !== null && (reason.startsWith('requirements.pending') || reason === 'under_review');
  const needsMore =
    (req.past_due?.length ?? 0) > 0 ||
    (req.currently_due?.length ?? 0) > 0 ||
    (reason !== null && !inReview);
  const onboardingStatus =
    chargesEnabled && payoutsEnabled
      ? 'COMPLETE'
      : detailsSubmitted && needsMore && !inReview
        ? 'RESTRICTED'
        : 'PENDING';
  return { onboardingStatus, chargesEnabled, payoutsEnabled, detailsSubmitted };
}

/**
 * The only code that writes `stripe_accounts`. The RLS (r0_billing_review) lets only platform
 * scope insert or update it, so no firm can claim an `acct_` id or switch charges on; a firm's
 * business scope only reads its own row. Callers pass the `businessId` from TenantGuard
 * (onboarding), or find it here from the `acct_` id (the webhook), never from a request body.
 */
@Injectable()
export class StripeAccountsWriter {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * The firm's row, made first with `create()` (Stripe's accounts.create) when it has none. Runs
   * under an advisory lock per firm, so two clicks at once wait for each other and the second finds
   * the first one's row: one Stripe call, one row. `created` says whether this call made it.
   */
  async ensure(businessId: string, create: () => Promise<ConnectedAccount>) {
    return this.database.withScope(
      { kind: 'platform' },
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stripe-connect:${businessId}`}, 0))`;
        const found = await tx.stripeAccount.findUnique({ where: { businessId } });
        if (found) return { row: found, created: false };
        const account = await create();
        const row = await tx.stripeAccount.create({
          data: { businessId, accountId: account.id, ...toOnboardingState(account) },
        });
        return { row, created: true };
      },
      ENSURE_LIMITS,
    );
  }

  /** Stores Stripe's current answer for the firm's own account. */
  async update(businessId: string, accountId: string, state: OnboardingState) {
    return this.database.withScope({ kind: 'platform' }, (tx) =>
      tx.stripeAccount.update({ where: { businessId, accountId }, data: state }),
    );
  }

  /**
   * `account.updated`: the account's firm, from its `acct_` id, with Stripe's answer stored. Null
   * when no firm has this account (an event Firmivra does not know: ignored).
   */
  async updateByAccountId(accountId: string, state: OnboardingState): Promise<string | null> {
    return this.database.withScope({ kind: 'platform' }, async (tx) => {
      const row = await tx.stripeAccount.findUnique({ where: { accountId } });
      if (!row) return null;
      await tx.stripeAccount.update({ where: { id: row.id }, data: state });
      return row.businessId;
    });
  }
}
