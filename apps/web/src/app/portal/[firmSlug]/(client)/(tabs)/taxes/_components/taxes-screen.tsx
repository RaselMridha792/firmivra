'use client';

import { DOCUMENT_ERRORS, type MyTaxReturn, type MyTaxReturnsQuery } from '@firmivra/types';
import { Badge, Button, Card, type Column, Select, Table } from '@firmivra/ui';
import {
  BriefcaseBusiness,
  ChartColumn,
  Download,
  FileText,
  type LucideIcon,
  UserRound,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { TaxPaymentCard, TaxYearStatus } from './tax-cards';

const STATUS: Record<MyTaxReturn['status'], [string, 'info' | 'success' | 'warning' | 'danger']> = {
  IN_PROGRESS: ['In Progress', 'warning'],
  FILED: ['Filed', 'info'],
  ACCEPTED: ['Accepted', 'success'],
  REJECTED: ['Rejected', 'danger'],
  COMPLETED: ['Completed', 'success'],
};

type Kind = 'quarterly' | 'personal' | 'business';
const KINDS: [Kind, LucideIcon, string, string, MyTaxReturnsQuery][] = [
  [
    'quarterly',
    ChartColumn,
    'Quarterly Taxes',
    'Your quarterly estimated tax returns.',
    { kind: 'quarterly' },
  ],
  [
    'personal',
    UserRound,
    'Annual Personal Taxes',
    'Your individual tax returns.',
    { kind: 'annual', filingType: 'INDIVIDUAL' },
  ],
  [
    'business',
    BriefcaseBusiness,
    'Annual Business Taxes',
    'Your business tax returns.',
    { kind: 'annual', filingType: 'BUSINESS' },
  ],
];

const day = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/**
 * "Tax Returns" (docs/mockups/client-portal/Taxes tab.png, N06): the returns by year with the
 * three kind filters, each year's status from the firm, and the Tax Return Payment card. A
 * return's PDF downloads once it has passed its scan (`document` is set then).
 */
export function TaxesScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const [year, setYear] = useState('');
  const [kind, setKind] = useState<Kind | null>(null);
  const filter = KINDS.find(([k]) => k === kind)?.[4] ?? {};
  const query: MyTaxReturnsQuery = { ...filter, taxYear: year ? Number(year) : undefined };
  const all = useApiQuery(['my-tax-returns', slug, {}], () => api.myTaxReturns(slug).list());
  const list = useApiQuery(['my-tax-returns', slug, query], () =>
    api.myTaxReturns(slug).list(query),
  );
  const years = [...new Set((all.data ?? []).map((r) => r.taxYear))];
  const download = useApiMutation(async (id: string) => {
    const link = await api.myDocuments(slug).download(id);
    window.location.assign(link.url);
  });
  const columns: Column<MyTaxReturn>[] = [
    {
      id: 'year',
      label: 'Tax Year',
      cell: (r) => (r.quarter ? `${r.taxYear} Q${r.quarter}` : r.taxYear),
    },
    {
      id: 'type',
      label: 'Filing Type',
      cell: (r) =>
        `${r.filingType === 'BUSINESS' ? 'Business' : 'Individual'}${r.formType ? ` (${r.formType})` : ''}`,
    },
    {
      id: 'status',
      label: 'Status',
      cell: (r) => {
        const [label, tone] = STATUS[r.status];
        return <Badge tone={tone}>{label}</Badge>;
      },
    },
    {
      id: 'filed',
      label: 'Date Filed',
      cell: (r) => (r.filedOn ? day(r.filedOn) : 'Not filed yet'),
    },
    {
      id: 'actions',
      label: 'Actions',
      cell: (r) =>
        r.document ? (
          <Button
            variant="ghost"
            className="underline"
            disabled={download.isPending}
            onClick={() => r.document && download.mutate(r.document.id)}
            aria-label={`Download ${r.document.fileName}`}
          >
            <Download aria-hidden className="size-4" /> Download
          </Button>
        ) : (
          <span className="text-sm text-muted">No copy yet</span>
        ),
    },
  ];
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <Card className="grid min-w-0 grid-cols-1 gap-4">
        <header className="flex flex-col gap-4 md:flex-row md:items-start">
          <FileText
            aria-hidden
            className="size-16 shrink-0 rounded-full bg-folder-surface p-4 text-firm-primary"
          />
          <div className="flex-1">
            <h1 className="font-display text-3xl font-bold text-heading">Tax Returns</h1>
            <p className="text-text">
              View, download, and manage your past and current tax returns. Need a copy of a prior
              year return? Let us know, we&apos;re here to help.
            </p>
          </div>
        </header>
        <div className="flex flex-wrap items-end gap-4">
          <h2 className="flex-1 font-display text-2xl font-bold text-heading">Your Tax Returns</h2>
          <div className="w-full md:w-48">
            <Select
              label="Tax Year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              options={[
                { value: '', label: 'All Years' },
                ...years.map((y) => ({ value: String(y), label: String(y) })),
              ]}
            />
          </div>
        </div>
        {download.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(download.error, DOCUMENT_ERRORS)}
          </p>
        ) : null}
        <PageState query={list} isEmpty={() => false}>
          {(rows) => (
            <Table
              caption="Your tax returns"
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              pageSize={10}
              emptyTitle="No tax returns yet"
              emptyText="Your returns will appear here once your firm adds them."
            />
          )}
        </PageState>
        <div role="group" aria-label="Kind of return" className="grid gap-3 md:grid-cols-3">
          {KINDS.map(([k, Icon, title, text]) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(kind === k ? null : k)}
              className={`flex items-center gap-3 rounded-card border p-4 text-left hover:bg-folder-hover ${kind === k ? 'border-firm-accent bg-folder-surface' : 'border-folder-border'}`}
            >
              <Icon aria-hidden className="size-10 shrink-0 text-firm-primary" />
              <span>
                <span className="block font-display text-lg font-bold text-heading">{title}</span>
                <span className="block text-sm text-text">{text}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <TaxYearStatus slug={slug} />
        <TaxPaymentCard slug={slug} />
      </div>
    </div>
  );
}
