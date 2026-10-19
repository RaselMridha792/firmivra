'use client';

import {
  Badge,
  Button,
  Callout,
  Textarea,
  Timeline,
  Toggle,
  type TimelineItem,
} from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  ArrowsDownUp,
  CalendarCheck,
  CalendarPlus,
  CheckCircle,
  ClockCounterClockwise,
  Flask,
  LinkSimple,
  ListChecks,
  PaperPlaneTilt,
  Pause,
  Play,
  Plus,
  Prohibit,
  PuzzlePiece,
  Tag,
  UserSwitch,
  UsersThree,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../../../../lib/errors';
import {
  ADDONS,
  adminSubscriptions,
  CHANGEABLE,
  discountRuns,
  PLANS,
  REACTIVATABLE,
  SUSPENDABLE,
  SUSPENSION_LABELS,
  type SubscriptionDetail,
  type SubscriptionEvent,
  type UsageLimit,
} from '../../../../../mocks/admin-subscriptions';
import {
  autoRenewEditable,
  autoRenewLock,
  clockText,
  dayText,
  fieldErrors,
  money,
  planText,
  priceText,
  timeText,
} from './format';
import { Fact, InfoBox, LinkButton, StatusBadge, UsageBar, useAct } from './parts';
import type { PanelActions } from './subscription-panel';

interface TabProps {
  sub: SubscriptionDetail;
  actions: PanelActions;
}

const CARD_BADGE = 'rounded-sm border border-divider px-1.5 text-xs font-bold text-heading italic';

function CardText({ sub }: { sub: SubscriptionDetail }) {
  if (!sub.card) return <span className="text-muted">None on file</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={CARD_BADGE}>{sub.card.brand.toUpperCase()}</span>
      <span>
        <span aria-hidden>••••</span>
        <span className="sr-only">ending in</span> {sub.card.last4}
      </span>
    </span>
  );
}

/** One line under the Status badge: what the status means for this firm right now. */
function statusDetail(sub: SubscriptionDetail): string | null {
  if (sub.status === 'PAST_DUE' && sub.pastDue)
    return `${money(sub.amountDueCents)} due · ${sub.pastDue.nextRetryOn ? `next retry ${dayText(sub.pastDue.nextRetryOn)}` : 'no automatic retry left'}`;
  if (sub.status === 'SUSPENDED' && sub.suspension)
    return `${SUSPENSION_LABELS[sub.suspension.kind]} since ${dayText(sub.suspension.since)}: ${sub.suspension.reason}`;
  if (sub.status === 'NON_RENEWING') return `Access continues until ${dayText(sub.endsOn)}`;
  if (sub.status === 'TRIAL' && !sub.autoRenew)
    return `Won’t convert: access ends ${dayText(sub.endsOn)}`;
  return null;
}

function SupportViewNotice({ sub, actions }: TabProps) {
  const end = useAct((id: string) => adminSubscriptions.endSupportView({ id }));
  if (!sub.supportView) return null;
  return (
    <Callout
      icon={UserSwitch}
      surface="warning"
      tone="amber"
      size="compact"
      title="Support view active"
    >
      <span>
        Until {clockText(sub.supportView.until)} · {sub.supportView.reason}
      </span>
      <span>
        <LinkButton
          disabled={end.isPending}
          onClick={() =>
            end.mutate(sub.id, { onSuccess: (result) => actions.onToast(result.message) })
          }
        >
          End support view
        </LinkButton>
      </span>
      {end.error ? <span className="text-danger">{errorMessage(end.error)}</span> : null}
    </Callout>
  );
}

export function OverviewTab({ sub, actions, more }: TabProps & { more: ReactNode }) {
  const act = (kind: Parameters<PanelActions['onAction']>[0]) => () => actions.onAction(kind, sub);
  const changeable = CHANGEABLE.includes(sub.status);
  const ended = sub.status === 'CANCELLED' || sub.status === 'CLOSED' || sub.status === 'EXPIRED';
  const reversible = !sub.autoRenew && (sub.status === 'NON_RENEWING' || sub.status === 'TRIAL');
  const detail = statusDetail(sub);
  return (
    <div className="flex flex-col gap-4">
      <SupportViewNotice sub={sub} actions={actions} />
      <dl className="flex flex-col">
        <Fact
          label="Plan"
          action={
            changeable ? <LinkButton onClick={act('changePlan')}>Change Plan</LinkButton> : null
          }
        >
          {planText(sub.plan, sub.cycle)}
        </Fact>
        <Fact label="Price">
          {priceText(sub.monthlyCents, sub.cycle)}
          {discountRuns(sub.discount, sub.today) ? (
            <span className="block text-xs text-success">
              After discount: {money(sub.netMonthlyCents)}/mo
              {sub.discount.endsOn ? ` until ${dayText(sub.discount.endsOn)}` : ''}
            </span>
          ) : null}
        </Fact>
        <Fact label="Start Date">{dayText(sub.startedOn)}</Fact>
        <Fact label="Next Billing Date">
          {sub.nextBillingOn ? dayText(sub.nextBillingOn) : 'None scheduled'}
        </Fact>
        <Fact label={ended ? 'End Date' : sub.endsOn ? 'Access Ends' : 'Renewal Date'}>
          {sub.endsOn ? dayText(sub.endsOn) : sub.renewalOn ? dayText(sub.renewalOn) : '—'}
        </Fact>
        {sub.paidThroughOn && sub.status !== 'ACTIVE' && sub.status !== 'TRIAL' ? (
          <Fact label="Paid Through">{dayText(sub.paidThroughOn)}</Fact>
        ) : null}
        {sub.trial ? (
          <Fact label="Trial">
            {sub.trial.convertedOn
              ? `Converted ${dayText(sub.trial.convertedOn)}`
              : sub.status === 'TRIAL'
                ? `Ends ${dayText(sub.trial.endsOn)} · ${sub.trial.daysLeft} ${sub.trial.daysLeft === 1 ? 'day' : 'days'} left`
                : `Ended ${dayText(sub.trial.endsOn)}`}
            <span className="block text-xs text-muted">{sub.trial.followUp}</span>
          </Fact>
        ) : null}
        <Fact
          label="Seats"
          action={changeable ? <LinkButton onClick={act('seats')}>Manage Seats</LinkButton> : null}
        >
          {sub.seatsUsed} / {sub.seats}
        </Fact>
        <Fact label="Auto-Renew">
          <Toggle
            checked={sub.autoRenew}
            label="Auto-Renew"
            disabled={!autoRenewEditable(sub)}
            title={autoRenewLock(sub)}
            onChange={() => actions.onAutoRenew(sub)}
          />
        </Fact>
        <Fact
          label="Payment Method"
          action={
            sub.status === 'CLOSED' ? null : (
              <LinkButton onClick={act('cardUpdate')}>Update</LinkButton>
            )
          }
        >
          <CardText sub={sub} />
        </Fact>
        <Fact
          label="Promo / Discount"
          action={
            ended ? null : (
              <LinkButton onClick={act('discount')}>
                {sub.discount ? 'Change' : 'Add Discount'}
              </LinkButton>
            )
          }
        >
          {sub.discount ? <Badge tone="success">{sub.discount.label}</Badge> : '—'}
          {sub.creditCents > 0 ? (
            <span className="block text-xs text-muted">
              {money(sub.creditCents)} account credit
            </span>
          ) : null}
        </Fact>
        <Fact
          label="Add-ons"
          action={changeable ? <LinkButton onClick={act('addons')}>Manage</LinkButton> : null}
        >
          {sub.addons.length ? (
            <span className="flex flex-wrap gap-1.5">
              {sub.addons.map((id) => (
                <Badge key={id} tone="info">
                  {ADDONS[id].name}
                </Badge>
              ))}
            </span>
          ) : (
            'None'
          )}
        </Fact>
        <Fact label="Account Owner">{sub.accountOwner ?? 'Not assigned'}</Fact>
        <Fact label="Status">
          <StatusBadge status={sub.status} />
          {detail ? <span className="mt-1 block text-xs text-muted">{detail}</span> : null}
        </Fact>
      </dl>
      {sub.scheduled.length ? (
        <InfoBox title="Scheduled changes" tone="info">
          <ul className="flex flex-col gap-1">
            {sub.scheduled.map((change) => (
              <li key={change.id}>
                {dayText(change.on)}: {change.summary}
              </li>
            ))}
          </ul>
        </InfoBox>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={act('changePlan')} disabled={!changeable}>
          <ArrowsDownUp aria-hidden weight="bold" className="size-5 shrink-0" />
          Change Plan
        </Button>
        <Button variant="outline" onClick={act('addons')} disabled={!changeable}>
          <Plus aria-hidden weight="bold" className="size-5 shrink-0" />
          Add Add-ons
        </Button>
        <Button
          variant="outline"
          onClick={act('extendTrial')}
          disabled={sub.status !== 'TRIAL'}
          title={sub.status === 'TRIAL' ? undefined : 'Only for subscriptions in Trial'}
        >
          <CalendarPlus aria-hidden weight="fill" className="size-5 shrink-0" />
          Extend Trial
        </Button>
        {REACTIVATABLE.includes(sub.status) ? (
          <Button variant="outline" onClick={act('reactivate')}>
            <Play aria-hidden weight="fill" className="size-5 shrink-0" />
            Reactivate
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={act('suspend')}
            disabled={!SUSPENDABLE.includes(sub.status)}
          >
            <Pause aria-hidden weight="fill" className="size-5 shrink-0" />
            Pause / Suspend
          </Button>
        )}
        {reversible ? (
          <Button variant="outline" className="col-span-2" onClick={act('reverse')}>
            <ArrowCounterClockwise aria-hidden weight="bold" className="size-5 shrink-0" />
            Reverse Cancellation
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="col-span-2 border-danger! text-danger! hover:bg-danger-soft! disabled:border-border! disabled:bg-surface! disabled:text-muted!"
            disabled={!(sub.status === 'ACTIVE' && sub.autoRenew)}
            onClick={act('cancel')}
          >
            <Prohibit aria-hidden weight="bold" className="size-5 shrink-0" />
            Cancel at Period End
          </Button>
        )}
      </div>
      <div className="flex justify-center">{more}</div>
    </div>
  );
}

function UsageRow({ usage, trial }: { usage: UsageLimit; trial: boolean }) {
  const percent = usage.limit ? Math.round((usage.used / usage.limit) * 100) : 0;
  const amount = (value: number) => value.toLocaleString('en-US');
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-heading">{usage.label}</span>
        <span className="text-text">
          {usage.limit
            ? `${amount(usage.used)} / ${amount(usage.limit)} ${usage.unit}`
            : `${amount(usage.used)} ${usage.unit}`}
        </span>
      </div>
      {usage.limit ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <UsageBar
            percent={percent}
            tone={trial ? 'trial' : percent >= 90 ? 'high' : 'normal'}
            label={`${usage.label} used`}
            className="w-full"
          />
          <span className="w-10 shrink-0 text-right">{percent}%</span>
        </div>
      ) : (
        <p className="text-xs text-muted">
          Not included in this plan. The SMS Package adds 1,000 a month.
        </p>
      )}
      {usage.limit && percent >= 80 ? (
        <p
          className={`flex items-center gap-1 text-xs font-medium ${percent >= 100 ? 'text-danger' : 'text-warning'}`}
        >
          <WarningCircle aria-hidden weight="fill" className="size-4" />
          {percent > 100
            ? 'Over the limit'
            : percent === 100
              ? 'At the limit'
              : 'Approaching the limit'}
        </p>
      ) : null}
    </li>
  );
}

export function UsageTab({ sub, actions }: TabProps) {
  const changeable = CHANGEABLE.includes(sub.status);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        {PLANS[sub.plan].name} allowances, with add-ons. Client records are never counted here.
      </p>
      <ul className="flex flex-col gap-4">
        {sub.usage.map((usage) => (
          <UsageRow key={usage.id} usage={usage} trial={sub.status === 'TRIAL'} />
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={!changeable}
          onClick={() => actions.onAction('seats', sub)}
        >
          <UsersThree aria-hidden weight="fill" className="size-5 text-action" />
          Manage Seats
        </Button>
        <Button
          variant="secondary"
          disabled={!changeable}
          onClick={() => actions.onAction('addons', sub)}
        >
          <PuzzlePiece aria-hidden weight="fill" className="size-5 text-action" />
          Manage Add-ons
        </Button>
      </div>
    </div>
  );
}

const invoiceTone = { PAID: 'success', OPEN: 'warning', FAILED: 'danger' } as const;
const invoiceLabel = { PAID: 'Paid', OPEN: 'Open', FAILED: 'Failed' } as const;

export function BillingTab({ sub, actions }: TabProps) {
  const act = (kind: Parameters<PanelActions['onAction']>[0]) => () => actions.onAction(kind, sub);
  const live = sub.status !== 'CLOSED';
  return (
    <div className="flex flex-col gap-5">
      <dl className="flex flex-col">
        <Fact
          label="Payment Method"
          action={live ? <LinkButton onClick={act('cardUpdate')}>Update</LinkButton> : null}
        >
          <CardText sub={sub} />
        </Fact>
        <Fact label="Amount Due">
          <span
            data-testid="amount-due"
            className={sub.amountDueCents > 0 ? 'font-semibold text-danger' : ''}
          >
            {money(sub.amountDueCents)}
          </span>
        </Fact>
        <Fact label="Account Credit">{money(sub.creditCents)}</Fact>
        <Fact label="Next Billing Date">
          {sub.nextBillingOn ? dayText(sub.nextBillingOn) : 'None scheduled'}
        </Fact>
        <Fact label="Discount">{sub.discount ? sub.discount.label : '—'}</Fact>
      </dl>
      {sub.pastDue && sub.amountDueCents > 0 ? (
        <Callout
          icon={WarningCircle}
          surface="warning"
          tone="amber"
          size="compact"
          title={`Payment failed ${dayText(sub.pastDue.failedOn)}`}
        >
          <span>
            {money(sub.amountDueCents)} due · attempt {sub.pastDue.attempts} of{' '}
            {sub.pastDue.maxAttempts} ·{' '}
            {sub.pastDue.nextRetryOn
              ? `next retry ${dayText(sub.pastDue.nextRetryOn)}`
              : 'no automatic retry left'}{' '}
            · grace period {sub.pastDue.graceEndsOn >= sub.today ? 'ends' : 'ended'}{' '}
            {dayText(sub.pastDue.graceEndsOn)}
          </span>
          <span className="text-muted">Processor: {sub.pastDue.response}</span>
          <span className="mt-1 flex flex-wrap gap-2">
            <Button onClick={act('retry')}>Retry Payment</Button>
            <Button variant="secondary" onClick={act('paymentLink')}>
              Send Payment Link
            </Button>
          </span>
        </Callout>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={act('resendInvoice')} disabled={!sub.invoices.length}>
          <PaperPlaneTilt aria-hidden weight="fill" className="size-4 text-action" />
          Resend Invoice
        </Button>
        <Button variant="secondary" onClick={act('paymentLink')} disabled={!live}>
          <LinkSimple aria-hidden weight="bold" className="size-4 text-action" />
          Send Payment Link
        </Button>
        <Button variant="secondary" onClick={act('discount')} disabled={!live}>
          <Tag aria-hidden weight="fill" className="size-4 text-action" />
          Apply Credit / Discount
        </Button>
        <Button variant="secondary" onClick={act('billingDate')} disabled={!sub.nextBillingOn}>
          <CalendarCheck aria-hidden weight="fill" className="size-4 text-action" />
          Change Billing Date
        </Button>
      </div>
      <section aria-label="Invoices">
        <h3 className="mb-1 text-sm font-semibold text-heading">Invoices</h3>
        {sub.invoices.length ? (
          <ul className="divide-y divide-divider">
            {sub.invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-heading">{invoice.number}</span>
                  <span className="block text-xs text-muted">
                    {dayText(invoice.issuedOn)} · {invoice.description}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {money(invoice.amountCents)}
                  <Badge tone={invoiceTone[invoice.status]}>{invoiceLabel[invoice.status]}</Badge>
                </span>
                <LinkButton onClick={() => actions.onAction('resendInvoice', sub, invoice.id)}>
                  Resend
                </LinkButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No invoices yet.</p>
        )}
      </section>
      <section aria-label="Payment history">
        <h3 className="mb-1 text-sm font-semibold text-heading">Payment History</h3>
        {sub.payments.length ? (
          <ul className="divide-y divide-divider">
            {sub.payments.map((payment) => (
              <li key={payment.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block text-heading">
                    {dayText(payment.on)} · {payment.method}
                  </span>
                  <span className="block text-xs text-muted wrap-anywhere">
                    {payment.reference}
                    {payment.message ? ` · ${payment.message}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {money(payment.amountCents)}
                  <Badge tone={payment.result === 'SUCCEEDED' ? 'success' : 'danger'}>
                    {payment.result === 'SUCCEEDED' ? 'Succeeded' : 'Failed'}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No payments yet.</p>
        )}
      </section>
    </div>
  );
}

/** The icon and colour of a history entry, from what happened. */
function eventLook(event: SubscriptionEvent): { icon: Icon; tone: TimelineItem['tone'] } {
  const action = event.action.toLowerCase();
  if (action.includes('failed')) return { icon: WarningCircle, tone: 'red' };
  if (action.includes('trial')) return { icon: Flask, tone: 'purple' };
  if (/closed|ended|expired|closure/.test(action)) return { icon: Prohibit, tone: 'red' };
  if (/suspend|paused/.test(action)) return { icon: Pause, tone: 'amber' };
  if (/auto-renew|cancellation/.test(action)) return { icon: ArrowsClockwise, tone: 'navy' };
  if (action.includes('plan')) return { icon: ArrowsDownUp, tone: 'blue' };
  if (action.includes('seats')) return { icon: UsersThree, tone: 'blue' };
  if (action.includes('add-ons')) return { icon: PuzzlePiece, tone: 'blue' };
  if (/discount|credit/.test(action)) return { icon: Tag, tone: 'green' };
  if (action.includes('billing date')) return { icon: CalendarCheck, tone: 'blue' };
  if (/invoice|link/.test(action)) return { icon: PaperPlaneTilt, tone: 'grey' };
  if (/renewed|payment|started|converted|reactivated/.test(action))
    return { icon: action.includes('reactivated') ? Play : CheckCircle, tone: 'green' };
  return { icon: ClockCounterClockwise, tone: 'grey' };
}

export function HistoryTab({ sub, actions }: TabProps) {
  const items: TimelineItem[] = sub.events
    .filter((event) => event.category === 'LIFECYCLE' || event.category === 'BILLING')
    .map((event) => {
      const look = eventLook(event);
      const change = [event.from, event.to].filter(Boolean).join(' → ');
      return {
        id: event.id,
        icon: look.icon,
        tone: look.tone,
        title: (
          <>
            <span className="font-medium">{event.action}</span>
            {change ? <span className="text-muted"> · {change}</span> : null}
            {event.amountCents ? (
              <span className="text-muted"> · {money(Math.abs(event.amountCents))}</span>
            ) : null}
            {event.reason ? <span className="block text-xs text-muted">{event.reason}</span> : null}
          </>
        ),
        time: timeText(event.at),
        dateTime: event.at,
        actor: event.actor,
      };
    });
  return (
    <div className="flex flex-col gap-4">
      <Timeline
        items={items}
        variant="plain"
        label="Subscription history"
        emptyText="No history yet."
      />
      <div>
        <Button variant="secondary" onClick={() => actions.onAction('activity', sub)}>
          <ListChecks aria-hidden weight="fill" className="size-4 text-action" />
          Open Activity Log
        </Button>
      </div>
    </div>
  );
}

export function NotesTab({ sub, actions }: TabProps) {
  const [text, setText] = useState('');
  const add = useAct((body: { id: string; text: string }) => adminSubscriptions.addNote(body));
  const fields = fieldErrors(add.error);
  return (
    <div className="flex flex-col gap-4">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate(
            { id: sub.id, text },
            {
              onSuccess: (result) => {
                setText('');
                actions.onToast(result.message);
              },
            },
          );
        }}
        className="flex flex-col gap-3"
      >
        <Textarea
          label="Add an internal note"
          rows={3}
          maxLength={1000}
          placeholder="Billing exceptions, cancellation requests, follow-ups…"
          value={text}
          error={fields['text']}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-xs text-muted">Internal only: the firm never sees these notes.</p>
        {add.error && !fields['text'] ? (
          <p role="alert" className="text-sm text-danger">
            {fields['form'] ?? errorMessage(add.error)}
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={add.isPending}>
            {add.isPending ? 'Saving…' : 'Add Note'}
          </Button>
        </div>
      </form>
      {sub.notes.length ? (
        <ul aria-label="Internal notes" className="flex flex-col gap-3">
          {sub.notes.map((note) => (
            <li key={note.id} className="rounded-lg border border-divider p-3">
              <p className="text-sm whitespace-pre-wrap text-text">{note.text}</p>
              <p className="mt-1 text-xs text-muted">
                {note.author} · <time dateTime={note.at}>{timeText(note.at)}</time>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No notes yet.</p>
      )}
    </div>
  );
}
