'use client';

import {
  ApiRequestError,
  BILLING_PAYMENT_METHOD_LABELS,
  CreateFirmBillingRequest,
  type FirmBillingOverview,
  type FirmBillingPlanChoice,
  type FirmBillingRequest,
  type FirmBillingSubscription,
  SUBSCRIPTION_CYCLE_LABELS,
  type SubscriptionBillingCycle,
  subscriptionPriceCents,
} from '@firmivra/types';
import { Badge, Button, Input, Modal, Skeleton, Textarea } from '@firmivra/ui';
import { CheckCircle, DownloadSimple } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { Facts, Quiet, NOT_LOADED } from '../../_components/settings-parts';
import { INVOICE_TONES, day, invoiceLabel, money, per, period } from './billing-format';

export const BILLING = ['settings', 'billing'] as const;

const ERRORS: Record<string, string> = {
  PLAN_NOT_AVAILABLE: 'That plan is not available for your firm right now.',
  NO_SUBSCRIPTION: 'No subscription is connected to this workspace yet. Contact Firmivra Support.',
};

/** Sends a request to Firmivra; the page refreshes its requests after. */
function useBillingRequest() {
  return useApiMutation((body: CreateFirmBillingRequest) => api.firmBilling.request(body), {
    invalidate: BILLING,
  });
}

/** Seats and locations a plan includes, and what each extra one costs. */
function allowance(plan: FirmBillingPlanChoice | FirmBillingSubscription['plan']) {
  const seats = plan.maxSeats
    ? `${plan.includedSeats} staff users included (up to ${plan.maxSeats})`
    : `${plan.includedSeats} staff users included`;
  const seatExtra =
    plan.seatPriceCents === null
      ? 'no extra seats'
      : `${money(plan.seatPriceCents)} per extra seat`;
  const locations = `${plan.includedLocations} location${plan.includedLocations === 1 ? '' : 's'} included`;
  const locationExtra =
    plan.locationPriceCents === null
      ? 'no extra locations'
      : `${money(plan.locationPriceCents)} per extra location`;
  return [`${seats}; ${seatExtra}`, `${locations}; ${locationExtra}`];
}

/** View Plan Details: the subscribed plan, read only (her guide §3). */
export function PlanDetailsModal({
  subscription: s,
  onClose,
}: {
  subscription: FirmBillingSubscription;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      title={s.plan.name}
      subtitle="Your current Firmivra plan. Opening this changes nothing."
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div data-testid="plan-details" className="flex w-full max-w-xl flex-col gap-4">
        <Facts
          rows={[
            ['Price', `${money(s.priceCents)}${per(s.billingCycle)}`],
            ['Billing cycle', SUBSCRIPTION_CYCLE_LABELS[s.billingCycle]],
            [
              'Current period',
              s.periodStart && s.periodEnd ? period(s.periodStart, s.periodEnd) : 'Not set',
            ],
            ['Next billing date', s.nextBillingOn ? day(s.nextBillingOn) : 'None scheduled'],
            ...(s.trialEndsOn ? [['Trial ends', day(s.trialEndsOn)] as [string, string]] : []),
            ...(s.accessEndsOn ? [['Access ends', day(s.accessEndsOn)] as [string, string]] : []),
            ['Renews automatically', s.autoRenew ? 'Yes' : 'No'],
            ['Staff seats', `${s.seatsAllowed}`],
            ['Locations', `${s.locationsAllowed}`],
          ]}
        />
        <div className="flex flex-col gap-1 text-sm text-text">
          {allowance(s.plan).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        {s.plan.features.length ? (
          <ul className="grid gap-1.5 text-sm text-text sm:grid-cols-2">
            {s.plan.features.map((f) => (
              <li key={f.key} className="flex items-center gap-2">
                <CheckCircle aria-hidden weight="fill" className="size-4 text-success" />
                {f.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}

/** View Usage Details: each measure, its allowance and what is left (her guide §5). */
export function UsageModal({
  overview,
  onClose,
}: {
  overview: FirmBillingOverview;
  onClose: () => void;
}) {
  const { usage, subscription } = overview;
  const rows = [
    { name: 'Staff seats', note: 'Active staff users', link: '/team', ...usage.seats },
    {
      name: 'Locations',
      note: 'Active locations',
      link: '/settings/locations',
      ...usage.locations,
    },
  ];
  return (
    <Modal
      open
      title="Usage Details"
      subtitle={
        subscription?.periodStart && subscription.periodEnd
          ? `Current billing period: ${period(subscription.periodStart, subscription.periodEnd)}`
          : 'What your firm uses today.'
      }
      onClose={onClose}
      footer={<Button onClick={onClose}>Back to Billing</Button>}
    >
      <div data-testid="usage-details" className="flex w-full max-w-xl flex-col gap-3">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Usage against your plan</caption>
          <thead className="bg-subtle text-xs text-muted">
            <tr>
              <th className="p-2 font-semibold">Measure</th>
              <th className="p-2 font-semibold">In use</th>
              <th className="p-2 font-semibold">Included</th>
              <th className="p-2 font-semibold">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-divider">
                <td className="p-2">
                  <Link href={r.link} className="font-semibold text-link hover:underline">
                    {r.name}
                  </Link>
                  <p className="text-xs text-muted">{r.note}</p>
                </td>
                <td className="p-2 text-heading">{r.used}</td>
                <td className="p-2 text-heading">{r.allowed ?? 'No limit'}</td>
                <td className="p-2 text-heading">
                  {r.allowed === null ? '—' : Math.max(0, r.allowed - r.used)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted">
          {usage.pendingInvitations
            ? `${usage.pendingInvitations} invitation${usage.pendingInvitations === 1 ? ' is' : 's are'} waiting; each takes a seat once accepted. `
            : ''}
          Measured {new Date(usage.measuredAt).toLocaleString('en-US')}. Firmivra never charges for
          extra seats or locations without confirming with you first.
        </p>
      </div>
    </Modal>
  );
}

/**
 * Upgrade or Downgrade (her guide §4): the plan catalog with the current plan marked, a cycle
 * choice, each plan's blockers, then Review and Send Request. Firmivra's Super Admin team
 * confirms the price and the date; nothing changes until then.
 */
export function ChangePlanModal({
  overview,
  direction,
  onClose,
  onSent,
}: {
  overview: FirmBillingOverview;
  direction: 'UPGRADE' | 'DOWNGRADE';
  onClose: () => void;
  onSent: (request: FirmBillingRequest) => void;
}) {
  const current = overview.subscription!;
  const [cycle, setCycle] = useState<SubscriptionBillingCycle>(current.billingCycle);
  const [chosen, setChosen] = useState<FirmBillingPlanChoice | null>(null);
  const [note, setNote] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const send = useBillingRequest();
  const { seats, locations } = overview.usage;
  const estimate = (p: FirmBillingPlanChoice) =>
    subscriptionPriceCents(p, {
      billingCycle: cycle,
      extraSeats: p.seatPriceCents === null ? 0 : Math.max(0, seats.used - p.includedSeats),
      extraLocations:
        p.locationPriceCents === null ? 0 : Math.max(0, locations.used - p.includedLocations),
    });
  const available = (p: FirmBillingPlanChoice) =>
    !p.blockers.length && !(p.direction === 'CURRENT' && cycle === current.billingCycle);
  const plans = [...overview.plans].sort(
    (a, b) => Number(b.direction === direction) - Number(a.direction === direction),
  );
  const failure =
    send.error instanceof ApiRequestError && send.error.details?.length
      ? send.error.details.map((d) => d.message).join(' ')
      : send.error
        ? errorMessage(send.error, ERRORS)
        : null;

  if (chosen) {
    const timing =
      chosen.direction === 'DOWNGRADE'
        ? `At your next renewal${current.nextBillingOn ? ` (${day(current.nextBillingOn)})` : ''}; your current plan stays until then.`
        : 'Once Firmivra confirms the price and it is paid.';
    return (
      <Modal
        open
        title="Review Plan Change"
        subtitle="Firmivra's Super Admin team confirms the price and the date before anything changes."
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={() => setChosen(null)} disabled={send.isPending}>
              Back
            </Button>
            <Button
              disabled={send.isPending}
              onClick={() =>
                send.mutate(
                  {
                    requestId,
                    kind: 'PLAN_CHANGE',
                    planCode: chosen.code,
                    billingCycle: cycle,
                    ...(note.trim() ? { note: note.trim() } : {}),
                  },
                  { onSuccess: onSent },
                )
              }
            >
              {send.isPending ? 'Sending…' : 'Send Request'}
            </Button>
          </>
        }
      >
        <div data-testid="review-plan-change" className="flex w-full max-w-xl flex-col gap-4">
          <Facts
            rows={[
              [
                'Current plan',
                `${current.plan.name}, ${money(current.priceCents)}${per(current.billingCycle)}`,
              ],
              ['New plan', `${chosen.name}, ${SUBSCRIPTION_CYCLE_LABELS[cycle]}`],
              ["Estimate at today's usage", `${money(estimate(chosen))}${per(cycle)}`],
              ['Effective', timing],
            ]}
          />
          <p className="text-xs text-muted">
            The estimate is the plan&apos;s list price with the extra seats and locations you use
            today. Taxes, credits and proration are confirmed by Firmivra.
          </p>
          <Textarea
            label="Note for Firmivra (optional)"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {failure ? (
            <p role="alert" className="text-sm text-danger">
              {failure}
            </p>
          ) : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title="Change Your Firmivra Plan"
      subtitle="Compare the plans. Choosing one opens a review; nothing is sent yet."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Back to Billing
        </Button>
      }
    >
      <div data-testid="change-plan" className="flex w-full max-w-3xl flex-col gap-4">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Billing cycle</legend>
          {(['MONTHLY', 'ANNUAL'] as const).map((c) => (
            <Button
              key={c}
              variant={cycle === c ? 'primary' : 'outline'}
              aria-pressed={cycle === c}
              onClick={() => setCycle(c)}
            >
              {SUBSCRIPTION_CYCLE_LABELS[c]}
            </Button>
          ))}
        </fieldset>
        <ul className="grid gap-3 md:grid-cols-3">
          {plans.map((p) => (
            <li
              key={p.code}
              data-testid={`plan-${p.code}`}
              className={`flex flex-col gap-2 rounded-xl border p-4 ${p.direction === direction ? 'border-action' : 'border-divider'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-heading">{p.name}</h3>
                {p.direction === 'CURRENT' ? <Badge tone="success">Current plan</Badge> : null}
              </div>
              <p className="text-xl font-bold text-heading">
                {money(estimate(p))}
                <span className="text-sm font-normal text-muted">{per(cycle)}</span>
              </p>
              <div className="flex flex-col gap-0.5 text-xs text-text">
                {allowance(p).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <ul className="flex flex-col gap-1 text-xs text-text">
                {p.features.map((f) => (
                  <li key={f.key} className="flex items-center gap-1.5">
                    <CheckCircle aria-hidden weight="fill" className="size-3.5 text-success" />
                    {f.label}
                  </li>
                ))}
              </ul>
              {p.blockers.map((b) => (
                <p key={b} className="text-xs text-danger">
                  {b}. Change this first.
                </p>
              ))}
              <Button
                className="mt-auto"
                variant={p.direction === direction ? 'primary' : 'outline'}
                disabled={!available(p)}
                onClick={() => setChosen(p)}
              >
                {p.direction === 'CURRENT' && cycle === current.billingCycle
                  ? 'Your plan'
                  : `Select ${p.name}`}
              </Button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          Your firm uses {seats.used} staff seat{seats.used === 1 ? '' : 's'} and {locations.used}{' '}
          location{locations.used === 1 ? '' : 's'}. Nobody is removed and nothing is deleted to fit
          a smaller plan.
        </p>
      </div>
    </Modal>
  );
}

/** Edit Billing Details: a new billing contact, as a request to Firmivra. */
export function ContactModal({
  details,
  onClose,
  onSent,
}: {
  details: FirmBillingOverview['billingDetails'];
  onClose: () => void;
  onSent: (request: FirmBillingRequest) => void;
}) {
  const [name, setName] = useState(details.contactName ?? '');
  const [email, setEmail] = useState(details.contactEmail ?? '');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requestId] = useState(() => crypto.randomUUID());
  const send = useBillingRequest();
  const submit = () => {
    const body = {
      requestId,
      kind: 'BILLING_CONTACT' as const,
      ...(name.trim() && name.trim() !== details.contactName ? { contactName: name.trim() } : {}),
      ...(email.trim() && email.trim().toLowerCase() !== details.contactEmail?.toLowerCase()
        ? { contactEmail: email.trim() }
        : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const checked = CreateFirmBillingRequest.safeParse(body);
    if (!checked.success) {
      const next: Record<string, string> = {};
      for (const i of checked.error.issues) next[String(i.path[0] ?? 'form')] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    send.mutate(body, { onSuccess: onSent });
  };
  return (
    <Modal
      open
      title="Edit Billing Details"
      subtitle="Firmivra keeps your billing contact. Your request is reviewed by the Super Admin team."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Send Request'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        data-testid="billing-contact"
        className="flex w-full max-w-xl flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          label="Billing contact name"
          maxLength={120}
          value={name}
          error={errors.contactName}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Billing contact email"
          type="email"
          value={email}
          error={errors.contactEmail}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Textarea
          label="Note for Firmivra (optional)"
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <p className="text-xs text-muted">
          The address is your company address. Change it on{' '}
          <Link href="/settings/profile" className="font-semibold text-link hover:underline">
            Company Profile
          </Link>
          .
        </p>
        {send.error || errors.form ? (
          <p role="alert" className="text-sm text-danger">
            {errors.form ?? errorMessage(send.error, ERRORS)}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** An invoice's View: the lines, totals and payments, and its PDF (her guide §7). */
export function InvoiceModal({ id, onClose }: { id: string; onClose: () => void }) {
  const invoice = useApiQuery([...BILLING, 'invoice', id], () => api.firmBilling.invoice(id));
  const i = invoice.data;
  return (
    <Modal
      open
      title={i ? `Invoice ${i.number}` : 'Invoice'}
      subtitle={i ? `${day(i.invoiceDate)} · due ${day(i.dueDate)}` : undefined}
      onClose={onClose}
      footer={
        <>
          {i ? (
            <a
              href={api.firmBilling.invoicePdfUrl(i.id)}
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action px-4 text-sm font-medium text-action hover:bg-folder-surface"
            >
              <DownloadSimple aria-hidden weight="bold" className="size-4" />
              Download PDF
            </a>
          ) : null}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div data-testid="invoice-view" className="flex w-full max-w-xl flex-col gap-4">
        {invoice.isPending ? (
          <Skeleton className="h-48" />
        ) : !i ? (
          <Quiet>{NOT_LOADED}</Quiet>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-text">
                Billed to {i.billTo.name} ({i.billTo.email})
              </span>
              <Badge tone={INVOICE_TONES[i.status]} dot>
                {invoiceLabel(i.status)}
              </Badge>
            </div>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Invoice lines</caption>
              <thead className="bg-subtle text-xs text-muted">
                <tr>
                  <th className="p-2 font-semibold">Description</th>
                  <th className="p-2 text-right font-semibold">Qty</th>
                  <th className="p-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {i.lines.map((l) => (
                  <tr
                    key={`${l.description}|${l.quantity}|${l.amountCents}`}
                    className="border-b border-divider"
                  >
                    <td className="p-2 text-heading">{l.description}</td>
                    <td className="p-2 text-right">{l.quantity}</td>
                    <td className="p-2 text-right">{money(l.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Facts
              rows={[
                ['Subtotal', money(i.subtotalCents)],
                ...(i.discountCents
                  ? [['Discount', money(-i.discountCents)] as [string, string]]
                  : []),
                ...(i.taxCents ? [['Tax', money(i.taxCents)] as [string, string]] : []),
                ['Total', money(i.totalCents)],
                ['Paid', money(i.paidCents)],
                ...(i.creditedCents
                  ? [['Credited', money(i.creditedCents)] as [string, string]]
                  : []),
                ['Balance due', money(i.balanceCents)],
              ]}
            />
            {i.payments.length ? (
              <ul className="flex flex-col gap-1 text-sm text-text">
                {i.payments.map((p) => (
                  <li key={`${p.paidOn}|${p.method}|${p.amountCents}`}>
                    {day(p.paidOn)}: {BILLING_PAYMENT_METHOD_LABELS[p.method]},{' '}
                    {money(p.amountCents)}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
