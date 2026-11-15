'use client';

import { INTAKE_STATUS_LABELS, type AssignedFormRecord, type IntakeView } from '@firmivra/types';
import { ActionMenu, Avatar, Badge, Button, Modal, Textarea, Toast } from '@firmivra/ui';
import {
  CaretRight,
  CheckCircle,
  DotsThreeVertical,
  FilePdf,
  PaperPlaneTilt,
  ChatCircle,
  UserCheck,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createContext, type ReactNode, use, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { nudgeNotice } from '../../../../../../lib/intake-delivery';
import { expiryText, useFirmTimeZone } from '../../_components/expiry';
import { openPdf } from '../../_components/export-pdf';
import {
  type ManageAction,
  ManageDialog,
  manageItems,
  useManager,
} from '../../_components/form-manage';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  DETAIL_KEY,
  STATUS_TONE,
  dayText,
  recordKey,
  responsesKey,
  shortName,
  stamp,
} from './detail-shared';

export type DetailTab =
  'overview' | 'responses' | 'documents' | 'notes' | 'communication' | 'history';
const TABS: { id: DetailTab; label: string; path: string }[] = [
  { id: 'overview', label: 'Overview', path: '' },
  { id: 'responses', label: 'Responses', path: '/responses' },
  { id: 'documents', label: 'Documents', path: '/documents' },
  { id: 'notes', label: 'Notes', path: '/notes' },
  { id: 'communication', label: 'Communication', path: '/communication' },
  { id: 'history', label: 'History', path: '/history' },
];

interface DetailValue {
  id: string;
  record: AssignedFormRecord | undefined;
  responses: IntakeView | undefined;
  loading: boolean;
  notify: (text: string, tone?: 'success' | 'error') => void;
}
const DetailContext = createContext<DetailValue | null>(null);

/** The submission of the open page: its record, its answers and a way to say what happened. */
export function useDetail(): DetailValue {
  const value = use(DetailContext);
  if (!value) throw new Error('useDetail() works only inside <DetailFrame>');
  return value;
}

const outline =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-divider text-sm @7xl:border-l @7xl:pl-5">
      <span className="text-xs font-semibold text-heading">{label}</span>
      <span className="wrap-anywhere text-text">{children}</span>
    </div>
  );
}

/**
 * The top of every submission tab: breadcrumb, title and the four actions, the client card, and
 * the tab bar. A missing or unreachable submission keeps the same frame with quiet placeholders.
 */
export function DetailFrame({ tab, children }: { tab: DetailTab; children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const record = useApiQuery(recordKey(id), () => api.intakeForms.record(id));
  const responses = useApiQuery(responsesKey(id), () => api.intakeForms.responses(id));
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [revising, setRevising] = useState(false);
  const [note, setNote] = useState('');
  const r = record.data;
  const notify = (text: string, tone: 'success' | 'error' = 'success') =>
    setMessage({ text, tone });
  const options = { invalidate: DETAIL_KEY as unknown as string[] };
  const exportPdf = useApiMutation(() => api.intakeForms.exportPdf(id));
  const timeZone = useFirmTimeZone();
  const manager = useManager();
  const [managing, setManaging] = useState<ManageAction>();
  const remind = useApiMutation(() => api.intakeForms.remind(id), options);
  const review = useApiMutation(() => api.intakeForms.markReviewed(id), options);
  // Clients Review Two N8-17: Accept completes the form and makes a New client Active.
  const accept = useApiMutation(() => api.intakeForms.accept(id), options);
  const revise = useApiMutation(
    () => api.intakeForms.requestRevision(id, { note: note.trim() }),
    options,
  );
  const failed = (error: unknown) => notify(errorMessage(error), 'error');
  const reviewable = r?.status === 'SUBMITTED' || r?.status === 'UNDER_REVIEW';
  const revisable = !!r && ['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'].includes(r.status);
  const open = !!r && ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'].includes(r.status);

  return (
    <DetailContext.Provider
      value={{ id, record: r, responses: responses.data, loading: record.isPending, notify }}
    >
      {/* Review Two (layout): sized by the space beside the side menu, not the window. */}
      <div className="@container flex min-w-0 flex-col gap-4" data-testid={`intake-tab-${tab}`}>
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/intake-forms" className="text-link">
            Intake Forms
          </Link>
          <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
          <span className="text-link">{r?.form.name ?? 'Intake form'}</span>
          <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
          <span className="font-semibold text-heading">Submission Review</span>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-heading">Intake Form Details</h1>
            <p className="text-base text-muted">
              Review submitted information, uploaded documents, notes, and activity for this client
              intake form.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Form actions">
            <button
              type="button"
              disabled={!r || exportPdf.isPending}
              className={outline}
              onClick={() => {
                // USABILITY-04: the PDF opens in a tab of its own (opened in the click, so it is
                // not blocked), and this review stays as it is whatever happens there.
                openPdf(
                  (handlers) => exportPdf.mutate(undefined, handlers),
                  (text) => notify(text, 'error'),
                );
              }}
            >
              <FilePdf aria-hidden weight="fill" className="size-4" /> Export PDF
            </button>
            <button
              type="button"
              disabled={!revisable}
              className={outline}
              onClick={() => setRevising(true)}
            >
              <ChatCircle aria-hidden weight="fill" className="size-4" /> Request Revision
            </button>
            <button
              type="button"
              disabled={!open || remind.isPending}
              title={open ? undefined : 'Follow-ups go to forms that are still open'}
              className={outline}
              onClick={() =>
                remind.mutate(undefined, {
                  // 19b: the true result (sent, retrying, or not delivered and why).
                  onSuccess: (record) => {
                    const done = nudgeNotice(record, 'Follow-up sent.');
                    notify(done.message, done.tone);
                  },
                  onError: failed,
                })
              }
            >
              <PaperPlaneTilt aria-hidden weight="fill" className="size-4" /> Send Follow-Up
            </button>
            <button
              type="button"
              disabled={!reviewable || review.isPending}
              className={outline}
              onClick={() =>
                review.mutate(undefined, {
                  onSuccess: () => notify('Marked as reviewed.'),
                  onError: failed,
                })
              }
            >
              <CheckCircle aria-hidden weight="bold" className="size-4" /> Mark Reviewed
            </button>
            <Button
              disabled={!reviewable || accept.isPending}
              title="Completes the form, and a New client becomes Active"
              onClick={() =>
                accept.mutate(undefined, {
                  onSuccess: () =>
                    notify(
                      r?.recipient.kind === 'LEAD'
                        ? 'Accepted.'
                        : 'Accepted. A New client is now Active.',
                    ),
                  onError: failed,
                })
              }
            >
              <UserCheck aria-hidden weight="bold" className="size-4" /> Accept
            </Button>
            {r && manageItems(r, manager, setManaging).length > 0 ? (
              <ActionMenu
                label="More actions"
                trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
                sections={[{ items: manageItems(r, manager, setManaging) }]}
              />
            ) : null}
          </div>
        </div>
        {message ? (
          <Toast
            message={message.text}
            tone={message.tone}
            onDismiss={() => setMessage(undefined)}
          />
        ) : null}
        {record.isError ? (
          <p
            role="status"
            data-testid="detail-state"
            className="rounded-xl bg-surface px-4 py-3 text-sm text-muted shadow-md"
          >
            {errorMessage(record.error)}
          </p>
        ) : null}
        <section
          aria-label="Client"
          data-testid="client-card"
          // INTAKE-DESIGN-01: compact, every detail kept; two rows at a laptop's width, not five.
          className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-x-4 gap-y-3 rounded-xl bg-surface px-4 py-3 shadow-md @xl:grid-cols-[repeat(3,minmax(0,1fr))] @3xl:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))] @7xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_repeat(4,minmax(0,1fr))_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)] @7xl:items-center"
        >
          <div className="col-span-2 flex min-w-0 items-center gap-3 @xl:col-span-1">
            <Avatar name={r?.recipient.name ?? 'Client'} size="lg" />
            <div className="flex min-w-0 flex-col">
              <span className="text-xs font-semibold text-heading">
                {r?.recipient.kind === 'LEAD' ? 'Lead' : 'Client'}
              </span>
              <span className="text-base leading-snug font-bold break-words text-heading">
                {r?.recipient.name ?? '—'}
              </span>
              <span className="text-sm break-all text-link">{r?.recipient.email ?? '—'}</span>
            </div>
          </div>
          <Fact label="Form Name">{r?.form.name ?? '—'}</Fact>
          <Fact label="Service">{r?.service?.name ?? '—'}</Fact>
          <Fact label="Status">
            {r ? <Badge tone={STATUS_TONE[r.status]}>{INTAKE_STATUS_LABELS[r.status]}</Badge> : '—'}
          </Fact>
          <Fact label="Date Sent">{r?.sentAt ? dayText(r.sentAt) : '—'}</Fact>
          <Fact label="Due Date">{r?.dueOn ? dayText(`${r.dueOn}T12:00:00Z`) : 'Not set'}</Fact>
          {/* EXPIRY-01: the effective expiration as saved, with its time zone. */}
          <Fact label="Expires">{r ? expiryText(r.expiresAt, timeZone) : '—'}</Fact>
          <Fact label="Submitted">{r?.submittedAt ? stamp(r.submittedAt) : '—'}</Fact>
          <Fact label="Assigned To">
            {r?.assignedTo ? (
              <span className="flex items-center gap-2">
                <Avatar name={r.assignedTo.name} size="md" /> {shortName(r.assignedTo.name)}
              </span>
            ) : (
              '—'
            )}
          </Fact>
        </section>
        <nav
          aria-label="Submission"
          className="grid grid-cols-3 overflow-hidden rounded-lg border border-divider bg-surface @2xl:grid-cols-6"
        >
          {TABS.map((item) => (
            <Link
              key={item.id}
              href={`/intake-forms/${id}${item.path}`}
              aria-current={item.id === tab ? 'page' : undefined}
              className={`border-divider px-3 py-3 text-center text-sm font-medium not-last:border-r ${item.id === tab ? 'bg-action text-on-action' : 'text-heading hover:bg-canvas'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
      {managing && r ? (
        <ManageDialog
          action={managing}
          row={r}
          onClose={() => setManaging(undefined)}
          notify={notify}
        />
      ) : null}
      <Modal
        open={revising}
        title="Request Revision"
        subtitle="Tell the client what to change. The form goes back to them."
        onClose={() => setRevising(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevising(false)}>
              Cancel
            </Button>
            <Button
              disabled={!note.trim() || revise.isPending}
              onClick={() =>
                revise.mutate(undefined, {
                  onSuccess: () => {
                    setRevising(false);
                    setNote('');
                    notify('Revision requested.');
                  },
                  onError: failed,
                })
              }
            >
              Send request
            </Button>
          </>
        }
      >
        <Textarea
          label="What should the client change?"
          rows={4}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Modal>
    </DetailContext.Provider>
  );
}
