'use client';

import {
  PAYMENTS_SETUP_ERRORS,
  PAYMENTS_SETUP_STAGE_LABELS,
  type PaymentsSetup,
  paymentsSetupStage,
  type PaymentsSetupStage,
  type StripeOnboardingReturn,
} from '@firmivra/types';
import { Badge, Button, Card } from '@firmivra/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { RequireRole } from '../../../../../../components/require-role';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';

const PAYMENTS_SETUP = ['payments-setup'];

const TONES = {
  NOT_CONNECTED: 'neutral',
  ONBOARDING: 'warning',
  IN_REVIEW: 'info',
  NEEDS_ATTENTION: 'danger',
  CONNECTED: 'success',
} as const satisfies Record<PaymentsSetupStage, string>;

/** The Owner's button for each stage; none while Stripe reviews, or once connected. */
const ACTIONS: Partial<Record<PaymentsSetupStage, string>> = {
  NOT_CONNECTED: 'Connect Stripe',
  ONBOARDING: 'Continue setup',
  NEEDS_ATTENTION: 'Update details',
};

/**
 * Settings > Payments: the firm's Stripe account. The Owner and Admins read it; only the Owner
 * connects (the API checks the role again). Staff get 403 from the API: PageState's no-permission.
 */
export function PaymentsScreen({ stripe }: StripeOnboardingReturn) {
  const setup = useApiQuery(PAYMENTS_SETUP, () => api.paymentsSetup.get());

  // Back from Stripe: ask Stripe for the state now (Stripe may not have sent account.updated
  // yet), once. If that fails, the page keeps what GET answered.
  const sync = useSync();
  const syncedRef = useRef(false);
  const { mutate } = sync;
  useEffect(() => {
    if (stripe !== 'return' || syncedRef.current) return;
    syncedRef.current = true;
    mutate();
  }, [stripe, mutate]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
          Payments
        </h1>
        <p className="text-sm text-muted">
          Connect your firm&apos;s Stripe account so clients can pay invoices online.
        </p>
      </div>

      {stripe === 'return' ? (
        <p data-testid="stripe-return" role="status" className="text-sm text-muted">
          Back from Stripe. This page shows what Stripe has told us so far.
        </p>
      ) : null}

      {errorCode(setup.error) === 'PAYMENT_PROVIDER_UNAVAILABLE' && setup.data === undefined ? (
        <Card data-testid="payments-unavailable">
          <p className="font-medium text-text">Online payments are not available yet.</p>
        </Card>
      ) : (
        <PageState query={setup}>
          {(data) => <SetupCard setup={data} expired={stripe === 'refresh'} />}
        </PageState>
      )}
    </div>
  );
}

/** POST .../sync: Stripe's state now, stored by the API and shown at once. */
function useSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.paymentsSetup.sync(),
    onSuccess: (data) => client.setQueryData(PAYMENTS_SETUP, data),
  });
}

/** While Stripe reviews: the Owner or an Admin asks Stripe again. */
function CheckStatusButton() {
  const sync = useSync();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        data-testid="stripe-check-status"
        variant="secondary"
        disabled={sync.isPending}
        onClick={() => sync.mutate()}
      >
        {sync.isPending ? 'Checking…' : 'Check status'}
      </Button>
      {sync.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(sync.error, PAYMENTS_SETUP_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}

function SetupCard({ setup, expired }: { setup: PaymentsSetup; expired: boolean }) {
  const stage = paymentsSetupStage(setup);
  const action = ACTIONS[stage];
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-text">Stripe</span>
        <span data-testid="payments-stage">
          <Badge tone={TONES[stage]}>{PAYMENTS_SETUP_STAGE_LABELS[stage]}</Badge>
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-sm text-text">
        <li data-testid="charges-status">
          {setup.chargesEnabled
            ? 'Clients can pay invoices online.'
            : 'Clients cannot pay invoices online yet.'}
        </li>
        <li data-testid="payouts-status">
          {setup.payoutsEnabled
            ? 'Stripe pays out to your bank account.'
            : 'Payouts to your bank account are not on yet.'}
        </li>
        {stage === 'IN_REVIEW' ? (
          <li className="text-muted">Stripe is checking your details. Nothing to do for now.</li>
        ) : null}
      </ul>
      {stage === 'IN_REVIEW' ? <CheckStatusButton /> : null}
      {action ? (
        <RequireRole
          roles={['OWNER']}
          fallback={
            <p data-testid="owner-only" className="text-sm text-muted">
              Only the Owner can connect Stripe.
            </p>
          }
        >
          <ConnectButton label={action} refresh={expired && setup.connected} />
        </RequireRole>
      ) : null}
    </Card>
  );
}

/** Opens Stripe's onboarding. After ?stripe=refresh it asks for a new link (refresh()) instead. */
function ConnectButton({ label, refresh }: { label: string; refresh: boolean }) {
  const [leaving, setLeaving] = useState(false);
  const [mockLink, setMockLink] = useState(false);
  const client = useQueryClient();
  // Back from Stripe via the browser's Back button: the page may come from the back-forward
  // cache with `leaving` still set and an old status, so make the button usable and ask again.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setLeaving(false);
      void client.invalidateQueries({ queryKey: PAYMENTS_SETUP });
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [client]);
  const connect = useApiMutation(
    () => (refresh ? api.paymentsSetup.refresh() : api.paymentsSetup.start()),
    { invalidate: PAYMENTS_SETUP },
  );

  const go = () =>
    connect.mutate(undefined, {
      onSuccess: ({ url }) => {
        // Mock mode answers a `mock:` link: it opens nothing, so stay on the page.
        if (url.startsWith('mock:')) return setMockLink(true);
        setLeaving(true);
        window.location.assign(url);
      },
      // Set up already (finished in another tab, say): show the status as it is now.
      onError: (error) => {
        if (errorCode(error) === 'PAYMENTS_ALREADY_SET_UP') {
          void client.invalidateQueries({ queryKey: PAYMENTS_SETUP });
        }
      },
    });

  return (
    <div className="flex flex-col items-start gap-2">
      {refresh ? (
        <p data-testid="stripe-expired" className="text-sm text-muted">
          Your Stripe link expired. Continue setup to get a new one.
        </p>
      ) : null}
      <Button data-testid="stripe-connect" disabled={connect.isPending || leaving} onClick={go}>
        {connect.isPending || leaving ? 'Opening Stripe…' : label}
      </Button>
      {mockLink ? (
        <p data-testid="stripe-mock-link" role="status" className="text-sm text-muted">
          Mock mode: the Stripe link opens nothing here.
        </p>
      ) : null}
      {connect.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(connect.error, PAYMENTS_SETUP_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}
