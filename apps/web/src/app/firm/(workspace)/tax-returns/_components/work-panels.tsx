'use client';

import type {
  DocumentRequestStatus,
  TaxChecklistItem,
  TaxReturnDetail,
  TaxReturnDocument,
  TaxReturnWorkflowStatus,
} from '@firmivra/types';
import { Badge, Input, Select, Textarea, Timeline } from '@firmivra/ui';
import {
  Check,
  CheckCircle,
  CheckSquare,
  ClockCounterClockwise,
  FileText,
  Files,
  NotePencil,
  Plus,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { Dialog, useAct, useMembers, type Notice } from './return-actions';
import { AddCheckDialog, Panel, smallButton, textButton, usePart } from './review-panels';
import {
  ACTIVITY_ICON,
  STATUS_LABEL,
  TR_KEY,
  dateTimeText,
  dayText,
  quiet,
  shortName,
} from './tr-shared';

// ---------- Workflow stepper ----------

type Step = { label: string; state: 'complete' | 'current' | 'waiting' | 'rejected' | 'not' };

/** Frame 2's six steps: Intake, Preparation, Review, E-Signatures, E-File, Closed. */
const FRAME2: Record<TaxReturnWorkflowStatus, number> = {
  WAITING_ON_CLIENT: 0,
  IN_PREPARATION: 1,
  READY_FOR_REVIEW: 2,
  READY_FOR_SIGNATURE: 3,
  READY_TO_FILE: 4,
  TRANSMITTED: 4,
  REJECTED: 4,
  ACCEPTED: 5,
  CLOSED: 6,
};
/** Frame 3's six steps: Intake, Preparation, Review, Ready to File, Transmitted, Closed. */
const FRAME3: Record<TaxReturnWorkflowStatus, number> = {
  WAITING_ON_CLIENT: 0,
  IN_PREPARATION: 1,
  READY_FOR_REVIEW: 2,
  READY_FOR_SIGNATURE: 2,
  READY_TO_FILE: 3,
  TRANSMITTED: 4,
  REJECTED: 4,
  ACCEPTED: 5,
  CLOSED: 6,
};

export function workflowSteps(status: TaxReturnWorkflowStatus, frame: 2 | 3): Step[] {
  const labels =
    frame === 2
      ? ['Intake', 'Preparation', 'Review', 'E-Signatures', 'E-File', 'Closed']
      : ['Intake', 'Preparation', 'Review', 'Ready to File', 'Transmitted', 'Closed'];
  const at = (frame === 2 ? FRAME2 : FRAME3)[status];
  return labels.map((label, i) => ({
    label,
    state:
      i < at
        ? 'complete'
        : i === at
          ? status === 'REJECTED'
            ? 'rejected'
            : status === 'WAITING_ON_CLIENT'
              ? 'waiting'
              : 'current'
          : 'not',
  }));
}

const STEP_TEXT: Record<Step['state'], string> = {
  complete: 'Complete',
  current: 'In Progress',
  waiting: 'Waiting on Client',
  rejected: 'Rejected',
  not: 'Not Started',
};

/** The return's progress: numbered circles on a line, each with its state below. */
export function WorkflowStepper({
  status,
  frame,
  numbered,
}: {
  status: TaxReturnWorkflowStatus;
  frame: 2 | 3;
  numbered?: boolean;
}) {
  const steps = workflowSteps(status, frame);
  return (
    <div className="overflow-x-auto">
      <ol className="flex w-full min-w-[30rem] items-start" aria-label="Return workflow">
        {steps.map((s, i) => {
          const done = s.state === 'complete';
          const on = s.state === 'current' || s.state === 'waiting' || s.state === 'rejected';
          return (
            <li
              key={s.label}
              className="relative flex flex-1 flex-col items-center gap-1 text-center"
              aria-current={on ? 'step' : undefined}
            >
              {i > 0 ? (
                <span
                  aria-hidden
                  className={`absolute top-4 right-1/2 h-1 w-full -translate-y-1/2 ${done || on ? 'bg-success' : 'bg-divider'}`}
                />
              ) : null}
              <span
                className={`relative z-10 flex size-9 items-center justify-center rounded-full text-sm font-bold ${done ? 'bg-success text-on-action' : on ? (s.state === 'rejected' ? 'bg-danger text-on-action' : 'bg-action text-on-action') : 'bg-control-border text-on-action'}`}
              >
                {done ? <Check aria-hidden weight="bold" className="size-5" /> : i + 1}
              </span>
              <span className={`text-sm font-medium ${on ? 'text-action' : 'text-heading'}`}>
                {numbered ? `${i + 1}. ` : ''}
                {s.label}
              </span>
              <span
                className={`rounded px-1.5 text-[11px] font-medium ${done ? 'bg-success-soft text-success' : on ? (s.state === 'rejected' ? 'bg-danger-soft text-danger' : 'bg-info-soft text-action') : 'bg-disabled text-muted'}`}
              >
                {STEP_TEXT[s.state]}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- Checklists (preparation, review) ----------

/** A preparation or review checklist: tick items done, add, note and remove them. */
export function ChecklistPanel({
  detail,
  section,
  title,
  onNotice,
}: {
  detail: TaxReturnDetail;
  section: 'PREPARATION' | 'REVIEW';
  title: string;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const q = usePart(detail.id, 'checklist', () => api.taxReturnWorkspace.checklist(detail.id));
  const items = (q.data ?? [])
    .filter((c) => c.section === section)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const [adding, setAdding] = useState(false);
  const done = items.filter((c) => c.result === 'DONE').length;
  const toggle = (c: TaxChecklistItem) =>
    void act(
      () =>
        api.taxReturnWorkspace.updateChecklistItem(detail.id, c.id, {
          result: c.result === 'DONE' ? 'OPEN' : 'DONE',
        }),
      c.result === 'DONE' ? 'Marked open.' : 'Marked done.',
    );
  return (
    <Panel
      title={title}
      icon={CheckSquare}
      testId={`checklist-${section.toLowerCase()}`}
      action={
        <span className="flex items-center gap-3 text-sm text-muted">
          {items.length ? `${done} of ${items.length} done` : null}
          <button type="button" className={smallButton} onClick={() => setAdding(true)}>
            <Plus aria-hidden weight="bold" className="size-4" /> Add Item
          </button>
        </span>
      }
    >
      {q.isError ? (
        <p role="alert" className={quiet}>
          The checklist is not available right now.
        </p>
      ) : !items.length ? (
        <p className={quiet}>
          {q.isPending ? 'Loading…' : 'No checklist items yet. Add the steps this return needs.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-lg border border-divider text-sm">
          {items.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={c.result === 'DONE'}
                onChange={() => toggle(c)}
                aria-label={c.label}
              />
              <span className="flex-1">
                <span className={c.result === 'DONE' ? 'text-muted line-through' : 'text-heading'}>
                  {c.label}
                </span>
                {c.note ? <span className="block text-xs text-muted">{c.note}</span> : null}
              </span>
              <button
                type="button"
                aria-label={`Remove ${c.label}`}
                className="text-muted hover:text-danger"
                onClick={() =>
                  void act(
                    () => api.taxReturnWorkspace.removeChecklistItem(detail.id, c.id),
                    'Item removed.',
                  )
                }
              >
                <Trash aria-hidden weight="fill" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <AddCheckDialog
          returnId={detail.id}
          section={section}
          onClose={() => setAdding(false)}
          onNotice={onNotice}
        />
      ) : null}
    </Panel>
  );
}

// ---------- Return documents ----------

export const DOC_KIND: Record<
  TaxReturnDocument['kind'],
  { label: string; tone: 'neutral' | 'warning' | 'success' | 'info' | 'purple' }
> = {
  DRAFT_RETURN: { label: 'Draft', tone: 'neutral' },
  SIGNATURE_FORM: { label: 'Signature Form', tone: 'warning' },
  FILED_RETURN: { label: 'Filed Return', tone: 'success' },
  ACKNOWLEDGMENT: { label: 'Acknowledgment', tone: 'success' },
  VOUCHER: { label: 'Voucher', tone: 'info' },
  PAYMENT_PROOF: { label: 'Payment Proof', tone: 'info' },
  EXTENSION: { label: 'Extension', tone: 'purple' },
};

/**
 * The return's documents: the client's files linked with their role (draft, Form 8879, filed
 * return, acknowledgment, voucher, extension). Files are uploaded in the client's Documents.
 */
export function ReturnDocumentsPanel({
  detail,
  onNotice,
  limit,
  kinds,
}: {
  detail: TaxReturnDetail;
  onNotice: Notice;
  limit?: number;
  kinds?: TaxReturnDocument['kind'][];
}) {
  const act = useAct(onNotice);
  const q = usePart(detail.id, 'documents', () => api.taxReturnWorkspace.documents(detail.id));
  const [linking, setLinking] = useState(false);
  const all = (q.data ?? []).filter((d) => !kinds || kinds.includes(d.kind));
  const shown = limit ? all.slice(0, limit) : all;
  const download = async (id: string) => {
    const link = await act(() => api.documents.download(id), 'Download ready.');
    if (link) window.location.assign(link.url);
  };
  return (
    <Panel
      title="Documents"
      icon={FileText}
      testId="return-documents"
      action={
        <span className="flex items-center gap-3">
          {limit && all.length > limit ? (
            <Link href={`/tax-returns/${detail.id}?tab=documents`} className={textButton}>
              View All ({all.length})
            </Link>
          ) : null}
          <button type="button" className={smallButton} onClick={() => setLinking(true)}>
            <Plus aria-hidden weight="bold" className="size-4" /> Link Document
          </button>
        </span>
      }
    >
      {q.isError ? (
        <p role="alert" className={quiet}>
          Documents are not available right now.
        </p>
      ) : !shown.length ? (
        <p className={quiet}>
          {q.isPending ? 'Loading…' : 'No documents linked to this return yet.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider text-sm">
          {shown.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
              <FileText aria-hidden weight="fill" className="size-5 text-danger" />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-heading hover:text-link hover:underline disabled:hover:no-underline"
                disabled={d.document.scanStatus !== 'CLEAN'}
                onClick={() => void download(d.document.id)}
              >
                {d.document.fileName}
                {d.jurisdiction ? ` (${d.jurisdiction === 'US' ? 'Federal' : d.jurisdiction})` : ''}
              </button>
              <Badge tone={DOC_KIND[d.kind].tone}>{DOC_KIND[d.kind].label}</Badge>
              {d.document.scanStatus !== 'CLEAN' ? (
                <Badge tone={d.document.scanStatus === 'PENDING' ? 'neutral' : 'danger'}>
                  {d.document.scanStatus === 'PENDING' ? 'Scanning' : 'Blocked'}
                </Badge>
              ) : null}
              <span className="w-24 text-muted">{dayText(d.createdAt.slice(0, 10))}</span>
              {d.kind !== 'FILED_RETURN' && d.kind !== 'ACKNOWLEDGMENT' ? (
                <button
                  type="button"
                  aria-label={`Unlink ${d.document.fileName}`}
                  className="text-muted hover:text-danger"
                  onClick={() =>
                    void act(
                      () => api.taxReturnWorkspace.unlinkDocument(detail.id, d.document.id),
                      'Document unlinked.',
                    )
                  }
                >
                  <Trash aria-hidden weight="fill" className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {linking ? (
        <LinkDocumentDialog detail={detail} onClose={() => setLinking(false)} onNotice={onNotice} />
      ) : null}
    </Panel>
  );
}

function LinkDocumentDialog({
  detail,
  onClose,
  onNotice,
}: {
  detail: TaxReturnDetail;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const docs = useApiQuery([...TR_KEY, 'client-docs', detail.client.id], () =>
    api.documents.list(detail.client.id, { limit: 100 }),
  );
  const [doc, setDoc] = useState('');
  const [kind, setKind] = useState<TaxReturnDocument['kind']>('DRAFT_RETURN');
  const [jurisdiction, setJurisdiction] = useState('');
  const bad = !!jurisdiction && !/^(US|[A-Z]{2})$/.test(jurisdiction);
  return (
    <Dialog
      title="Link Document"
      subtitle="One of the client's documents (upload it in the client's Documents first)"
      confirm="Link"
      disabled={!doc || bad}
      onConfirm={() =>
        void act(
          () =>
            api.taxReturnWorkspace.linkDocument(detail.id, {
              documentId: doc,
              kind,
              ...(jurisdiction ? { jurisdiction } : {}),
            }),
          'Document linked.',
        ).then((r) => r && onClose())
      }
      onClose={onClose}
      testId="link-doc-dialog"
    >
      <Select
        label="Document"
        value={doc}
        onChange={(e) => setDoc(e.target.value)}
        options={[
          {
            value: '',
            label: docs.isPending
              ? 'Loading…'
              : docs.data?.items.length
                ? 'Choose a document'
                : 'This client has no documents yet',
          },
          ...(docs.data?.items ?? []).map((d) => ({
            value: d.id,
            label: `${d.fileName}${d.taxYear ? ` (${d.taxYear})` : ''}`,
          })),
        ]}
      />
      <Select
        label="Role in this return"
        value={kind}
        onChange={(e) => setKind(e.target.value as TaxReturnDocument['kind'])}
        options={Object.entries(DOC_KIND).map(([value, k]) => ({ value, label: k.label }))}
      />
      <Input
        label="Jurisdiction (optional: US or a state code)"
        maxLength={2}
        value={jurisdiction}
        onChange={(e) => setJurisdiction(e.target.value.toUpperCase())}
        {...(bad ? { error: 'Use US or a two-letter state code' } : {})}
      />
      <Link href={`/clients/${detail.client.id}/documents`} className={textButton}>
        Upload in the client's Documents
      </Link>
    </Dialog>
  );
}

// ---------- Document checklist (the client's document requests) ----------

const REQUEST: Record<
  DocumentRequestStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }
> = {
  REQUESTED: { label: 'Requested', tone: 'warning' },
  SUBMITTED: { label: 'Received', tone: 'success' },
  ACCEPTED: { label: 'Reviewed', tone: 'success' },
  REJECTED: { label: 'Replace Needed', tone: 'danger' },
  NOT_AVAILABLE: { label: 'Not Needed', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

/** Document Checklist: the client's document requests, with what came in and when. */
export function DocumentChecklist({ detail, limit }: { detail: TaxReturnDetail; limit?: number }) {
  const q = useApiQuery([...TR_KEY, 'doc-requests', detail.client.id], () =>
    api.documents.requests(detail.client.id),
  );
  const all = (q.data ?? []).filter((r) => r.status !== 'CANCELLED');
  const shown = limit ? all.slice(0, limit) : all;
  return (
    <Panel
      title="Document Checklist"
      icon={Files}
      testId="document-checklist"
      action={
        limit && all.length > 0 ? (
          <Link href={`/tax-returns/${detail.id}?tab=documents`} className={textButton}>
            View All ({all.length})
          </Link>
        ) : null
      }
    >
      {q.isError ? (
        <p role="alert" className={quiet}>
          Document requests are not available right now.
        </p>
      ) : !shown.length ? (
        <p className={quiet}>
          {q.isPending ? 'Loading…' : 'No documents requested from this client yet.'}
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Requested documents</caption>
          <thead className="bg-table-head">
            <tr>
              {['Document', 'Status', 'Date Uploaded'].map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-divider">
                <td className="px-2 py-1.5 text-link">{r.title}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <Badge
                    tone={REQUEST[r.status].tone}
                    icon={REQUEST[r.status].tone === 'success' ? CheckCircle : WarningCircle}
                  >
                    {REQUEST[r.status].label}
                  </Badge>
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {r.documents[0] ? dayText(r.documents[0].createdAt.slice(0, 10)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href={`/clients/${detail.client.id}/documents`} className={smallButton}>
          Upload Documents
        </Link>
        <Link href={`/clients/${detail.client.id}/documents`} className={smallButton}>
          Request Documents
        </Link>
      </div>
    </Panel>
  );
}

// ---------- Tasks ----------

/** Upcoming Tasks: the client's open tasks; Add Task creates one for this client. */
export function UpcomingTasks({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const act = useAct(onNotice);
  const members = useMembers();
  const q = useApiQuery([...TR_KEY, 'tasks', detail.client.id], () =>
    api.tasks.list({ clientId: detail.client.id, status: 'OPEN', limit: 20 }),
  );
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [who, setWho] = useState(detail.preparer?.userId ?? '');
  const items = (q.data?.items ?? []).slice(0, 4);
  return (
    <Panel
      title="Upcoming Tasks"
      icon={CheckSquare}
      testId="upcoming-tasks"
      action={
        <Link href="/tasks" className={textButton}>
          View All
        </Link>
      }
    >
      {q.isError ? (
        <p role="alert" className={quiet}>
          Tasks are not available right now.
        </p>
      ) : !items.length ? (
        <p className={quiet}>{q.isPending ? 'Loading…' : 'No open tasks for this client.'}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Open tasks</caption>
          <thead className="bg-table-head">
            <tr>
              {['Task', 'Due Date', 'Assigned To', 'Status'].map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((t) => {
              const late = !!t.dueOn && t.dueOn < new Date().toISOString().slice(0, 10);
              return (
                <tr key={t.id} className="border-b border-divider">
                  <td className="px-2 py-1.5">
                    <Link href={`/tasks/${t.id}`} className="text-link hover:underline">
                      {t.title}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {t.dueOn ? dayText(t.dueOn) : '—'}
                  </td>
                  <td className="px-2 py-1.5">{shortName(t.assignedTo) ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    <Badge tone={late ? 'danger' : 'warning'}>{late ? 'Overdue' : 'Pending'}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div>
        <button type="button" className={smallButton} onClick={() => setAdding(true)}>
          <Plus aria-hidden weight="bold" className="size-4" /> Add Task
        </button>
      </div>
      {adding ? (
        <Dialog
          title="Add Task"
          subtitle={`${detail.client.name}, ${detail.taxYear} ${detail.formType ?? 'return'}`}
          confirm="Add Task"
          disabled={!title.trim()}
          onConfirm={() =>
            void act(
              () =>
                api.tasks.create({
                  clientId: detail.client.id,
                  title: title.trim(),
                  details: `Tax return ${detail.taxYear}${detail.formType ? ` ${detail.formType}` : ''}`,
                  ...(due ? { dueOn: due } : {}),
                  ...(who ? { assignedUserId: who } : {}),
                  ...(detail.engagement ? { engagementId: detail.engagement.id } : {}),
                }),
              'Task added.',
            ).then((r) => {
              if (r) {
                setAdding(false);
                setTitle('');
              }
            })
          }
          onClose={() => setAdding(false)}
          testId="add-task-dialog"
        >
          <Input
            label="Task"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            label="Due date"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <Select
            label="Assigned to"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            options={[{ value: '', label: 'Unassigned' }, ...members]}
          />
        </Dialog>
      ) : null}
    </Panel>
  );
}

// ---------- Notes ----------

/**
 * Notes: the firm's internal notes on the client (the return's engagement's, when it has one).
 * Never shown in the portal; client-facing messages stay in Messages.
 */
export function NotesPanel({
  detail,
  onNotice,
  limit,
}: {
  detail: TaxReturnDetail;
  onNotice: Notice;
  limit?: number;
}) {
  const act = useAct(onNotice);
  const query = detail.engagement ? { engagementId: detail.engagement.id } : {};
  const q = useApiQuery([...TR_KEY, 'notes', detail.client.id, query], () =>
    api.clientNotes.list(detail.client.id, query),
  );
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState('');
  const notes = q.data ?? [];
  const shown = limit ? notes.slice(0, limit) : notes;
  return (
    <Panel
      title="Notes"
      icon={NotePencil}
      testId="notes"
      action={
        <button type="button" className={textButton} onClick={() => setAdding(true)}>
          + Add Note
        </button>
      }
    >
      {q.isError ? (
        <p role="alert" className={quiet}>
          Notes are not available right now.
        </p>
      ) : !shown.length ? (
        <p className={quiet}>{q.isPending ? 'Loading…' : 'No internal notes yet.'}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {shown.map((n) => (
            <li key={n.id} className="rounded-lg bg-canvas px-3 py-2">
              <p className="text-muted">
                {dateTimeText(n.createdAt)} — {n.author.name}
              </p>
              <p className="whitespace-pre-line text-text">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <Dialog
          title="Add Note"
          subtitle="Internal: never shown to the client"
          confirm="Add Note"
          disabled={!body.trim()}
          onConfirm={() =>
            void act(
              () =>
                api.clientNotes.create(detail.client.id, {
                  body: body.trim(),
                  ...(detail.engagement ? { engagementId: detail.engagement.id } : {}),
                }),
              'Note added.',
            ).then((r) => {
              if (r) {
                setAdding(false);
                setBody('');
              }
            })
          }
          onClose={() => setAdding(false)}
          testId="add-note-dialog"
        >
          <Textarea
            label="Note"
            value={body}
            maxLength={5000}
            onChange={(e) => setBody(e.target.value)}
          />
        </Dialog>
      ) : null}
    </Panel>
  );
}

// ---------- Activity ----------

/** Recent Activity (Overview) or the full Activity tab with the status and assignment history. */
export function ActivityPanel({ detail, limit }: { detail: TaxReturnDetail; limit?: number }) {
  const q = usePart(detail.id, 'activity', () => api.taxReturnWorkspace.activity(detail.id));
  const history = usePart(detail.id, 'history', () => api.taxReturnWorkspace.history(detail.id));
  const items = (q.data ?? []).slice(0, limit ?? 200);
  return (
    <Panel
      title={limit ? 'Recent Activity' : 'Activity'}
      icon={ClockCounterClockwise}
      testId="activity"
      action={
        limit ? (
          <Link href={`/tax-returns/${detail.id}?tab=activity`} className={textButton}>
            View All
          </Link>
        ) : null
      }
    >
      {q.isError ? (
        <p role="alert" className={quiet}>
          Activity is not available right now.
        </p>
      ) : (
        <Timeline
          label="Return activity"
          variant="rail"
          emptyText={q.isPending ? 'Loading…' : 'No activity yet.'}
          items={items.map((a) => ({
            id: a.id,
            ...ACTIVITY_ICON[a.kind],
            title: a.label,
            time: dateTimeText(a.at),
            dateTime: a.at,
            ...(a.by ? { actor: `by ${a.by}` } : {}),
          }))}
        />
      )}
      {!limit ? (
        <div>
          <h3 className="mb-1 font-semibold text-heading">Status and assignments</h3>
          {history.isError ? (
            <p className={quiet}>The history is not available right now.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-divider text-sm">
              {(history.data ?? []).map((h) => (
                <li key={`${h.at}-${h.workflowStatus}-${h.by?.userId ?? ''}`} className="py-2">
                  <span className="font-medium text-heading">{STATUS_LABEL[h.workflowStatus]}</span>
                  <span className="text-muted">
                    {' '}
                    · {dateTimeText(h.at)}
                    {h.by ? ` · ${h.by.name}` : ''}
                    {h.preparer ? ` · Preparer ${h.preparer.name}` : ''}
                    {h.reviewer ? ` · Reviewer ${h.reviewer.name}` : ''}
                  </span>
                  {h.reason ? <span className="block text-text">“{h.reason}”</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
