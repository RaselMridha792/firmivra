'use client';

import {
  DOCUMENT_ERRORS,
  ESIGN_ERRORS,
  ESIGN_MAX_PAGES,
  ESIGN_UPLOAD_TYPES,
  EsignContentType,
  type EsignDocument,
  type EsignRequestDetail,
  UPLOAD_LIMITS,
} from '@firmivra/types';
import { Button, Card, Input, Select } from '@firmivra/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../../lib/query';
import { uploadFile } from '../../../../../../../../lib/upload';
import { closeThumbFile } from '../../../../../../../../components/esign/page-thumb';
import { PagePlan } from './page-plan';
import { NextStepLink } from './next-step-link';
import { requestKey } from './steps';

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
  const queryClient = useQueryClient();
  const remove = useApiMutation((docId: string) => api.esign.removeDocument(r.id, docId));
  const ready = r.documents.length > 0 && r.documents.every((d) => d.scanStatus === 'CLEAN');
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-2xl text-heading">Documents</h2>
        <p className="text-sm text-muted">
          PDF, JPG or PNG, up to {UPLOAD_LIMITS.maxBytes / 1024 / 1024} MB each and{' '}
          {ESIGN_MAX_PAGES} pages in all. Files are checked for viruses before they can be sent.
        </p>
        <Upload r={r} />
        {r.client && <FromClient r={r} client={r.client} />}
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
                    onClick={() =>
                      remove.mutate(d.id, {
                        onSuccess: (next) => {
                          queryClient.setQueryData(requestKey(r.id), next);
                          closeThumbFile(api.esign.documentContentUrl(r.id, d.id));
                        },
                      })
                    }
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
      <PagePlan r={r} locked={remove.isPending} />
      <div className="flex flex-wrap gap-3">
        {ready ? (
          <NextStepLink id={r.id} step="recipients" label="Next: Recipients" />
        ) : (
          <p className="text-sm text-muted">
            {r.documents.length === 0
              ? 'Add a file to continue.'
              : 'Wait until every file is ready, or remove the ones that are blocked.'}
          </p>
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
  const [failures, setFailures] = useState<{ key: string; text: string }[]>([]);

  async function send(files: File[]) {
    setFailures([]);
    for (const [i, file] of files.entries()) {
      setBusy(`Uploading ${file.name}…`);
      try {
        await uploadFile(file, {
          start: (facts) => api.esign.createUpload(r.id, facts),
          finish: (uploadToken) => api.esign.confirmUpload(r.id, { uploadToken }),
          onProgress: (p) => setBusy(`Uploading ${file.name}: ${p}%`),
        });
        // Each file shows (and starts its virus check) as soon as it is in.
        void queryClient.invalidateQueries({ queryKey: requestKey(r.id) });
      } catch (error) {
        const text = `${file.name}: ${errorMessage(error, ERRORS)}`;
        setFailures((f) => [...f, { key: `${Date.now()}-${i}`, text }]);
      }
    }
    setBusy(null);
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
        <p key={f.key} role="alert" className="text-sm text-danger">
          {f.text}
        </p>
      ))}
    </div>
  );
}

/** One of the client's own files (PDF, JPG or PNG that passed its virus check), found by name. */
function FromClient({
  r,
  client,
}: {
  r: EsignRequestDetail;
  client: NonNullable<EsignRequestDetail['client']>;
}) {
  const [picked, setPicked] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);
  const docs = useQuery({
    queryKey: ['documents', client.id, 'esign-pick', search],
    queryFn: () => api.documents.list(client.id, { limit: 100, ...(search && { search }) }),
    placeholderData: keepPreviousData,
  });
  const usable = (docs.data?.items ?? []).filter(
    (d) =>
      d.scanStatus === 'CLEAN' &&
      EsignContentType.safeParse(d.contentType).success &&
      !r.documents.some((x) => x.sourceDocumentId === d.id),
  );
  const add = useApiMutation((documentId: string) => api.esign.addFromVault(r.id, { documentId }), {
    invalidate: requestKey(r.id),
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (picked) add.mutate(picked, { onSuccess: () => setPicked('') });
      }}
    >
      <h3 className="font-semibold text-heading">
        Or add one of {client.displayName}&apos;s files
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="Find a file"
          type="search"
          maxLength={100}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="File"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          options={[
            {
              value: '',
              label: docs.isPending
                ? 'Loading…'
                : usable.length
                  ? 'Choose a file'
                  : 'No PDF, JPG or PNG files found',
            },
            ...usable.map((d) => ({ value: d.id, label: d.fileName })),
          ]}
        />
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={!picked || add.isPending}>
          Add file
        </Button>
      </div>
      {(docs.isError || add.error) && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(add.error ?? docs.error, ERRORS)}
        </p>
      )}
    </form>
  );
}
