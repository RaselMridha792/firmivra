'use client';

import { DOCUMENT_ERRORS, type MyDocument, PORTAL_BLOCKED_TEXT } from '@firmivra/types';
import { Badge, Button, Card, type Column, Input, Select, Table } from '@firmivra/ui';
import { Download, FileText, Info } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { usePortal } from '../../../../layout';

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

type Source = MyDocument['source'];
const SOURCES: { id: Source; label: string }[] = [
  { id: 'MINE', label: 'My Uploads' },
  { id: 'FIRM', label: 'Firm Documents' },
];

/**
 * "My Uploaded Documents" (docs/mockups/client-portal/My docs tab.png, N05). "View Firm Documents"
 * switches the source filter to the files the firm shared (`?source=firm`).
 */
export function DocumentsScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const router = useRouter();
  const { business } = usePortal();
  const source: Source = useSearchParams().get('source') === 'firm' ? 'FIRM' : 'MINE';
  const firm = source === 'FIRM';
  const [categoryId, setCategoryId] = useState('');
  const [year, setYear] = useState('');
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const query = { categoryId: categoryId || undefined, taxYear: year ? Number(year) : undefined };
  const categories = useApiQuery(['my-document-categories', slug], () =>
    api.myDocuments(slug).categories(),
  );
  const list = useApiQuery(['my-documents', slug, source, query, term], () =>
    api.myDocuments(slug).list({ ...query, source, search: term || undefined, limit: 100 }),
  );
  const choose = (next: Source) => {
    setYear('');
    router.replace(next === 'FIRM' ? `/${slug}/documents?source=firm` : `/${slug}/documents`);
  };
  return (
    <Card className="grid min-w-0 grid-cols-1 gap-4">
      <header className="flex flex-col gap-4 md:flex-row md:items-start">
        <FileText
          aria-hidden
          className="size-16 shrink-0 rounded-full bg-folder-surface p-4 text-firm-primary"
        />
        <div className="flex-1">
          <h1 className="font-display text-3xl font-bold text-heading">
            {firm ? 'Firm Uploaded Documents' : 'My Uploaded Documents'}
          </h1>
          <p className="text-text">
            {firm
              ? `View the documents ${business.name} has shared with you.`
              : `View and manage the documents you've uploaded to ${business.name}. Keep your files organized and accessible anytime.`}
          </p>
        </div>
      </header>
      <div role="group" aria-label="Show documents" className="flex flex-wrap gap-2">
        {SOURCES.map((s) => (
          <Button
            key={s.id}
            variant={source === s.id ? 'primary' : 'outline'}
            aria-pressed={source === s.id}
            onClick={() => choose(s.id)}
          >
            {s.label}
          </Button>
        ))}
      </div>
      <p className="flex gap-2 rounded-card bg-folder-surface p-3 text-sm text-text">
        <Info aria-hidden className="size-5 shrink-0 text-firm-primary" />
        Only upload additional documents if your taxes or business project is still being created or
        prepared by our team.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Select
          label="Category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          options={[
            { value: '', label: 'All Categories' },
            ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Select
          label="Year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          options={[
            { value: '', label: 'All Years' },
            ...(list.data?.years ?? []).map((y) => ({ value: String(y), label: String(y) })),
          ]}
        />
        <Input
          label="Search"
          type="search"
          placeholder="Search documents…"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <PageState query={list}>
        {(data) => <DocumentTable slug={slug} rows={data.items} firm={firm} />}
      </PageState>
    </Card>
  );
}

function DocumentTable({ slug, rows, firm }: { slug: string; rows: MyDocument[]; firm: boolean }) {
  const download = useApiMutation(async (id: string) => {
    const link = await api.myDocuments(slug).download(id);
    window.location.assign(link.url);
  });
  const columns: Column<MyDocument>[] = [
    {
      id: 'name',
      label: 'File Name',
      sortable: true,
      sortValue: (d) => d.fileName.toLowerCase(),
      cell: (d) => <span className="font-medium break-all text-heading">{d.fileName}</span>,
    },
    { id: 'category', label: 'Category', cell: (d) => d.category?.name ?? 'Uncategorized' },
    {
      id: 'date',
      label: 'Upload Date',
      sortable: true,
      sortValue: (d) => d.uploadedAt,
      cell: (d) => day.format(new Date(d.uploadedAt)),
    },
    { id: 'year', label: 'Year', cell: (d) => d.taxYear ?? 'N/A' },
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
          <span className="text-sm text-danger">{PORTAL_BLOCKED_TEXT[d.source]}</span>
        ),
    },
  ];
  return (
    <>
      {download.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(download.error, DOCUMENT_ERRORS)}
        </p>
      ) : null}
      <Table
        caption={firm ? 'Documents shared by the firm' : 'My uploaded documents'}
        rows={rows}
        columns={columns}
        rowKey={(d) => d.id}
        pageSize={10}
        emptyTitle="No documents yet"
        emptyText={
          firm
            ? 'No documents have been shared with you yet.'
            : 'Documents you upload will appear here.'
        }
      />
    </>
  );
}
