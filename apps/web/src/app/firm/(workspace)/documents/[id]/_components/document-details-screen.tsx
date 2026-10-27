'use client';

import {
  ApiRequestError,
  DOCUMENT_ERRORS,
  type LibraryDocument,
  type UpdateLibraryDocumentRequest,
} from '@firmivra/types';
import {
  ActionMenu,
  Avatar,
  Badge,
  Button,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  Toast,
} from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  ArrowLeft,
  CaretRight,
  CheckCircle,
  ClipboardText,
  DotsThreeVertical,
  DownloadSimple,
  Eye,
  Folder,
  NotePencil,
  PencilSimple,
  Plus,
  ShareNetwork,
  Trash,
  UploadSimple,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { formatPhone } from '../../../clients/_components/client-parts';
import { FileIcon } from '../../_components/file-icon';
import { sizeText } from '../share/_components/share-parts';
import { COLORS } from '../../settings/_components/folder-parts';
import { atText, cleanTag, REVIEW_LOOKS, reviewMoves } from './details-parts';
import { DocumentViewer } from './document-viewer';

const ERRORS: Record<string, string> = {
  ...DOCUMENT_ERRORS,
  INVALID_STATUS: 'Restore the document from Trash first.',
  FOLDER_SCOPE:
    'An internal document goes in a Firm Internal folder, a client document in a client folder.',
  NOT_A_MEMBER: 'That team member is no longer active. Choose another.',
};
const ACTIVITY: Partial<Record<string, { icon: Icon; tone: string }>> = {
  UPLOADED: { icon: UploadSimple, tone: 'bg-success text-on-action' },
  REPLACED: { icon: UploadSimple, tone: 'bg-success text-on-action' },
  DOWNLOADED: { icon: Eye, tone: 'bg-info text-on-action' },
  REVIEW: { icon: PencilSimple, tone: 'bg-info text-on-action' },
  UPDATED: { icon: NotePencil, tone: 'bg-info text-on-action' },
};

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 py-1.5 text-sm">
      <dt className="text-heading">{label}</dt>
      <dd className="min-w-0 text-text">{children}</dd>
    </div>
  );
}

function RailCard({
  title,
  action,
  children,
  testId,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl font-bold text-heading">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const linkButton = 'text-sm font-medium text-action underline';

/**
 * Document Details (Documents design, Frame 2): the file's preview, its information, versions and
 * history, and what may be done with it: download, share, edit details, review, archive and
 * trash (the library API). Notes, related forms and appointments have no link to a document yet,
 * so their tabs are shown off; the Document Requests tab opens the request the file answers.
 */
export function DocumentDetailsScreen({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const key = ['library-document', id];
  const doc = useQuery({
    queryKey: key,
    queryFn: () => api.documentLibrary.get(id),
    retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2,
  });
  const ready = doc.isSuccess;
  const versions = useQuery({
    queryKey: [...key, 'versions'],
    queryFn: () => api.documentLibrary.versions(id),
    enabled: ready,
  });
  const activity = useQuery({
    queryKey: [...key, 'activity'],
    queryFn: () => api.documentLibrary.activity(id),
    enabled: ready,
  });
  const clientId = doc.data?.client.id;
  const client = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => api.clients.get(clientId ?? ''),
    enabled: Boolean(clientId),
  });
  const categories = useQuery({
    queryKey: ['document-categories'],
    queryFn: () => api.documents.categories(),
  });
  const folders = useQuery({
    queryKey: ['document-folders'],
    queryFn: () => api.documentLibrary.folders(),
  });
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.team.list(), enabled: manager });

  const [note, setNote] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [allVersions, setAllVersions] = useState(false);
  const [allActivity, setAllActivity] = useState(false);

  async function act(done: string, run: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await run();
      await queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      setNote({ text: done, tone: 'success' });
      return true;
    } catch (e) {
      setNote({ text: errorMessage(e, ERRORS), tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const download = () =>
    void act('The download started.', async () => {
      const link = await api.documents.download(id);
      window.location.assign(link.url);
    });

  const crumbs = (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        <li>
          <Link href="/documents" className="text-text hover:text-action hover:underline">
            Documents
          </Link>
        </li>
        <li aria-hidden>
          <CaretRight weight="bold" className="size-3 text-muted" />
        </li>
        <li aria-current="page" className="font-medium text-heading">
          Document Details
        </li>
      </ol>
    </nav>
  );
  const back = (
    <Button variant="outline" onClick={() => router.push('/documents')}>
      <ArrowLeft aria-hidden weight="bold" className="size-5" />
      Back to Documents
    </Button>
  );

  if (!doc.isSuccess) {
    const missing =
      doc.isError && doc.error instanceof ApiRequestError && [400, 404].includes(doc.error.status);
    return (
      <div className="flex flex-col gap-5" data-testid="document-details">
        <PageHeader
          above={crumbs}
          title="Document Details"
          subtitle="View, review, and manage document information."
          actions={back}
        />
        {doc.isPending ? (
          <Skeleton className="h-[40rem]" />
        ) : (
          <p role="alert" className="rounded-card bg-surface p-6 text-center text-text shadow-card">
            {missing
              ? 'This document was not found, or it is not one you can see.'
              : 'This document could not be loaded right now. Try again in a moment.'}
          </p>
        )}
      </div>
    );
  }

  const d = doc.data;
  const look = d.reviewStatus ? REVIEW_LOOKS[d.reviewStatus] : null;
  const status = look ? (
    <Badge tone={look.tone} icon={look.tone === 'success' ? CheckCircle : undefined}>
      {look.label}
    </Badge>
  ) : null;
  const { moves, replace } = reviewMoves(d);
  const c = client.data;
  const contact = c ? [c.email, formatPhone(c.phone)].filter(Boolean).join('  |  ') : '';
  const versionRows = versions.data ?? [];
  const events = activity.data ?? [];

  const more = (
    <ActionMenu
      label="More actions"
      // The kit's trigger button, drawn as the header's other outline buttons.
      className="[&>button]:min-h-11 [&>button]:rounded-control [&>button]:border-action [&>button]:px-4 [&>button]:font-medium [&>button]:text-action [&>button]:hover:bg-accent-soft"
      trigger={
        <>
          <DotsThreeVertical aria-hidden weight="bold" className="size-5" />
          More Actions
        </>
      }
      sections={[
        {
          title: 'Review',
          items: [
            ...moves.map((m) => ({
              label: m.label,
              icon: ClipboardText,
              onSelect: () =>
                void act(`The document is ${REVIEW_LOOKS[m.to].label.toLowerCase()}.`, () =>
                  api.documentLibrary.review(id, { action: m.action }),
                ),
            })),
            ...(replace
              ? [
                  {
                    label: 'Request Replacement',
                    icon: ArrowCounterClockwise,
                    onSelect: () => setReplacing(true),
                  },
                ]
              : []),
          ],
        },
        {
          title: 'Document',
          items: d.trashedAt
            ? [
                {
                  label: 'Restore from Trash',
                  icon: ArrowCounterClockwise,
                  onSelect: () =>
                    void act('The document was restored.', () => api.documentLibrary.untrash(id)),
                },
              ]
            : [
                d.archivedAt
                  ? {
                      label: 'Restore from Archive',
                      icon: ArrowCounterClockwise,
                      onSelect: () =>
                        void act('The document was restored.', () =>
                          api.documentLibrary.restore(id),
                        ),
                    }
                  : {
                      label: 'Archive',
                      icon: Archive,
                      onSelect: () =>
                        void act('The document was archived.', () =>
                          api.documentLibrary.archive(id),
                        ),
                    },
                {
                  label: 'Move to Trash',
                  icon: Trash,
                  danger: true,
                  onSelect: () => setTrashing(true),
                },
              ],
        },
      ]}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="document-details">
      <PageHeader
        above={crumbs}
        title="Document Details"
        subtitle="View, review, and manage document information."
        actions={
          <div className="flex flex-wrap gap-2">
            {back}
            <Button
              variant="outline"
              disabled={d.scanStatus !== 'CLEAN' || busy}
              onClick={download}
            >
              <DownloadSimple aria-hidden weight="bold" className="size-5" />
              Download
            </Button>
            <Button variant="outline" onClick={() => router.push(`/documents/${id}/share`)}>
              <ShareNetwork aria-hidden weight="bold" className="size-5" />
              Share
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilSimple aria-hidden weight="bold" className="size-5" />
              Edit Details
            </Button>
            {more}
          </div>
        }
      />
      {note ? <Toast tone={note.tone} message={note.text} onDismiss={() => setNote(null)} /> : null}
      {d.trashedAt || d.archivedAt ? (
        <p role="status" className="rounded-card bg-warning-soft px-4 py-3 text-sm text-heading">
          {d.trashedAt
            ? 'This document is in Trash. Restore it from More Actions to work with it again.'
            : 'This document is archived. It is kept, and left out of the library until it is restored.'}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-4" data-testid="document-file">
              <FileIcon contentType={d.contentType} />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-xl font-bold text-heading">{d.fileName}</span>
                  {status}
                </p>
                <p className="text-sm text-action">
                  Uploaded on {atText(d.createdAt)} | {sizeText(d.sizeBytes)}
                </p>
              </div>
            </div>
            <DocumentViewer doc={d} onDownload={download} />
          </section>

          <section className="flex min-w-0 flex-col gap-3" data-testid="document-related">
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" aria-label="Related" className="flex flex-wrap gap-2">
                {[
                  ['Notes', 'Notes are not kept on a document yet.'],
                  ['Related Forms', 'Intake forms are not linked to documents yet.'],
                ].map(([label, why]) => (
                  <button
                    key={label}
                    type="button"
                    role="tab"
                    aria-selected={false}
                    aria-disabled
                    title={why}
                    disabled
                    className="min-h-10 rounded-control border border-border bg-surface px-4 text-sm font-medium text-muted"
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  role="tab"
                  aria-selected
                  className="min-h-10 rounded-control bg-action px-4 text-sm font-medium text-on-action"
                >
                  Document Requests ({d.request ? 1 : 0})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={false}
                  aria-disabled
                  title="Appointments are not linked to documents yet."
                  disabled
                  className="min-h-10 rounded-control border border-border bg-surface px-4 text-sm font-medium text-muted"
                >
                  Appointments
                </button>
              </div>
              <span className="flex-1" />
              <button
                type="button"
                disabled
                title="Notes are not kept on a document yet."
                className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-muted"
              >
                <Plus aria-hidden weight="bold" className="size-4" />
                Add Note
              </button>
            </div>
            <div role="tabpanel" className="rounded-card border border-border bg-surface">
              {d.request ? (
                <div
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                  data-testid="document-request-link"
                >
                  <ClipboardText aria-hidden weight="fill" className="size-6 text-action" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-heading">{d.request.title}</span>
                    <span className="block text-xs text-muted">
                      The request item this file answers
                    </span>
                  </span>
                  {d.request.packetId ? (
                    <Link href={`/documents/requests/${d.request.packetId}`} className={linkButton}>
                      Open Request
                    </Link>
                  ) : null}
                </div>
              ) : (
                <p className="px-4 py-6 text-center text-sm text-muted">
                  This file does not answer a document request.
                </p>
              )}
            </div>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-5" aria-label="Document">
          <RailCard
            title="Document Information"
            testId="document-info"
            action={
              <button
                type="button"
                className={`inline-flex items-center gap-1 ${linkButton}`}
                onClick={() => setEditing(true)}
              >
                <PencilSimple aria-hidden weight="bold" className="size-4" />
                Edit
              </button>
            }
          >
            <dl>
              <InfoRow label="Document Name">{d.fileName}</InfoRow>
              <InfoRow label="Document Type">{d.category?.name ?? '—'}</InfoRow>
              <InfoRow label="Client">
                <span className="flex items-start gap-2">
                  <Avatar name={d.client.name} size="sm" />
                  <span className="min-w-0">
                    <Link
                      href={`/clients/${d.client.id}`}
                      className="block font-medium text-action hover:underline"
                    >
                      {d.client.name}
                    </Link>
                    {contact ? <span className="block text-xs text-muted">{contact}</span> : null}
                  </span>
                </span>
              </InfoRow>
              <InfoRow label="Folder">
                {d.folder ? (
                  <span className="flex items-center gap-2">
                    <Folder
                      aria-hidden
                      weight="fill"
                      className={`size-5 ${COLORS[d.folder.color].icon}`}
                    />
                    {d.folder.name}
                  </span>
                ) : (
                  'No folder'
                )}
              </InfoRow>
              <InfoRow label="File Size">{sizeText(d.sizeBytes)}</InfoRow>
              <InfoRow label="Date Uploaded">{atText(d.createdAt)}</InfoRow>
              <InfoRow label="Uploaded By">{d.uploadedBy?.name ?? '—'}</InfoRow>
              <InfoRow label="Status">{status ?? 'Not reviewed'}</InfoRow>
              <InfoRow label="Description">{d.description ?? '—'}</InfoRow>
              <InfoRow label="Tags">
                <span className="flex flex-wrap items-center gap-2">
                  {d.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-control bg-info-soft px-2 py-0.5 text-xs font-medium text-action"
                    >
                      {t}
                    </span>
                  ))}
                  <button
                    type="button"
                    aria-label="Add a tag"
                    disabled={d.tags.length >= 20 || Boolean(d.trashedAt)}
                    onClick={() => setTagging(true)}
                    className="inline-flex size-7 items-center justify-center rounded-control border border-action text-action hover:bg-accent-soft disabled:border-border disabled:text-muted"
                  >
                    <Plus aria-hidden weight="bold" className="size-4" />
                  </button>
                </span>
              </InfoRow>
            </dl>
          </RailCard>

          <RailCard
            title="Version History"
            testId="document-versions"
            action={
              versionRows.length > 2 ? (
                <button
                  type="button"
                  className={linkButton}
                  onClick={() => setAllVersions((v) => !v)}
                >
                  {allVersions ? 'Show Less' : 'View All'}
                </button>
              ) : undefined
            }
          >
            {versions.isPending ? (
              <Skeleton className="h-20" />
            ) : versions.isError ? (
              <p className="text-sm text-muted">The versions could not be loaded right now.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-divider">
                {(allVersions ? versionRows : versionRows.slice(0, 2)).map((v) => (
                  <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="inline-flex size-10 items-center justify-center rounded-md bg-canvas font-bold text-heading">
                      v{v.versionNo}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-heading">{v.fileName}</span>
                      <span className="block text-xs text-action">
                        {atText(v.createdAt)}
                        {v.uploadedBy ? ` · ${v.uploadedBy.name}` : ''}
                      </span>
                    </span>
                    {v.current ? <Badge tone="success">Current</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
          </RailCard>

          <RailCard
            title="Activity History"
            testId="document-activity"
            action={
              events.length > 4 ? (
                <button
                  type="button"
                  className={linkButton}
                  onClick={() => setAllActivity((v) => !v)}
                >
                  {allActivity ? 'Show Less' : 'View All'}
                </button>
              ) : undefined
            }
          >
            {activity.isPending ? (
              <Skeleton className="h-24" />
            ) : activity.isError ? (
              <p className="text-sm text-muted">The activity could not be loaded right now.</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted">No activity yet.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {(allActivity ? events : events.slice(0, 4)).map((a) => {
                  const shown = ACTIVITY[a.kind] ?? {
                    icon: ClipboardText,
                    tone: 'bg-info text-on-action',
                  };
                  return (
                    <li key={a.id} className="flex gap-3 text-sm">
                      <span
                        className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${shown.tone}`}
                      >
                        <shown.icon aria-hidden weight="fill" className="size-5" />
                      </span>
                      <span>
                        <span className="block font-semibold text-heading">{a.label}</span>
                        <span className="block text-xs text-action">
                          {atText(a.at)}
                          {a.by ? ` by ${a.by}` : ''}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </RailCard>
        </aside>
      </div>

      <EditDialog
        open={editing}
        doc={d}
        categories={(categories.data ?? []).filter((x) => !x.archivedAt || x.id === d.category?.id)}
        folders={(folders.data ?? []).filter((f) =>
          d.direction === 'INTERNAL' ? f.scope === 'FIRM' : f.scope === 'CLIENT',
        )}
        team={
          manager
            ? (team.data ?? [])
                .filter((m) => m.status === 'ACTIVE')
                .map((m) => ({ value: m.user.id, label: m.user.name }))
            : null
        }
        busy={busy}
        onClose={() => setEditing(false)}
        onSave={(body) =>
          void act('The details were saved.', () => api.documentLibrary.update(id, body)).then(
            (ok) => ok && setEditing(false),
          )
        }
      />
      <TextDialog
        open={replacing}
        title="Request a replacement"
        label="What is missing or wrong *"
        confirm="Request Replacement"
        note={
          d.request
            ? 'The client is asked again for this request item in their portal.'
            : 'The document is marked as needing a replacement.'
        }
        busy={busy}
        onClose={() => setReplacing(false)}
        onSubmit={(reason) =>
          void act('A replacement was requested.', () =>
            api.documentLibrary.review(id, { action: 'REQUEST_REPLACEMENT', reason }),
          ).then((ok) => ok && setReplacing(false))
        }
      />
      <TextDialog
        open={tagging}
        title="Add a Tag"
        label="Tag *"
        confirm="Add Tag"
        busy={busy}
        single
        onClose={() => setTagging(false)}
        onSubmit={(tag) => {
          const t = cleanTag(tag);
          if (d.tags.includes(t)) return setTagging(false);
          void act(`${t} was added.`, () =>
            api.documentLibrary.update(id, { tags: [...d.tags, t] }),
          ).then((ok) => ok && setTagging(false));
        }}
      />
      <Modal
        open={trashing}
        title={`Move ${d.fileName} to Trash?`}
        onClose={() => setTrashing(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTrashing(false)}>
              Keep Document
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void act('The document was moved to Trash.', () =>
                  api.documentLibrary.trash(id),
                ).then(() => setTrashing(false))
              }
            >
              Move to Trash
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">It can be restored from Trash. Nothing is deleted now.</p>
      </Modal>
    </div>
  );
}

function TextDialog({
  open,
  title,
  label,
  confirm,
  note,
  busy,
  single,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  confirm: string;
  note?: string;
  busy: boolean;
  single?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      {open ? (
        <TextForm
          label={label}
          confirm={confirm}
          note={note}
          busy={busy}
          single={single}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      ) : null}
    </Modal>
  );
}

function TextForm({
  label,
  confirm,
  note,
  busy,
  single,
  onClose,
  onSubmit,
}: {
  label: string;
  confirm: string;
  note?: string;
  busy: boolean;
  single?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return setError('Enter something first.');
        onSubmit(value.trim());
      }}
    >
      {note ? <p className="text-sm text-text">{note}</p> : null}
      {single ? (
        <Input
          label={label}
          autoFocus
          maxLength={40}
          value={value}
          error={error || undefined}
          onChange={(e) => setValue(e.target.value)}
        />
      ) : (
        <Textarea
          label={label}
          autoFocus
          rows={3}
          maxLength={500}
          value={value}
          error={error || undefined}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {confirm}
        </Button>
      </div>
    </form>
  );
}

interface Draft {
  fileName: string;
  categoryId: string;
  folderId: string;
  taxYear: string;
  description: string;
  tags: string;
  expiresOn: string;
  reviewerUserId: string;
}

function EditDialog(props: {
  open: boolean;
  doc: LibraryDocument;
  categories: { id: string; name: string }[];
  folders: { id: string; name: string }[];
  team: { value: string; label: string }[] | null;
  busy: boolean;
  onClose: () => void;
  onSave: (body: UpdateLibraryDocumentRequest) => void;
}) {
  return (
    <Modal
      open={props.open}
      title="Edit Details"
      subtitle="The file itself never changes; only its details."
      onClose={props.onClose}
    >
      {props.open ? <EditForm {...props} /> : null}
    </Modal>
  );
}

function EditForm({
  doc: d,
  categories,
  folders,
  team,
  busy,
  onClose,
  onSave,
}: Parameters<typeof EditDialog>[0]) {
  const start: Draft = {
    fileName: d.fileName,
    categoryId: d.category?.id ?? '',
    folderId: d.folder?.id ?? '',
    taxYear: d.taxYear ? String(d.taxYear) : '',
    description: d.description ?? '',
    tags: d.tags.join(', '),
    expiresOn: d.expiresOn ?? '',
    reviewerUserId: d.reviewer?.userId ?? '',
  };
  const [v, setV] = useState(start);
  const [error, setError] = useState('');
  const put = (next: Partial<Draft>) => setV((x) => ({ ...x, ...next }));
  const years = Array.from({ length: 8 }, (_, n) => String(new Date().getFullYear() - n));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.fileName.trim()) return setError('Enter the document’s name.');
        const body: Record<string, unknown> = {};
        if (v.fileName.trim() !== start.fileName) body['fileName'] = v.fileName.trim();
        if (v.categoryId !== start.categoryId) body['categoryId'] = v.categoryId || null;
        if (v.folderId !== start.folderId) body['folderId'] = v.folderId || null;
        if (v.taxYear !== start.taxYear) body['taxYear'] = v.taxYear ? Number(v.taxYear) : null;
        if (v.description.trim() !== start.description)
          body['description'] = v.description.trim() || null;
        const tags = [...new Set(v.tags.split(',').map(cleanTag).filter(Boolean))].slice(0, 20);
        if (tags.join() !== d.tags.join()) body['tags'] = tags;
        if (v.expiresOn !== start.expiresOn) body['expiresOn'] = v.expiresOn || null;
        if (team && v.reviewerUserId !== start.reviewerUserId)
          body['reviewerUserId'] = v.reviewerUserId || null;
        if (!Object.keys(body).length) return onClose();
        onSave(body as UpdateLibraryDocumentRequest);
      }}
    >
      <Input
        label="Document Name *"
        maxLength={255}
        value={v.fileName}
        error={error || undefined}
        onChange={(e) => put({ fileName: e.target.value })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Document Type"
          value={v.categoryId}
          onChange={(e) => put({ categoryId: e.target.value })}
          options={[
            { value: '', label: 'No type' },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Select
          label="Folder"
          value={v.folderId}
          onChange={(e) => put({ folderId: e.target.value })}
          options={[
            { value: '', label: 'No folder' },
            ...folders.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
        <Select
          label="Tax Year"
          value={v.taxYear}
          onChange={(e) => put({ taxYear: e.target.value })}
          options={[
            { value: '', label: 'None' },
            ...[...new Set([...(start.taxYear ? [start.taxYear] : []), ...years])].map((y) => ({
              value: y,
              label: y,
            })),
          ]}
        />
        <Input
          label="Expires On"
          type="date"
          value={v.expiresOn}
          onChange={(e) => put({ expiresOn: e.target.value })}
        />
        {team ? (
          <Select
            label="Reviewer"
            value={v.reviewerUserId}
            onChange={(e) => put({ reviewerUserId: e.target.value })}
            options={[{ value: '', label: 'No reviewer' }, ...team]}
          />
        ) : null}
      </div>
      <Textarea
        label="Description"
        rows={3}
        maxLength={500}
        value={v.description}
        onChange={(e) => put({ description: e.target.value })}
      />
      <Input
        label="Tags (comma separated)"
        maxLength={800}
        value={v.tags}
        onChange={(e) => put({ tags: e.target.value })}
      />
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Save Changes
        </Button>
      </div>
    </form>
  );
}
