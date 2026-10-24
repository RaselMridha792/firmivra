'use client';

import {
  DOCUMENT_ERRORS,
  type RequestPacketRow,
  type RequestPacketTab,
  type RequestPacketsQuery,
} from '@firmivra/types';
import {
  Avatar,
  BulkBar,
  Button,
  DateRangePicker,
  type DateRange,
  KpiCard,
  PageHeader,
  Select,
  Table,
  type Column,
  type TableSort,
  Tabs,
  Toast,
} from '@firmivra/ui';
import {
  BellRinging,
  CalendarBlank,
  CaretRight,
  CheckCircle,
  Clock,
  Funnel,
  MagnifyingGlass,
  PaperPlaneTilt,
  Plus,
  WarningCircle,
  ChartPieSlice,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { RowMenu } from '../../../team/_components/row-menu';
import { RequestsRail } from './requests-rail';
import { STATUS_FILTER, TABS, VIEW_LOOKS } from './requests-parts';

const KEY = ['document-requests'];
/** "Kim Allen" as "K. Allen", as the design shows the assignee. */
const shortName = (name: string) => {
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? `${words[0]![0]}. ${words.slice(1).join(' ')}` : name;
};
const NONE: DateRange = { from: '', to: '' };
const due = (day: string | null) =>
  day
    ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'No due date';

/** Document Requests, the firm's dashboard of request packets (Documents design, Frame 3). */
export function RequestsScreen() {
  const client = useQueryClient();
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const [tab, setTab] = useState<RequestPacketTab>('all');
  const [text, setText] = useState('');
  const search = useDeferredValue(text.trim());
  const [clientId, setClientId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [range, setRange] = useState<DateRange>(NONE);
  const [more, setMore] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [sort, setSort] = useState<TableSort>({ id: 'due', descending: false });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const query: RequestPacketsQuery = {
    tab,
    sort: sort.id === 'title' ? 'title' : 'due',
    page,
    pageSize,
    ...(search ? { search } : {}),
    ...(clientId ? { clientId } : {}),
    ...(templateId ? { templateId } : {}),
    ...(assignee ? { assignedUserId: assignee } : {}),
    ...(range.from ? { dueFrom: range.from } : {}),
    ...(range.to ? { dueTo: range.to } : {}),
  };
  const list = useApiQuery([...KEY, 'list', query], () => api.documentLibrary.requests(query));
  const summary = useApiQuery([...KEY, 'summary'], () => api.documentLibrary.requestSummary());
  const ready = useApiQuery([...KEY, 'ready'], () =>
    api.documentLibrary.requests({ tab: 'ready_for_review', pageSize: 1 }),
  );
  const clients = useApiQuery(['clients', 'options'], () => api.clients.list({ limit: 100 }));
  const templates = useApiQuery([...KEY, 'templates'], () => api.documentLibrary.templates());
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.team.list(), enabled: manager });

  const reset = () => {
    setPage(1);
    setSelected([]);
  };
  const act = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
      setNote({ text: label, tone: 'success' });
      await client.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setNote({ text: errorMessage(e, DOCUMENT_ERRORS), tone: 'error' });
    }
  };
  const s = summary.data;
  const count = (n: number | undefined) => (summary.isError ? '—' : (n ?? '…'));
  const tabCount: Partial<Record<RequestPacketTab, number | undefined>> = {
    all: s?.total,
    outstanding: s?.outstanding,
    partially_received: s?.partiallyReceived,
    ready_for_review: ready.data?.total,
    completed: s?.completed,
    overdue: s?.overdue,
  };
  const createHref = '/documents/requests/new';

  const columns: Column<RequestPacketRow>[] = [
    {
      id: 'title',
      label: 'Request Title',
      sortable: true,
      cell: (r) => (
        <span className="flex min-w-[8rem] flex-col" title={r.reference}>
          <Link
            href={`/documents/requests/${r.id}`}
            className="font-semibold text-heading hover:text-action hover:underline"
          >
            {r.title}
          </Link>
          <span className="text-xs text-muted">{r.service.title}</span>
        </span>
      ),
    },
    {
      id: 'client',
      label: 'Client / Lead',
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={r.client.name} size="sm" />
          <span className="flex min-w-0 flex-col">
            <Link
              href={`/clients/${r.client.id}`}
              className="block max-w-[7.5rem] truncate font-medium text-heading hover:underline"
              title={r.client.name}
            >
              {r.client.name}
            </Link>
            {r.recipient.kind === 'MEMBER' ? (
              <span className="truncate text-xs text-muted">To {r.recipient.name} (team)</span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      id: 'documents',
      label: 'Requested Documents',
      // The header takes two lines so the whole table fits at 1440 px.
      className: 'whitespace-normal! min-w-[6.5rem]',
      cell: (r) => (
        <span className="text-sm text-text">
          {r.items.received} of {r.items.total} received
        </span>
      ),
    },
    {
      id: 'due',
      label: 'Due Date',
      sortable: true,
      cell: (r) => <span className="text-sm whitespace-nowrap text-text">{due(r.dueOn)}</span>,
    },
    {
      id: 'status',
      label: 'Status',
      cell: (r) => (
        <span
          className={`inline-flex rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap ${VIEW_LOOKS[r.view].tone}`}
        >
          {VIEW_LOOKS[r.view].label}
        </span>
      ),
    },
    {
      id: 'assigned',
      label: 'Assigned To',
      cell: (r) =>
        r.assignedTo ? (
          <span className="flex items-center gap-2">
            <Avatar name={r.assignedTo.name} size="sm" />
            <span className="text-sm whitespace-nowrap text-text">
              {shortName(r.assignedTo.name)}
            </span>
          </span>
        ) : (
          <span className="text-sm text-muted">Unassigned</span>
        ),
    },
  ];
  const open = (r: RequestPacketRow) => ['OPEN', 'SUBMITTED'].includes(r.status);

  return (
    <div data-testid="document-requests" className="flex min-w-0 flex-col gap-5">
      <PageHeader
        above={
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2 text-sm">
              <li>
                <Link href="/documents" className="text-text hover:text-action hover:underline">
                  Documents
                </Link>
              </li>
              <li aria-hidden>
                <CaretRight weight="bold" className="size-3 text-muted" />
              </li>
              <li aria-current="page" className="font-medium text-heading">
                Document Requests
              </li>
            </ol>
          </nav>
        }
        title="Document Requests"
        subtitle="Request, track, and manage documents from clients or team members."
        actions={
          <Link
            href={createHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-4 py-2 font-medium text-on-action hover:bg-action-hover"
          >
            <Plus aria-hidden weight="bold" className="size-5" />
            Create Document Request
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5" data-testid="request-cards">
        <KpiCard
          icon={PaperPlaneTilt}
          tone="blue"
          value={count(s?.total)}
          label="Total Requests"
          note="All time"
        />
        <KpiCard
          icon={Clock}
          tone="blue"
          value={count(s?.outstanding)}
          label="Outstanding"
          note="Awaiting documents"
        />
        <KpiCard
          icon={ChartPieSlice}
          tone="blue"
          value={count(s?.partiallyReceived)}
          label="Partially Received"
          note="Some documents uploaded"
        />
        <KpiCard
          icon={CheckCircle}
          tone="green"
          value={count(s?.completed)}
          label="Completed"
          note="All documents received"
        />
        <KpiCard
          icon={WarningCircle}
          tone="red"
          value={count(s?.overdue)}
          label="Overdue"
          note="Past due date"
        />
      </div>

      {note ? <Toast tone={note.tone} message={note.text} onDismiss={() => setNote(null)} /> : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_15.5rem]">
        <section className="flex min-w-0 flex-col gap-4">
          <div className="overflow-x-auto">
            <Tabs
              label="Request status"
              variant="segmented"
              value={tab}
              onChange={(id) => {
                setTab(id as RequestPacketTab);
                reset();
              }}
              items={TABS.map((t) => ({ id: t.id, label: t.label, count: tabCount[t.id] }))}
            />
          </div>

          <div
            className="flex flex-wrap items-end gap-2 xl:grid xl:grid-cols-[minmax(0,1fr)_7.5rem_9.5rem_8.5rem_auto_auto]"
            data-testid="request-filters"
          >
            <label className="relative min-w-0 flex-1 basis-56">
              <span className="sr-only">Search requests</span>
              <MagnifyingGlass
                aria-hidden
                weight="bold"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              />
              <input
                type="search"
                value={text}
                maxLength={100}
                onChange={(e) => {
                  setText(e.target.value);
                  reset();
                }}
                placeholder="Search client or title…"
                className="h-10 w-full rounded-control border border-border bg-surface pr-3 pl-9 text-sm text-text placeholder:text-muted"
              />
            </label>
            <Select
              label="Client"
              hideLabel
              className="h-10 py-1 text-sm"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                reset();
              }}
              options={[
                { value: '', label: 'All Clients' },
                ...(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.displayName })),
              ]}
            />
            <Select
              label="Request type"
              hideLabel
              className="h-10 py-1 text-sm"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                reset();
              }}
              options={[
                { value: '', label: 'All Request Types' },
                ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
            <Select
              label="Status"
              hideLabel
              className="h-10 py-1 text-sm"
              value={tab}
              onChange={(e) => {
                setTab(e.target.value as RequestPacketTab);
                reset();
              }}
              options={STATUS_FILTER.map((f) => ({ value: f.id, label: f.label }))}
            />
            <Button
              variant="outline"
              className="h-10"
              aria-expanded={more}
              onClick={() => setMore((v) => !v)}
            >
              <CalendarBlank aria-hidden weight="bold" className="size-4" />
              {range.from || range.to ? 'Due dates set' : 'Date Range'}
            </Button>
            <Button
              variant="outline"
              className="h-10"
              aria-expanded={more}
              onClick={() => setMore((v) => !v)}
            >
              <Funnel aria-hidden weight="bold" className="size-4" />
              More Filters
            </Button>
          </div>
          {more ? (
            <div
              className="flex flex-wrap items-end gap-3 rounded-card bg-canvas p-3"
              data-testid="more-filters"
            >
              <DateRangePicker
                label="Due date range"
                value={range}
                onChange={(next) => {
                  setRange(next);
                  reset();
                }}
              />
              {manager ? (
                <Select
                  label="Assigned To"
                  className="h-10 py-1 text-sm"
                  value={assignee}
                  onChange={(e) => {
                    setAssignee(e.target.value);
                    reset();
                  }}
                  options={[
                    { value: '', label: 'Anyone' },
                    ...(team.data ?? [])
                      .filter((m) => m.status === 'ACTIVE')
                      .map((m) => ({ value: m.user.id, label: m.user.name })),
                  ]}
                />
              ) : null}
              <Button
                variant="ghost"
                onClick={() => {
                  setText('');
                  setClientId('');
                  setTemplateId('');
                  setAssignee('');
                  setRange(NONE);
                  setTab('all');
                  reset();
                }}
              >
                Clear Filters
              </Button>
            </div>
          ) : null}

          {selected.length ? (
            <BulkBar
              count={selected.length}
              noun="request"
              actions={[
                {
                  label: 'Send Reminders',
                  icon: BellRinging,
                  onClick: () =>
                    void act('Reminders sent to the open requests.', async () => {
                      const r = await api.documentLibrary.bulkRequests({
                        action: 'REMIND',
                        ids: selected,
                      });
                      setSelected([]);
                      if (r.skipped.length)
                        throw new Error(
                          `${r.updated} reminded; ${r.skipped.length} closed ${r.skipped.length === 1 ? 'request was' : 'requests were'} skipped.`,
                        );
                    }),
                },
              ]}
            />
          ) : null}

          <Table
            caption="Document requests"
            dense
            rows={list.data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            loading={list.isPending}
            noun="requests"
            emptyTitle={
              list.isError ? 'Requests are not available right now.' : 'No requests here.'
            }
            emptyText={
              list.isError
                ? errorMessage(list.error, DOCUMENT_ERRORS)
                : 'Requests you send to clients appear here with what came back.'
            }
            selection={{ selected, onChange: setSelected }}
            pageSize={pageSize}
            pageSizes={[10, 25, 50]}
            onPageSize={(size) => {
              setPageSize(size);
              reset();
            }}
            server={{
              page,
              total: list.data?.total ?? 0,
              hasNext: page * pageSize < (list.data?.total ?? 0),
              hasPrevious: page > 1,
              onNext: () => setPage((p) => p + 1),
              onPrevious: () => setPage((p) => Math.max(1, p - 1)),
              onPage: setPage,
              sort,
              onSort: (next) => {
                setSort(next);
                reset();
              },
            }}
            rowActions={(r) => (
              <RowMenu
                label={`Actions for ${r.title}`}
                items={
                  open(r)
                    ? [
                        {
                          label: 'Send Reminder',
                          onSelect: () =>
                            void act(`Reminder sent for ${r.reference}.`, () =>
                              api.documentLibrary.remindRequest(r.id),
                            ),
                        },
                        {
                          label: 'Resend Request',
                          onSelect: () =>
                            void act(`${r.reference} sent again.`, () =>
                              api.documentLibrary.resendRequest(r.id),
                            ),
                        },
                        {
                          label: 'Mark Complete',
                          onSelect: () =>
                            void act(`${r.reference} marked complete.`, () =>
                              api.documentLibrary.completeRequest(r.id),
                            ),
                        },
                        {
                          label: 'Cancel Request',
                          danger: true,
                          onSelect: () =>
                            void act(`${r.reference} cancelled.`, () =>
                              api.documentLibrary.cancelRequest(r.id, {
                                reason: 'Cancelled from the requests dashboard.',
                              }),
                            ),
                        },
                      ]
                    : [
                        {
                          label: 'Open Client',
                          onSelect: () => window.location.assign(`/clients/${r.client.id}`),
                        },
                      ]
                }
              />
            )}
          />
        </section>

        <RequestsRail createHref={createHref} templates={templates} />
      </div>
    </div>
  );
}
