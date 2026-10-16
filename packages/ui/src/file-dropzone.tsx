'use client';

import { Image as ImageIcon, UploadSimple, type Icon } from '@phosphor-icons/react';
import { useId, useState, type DragEvent } from 'react';

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export interface FileRejection<F extends FileLike = File> {
  file: F;
  reason: 'type' | 'size' | 'count';
}

/**
 * Splits picked files into accepted and rejected. `accept` holds extensions (`.pdf`) or MIME
 * types (`image/png`, `image/*`), as an input's accept attribute does.
 */
export function checkFiles<F extends FileLike>(
  files: F[],
  rules: { accept?: string[]; maxBytes?: number; maxFiles?: number },
): { accepted: F[]; rejected: FileRejection<F>[] } {
  const accepted: F[] = [];
  const rejected: FileRejection<F>[] = [];
  const allowed = (file: F) =>
    !rules.accept?.length ||
    rules.accept.some((rule) => {
      const r = rule.toLowerCase();
      if (r.startsWith('.')) return file.name.toLowerCase().endsWith(r);
      if (r.endsWith('/*')) return file.type.toLowerCase().startsWith(r.slice(0, -1));
      return file.type.toLowerCase() === r;
    });
  for (const file of files) {
    if (!allowed(file)) rejected.push({ file, reason: 'type' });
    else if (rules.maxBytes !== undefined && file.size > rules.maxBytes)
      rejected.push({ file, reason: 'size' });
    else if (rules.maxFiles !== undefined && accepted.length >= rules.maxFiles)
      rejected.push({ file, reason: 'count' });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

export interface FileDropzoneProps {
  /** The accessible name of the file picker ("Staff documents"). */
  label: string;
  onFiles: (files: File[]) => void;
  onReject?: (rejections: FileRejection[]) => void;
  accept?: string[];
  maxBytes?: number;
  multiple?: boolean;
  maxFiles?: number;
  /** `upload` (staff documents) or `image` (login background); or any Phosphor icon. */
  icon?: 'upload' | 'image' | Icon;
  /** First line; "click" in it is drawn as a link. */
  title?: string;
  /** Smaller lines under it: "Accepted formats: PDF, JPG", "Max size: 10MB per file". */
  hints?: string[];
  disabled?: boolean;
}

/** A dashed drop area that also opens the file picker on click or Enter. */
export function FileDropzone({
  label,
  onFiles,
  onReject,
  accept,
  maxBytes,
  multiple = true,
  maxFiles,
  icon = 'upload',
  title = 'Drag & drop files here or click to upload',
  hints = [],
  disabled,
}: FileDropzoneProps) {
  const id = useId();
  const [over, setOver] = useState(false);
  const Glyph = icon === 'upload' ? UploadSimple : icon === 'image' ? ImageIcon : icon;
  const take = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    const { accepted, rejected } = checkFiles(files, {
      accept,
      maxBytes,
      maxFiles: multiple ? maxFiles : 1,
    });
    if (accepted.length) onFiles(accepted);
    if (rejected.length) onReject?.(rejected);
  };
  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    if (!disabled) take(event.dataTransfer.files);
  };
  const [before, after] = title.split(/click/i);
  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors focus-within:outline-2 focus-within:outline-focus ${over ? 'border-action bg-info-soft' : 'border-folder-border bg-subtle'} ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-info-soft'}`}
    >
      <Glyph aria-hidden weight="bold" className="size-9 text-heading" />
      <span className="text-sm font-semibold text-heading">
        {after === undefined ? (
          title
        ) : (
          <>
            {before}
            <span className="text-link">click</span>
            {after}
          </>
        )}
      </span>
      {hints.length ? (
        <span className="flex flex-col text-xs text-muted">
          {hints.map((hint) => (
            <span key={hint}>{hint}</span>
          ))}
        </span>
      ) : null}
      <input
        id={id}
        type="file"
        aria-label={label}
        multiple={multiple}
        accept={accept?.join(',')}
        disabled={disabled}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
        className="sr-only"
      />
    </label>
  );
}
