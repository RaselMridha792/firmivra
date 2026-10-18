'use client';

import type { TaxOpportunityDetail } from '@firmivra/types';
import { ActionMenu, Avatar, Button, Input, Modal, Select, Textarea, Toast } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  CalendarBlank,
  CheckCircle,
  Circle,
  DotsThreeVertical,
  Prohibit,
  Target,
  UserSwitch,
  Plus,
  Archive,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { Disclaimer } from './tp-shell';
import {
  CATEGORY_LABEL,
  OppPill,
  PriorityPill,
  TP_ERRORS,
  TP_KEY,
  card,
  dateTimeText,
  dayText,
  money,
  outlined,
  primary,
  quiet,
  subtle,
} from './tp-shared';

type Dialog = 'schedule' | 'assign' | 'na' | 'dismiss' | 'note' | 'implemented';

/** /tax-planning/opportunities/[id]: Planning Opportunity Details: review it, then act. Reading never changes it. */
export function OpportunityDetail({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const q = useApiQuery([...TP_KEY, 'opp', id], () => api.taxPlanning.opportunity(id));
  const events = useApiQuery([...TP_KEY, 'opp-events', id], () =>
    api.taxPlanning.opportunityEvents(id),
  );
  const team = useApiQuery([...TP_KEY, 'team'], () => api.team.list());
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [dialog, setDialog] = useState<Dialog>();
  const [planId, setPlanId] = useState('');
  const o: TaxOpportunityDetail | undefined = q.data;

  if (q.isError)
    return (
      <div className="flex flex-col gap-3" data-testid="opp-error">
        <Link href="/tax-planning/opportunities" className="text-sm font-medium text-link">
          ← Back to Tax Planning &amp; Strategy
        </Link>
        <p role="alert" className={quiet}>
          This opportunity is not available. It may have been removed, or we could not load it.
        </p>
      </div>
    );
  if (!o) return <p className={quiet}>Loading…</p>;

  const act = async (
    body: Parameters<typeof api.taxPlanning.opportunityAction>[1],
    done: string,
  ) => {
    try {
      await api.taxPlanning.opportunityAction(id, { ...body, etag: o.etag } as never);
      await qc.invalidateQueries({ queryKey: [...TP_KEY] });
      setMessage({ text: done, tone: 'success' });
      return true;
    } catch (e) {
      setMessage({ text: errorMessage(e, TP_ERRORS), tone: 'error' });
      return false;
    }
  };
  const open = !['NOT_APPLICABLE', 'DISMISSED', 'IMPLEMENTED', 'CLOSED'].includes(o.status);
  const imp = o.impact;
  const bp = (n: number | null) => (n === null ? '—' : `${(n / 100).toFixed(0)}%`);

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="opp-detail">
      <Link
        href="/tax-planning/opportunities"
        className="flex items-center gap-2 text-sm font-medium text-link"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Tax Planning &amp;
        Strategy
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <Target weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              Planning Opportunity Details
            </h1>
            <p className="text-base text-muted">
              Review the opportunity, see the potential tax impact, and take action.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={outlined}
            disabled={!o.previousId}
            onClick={() =>
              o.previousId && router.push(`/tax-planning/opportunities/${o.previousId}`)
            }
          >
            <ArrowLeft aria-hidden weight="bold" className="size-4" /> Previous
          </button>
          <button
            type="button"
            className={outlined}
            disabled={!o.nextId}
            onClick={() => o.nextId && router.push(`/tax-planning/opportunities/${o.nextId}`)}
          >
            Next <ArrowRight aria-hidden weight="bold" className="size-4" />
          </button>
          <ActionMenu
            label="More actions"
            trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
            align="right"
            sections={[
              {
                items: [
                  { label: 'Add Note', onSelect: () => setDialog('note') },
                  { label: 'Mark Implemented', onSelect: () => setDialog('implemented') },
                  o.status === 'NEW'
                    ? {
                        label: 'Start Review',
                        onSelect: () => void act({ action: 'START_REVIEW' }, 'Review started.'),
                      }
                    : open
                      ? { label: 'Close', onSelect: () => void act({ action: 'CLOSE' }, 'Closed.') }
                      : {
                          label: 'Reopen',
                          onSelect: () => void act({ action: 'REOPEN' }, 'Reopened.'),
                        },
                ],
              },
            ]}
          />
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <section
        className={`${card} flex flex-wrap items-center justify-between gap-4`}
        aria-label="Opportunity"
        data-testid="opp-banner"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl font-bold text-heading">{o.name}</h2>
            <span className="rounded-pill bg-info-soft px-3 py-1 text-xs font-semibold text-info">
              {CATEGORY_LABEL[o.category]}
            </span>
            <PriorityPill priority={o.priority} />
            <OppPill status={o.status} />
          </div>
          <p className="text-sm text-muted">{o.description}</p>
        </div>
        <div className="rounded-xl bg-info-soft p-4" data-testid="estimate">
          <p className="text-sm font-semibold text-heading">Estimated Tax Savings</p>
          <p className="font-display text-3xl font-bold text-action">
            {o.estimate.cents === null ? 'N/A' : money(o.estimate.cents)}
          </p>
          <p className="text-xs text-muted">
            {o.estimate.cents === null
              ? (o.estimate.unavailableReason ?? 'Not enough data.')
              : `${o.estimate.basis ?? ''}${o.estimate.dataYear ? ` (${o.estimate.dataYear})` : ''}`}
          </p>
        </div>
      </section>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-3">
        <section className={card} aria-label="Client information">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-heading">Client Information</h2>
            <Link href={`/clients/${o.client.id}`} className="text-sm font-medium text-link">
              Edit Client
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Avatar name={o.client.name} size="xl" />
            <div className="min-w-0 text-sm">
              <p className="font-display text-lg font-bold text-heading">{o.client.name}</p>
              <p className="text-muted">
                {o.client.accountType === 'BUSINESS' ? 'Business' : 'Individual'}
              </p>
              <p className="break-all">{o.client.email}</p>
              <p>{o.client.phone}</p>
            </div>
          </div>
        </section>
        <section className={card} aria-label="Why this opportunity">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">
            Why This Opportunity?
          </h2>
          <p className="text-sm text-text">
            {o.whyExplanation ?? 'The screening gave no explanation.'}
          </p>
          {o.missingData.length ? (
            <p
              className="mt-2 rounded-lg bg-warning-soft p-2 text-xs text-warning"
              data-testid="missing"
            >
              Missing data: {o.missingData.join(', ')}.
            </p>
          ) : null}
        </section>
        <section className={card} aria-label="Client data used" data-testid="data-used">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Client Data Used</h2>
          {o.clientDataUsed === null ? (
            <p className={quiet}>The financial figures are restricted for your role.</p>
          ) : (
            <dl className="divide-y divide-divider text-sm">
              {o.clientDataUsed.map((d) => (
                <div key={d.label} className="flex justify-between gap-3 py-1.5">
                  <dt className="text-muted">{d.label}</dt>
                  <dd className="font-medium text-heading">
                    {d.amountCents !== null ? money(d.amountCents) : d.text}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-1 text-xs text-muted">Tax year {o.taxYear}</p>
        </section>
      </div>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-3">
        <section className={card} aria-label="Estimated impact" data-testid="impact">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Estimated Impact</h2>
          {o.estimate.cents === null ? (
            <p className={quiet}>Not enough data to estimate the impact.</p>
          ) : (
            <dl className="divide-y divide-divider text-sm">
              <div className="flex justify-between py-1.5">
                <dt className="text-muted">Additional Contribution (Suggested)</dt>
                <dd className="font-medium text-heading">{money(imp.suggestedActionCents)}</dd>
              </div>
              <div className="flex justify-between py-1.5">
                <dt className="text-muted">Estimated Tax Savings</dt>
                <dd className="font-bold text-success">{money(o.estimate.cents)}</dd>
              </div>
              <div className="flex justify-between py-1.5">
                <dt className="text-muted">Estimated New Taxable Income</dt>
                <dd className="font-medium text-heading">{money(imp.newTaxableIncomeCents)}</dd>
              </div>
              <div className="flex justify-between py-1.5">
                <dt className="text-muted">Estimated Effective Tax Rate</dt>
                <dd className="font-medium text-heading">
                  {bp(imp.effectiveRateBeforeBp)} → {bp(imp.effectiveRateAfterBp)}
                </dd>
              </div>
            </dl>
          )}
          <div className="mt-2">
            <Disclaimer text={o.disclaimer} />
          </div>
        </section>
        <section className={card} aria-label="Recommended action">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Recommended Action</h2>
          <ol className="flex flex-col gap-2">
            {o.recommendedActions.map((a, i) => (
              <li key={a} className="flex gap-3 text-sm text-heading">
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-action text-xs text-on-action"
                >
                  {i + 1}
                </span>
                {a}
              </li>
            ))}
          </ol>
          {o.recommendedActions.length === 0 ? <p className={quiet}>No actions listed.</p> : null}
        </section>
        <section className={card} aria-label="Eligibility and assumptions">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">
            Eligibility &amp; Assumptions
          </h2>
          <ul className="flex flex-col gap-2">
            {o.eligibility.map((e) => (
              <li key={e.text} className="flex items-start gap-2 text-sm text-heading">
                {e.met ? (
                  <CheckCircle
                    aria-hidden
                    weight="fill"
                    className="mt-0.5 size-5 shrink-0 text-action"
                  />
                ) : (
                  <Circle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
                )}
                <span>
                  {e.text}
                  {e.met ? '' : ' (not met)'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-3">
        <section className={card} aria-label="Documents needed" data-testid="docs-needed">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Documents Needed</h2>
          {o.documentsNeeded.length === 0 ? (
            <p className={quiet}>No documents are needed.</p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {o.documentsNeeded.map((d) => (
              <li key={d.index}>
                <label className="flex min-h-9 items-center gap-3 text-sm text-heading">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={d.received}
                    disabled={!o.canReview}
                    onChange={(e) =>
                      void act(
                        { action: 'SET_DOCUMENT', index: d.index, received: e.target.checked },
                        e.target.checked ? 'Marked received.' : 'Marked not received.',
                      )
                    }
                  />{' '}
                  {d.label}
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section className={card} aria-label="Add to planning plan" data-testid="add-to-plan">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Add to Planning Plan</h2>
          {o.plan ? (
            <p className="text-sm text-heading">
              Added to{' '}
              <Link
                href={`/tax-planning/plans/${o.plan.id}/edit`}
                className="font-semibold text-link"
              >
                {o.plan.name}
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <Select
                label="Select an Existing Plan (Optional)"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                options={[
                  { value: '', label: 'Start a new draft plan' },
                  ...o.candidatePlans.map((p) => ({
                    value: p.id,
                    label: `${p.name} (${p.planYear})`,
                  })),
                ]}
              />
              <button
                type="button"
                className={primary}
                disabled={!o.canReview || !open}
                onClick={() =>
                  void act(
                    { action: 'ADD_TO_PLAN', ...(planId ? { planId } : {}) },
                    'Added to the plan.',
                  )
                }
              >
                <Plus aria-hidden weight="bold" className="size-4" /> Add to Plan
              </button>
            </div>
          )}
        </section>
        <section className={card} aria-label="Additional actions" data-testid="additional-actions">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Additional Actions</h2>
          <div className="flex flex-col gap-2">
            {[
              { label: 'Schedule Client Discussion', icon: CalendarBlank, d: 'schedule' as const },
              { label: 'Assign to Staff Member', icon: UserSwitch, d: 'assign' as const },
              { label: 'Mark as Not Applicable', icon: Prohibit, d: 'na' as const },
              { label: 'Dismiss Opportunity', icon: Archive, d: 'dismiss' as const },
            ].map((a) => (
              <button
                key={a.label}
                type="button"
                disabled={!o.canReview}
                onClick={() => setDialog(a.d)}
                className={`${subtle} justify-start`}
              >
                <a.icon aria-hidden weight="fill" className="size-4 text-action" /> {a.label}
              </button>
            ))}
          </div>
          {o.discussionOn ? (
            <p className="mt-2 text-xs text-muted">Discussion on {dayText(o.discussionOn)}.</p>
          ) : null}
          {o.assignedTo ? (
            <p className="text-xs text-muted">Assigned to {o.assignedTo.name}.</p>
          ) : null}
        </section>
      </div>

      <section className={card} aria-label="History" data-testid="opp-history">
        <h2 className="mb-2 font-display text-lg font-bold text-heading">History</h2>
        {events.data?.length === 0 ? <p className={quiet}>No activity yet.</p> : null}
        <ul>
          {(events.data ?? []).map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
            >
              <span className="text-heading">
                {e.kind.toLowerCase()}
                {e.toStatus ? `: ${e.toStatus.toLowerCase().replace(/_/g, ' ')}` : ''}
                {e.reason ? ` — ${e.reason}` : ''}
              </span>
              <span className="text-muted">
                {e.actor?.name ?? 'System'} · {dateTimeText(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/tax-planning/opportunities" className={outlined}>
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back
        </Link>
        <button
          type="button"
          className={primary}
          onClick={() =>
            o.nextId
              ? router.push(`/tax-planning/opportunities/${o.nextId}`)
              : router.push('/tax-planning/opportunities')
          }
        >
          Save &amp; Continue <ArrowRight aria-hidden weight="bold" className="size-4" />
        </button>
      </footer>

      {dialog ? (
        <ActionDialog
          kind={dialog}
          team={(team.data ?? []).map((m) => ({ id: m.user.id, name: m.user.name }))}
          onClose={() => setDialog(undefined)}
          onSubmit={async (b, done) => {
            const ok = await act(b, done);
            if (ok) setDialog(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function ActionDialog({
  kind,
  team,
  onClose,
  onSubmit,
}: {
  kind: Dialog;
  team: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (b: never, done: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [who, setWho] = useState('');
  const titles: Record<Dialog, string> = {
    schedule: 'Schedule Client Discussion',
    assign: 'Assign to Staff Member',
    na: 'Mark as Not Applicable',
    dismiss: 'Dismiss Opportunity',
    note: 'Add Note',
    implemented: 'Mark Implemented',
  };
  const submit = () => {
    if (kind === 'schedule')
      return onSubmit(
        { action: 'SCHEDULE_DISCUSSION', on: date } as never,
        'Discussion scheduled.',
      );
    if (kind === 'assign')
      return onSubmit({ action: 'ASSIGN', userId: who || null } as never, 'Assigned.');
    if (kind === 'na')
      return onSubmit(
        { action: 'MARK_NOT_APPLICABLE', reason: text.trim() } as never,
        'Marked not applicable.',
      );
    if (kind === 'dismiss')
      return onSubmit({ action: 'DISMISS', reason: text.trim() } as never, 'Dismissed.');
    if (kind === 'implemented')
      return onSubmit({ action: 'MARK_IMPLEMENTED', on: date } as never, 'Marked implemented.');
    return onSubmit({ action: 'ADD_NOTE', note: text.trim() } as never, 'Note added.');
  };
  const ready =
    kind === 'schedule' || kind === 'implemented'
      ? !!date
      : kind === 'assign'
        ? true
        : !!text.trim();
  return (
    <Modal
      open
      title={titles[kind]}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => void submit()}>
            {titles[kind]}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="action-dialog">
        {kind === 'schedule' || kind === 'implemented' ? (
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        ) : null}
        {kind === 'assign' ? (
          <Select
            label="Staff member"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            options={[
              { value: '', label: 'Unassigned' },
              ...team.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        ) : null}
        {kind === 'na' || kind === 'dismiss' || kind === 'note' ? (
          <Textarea
            label={kind === 'note' ? 'Note' : 'Reason'}
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : null}
      </div>
    </Modal>
  );
}
