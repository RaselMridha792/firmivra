'use client';

import { INTAKE_STATUS_LABELS, type AssignedFormRecord, type IntakeView } from '@firmivra/types';
import { Avatar, Badge, Button, Modal, Textarea, Toast } from '@firmivra/ui';
import {
  CaretRight,
  CheckCircle,
  FilePdf,
  PaperPlaneTilt,
  ChatCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createContext, type ReactNode, use, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
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
    <div className="flex min-w-0 flex-col gap-0.5 border-divider text-sm xl:border-l xl:pl-5">
      <span className="text-xs font-semibold text-heading">{label}</span>
      <span className="text-text">{children}</span>
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
  const exportPdf = useApiMutation(() => api.intakeForms.exportPdf(id), options);
  const remind = useApiMutation(() => api.intakeForms.remind(id), options);
  const review = useApiMutation(() => api.intakeForms.markReviewed(id), options);
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
      <div className="flex flex-col gap-4" data-testid={`intake-tab-${tab}`}>
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
              onClick={() =>
                exportPdf.mutate(undefined, {
                  onSuccess: (link) => {
                    const a = document.createElement('a');
                    a.href = link.url;
                    a.download = `${r?.form.name ?? 'intake-form'}.txt`;
                    a.rel = 'noopener';
                    a.click();
                  },
                  onError: failed,
                })
              }
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
                  onSuccess: () => notify('Follow-up sent.'),
                  onError: failed,
                })
              }
            >
              <PaperPlaneTilt aria-hidden weight="fill" className="size-4" /> Send Follow-Up
            </button>
            <Button
              disabled={!reviewable || review.isPending}
              onClick={() =>
                review.mutate(undefined, {
                  onSuccess: () => notify('Marked as reviewed.'),
                  onError: failed,
                })
              }
            >
              <CheckCircle aria-hidden weight="bold" className="size-4" /> Mark Reviewed
            </Button>
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
          className="grid gap-4 rounded-xl bg-surface p-4 shadow-md sm:grid-cols-2 xl:grid-cols-[1.6fr_1.2fr_1fr_1fr_1fr_1fr_1.1fr] xl:items-center"
        >
          <div className="flex items-center gap-3">
            <Avatar name={r?.recipient.name ?? 'Client'} size="xl" />
            <div className="flex min-w-0 flex-col">
              <span className="text-xs font-semibold text-heading">
                {r?.recipient.kind === 'LEAD' ? 'Lead' : 'Client'}
              </span>
              <span className="truncate text-base font-bold text-heading">
                {r?.recipient.name ?? '—'}
              </span>
              <span className="truncate text-sm text-link">{r?.recipient.email ?? '—'}</span>
            </div>
          </div>
          <Fact label="Form Name">{r?.form.name ?? '—'}</Fact>
          <Fact label="Service">{r?.service?.name ?? '—'}</Fact>
          <Fact label="Status">
            {r ? <Badge tone={STATUS_TONE[r.status]}>{INTAKE_STATUS_LABELS[r.status]}</Badge> : '—'}
          </Fact>
          <Fact label="Date Sent">{r?.sentAt ? dayText(r.sentAt) : '—'}</Fact>
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
          className="grid grid-cols-3 overflow-hidden rounded-lg border border-divider bg-surface sm:grid-cols-6"
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
