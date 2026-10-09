import {
  ApiRequestError,
  type PaymentsSetup,
  type PaymentsSetupClient,
  setupRequirementsDue,
  StripeOnboardingLink,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/**
 * Mock data for `api.paymentsSetup` (Settings > Payments, R7). Same roles, rules and error codes
 * as the API: the Owner and Admins read, only the Owner starts or refreshes onboarding (Admin 403),
 * Staff get 403 on every call. `start` connects the firm (setup not finished) and answers a
 * `mock:` link that opens nothing; no Stripe here, so the account never finishes by itself.
 * `stage` starts the firm at another point, to try each state of the page.
 */
export type MockSetupStage =
  'NOT_CONNECTED' | 'ONBOARDING' | 'IN_REVIEW' | 'RESTRICTED' | 'COMPLETE';

const at = '2026-10-09T09:00:00.000Z';

function setupAt(stage: MockSetupStage): PaymentsSetup {
  const connected = stage !== 'NOT_CONNECTED';
  const complete = stage === 'COMPLETE';
  const setup = {
    connected,
    onboardingStatus: !connected
      ? null
      : complete
        ? ('COMPLETE' as const)
        : stage === 'RESTRICTED'
          ? ('RESTRICTED' as const)
          : ('PENDING' as const),
    chargesEnabled: complete || stage === 'RESTRICTED',
    payoutsEnabled: complete,
    detailsSubmitted: connected && stage !== 'ONBOARDING',
    updatedAt: connected ? at : null,
  };
  return { ...setup, requirementsDue: setupRequirementsDue(setup) };
}

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);

export function createPaymentsSetupMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF'; stage?: MockSetupStage } = {},
): PaymentsSetupClient {
  let setup = setupAt(options.stage ?? 'NOT_CONNECTED');
  let links = 0;

  const allowed = async (ownerOnly: boolean) => {
    await mockDelay();
    if (options.role === 'STAFF' || (ownerOnly && options.role === 'ADMIN')) {
      throw fail(403, 'FORBIDDEN', 'This action is not permitted');
    }
  };
  const link = () => {
    if (setup.onboardingStatus === 'COMPLETE') {
      throw fail(409, 'PAYMENTS_ALREADY_SET_UP', 'Stripe is already connected');
    }
    links += 1;
    return StripeOnboardingLink.parse({
      url: `mock:stripe-onboarding/${links}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  };

  return {
    get: async () => {
      await allowed(false);
      return { ...setup };
    },
    start: async () => {
      await allowed(true);
      if (!setup.connected)
        setup = { ...setupAt('ONBOARDING'), updatedAt: new Date().toISOString() };
      return link();
    },
    refresh: async () => {
      await allowed(true);
      if (!setup.connected) throw fail(409, 'PAYMENTS_NOT_SET_UP', 'Stripe is not connected yet');
      return link();
    },
  };
}
