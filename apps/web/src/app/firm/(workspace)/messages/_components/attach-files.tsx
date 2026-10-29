'use client';

import {
  type FirmDocument,
  MESSAGE_ATTACHMENTS_MAX,
  type MessageAttachment,
  UPLOAD_LIMITS,
} from '@firmivra/types';
import { Button, FileDropzone, Modal, Select } from '@firmivra/ui';
import { Paperclip, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { fileSize } from '../../../../../components/message-files';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { uploadFile } from '../../../../../lib/upload';

// The reply's files (MSG-F12): the client's own documents the client can see, or a file uploaded
// here into the client's Documents (shared with the client). Messages Settings decide the types
// and the size; internal files never go.

/** A file chosen for the reply: a document of the client's vault. */
export interface ChosenFile {
  documentId: string;
  fileName: string;
  sizeBytes: number;
  status: MessageAttachment['status'];
}

const MB = 1024 * 1024;
const ending = (name: string) => name.toLowerCase().split('.').pop() ?? '';
const statusOf = (d: FirmDocument): MessageAttachment['status'] =>
  d.scanStatus === 'CLEAN' ? 'READY' : d.scanStatus === 'PENDING' ? 'CHECKING' : 'BLOCKED';
const chosenOf = (d: FirmDocument): ChosenFile => ({
  documentId: d.id,
  fileName: d.fileName,
  sizeBytes: d.sizeBytes,
  status: statusOf(d),
});

/** The chosen files under the reply box, each with Remove. */
export function ChosenFiles({
  files,
  onRemove,
}: {
  files: ChosenFile[];
  onRemove: (documentId: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul aria-label="Files to send" className="flex flex-wrap gap-2" data-testid="chosen-files">
      {files.map((f) => (
        <li
          key={f.documentId}
          className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-control border border-border bg-canvas py-1 pr-1 pl-3 text-sm text-heading"
        >
          <Paperclip aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{f.fileName}</span>
          <span className="shrink-0 text-xs text-muted">
            {f.status === 'CHECKING' ? 'Checking…' : fileSize(f.sizeBytes)}
          </span>
          <button
            type="button"
            aria-label={`Remove ${f.fileName}`}
            onClick={() => onRemove(f.documentId)}
            className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-surface hover:text-heading"
          >
            <X aria-hidden className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Attach: pick the client's documents or upload one into them. */
export function AttachFiles({
  clientId,
  clientName,
  engagementId,
  chosen,
  onChange,
}: {
  clientId: string;
  clientName: string;
  /** The thread's service: an upload is filed there; otherwise one of the client's open ones. */
  engagementId: string | null;
  chosen: ChosenFile[];
  onChange: (files: ChosenFile[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Attach files"
        disabled={chosen.length >= MESSAGE_ATTACHMENTS_MAX}
        onClick={() => setOpen(true)}
        className="flex size-12 shrink-0 items-center justify-center rounded-control border border-border bg-surface text-heading hover:bg-canvas disabled:opacity-50"
      >
        <Paperclip aria-hidden className="size-5" />
      </button>
      {open ? (
        <AttachDialog
          clientId={clientId}
          clientName={clientName}
          engagementId={engagementId}
          chosen={chosen}
          onDone={(files) => {
            onChange(files);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function AttachDialog({
  clientId,
  clientName,
  engagementId,
  chosen,
  onDone,
  onClose,
}: {
  clientId: string;
  clientName: string;
  engagementId: string | null;
  chosen: ChosenFile[];
  onDone: (files: ChosenFile[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<ChosenFile[]>(chosen);
  const [service, setService] = useState(engagementId ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const settings = useApiQuery(['messages', 'settings'], () => api.messages.settings());
  const documents = useApiQuery(['messages', 'attach', clientId], () =>
    api.documents.list(clientId, { limit: 100 }),
  );
  const engagements = useApiQuery(['messages', 'attach', 'services', clientId], () =>
    engagementId ? Promise.resolve([]) : api.engagements.listForClient(clientId),
  );
  const types: readonly string[] = settings.data?.allowedAttachmentTypes ?? [];
  const maxBytes = (settings.data?.attachmentMaxMb ?? 0) * MB;
  const fits = (name: string, size: number) => types.includes(ending(name)) && size <= maxBytes;
  // Internal files never go; blocked ones can't be opened.
  const offered = (documents.data?.items ?? []).filter(
    (d) => d.direction !== 'INTERNAL' && statusOf(d) !== 'BLOCKED',
  );
  const open = (engagements.data ?? []).filter((e) => e.status === 'ACTIVE');
  const fileUnder = engagementId ?? (service || (open.length === 1 ? open[0]?.id : '')) ?? '';
  // An upload goes into Documents, so it takes the vault's types too.
  const accept = Object.values(UPLOAD_LIMITS.types)
    .flat()
    .filter((e) => types.includes(e.slice(1)));
  const isPicked = (id: string) => picked.some((f) => f.documentId === id);
  const toggle = (d: FirmDocument) =>
    setPicked((list) =>
      isPicked(d.id)
        ? list.filter((f) => f.documentId !== d.id)
        : [...list, chosenOf(d)].slice(0, MESSAGE_ATTACHMENTS_MAX),
    );
  const upload = async (files: File[]) => {
    if (!fileUnder) return;
    setBusy(true);
    setProblem(undefined);
    try {
      for (const file of files) {
        const doc = await uploadFile(file, {
          start: (facts) =>
            api.documents.createUpload(clientId, {
              serviceId: fileUnder,
              shareWithClient: true,
              ...facts,
            }),
          finish: (uploadToken) => api.documents.confirmUpload({ uploadToken }),
          maxBytes,
        });
        setPicked((list) => [...list, chosenOf(doc)].slice(0, MESSAGE_ATTACHMENTS_MAX));
      }
      await documents.refetch();
    } catch (e) {
      setProblem(errorMessage(e));
    }
    setBusy(false);
  };
  return (
    <Modal
      open
      title="Attach files"
      subtitle={`From ${clientName}'s documents, or upload one into them`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => onDone(picked)}>
            Attach {picked.length > 0 ? `(${picked.length})` : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="attach-dialog">
        <section className="flex flex-col gap-2" aria-label="Client documents">
          <h3 className="text-sm font-semibold text-heading">{clientName}&apos;s documents</h3>
          {documents.isPending || settings.isPending ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : offered.length === 0 ? (
            <p className="text-sm text-muted">No documents the client can see yet.</p>
          ) : (
            <ul className="flex max-h-60 flex-col gap-1 overflow-auto">
              {offered.map((d) => {
                const ok = fits(d.fileName, d.sizeBytes);
                return (
                  <li key={d.id}>
                    <label
                      className={`flex min-h-11 items-center gap-3 rounded-control px-2 text-sm ${ok ? 'cursor-pointer hover:bg-canvas' : 'opacity-60'}`}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-action"
                        checked={isPicked(d.id)}
                        disabled={
                          !ok || (!isPicked(d.id) && picked.length >= MESSAGE_ATTACHMENTS_MAX)
                        }
                        onChange={() => toggle(d)}
                      />
                      <span className="min-w-0 flex-1 truncate text-heading">{d.fileName}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {!ok
                          ? types.includes(ending(d.fileName))
                            ? `Over ${settings.data?.attachmentMaxMb ?? 0} MB`
                            : 'Type not allowed'
                          : statusOf(d) === 'CHECKING'
                            ? 'Checking…'
                            : fileSize(d.sizeBytes)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-muted">
            Internal files stay hidden: share one with the client in Documents first.
          </p>
        </section>
        <section className="flex flex-col gap-2" aria-label="New upload">
          <h3 className="text-sm font-semibold text-heading">Upload a file</h3>
          {!engagementId && open.length > 1 ? (
            <Select
              label="File it under"
              value={service}
              onChange={(e) => setService(e.target.value)}
              options={[
                { value: '', label: 'Choose a service' },
                ...open.map((e) => ({ value: e.id, label: e.title })),
              ]}
            />
          ) : null}
          {!engagementId && !engagements.isPending && open.length === 0 ? (
            <p className="text-sm text-muted">
              Uploading needs an open service for this client; attach one of their documents
              instead.
            </p>
          ) : (
            <FileDropzone
              label="Upload a file"
              multiple
              accept={accept}
              maxBytes={maxBytes || undefined}
              maxFiles={MESSAGE_ATTACHMENTS_MAX - picked.length}
              disabled={busy || !fileUnder || picked.length >= MESSAGE_ATTACHMENTS_MAX}
              hints={[
                `Accepted formats: ${accept.map((e) => e.slice(1).toUpperCase()).join(', ')}`,
                `Max size: ${settings.data?.attachmentMaxMb ?? 0} MB per file`,
                'It is saved in the client’s documents, shared with the client.',
              ]}
              onFiles={(files) => void upload(files)}
              onReject={() => setProblem('That file’s type or size isn’t allowed.')}
            />
          )}
          {busy ? <p className="text-sm text-muted">Uploading…</p> : null}
          {problem ? (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          ) : null}
        </section>
      </div>
    </Modal>
  );
}
