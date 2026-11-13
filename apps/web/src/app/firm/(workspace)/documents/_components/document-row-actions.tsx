'use client';

import { DOCUMENT_ERRORS, type ClientListItem, type FirmDocument } from '@firmivra/types';
import { ActionMenu, Button, Input, Modal, Select } from '@firmivra/ui';
import {
  Archive,
  DotsThreeVertical,
  DownloadSimple,
  FolderSimple,
  PencilSimple,
  ShareNetwork,
  Signature,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';

/** Every Documents list and count refetches after a change. */
const DOCUMENTS = ['documents'] as const;
/** What Firm Sign takes from the vault: a clean PDF, JPG or PNG. */
const SIGNABLE = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export type RowAction = 'rename' | 'move' | 'archive';

/**
 * A document row's actions (Clients C2-051, V-005). The menu opens outside the table, anchored to
 * its button and kept inside the window (the shared ActionMenu), so every item stays reachable.
 * Download (a clean file), Share, Rename, Move, Request e-sign (a clean PDF, JPG or PNG) and
 * Archive. The server checks each one as before.
 */
export function DocumentRowMenu({
  row,
  client,
  onDownload,
  onAction,
}: {
  row: FirmDocument;
  client: ClientListItem;
  onDownload: (id: string) => void;
  onAction: (action: RowAction, row: FirmDocument) => void;
}) {
  const router = useRouter();
  const clean = row.scanStatus === 'CLEAN';
  return (
    <ActionMenu
      label={`Actions for ${row.fileName}`}
      className="[&>button>svg:last-child]:hidden [&>button]:!size-9 [&>button]:!min-h-0 [&>button]:!justify-center [&>button]:!gap-0 [&>button]:!px-0"
      trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
      sections={[
        {
          items: [
            ...(clean
              ? [{ label: 'Download', icon: DownloadSimple, onSelect: () => onDownload(row.id) }]
              : []),
            {
              label: 'Share',
              icon: ShareNetwork,
              onSelect: () => router.push(`/documents/${row.id}/share`),
            },
            { label: 'Rename', icon: PencilSimple, onSelect: () => onAction('rename', row) },
            { label: 'Move', icon: FolderSimple, onSelect: () => onAction('move', row) },
            ...(clean && SIGNABLE.has(row.contentType)
              ? [
                  {
                    label: 'Request e-sign',
                    icon: Signature,
                    onSelect: () =>
                      router.push(
                        `/firm-sign/new?clientId=${encodeURIComponent(client.id)}&documentId=${encodeURIComponent(row.id)}`,
                      ),
                  },
                ]
              : []),
            {
              label: 'Archive',
              icon: Archive,
              danger: true,
              onSelect: () => onAction('archive', row),
            },
          ],
        },
      ]}
    />
  );
}

/** Rename, Move or Archive one document, each asking first. */
export function DocumentActionDialog({
  action,
  row,
  onClose,
  onDone,
}: {
  action: RowAction;
  row: FirmDocument;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  if (action === 'rename') return <RenameDialog row={row} onClose={onClose} onDone={onDone} />;
  if (action === 'move') return <MoveDialog row={row} onClose={onClose} onDone={onDone} />;
  return <ArchiveDialog row={row} onClose={onClose} onDone={onDone} />;
}

type DialogProps = { row: FirmDocument; onClose: () => void; onDone: (message: string) => void };

function RenameDialog({ row, onClose, onDone }: DialogProps) {
  const [name, setName] = useState(row.fileName);
  const [error, setError] = useState<string>();
  const save = useApiMutation(
    (fileName: string) => api.documentLibrary.update(row.id, { fileName }),
    { invalidate: DOCUMENTS },
  );
  const submit = () => {
    const next = name.trim();
    if (!next) return setError('Enter a file name');
    if (next === row.fileName) return onClose();
    setError(undefined);
    save.mutate(next, { onSuccess: () => onDone(`Renamed to ${next}.`) });
  };
  return (
    <Modal
      open
      title="Rename Document"
      subtitle={row.fileName}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Rename'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3"
      >
        <Input
          label="File name *"
          required
          maxLength={255}
          value={name}
          error={error}
          onChange={(event) => setName(event.target.value)}
        />
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, DOCUMENT_ERRORS)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function MoveDialog({ row, onClose, onDone }: DialogProps) {
  const folders = useApiQuery(['document-folders'], () => api.documentLibrary.folders());
  // A client's file goes in a client folder; an internal one in a firm folder.
  const scope = row.direction === 'INTERNAL' ? 'FIRM' : 'CLIENT';
  const fit = (folders.data ?? []).filter((f) => f.scope === scope);
  const [folderId, setFolderId] = useState('');
  const save = useApiMutation(
    (id: string | null) => api.documentLibrary.update(row.id, { folderId: id }),
    { invalidate: DOCUMENTS },
  );
  const name = fit.find((f) => f.id === folderId)?.name;
  return (
    <Modal
      open
      title="Move Document"
      subtitle={row.fileName}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || folders.isPending}
            onClick={() =>
              save.mutate(folderId || null, {
                onSuccess: () => onDone(name ? `Moved to ${name}.` : 'Moved out of its folder.'),
              })
            }
          >
            {save.isPending ? 'Moving…' : 'Move'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Folder"
          value={folderId}
          disabled={folders.isPending}
          onChange={(event) => setFolderId(event.target.value)}
          options={[
            { value: '', label: 'No folder' },
            ...fit.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
        <p className="text-xs text-muted">
          {scope === 'CLIENT'
            ? 'Client folders only: a firm folder never holds a file the client can see.'
            : 'Firm folders only: this file is internal.'}
        </p>
        {folders.isError || save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error ?? folders.error, DOCUMENT_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function ArchiveDialog({ row, onClose, onDone }: DialogProps) {
  const archive = useApiMutation(() => api.documentLibrary.archive(row.id), {
    invalidate: DOCUMENTS,
  });
  return (
    <Modal
      open
      title="Archive Document"
      subtitle={row.fileName}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={archive.isPending}
            onClick={() =>
              archive.mutate(undefined, { onSuccess: () => onDone(`${row.fileName} archived.`) })
            }
          >
            {archive.isPending ? 'Archiving…' : 'Archive'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">
        It leaves this list but is kept, with its history, and can be restored later.
      </p>
      {archive.error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {errorMessage(archive.error, DOCUMENT_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}
