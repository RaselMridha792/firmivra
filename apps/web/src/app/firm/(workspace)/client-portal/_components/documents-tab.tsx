'use client';

import type { DocumentReviewStatus, LibraryDocument, LibraryQuery } from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  IconTile,
  type KpiTone,
  Pagination,
  SearchField,
  Select,
  Tabs,
} from '@firmivra/ui';
import type { Icon } from '@phosphor-icons/react';
import {
  Archive,
  CheckCircle,
  CloudArrowUp,
  DotsThree,
  DownloadSimple,
  Eye,
  FilePlus,
  FileText,
  FileArrowUp,
  Files,
  Hourglass,
  ShareNetwork,
  Trash,
  Tray,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { dayText, timeText } from './activity-labels';

type View = 'all' | 'client' | 'firm' | 'review' | 'requested';
const PAGE_SIZES = [10, 25, 50];
const DATES: { value: string; label: string; days: number | null }[] = [
  { value: '', label: 'All Dates', days: null },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
  { value: '365', label: 'Last 12 months', days: 365 },
];
const REVIEW: Record<DocumentReviewStatus, string> = {
  NEEDS_REVIEW: 'Pending Review',
  IN_REVIEW: 'In Review',
  VERIFIED: 'Reviewed',
  REPLACEMENT_REQUESTED: 'Replacement Requested',
  COMPLETED: 'Reviewed',
};

/** Source, as Frame 3 names it: who put the file in the portal. */
function sourceOf(d: LibraryDocument): string {
  if (d.direction === 'FIRM_TO_CLIENT') return 'Firm Shared';
  if (d.uploadedBy?.byClient) return 'Client Upload';
  return d.direction === 'INTERNAL' ? 'Internal' : 'Firm Upload';
}

/** Status, as Frame 3 names it: the review state, or shared and new. */
function statusOf(d: LibraryDocument): {
  label: string;
  tone: 'success' | 'info' | 'warning' | 'purple' | 'neutral';
} {
  if (d.reviewStatus) {
    const label = REVIEW[d.reviewStatus];
    const tone =
      d.reviewStatus === 'NEEDS_REVIEW' || d.reviewStatus === 'IN_REVIEW'
        ? 'info'
        : d.reviewStatus === 'REPLACEMENT_REQUESTED'
          ? 'warning'
          : 'success';
    return { label, tone };
  }
  if (d.direction === 'FIRM_TO_CLIENT') return { label: 'Shared', tone: 'purple' };
  return { label: 'New', tone: 'success' };
}

/** "PDF" from the file: what kind of file it is. */
const kindOf = (d: LibraryDocument) =>
  (d.fileName.split('.').pop() ?? d.contentType.split('/').pop() ?? '').toUpperCase();

/**
 * Frame 3, Client Portal Documents (documents-tab.jpg; developer instructions 18 and 19): the
 * client's documents from the canonical Documents library, its five KPIs, tabs, filters and row
 * actions, their open requests and the recent document activity. Uploads and requests open the
 * Documents module with the client chosen. Storage Usage is left out: no quota is recorded.
 */
export function PortalDocuments({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>('all');
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('');
  const [review, setReview] = useState<DocumentReviewStatus | ''>('');
  const [dates, setDates] = useState('');
  const [fromDate, setFromDate] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const summary = useApiQuery(['client-portal', 'documents-summary', clientId], () =>
    api.clientPortal.documentsSummary(clientId),
  );
  const categories = useApiQuery(['document-categories'], () => api.documents.categories());
  const query: LibraryQuery = {
    clientId,
    page,
    pageSize,
    search: term.trim() || undefined,
    categoryId: category || undefined,
    reviewStatus: view === 'review' ? 'NEEDS_REVIEW' : review || undefined,
    direction:
      view === 'client' ? 'CLIENT_TO_FIRM' : view === 'firm' ? 'FIRM_TO_CLIENT' : undefined,
    uploadedFrom: fromDate,
  };
  const docs = useApiQuery(['client-portal', 'documents', query], () =>
    api.documentLibrary.list(query),
  );
  const s = summary.data;
  const tabs = [
    { id: 'all', label: `All Documents (${s?.total ?? 0})` },
    { id: 'client', label: `Client Uploaded (${s?.clientUploaded ?? 0})` },
    { id: 'firm', label: `Firm Shared (${s?.firmShared ?? 0})` },
    { id: 'review', label: `Pending Review (${s?.pendingReview ?? 0})` },
    { id: 'requested', label: `Requested (${s?.requested ?? 0})` },
  ];
  const filtered = !!(term || category || review || dates);
  return (
    <div
      className="grid items-start gap-6 @5xl:grid-cols-[minmax(0,1fr)_22rem]"
      data-testid="portal-documents"
    >
      <Card className="min-w-0">
        <div className="mb-4 flex flex-wrap items-start gap-4">
          <IconTile icon={FileText} tone="blue" />
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold text-heading">Client Documents</h2>
            <p className="text-sm text-muted">
              Manage documents shared with this client, view uploads, and track document requests.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                router.push(`/documents/upload?clientId=${encodeURIComponent(clientId)}`)
              }
            >
              <CloudArrowUp aria-hidden className="size-4" /> Upload Document
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/documents/requests/new?clientId=${encodeURIComponent(clientId)}`)
              }
            >
              <FilePlus aria-hidden className="size-4" /> Request Document
            </Button>
          </div>
        </div>
        <div
          className="mb-4 grid grid-cols-2 gap-3 @lg:grid-cols-3 @4xl:grid-cols-5"
          data-testid="document-kpis"
        >
          <Kpi icon={Files} tone="blue" value={s?.total} label="Total Documents" />
          <Kpi icon={FileArrowUp} tone="green" value={s?.clientUploaded} label="Client Uploaded" />
          <Kpi icon={ShareNetwork} tone="purple" value={s?.firmShared} label="Firm Shared" />
          <Kpi icon={Hourglass} tone="amber" value={s?.pendingReview} label="Pending Review" />
          <Kpi icon={Tray} tone="red" value={s?.requested} label="Requested" />
        </div>
        <div className="mb-4 grid gap-3 @4xl:grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(9rem,1fr))_auto] @4xl:items-end">
          <SearchField
            label="Search documents"
            placeholder="Search documents by name, type, or keyword..."
            value={term}
            minWidth="10rem"
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(1);
            }}
          />
          <Select
            label="Category"
            hideLabel
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All Categories' },
              ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Select
            label="Status"
            hideLabel
            value={review}
            onChange={(e) => {
              setReview(e.target.value as DocumentReviewStatus | '');
              setPage(1);
            }}
            options={[
              { value: '', label: 'All Statuses' },
              { value: 'NEEDS_REVIEW', label: 'Pending Review' },
              { value: 'IN_REVIEW', label: 'In Review' },
              { value: 'VERIFIED', label: 'Reviewed' },
              { value: 'REPLACEMENT_REQUESTED', label: 'Replacement Requested' },
            ]}
          />
          <Select
            label="Date"
            hideLabel
            value={dates}
            onChange={(e) => {
              const days = DATES.find((d) => d.value === e.target.value)?.days ?? null;
              setDates(e.target.value);
              // From the chosen number of days back (worked out here, never while rendering).
              setFromDate(
                days
                  ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
                  : undefined,
              );
              setPage(1);
            }}
            options={DATES.map((d) => ({ value: d.value, label: d.label }))}
          />
          {filtered ? (
            <button
              type="button"
              className="text-sm font-medium text-danger"
              onClick={() => {
                setTerm('');
                setCategory('');
                setReview('');
                setDates('');
                setFromDate(undefined);
                setPage(1);
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
        <Tabs
          label="Documents"
          variant="underline"
          value={view}
          onChange={(id) => {
            setView(id as View);
            setPage(1);
          }}
          items={tabs}
        />
        <div className="pt-4">
          {view === 'requested' ? (
            <RequestsList clientId={clientId} full />
          ) : (
            <PageState
              query={docs}
              empty={
                filtered ? 'No documents match these filters.' : 'No documents in this view yet.'
              }
              isEmpty={(d) => d.items.length === 0}
            >
              {(d) => (
                <>
                  <DocumentsTable rows={d.items} />
                  <div className="mt-4">
                    <Pagination
                      page={page}
                      onPage={setPage}
                      pageCount={Math.max(1, Math.ceil(d.total / pageSize))}
                      summary={`Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, d.total)} of ${d.total} documents`}
                      pageSize={pageSize}
                      pageSizes={PAGE_SIZES}
                      onPageSize={(n) => {
                        setPageSize(n);
                        setPage(1);
                      }}
                    />
                  </div>
                </>
              )}
            </PageState>
          )}
        </div>
      </Card>
      <div className="flex min-w-0 flex-col gap-6">
        <Card className="min-w-0" data-testid="document-requests-panel">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-heading">Document Requests</h3>
            <button
              type="button"
              className="text-sm font-medium text-action underline"
              onClick={() => router.push(`/clients/${clientId}/documents`)}
            >
              View All
            </button>
          </div>
          <RequestsList clientId={clientId} />
          <Button
            variant="outline"
            className="mt-3 w-full"
            onClick={() =>
              router.push(`/documents/requests/new?clientId=${encodeURIComponent(clientId)}`)
            }
          >
            + Request New Document
          </Button>
        </Card>
        <RecentDocumentActivity clientId={clientId} />
      </div>
    </div>
  );
}

function Kpi({
  icon,
  tone,
  value,
  label,
}: {
  icon: Icon;
  tone: KpiTone;
  value: number | undefined;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-card border border-divider p-3">
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="text-2xl font-bold text-heading">{value ?? '—'}</p>
        <p className="text-sm leading-tight [overflow-wrap:normal] text-muted">{label}</p>
      </div>
    </div>
  );
}

function DocumentsTable({ rows }: { rows: LibraryDocument[] }) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-[56rem] text-left text-sm"
        data-testid="portal-documents-table"
      >
        <thead className="text-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">Document Name</th>
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 font-medium">Category</th>
            <th className="py-2 pr-3 font-medium">Source</th>
            <th className="py-2 pr-3 font-medium">Uploaded By</th>
            <th className="py-2 pr-3 font-medium">Date</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const status = statusOf(d);
            return (
              <tr key={d.id} className="border-t border-divider">
                <td className="max-w-64 py-2 pr-3">
                  <span className="flex items-center gap-2">
                    <FileText aria-hidden className="size-5 shrink-0 text-danger" />
                    <span className="truncate text-text" title={d.fileName}>
                      {d.fileName}
                    </span>
                  </span>
                </td>
                <td className="py-2 pr-3 text-text">{kindOf(d)}</td>
                <td className="py-2 pr-3 text-text">{d.category?.name ?? '—'}</td>
                <td className="py-2 pr-3 text-text">{sourceOf(d)}</td>
                <td className="py-2 pr-3 text-text">
                  {d.uploadedBy
                    ? d.uploadedBy.byClient
                      ? 'Client'
                      : `Staff (${d.uploadedBy.name})`
                    : '—'}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap text-text">{dayText(d.createdAt)}</td>
                <td className="py-2 pr-3">
                  <Badge tone={status.tone} dot>
                    {status.label}
                  </Badge>
                </td>
                <td className="py-2">
                  <RowActions doc={d} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The three-dot menu (instructions 19): canonical actions, each audited by Documents. */
function RowActions({ doc }: { doc: LibraryDocument }) {
  const router = useRouter();
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const act = useApiMutation(
    async (kind: 'download' | 'reviewed' | 'archive' | 'trash') => {
      if (kind === 'download') {
        const link = await api.documents.download(doc.id);
        window.open(link.url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (kind === 'reviewed') {
        if (doc.reviewStatus === 'NEEDS_REVIEW') {
          await api.documentLibrary.review(doc.id, { action: 'START' });
        }
        await api.documentLibrary.review(doc.id, { action: 'VERIFY' });
        return;
      }
      if (kind === 'archive') await api.documentLibrary.archive(doc.id);
      else await api.documentLibrary.trash(doc.id);
    },
    { invalidate: ['client-portal'] },
  );
  const reviewable = doc.reviewStatus === 'NEEDS_REVIEW' || doc.reviewStatus === 'IN_REVIEW';
  return (
    <div className="flex items-center gap-2">
      <ActionMenu
        label={`Actions for ${doc.fileName}`}
        align="right"
        trigger={<DotsThree aria-hidden weight="bold" className="size-5" />}
        sections={[
          {
            items: [
              {
                label: 'View / Preview',
                icon: Eye,
                onSelect: () => router.push(`/documents/${doc.id}`),
              },
              { label: 'Download', icon: DownloadSimple, onSelect: () => act.mutate('download') },
              ...(reviewable
                ? [
                    {
                      label: 'Mark Reviewed',
                      icon: CheckCircle,
                      onSelect: () => act.mutate('reviewed'),
                    },
                  ]
                : []),
              {
                label: 'Request Replacement',
                icon: FilePlus,
                onSelect: () => router.push(`/documents/${doc.id}`),
              },
              {
                label: doc.visibleToClient ? 'Remove from Portal' : 'Share to Portal',
                icon: ShareNetwork,
                onSelect: () => router.push(`/documents/${doc.id}/share`),
              },
              { label: 'Archive', icon: Archive, onSelect: () => act.mutate('archive') },
              ...(manager
                ? [
                    {
                      label: 'Move to Trash',
                      icon: Trash,
                      danger: true,
                      onSelect: () => act.mutate('trash'),
                    },
                  ]
                : []),
            ],
          },
        ]}
      />
      {act.error ? (
        <span role="alert" className="text-xs text-danger">
          {errorMessage(act.error)}
        </span>
      ) : null}
    </div>
  );
}

function RequestsList({ clientId, full = false }: { clientId: string; full?: boolean }) {
  const requests = useApiQuery(['client-portal', 'document-requests', clientId], () =>
    api.documents.requests(clientId),
  );
  return (
    <PageState
      query={requests}
      empty="No document requests for this client."
      isEmpty={(r) =>
        r.filter((x) => full || x.status === 'REQUESTED' || x.status === 'REJECTED').length === 0
      }
    >
      {(r) => (
        <ul
          className="flex flex-col divide-y divide-divider"
          data-testid="portal-document-requests"
        >
          {r
            .filter((x) => full || x.status === 'REQUESTED' || x.status === 'REJECTED')
            .slice(0, full ? 100 : 5)
            .map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-2">
                <FileText aria-hidden className="size-5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-heading">{x.title}</span>
                  <span className="block text-xs text-muted">
                    {x.dueOn ? `Due ${dayText(`${x.dueOn}T12:00:00Z`)}` : 'No due date'}
                  </span>
                </span>
                <Badge
                  tone={
                    x.status === 'REQUESTED'
                      ? 'info'
                      : x.status === 'REJECTED'
                        ? 'danger'
                        : x.status === 'ACCEPTED'
                          ? 'success'
                          : 'neutral'
                  }
                >
                  {x.status === 'REQUESTED'
                    ? 'Requested'
                    : x.status === 'REJECTED'
                      ? 'Pending'
                      : x.status.charAt(0) + x.status.slice(1).toLowerCase().replace('_', ' ')}
                </Badge>
              </li>
            ))}
        </ul>
      )}
    </PageState>
  );
}

function RecentDocumentActivity({ clientId }: { clientId: string }) {
  const router = useRouter();
  const activity = useApiQuery(['client-portal', 'activity', clientId, 'documents'], () =>
    api.clientPortal.activity(clientId, { type: 'document', limit: 5 }),
  );
  return (
    <Card className="min-w-0" data-testid="recent-document-activity">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-heading">Recent Document Activity</h3>
        <button
          type="button"
          className="text-sm font-medium text-action underline"
          onClick={() => router.push(`/client-portal/${clientId}/activity`)}
        >
          View All
        </button>
      </div>
      <PageState
        query={activity}
        empty="No document activity recorded yet."
        isEmpty={(p) => p.items.length === 0}
      >
        {(p) => (
          <ul className="flex flex-col gap-3">
            {p.items.map((e) => (
              <li key={e.id} className="flex items-start gap-3">
                <FileArrowUp aria-hidden className="mt-0.5 size-5 text-action" />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium text-heading">
                    {e.type === 'document.viewed' ? 'Document viewed' : 'Document uploaded'}
                  </span>
                  <span className="block text-muted">
                    {dayText(e.at)} {timeText(e.at)} · by {e.actor.name ?? 'Client'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageState>
    </Card>
  );
}
