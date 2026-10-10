'use client';

import { DOCUMENT_ERRORS, type MyDocument, PORTAL_BLOCKED_TEXT } from '@firmivra/types';
import { Badge, Button, type Column, Input, Table } from '@firmivra/ui';
import { Download } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** "Your Business Documents": the files the firm shared (source FIRM), with search. */
export function BusinessDocuments({ slug }: { slug: string }) {
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const list = useApiQuery(['my-documents', slug, 'FIRM', term], () =>
    api.myDocuments(slug).list({ source: 'FIRM', search: term || undefined, limit: 100 }),
  );
  const download = useApiMutation(async (id: string) => {
    const link = await api.myDocuments(slug).download(id);
    window.location.assign(link.url);
  });
  const columns: Column<MyDocument>[] = [
    {
      id: 'name',
      label: 'Name',
      sortable: true,
      sortValue: (d) => d.fileName.toLowerCase(),
      cell: (d) => <span className="font-medium break-all text-heading">{d.fileName}</span>,
    },
    { id: 'type', label: 'Type', cell: (d) => d.category?.name ?? 'Uncategorized' },
    { id: 'service', label: 'Service', cell: (d) => d.service.title },
    {
      id: 'date',
      label: 'Date Shared',
      sortable: true,
      sortValue: (d) => d.uploadedAt,
      cell: (d) => day.format(new Date(d.uploadedAt)),
    },
    { id: 'size', label: 'Size', cell: (d) => size(d.sizeBytes) },
    {
      id: 'actions',
      label: 'Actions',
      cell: (d) =>
        d.status === 'READY' ? (
          <Button
            variant="ghost"
            className="underline"
            disabled={download.isPending}
            onClick={() => download.mutate(d.id)}
            aria-label={`Download ${d.fileName}`}
          >
            <Download aria-hidden className="size-4" /> Download
          </Button>
        ) : d.status === 'CHECKING' ? (
          <Badge tone="info">Checking…</Badge>
        ) : (
          <span className="text-sm text-danger">{PORTAL_BLOCKED_TEXT.FIRM}</span>
        ),
    },
  ];
  return (
    <section aria-labelledby="business-documents" className="grid min-w-0 grid-cols-1 gap-3">
      <h2 id="business-documents" className="font-display text-2xl font-bold text-heading">
        Your Business Documents
      </h2>
      <Input
        label="Search"
        type="search"
        placeholder="Search documents…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {download.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(download.error, DOCUMENT_ERRORS)}
        </p>
      ) : null}
      <PageState query={list}>
        {(data) => (
          <Table
            caption="Your business documents"
            rows={data.items}
            columns={columns}
            rowKey={(d) => d.id}
            pageSize={5}
            emptyTitle="No shared documents yet"
            emptyText="Documents your firm shares with you will appear here."
          />
        )}
      </PageState>
    </section>
  );
}
