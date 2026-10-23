'use client';

import {
  DOCUMENT_ERRORS,
  fileNameFitsType,
  megabytes,
  type TaskAttachment,
  UPLOAD_LIMITS,
  uploadContentTypeFor,
} from '@firmivra/types';
import { CloudArrowUp, X } from '@phosphor-icons/react';
import { useRef, useState, type DragEvent } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { uploadFile } from '../../../../../lib/upload';

/** A task's file: the design's 10 MB each (the documents API itself takes up to 100 MB). */
export const TASK_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** A new task attaches at most this many files (the contract's `attachments` limit). */
const MAX_FILES = 20;
const ACCEPT = Object.values(UPLOAD_LIMITS.types).flat().join(',');

export interface QueuedFile {
  key: string;
  file: File;
  state: 'queued' | 'uploading' | 'done' | 'error';
  percent?: number;
  /** Why it cannot go, or why it did not: shown on its row. */
  error?: string;
  /** Refused by the checks before sending (type, size, count): remove it to save. */
  blocking?: boolean;
  /** Once uploaded: the document, and whose it is (a new task's client can still change). */
  documentId?: string;
  clientId?: string;
}

/** Thrown when one or more files did not upload; each row says why. */
export class FilesNotUploaded extends Error {}

/** The browser's checks before anything is sent: the documents API's types, 10 MB, not empty. */
export function fileProblem(file: File): string | undefined {
  const type = uploadContentTypeFor(file.name, file.type);
  if (!type || !fileNameFitsType(file.name, type)) return DOCUMENT_ERRORS.FILE_TYPE_NOT_ALLOWED;
  if (file.size === 0) return DOCUMENT_ERRORS.FILE_EMPTY;
  if (file.size > TASK_FILE_MAX_BYTES)
    return `This file is larger than ${megabytes(TASK_FILE_MAX_BYTES)}. Choose a smaller file.`;
  return undefined;
}

const sizeText = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * The Attachments card's files (Octavia's C6). Each one goes up as a document of the task's client
 * through the documents API (private per-firm storage, staff only: `shareWithClient` false), under
 * one of the client's open services, and is then attached to the task by its id. Create Task
 * uploads them when it saves; Edit Task right away.
 */
export function useTaskFiles() {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [next, setNext] = useState(0);
  const patch = (key: string, change: Partial<QueuedFile>) =>
    setQueue((q) => q.map((f) => (f.key === key ? { ...f, ...change } : f)));

  /** Adds the chosen files; a file that cannot go is listed with the reason. */
  function add(files: File[]): QueuedFile[] {
    const room = Math.max(0, MAX_FILES - queue.length);
    const items = files.slice(0, room).map((file, i) => {
      const error = fileProblem(file);
      return {
        key: `f${next + i}`,
        file,
        ...(error
          ? { state: 'error' as const, error, blocking: true }
          : { state: 'queued' as const }),
      };
    });
    const over = files.slice(room).map((file, i) => ({
      key: `f${next + room + i}`,
      file,
      state: 'error' as const,
      error: `A task takes at most ${MAX_FILES} files. Remove some first.`,
      blocking: true,
    }));
    setNext(next + files.length);
    setQueue((q) => [...q, ...items, ...over]);
    return items.filter((f) => f.state === 'queued');
  }
  /** What a save sends: every file the checks let through (a failed upload is tried again). */
  const sendable = queue.filter((f) => !f.blocking);
  const remove = (key: string) => setQueue((q) => q.filter((f) => f.key !== key));

  /** Uploads these files for the client; resolves with every document id, or throws. */
  async function upload(items: QueuedFile[], clientId: string, serviceId: string) {
    const ids: string[] = [];
    let failed = false;
    for (const f of items) {
      if (f.state === 'done' && f.documentId && f.clientId === clientId) {
        ids.push(f.documentId);
        continue;
      }
      patch(f.key, { state: 'uploading', percent: 0, error: undefined });
      try {
        const doc = await uploadFile(f.file, {
          start: (facts) =>
            api.documents.createUpload(clientId, { serviceId, shareWithClient: false, ...facts }),
          finish: (uploadToken) => api.documents.confirmUpload({ uploadToken }),
          maxBytes: TASK_FILE_MAX_BYTES,
          onProgress: (percent) => patch(f.key, { percent }),
        });
        patch(f.key, { state: 'done', documentId: doc.id, clientId, percent: 100 });
        ids.push(doc.id);
      } catch (e) {
        failed = true;
        patch(f.key, { state: 'error', error: errorMessage(e, DOCUMENT_ERRORS) });
      }
    }
    if (failed) throw new FilesNotUploaded('A file was not uploaded.');
    return ids;
  }
  return { queue, sendable, add, remove, patch, upload, setQueue };
}

/**
 * The design's drop zone: Browse Files opens the file chooser, and files can be dropped on it.
 * `blocked` says why files cannot be added yet (no client, no open service); `note` where they go.
 */
export function AttachmentDrop({
  attached,
  queue,
  onFiles,
  onRemove,
  blocked,
  note,
}: {
  attached: TaskAttachment[];
  queue: QueuedFile[];
  onFiles: (files: File[]) => void;
  onRemove: (key: string) => void;
  blocked: string | undefined;
  note: string | undefined;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!blocked) onFiles([...e.dataTransfer.files]);
  };
  return (
    <>
      {attached.length > 0 ? (
        <ul
          className="mb-3 divide-y divide-divider rounded-lg border border-divider"
          data-testid="attached-files"
        >
          {attached.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span className="truncate text-heading">{a.fileName}</span>
              <span className="shrink-0 text-xs text-muted">
                {a.clientVisible ? 'Visible to client' : 'Staff only'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!blocked) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        data-testid="attachment-drop"
        className={`flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center ${over ? 'border-action bg-accent-soft' : 'border-control-border bg-canvas'}`}
      >
        <CloudArrowUp aria-hidden weight="fill" className="size-10 text-action" />
        <p className="text-sm text-heading">Drag and drop files here or click to upload</p>
        <p className="text-xs text-muted">
          Supported files: {UPLOAD_LIMITS.typeNames} (Max {megabytes(TASK_FILE_MAX_BYTES)} each)
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="attachment-input"
          onChange={(e) => {
            if (!blocked) onFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={!!blocked}
          onClick={() => inputRef.current?.click()}
          className="rounded-control border border-action bg-surface px-4 py-2 text-sm font-medium text-action hover:bg-accent-soft disabled:border-border disabled:text-muted disabled:hover:bg-surface"
        >
          Browse Files
        </button>
        <p className="text-xs text-muted" data-testid="attachment-note">
          {blocked ?? note}
        </p>
      </div>
      {queue.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2" data-testid="queued-files">
          {queue.map((f) => (
            <li
              key={f.key}
              className="flex items-center gap-3 rounded-lg border border-divider px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-heading">{f.file.name}</span>
                <span
                  role={f.state === 'error' ? 'alert' : undefined}
                  className={`block text-xs ${f.state === 'error' ? 'text-danger' : 'text-muted'}`}
                >
                  {f.state === 'error'
                    ? f.error
                    : f.state === 'uploading'
                      ? `Uploading… ${f.percent ?? 0}%`
                      : f.state === 'done'
                        ? `${sizeText(f.file.size)} · uploaded`
                        : `${sizeText(f.file.size)} · uploads when the task is saved`}
                </span>
              </span>
              {f.state === 'uploading' ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${f.file.name}`}
                  onClick={() => onRemove(f.key)}
                  className="text-muted hover:text-danger"
                >
                  <X aria-hidden weight="bold" className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
