'use client';

import {
  ApiRequestError,
  DOCUMENT_ERRORS,
  type MyRequestPacket,
  type MyRequestPacketItem,
  UPLOAD_LIMITS,
} from '@firmivra/types';
import { Badge, Button, Card, FileDropzone, Select, Skeleton } from '@firmivra/ui';
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Eye,
  FileText,
  Info,
  MessageSquare,
  RefreshCw,
  Save,
  Send,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { checkUploadBatch, uploadFile } from '../../../../../../../lib/upload';
import { usePortal } from '../../../../layout';

const day = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const stamp = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const dueText = (d: string) => day.format(new Date(`${d}T00:00:00`));
const size = (bytes: number) =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const VIEW: Record<
  MyRequestPacket['view'],
  [string, 'info' | 'warning' | 'success' | 'neutral' | 'danger']
> = {
  NOT_STARTED: ['Not Started', 'info'],
  IN_PROGRESS: ['In Progress', 'warning'],
  READY: ['Ready to Submit', 'success'],
  SUBMITTED: ['Submitted', 'info'],
  COMPLETED: ['Completed', 'success'],
  EXPIRED: ['Expired', 'neutral'],
};
const ITEM: Record<
  MyRequestPacketItem['status'],
  [string, 'info' | 'warning' | 'success' | 'neutral' | 'danger']
> = {
  REQUESTED: ['Awaiting upload', 'warning'],
  SUBMITTED: ['Uploaded', 'success'],
  ACCEPTED: ['Accepted', 'success'],
  REJECTED: ['Needs a new file', 'danger'],
  NOT_AVAILABLE: ["You don't have it", 'neutral'],
};
const EVENT: Record<MyRequestPacket['activity'][number]['kind'], string> = {
  SENT: 'Request sent',
  UPLOADED: 'File uploaded',
  NOT_AVAILABLE: 'Marked as not available',
  ACCEPTED: 'Accepted by your firm',
  REJECTED: 'Your firm asked for a new file',
  SUBMITTED: 'Submitted for review',
  COMPLETED: 'Request completed',
};
const ACCEPT = Object.entries(UPLOAD_LIMITS.types).flatMap(([type, endings]) => [type, ...endings]);
const answered = (i: MyRequestPacketItem) =>
  i.status === 'SUBMITTED' || i.status === 'ACCEPTED' || i.status === 'NOT_AVAILABLE';

type Tab = 'checklist' | 'messages' | 'activity';

/**
 * Document Request & Upload (Frame 7, docs/mockups/firm-workspace/documents/source/
 * firmivra-frame-7-client-document-request-upload.jpg): one request the firm sent, its checklist,
 * an upload for each item (the portal's ordinary upload with the item's request), and Submit for
 * Review once every required item is answered. Contract: packages/types/src/documents/
 * portal-packets.ts. Every upload is saved when it finishes, so Save Progress has nothing to send.
 */
export function PacketScreen() {
  const { firmSlug: slug, packetId } = useParams<{ firmSlug: string; packetId: string }>();
  const { business } = usePortal();
  const key = ['my-documents', slug, 'packet', packetId];
  const packet = useApiQuery(key, () => api.myDocuments(slug).packet(packetId));
  const [tab, setTab] = useState<Tab>('checklist');
  const [target, setTarget] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const p = packet.data;
  const open = p ? p.items.filter((i) => i.canUpload) : [];
  const chosen = p?.items.find((i) => i.id === target) ?? open.find((i) => !answered(i)) ?? open[0];

  const upload = useApiMutation(
    async ({ item, files }: { item: MyRequestPacketItem; files: File[] }) => {
      checkUploadBatch(files);
      for (const file of files)
        await uploadFile(file, {
          start: (facts) =>
            api.myDocuments(slug).createUpload({
              serviceId: p!.service.id,
              requestId: item.id,
              categoryId: item.category?.id ?? null,
              taxYear: p!.taxYear,
              ...facts,
            }),
          finish: (uploadToken) => api.myDocuments(slug).confirmUpload({ uploadToken }),
        });
      return files.length;
    },
    { invalidate: ['my-documents', slug] },
  );
  const submit = useApiMutation(() => api.myDocuments(slug).submitPacket(packetId), {
    invalidate: ['my-documents', slug],
  });
  const download = useApiMutation((id: string) => api.myDocuments(slug).download(id));

  const send = (item: MyRequestPacketItem, files: File[]) => {
    setNotice(null);
    upload.mutate(
      { item, files: p?.allowMultipleFiles ? files : files.slice(0, 1) },
      {
        onSuccess: (n) =>
          setNotice({
            tone: 'ok',
            text: `${n === 1 ? 'File' : `${n} files`} uploaded for ${item.title}.`,
          }),
        onError: (e) => setNotice({ tone: 'error', text: errorMessage(e, DOCUMENT_ERRORS) }),
      },
    );
  };
  const view = (id: string) =>
    download.mutate(id, {
      onSuccess: (link) => window.open(link.url, '_blank', 'noopener'),
      onError: (e) => setNotice({ tone: 'error', text: errorMessage(e, DOCUMENT_ERRORS) }),
    });

  if (packet.isError && packet.error instanceof ApiRequestError && packet.error.status === 404)
    return (
      <Card
        className="flex flex-col items-center gap-3 p-8! text-center"
        data-testid="packet-missing"
      >
        <h1 className="font-display text-2xl font-bold text-heading">
          This request isn't available
        </h1>
        <p className="text-text">It may have been withdrawn, or it belongs to another account.</p>
        <Link href={`/${slug}/documents`} className="font-semibold text-action">
          Back to Requests
        </Link>
      </Card>
    );

  const required = p?.items.filter((i) => i.required) ?? [];
  const remaining = required.filter((i) => !answered(i)).length;
  const pct =
    p && p.progress.requiredTotal
      ? Math.round((p.progress.requiredAnswered / p.progress.requiredTotal) * 100)
      : 0;
  const [viewLabel, viewTone] = p ? VIEW[p.view] : ['', 'info' as const];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-text">
        <Link href={`/${slug}/documents`} className="hover:text-action">
          Documents
        </Link>
        <ChevronRight aria-hidden className="size-4 text-muted" />
        <Link href={`/${slug}/documents`} className="hover:text-action">
          Requests
        </Link>
        <ChevronRight aria-hidden className="size-4 text-muted" />
        <span aria-current="page" className="text-action">
          {p?.title ?? 'Request'}
        </span>
      </nav>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-heading">
            Document Request &amp; Upload
          </h1>
          <p className="text-text">
            Upload the documents your firm requested, then submit them for review.
          </p>
        </div>
        <Link
          href={`/${slug}/documents`}
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-action px-4 font-semibold text-action hover:bg-info-soft"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to Requests
        </Link>
      </header>

      <Card
        className="flex flex-col gap-4 p-5! md:flex-row md:items-center"
        data-testid="packet-summary"
      >
        {p ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-info-soft text-action">
                <FileText aria-hidden className="size-7" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-display text-2xl font-bold text-heading">{p.title}</h2>
                  <Badge tone={viewTone}>{viewLabel}</Badge>
                  {p.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                </div>
                <p className="text-sm text-muted">
                  {business?.name ?? 'Your firm'} • {p.service.title} • Request #{p.reference}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 md:w-80 md:border-l md:border-divider md:pl-6">
              <p className="flex justify-between text-sm text-text">
                <span>
                  {p.progress.requiredAnswered} of {p.progress.requiredTotal} required items
                  uploaded
                </span>
                <span className="font-semibold text-action">{pct}%</span>
              </p>
              <span className="h-2 rounded-full bg-canvas" aria-hidden>
                <span className="block h-2 rounded-full bg-action" style={{ width: `${pct}%` }} />
              </span>
              <p className="text-xs text-muted">
                {p.submittedAt
                  ? `Submitted ${stamp.format(new Date(p.submittedAt))}.`
                  : p.view === 'EXPIRED'
                    ? 'This request has expired. Message your firm if you still need to send documents.'
                    : 'Your request has not been submitted yet.'}
              </p>
            </div>
          </>
        ) : packet.isError ? (
          <p className="text-sm text-muted">
            Could not load this request right now. Try again in a moment.
          </p>
        ) : (
          <div className="flex w-full flex-col gap-2" role="status" aria-label="Loading">
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-5 w-1/3" />
          </div>
        )}
      </Card>

      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${notice.tone === 'error' ? 'text-danger' : 'text-success'}`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_22rem]">
        <Card className="flex min-w-0 flex-col p-0!" data-testid="packet-tabs">
          <div
            role="tablist"
            aria-label="Request"
            className="flex gap-6 border-b border-divider px-5"
          >
            {(
              [
                ['checklist', 'Document Checklist', p?.items.length],
                ['messages', 'Messages', 0],
                ['activity', 'Activity', undefined],
              ] as const
            ).map(([id, label, n]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`-mb-px inline-flex min-h-12 items-center gap-2 border-b-2 text-sm font-semibold ${tab === id ? 'border-action text-action' : 'border-transparent text-text'}`}
              >
                {label}
                {n !== undefined ? (
                  <span className="rounded-md bg-canvas px-1.5 text-xs text-text">{n}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-4 p-5" role="tabpanel">
            {tab === 'checklist' ? (
              <>
                <div>
                  <h3 className="text-lg font-bold text-heading">Requested documents</h3>
                  <p className="text-sm text-text">
                    Please upload a clear, complete copy for each required item.
                    {p?.allowMultipleFiles ? ' You can attach more than one file to an item.' : ''}
                  </p>
                </div>
                {p ? (
                  p.items.length ? (
                    <ul className="flex flex-col gap-3" data-testid="packet-items">
                      {p.items.map((item) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          busy={upload.isPending}
                          onView={view}
                          onPick={(files) => send(item, files)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">
                      There is nothing to upload on this request.
                    </p>
                  )
                ) : packet.isError ? (
                  <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">
                    Could not load the checklist right now.
                  </p>
                ) : (
                  <Skeleton className="h-40 w-full" />
                )}
                <p className="flex items-center gap-2 text-sm text-text">
                  <Info aria-hidden className="size-4 text-muted" />
                  Need to correct an upload? Replace the file before submitting your request.
                </p>
              </>
            ) : tab === 'messages' ? (
              <div className="flex flex-col items-center gap-3 rounded-lg bg-canvas p-6 text-center text-sm text-muted">
                <MessageSquare aria-hidden className="size-6" />
                There are no messages on this request.
                <Link href={`/${slug}/messages`} className="font-semibold text-action">
                  Message Your Firm
                </Link>
              </div>
            ) : p?.activity.length ? (
              <ol className="flex flex-col gap-3" data-testid="packet-activity">
                {[...p.activity].reverse().map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex gap-3 text-sm">
                    <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                    <div>
                      <p className="text-heading">
                        {EVENT[e.kind]}
                        {e.itemTitle ? `: ${e.itemTitle}` : ''}
                      </p>
                      <p className="text-xs text-muted">
                        {stamp.format(new Date(e.at))} · {e.by === 'YOU' ? 'You' : 'Your firm'}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">
                {packet.isError ? 'Could not load the activity right now.' : 'No activity yet.'}
              </p>
            )}
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-5">
          <Card className="flex flex-col gap-3 p-5!" data-testid="request-details">
            <h3 className="flex items-center gap-2 font-display text-xl font-bold text-heading">
              <CalendarDays aria-hidden className="size-5 text-action" /> Request details
            </h3>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">Due date</dt>
              <dd className="text-right font-semibold text-heading">
                {p?.dueOn ? dueText(p.dueOn) : '—'}
              </dd>
              <dt className="text-muted">Requested by</dt>
              <dd className="text-right font-semibold text-heading">
                {p ? (p.requestedBy ?? 'Your firm') : '—'}
              </dd>
              <dt className="text-muted">Tax year</dt>
              <dd className="text-right font-semibold text-heading">{p?.taxYear ?? '—'}</dd>
              <dt className="text-muted">Submission</dt>
              <dd className="text-right font-semibold text-heading">
                {!p
                  ? '—'
                  : p.status === 'COMPLETED'
                    ? 'Completed'
                    : p.status === 'SUBMITTED'
                      ? 'Submitted for review'
                      : p.view === 'READY'
                        ? 'Ready to submit'
                        : p.view === 'EXPIRED'
                          ? 'Expired'
                          : 'Awaiting your documents'}
              </dd>
            </dl>
          </Card>

          <Card className="flex flex-col gap-3 p-5!" data-testid="upload-files">
            <h3 className="flex items-center gap-2 font-display text-xl font-bold text-heading">
              <Upload aria-hidden className="size-5 text-action" /> Upload files
            </h3>
            {open.length ? (
              <>
                <Select
                  label="Attach files to this requested item"
                  value={chosen?.id ?? ''}
                  onChange={(e) => setTarget(e.target.value)}
                  options={open.map((i) => ({ value: i.id, label: i.title }))}
                />
                <FileDropzone
                  label="Files"
                  icon="upload"
                  title="Drag & drop your files here or click to choose"
                  accept={ACCEPT}
                  maxBytes={UPLOAD_LIMITS.maxBytes}
                  multiple={p?.allowMultipleFiles}
                  disabled={upload.isPending || !chosen}
                  hints={[`${UPLOAD_LIMITS.typeNames}, up to 10 MB each.`]}
                  onFiles={(files) => chosen && send(chosen, files)}
                  onReject={() =>
                    setNotice({ tone: 'error', text: DOCUMENT_ERRORS.FILE_TYPE_NOT_ALLOWED })
                  }
                />
                {upload.isPending ? (
                  <p role="status" className="text-sm text-muted">
                    Uploading…
                  </p>
                ) : null}
              </>
            ) : (
              <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">
                {p
                  ? 'This request takes no more files.'
                  : packet.isError
                    ? 'Could not load this request right now.'
                    : 'Loading…'}
              </p>
            )}
            <p className="text-xs text-muted">
              Accepted file types and upload limits are set by your firm. Uploads stay linked to
              this request.
            </p>
          </Card>

          <Card className="flex flex-col gap-2 bg-info-soft! p-5!">
            <h3 className="flex items-center gap-2 font-semibold text-heading">
              <MessageSquare aria-hidden className="size-5 text-action" /> Missing a document?
            </h3>
            <p className="text-sm text-text">
              Ask your firm for help or let them know which document you cannot provide.
            </p>
            <Link href={`/${slug}/messages`} className="text-sm font-semibold text-action">
              Message Your Firm
            </Link>
          </Card>
        </div>
      </div>

      <Card
        className="flex flex-col gap-3 p-5! sm:flex-row sm:items-center sm:justify-between"
        data-testid="submit-bar"
      >
        <div className="text-sm">
          {p && p.status === 'OPEN' && p.view !== 'EXPIRED' ? (
            remaining ? (
              <>
                <p className="flex items-center gap-2 font-semibold text-gold">
                  <AlertCircle aria-hidden className="size-4" />
                  {remaining} required {remaining === 1 ? 'item' : 'items'} remaining
                </p>
                <p className="text-muted">Upload all required items to enable Submit for Review.</p>
              </>
            ) : (
              <p className="font-semibold text-success">
                Every required item is in. Submit when you are ready.
              </p>
            )
          ) : (
            <p className="text-muted">
              {p?.status === 'SUBMITTED'
                ? 'Submitted. Your firm is reviewing your documents.'
                : p?.status === 'COMPLETED'
                  ? 'This request is complete.'
                  : p?.view === 'EXPIRED'
                    ? 'This request has expired.'
                    : ' '}
            </p>
          )}
          {submit.isError ? (
            <p role="alert" className="text-danger">
              {errorMessage(submit.error, DOCUMENT_ERRORS)}
            </p>
          ) : null}
        </div>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            disabled={!p}
            onClick={() =>
              setNotice({
                tone: 'ok',
                text: 'Your progress is saved: each upload is kept as soon as it finishes.',
              })
            }
          >
            <span className="inline-flex items-center gap-2 text-action">
              <Save aria-hidden className="size-4" /> Save Progress
            </span>
          </Button>
          <Button
            className="bg-firm-button! hover:bg-firm-button-hover!"
            disabled={!p?.canSubmit || submit.isPending}
            title={
              p && !p.canSubmit && p.status === 'OPEN' && !remaining
                ? 'Only the account holder can submit this request'
                : undefined
            }
            onClick={() =>
              submit.mutate(undefined, {
                onSuccess: () =>
                  setNotice({ tone: 'ok', text: 'Submitted for review. Your firm has been told.' }),
              })
            }
          >
            <span className="inline-flex items-center gap-2">
              <Send aria-hidden className="size-4" />{' '}
              {submit.isPending ? 'Submitting…' : 'Submit for Review'}
            </span>
          </Button>
        </div>
      </Card>
      <p className="text-center text-xs text-muted">
        Your firm will review your documents after you submit. You will be notified if anything else
        is needed.
      </p>
    </div>
  );
}

function ItemRow({
  item,
  busy,
  onView,
  onPick,
}: {
  item: MyRequestPacketItem;
  busy: boolean;
  onView: (documentId: string) => void;
  onPick: (files: File[]) => void;
}) {
  const newest = item.files[0];
  const done = answered(item);
  const [label, tone] =
    !item.required && item.status === 'REQUESTED'
      ? ['Not added', 'neutral' as const]
      : ITEM[item.status];
  const inputId = `item-file-${item.id}`;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-divider p-4 sm:flex-row sm:items-center">
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${done ? 'bg-success-soft text-success' : 'bg-info-soft text-action'}`}
      >
        <FileText aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-heading">
          {item.title}
          <span className="rounded-md bg-canvas px-1.5 text-xs font-normal text-muted">
            {item.required ? 'Required' : 'Optional'}
          </span>
        </p>
        <p className="text-sm text-muted">
          {newest
            ? `${newest.fileName} · ${size(newest.sizeBytes)}${item.files.length > 1 ? ` · ${item.files.length} files` : ''}`
            : (item.statusNote ?? item.instructions ?? '')}
        </p>
      </div>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <Badge tone={tone}>{label}</Badge>
        <div className="flex gap-2">
          {newest ? (
            <Button
              variant="secondary"
              disabled={newest.status !== 'READY'}
              onClick={() => onView(newest.id)}
            >
              <span className="inline-flex items-center gap-1.5 text-sm">
                <Eye aria-hidden className="size-4" />{' '}
                {newest.status === 'CHECKING' ? 'Checking…' : 'View'}
              </span>
            </Button>
          ) : null}
          {item.canUpload ? (
            <label
              htmlFor={inputId}
              className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-action px-3 text-sm text-action hover:bg-info-soft ${busy ? 'pointer-events-none opacity-50' : ''}`}
            >
              {newest ? (
                <RefreshCw aria-hidden className="size-4" />
              ) : (
                <Upload aria-hidden className="size-4" />
              )}
              {newest ? 'Replace' : 'Upload file'}
              <input
                id={inputId}
                type="file"
                className="sr-only"
                accept={ACCEPT.join(',')}
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (files.length) onPick(files);
                }}
              />
            </label>
          ) : null}
        </div>
      </div>
    </li>
  );
}
