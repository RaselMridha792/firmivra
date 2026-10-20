'use client';

import { Badge, Button, Callout, Input, Select } from '@firmivra/ui';
import { Info, Minus, Plus, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { dayText, fieldErrors, money, planText, priceText, seatText } from './format';
import {
  ActionForm,
  ChoiceGroup,
  ChoicePill,
  DetailDialog,
  InfoBox,
  notIn,
  UsageBar,
  useAct,
  usageTone,
  type DialogProps,
  type FormProps,
} from './parts';
import {
  ADDON_ORDER,
  ADDONS,
  addMonths,
  addonOptions,
  adminSubscriptions,
  CHANGEABLE,
  CHARGES_CARD,
  CYCLE_LABELS,
  cycleMonths,
  planChoices,
  planName,
  planOf,
  previewChange,
  type AddonId,
  type BillingCycle,
  type ChangePreview,
  type Effective,
  type Plan,
  type PlanId,
  type SubscriptionDetail,
} from './subscriptions-api';

/** A plan with no seat ceiling (null) reads "20+ seats". */
const seatRange = (plan: Plan) =>
  plan.maxSeats === null
    ? `${plan.includedSeats}+ seats${plan.locations > 1 ? ` · ${plan.locations} locations` : ''}`
    : plan.locations > 1
      ? `${seatText(plan.maxSeats)} · ${plan.locations} locations`
      : plan.includedSeats === plan.maxSeats
        ? seatText(plan.maxSeats)
        : `${plan.includedSeats}–${plan.maxSeats} seats`;

/** "Immediately (prorated)" or "At next billing": not asked during a trial (nothing is billed). */
function EffectiveChoice({
  sub,
  value,
  onChange,
  error,
}: {
  sub: SubscriptionDetail;
  value: Effective;
  onChange: (value: Effective) => void;
  error?: string;
}) {
  if (sub.status === 'TRIAL') return null;
  return (
    <ChoiceGroup legend="Effective" error={error}>
      <ChoicePill
        name="effective"
        value="NOW"
        checked={value === 'NOW'}
        onChange={() => onChange('NOW')}
      >
        Immediately (prorated)
      </ChoicePill>
      {sub.nextBillingOn ? (
        <ChoicePill
          name="effective"
          value="NEXT_BILLING"
          checked={value === 'NEXT_BILLING'}
          onChange={() => onChange('NEXT_BILLING')}
        >
          At next billing ({dayText(sub.nextBillingOn)})
        </ChoicePill>
      ) : null}
    </ChoiceGroup>
  );
}

/** The financial impact, shown before the admin confirms (docx §9). */
function impactText(sub: SubscriptionDetail, preview: ChangePreview, effective: Effective): string {
  const price = priceText(preview.netMonthlyCents, preview.cycle);
  const dropped = preview.dropped.length
    ? ` ${preview.dropped.map((id) => ADDONS[id].name).join(' and ')} isn’t offered on ${planName(preview.plan)} and will be removed.`
    : '';
  if (sub.status === 'TRIAL')
    return `Nothing is charged during the trial. After it converts: ${price}.${dropped}`;
  if (effective === 'NEXT_BILLING')
    return `Nothing changes until ${dayText(sub.nextBillingOn)}. From then: ${price}.${dropped}`;
  const moved =
    preview.nextBillingOn && preview.nextBillingOn !== sub.nextBillingOn
      ? ` The billing date moves to ${dayText(preview.nextBillingOn)}.`
      : '';
  if (preview.amountCents > 0)
    return `The change is prorated: ${sub.firm.name} is charged ${money(preview.amountCents)} today for the rest of this cycle, then ${price}.${moved}${dropped}`;
  if (preview.amountCents < 0)
    return `The change is prorated: a credit of ${money(-preview.amountCents)} applies to the next invoice, then ${price}.${moved}${dropped}`;
  return `Nothing is due today. The new price is ${price}.${moved}${dropped}`;
}

function CurrentPlan({ sub }: { sub: SubscriptionDetail }) {
  return (
    <InfoBox title="Current Plan">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-heading">{planText(sub.plan, sub.cycle)}</p>
          <p>{priceText(sub.monthlyCents, sub.cycle)}</p>
          <p className="text-muted">
            {sub.seatsUsed ?? '—'} / {seatText(sub.seats)}
          </p>
        </div>
        <Badge tone="info">Current</Badge>
      </div>
    </InfoBox>
  );
}

/** Monthly or Annual; the Reactivate dialog reuses it for a restart. */
export function CyclePills({
  value,
  onChange,
  error,
}: {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  error?: string;
}) {
  return (
    <ChoiceGroup legend="Billing Cycle" error={error}>
      {(['MONTHLY', 'ANNUAL'] as const).map((cycle) => (
        <ChoicePill
          key={cycle}
          name="cycle"
          value={cycle}
          checked={value === cycle}
          onChange={() => onChange(cycle)}
        >
          {CYCLE_LABELS[cycle]}
        </ChoicePill>
      ))}
    </ChoiceGroup>
  );
}

function ChangePlanForm({ sub, onClose, onDone }: FormProps) {
  const [plan, setPlan] = useState<PlanId>(sub.plan);
  const [cycle, setCycle] = useState<BillingCycle>(sub.cycle);
  const [effective, setEffective] = useState<Effective>('NOW');
  const change = useAct(
    (body: { id: string; plan: PlanId; cycle: BillingCycle; effective: Effective }) =>
      adminSubscriptions.changePlan(body),
  );
  const fields = fieldErrors(change.error);
  const preview = previewChange(sub, { plan, cycle }, effective, sub.today);
  const same = plan === sub.plan && cycle === sub.cycle;
  return (
    <ActionForm
      submitLabel="Update Plan"
      pending={change.isPending}
      error={change.error}
      blocked={notIn(sub, CHANGEABLE, 'A plan change')}
      disabled={same || !!preview.blocked}
      onCancel={onClose}
      onSubmit={() =>
        change.mutate(
          { id: sub.id, plan, cycle, effective },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <CurrentPlan sub={sub} />
      <fieldset className="flex min-w-0 flex-col">
        <legend className="mb-2 text-sm font-semibold text-heading">Select New Plan</legend>
        <ul className="divide-y divide-divider rounded-lg border border-divider">
          {planChoices(sub.plan).map((info) => {
            const id = info.id;
            return (
              <li key={id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${plan === id ? 'bg-info-soft' : 'hover:bg-canvas'}`}
                >
                  <input
                    type="radio"
                    name="plan"
                    value={id}
                    checked={plan === id}
                    onChange={() => setPlan(id)}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1 font-medium text-heading">
                    {info.name}
                    {id === sub.plan ? (
                      <span className="font-normal text-muted"> (current)</span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end sm:flex-row sm:gap-6">
                    <span className="sm:w-28 sm:text-right">
                      {info.priceFrom ? 'From ' : ''}
                      {money(info.monthlyCents)}/mo
                    </span>
                    <span className="text-xs text-muted sm:w-36 sm:text-right sm:text-sm">
                      {seatRange(info)}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {fields['plan'] ? <p className="mt-1 text-xs text-danger">{fields['plan']}</p> : null}
      </fieldset>
      <CyclePills value={cycle} onChange={setCycle} error={fields['cycle']} />
      <EffectiveChoice
        sub={sub}
        value={effective}
        onChange={setEffective}
        error={fields['effective']}
      />
      {preview.blocked ? (
        <Callout
          icon={WarningCircle}
          surface="warning"
          tone="amber"
          size="compact"
          title="Not available"
        >
          {preview.blocked}
        </Callout>
      ) : same ? (
        <p className="text-sm text-muted">Choose a different plan or billing cycle.</p>
      ) : (
        <Callout
          icon={Info}
          surface="info"
          size="compact"
          title={effective === 'NOW' && sub.status !== 'TRIAL' ? 'Proration' : 'Price change'}
        >
          <span data-testid="plan-impact">{impactText(sub, preview, effective)}</span>
        </Callout>
      )}
    </ActionForm>
  );
}

export function ChangePlanDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Change Plan" subtitle={firm} onClose={onClose}>
      {(sub) => <ChangePlanForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

function SeatsForm({ sub, onClose, onDone }: FormProps) {
  const info = planOf(sub.plan);
  const [seats, setSeats] = useState(sub.seats);
  const [effective, setEffective] = useState<Effective>('NOW');
  const update = useAct((body: { id: string; seats: number; effective: Effective }) =>
    adminSubscriptions.updateSeats(body),
  );
  const fields = fieldErrors(update.error);
  const preview = previewChange(sub, { seats }, effective, sub.today);
  const included = info?.includedSeats ?? sub.seats;
  // No ceiling (null): the + button never stops.
  const ceiling = info?.maxSeats ?? Number.POSITIVE_INFINITY;
  const fixed = included === ceiling;
  const lowest = Math.max(included, sub.seatsUsed ?? 0);
  return (
    <ActionForm
      submitLabel="Update Seats"
      pending={update.isPending}
      error={update.error}
      blocked={
        notIn(sub, CHANGEABLE, 'A seat change') ??
        (!info
          ? 'Refresh to see this plan’s seats.'
          : fixed
            ? `${info.name} includes ${seatText(included)}. Change the plan to add seats.`
            : null)
      }
      disabled={seats === sub.seats || !!preview.blocked}
      onCancel={onClose}
      onSubmit={() =>
        update.mutate(
          { id: sub.id, seats, effective },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <InfoBox title="Current Usage">
        {sub.seatsUsed === null || sub.usagePercent === null ? (
          <p>{seatText(sub.seats)} allowed. Seats in use aren’t counted yet.</p>
        ) : (
          <>
            <p>
              {sub.seatsUsed} of {seatText(sub.seats)} used
            </p>
            <div className="mt-2 flex items-center gap-3">
              <UsageBar
                percent={sub.usagePercent}
                tone={usageTone(sub.status, sub.usagePercent)}
                label="Seats used"
                className="w-full"
              />
              <span className="shrink-0 font-medium text-heading">{sub.usagePercent}%</span>
            </div>
          </>
        )}
      </InfoBox>
      <fieldset className="flex min-w-0 flex-col items-center gap-2">
        <legend className="mb-2 self-start text-sm font-semibold text-heading">Update Seats</legend>
        <div className="flex items-start gap-2">
          <Button
            variant="secondary"
            aria-label="Remove a seat"
            disabled={seats <= lowest}
            onClick={() => setSeats(Math.max(lowest, seats - 1))}
          >
            <Minus aria-hidden weight="bold" className="size-5 text-action" />
          </Button>
          <div className="w-20">
            <Input
              label="Seats"
              hideLabel
              type="number"
              inputMode="numeric"
              min={lowest}
              max={info?.maxSeats ?? undefined}
              value={String(seats)}
              onChange={(event) => setSeats(Math.trunc(Number(event.target.value)))}
            />
          </div>
          <Button
            variant="secondary"
            aria-label="Add a seat"
            disabled={seats >= ceiling}
            onClick={() => setSeats(Math.min(ceiling, seats + 1))}
          >
            <Plus aria-hidden weight="bold" className="size-5 text-action" />
          </Button>
        </div>
        {info ? (
          <p className="text-center text-xs text-muted">
            {info.name}: {info.includedSeats} included,{' '}
            {info.maxSeats === null ? 'no ceiling' : `up to ${info.maxSeats}`} on this plan
            {info.extraSeatCents ? `; each extra seat ${money(info.extraSeatCents)}/mo` : ''}.
          </p>
        ) : null}
        {fields['seats'] ? <p className="text-xs text-danger">{fields['seats']}</p> : null}
      </fieldset>
      <EffectiveChoice
        sub={sub}
        value={effective}
        onChange={setEffective}
        error={fields['effective']}
      />
      {preview.blocked ? (
        <Callout
          icon={WarningCircle}
          surface="warning"
          tone="amber"
          size="compact"
          title="Not available"
        >
          {preview.blocked}
        </Callout>
      ) : (
        <Callout icon={Info} surface="info" size="compact" title="Updated Pricing">
          <span>
            {money(preview.netMonthlyCents)}/mo for {seatText(seats)}
            {sub.cycle === 'ANNUAL' ? ` (${money(preview.priceCents)}/yr)` : ''}
          </span>
          {seats === sub.seats ? null : (
            <span className="text-muted">{impactText(sub, preview, effective)}</span>
          )}
        </Callout>
      )}
    </ActionForm>
  );
}

export function SeatsDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Manage Seats" subtitle={firm} onClose={onClose}>
      {(sub) => <SeatsForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

function AddonsForm({ sub, onClose, onDone }: FormProps) {
  const [addons, setAddons] = useState<AddonId[]>(sub.addons);
  const [effective, setEffective] = useState<Effective>('NOW');
  const update = useAct((body: { id: string; addons: AddonId[]; effective: Effective }) =>
    adminSubscriptions.updateAddons(body),
  );
  const fields = fieldErrors(update.error);
  const preview = previewChange(sub, { addons }, effective, sub.today);
  const unchanged =
    ADDON_ORDER.filter((id) => addons.includes(id)).join() ===
    ADDON_ORDER.filter((id) => sub.addons.includes(id)).join();
  return (
    <ActionForm
      submitLabel="Update Add-ons"
      pending={update.isPending}
      error={update.error}
      blocked={notIn(sub, CHANGEABLE, 'An add-on change')}
      disabled={unchanged}
      onCancel={onClose}
      onSubmit={() =>
        update.mutate(
          { id: sub.id, addons, effective },
          { onSuccess: (result) => onDone(result.message) },
        )
      }
    >
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-heading">Add-ons</legend>
        {/* The rows (offered, description, price) are the adapter's: on the API only the
            Additional Location add-on is stored, the others read "Not available yet". */}
        {addonOptions(sub).map(({ id, name, description, monthlyCents, offered }) => {
          const on = addons.includes(id);
          return (
            <label
              key={id}
              className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${on ? 'border-action bg-info-soft' : 'border-divider'} ${offered ? 'cursor-pointer' : 'cursor-not-allowed text-muted'}`}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={!offered}
                onChange={(event) =>
                  setAddons(
                    event.target.checked ? [...addons, id] : addons.filter((other) => other !== id),
                  )
                }
                className="mt-0.5 size-4 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className={`block font-medium ${offered ? 'text-heading' : ''}`}>{name}</span>
                <span className="block text-xs text-muted">{description}</span>
              </span>
              <span className="shrink-0">
                {monthlyCents === null ? '—' : `${money(monthlyCents)}/mo`}
              </span>
            </label>
          );
        })}
        {fields['addons'] ? <p className="text-xs text-danger">{fields['addons']}</p> : null}
      </fieldset>
      <EffectiveChoice
        sub={sub}
        value={effective}
        onChange={setEffective}
        error={fields['effective']}
      />
      <Callout icon={Info} surface="info" size="compact" title="Updated Pricing">
        <span>
          Recurring price: {money(preview.oldNetMonthlyCents)}/mo → {money(preview.netMonthlyCents)}
          /mo
        </span>
        {unchanged ? null : (
          <span className="text-muted">{impactText(sub, preview, effective)}</span>
        )}
      </Callout>
    </ActionForm>
  );
}

export function AddonsDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Manage Add-ons" subtitle={firm} onClose={onClose}>
      {(sub) => <AddonsForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}

function ConvertForm({ sub, onClose, onDone }: FormProps) {
  const [plan, setPlan] = useState<PlanId>(sub.plan);
  const [cycle, setCycle] = useState<BillingCycle>(sub.cycle);
  const [outcome, setOutcome] = useState<string | null>(null);
  const convert = useAct((body: { id: string; plan: PlanId; cycle: BillingCycle }) =>
    adminSubscriptions.convertToPaid(body),
  );
  const fields = fieldErrors(convert.error);
  const preview = previewChange(sub, { plan, cycle }, 'NOW', sub.today);
  const first = preview.priceCents;
  const choices = planChoices(sub.plan);
  return (
    <ActionForm
      submitLabel="Convert to Paid"
      pending={convert.isPending}
      error={convert.error}
      blocked={notIn(sub, ['TRIAL'], 'Converting to paid')}
      outcome={outcome}
      disabled={!!preview.blocked}
      onCancel={onClose}
      onSubmit={() => {
        setOutcome(null);
        convert.mutate(
          { id: sub.id, plan, cycle },
          {
            onSuccess: (result) =>
              result.ok ? onDone(result.message) : setOutcome(result.message),
          },
        );
      }}
    >
      <InfoBox tone="info" title="Current Trial">
        {sub.trial
          ? `${planText(sub.plan, sub.cycle)} · ends ${dayText(sub.trial.endsOn)} (${sub.trial.daysLeft} days left)`
          : planText(sub.plan, sub.cycle)}
      </InfoBox>
      <Select
        label="Paid plan"
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
      {/* The mock charges the card on file; the API makes the firm Active and invoices it. */}
      <Callout icon={Info} surface="info" size="compact" title="First charge">
        <span data-testid="convert-impact">
          {CHARGES_CARD ? (
            <>
              {money(first)} today to{' '}
              {sub.card ? `${sub.card.brand} •••• ${sub.card.last4}` : 'the payment method'}
            </>
          ) : (
            `${money(first)} is invoiced today`
          )}
          , then {priceText(preview.netMonthlyCents, cycle)} from{' '}
          {dayText(addMonths(sub.today, cycleMonths(cycle)))}.
        </span>
        <span className="text-muted">
          {CHARGES_CARD
            ? 'The firm becomes Active only when this charge succeeds.'
            : 'The firm becomes Active today; the invoice stays open until it is paid in Billing.'}
        </span>
      </Callout>
      {sub.card || !CHARGES_CARD ? null : (
        <Callout icon={WarningCircle} surface="warning" tone="amber" size="compact">
          There is no payment method on file, so the conversion will fail. Send a payment link
          first.
        </Callout>
      )}
    </ActionForm>
  );
}

export function ConvertDialog({ id, firm, onClose, onDone }: DialogProps) {
  return (
    <DetailDialog id={id} title="Convert to Paid" subtitle={firm} onClose={onClose}>
      {(sub) => <ConvertForm sub={sub} onClose={onClose} onDone={onDone} />}
    </DetailDialog>
  );
}
