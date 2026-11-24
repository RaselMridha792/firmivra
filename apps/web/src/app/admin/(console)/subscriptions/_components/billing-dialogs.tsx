'use client';

import { Callout, Input, Select, Textarea } from '@firmivra/ui';
import { Info, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { centsFrom, dayText, fieldErrors, money } from './format';
import {
  ActionForm,
  ChoiceGroup,
  ChoicePill,
  DetailDialog,
  InfoBox,
  notIn,
  useAct,
  type DialogProps,
  type FormProps,
} from './parts';
import {
  addDays,
  addMonths,
  adminSubscriptions,
  CHARGES_CARD,
  cycleMonths,
  daysBetween,
  netMonthlyOn,
  percentOffMonthlyCents,
  previewBillingDate,
  PROMOS,
  TIMED_DISCOUNTS,
  type DiscountBody,
  type PromoCode,
} from './subscriptions-api';

type DiscountKind = 'PERCENT' | 'PROMO' | 'CREDIT' | 'REMOVE';
const DURATIONS = [
  { value: '1', label: '1 month' },
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
  { value: '0', label: 'No end date' },
];
/** The mock's promotion codes; the API has none (its list is empty). */
const PROMO_CODES: PromoCode[] = Object.keys(PROMOS);

/** Credit or discount: amount, duration, reason and approver, with the price impact first. */
function DiscountForm({ sub, onClose, onDone }: FormProps) {
  const [kind, setKind] = useState<DiscountKind>('PERCENT');
  const [percent, setPercent] = useState('10');
  // A negotiated price has no end date (note 6): "No end date" first on the API.
  const [months, setMonths] = useState(TIMED_DISCOUNTS ? '3' : '0');
  const [code, setCode] = useState<PromoCode>(PROMO_CODES[0] ?? '');
  const [amount, setAmount] = useState('');
  const [startsOn, setStartsOn] = useState(sub.today);
  const [reason, setReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const apply = useAct((body: DiscountBody) => adminSubscriptions.applyDiscount(body));
  const remove = useAct((body: { id: string; reason: string }) =>
    adminSubscriptions.removeDiscount(body),
  );
  const current = kind === 'REMOVE' ? remove : apply;
  const fields = fieldErrors(current.error);
  // The list price a month (before any discount); the percent's price is the adapter's (the API
  // takes it off the plan's base price only).
  const list = sub.monthlyCents;
  const promo = PROMOS[code];
  const share = kind === 'PROMO' ? (promo?.percent ?? 0) : kind === 'PERCENT' ? Number(percent) : 0;
  const runs = kind === 'PROMO' ? (promo?.months ?? null) : Number(months) || null;
  const valid = Number.isInteger(share) && share >= 1 && share <= 100;
  const discounted = valid ? percentOffMonthlyCents(sub, share) : list;
  const credit = centsFrom(amount);
  const impact =
    kind === 'REMOVE'
      ? `From today: ${money(list)}/mo instead of ${money(sub.netMonthlyCents)}/mo.`
      : kind === 'CREDIT'
        ? Number.isNaN(credit)
          ? 'Enter the credit amount.'
          : `A credit of ${money(credit)} applies to the next invoice. The recurring price stays ${money(sub.netMonthlyCents)}/mo.`
        : kind === 'PROMO' && !promo
          ? 'No promotion codes are available yet.'
          : valid
            ? `From ${dayText(startsOn)}: ${money(discounted)}/mo instead of ${money(netMonthlyOn(sub, startsOn))}/mo${runs ? `, until ${dayText(addMonths(startsOn, runs))}` : ', with no end date'}.${sub.discount ? ` Replaces ${sub.discount.label}.` : ''}`
            : 'Enter a whole percentage from 1 to 100.';
  const ended = sub.status === 'CLOSED' || sub.status === 'CANCELLED';
  return (
    <ActionForm
      submitLabel={
        kind === 'REMOVE'
          ? 'Remove Discount'
          : kind === 'CREDIT'
            ? 'Apply Credit'
            : 'Apply Discount'
      }
      tone={kind === 'REMOVE' ? 'danger' : 'primary'}
      pending={current.isPending}
      error={current.error}
      blocked={
        ended
          ? `Credits and discounts can’t change while ${sub.firm.name} is closed or canceled.`
          : null
      }
      onCancel={onClose}
      onSubmit={() => {
        const done = { onSuccess: (result: { message: string }) => onDone(result.message) };
        if (kind === 'REMOVE') remove.mutate({ id: sub.id, reason }, done);
        else
          apply.mutate(
            {
              id: sub.id,
              kind,
              percent: Number(percent),
              code,
              amountCents: Number.isNaN(credit) ? 0 : credit,
              months: months === '0' ? null : Number(months),
              startsOn,
              reason,
              approvedBy,
            },
            done,
          );
      }}
    >
      {sub.discount ? (
        <InfoBox tone="info" title="Current discount">
          {sub.discount.label}
          {sub.discount.endsOn ? ` until ${dayText(sub.discount.endsOn)}` : ', no end date'}
          {sub.discount.reason ? ` · ${sub.discount.reason}` : null}
        </InfoBox>
      ) : null}
      <ChoiceGroup legend="Type" error={fields['kind']}>
        <ChoicePill
          name="discount-kind"
          value="PERCENT"
          checked={kind === 'PERCENT'}
          onChange={() => setKind('PERCENT')}
        >
          Percentage
        </ChoicePill>
        <ChoicePill
          name="discount-kind"
          value="PROMO"
          checked={kind === 'PROMO'}
          onChange={() => setKind('PROMO')}
        >
          Promotion code
        </ChoicePill>
        <ChoicePill
          name="discount-kind"
          value="CREDIT"
          checked={kind === 'CREDIT'}
          onChange={() => setKind('CREDIT')}
        >
          Account credit
        </ChoicePill>
        {sub.discount ? (
          <ChoicePill
            name="discount-kind"
            value="REMOVE"
            checked={kind === 'REMOVE'}
            onChange={() => setKind('REMOVE')}
          >
            Remove discount
          </ChoicePill>
        ) : null}
      </ChoiceGroup>
      {kind === 'PERCENT' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Percentage off"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={percent}
            error={fields['percent']}
            onChange={(event) => setPercent(event.target.value)}
          />
          <Select
            label="Duration"
            options={DURATIONS}
            value={months}
            error={fields['months']}
            onChange={(event) => setMonths(event.target.value)}
          />
        </div>
      ) : null}
      {kind === 'PROMO' ? (
        <Select
          label="Promotion code"
          options={
            PROMO_CODES.length
              ? Object.values(PROMOS).map((item) => ({
                  value: item.code,
                  label: `${item.code}: ${item.percent}% off for ${item.months} months`,
                }))
              : [{ value: '', label: 'No promotion codes yet' }]
          }
          value={code}
          error={fields['code']}
          onChange={(event) =>
            setCode(PROMO_CODES.find((value) => value === event.target.value) ?? code)
          }
        />
      ) : null}
      {kind === 'CREDIT' ? (
        <Input
          label="Credit amount ($)"
          inputMode="decimal"
          placeholder="100.00"
          value={amount}
          error={fields['amount']}
          onChange={(event) => setAmount(event.target.value)}
        />
      ) : null}
      {kind === 'REMOVE' ? null : (
        <Input
          label="Effective date"
          type="date"
          min={sub.today}
          value={startsOn}
          error={fields['startsOn']}
          onChange={(event) => setStartsOn(event.target.value)}
        />
      )}
      <Textarea
        label="Reason"
        required
        rows={2}
        maxLength={500}
        value={reason}
        error={fields['reason']}
        onChange={(event) => setReason(event.target.value)}
      />
      {kind === 'REMOVE' ? null : (
        <Input
          label="Approved by"
          required
          maxLength={100}
          placeholder="Who approved this"
          value={approvedBy}
          error={fields['approvedBy']}
          onChange={(event) => setApprovedBy(event.target.value)}
        />
      )}
      <Callout icon={Info} surface="info" size="compact" title="Financial impact">
        <span data-testid="discount-impact">{impact}</span>
      </Callout>
    </ActionForm>
  );
}

export function DiscountDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Apply Credit / Discount" subtitle={firm} onClose={onClose}>
      {(sub) => <DiscountForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

/** An approved payment link for a balance, or a link for the firm to update its card. */
function PaymentLinkForm({
  sub,
  purpose: initial,
  onClose,
  onDone,
}: FormProps & { purpose: 'BALANCE' | 'CARD_UPDATE' }) {
  const [purpose, setPurpose] = useState(initial);
  const [amount, setAmount] = useState(
    sub.amountDueCents > 0 ? (sub.amountDueCents / 100).toFixed(2) : '',
  );
  const [channel, setChannel] = useState<'EMAIL' | 'SMS'>('EMAIL');
  const send = useAct(
    (body: {
      id: string;
      purpose: 'BALANCE' | 'CARD_UPDATE';
      amountCents: number;
      channel: 'EMAIL' | 'SMS';
    }) => adminSubscriptions.sendPaymentLink(body),
  );
  const fields = fieldErrors(send.error);
  const cents = centsFrom(amount);
  return (
    <ActionForm
      submitLabel="Send Link"
      pending={send.isPending}
      error={send.error}
      blocked={sub.status === 'CLOSED' ? 'Payment links can’t be sent for a closed account.' : null}
      onCancel={onClose}
      onSubmit={() =>
        send.mutate(
          { id: sub.id, purpose, amountCents: Number.isNaN(cents) ? 0 : cents, channel },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <ChoiceGroup legend="Link for" error={fields['purpose']}>
        <ChoicePill
          name="link-purpose"
          value="BALANCE"
          checked={purpose === 'BALANCE'}
          onChange={() => setPurpose('BALANCE')}
        >
          Outstanding balance
        </ChoicePill>
        <ChoicePill
          name="link-purpose"
          value="CARD_UPDATE"
          checked={purpose === 'CARD_UPDATE'}
          onChange={() => setPurpose('CARD_UPDATE')}
        >
          Update payment method
        </ChoicePill>
      </ChoiceGroup>
      {purpose === 'BALANCE' ? (
        <div>
          <Input
            label="Amount ($)"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            error={fields['amount']}
            onChange={(event) => setAmount(event.target.value)}
          />
          <p className="mt-1 text-xs text-muted">Amount due now: {money(sub.amountDueCents)}</p>
        </div>
      ) : (
        <InfoBox>
          Card on file:{' '}
          {sub.card
            ? `${sub.card.brand} •••• ${sub.card.last4}, expires ${sub.card.expires}`
            : 'none'}
          . The firm enters the new card itself; it never passes through this page.
        </InfoBox>
      )}
      <ChoiceGroup legend="Send by" error={fields['channel']}>
        <ChoicePill
          name="link-channel"
          value="EMAIL"
          checked={channel === 'EMAIL'}
          onChange={() => setChannel('EMAIL')}
        >
          Email ({sub.firm.email})
        </ChoicePill>
        <ChoicePill
          name="link-channel"
          value="SMS"
          checked={channel === 'SMS'}
          onChange={() => setChannel('SMS')}
        >
          Text message
        </ChoicePill>
      </ChoiceGroup>
      <p className="text-xs text-muted">The date and channel are recorded in the history.</p>
    </ActionForm>
  );
}

export function PaymentLinkDialog({
  id,
  firm,
  onClose,
  onDone,
  purpose,
}: DialogProps & { purpose: 'BALANCE' | 'CARD_UPDATE' }) {
  return (
    <DetailDialog
      id={id}
      title={purpose === 'BALANCE' ? 'Send Payment Link' : 'Update Payment Method'}
      subtitle={firm}
      onClose={onClose}
    >
      {(sub) => <PaymentLinkForm sub={sub} purpose={purpose} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

function ResendInvoiceForm({
  sub,
  invoiceId,
  onClose,
  onDone,
}: FormProps & { invoiceId?: string }) {
  const [chosen, setChosen] = useState(invoiceId ?? sub.invoices[0]?.id ?? '');
  const [email, setEmail] = useState(sub.firm.email);
  const resend = useAct((body: { id: string; invoiceId: string; email: string }) =>
    adminSubscriptions.resendInvoice(body),
  );
  const fields = fieldErrors(resend.error);
  return (
    <ActionForm
      submitLabel="Resend Invoice"
      pending={resend.isPending}
      error={resend.error}
      blocked={sub.invoices.length ? null : 'There are no invoices to resend yet.'}
      onCancel={onClose}
      onSubmit={() =>
        resend.mutate(
          { id: sub.id, invoiceId: chosen, email },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <Select
        label="Invoice"
        options={sub.invoices.map((invoice) => ({
          value: invoice.id,
          label: `${invoice.number} · ${dayText(invoice.issuedOn)} · ${money(invoice.amountCents)}`,
        }))}
        value={chosen}
        error={fields['invoiceId']}
        onChange={(event) => setChosen(event.target.value)}
      />
      <Input
        label="Send to"
        type="email"
        maxLength={254}
        value={email}
        error={fields['email']}
        onChange={(event) => setEmail(event.target.value)}
      />
      <p className="text-xs text-muted">The delivery is recorded in the history.</p>
    </ActionForm>
  );
}

export function ResendInvoiceDialog({
  id,
  firm,
  onClose,
  onDone,
  invoiceId,
}: DialogProps & { invoiceId?: string }) {
  return (
    <DetailDialog id={id} title="Resend Invoice" subtitle={firm} onClose={onClose}>
      {(sub) => (
        <ResendInvoiceForm sub={sub} invoiceId={invoiceId} onClose={onClose} onDone={onDone} />
      )}
    </DetailDialog>
  );
}

/** Old and new billing date with the prorated impact before confirmation. */
function BillingDateForm({ sub, onClose, onDone }: FormProps) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const change = useAct((body: { id: string; date: string; reason: string }) =>
    adminSubscriptions.changeBillingDate(body),
  );
  const fields = fieldErrors(change.error);
  const amount = date ? previewBillingDate(sub, date, sub.today) : 0;
  const days = date && sub.nextBillingOn ? daysBetween(sub.nextBillingOn, date) : 0;
  const latest = addMonths(sub.today, cycleMonths(sub.cycle));
  return (
    <ActionForm
      submitLabel="Change Billing Date"
      pending={change.isPending}
      error={change.error}
      blocked={
        notIn(sub, ['ACTIVE', 'PAST_DUE'], 'Changing the billing date') ??
        (sub.nextBillingOn ? null : 'There is no next billing date to move.')
      }
      disabled={!date}
      onCancel={onClose}
      onSubmit={() =>
        change.mutate(
          { id: sub.id, date, reason },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <InfoBox tone="info" title="Current next billing date">
        {dayText(sub.nextBillingOn)}
      </InfoBox>
      <Input
        label="New billing date"
        type="date"
        required
        min={addDays(sub.today, 1)}
        max={latest}
        value={date}
        error={fields['date']}
        onChange={(event) => setDate(event.target.value)}
      />
      <Textarea
        label="Reason"
        required
        rows={2}
        maxLength={500}
        value={reason}
        error={fields['reason']}
        onChange={(event) => setReason(event.target.value)}
      />
      <Callout icon={Info} surface="info" size="compact" title="Prorated impact">
        <span data-testid="billing-date-impact">
          {!date
            ? 'Choose the new date to see the impact.'
            : amount > 0
              ? `${days} more ${days === 1 ? 'day' : 'days'}: ${money(amount)} ${CHARGES_CARD ? `is added to the invoice on ${dayText(date)}` : 'is invoiced today'}.`
              : amount < 0
                ? `${-days} fewer ${days === -1 ? 'day' : 'days'}: a credit of ${money(-amount)} applies.`
                : 'No proration is due.'}
        </span>
      </Callout>
    </ActionForm>
  );
}

export function BillingDateDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Change Billing Date" subtitle={firm} onClose={onClose}>
      {(sub) => <BillingDateForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

/** Retry the failed charge now; a decline keeps the status and says so. */
function RetryForm({ sub, onClose, onDone }: FormProps) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const retry = useAct((id: string) => adminSubscriptions.retryPayment({ id }));
  const blocked =
    notIn(sub, ['PAST_DUE', 'SUSPENDED'], 'Retrying the payment') ??
    (sub.amountDueCents > 0 ? null : 'Nothing is due.');
  return (
    <ActionForm
      submitLabel="Retry Payment"
      pending={retry.isPending}
      error={retry.error}
      blocked={blocked}
      outcome={outcome}
      onCancel={onClose}
      onSubmit={() => {
        setOutcome(null);
        retry.mutate(sub.id, {
          onSuccess: (result) => (result.ok ? onDone(result.message) : setOutcome(result.message)),
        });
      }}
    >
      <InfoBox tone="warning" title="Charge now">
        {money(sub.amountDueCents)} to{' '}
        {sub.card ? `${sub.card.brand} •••• ${sub.card.last4}` : 'no card on file'}.
        {/* The attempt and the grace period only when they are kept (the API keeps neither). */}
        {sub.pastDue?.graceEndsOn
          ? ` Attempt ${sub.pastDue.attempts + 1}; the grace period ${sub.pastDue.graceEndsOn >= sub.today ? 'ends' : 'ended'} ${dayText(sub.pastDue.graceEndsOn)}.`
          : ''}
      </InfoBox>
      {sub.card ? null : (
        <Callout icon={WarningCircle} surface="warning" tone="amber" size="compact">
          There is no card on file: send a payment link instead.
        </Callout>
      )}
      <p className="text-xs text-muted">
        Paid before suspension, the subscription returns to Active. Paid while suspended, reactivate
        it afterwards.
      </p>
    </ActionForm>
  );
}

export function RetryDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Retry Payment" subtitle={firm} onClose={onClose}>
      {(sub) => <RetryForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}
