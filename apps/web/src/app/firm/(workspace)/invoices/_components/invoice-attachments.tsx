'use client';

import { INVOICE_LIMITS } from '@firmivra/types';
import { Checkbox, FileDropzone, Select } from '@firmivra/ui';
import { useState } from 'react';
import { fileSize } from '../../../../../components/message-files';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { uploadFile } from '../../../../../lib/upload';

// IP-F03: the invoice's files, from the client's documents the client can see (shared or their
// own uploads; never internal). A file goes once its virus check has passed. A new file is
// uploaded into the client's Documents, shared with the client, under one of their services.

const MB = 1024 * 1024;
const ACCEPT = ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx'];

export function InvoiceAttachments({
  clientId,
  services,
  engagementId,
  value,
  onChange,
}: {
  clientId: string;
  /** The client's services, to upload a new file under. */
  services: readonly { id: string; title: string }[];
  /** The invoice's own service, the default place for an upload. */
  engagementId: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const documents = useApiQuery(['invoices', 'attachable', clientId], () =>
    clientId ? api.documents.list(clientId, { limit: 100 }) : Promise.resolve(null),
  );
  const [uploadUnder, setUploadUnder] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const under = uploadUnder || engagementId || services[0]?.id || '';
  const shareable = (documents.data?.items ?? []).filter(
    (d) => d.direction !== 'INTERNAL' && d.scanStatus !== 'INFECTED' && d.scanStatus !== 'FAILED',
  );
  const full = value.length >= INVOICE_LIMITS.maxAttachments;
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...value, id] : value.filter((x) => x !== id));

  const upload = async (files: File[]) => {
    if (!under) return;
    setBusy(true);
    setProblem('');
    try {
      for (const file of files) {
        await uploadFile(file, {
          start: (facts) =>
            api.documents.createUpload(clientId, {
              serviceId: under,
              shareWithClient: true,
              ...facts,
            }),
          finish: (uploadToken) => api.documents.confirmUpload({ uploadToken }),
          maxBytes: 10 * MB,
        });
      }
      await documents.refetch();
    } catch (e) {
      setProblem(errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="invoice-attachments">
      <p className="text-sm font-medium text-text">Attachments</p>
      {!clientId ? (
        <p className="text-sm text-muted">
          Files come from the client&apos;s documents: pick the client first.
        </p>
      ) : documents.isPending ? (
        <p className="text-sm text-muted">Loading the client&apos;s files…</p>
      ) : shareable.length === 0 ? (
        <p className="text-sm text-muted">
          No files shared with this client yet. Upload one below.
        </p>
      ) : (
        <ul className="flex max-h-48 flex-col overflow-y-auto rounded-lg border border-divider px-3">
          {shareable.map((d) => {
            const checking = d.scanStatus !== 'CLEAN';
            const on = value.includes(d.id);
            return (
              <li key={d.id} className="flex items-center justify-between gap-3">
                <Checkbox
                  label={d.fileName}
                  checked={on}
                  disabled={checking || (full && !on)}
                  onChange={(e) => toggle(d.id, e.target.checked)}
                  className="min-w-0 text-sm"
                />
                <span className="shrink-0 text-xs text-muted">
                  {checking ? 'Checking for viruses' : fileSize(d.sizeBytes)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {clientId && services.length > 1 && !engagementId ? (
        <Select
          label="Upload under"
          value={under}
          onChange={(e) => setUploadUnder(e.target.value)}
          options={services.map((s) => ({ value: s.id, label: s.title }))}
        />
      ) : null}
      {clientId && services.length === 0 ? (
        <p className="text-xs text-muted">
          This client has no service to file an upload under; attach a shared file instead.
        </p>
      ) : (
        <FileDropzone
          label="Upload a file to attach"
          title="Drag and drop files here, or click to browse"
          hints={['PDF, PNG, JPG, DOC (Max 10MB each)', 'Shared with the client in Documents']}
          accept={ACCEPT}
          maxBytes={10 * MB}
          disabled={!clientId || busy || !under}
          onFiles={(files) => void upload(files)}
          onReject={() => setProblem('Use a PDF, PNG, JPG or DOC file of 10 MB or less.')}
        />
      )}
      {busy ? <p className="text-xs text-muted">Uploading…</p> : null}
      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}
      {full ? (
        <p className="text-xs text-muted">
          {INVOICE_LIMITS.maxAttachments} files is the most one invoice takes.
        </p>
      ) : null}
    </div>
  );
}
