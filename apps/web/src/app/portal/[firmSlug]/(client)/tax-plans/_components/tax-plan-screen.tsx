'use client';

import {
  MY_TAX_PLAN_REQUEST_LABELS,
  MY_TAX_PLAN_STATE_LABELS,
  type MyTaxPlan,
  type MyTaxPlanRequestKind,
} from '@firmivra/types';
import { Badge, Button, Card, Modal, Textarea } from '@firmivra/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { STATE_TONE, dayText } from './tax-plans-screen';

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const money = (cents: number) => MONEY.format(cents / 100);

/** What each request button asks the client to write. */
const ASK: Record<MyTaxPlanRequestKind, { button: string; title: string; hint: string }> = {
  QUESTION: {
    button: 'Ask a Question',
    title: 'Ask a Question',
    hint: 'What would you like to know about this plan?',
  },
  REVISION: {
    button: 'Request a Revision',
    title: 'Request a Revision',
    hint: 'What should the firm change in this plan?',
  },
  MEETING: {
    button: 'Request a Meeting',
    title: 'Request a Meeting',
    hint: 'When suits you, and what would you like to discuss?',
  },
};

const REQUEST_STATUS = { OPEN: 'Sent', ANSWERED: 'Answered', CLOSED: 'Closed' } as const;
const REQUEST_KIND = { ...MY_TAX_PLAN_REQUEST_LABELS, INFORMATION: 'Information' } as const;

/**
 * P4-8 (Tax Planning Review 2): one plan, read-only at the exact version the firm sent. The client
 * approves that version, or asks a question, requests a revision or requests a meeting; the
 * firm's answer comes by message.
 */
export function TaxPlanScreen() {
  const { firmSlug, planId } = useParams<{ firmSlug: string; planId: string }>();
  const key = ['my-tax-plans', firmSlug, planId];
  const plan = useApiQuery(key, () => api.myTaxPlans(firmSlug).get(planId));
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link
        href={`/${firmSlug}/tax-plans`}
        className="text-sm font-medium text-link hover:underline"
      >
        ← All Tax Plans
      </Link>
      <PageState query={plan}>
        {(p) => <PlanView plan={p} slug={firmSlug} queryKey={key} />}
      </PageState>
    </div>
  );
}

function PlanView({
  plan: p,
  slug,
  queryKey,
}: {
  plan: MyTaxPlan;
  slug: string;
  queryKey: string[];
}) {
  const [asking, setAsking] = useState<MyTaxPlanRequestKind | null>(null);
  const [approving, setApproving] = useState(false);
  const [notice, setNotice] = useState('');
  return (
    <>
      <header className="flex flex-wrap items-start gap-3" data-testid="tax-plan-header">
        <div className="min-w-0 flex-1">
          <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
            {p.name}
          </h1>
          <p className="text-sm text-muted">
            {p.planYear} · Version {p.version} · Sent {dayText(p.sentAt)}
          </p>
        </div>
        <Badge tone={STATE_TONE[p.state]}>{MY_TAX_PLAN_STATE_LABELS[p.state]}</Badge>
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

      <Card title="Your plan">
        <p className="mb-3 text-sm text-muted" data-testid="read-only-note">
          Read-only: version {p.version}, exactly as the firm sent it.
        </p>
        {p.strategies.length === 0 ? (
          <p className="text-sm text-muted">This version lists no strategies.</p>
        ) : (
          <ul className="flex flex-col" aria-label="Strategies" data-testid="plan-strategies">
            {p.strategies.map((s) => (
              <li
                key={s.name}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-divider py-2 first:border-t-0"
              >
                <span className="min-w-0 flex-1 font-semibold text-heading">{s.name}</span>
                {s.category ? <span className="text-sm text-muted">{s.category}</span> : null}
                <span className="text-sm text-text">
                  {s.estimatedSavingsCents === null
                    ? 'Not estimated'
                    : `Estimated savings ${money(s.estimatedSavingsCents)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {p.projectedSavingsCents !== null ? (
          <p className="mt-3 font-semibold text-heading" data-testid="projected-savings">
            Projected savings: {money(p.projectedSavingsCents)}
          </p>
        ) : null}
        <p className="mt-3 text-xs text-muted">{p.disclaimer}</p>
      </Card>

      <Card title="Approve or ask">
        {p.approval ? (
          <p className="mb-3 text-sm text-text" data-testid="plan-approval">
            You approved version {p.approval.version} on{' '}
            {dayText(`${p.approval.approvedOn}T12:00:00Z`)}
            {p.approval.method === 'PORTAL' ? ' in the portal' : ' with the firm'}.
          </p>
        ) : null}
        {p.can.approve || p.can.request ? (
          <div className="flex flex-wrap gap-2" data-testid="plan-actions">
            {p.can.approve ? (
              <Button onClick={() => setApproving(true)}>Approve Plan</Button>
            ) : null}
            {p.can.request
              ? (Object.keys(ASK) as MyTaxPlanRequestKind[]).map((kind) => (
                  <Button key={kind} variant="secondary" onClick={() => setAsking(kind)}>
                    {ASK[kind].button}
                  </Button>
                ))
              : null}
          </div>
        ) : (
          <p className="text-sm text-muted">
            This plan is closed. Send the firm a message if you have a question.
          </p>
        )}
      </Card>

      {p.requests.length > 0 ? (
        <Card title="Your requests">
          <ul className="flex flex-col" aria-label="Your requests" data-testid="plan-requests">
            {p.requests.map((r) => (
              <li key={r.id} className="border-t border-divider py-2 first:border-t-0">
                <p className="text-sm font-semibold text-heading">
                  {REQUEST_KIND[r.kind]} · {REQUEST_STATUS[r.status]} · {dayText(r.createdAt)}
                </p>
                <p className="text-sm whitespace-pre-wrap text-text">{r.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">The firm answers by message.</p>
        </Card>
      ) : null}

      {approving ? (
        <ApproveDialog
          plan={p}
          slug={slug}
          queryKey={queryKey}
          onClose={() => setApproving(false)}
          onDone={() => {
            setApproving(false);
            setNotice(`You approved version ${p.version}. The firm has been told.`);
          }}
        />
      ) : null}
      {asking ? (
        <AskDialog
          kind={asking}
          plan={p}
          slug={slug}
          queryKey={queryKey}
          onClose={() => setAsking(null)}
          onDone={() => {
            setAsking(null);
            setNotice('Your request was sent. The firm will answer by message.');
          }}
        />
      ) : null}
    </>
  );
}

function ApproveDialog({
  plan: p,
  slug,
  queryKey,
  onClose,
  onDone,
}: {
  plan: MyTaxPlan;
  slug: string;
  queryKey: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const approve = useApiMutation(() => api.myTaxPlans(slug).approve(p.id, { version: p.version }), {
    invalidate: queryKey,
  });
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
        You approve version {p.version} exactly as the firm sent it, dated today. The firm can then
        carry it out.
      </p>
      {approve.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(approve.error)}
        </p>
      ) : null}
    </Modal>
  );
}

function AskDialog({
  kind,
  plan: p,
  slug,
  queryKey,
  onClose,
  onDone,
}: {
  kind: MyTaxPlanRequestKind;
  plan: MyTaxPlan;
  slug: string;
  queryKey: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [body, setBody] = useState('');
  const send = useApiMutation(() => api.myTaxPlans(slug).ask(p.id, { kind, body }), {
    invalidate: queryKey,
  });
  return (
    <Modal
      open
      title={ASK[kind].title}
      subtitle={p.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={send.isPending || !body.trim()}
            onClick={() => send.mutate(undefined, { onSuccess: onDone })}
          >
            {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        </>
      }
    >
      <Textarea
        label="Your request"
        hint={ASK[kind].hint}
        rows={5}
        maxLength={4000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {send.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(send.error)}
        </p>
      ) : null}
    </Modal>
  );
}
