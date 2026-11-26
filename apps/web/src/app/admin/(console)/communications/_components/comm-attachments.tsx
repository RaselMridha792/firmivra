'use client';

import {
  ADMIN_COMM_ATTACHMENT_TYPES,
  ADMIN_COMM_ERRORS,
  ADMIN_COMM_ATTACHMENTS_MAX,
  ADMIN_COMM_ATTACHMENTS_MAX_BYTES,
  ADMIN_COMM_MEDIA_MAX_BYTES,
  type AdminCommAttachment,
} from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { Paperclip, X } from '@phosphor-icons/react';
import { useId, useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.gif,.webp';

/** "1.2 MB", "340 KB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * SA-COM-R1/R3: one file into the communications library as an attachment: the ticket, the PUT
 * to storage, then confirm (the API checks the stored bytes; locally and on dev it is CLEAN).
 */
export async function uploadCommAttachment(file: File): Promise<AdminCommAttachment> {
  const sha256 = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const ticket = await api.adminBroadcasts.media.create({
    kind: 'ATTACHMENT',
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    sha256,
  });
  // The mock's ticket has no storage behind it.
  if (!ticket.uploadUrl.startsWith('mock:')) {
    const stored = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.headers,
      body: file,
    });
    if (!stored.ok) throw new Error(`${file.name} could not be stored. Try again.`);
  }
  const media = await api.adminBroadcasts.media.confirm(ticket.media.id);
  return {
    id: media.id,
    fileName: media.fileName,
    contentType: media.contentType,
    sizeBytes: media.sizeBytes,
    scanStatus: media.scanStatus,
  };
}

/** Why a picked file can't be attached, or null. */
function refusal(file: File, kept: readonly AdminCommAttachment[], adding: number): string | null {
  if (!(ADMIN_COMM_ATTACHMENT_TYPES as readonly string[]).includes(file.type))
    return `${file.name}: attach a PDF, Word, Excel, CSV, text or image file.`;
  if (file.size > ADMIN_COMM_MEDIA_MAX_BYTES) return `${file.name} is larger than 10 MB.`;
  if (kept.length + adding >= ADMIN_COMM_ATTACHMENTS_MAX)
    return `Attach at most ${ADMIN_COMM_ATTACHMENTS_MAX} files.`;
  return null;
}

/**
 * The attachment area of New Message and the template editor (SA-COM-R1, R3): Attach Files, the
 * files with their size and a remove button, and the reason a file was refused. Files are sent as
 * real attachments, never placed in the text.
 */
export function CommAttachments({
  files,
  onChange,
  disabled = false,
  disabledNote,
  testId,
}: {
  files: AdminCommAttachment[];
  onChange: (files: AdminCommAttachment[]) => void;
  disabled?: boolean;
  /** Said instead of the limits when attaching is off (a text message). */
  disabledNote?: string;
  testId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const total = files.reduce((sum, f) => sum + f.sizeBytes, 0);

  async function add(picked: FileList | null) {
    const list = Array.from(picked ?? []);
    if (inputRef.current) inputRef.current.value = '';
    if (!list.length) return;
    setProblem('');
    let next = [...files];
    let room = ADMIN_COMM_ATTACHMENTS_MAX_BYTES - total;
    setBusy(true);
    try {
      for (const file of list) {
        const why =
          refusal(file, next, 0) ??
          (file.size > room ? 'The files add up to more than 10 MB.' : null);
        if (why) {
          setProblem(why);
          continue;
        }
        const added = await uploadCommAttachment(file);
        next = [...next, added];
        room -= added.sizeBytes;
        onChange(next);
      }
    } catch (error) {
      setProblem(errorMessage(error, ADMIN_COMM_ERRORS));
    } finally {
      setBusy(false);
    }
  }

  const off = disabled || busy;
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPT}
            multiple
            disabled={off}
            className="sr-only"
            aria-label="Attach files"
            onChange={(event) => void add(event.currentTarget.files)}
          />
          <Button
            variant="secondary"
            disabled={off}
            onClick={() => inputRef.current?.click()}
            className="border-transparent bg-info-soft text-action hover:bg-folder-hover"
          >
            <Paperclip aria-hidden weight="bold" className="size-4" />
            {busy ? 'Attaching…' : 'Attach Files'}
          </Button>
          <span className="text-xs text-muted">
            {disabled && disabledNote
              ? disabledNote
              : `PDF, Word, Excel, CSV, text or images; up to ${ADMIN_COMM_ATTACHMENTS_MAX} files, 10 MB in all.`}
          </span>
        </div>
        <span className="text-xs text-muted" data-testid={`${testId}-count`}>
          {files.length} {files.length === 1 ? 'attachment' : 'attachments'}
          {files.length ? ` · ${fileSize(total)}` : ''}
        </span>
      </div>
      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}
      {files.length ? (
        <ul className="flex flex-col gap-2" aria-label="Attached files">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex min-w-0 items-center gap-3 rounded-control border border-border bg-surface px-3 py-2 text-sm"
            >
              <Paperclip aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-text" title={file.fileName}>
                {file.fileName}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {file.scanStatus === 'CLEAN'
                  ? fileSize(file.sizeBytes)
                  : file.scanStatus === 'PENDING'
                    ? 'Being checked'
                    : 'Failed the check'}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(files.filter((f) => f.id !== file.id))}
                aria-label={`Remove ${file.fileName}`}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-subtle hover:text-heading focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
