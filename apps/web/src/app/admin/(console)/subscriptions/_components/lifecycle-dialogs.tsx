'use client';

import { Callout, Checkbox, Input, Select, Textarea } from '@firmivra/ui';
import { Info, Warning, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { dayText, fieldErrors, longDayText, money, priceText } from './format';
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
import { CyclePills } from './plan-dialogs';
import {
  addDays,
  adminSubscriptions,
  CHARGES_CARD,
  NOTIFIES_FIRM,
  planChoices,
  previewChange,
  REACTIVATABLE,
  REQUEST_SOURCES,
  STATUS_LABELS,
  SUSPENDABLE,
  SUSPENSION_LABELS,
  type BillingCycle,
  type Effective,
  type PlanId,
  type RequestSource,
  type SuspensionKind,
} from './subscriptions-api';

const PRESETS = ['7', '14', '30'] as const;

function ExtendTrialForm({ sub, onClose, onDone }: FormProps) {
  const [choice, setChoice] = useState<string>('14');
  const [days, setDays] = useState('14');
  const [reason, setReason] = useState('');
  // The API sends no firm email yet (note 18): the box starts clear there, and ticked answers 422.
  const [notifyFirm, setNotifyFirm] = useState(NOTIFIES_FIRM);
  const extend = useAct((body: { id: string; days: number; reason: string; notifyFirm: boolean }) =>
    adminSubscriptions.extendTrial(body),
  );
  const fields = fieldErrors(extend.error);
  const count = Number(days);
  const newEnd =
    sub.trial && Number.isInteger(count) && count > 0 && count <= 60
      ? addDays(sub.trial.endsOn, count)
      : null;
  return (
    <ActionForm
      submitLabel="Extend Trial"
      pending={extend.isPending}
      error={extend.error}
      blocked={notIn(sub, ['TRIAL'], 'Extending the trial')}
      onCancel={onClose}
      onSubmit={() =>
        extend.mutate(
          { id: sub.id, days: count, reason, notifyFirm },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <InfoBox tone="info" title="Current Trial">
        {sub.trial
          ? `Ends ${dayText(sub.trial.endsOn)} (${sub.trial.daysLeft} ${sub.trial.daysLeft === 1 ? 'day' : 'days'} left)`
          : 'No trial'}
      </InfoBox>
      <ChoiceGroup legend="Add Additional Days" error={fields['days']}>
        {[...PRESETS, 'CUSTOM'].map((value) => (
          <ChoicePill
            key={value}
            name="trial-days"
            value={value}
            checked={choice === value}
            onChange={(picked) => {
              setChoice(picked);
              if (picked !== 'CUSTOM') setDays(picked);
            }}
          >
            {value === 'CUSTOM' ? 'Custom' : `${value} days`}
          </ChoicePill>
        ))}
      </ChoiceGroup>
      <div className="flex items-end gap-2">
        <div className="w-28">
          <Input
            label="Days to add"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            value={days}
            onChange={(event) => {
              setDays(event.target.value);
              setChoice(PRESETS.find((preset) => preset === event.target.value) ?? 'CUSTOM');
            }}
          />
        </div>
        <span className="pb-2 text-sm text-muted">days</span>
      </div>
      <p className="text-sm text-text">
        New end date:{' '}
        <strong data-testid="trial-new-end" className="text-heading">
          {newEnd ? dayText(newEnd) : '—'}
        </strong>
      </p>
      <Textarea
        label="Reason"
        required
        rows={3}
        maxLength={500}
        placeholder="Add a reason for extending the trial..."
        value={reason}
        error={fields['reason']}
        onChange={(event) => setReason(event.target.value)}
      />
      <Checkbox
        label="Tell the firm about the new end date"
        checked={notifyFirm}
        onChange={(event) => setNotifyFirm(event.target.checked)}
      />
    </ActionForm>
  );
}

export function ExtendTrialDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Extend Trial" subtitle={firm} onClose={onClose}>
      {(sub) => <ExtendTrialForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

/**
 * Docx §6: Auto-Renew off and Cancel at Period End are one controlled client request: the
 * client-request confirmation, the source, notes and the exact access end date before confirming.
 */
function AutoRenewOffForm({ sub, mode, onClose, onDone }: FormProps & { mode: 'cancel' | 'off' }) {
  const [confirmed, setConfirmed] = useState(false);
  const [source, setSource] = useState<RequestSource | ''>('');
  const [notes, setNotes] = useState('');
  const turnOff = useAct(
    (body: { id: string; confirmed: boolean; source: RequestSource | ''; notes: string }) =>
      adminSubscriptions.turnOffAutoRenew(body),
  );
  const fields = fieldErrors(turnOff.error);
  const ends = sub.status === 'TRIAL' ? (sub.trial?.endsOn ?? null) : sub.nextBillingOn;
  const blocked =
    notIn(
      sub,
      mode === 'cancel' ? ['ACTIVE'] : ['ACTIVE', 'TRIAL'],
      mode === 'cancel' ? 'Cancel at Period End' : 'Turning off Auto-Renew',
    ) ??
    (sub.autoRenew
      ? null
      : 'Auto-Renew is already off. Use Reverse Cancellation to turn it back on.');
  return (
    <ActionForm
      submitLabel={mode === 'cancel' ? 'Confirm Cancellation' : 'Turn Off Auto-Renew'}
      tone="danger"
      pending={turnOff.isPending}
      error={turnOff.error}
      blocked={blocked}
      onCancel={onClose}
      onSubmit={() =>
        turnOff.mutate(
          { id: sub.id, confirmed, source, notes },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <div className="flex items-start gap-3 rounded-lg bg-danger-soft p-3 text-sm text-text">
        <Warning aria-hidden weight="fill" className="size-6 shrink-0 text-danger" />
        <div>
          <p className="font-semibold text-danger">
            {mode === 'cancel' ? 'Schedule Cancellation' : 'Turn Off Auto-Renew'}
          </p>
          <p>
            {sub.status === 'TRIAL'
              ? 'The trial will not convert to a paid plan.'
              : 'The subscription will not renew: it ends at the end of the current billing period.'}{' '}
            {sub.firm.name} keeps access until {dayText(ends)}.
          </p>
        </div>
      </div>
      <InfoBox tone="warning">
        <p className="text-center">Access will end on</p>
        <p data-testid="access-ends" className="text-center text-lg font-semibold text-gold">
          {longDayText(ends)}
        </p>
      </InfoBox>
      <div>
        <Checkbox
          label="I confirm the client requested that this subscription not renew / be cancelled at the end of the paid period."
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {fields['confirmed'] ? <p className="text-xs text-danger">{fields['confirmed']}</p> : null}
      </div>
      <Select
        label="Request source"
        required
        options={[
          { value: '', label: 'Select a source...' },
          ...Object.entries(REQUEST_SOURCES).map(([value, label]) => ({ value, label })),
        ]}
        value={source}
        error={fields['source']}
        onChange={(event) =>
          setSource(
            (Object.keys(REQUEST_SOURCES) as RequestSource[]).find(
              (key) => key === event.target.value,
            ) ?? '',
          )
        }
      />
      <Textarea
        label="Request notes"
        required
        rows={3}
        maxLength={500}
        placeholder="What the client asked for, and when..."
        value={notes}
        error={fields['notes']}
        onChange={(event) => setNotes(event.target.value)}
      />
      <p className="text-xs text-muted">
        {NOTIFIES_FIRM ? 'The firm is told the exact end date, and this' : 'This'} request is kept
        in the history for good.
      </p>
    </ActionForm>
  );
}

export function CancelDialog({
  id,
  firm,
  onClose,
  onDone,
  mode,
}: DialogProps & { mode: 'cancel' | 'off' }) {
  return (
    <DetailDialog
      id={id}
      title={mode === 'cancel' ? 'Cancel at Period End' : 'Turn Off Auto-Renew'}
      subtitle={firm}
      onClose={onClose}
    >
      {(sub) => <AutoRenewOffForm sub={sub} mode={mode} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

/** A reversal turns Auto-Renew back on only when that is explicitly chosen here. */
function ReverseForm({ sub, onClose, onDone }: FormProps) {
  const [autoRenewOn, setAutoRenewOn] = useState(false);
  const [reason, setReason] = useState('');
  const reverse = useAct((body: { id: string; autoRenewOn: boolean; reason: string }) =>
    adminSubscriptions.reverseCancellation(body),
  );
  const fields = fieldErrors(reverse.error);
  const blocked =
    notIn(sub, ['NON_RENEWING', 'TRIAL'], 'Reversing the cancellation') ??
    (sub.autoRenew ? 'Nothing is scheduled to end: Auto-Renew is on.' : null);
  return (
    <ActionForm
      submitLabel="Reverse Cancellation"
      pending={reverse.isPending}
      error={reverse.error}
      blocked={blocked}
      onCancel={onClose}
      onSubmit={() =>
        reverse.mutate(
          { id: sub.id, autoRenewOn, reason },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <InfoBox tone="info" title="Scheduled to end">
        {sub.firm.name} {sub.status === 'TRIAL' ? 'leaves the trial' : 'stops'} on{' '}
        {dayText(sub.endsOn)} with Auto-Renew off.
      </InfoBox>
      <div>
        <Checkbox
          label={`Turn Auto-Renew back on. ${sub.status === 'TRIAL' ? `The trial converts on ${dayText(sub.endsOn)}` : `It renews on ${dayText(sub.endsOn)} at ${priceText(sub.netMonthlyCents, sub.cycle)}`}.`}
          checked={autoRenewOn}
          onChange={(event) => setAutoRenewOn(event.target.checked)}
        />
        {fields['autoRenewOn'] ? (
          <p className="text-xs text-danger">{fields['autoRenewOn']}</p>
        ) : null}
      </div>
      <Textarea
        label="Reason"
        required
        rows={3}
        maxLength={500}
        placeholder="Why the client changed their mind..."
        value={reason}
        error={fields['reason']}
        onChange={(event) => setReason(event.target.value)}
      />
    </ActionForm>
  );
}

export function ReverseDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Reverse Cancellation" subtitle={firm} onClose={onClose}>
      {(sub) => <ReverseForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

/** Pause and administrative suspension are told apart from a nonpayment suspension. */
function SuspendForm({ sub, onClose, onDone }: FormProps) {
  const [kind, setKind] = useState<SuspensionKind>(
    sub.status === 'PAST_DUE' ? 'NONPAYMENT' : 'ADMIN',
  );
  const [timing, setTiming] = useState<Effective>('NOW');
  const [reason, setReason] = useState('');
  const suspend = useAct(
    (body: { id: string; kind: SuspensionKind; reason: string; timing: Effective }) =>
      adminSubscriptions.suspend(body),
  );
  const fields = fieldErrors(suspend.error);
  const kinds: SuspensionKind[] =
    sub.status === 'PAST_DUE' ? ['PAUSE', 'ADMIN', 'NONPAYMENT'] : ['PAUSE', 'ADMIN'];
  const scheduleOn = sub.nextBillingOn ?? sub.endsOn;
  return (
    <ActionForm
      submitLabel={kind === 'PAUSE' ? 'Pause Subscription' : 'Suspend Subscription'}
      tone="danger"
      pending={suspend.isPending}
      error={suspend.error}
      blocked={notIn(sub, SUSPENDABLE, 'Suspending')}
      onCancel={onClose}
      onSubmit={() =>
        suspend.mutate(
          { id: sub.id, kind, reason, timing },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <ChoiceGroup legend="Type" error={fields['kind']}>
        {kinds.map((value) => (
          <ChoicePill
            key={value}
            name="suspension-kind"
            value={value}
            checked={kind === value}
            onChange={() => setKind(value)}
          >
            {value === 'PAUSE'
              ? 'Pause (firm request)'
              : value === 'ADMIN'
                ? 'Administrative'
                : 'Nonpayment'}
          </ChoicePill>
        ))}
      </ChoiceGroup>
      <ChoiceGroup legend="Effective" error={fields['timing']}>
        <ChoicePill
          name="suspension-timing"
          value="NOW"
          checked={timing === 'NOW'}
          onChange={() => setTiming('NOW')}
        >
          Immediately
        </ChoicePill>
        {scheduleOn ? (
          <ChoicePill
            name="suspension-timing"
            value="NEXT_BILLING"
            checked={timing === 'NEXT_BILLING'}
            onChange={() => setTiming('NEXT_BILLING')}
          >
            On {dayText(scheduleOn)}
          </ChoicePill>
        ) : null}
      </ChoiceGroup>
      <Textarea
        label="Reason"
        required
        rows={3}
        maxLength={500}
        placeholder={
          kind === 'PAUSE'
            ? 'What the firm asked for, and until when...'
            : 'Why the firm is suspended...'
        }
        value={reason}
        error={fields['reason']}
        onChange={(event) => setReason(event.target.value)}
      />
      <Callout
        icon={Info}
        surface="plain"
        tone="grey"
        size="compact"
        title={SUSPENSION_LABELS[kind]}
      >
        Firm access is restricted while suspended. All data is kept, billing stops
        {NOTIFIES_FIRM ? ' and the firm is notified' : ''}. You can reactivate from this page.
      </Callout>
    </ActionForm>
  );
}

export function SuspendDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Pause / Suspend" subtitle={firm} onClose={onClose}>
      {(sub) => <SuspendForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

/**
 * Suspended: back to Active once any balance is settled. Canceled or Expired: a controlled restart
 * on a plan, charged to the card on file. Closed accounts need a new subscription instead.
 */
function ReactivateForm({ sub, onClose, onDone }: FormProps) {
  const [reason, setReason] = useState('');
  const [paymentSettled, setPaymentSettled] = useState(false);
  const [plan, setPlan] = useState<PlanId>(sub.plan);
  const [cycle, setCycle] = useState<BillingCycle>(sub.cycle);
  const reactivate = useAct(
    (body: {
      id: string;
      reason: string;
      paymentSettled: boolean;
      plan?: PlanId;
      cycle?: BillingCycle;
    }) => adminSubscriptions.reactivate(body),
  );
  const fields = fieldErrors(reactivate.error);
  const suspended = sub.status === 'SUSPENDED';
  const needsPayment =
    suspended && (sub.amountDueCents > 0 || sub.suspension?.kind === 'NONPAYMENT');
  const preview = previewChange(sub, { plan, cycle }, 'NOW', sub.today);
  const choices = planChoices(sub.plan);
  const blocked =
    sub.status === 'CLOSED'
      ? 'A closed account can’t be reactivated here. Add a new subscription for the firm.'
      : notIn(sub, REACTIVATABLE, 'Reactivating');
  return (
    <ActionForm
      submitLabel="Reactivate"
      pending={reactivate.isPending}
      error={reactivate.error}
      blocked={blocked}
      onCancel={onClose}
      onSubmit={() =>
        reactivate.mutate(
          suspended
            ? { id: sub.id, reason, paymentSettled }
            : { id: sub.id, reason, paymentSettled: false, plan, cycle },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      {suspended && sub.suspension ? (
        <InfoBox tone="info" title={SUSPENSION_LABELS[sub.suspension.kind]}>
          <p>
            Since {dayText(sub.suspension.since)}: {sub.suspension.reason}
          </p>
          <p className="mt-1">
            Amount due: <strong className="text-heading">{money(sub.amountDueCents)}</strong>
          </p>
        </InfoBox>
      ) : (
        <InfoBox
          tone="info"
          title={`${STATUS_LABELS[sub.status]} ${dayText(sub.endedOn ?? sub.endsOn)}`}
        >
          Reactivating starts a new paid period today on the plan below,{' '}
          {CHARGES_CARD ? 'charged to the card on file' : 'with its first invoice'}.
        </InfoBox>
      )}
      {suspended ? null : (
        <>
          <Select
            label="Plan"
            options={choices.map((info) => ({
              value: info.id,
              label: `${info.name} · ${money(info.monthlyCents)}/mo`,
            }))}
            value={plan}
            error={fields['plan'] ?? preview.blocked ?? undefined}
            onChange={(event) =>
              setPlan(choices.find((info) => info.id === event.target.value)?.id ?? sub.plan)
            }
          />
          <CyclePills value={cycle} onChange={setCycle} error={fields['cycle']} />
          <Callout icon={Info} surface="info" size="compact" title="First charge">
            {CHARGES_CARD
              ? `${money(preview.priceCents)} today to ${sub.card ? `${sub.card.brand} •••• ${sub.card.last4}` : 'no card on file'}.`
              : `${money(preview.priceCents)} is invoiced today; it stays open until it is paid in Billing.`}
          </Callout>
          {sub.card || !CHARGES_CARD ? null : (
            <Callout icon={WarningCircle} surface="warning" tone="amber" size="compact">
              There is no payment method on file. Send a payment link first.
            </Callout>
          )}
        </>
      )}
      {needsPayment ? (
        <div>
          <Checkbox
            label={`Payment of ${money(sub.amountDueCents)} is received and settled.`}
            checked={paymentSettled}
            onChange={(event) => setPaymentSettled(event.target.checked)}
          />
          {fields['paymentSettled'] ? (
            <p className="text-xs text-danger">{fields['paymentSettled']}</p>
          ) : null}
        </div>
      ) : null}
      <Textarea
        label="Reason"
        required
        rows={3}
        maxLength={500}
        placeholder="Payment received, pause ended, firm asked to return..."
        value={reason}
        error={fields['reason']}
        onChange={(event) => setReason(event.target.value)}
      />
    </ActionForm>
  );
}

export function ReactivateDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Reactivate Subscription" subtitle={firm} onClose={onClose}>
      {(sub) => <ReactivateForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

/** A high-risk action: reason, effective date, the firm's name typed back and the impact reviewed. */
function CloseForm({ sub, onClose, onDone }: FormProps) {
  const [reason, setReason] = useState('');
  const [effectiveOn, setEffectiveOn] = useState(sub.today);
  const [confirmName, setConfirmName] = useState('');
  const [impactReviewed, setImpactReviewed] = useState(false);
  const close = useAct(
    (body: {
      id: string;
      reason: string;
      effectiveOn: string;
      confirmName: string;
      impactReviewed: boolean;
    }) => adminSubscriptions.closeAccount(body),
  );
  const fields = fieldErrors(close.error);
  return (
    <ActionForm
      submitLabel="Close Account"
      tone="danger"
      pending={close.isPending}
      error={close.error}
      blocked={sub.status === 'CLOSED' ? 'This account is already closed.' : null}
      onCancel={onClose}
      onSubmit={() =>
        close.mutate(
          { id: sub.id, reason, effectiveOn, confirmName, impactReviewed },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <div className="flex items-start gap-3 rounded-lg bg-danger-soft p-3 text-sm text-text">
        <Warning aria-hidden weight="fill" className="size-6 shrink-0 text-danger" />
        <div>
          <p className="font-semibold text-danger">This closes the firm’s account</p>
          <ul className="mt-1 list-disc pl-5">
            <li>Access to the workspace and client portal ends on the effective date.</li>
            <li>Billing stops; no further invoices are sent.</li>
            <li>Data is kept under the retention policy; nothing is deleted here.</li>
            <li>It is not a non-renewal: use Cancel at Period End for that.</li>
          </ul>
        </div>
      </div>
      <Textarea
        label="Reason"
        required
        rows={3}
        maxLength={500}
        value={reason}
        error={fields['reason']}
        onChange={(event) => setReason(event.target.value)}
      />
      <Input
        label="Effective date"
        type="date"
        required
        min={sub.today}
        value={effectiveOn}
        error={fields['effectiveOn']}
        onChange={(event) => setEffectiveOn(event.target.value)}
      />
      <Input
        label={`Type “${sub.firm.name}” to confirm`}
        required
        autoComplete="off"
        value={confirmName}
        error={fields['confirmName']}
        onChange={(event) => setConfirmName(event.target.value)}
      />
      <div>
        <Checkbox
          label="I reviewed the data and access impact."
          checked={impactReviewed}
          onChange={(event) => setImpactReviewed(event.target.checked)}
        />
        {fields['impactReviewed'] ? (
          <p className="text-xs text-danger">{fields['impactReviewed']}</p>
        ) : null}
      </div>
    </ActionForm>
  );
}

export function CloseDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Close Account" subtitle={firm} onClose={onClose}>
      {(sub) => <CloseForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}
