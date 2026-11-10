'use client';

import {
  type AcceptedPayments as AcceptedChoices,
  PAYMENT_PROCESSOR_LABELS,
  PAYMENTS_SETUP_ERRORS,
  PAYMENTS_SETUP_STAGE_LABELS,
  type PaymentProcessor,
  type PaymentsSetup,
  paymentsSetupStage,
  type PaymentsSetupStage,
  type SaveAcceptedPaymentsRequest,
  type StripeOnboardingReturn,
} from '@firmivra/types';
import { Badge, Button, Modal, Select, Toggle } from '@firmivra/ui';
import { ArrowRight, ArrowSquareOut, CreditCard, Info, LockSimple } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { RequireRole } from '../../../../../../components/require-role';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED, Quiet, SettingsHeader } from '../../_components/settings-parts';
import { BillingPreferences } from './billing-preferences';

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
 * The firm's own Stripe Dashboard: each firm's connected account has the full Dashboard
 * (`v2AccountParams`, dashboard 'full'), so the connection, the bank account and payout options
 * are managed there, signed in with the firm's own Stripe login.
 */
const STRIPE_DASHBOARD = {
  account: 'https://dashboard.stripe.com/settings/account',
  payouts: 'https://dashboard.stripe.com/settings/payouts',
  balance: 'https://dashboard.stripe.com/balance/overview',
};

/** The payment provider is not set up for Firmivra here (PAYMENT_PROVIDER_UNAVAILABLE). */
const UNAVAILABLE = 'Online payments are not available yet.';

/** Errors that are the page's own state (no permission, setup wizard, kiosk, suspended). */
const PAGE_ERRORS = new Set([
  'FORBIDDEN',
  'BUSINESS_SETUP_REQUIRED',
  'KIOSK_LOCKED',
  'BUSINESS_INACTIVE',
]);

/**
 * Settings > Payments (payments-settings.jpg; her Payments guide of Oct 18): the Stripe, Square
 * and PayPal cards, Accepted Client Payments and Payout Settings, and the link to Invoices &
 * Payments. Stripe is the firm's processor (`api.paymentsSetup`); the Owner connects it, the Owner
 * and Admins read it, Staff get 403. Square and PayPal are not set up in Firmivra, and checkout
 * takes cards only, so the other choices show as off with the reason.
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

  const blocking =
    setup.isError && setup.data === undefined && PAGE_ERRORS.has(errorCode(setup.error) ?? '');
  const unavailable =
    errorCode(setup.error) === 'PAYMENT_PROVIDER_UNAVAILABLE' && setup.data === undefined;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={CreditCard}
        title="Payments"
        subtitle="Manage how your firm accepts client payments and receives payouts."
      />

      {stripe === 'return' ? (
        <p data-testid="stripe-return" role="status" className="text-sm text-muted">
          Back from Stripe. This page shows what Stripe has told us so far.
        </p>
      ) : null}

      {blocking ? (
        <PageState query={setup}>{() => null}</PageState>
      ) : (
        <>
          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
            <ProviderCard
              name="Stripe"
              testId="provider-stripe"
              badge={
                setup.data ? (
                  <>
                    <span data-testid="payments-stage">
                      <Badge tone={TONES[paymentsSetupStage(setup.data)]} dot>
                        {PAYMENTS_SETUP_STAGE_LABELS[paymentsSetupStage(setup.data)]}
                      </Badge>
                    </span>
                    {setup.data.chargesEnabled ? <Badge tone="info">Default</Badge> : null}
                  </>
                ) : null
              }
            >
              {unavailable ? (
                <div data-testid="payments-unavailable">
                  <Quiet>{UNAVAILABLE}</Quiet>
                </div>
              ) : setup.isPending ? (
                <Quiet>Loading…</Quiet>
              ) : setup.data ? (
                <StripeBody setup={setup.data} expired={stripe === 'refresh'} />
              ) : (
                <Quiet>{NOT_LOADED}</Quiet>
              )}
            </ProviderCard>
            <ProviderCard
              name="Square"
              testId="provider-square"
              badge={
                <Badge tone="neutral" dot>
                  Not connected
                </Badge>
              }
            >
              <OtherProvider
                text="Accept credit and debit card payments through Square."
                action="Connect Square"
              />
            </ProviderCard>
            <ProviderCard
              name="PayPal"
              testId="provider-paypal"
              badge={
                <Badge tone="neutral" dot>
                  Not connected
                </Badge>
              }
            >
              <OtherProvider
                text="Let clients pay with their PayPal account or credit card."
                action="Connect PayPal"
              />
            </ProviderCard>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <AcceptedPayments />
            <PayoutSettings
              setup={setup.data}
              loading={setup.isPending}
              unavailable={unavailable}
            />
          </div>
          <BillingPreferences />
          <p className="border-t border-divider pt-4 text-sm text-text">
            View transactions in{' '}
            <Link
              href="/invoices"
              className="inline-flex items-center gap-1 font-semibold text-link hover:underline"
            >
              Invoices & Payments
              <ArrowRight aria-hidden weight="bold" className="size-4" />
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

/** One provider card of the top row: the name, its badges, its line and its button. */
function ProviderCard({
  name,
  badge,
  testId,
  children,
}: {
  name: string;
  badge: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={name}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-2xl font-bold text-heading">{name}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

/** Square and PayPal: not set up in Firmivra, so their button is off and says why. */
function OtherProvider({ text, action }: { text: string; action: string }) {
  return (
    <>
      <p className="text-sm text-text">{text}</p>
      <div className="mt-auto flex flex-col gap-2 border-t border-divider pt-3">
        <Button disabled className="w-full">
          {action}
        </Button>
        <p className="text-xs text-muted">Firmivra has not set up this connection yet.</p>
      </div>
    </>
  );
}

/** Stripe's lines, the review check, and the Owner's connect button or Manage Connection. */
function StripeBody({ setup, expired }: { setup: PaymentsSetup; expired: boolean }) {
  const stage = paymentsSetupStage(setup);
  const action = ACTIONS[stage];
  return (
    <>
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
        {stage === 'NEEDS_ATTENTION' ? (
          <li className="font-semibold text-danger">Action required: Stripe needs more details.</li>
        ) : null}
      </ul>
      <div className="mt-auto flex flex-col gap-2 border-t border-divider pt-3">
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
        {setup.connected ? (
          <ExternalButton href={STRIPE_DASHBOARD.account} testId="stripe-manage">
            Manage Connection
          </ExternalButton>
        ) : null}
      </div>
    </>
  );
}

/** A link to the firm's own Stripe Dashboard, styled as the cards' outlined button. */
function ExternalButton({
  href,
  testId,
  children,
}: {
  href: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-action px-4 text-sm font-medium text-action hover:bg-folder-surface"
    >
      {children}
      <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
      <span className="sr-only">(opens Stripe in a new tab)</span>
    </a>
  );
}

/** Why a control can't change now: the connection or setup it needs (IP-F14). */
function LockLine({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted">
      <LockSimple aria-hidden weight="bold" className="mt-0.5 size-3.5 shrink-0" />
      <span>{text}</span>
    </p>
  );
}

/** One accepted method: its name, its line, its switch, and what a locked one needs. */
function Method({
  name,
  line,
  on,
  lock,
  onChange,
  testId,
}: {
  name: string;
  line: string;
  on: boolean;
  lock: string | null;
  onChange?: (on: boolean) => void;
  testId: string;
}) {
  return (
    <div data-testid={testId} className="flex flex-col gap-1 border-t border-divider py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-heading">{name}</p>
          <p className="text-sm text-muted">{line}</p>
        </div>
        <span className="flex items-center gap-2 text-sm text-text">
          <Toggle
            checked={on}
            disabled={lock !== null || !onChange}
            label={name}
            onChange={(next) => onChange?.(next)}
          />
          {on ? 'On' : 'Off'}
        </span>
      </div>
      {lock ? <LockLine text={lock} /> : null}
    </div>
  );
}

const ACCEPTED = [...PAYMENTS_SETUP, 'accepted'];

/**
 * Accepted Client Payments (PAY-3, IP-F14): cards on or off and their processor, saved with Save
 * Changes. Only a processor that can take payments is offered; bank payments and PayPal stay off
 * and say why. Turning cards off asks first: clients then see no Pay Now.
 */
function AcceptedPayments() {
  const query = useApiQuery(ACCEPTED, () => api.paymentsSetup.accepted());
  // Kept here: a save remounts the form on the saved values, and the message must outlive it.
  const [done, setDone] = useState<string | null>(null);
  return (
    <section
      aria-label="Accepted Client Payments"
      data-testid="accepted-payments"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <div>
        <h2 className="text-xl font-bold text-heading">Accepted Client Payments</h2>
        <p className="text-sm text-muted">
          Choose which payment methods clients can use when paying invoices.
        </p>
      </div>
      <PageState query={query}>
        {(saved) => (
          <AcceptedForm key={JSON.stringify(saved)} saved={saved} done={done} setDone={setDone} />
        )}
      </PageState>
    </section>
  );
}

const choicesOf = (a: AcceptedChoices): SaveAcceptedPaymentsRequest => ({
  acceptCard: a.acceptCard,
  defaultCardProcessor: a.defaultCardProcessor,
  acceptAch: a.acceptAch,
  achProcessor: a.achProcessor,
});

function AcceptedForm({
  saved,
  done,
  setDone,
}: {
  saved: AcceptedChoices;
  done: string | null;
  setDone: (message: string | null) => void;
}) {
  const start = choicesOf(saved);
  const [form, setForm] = useState(start);
  const [confirmOff, setConfirmOff] = useState(false);
  const save = useApiMutation(
    (body: SaveAcceptedPaymentsRequest) => api.paymentsSetup.saveAccepted(body),
    { invalidate: ACCEPTED },
  );
  const dirty = JSON.stringify(form) !== JSON.stringify(start);
  const change = (patch: Partial<SaveAcceptedPaymentsRequest>) => {
    setDone(null);
    setForm({ ...form, ...patch });
  };
  const commit = () =>
    save.mutate(form, {
      onSuccess: () => {
        setConfirmOff(false);
        setDone('Accepted payments saved.');
      },
    });
  const processor = PAYMENT_PROCESSOR_LABELS[form.defaultCardProcessor];
  const processors = saved.readyProcessors.length
    ? saved.readyProcessors.map((p) => ({ value: p, label: PAYMENT_PROCESSOR_LABELS[p] }))
    : [{ value: form.defaultCardProcessor, label: `${processor} (not ready)` }];
  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_minmax(0,14rem)]">
          <span className="font-semibold text-heading">Default card processor</span>
          <Select
            label="Default card processor"
            hideLabel
            disabled={saved.locks.card !== null}
            value={form.defaultCardProcessor}
            options={processors}
            onChange={(e) => change({ defaultCardProcessor: e.target.value as PaymentProcessor })}
          />
        </div>
      </div>
      <div>
        {/* The card lock (IP-F14) is said once, on the cards switch below. */}
        <Method
          testId="method-card"
          name="Credit / debit cards"
          line={
            form.acceptCard
              ? `Visa, Mastercard, American Express, Discover, through ${processor}`
              : 'Off: clients see no Pay Now on their invoices'
          }
          on={form.acceptCard && saved.locks.card === null}
          lock={saved.locks.card}
          onChange={(on) => change({ acceptCard: on })}
        />
        <Method
          testId="method-ach"
          name="ACH bank payments"
          line={`Secure bank transfers (U.S. only), through ${PAYMENT_PROCESSOR_LABELS[form.achProcessor]}`}
          on={false}
          lock={saved.locks.ach}
        />
        <Method
          testId="method-paypal"
          name="PayPal checkout"
          line="Clients pay with their PayPal account"
          on={false}
          lock={saved.locks.paypal}
        />
      </div>
      <p className="text-xs text-muted">
        Clients see only the methods that are on. A payment shows as paid only once the provider
        confirms it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => (start.acceptCard && !form.acceptCard ? setConfirmOff(true) : commit())}
        >
          {save.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
        <Button variant="secondary" disabled={!dirty} onClick={() => setForm(start)}>
          Cancel
        </Button>
        {done ? (
          <p role="status" className="text-sm text-success">
            {done}
          </p>
        ) : null}
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, PAYMENTS_SETUP_ERRORS)} Your changes are kept.
          </p>
        ) : null}
      </div>
      <Modal
        open={confirmOff}
        title="Turn off card payments?"
        onClose={() => setConfirmOff(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOff(false)}>
              Keep cards on
            </Button>
            <Button disabled={save.isPending} onClick={commit}>
              Turn off
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          Clients will see no Pay Now on their invoices until you turn cards back on. Payments
          already made stay as they are, and you can still record payments yourself.
        </p>
      </Modal>
    </>
  );
}

/** Payout Settings for Stripe: the bank account and instant payouts live in Stripe's Dashboard. */
function PayoutSettings({
  setup,
  loading,
  unavailable,
}: {
  setup: PaymentsSetup | undefined;
  loading: boolean;
  unavailable: boolean;
}) {
  return (
    <section
      aria-label="Payout Settings"
      data-testid="payout-settings"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <div>
        <h2 className="text-xl font-bold text-heading">Payout Settings — Stripe</h2>
        <p className="text-sm text-muted">Manage where Stripe sends your payouts.</p>
      </div>
      {loading ? (
        <Quiet>Loading…</Quiet>
      ) : unavailable ? (
        <Quiet>{UNAVAILABLE}</Quiet>
      ) : !setup ? (
        <Quiet>{NOT_LOADED}</Quiet>
      ) : !setup.connected ? (
        <Quiet>Connect Stripe first; payouts follow once Stripe has your bank account.</Quiet>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider py-3">
            <div className="min-w-0">
              <p className="font-semibold text-heading">Bank account</p>
              <p className="text-sm text-muted">
                {setup.payoutsEnabled
                  ? 'Stripe pays out to the bank account in your Stripe Dashboard.'
                  : 'Add or verify a bank account in your Stripe Dashboard.'}{' '}
                No account details are shown here.
              </p>
            </div>
            <div className="w-full sm:w-56">
              <ExternalButton href={STRIPE_DASHBOARD.payouts} testId="stripe-bank">
                Manage Bank Account
              </ExternalButton>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider py-3">
            <div className="min-w-0">
              <p className="font-semibold text-heading">Instant Payouts</p>
              <p className="text-sm text-muted">
                Eligible debit cards or bank accounts only. Availability and fees confirmed by
                Stripe.
              </p>
            </div>
            <div className="w-full sm:w-56">
              <ExternalButton href={STRIPE_DASHBOARD.balance} testId="stripe-instant">
                Check Eligibility
              </ExternalButton>
            </div>
          </div>
        </>
      )}
      <p className="flex items-center gap-2 rounded-lg bg-info-soft p-3 text-sm text-text">
        <Info aria-hidden weight="bold" className="size-5 shrink-0 text-heading" />
        Each provider manages its own payout destination.
      </p>
    </section>
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
    <div className="flex flex-col items-stretch gap-2">
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
