'use client';

import {
  DOCUMENT_ERRORS,
  ESIGN_ERRORS,
  ESIGN_UPLOAD_TYPES,
  EsignContentType,
  type EsignDocument,
  type EsignRequestDetail,
} from '@firmivra/types';
import { Button, Card, Select } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../../lib/query';
import { uploadFile } from '../../../../../../../../lib/upload';
import { stepHref } from './steps';

const ERRORS = { ...DOCUMENT_ERRORS, ...ESIGN_ERRORS };
const ACCEPT = Object.entries(ESIGN_UPLOAD_TYPES)
  .flatMap(([type, ext]) => [type, ...ext])
  .join(',');

const SCAN: Record<EsignDocument['scanStatus'], [string, string]> = {
  PENDING: ['Checking for viruses…', 'text-muted'],
  CLEAN: ['Ready', 'text-success'],
  INFECTED: ['Blocked: remove it and upload another copy', 'text-danger'],
  FAILED: ['Could not be checked: remove it and upload it again', 'text-danger'],
};

/** Step 1: the files to sign, uploaded or copied from the client's documents. */
export function DocumentsStep({ r }: { r: EsignRequestDetail }) {
  const key = ['esign', 'requests', r.id];
  const remove = useApiMutation((docId: string) => api.esign.removeDocument(r.id, docId), {
    invalidate: key,
  });
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-2xl text-heading">Documents</h2>
        <p className="text-sm text-muted">
          PDF, JPG or PNG, up to 10 MB each and 100 pages in all. Files are checked for viruses
          before they can be sent.
        </p>
        <Upload r={r} />
        {r.client && <FromClient r={r} clientId={r.client.id} />}
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold text-heading">Files in this request</h2>
        {r.documents.length === 0 ? (
          <p className="text-sm text-muted">No files yet.</p>
        ) : (
          <ul data-testid="request-files" className="flex flex-col divide-y divide-border">
            {r.documents.map((d) => {
              const [label, tone] = SCAN[d.scanStatus];
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <FileText aria-hidden className="size-5 shrink-0 text-danger" />
                  <span className="min-w-0 flex-1 break-words text-text">
                    {d.fileName}
                    <span className="block text-sm text-muted">
                      {d.pageCount} {d.pageCount === 1 ? 'page' : 'pages'}
                    </span>
                  </span>
                  <span className={`text-sm ${tone}`}>{label}</span>
                  <Button
                    variant="ghost"
                    aria-label={`Remove ${d.fileName}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(d.id)}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {remove.error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {errorMessage(remove.error, ERRORS)}
          </p>
        )}
      </Card>
      <div className="flex flex-wrap gap-3">
        {r.documents.length > 0 ? (
          <Link
            href={stepHref(r.id, 'recipients')}
            className="inline-flex min-h-11 items-center justify-center rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Next: Recipients
          </Link>
        ) : (
          <p className="text-sm text-muted">Add a file to continue.</p>
        )}
      </div>
    </div>
  );
}

/** Uploads each chosen file in turn; its pages join the end of the packet. */
function Upload({ r }: { r: EsignRequestDetail }) {
  const inputId = useId();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  async function send(files: File[]) {
    const failed: string[] = [];
    for (const file of files) {
      setBusy(`Uploading ${file.name}…`);
      try {
        await uploadFile(file, {
          start: (facts) => api.esign.createUpload(r.id, facts),
          finish: (uploadToken) => api.esign.confirmUpload(r.id, { uploadToken }),
          onProgress: (p) => setBusy(`Uploading ${file.name}: ${p}%`),
        });
      } catch (error) {
        failed.push(`${file.name}: ${errorMessage(error, ERRORS)}`);
      }
    }
    setBusy(null);
    setFailures(failed);
    await queryClient.invalidateQueries({ queryKey: ['esign', 'requests', r.id] });
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        className={`inline-flex min-h-11 cursor-pointer items-center justify-center self-start rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        Upload files
        <input
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          disabled={!!busy}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) void send(files);
          }}
        />
      </label>
      {busy && (
        <p role="status" className="text-sm text-muted">
          {busy}
        </p>
      )}
      {failures.map((f) => (
        <p key={f} role="alert" className="text-sm text-danger">
          {f}
        </p>
      ))}
    </div>
  );
}

/** One of the client's own files (PDF, JPG or PNG that passed its virus check). */
function FromClient({ r, clientId }: { r: EsignRequestDetail; clientId: string }) {
  const [picked, setPicked] = useState('');
  const docs = useApiQuery(['documents', clientId, 'esign-pick'], () =>
    api.documents.list(clientId, { limit: 100 }),
  );
  const usable = (docs.data?.items ?? []).filter(
    (d) =>
      d.scanStatus === 'CLEAN' &&
      EsignContentType.safeParse(d.contentType).success &&
      !r.documents.some((x) => x.sourceDocumentId === d.id),
  );
  const add = useApiMutation((documentId: string) => api.esign.addFromVault(r.id, { documentId }), {
    invalidate: ['esign', 'requests', r.id],
  });
  if (usable.length === 0) return null;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (picked) add.mutate(picked, { onSuccess: () => setPicked('') });
      }}
    >
      <div className="min-w-0 flex-1">
        <Select
          label={`Or pick from ${r.client?.displayName ?? 'the client'}'s documents`}
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          options={[
            { value: '', label: 'Choose a file' },
            ...usable.map((d) => ({ value: d.id, label: d.fileName })),
          ]}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={!picked || add.isPending}>
        Add file
      </Button>
      {add.error && (
        <p role="alert" className="w-full text-sm text-danger">
          {errorMessage(add.error, ERRORS)}
        </p>
      )}
    </form>
  );
}
