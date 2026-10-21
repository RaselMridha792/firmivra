'use client';

import {
  DOCUMENT_ERRORS,
  UPLOAD_LIMITS,
  uploadBatchProblem,
  uploadContentTypeFor,
} from '@firmivra/types';
import { CloudArrowUp, X } from '@phosphor-icons/react';
import { useId, useState, type DragEvent } from 'react';
import { FileIcon } from '../../_components/file-icon';
import { sizeText, type QueuedFile } from './upload-state';

const ACCEPT = Object.entries(UPLOAD_LIMITS.types)
  .flatMap(([type, endings]) => [type, ...endings])
  .join(',');

/**
 * Frame 1's Select Files to Upload: drag and drop or Choose Files, the queue with each file's type,
 * name and size, Remove and Clear All. Type and size are checked here and again by the API.
 */
export function FilePicker({
  files,
  onAdd,
  onRemove,
  onClear,
  disabled,
}: {
  files: QueuedFile[];
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const maxMb = UPLOAD_LIMITS.maxBytes / (1024 * 1024);

  function take(list: FileList | null) {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    const all = [...files.map((f) => f.file), ...picked];
    const batch = uploadBatchProblem(all);
    if (batch) {
      setProblem(DOCUMENT_ERRORS[batch]);
      return;
    }
    const refused = picked.filter(
      (f) => !uploadContentTypeFor(f.name, f.type) || f.size > UPLOAD_LIMITS.maxBytes || !f.size,
    );
    setProblem(
      refused.length
        ? `${refused.map((f) => f.name).join(', ')}: use ${UPLOAD_LIMITS.typeNames} up to ${maxMb} MB.`
        : null,
    );
    const accepted = picked.filter((f) => !refused.includes(f));
    if (accepted.length) onAdd(accepted);
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    if (!disabled) take(event.dataTransfer.files);
  }

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-5"
    >
      <div>
        <h2 id={`${inputId}-title`} className="font-display text-xl font-bold text-heading">
          Select Files to Upload
        </h2>
        <p className="text-sm text-text">Drag and drop files here, or click to browse.</p>
      </div>
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        data-testid="upload-dropzone"
        className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center ${over ? 'border-action bg-info-soft' : 'border-action/60 bg-folder-surface'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
      >
        <CloudArrowUp aria-hidden weight="regular" className="size-14 text-action" />
        <span className="text-lg font-semibold text-heading">Drag &amp; drop files here</span>
        <span className="text-sm text-text">or</span>
        <span className="inline-flex min-h-11 items-center rounded-control bg-action px-6 py-2 text-sm font-semibold text-on-action">
          Choose Files
        </span>
        <span className="mt-2 text-sm text-text">
          Supports {UPLOAD_LIMITS.typeNames}
          <br />
          (Max {maxMb} MB per file)
        </span>
        <input
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            take(event.target.files);
            event.target.value = '';
          }}
        />
      </label>
      {problem ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {problem}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-heading">Selected Files ({files.length})</h3>
        {files.length ? (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="text-sm font-medium text-action underline hover:no-underline disabled:opacity-50"
          >
            Clear All
          </button>
        ) : null}
      </div>
      {files.length ? (
        <ul aria-label="Selected files" className="flex flex-col gap-3">
          {files.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-3"
            >
              <FileIcon contentType={uploadContentTypeFor(item.file.name, item.file.type) ?? ''} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-heading">{item.file.name}</span>
                <span className="block text-sm text-muted">{sizeText(item.file.size)}</span>
              </span>
              <button
                type="button"
                onClick={() => onRemove(item.key)}
                disabled={disabled}
                aria-label={`Remove ${item.file.name}`}
                className="rounded-control p-2 text-heading hover:bg-canvas disabled:opacity-50"
              >
                <X aria-hidden weight="bold" className="size-5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No files chosen yet.</p>
      )}
    </section>
  );
}
