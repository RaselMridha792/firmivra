'use client';

import { Button, Checkbox } from '@firmivra/ui';
import { CloudUpload, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';

export interface UploadValue {
  files: { id: string; file: File; selectedAt: string }[];
  unavailable: boolean;
  reason: string;
}
export function UploadTile({
  label,
  description,
  value,
  onChange,
  required = false,
  error,
  reasonError,
  compact = false,
}: {
  label: string;
  description?: string;
  value: UploadValue;
  onChange: (value: UploadValue) => void;
  required?: boolean;
  error?: string;
  reasonError?: string;
  compact?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  function select(files: File[]) {
    const accepted = files.filter(
      (file) =>
        file.size > 0 &&
        file.size <= 10 * 1024 * 1024 &&
        /\.(pdf|jpe?g|png)$/i.test(file.name) &&
        (!file.type || ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)),
    );
    setFileError(
      accepted.length === files.length
        ? ''
        : 'Use non-empty PDF, JPG or PNG files, up to 10 MB each.',
    );
    if (accepted.length) {
      const fresh = accepted.filter(
        (file) =>
          !value.files.some(
            (item) =>
              item.file.name === file.name &&
              item.file.size === file.size &&
              item.file.lastModified === file.lastModified,
          ),
      );
      onChange({
        unavailable: false,
        reason: '',
        files: [
          ...value.files,
          ...fresh.map((file) => ({
            id: crypto.randomUUID(),
            file,
            selectedAt: new Date().toISOString().slice(0, 10),
          })),
        ],
      });
    }
  }
  return (
    <div
      className={`min-w-0 ${compact ? 'row-span-5 grid grid-rows-subgrid gap-1' : 'space-y-1'}`}
      data-testid={`upload-${label}`}
    >
      {compact && (
        <div className="min-h-9">
          <p className="text-xs font-semibold text-firm-primary">
            {label}
            {required && <span className="text-danger"> *</span>}
          </p>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
      )}
      <input
        ref={inputRef}
        id={`${id}-file`}
        aria-label={`${label} files`}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        multiple
        className="sr-only"
        disabled={value.unavailable}
        onChange={(event) => {
          select(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={value.unavailable}
        aria-label={`Select ${label}`}
        aria-invalid={!!(error || fileError)}
        aria-describedby={`${id}-status`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!value.unavailable) select(Array.from(event.dataTransfer.files));
        }}
        className={`flex w-full flex-col items-center justify-center rounded-control border border-dashed border-action px-2 py-3 text-center text-xs text-firm-primary disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'min-h-24' : 'min-h-28'} ${dragging ? 'bg-folder-surface' : 'bg-surface'}`}
      >
        <CloudUpload aria-hidden="true" className="mb-1 size-8 text-action" />
        <span className="font-semibold">
          {compact ? 'Click to upload' : `Click to upload ${label.toLowerCase()}`}
        </span>
        <span>or drag and drop files here</span>
        <span>(Upload as many as needed)</span>
      </button>
      <div id={`${id}-status`} aria-live="polite">
        {(fileError || error) && <p className="text-xs text-danger">{fileError || error}</p>}
        {value.files.length > 0 && (
          <ul className="space-y-1">
            {value.files.map(({ id: fileId, file }) => (
              <li
                key={fileId}
                className="flex min-w-0 items-center gap-1 rounded-control bg-folder-surface px-2 text-xs"
              >
                <span className="min-w-0 flex-1 break-all">{file.name}</span>
                <Button
                  variant="ghost"
                  aria-label={`Remove file ${file.name}`}
                  onClick={() =>
                    onChange({ ...value, files: value.files.filter((item) => item.id !== fileId) })
                  }
                  className="min-h-7! p-1!"
                >
                  <X aria-hidden="true" className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Checkbox
        label="I don't have this document"
        checked={value.unavailable}
        onChange={(event) => {
          setFileError('');
          onChange({
            files: [],
            unavailable: event.target.checked,
            reason: event.target.checked ? value.reason : '',
          });
        }}
        className="gap-1! text-xs! sm:min-h-6!"
      />
      {(compact || value.unavailable) && (
        <div>
          <label htmlFor={`${id}-reason`} className="sr-only">
            Reason for unavailable {label}
          </label>
          <textarea
            id={`${id}-reason`}
            value={value.reason}
            disabled={!value.unavailable}
            onChange={(event) => onChange({ ...value, reason: event.target.value })}
            placeholder="Please explain why..."
            maxLength={1000}
            rows={2}
            aria-invalid={!!reasonError}
            aria-describedby={reasonError ? `${id}-reason-error` : undefined}
            className="w-full rounded-control border border-border bg-surface p-2 text-xs text-text disabled:bg-subtle"
          />
          {reasonError && (
            <p id={`${id}-reason-error`} className="text-xs text-danger">
              {reasonError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
