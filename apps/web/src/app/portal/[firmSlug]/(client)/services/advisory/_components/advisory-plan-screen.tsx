'use client';

import { MY_ADVISORY_PLAN_STATE_LABELS, type MyAdvisoryPlan } from '@firmivra/types';
import { Badge, Button, Card, Modal } from '@firmivra/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import {
  AREA,
  GOAL_STATUS,
  PLAN_STATE_TONE,
  REC_STATUS,
  SERVICE_STATUS,
  dayText,
} from './advisory-parts';

const row = 'border-t border-divider py-2 first:border-t-0';

/**
 * BA-CP (Client Portal Review One): /{slug}/services/advisory/plans/{id}, one business plan
 * read-only, exactly as the version the firm delivered: its summary and focus, goals, the
 * recommendations shown to the client and the services. Never figures or the firm's notes. B10:
 * a plan the firm sent for the client's approval is approved here, at exactly that version.
 */
export function AdvisoryPlanScreen() {
  const { firmSlug, planId } = useParams<{ firmSlug: string; planId: string }>();
  const key = ['my-advisory', firmSlug, 'plan', planId];
  const plan = useApiQuery(key, () => api.myAdvisory(firmSlug).plan(planId));
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link
        href={`/${firmSlug}/services/advisory`}
        className="text-sm font-medium text-link hover:underline"
      >
        ← Business Advisory
      </Link>
      <PageState query={plan}>{(p) => <PlanView plan={p} slug={firmSlug} />}</PageState>
    </div>
  );
}

function PlanView({ plan: p, slug }: { plan: MyAdvisoryPlan; slug: string }) {
  const [approving, setApproving] = useState(false);
  const [notice, setNotice] = useState('');
  return (
    <>
      <header className="flex flex-wrap items-start gap-3" data-testid="advisory-plan-header">
        <div className="min-w-0 flex-1">
          <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
            {p.name}
          </h1>
          <p className="text-sm text-muted">
            {p.businessName ? `${p.businessName} · ` : ''}
            {p.targetYear} · Version {p.version} · Delivered {dayText(p.deliveredAt)}
          </p>
        </div>
        <Badge tone={PLAN_STATE_TONE[p.state]}>{MY_ADVISORY_PLAN_STATE_LABELS[p.state]}</Badge>
      </header>
      {notice ? (
        <p
          role="status"
          data-testid="plan-notice"
          className="rounded-card bg-success-soft px-4 py-3 text-sm text-text"
        >
          {notice}
        </p>
      ) : null}
      {p.can.approve || p.approval ? (
        <Card title="Your approval">
          {p.approval ? (
            <p className="text-sm text-text" data-testid="plan-approval">
              You approved version {p.approval.version} on {dayText(p.approval.approvedAt)}.
            </p>
          ) : null}
          {p.can.approve ? (
            <div className="flex flex-col items-start gap-3" data-testid="plan-approve">
              <p className="text-sm text-text">
                Your firm sent this plan for your approval. Read it below, then approve it; your
                firm finalizes it with your approval. If something should change, send your firm a
                message instead.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setApproving(true)}>Approve Plan</Button>
                <Link
                  href={`/${slug}/messages`}
                  className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-link hover:underline"
                >
                  Message your firm
                </Link>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card title="Your plan">
        <p className="mb-3 text-sm text-muted" data-testid="read-only-note">
          Read-only: version {p.version}, exactly as your firm delivered it.
        </p>
        {p.summary ? (
          <p className="text-sm whitespace-pre-wrap text-text" data-testid="plan-summary">
            {p.summary}
          </p>
        ) : null}
        {p.focusAreas.length ? (
          <ul className="mt-3 flex flex-col" aria-label="Focus areas" data-testid="plan-focus">
            {p.focusAreas.map((f) => (
              <li key={f.area} className={row}>
                <span className="font-semibold text-heading">{AREA[f.area]}</span>
                <span className="text-sm text-text">: {f.objective}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title="Goals">
        {p.goals.length ? (
          <ul className="flex flex-col" aria-label="Goals" data-testid="plan-goals">
            {p.goals.map((g) => (
              <li
                key={`${g.title}|${g.targetDate ?? ''}|${g.status}`}
                className={`flex flex-wrap items-center gap-2 ${row}`}
              >
                <span className="min-w-0 flex-1 font-semibold text-heading">{g.title}</span>
                {g.targetDate ? (
                  <span className="text-sm text-muted">By {dayText(g.targetDate)}</span>
                ) : null}
                <Badge tone="info">{GOAL_STATUS[g.status]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">This version lists no goals.</p>
        )}
      </Card>

      <Card title="Recommendations">
        {p.recommendations.length ? (
          <ul
            className="flex flex-col"
            aria-label="Recommendations"
            data-testid="plan-recommendations"
          >
            {p.recommendations.map((r) => {
              const [label, tone] = REC_STATUS[r.status];
              return (
                <li key={`${r.title}|${r.status}`} className={row}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 font-semibold text-heading">{r.title}</span>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                  {r.rationale ? <p className="mt-1 text-sm text-text">{r.rationale}</p> : null}
                  {r.impactLabel ? (
                    <p className="mt-1 text-xs text-muted">Expected: {r.impactLabel}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">This version shares no recommendations.</p>
        )}
      </Card>

      {p.services.length ? (
        <Card title="Services">
          <ul className="flex flex-wrap gap-2" aria-label="Services">
            {p.services.map((s) => (
              <li key={s.name}>
                <Badge tone="info">
                  {s.name} · {SERVICE_STATUS[s.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-xs text-muted">{p.disclaimer}</p>
      {approving ? (
        <ApproveDialog
          plan={p}
          slug={slug}
          onClose={() => setApproving(false)}
          onDone={() => {
            setApproving(false);
            setNotice(`You approved version ${p.version}. Your firm has been told.`);
          }}
        />
      ) : null}
    </>
  );
}

function ApproveDialog({
  plan: p,
  slug,
  onClose,
  onDone,
}: {
  plan: MyAdvisoryPlan;
  slug: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const approve = useApiMutation(
    () => api.myAdvisory(slug).approve(p.id, { version: p.version }),
    // The overview and this plan: both show where it stands.
    { invalidate: ['my-advisory', slug] },
  );
  return (
    <Modal
      open
      title="Approve Plan"
      subtitle={`${p.name}, version ${p.version}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={approve.isPending}
            onClick={() => approve.mutate(undefined, { onSuccess: onDone })}
          >
            {approve.isPending ? 'Approving…' : 'Approve'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">
        You approve version {p.version} exactly as your firm sent it, dated today. Your firm then
        finalizes the plan.
      </p>
      {approve.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(approve.error)}
        </p>
      ) : null}
    </Modal>
  );
}
