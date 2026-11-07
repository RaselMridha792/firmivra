'use client';

import { DOCUMENT_ERRORS, UPLOAD_LIMITS, type Engagement } from '@firmivra/types';
import { CheckCircle, CloudArrowUp, Warning } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { uploadFile } from '../../../../../lib/upload';
import { Label, Selectbox } from './compliance-shared';

interface Upload {
  key: string;
  name: string;
  state: 'UPLOADING' | 'DONE' | 'FAILED';
  error?: string;
}

/**
 * CD-F06 (Octavia, Oct 28): files attached here are uploaded through the Documents module (its
 * checks, scanning and secure storage), filed as the client's own documents under one of their
 * open services, and added to this deadline's documents. Nothing is kept twice: the deadline
 * links the client's document. The deadline saves the link with everything else.
 */
export function DeadlineAttachments({
  clientId,
  engagements,
  defaultServiceId,
  onAdded,
}: {
  clientId: string;
  engagements: Engagement[];
  defaultServiceId: string;
  onAdded: (doc: { id: string; label: string }) => void;
}) {
  const inputId = useId();
  const open = engagements.filter((e) => e.status === 'ACTIVE');
  const [chosen, setChosen] = useState('');
  const serviceId =
    (open.some((e) => e.id === chosen) && chosen) ||
    (open.some((e) => e.id === defaultServiceId) && defaultServiceId) ||
    open[0]?.id ||
    '';
  const [uploads, setUploads] = useState<Upload[]>([]);
  const patch = (key: string, next: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...next } : u)));

  const send = async (files: File[]) => {
    for (const file of files) {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      setUploads((list) => [
        ...list.filter((u) => u.key !== key),
        { key, name: file.name, state: 'UPLOADING' },
      ]);
      try {
        const doc = await uploadFile(file, {
          maxBytes: UPLOAD_LIMITS.maxBytes,
          start: (facts) => api.documents.createUpload(clientId, { serviceId, ...facts }),
          finish: (uploadToken) => api.documents.confirmUpload({ uploadToken }),
        });
        onAdded({ id: doc.id, label: doc.fileName });
        patch(key, { state: 'DONE' });
      } catch (e) {
        patch(key, { state: 'FAILED', error: errorMessage(e, DOCUMENT_ERRORS) });
      }
    }
  };

  if (!clientId) {
    return <p className="text-sm text-muted">Choose a client to attach files.</p>;
  }
  return (
    <div className="flex flex-col gap-3" data-testid="attachments">
      {open.length === 0 ? (
        <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning" role="status">
          This client has no open service to file documents under. Add a service to the client
          first, or add a document they already have under Related Items.
        </p>
      ) : (
        <>
          <Label text="File it under (the client's service)" htmlFor={`${inputId}-service`}>
            <Selectbox
              id={`${inputId}-service`}
              label="File it under"
              value={serviceId}
              onChange={setChosen}
              options={open.map((e) => ({ value: e.id, label: e.title }))}
            />
          </Label>
          <label
            htmlFor={inputId}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border bg-canvas p-5 text-center text-sm text-muted hover:border-action"
          >
            <CloudArrowUp aria-hidden weight="regular" className="size-8 text-action" />
            <span className="font-medium text-heading">Choose files to attach</span>
            <span>
              PDF, JPG, PNG, Excel (.xlsx) or Word (.docx), up to{' '}
              {Math.round(UPLOAD_LIMITS.maxBytes / 1_048_576)} MB each. They are saved to the
              client&apos;s documents and added to this deadline.
            </span>
          </label>
          <input
            id={inputId}
            type="file"
            multiple
            aria-label="Attach files"
            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx"
            className="sr-only"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void send(files);
            }}
          />
        </>
      )}
      {uploads.length ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid="attachment-uploads">
          {uploads.map((u) => (
            <li key={u.key} className="flex items-start gap-2">
              {u.state === 'DONE' ? (
                <CheckCircle aria-hidden weight="fill" className="mt-0.5 size-4 text-success" />
              ) : u.state === 'FAILED' ? (
                <Warning aria-hidden weight="fill" className="mt-0.5 size-4 text-danger" />
              ) : (
                <CloudArrowUp aria-hidden className="mt-0.5 size-4 text-muted" />
              )}
              <span className="min-w-0">
                <span className="font-medium text-heading">{u.name}</span>{' '}
                <span className={u.state === 'FAILED' ? 'text-danger' : 'text-muted'}>
                  {u.state === 'DONE'
                    ? 'Saved to the client’s documents; added below under Related Items.'
                    : u.state === 'FAILED'
                      ? u.error
                      : 'Uploading…'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
