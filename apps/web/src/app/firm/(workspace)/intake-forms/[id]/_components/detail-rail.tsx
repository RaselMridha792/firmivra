'use client';

import type { AssignedFormRecord, FormDocument } from '@firmivra/types';
import { Avatar, DonutChart, Timeline, type TimelineItem } from '@firmivra/ui';
import {
  CheckCircle,
  DotsThreeVertical,
  FileImage,
  FilePdf,
  File as FileGeneric,
  Circle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useDetail } from './detail-frame';
import { Quiet, eventMeta, shortName, stamp } from './detail-shared';

function RailCard({
  title,
  link,
  testId,
  children,
}: {
  title: string;
  link?: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
        {link}
      </header>
      {children}
    </section>
  );
}
const linkClass = 'text-sm font-medium text-link underline';

/** The icon of a file by its type: PDF red, picture green, anything else grey. */
export function FileTile({ doc }: { doc: Pick<FormDocument, 'contentType' | 'fileName'> }) {
  const pdf = doc.contentType.includes('pdf');
  const image = doc.contentType.startsWith('image/');
  const Glyph = pdf ? FilePdf : image ? FileImage : FileGeneric;
  return (
    <span
      aria-hidden
      className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${pdf ? 'bg-danger-soft text-danger' : image ? 'bg-success-soft text-success' : 'bg-disabled text-muted'}`}
    >
      <Glyph weight="fill" className="size-6" />
    </span>
  );
}

export function SubmissionSummary({
  record,
  id,
}: {
  record: AssignedFormRecord | undefined;
  id: string;
}) {
  const p = record?.progress;
  const checks: [string, boolean][] = [
    ['All questions answered', !!p?.allQuestionsAnswered],
    ['Required documents uploaded', !!p?.requiredDocumentsUploaded],
    ['Form submitted', !!p?.submitted],
    ['Ready for review', !!p?.readyForReview || record?.status === 'COMPLETED'],
  ];
  return (
    <RailCard
      title="Submission Summary"
      testId="rail-summary"
      link={
        <Link href={`/intake-forms/${id}/responses`} className={linkClass}>
          View Form
        </Link>
      }
    >
      <div className="flex items-center gap-4">
        <DonutChart
          size="lg"
          total={100}
          segments={[{ label: 'Completed', value: p?.percent ?? 0, tone: 'green' }]}
          centerValue={p ? `${p.percent}%` : '—'}
          centerLabel="Completed"
          legend={false}
          label="Submission progress"
        />
        <ul className="flex flex-col gap-2 text-sm text-heading">
          {checks.map(([label, done]) => (
            <li key={label} className="flex items-center gap-2">
              {done ? (
                <CheckCircle aria-hidden weight="fill" className="size-5 shrink-0 text-success" />
              ) : (
                <Circle aria-hidden weight="bold" className="size-5 shrink-0 text-control-border" />
              )}
              {label}
            </li>
          ))}
        </ul>
      </div>
    </RailCard>
  );
}

export function UploadedDocuments({
  record,
  id,
}: {
  record: AssignedFormRecord | undefined;
  id: string;
}) {
  const docs = record?.documents ?? [];
  return (
    <RailCard
      title="Uploaded Documents"
      testId="rail-documents"
      link={
        <Link href={`/intake-forms/${id}/documents`} className={linkClass}>
          View All ({docs.length})
        </Link>
      }
    >
      {docs.length === 0 ? (
        <Quiet>No documents uploaded yet.</Quiet>
      ) : (
        <ul className="flex flex-col gap-3">
          {docs.slice(0, 4).map((d) => (
            <li key={d.id} className="flex items-center gap-3">
              <FileTile doc={d} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-heading">{d.fileName}</span>
                <span className="text-xs text-muted">Uploaded {stamp(d.uploadedAt)}</span>
              </span>
              <span
                aria-hidden
                title="Files open from the Documents tab"
                className="flex size-8 items-center justify-center rounded-lg border border-divider text-muted"
              >
                <DotsThreeVertical weight="bold" className="size-4" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

export function InternalNotes({
  record,
  id,
}: {
  record: AssignedFormRecord | undefined;
  id: string;
}) {
  const notes = [...(record?.notes ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <RailCard
      title="Internal Notes"
      testId="rail-notes"
      link={
        <Link href={`/intake-forms/${id}/notes`} className={linkClass}>
          Add Note
        </Link>
      }
    >
      {notes.length === 0 ? (
        <Quiet>No notes yet.</Quiet>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.slice(0, 2).map((n) => (
            <li key={n.id} className="flex gap-3">
              <Avatar name={n.by?.name ?? 'System'} size="lg" />
              <div className="flex min-w-0 flex-col">
                <p className="text-sm font-semibold text-heading">
                  {n.by ? shortName(n.by.name) : 'System'}{' '}
                  <span className="text-xs font-normal text-muted">{stamp(n.at)}</span>
                </p>
                <p className="text-sm text-text">{n.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

export function ActivityTimeline({
  record,
  id,
}: {
  record: AssignedFormRecord | undefined;
  id: string;
}) {
  const items: TimelineItem[] = [...(record?.history ?? [])]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-4)
    .map((e) => ({
      id: e.id,
      icon: eventMeta(e.kind).icon,
      tone: eventMeta(e.kind).tone,
      title: e.label,
      time: stamp(e.at),
      dateTime: e.at,
    }));
  return (
    <RailCard
      title="Activity Timeline"
      testId="rail-history"
      link={
        <Link href={`/intake-forms/${id}/history`} className={linkClass}>
          View All
        </Link>
      }
    >
      <Timeline
        items={items}
        variant="connected"
        label="Recent activity"
        emptyText="No activity yet."
      />
    </RailCard>
  );
}

/** The right column of the Overview. */
export function Rail() {
  const { id, record } = useDetail();
  return (
    <aside aria-label="Summary" className="flex flex-col gap-4">
      <SubmissionSummary record={record} id={id} />
      <UploadedDocuments record={record} id={id} />
      <InternalNotes record={record} id={id} />
      <ActivityTimeline record={record} id={id} />
    </aside>
  );
}
