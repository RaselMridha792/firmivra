'use client';

import {
  BEGIN_ONLINE_ERRORS,
  DOCUMENT_ERRORS,
  type IntakeUpload,
  type IntakeUploadField,
  PORTAL_BLOCKED_TEXT,
  UPLOAD_LIMITS,
} from '@firmivra/types';
import { Button, Checkbox } from '@firmivra/ui';
import { CloudUpload, FileText, LoaderCircle, X } from 'lucide-react';
import { useId, useState } from 'react';
import { errorMessage } from '../../../../../../lib/errors';
import type { Fill } from './intake-fields';
import { issueKey, type ScreenUpload } from './intake-values';

/** What an upload slot needs from the draft: its files and the two actions. */
export interface UploadActions {
  uploads: readonly IntakeUpload[];
  upload: (slot: string, file: File) => Promise<unknown>;
  remove: (uploadId: string) => Promise<unknown>;
}

const ACCEPT = Object.values(UPLOAD_LIMITS.types).flat().join(',');
const STATUS_TEXT: Record<IntakeUpload['status'], string> = {
  CHECKING: 'Checking',
  READY: 'Uploaded',
  BLOCKED: PORTAL_BLOCKED_TEXT.MINE,
};

/**
 * An upload field: a drop zone that sends each file at once (the draft keeps it), the slot's
 * files with Remove, an examples list, and "I don't have this document" with its reason. As a
 * `tile` it is one narrow box of a row of them; `quiet` leaves the label (and the help, which its
 * panel shows) to screen readers.
 */
export function UploadInput({
  field,
  value,
  onChange,
  errors,
  fill,
  actions,
  tile = false,
  quiet = false,
}: {
  field: IntakeUploadField;
  value: ScreenUpload;
  onChange: (value: ScreenUpload) => void;
  errors: Readonly<Record<string, string>>;
  fill: Fill;
  actions: UploadActions;
  tile?: boolean;
  quiet?: boolean;
}) {
  const id = useId();
  const [busy, setBusy] = useState(0);
  const [failure, setFailure] = useState('');
  const [dragging, setDragging] = useState(false);
  const files = actions.uploads.filter((u) => u.slot === field.key);
  const label = `${fill(field.label)}${field.required ? ' *' : ''}`;
  // A missing reason and a missing file are both reported on the field itself.
  const issue = errors[issueKey([field.key])];
  const error = value.notAvailable ? undefined : issue;
  const reasonError = value.notAvailable ? issue : undefined;

  async function send(list: File[]) {
    setFailure('');
    for (const file of list) {
      setBusy((n) => n + 1);
      try {
        await actions.upload(field.key, file);
        if (value.notAvailable) onChange({ notAvailable: false, reason: '' });
      } catch (e) {
        setFailure(
          `${file.name}: ${errorMessage(e, { ...DOCUMENT_ERRORS, ...BEGIN_ONLINE_ERRORS })}`,
        );
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  return (
    <div
      className={`min-w-0 space-y-2 ${tile ? 'h-full rounded-control border border-folder-border p-2' : ''}`}
      data-slot={field.key}
    >
      <div className={quiet ? 'sr-only' : tile ? 'min-h-8' : ''}>
        <p id={`${id}-label`} className="text-xs font-semibold text-heading">
          {label}
        </p>
        {field.help && <p className="text-xs text-firm-primary">{fill(field.help)}</p>}
      </div>
      <div className={`grid gap-3 ${tile ? '' : 'md:grid-cols-2'}`}>
        {/* The whole zone opens the file chooser; the file input inside stays keyboard-reachable. */}
        <label
          title={`${UPLOAD_LIMITS.typeNames}, up to 10 MB each`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void send(Array.from(event.dataTransfer.files));
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-control border border-dashed text-center text-xs has-focus-visible:outline-2 has-focus-visible:outline-focus ${tile ? 'p-2' : 'min-h-28 p-3'} ${dragging ? 'border-action bg-accent-soft' : error ? 'border-danger' : 'border-action'}`}
        >
          <CloudUpload aria-hidden="true" className="size-8 fill-accent-soft text-action" />
          <span className={`font-semibold text-link ${tile ? '' : 'text-sm'}`}>
            Click to upload
          </span>
          <span>or drag and drop{tile ? '' : ' files here'}</span>
          <span>(Upload as many as needed)</span>
          <span className="sr-only">{UPLOAD_LIMITS.typeNames}, up to 10 MB each</span>
          <input
            id={`${id}-file`}
            type="file"
            multiple
            accept={ACCEPT}
            aria-labelledby={`${id}-label`}
            disabled={files.length >= field.maxFiles}
            className="sr-only"
            onChange={(event) => {
              void send(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
        </label>
        {field.examples && field.examples.length > 0 && (
          <div className="flex gap-3 rounded-control bg-folder-surface p-3 text-xs">
            <FileText aria-hidden="true" className="size-8 shrink-0 text-action" />
            <div className="min-w-0 flex-1">
              <p className="mb-1 font-semibold text-heading">Examples of {fill(field.label)}:</p>
              <ul className="list-outside list-disc gap-x-6 pl-4 sm:columns-2 [&>li]:break-inside-avoid">
                {field.examples.map((example) => (
                  <li key={example}>{fill(example)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
      {(files.length > 0 || busy > 0) && (
        <ul className="space-y-1" aria-live="polite">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-2 rounded-control border border-folder-border px-2 py-1 text-xs"
            >
              <FileText aria-hidden="true" className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
              <span className={file.status === 'BLOCKED' ? 'text-danger' : 'text-muted'}>
                {STATUS_TEXT[file.status]}
              </span>
              <Button
                variant="ghost"
                aria-label={`Remove ${file.fileName}`}
                onClick={() => {
                  setFailure('');
                  actions
                    .remove(file.id)
                    .catch((e: unknown) => setFailure(errorMessage(e, BEGIN_ONLINE_ERRORS)));
                }}
                className="min-h-7! px-1! py-1!"
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </li>
          ))}
          {busy > 0 && (
            <li className="flex items-center gap-2 text-xs text-muted">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              Uploading…
            </li>
          )}
        </ul>
      )}
      {failure && (
        <p role="alert" className="text-xs text-danger">
          {failure}
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      {field.notAvailable && (
        <div className="space-y-1">
          <Checkbox
            label="I don't have this document"
            className="gap-2! text-xs! sm:min-h-6!"
            checked={value.notAvailable}
            onChange={(event) =>
              onChange({ notAvailable: event.target.checked, reason: value.reason })
            }
          />
          {value.notAvailable && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-reason`} className="text-xs text-firm-primary">
                Please explain why you don&apos;t have this document *
              </label>
              <textarea
                id={`${id}-reason`}
                rows={2}
                maxLength={1000}
                aria-invalid={reasonError ? true : undefined}
                value={value.reason}
                onChange={(event) => onChange({ notAvailable: true, reason: event.target.value })}
                className={`rounded-control border bg-surface px-2 py-1 text-xs ${reasonError ? 'border-danger' : 'border-border'}`}
              />
              {reasonError && <p className="text-xs text-danger">{reasonError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
