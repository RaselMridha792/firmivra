'use client';

import type { FirmDocument } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useState } from 'react';
import { OriginLink } from '../../../../../components/origin-link';
import { api } from '../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { DocumentViewer } from '../../documents/[id]/_components/document-viewer';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const size = (bytes: number) =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const SCAN: Record<FirmDocument['scanStatus'], string> = {
  PENDING: 'Being checked for viruses',
  CLEAN: 'Passed the virus check',
  INFECTED: 'Blocked: failed the virus check',
  FAILED: 'Could not be checked',
};
const source = (d: FirmDocument) =>
  d.uploadedBy?.byClient
    ? 'Uploaded by the client'
    : d.uploadedBy
      ? `Uploaded by ${d.uploadedBy.name}`
      : d.direction === 'CLIENT_TO_FIRM'
        ? 'From the client'
        : 'Uploaded by the firm';

/**
 * Review 2 (N03): the Overview's newest documents for this bookkeeping service, each with View in
 * place: what the file is, where it came from and whether it can be opened, with Download and the
 * document's own page, without leaving Bookkeeping.
 */
export function RecentDocuments({
  clientId,
  engagementId,
}: {
  clientId: string;
  engagementId: string;
}) {
  const [open, setOpen] = useState<FirmDocument>();
  const recent = useApiQuery(['bookkeeping', 'recent-documents', clientId, engagementId], () =>
    api.documents.list(clientId, { serviceId: engagementId, limit: 3 }),
  );
  const rows = recent.data?.items ?? [];
  if (recent.isPending) return <p className="mt-2 text-sm text-muted">Loading documents…</p>;
  if (recent.isError)
    return <p className="mt-2 text-sm text-muted">Recent documents could not be loaded.</p>;
  if (!rows.length) return null;
  return (
    <>
      <ul className="mt-2 flex flex-col" data-testid="recent-documents">
        {rows.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-heading">{d.fileName}</span>
              <span className="block text-xs text-muted">{day(d.createdAt)}</span>
            </span>
            <button
              type="button"
              className="shrink-0 text-sm font-medium text-link hover:underline"
              aria-label={`View ${d.fileName}`}
              onClick={() => setOpen(d)}
            >
              View
            </button>
          </li>
        ))}
      </ul>
      {open ? <QuickView doc={open} onClose={() => setOpen(undefined)} /> : null}
    </>
  );
}

/**
 * Review 2 (N03): the file itself, in place. It reuses Documents' own viewer (an image as it is, a
 * PDF drawn page by page), which reads the file through the library's clean-file link; other types
 * and unchecked files say why there is no preview. Nothing here leaves Bookkeeping.
 */
function Preview({ doc, onDownload }: { doc: FirmDocument; onDownload: () => void }) {
  const lib = useApiQuery(['library-document', doc.id], () => api.documentLibrary.get(doc.id));
  if (lib.isPending) return <p className="text-sm text-muted">Loading the preview…</p>;
  if (lib.isError || !lib.data)
    return (
      <p className="text-sm text-muted">
        The preview could not be loaded. Download the file instead.
      </p>
    );
  return (
    <div className="h-[60vh] min-h-0" data-testid="document-preview">
      <DocumentViewer doc={lib.data} onDownload={onDownload} />
    </div>
  );
}

function QuickView({ doc, onClose }: { doc: FirmDocument; onClose: () => void }) {
  const download = useApiMutation(async () => {
    const link = await api.documents.download(doc.id);
    window.location.assign(link.url);
  });
  const rows: [string, string][] = [
    ['Service', doc.service.title],
    ['Category', doc.category?.name ?? 'None'],
    ['Source', source(doc)],
    ['Added', day(doc.createdAt)],
    ['Size', size(doc.sizeBytes)],
    ['Visibility', doc.direction === 'INTERNAL' ? 'Staff only' : 'Shared with the client'],
    ['Check', SCAN[doc.scanStatus]],
  ];
  return (
    <Modal
      open
      title={doc.fileName}
      subtitle="Document"
      onClose={onClose}
      footer={
        <>
          <OriginLink
            href={`/documents/${doc.id}`}
            className="inline-flex min-h-11 items-center rounded-control border border-border px-4 text-sm font-medium text-heading"
          >
            Open Details
          </OriginLink>
          <Button
            disabled={doc.scanStatus !== 'CLEAN' || download.isPending}
            onClick={() => download.mutate()}
          >
            Download
          </Button>
        </>
      }
    >
      <Preview doc={doc} onDownload={() => download.mutate()} />
      <dl
        className="mt-3 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm"
        data-testid="document-quick-view"
      >
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold text-heading">{k}</dt>
            <dd className="text-text">{v}</dd>
          </div>
        ))}
      </dl>
      {doc.scanStatus !== 'CLEAN' ? (
        <p className="mt-3 text-sm text-muted">
          Download is available once the file passes its virus check.
        </p>
      ) : null}
      {download.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          The file could not be downloaded. Try again in a moment.
        </p>
      ) : null}
    </Modal>
  );
}
