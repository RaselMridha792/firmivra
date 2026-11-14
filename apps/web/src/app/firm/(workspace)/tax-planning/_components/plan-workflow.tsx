'use client';

import type { PlanAction, PlanRequest, TaxPlanDetail } from '@firmivra/types';
import { Badge, Button, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { TP_KEY, card, dateTimeText, dayText, outlined, planError, primary } from './tp-shared';

/**
 * Tax Planning Review 2, the approved workflow: where the plan stands, the next action and whose
 * it is, the actions that fit its status (the API works them out, so every view reads the same
 * rule), the readiness checklist with how to fix each missing item, the requests either way, the
 * client's approvals of exact versions and the delivery. One Send control: Send to Client and
 * Deliver to Client open the same dialog with its purpose.
 */
const ACTION_LABEL: Record<PlanAction, string> = {
  START_WORK: 'Start Work',
  SEND_FOR_REVIEW: 'Send for Internal Review',
  RETURN_TO_WORK: 'Return to Work',
  FINALIZE: 'Finalize Plan',
  SEND_TO_CLIENT: 'Send to Client',
  REQUEST_INFORMATION: 'Request Information',
  RECORD_CLIENT_REQUEST: "Record Client's Request",
  START_REVISION: 'Start Revision',
  RECORD_APPROVAL: 'Record Client Approval',
  MARK_IMPLEMENTED: 'Mark Implemented',
  DELIVER: 'Deliver to Client',
  REVISE: 'Revise Plan',
  CLOSE: 'Close Plan',
  REOPEN: 'Reopen Plan',
  DUPLICATE: 'Duplicate Plan',
};

const REQUEST_KIND: Record<PlanRequest['kind'], string> = {
  INFORMATION: 'Information',
  DOCUMENT: 'Document upload',
  QUESTION: 'Question',
  REVISION: 'Revision',
  MEETING: 'Meeting',
};
const REQUEST_STATUS: Record<PlanRequest['status'], string> = {
  OPEN: 'Open',
  ANSWERED: 'Answered',
  CLOSED: 'Closed',
};

type Notice = (t: string, tone: 'success' | 'error') => void;
type Dialog = PlanAction | { answer: PlanRequest };

export function PlanWorkflow({
  plan,
  expanded,
  onNotice,
  onSaved,
}: {
  plan: TaxPlanDetail;
  /** The readiness, requests and approvals start open (Review & Save). */
  expanded: boolean;
  onNotice: Notice;
  onSaved: () => Promise<unknown>;
}) {
  const router = useRouter();
  const w = plan.workflow;
  const [dialog, setDialog] = useState<Dialog>();
  const [busy, setBusy] = useState(false);
  const close = () => setDialog(undefined);
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      onNotice(done, 'success');
      await onSaved();
      return true;
    } catch (e) {
      onNotice(planError(e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  // Actions that need nothing more than a click.
  const direct: Partial<Record<PlanAction, [() => Promise<unknown>, string]>> = {
    START_WORK: [
      () => api.taxPlanning.setStatus(plan.id, { status: 'IN_PROGRESS', etag: plan.etag }),
      'Work started: the plan is In Progress.',
    ],
    RETURN_TO_WORK: [
      () => api.taxPlanning.setStatus(plan.id, { status: 'IN_PROGRESS', etag: plan.etag }),
      'The plan is back In Progress.',
    ],
    START_REVISION: [
      () => api.taxPlanning.setStatus(plan.id, { status: 'IN_PROGRESS', etag: plan.etag }),
      'Revision started: the plan is In Progress.',
    ],
    FINALIZE: [() => api.taxPlanning.finalize(plan.id, { etag: plan.etag }), 'Plan finalized.'],
  };
  const pick = (a: PlanAction) => {
    const d = direct[a];
    if (d) void run(...d);
    else setDialog(a);
  };
  const done = w.readiness.filter((r) => r.done).length;
  const owner = w.waitingOnClient ? 'The client' : (w.owner?.name ?? 'No one');
  const sent = w.sentVersion;
  return (
    <section
      className={`${card} flex flex-col gap-3`}
      aria-label="Plan workflow"
      data-testid="plan-workflow"
    >
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted">Next action</dt>
        <dd className="font-medium text-heading" data-testid="workflow-next">
          {w.nextAction}
        </dd>
        <dt className="text-muted">Owner</dt>
        <dd className="text-heading" data-testid="workflow-owner">
          {owner}
        </dd>
        {w.reviewer ? (
          <>
            <dt className="text-muted">Reviewer</dt>
            <dd className="text-heading" data-testid="workflow-reviewer">
              {w.reviewer.name}
              {w.reviewRequestedAt ? ` · asked ${dateTimeText(w.reviewRequestedAt)}` : ''}
            </dd>
          </>
        ) : null}
        {sent !== null ? (
          <>
            <dt className="text-muted">With the client</dt>
            <dd className="text-heading">
              Version {sent} sent for review
              {w.approvedVersion !== null ? ` · version ${w.approvedVersion} approved` : ''}
              {w.delivered
                ? ` · version ${w.delivered.version} delivered ${dateTimeText(w.delivered.at)}`
                : ''}
            </dd>
          </>
        ) : null}
      </dl>
      {w.actions.length > 0 && !plan.archived ? (
        <div className="flex flex-wrap gap-2" data-testid="workflow-actions">
          {w.actions.map((a, i) => (
            <button
              key={a}
              type="button"
              disabled={busy}
              className={i === 0 ? primary : outlined}
              onClick={() => pick(a)}
            >
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      ) : null}
      <details open={expanded} className="text-sm">
        <summary className="cursor-pointer font-semibold text-heading">
          Readiness checklist ({done} of {w.readiness.length} complete)
          {w.requests.some((r) => r.status === 'OPEN')
            ? ` · ${w.requests.filter((r) => r.status === 'OPEN').length} open request(s)`
            : ''}
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <ul className="flex flex-col gap-1" data-testid="workflow-readiness">
            {w.readiness.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2">
                <Badge tone={r.done ? 'success' : 'warning'}>
                  {r.done ? 'Complete' : 'Missing'}
                </Badge>
                <span className="text-heading">{r.label}</span>
                {r.fix ? <span className="text-muted">{r.fix}</span> : null}
              </li>
            ))}
          </ul>
          <Requests
            plan={plan}
            onAnswer={(r) => setDialog({ answer: r })}
            onClose={(r) =>
              void run(
                () => api.taxPlanning.updatePlanRequest(plan.id, r.id, { status: 'CLOSED' }),
                'Request closed.',
              )
            }
          />
          {w.approvals.length > 0 ? (
            <div data-testid="plan-approvals">
              <h3 className="mb-1 font-semibold text-heading">Client approvals</h3>
              <ul>
                {w.approvals.map((a) => (
                  <li key={a.id} className="border-t border-divider py-1 first:border-t-0">
                    <span className="text-heading">
                      Version {a.version} approved {dayText(a.approvedOn)} ·{' '}
                      {a.method === 'PORTAL' ? 'in the portal' : 'documented manual approval'}
                    </span>
                    {a.note ? <span className="block text-muted">{a.note}</span> : null}
                    <span className="block text-xs text-muted">
                      Recorded by {a.recordedBy?.name ?? 'the client'} · {dateTimeText(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>

      {dialog === 'SEND_FOR_REVIEW' ? (
        <ReviewerDialog
          onClose={close}
          onSubmit={async (reviewerUserId) => {
            if (
              await run(
                () => api.taxPlanning.reviewPlan(plan.id, { reviewerUserId, etag: plan.etag }),
                'Sent for internal review.',
              )
            )
              close();
          }}
        />
      ) : null}
      {dialog === 'SEND_TO_CLIENT' || dialog === 'DELIVER' ? (
        <SendDialog
          purposes={[
            ...(w.actions.includes('SEND_TO_CLIENT') ? (['REVIEW'] as const) : []),
            ...(w.actions.includes('DELIVER') ? (['DELIVERY'] as const) : []),
          ]}
          initial={dialog === 'DELIVER' ? 'DELIVERY' : 'REVIEW'}
          onClose={close}
          onSubmit={async (body) => {
            if (
              await run(
                () => api.taxPlanning.send(plan.id, body),
                body.purpose === 'DELIVERY'
                  ? 'The approved plan was delivered to the client.'
                  : 'Plan sent for the client’s review.',
              )
            )
              close();
          }}
        />
      ) : null}
      {dialog === 'REQUEST_INFORMATION' || dialog === 'RECORD_CLIENT_REQUEST' ? (
        <RequestDialog
          firm={dialog === 'REQUEST_INFORMATION'}
          onClose={close}
          onSubmit={async (kind, body) => {
            const ok = await run(
              () =>
                api.taxPlanning.createPlanRequest(
                  plan.id,
                  dialog === 'REQUEST_INFORMATION'
                    ? { direction: 'FIRM_TO_CLIENT', kind: kind as never, body }
                    : { direction: 'CLIENT_TO_FIRM', kind: kind as never, body },
                ),
              dialog === 'REQUEST_INFORMATION'
                ? 'Request sent to the client by a portal message.'
                : 'The client’s request was recorded.',
            );
            if (ok) close();
          }}
        />
      ) : null}
      {dialog === 'RECORD_APPROVAL' ? (
        <ApprovalDialog
          plan={plan}
          onClose={close}
          onSubmit={async (body) => {
            if (
              await run(
                () => api.taxPlanning.recordApproval(plan.id, { ...body, etag: plan.etag }),
                'Client approval recorded.',
              )
            )
              close();
          }}
        />
      ) : null}
      {dialog === 'MARK_IMPLEMENTED' || dialog === 'CLOSE' ? (
        <Confirm
          title={dialog === 'CLOSE' ? 'Close this plan?' : 'Mark this plan Implemented?'}
          text={
            dialog === 'CLOSE'
              ? 'A closed plan is read-only. Reopen it, with the reason, to change it.'
              : 'Implemented means the approved plan is being put into action. Delivering it to the client is a separate step.'
          }
          action={ACTION_LABEL[dialog]}
          onClose={close}
          onConfirm={async () => {
            const status = dialog === 'CLOSE' ? 'CLOSED' : 'IMPLEMENTED';
            if (
              await run(
                () => api.taxPlanning.setStatus(plan.id, { status, etag: plan.etag }),
                dialog === 'CLOSE' ? 'Plan closed.' : 'Plan marked Implemented.',
              )
            )
              close();
          }}
        />
      ) : null}
      {dialog === 'REVISE' || dialog === 'REOPEN' ? (
        <ReasonDialog
          kind={dialog}
          onClose={close}
          onSubmit={async (reason) => {
            const ok = await run(
              () =>
                dialog === 'REOPEN'
                  ? api.taxPlanning.reopenPlan(plan.id, { reason, etag: plan.etag })
                  : api.taxPlanning.revisePlan(plan.id, { reason, etag: plan.etag }),
              dialog === 'REOPEN' ? 'Plan reopened.' : 'Plan back in progress for revision.',
            );
            if (ok) close();
          }}
        />
      ) : null}
      {dialog === 'DUPLICATE' ? (
        <DuplicateDialog
          name={`${plan.name} (copy)`}
          onClose={close}
          onSubmit={async (name) => {
            setBusy(true);
            try {
              const copy = await api.taxPlanning.duplicatePlan(plan.id, { name });
              onNotice('Plan duplicated: the copy is a Draft you can edit.', 'success');
              close();
              router.push(`/tax-planning/plans/${copy.id}/edit`);
            } catch (e) {
              onNotice(planError(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
      {dialog && typeof dialog === 'object' ? (
        <AnswerDialog
          request={dialog.answer}
          onClose={close}
          onSubmit={async (response) => {
            if (
              await run(
                () =>
                  api.taxPlanning.updatePlanRequest(plan.id, dialog.answer.id, {
                    status: 'ANSWERED',
                    response,
                  }),
                'Request marked answered.',
              )
            )
              close();
          }}
        />
      ) : null}
    </section>
  );
}

function Requests({
  plan,
  onAnswer,
  onClose,
}: {
  plan: TaxPlanDetail;
  onAnswer: (r: PlanRequest) => void;
  onClose: (r: PlanRequest) => void;
}) {
  const items = plan.workflow.requests;
  if (items.length === 0) return null;
  return (
    <div data-testid="plan-requests">
      <h3 className="mb-1 font-semibold text-heading">Requests</h3>
      <ul>
        {items.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-start justify-between gap-2 border-t border-divider py-1 first:border-t-0"
          >
            <span className="min-w-0">
              <span className="text-heading">
                {r.direction === 'FIRM_TO_CLIENT' ? 'Asked of the client' : 'From the client'} ·{' '}
                {REQUEST_KIND[r.kind]}
              </span>
              <span className="block break-words text-text">{r.body}</span>
              {r.response ? <span className="block text-muted">Answer: {r.response}</span> : null}
              <span className="block text-xs text-muted">
                {r.requestedBy ? `${r.requestedBy.name} · ` : ''}
                {dateTimeText(r.createdAt)}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={r.status === 'OPEN' ? 'warning' : 'neutral'}>
                {REQUEST_STATUS[r.status]}
              </Badge>
              {r.status === 'OPEN' && plan.canEdit ? (
                <>
                  <button
                    type="button"
                    className="font-medium text-link"
                    onClick={() => onAnswer(r)}
                  >
                    Mark Answered
                  </button>
                  <button
                    type="button"
                    className="font-medium text-link"
                    onClick={() => onClose(r)}
                  >
                    Close Request
                  </button>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shell({
  title,
  subtitle,
  testId,
  submit,
  disabled,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  subtitle?: string;
  testId: string;
  submit: string;
  disabled: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || disabled}
            onClick={async () => {
              setBusy(true);
              await onSubmit();
              setBusy(false);
            }}
          >
            {submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid={testId}>
        {children}
      </div>
    </Modal>
  );
}

function ReviewerDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (userId: string) => Promise<void>;
}) {
  const team = useApiQuery([...TP_KEY, 'team'], () => api.team.list());
  const [who, setWho] = useState('');
  return (
    <Shell
      title="Send for Internal Review"
      subtitle="The plan is Under Review until the reviewer returns it to work or it is sent to the client."
      testId="reviewer-dialog"
      submit="Send for Review"
      disabled={!who}
      onClose={onClose}
      onSubmit={() => onSubmit(who)}
    >
      <Select
        label="Reviewer *"
        value={who}
        onChange={(e) => setWho(e.target.value)}
        options={[
          { value: '', label: 'Choose a reviewer…' },
          ...(team.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name })),
        ]}
      />
    </Shell>
  );
}

function SendDialog({
  purposes,
  initial,
  onClose,
  onSubmit,
}: {
  purposes: readonly ('REVIEW' | 'DELIVERY')[];
  initial: 'REVIEW' | 'DELIVERY';
  onClose: () => void;
  onSubmit: (body: {
    channel: 'PORTAL_MESSAGE' | 'EMAIL';
    purpose: 'REVIEW' | 'DELIVERY';
    message?: string;
  }) => Promise<void>;
}) {
  const [purpose, setPurpose] = useState(initial);
  const [channel, setChannel] = useState<'PORTAL_MESSAGE' | 'EMAIL'>('PORTAL_MESSAGE');
  const [msg, setMsg] = useState('');
  return (
    <Shell
      title="Send Plan to Client"
      subtitle="Only the client notes are sent, never the internal ones."
      testId="send-plan"
      submit="Send"
      disabled={false}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({ channel, purpose, ...(msg.trim() ? { message: msg.trim() } : {}) })
      }
    >
      <Select
        label="Purpose"
        value={purpose}
        onChange={(e) => setPurpose(e.target.value as never)}
        options={purposes.map((p) => ({
          value: p,
          label:
            p === 'REVIEW' ? 'For the client’s review and approval' : 'Deliver the approved plan',
        }))}
      />
      <Select
        label="Send by"
        value={channel}
        onChange={(e) => setChannel(e.target.value as never)}
        options={[
          { value: 'PORTAL_MESSAGE', label: 'Portal message' },
          { value: 'EMAIL', label: 'Email' },
        ]}
      />
      <Textarea
        label="Message (optional)"
        rows={3}
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
      />
    </Shell>
  );
}

function RequestDialog({
  firm,
  onClose,
  onSubmit,
}: {
  firm: boolean;
  onClose: () => void;
  onSubmit: (kind: string, body: string) => Promise<void>;
}) {
  const kinds = firm
    ? (['INFORMATION', 'DOCUMENT'] as const)
    : (['QUESTION', 'INFORMATION', 'REVISION', 'MEETING'] as const);
  const [kind, setKind] = useState<string>(kinds[0]);
  const [body, setBody] = useState('');
  return (
    <Shell
      title={firm ? 'Request Information' : "Record Client's Request"}
      subtitle={
        firm
          ? 'The client is asked by a portal message, to answer or to upload a document.'
          : 'What the client asked. A plan waiting on the client moves to Needs Review.'
      }
      testId="request-dialog"
      submit={firm ? 'Send Request' : 'Record Request'}
      disabled={!body.trim()}
      onClose={onClose}
      onSubmit={() => onSubmit(kind, body.trim())}
    >
      <Select
        label={firm ? 'The client answers with' : 'The client asked for'}
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        options={kinds.map((k) => ({
          value: k,
          label: firm && k === 'INFORMATION' ? 'A response' : REQUEST_KIND[k],
        }))}
      />
      <Textarea
        label={firm ? 'What you need *' : 'Their request *'}
        rows={4}
        maxLength={4000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
    </Shell>
  );
}

function ApprovalDialog({
  plan,
  onClose,
  onSubmit,
}: {
  plan: TaxPlanDetail;
  onClose: () => void;
  onSubmit: (body: { version?: number; approvedOn: string; note: string }) => Promise<void>;
}) {
  const versions = useApiQuery([...TP_KEY, 'versions', plan.id, plan.version, plan.etag], () =>
    api.taxPlanning.versions(plan.id),
  );
  const sent = [
    ...new Set((versions.data ?? []).filter((v) => v.event === 'SENT').map((v) => v.version)),
  ];
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [version, setVersion] = useState(String(plan.workflow.sentVersion ?? ''));
  const [on, setOn] = useState(today);
  const [note, setNote] = useState('');
  return (
    <Shell
      title="Record Client Approval"
      subtitle="The client’s approval of one exact version, with the date and how it was given."
      testId="approval-dialog"
      submit="Record Approval"
      disabled={!on || !note.trim()}
      onClose={onClose}
      onSubmit={() =>
        onSubmit({
          ...(version ? { version: Number(version) } : {}),
          approvedOn: on,
          note: note.trim(),
        })
      }
    >
      <Select
        label="Approved version *"
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        options={(sent.length ? sent : [plan.workflow.sentVersion ?? 0])
          .filter((v) => v > 0)
          .map((v) => ({ value: String(v), label: `Version ${v}` }))}
      />
      <Input
        label="Approved on *"
        type="date"
        max={today}
        value={on}
        onChange={(e) => setOn(e.target.value)}
      />
      <Textarea
        label="How it was approved *"
        rows={3}
        maxLength={2000}
        placeholder="For example: by phone with the client, confirmed by email."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </Shell>
  );
}

function Confirm({
  title,
  text,
  action,
  onClose,
  onConfirm,
}: {
  title: string;
  text: string;
  action: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Shell
      title={title}
      testId="confirm-dialog"
      submit={action}
      disabled={false}
      onClose={onClose}
      onSubmit={onConfirm}
    >
      <p className="text-sm text-text">{text}</p>
    </Shell>
  );
}

function DuplicateDialog({
  name: initial,
  onClose,
  onSubmit,
}: {
  name: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  return (
    <Shell
      title="Duplicate Plan"
      subtitle="An editable copy, as a Draft, of the plan's details, figures and strategies. The original stays as it is; documents, tasks, versions and approvals are not copied."
      testId="duplicate-dialog"
      submit="Duplicate Plan"
      disabled={!name.trim()}
      onClose={onClose}
      onSubmit={() => onSubmit(name.trim())}
    >
      <Input
        label="Name of the copy *"
        maxLength={200}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </Shell>
  );
}

function AnswerDialog({
  request,
  onClose,
  onSubmit,
}: {
  request: PlanRequest;
  onClose: () => void;
  onSubmit: (response: string) => Promise<void>;
}) {
  const [response, setResponse] = useState('');
  return (
    <Shell
      title="Mark Request Answered"
      subtitle={request.body}
      testId="answer-dialog"
      submit="Mark Answered"
      disabled={!response.trim()}
      onClose={onClose}
      onSubmit={() => onSubmit(response.trim())}
    >
      <Textarea
        label="The answer *"
        rows={3}
        maxLength={4000}
        value={response}
        onChange={(e) => setResponse(e.target.value)}
      />
    </Shell>
  );
}

/**
 * C27 (Review 2): the reason for Reopen or Revise, kept in the plan's history. A revised plan is
 * finalized again as a new version; the versions already kept never change.
 */
export function ReasonDialog({
  kind,
  onClose,
  onSubmit,
}: {
  kind: 'REOPEN' | 'REVISE';
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  return (
    <Shell
      title={kind === 'REOPEN' ? 'Reopen this plan?' : 'Revise this plan?'}
      subtitle={
        kind === 'REOPEN'
          ? 'It goes back to In Progress and can be changed again.'
          : 'It goes back to In Progress; finalize it again to keep a new version.'
      }
      testId="reason-dialog"
      submit={kind === 'REOPEN' ? 'Reopen Plan' : 'Revise Plan'}
      disabled={!reason.trim()}
      onClose={onClose}
      onSubmit={() => onSubmit(reason.trim())}
    >
      <Textarea
        label="Reason *"
        rows={3}
        maxLength={1000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Shell>
  );
}
