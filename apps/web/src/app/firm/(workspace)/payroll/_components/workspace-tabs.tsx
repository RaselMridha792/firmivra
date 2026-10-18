'use client';

import type {
  PayrollClientWorkspace,
  PayrollFiling,
  PayrollReport,
  PayrollRunRow,
  PayrollWorker,
  PayrollWorkerTab,
} from '@firmivra/types';
import { Badge, Button, type Column, Input, Modal, Select, Table, Textarea } from '@firmivra/ui';
import { ChatCircleDots, MagnifyingGlass, PencilSimple, Plus } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  FREQUENCY_LABEL,
  FREQUENCY_OPTIONS,
  PAYROLL_ERRORS,
  PAYROLL_KEY,
  PROVIDER_OPTIONS,
  RunStatusPill,
  WORKER_STATUS_LABEL,
  WORKER_TYPE_LABEL,
  card,
  dayText,
  money,
  outlined,
  periodText,
  quiet,
  stamp,
  subtle,
} from './payroll-shared';
import { WorkerDialog } from './worker-dialog';

type Notice = (text: string, tone: 'success' | 'error') => void;
const empty = (pending: boolean, failed: boolean, none: string, error: string) =>
  pending ? 'Loading…' : failed ? error : none;

const WORKER_TABS: { id: PayrollWorkerTab; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'FULL_TIME', label: 'Full-Time' },
  { id: 'PART_TIME', label: 'Part-Time' },
  { id: 'ON_LEAVE', label: 'On Leave' },
  { id: 'CONTRACTORS', label: 'Contractors' },
];

/** Employees: the directory of employees and contractors, with their recent changes. */
export function EmployeesTab({
  id,
  onAdd,
  notice,
}: {
  id: string;
  onAdd: (t: 'FULL_TIME' | 'CONTRACTOR') => void;
  notice: Notice;
}) {
  const [tab, setTab] = useState<PayrollWorkerTab>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PayrollWorker>();
  const list = useApiQuery([...PAYROLL_KEY, 'workers', id, tab, search, page], () =>
    api.payroll.workers(id, {
      tab,
      ...(search.trim() ? { search: search.trim() } : {}),
      page,
      pageSize: 10,
    }),
  );
  const columns: Column<PayrollWorker>[] = [
    {
      id: 'name',
      label: 'Name',
      cell: (w) => <span className="font-semibold text-heading">{w.displayName}</span>,
    },
    { id: 'type', label: 'Type', cell: (w) => WORKER_TYPE_LABEL[w.workerType] },
    {
      id: 'rate',
      label: 'Pay Rate',
      cell: (w) =>
        w.rateCents === null
          ? '—'
          : `${money(w.rateCents)}${w.payType === 'HOURLY' ? '/hr' : w.payType === 'SALARY' ? '/yr' : ''}`,
    },
    { id: 'dept', label: 'Department', cell: (w) => w.department ?? '—' },
    {
      id: 'status',
      label: 'Status',
      cell: (w) => (
        <Badge
          tone={w.status === 'ACTIVE' ? 'success' : w.status === 'ON_LEAVE' ? 'danger' : 'neutral'}
        >
          {WORKER_STATUS_LABEL[w.status]}
        </Badge>
      ),
    },
    {
      id: 'dd',
      label: 'Direct Deposit',
      cell: (w) =>
        w.directDepositReady === null ? '—' : w.directDepositReady ? 'Ready' : 'Not ready',
    },
    {
      id: 'change',
      label: 'Last Change',
      cell: (w) =>
        w.lastChangeAt
          ? `${dayText(w.lastChangeAt.slice(0, 10))}${w.lastChangeNote ? ` · ${w.lastChangeNote}` : ''}`
          : '—',
    },
  ];
  return (
    <section className={card} aria-label="Employees" data-testid="tab-employees">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav
          role="tablist"
          aria-label="Worker views"
          className="flex overflow-x-auto border-b border-divider"
        >
          {WORKER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setPage(1);
              }}
              className={`-mb-px min-h-10 shrink-0 border-b-2 px-3 text-sm ${tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent text-heading'}`}
            >
              {t.label} ({list.data?.tabCounts[t.id] ?? 0})
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-divider bg-canvas px-3 text-muted">
            <MagnifyingGlass aria-hidden weight="bold" className="size-4" />
            <span className="sr-only">Search employees</span>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search employees..."
              className="w-40 bg-transparent text-sm text-text outline-none"
            />
          </label>
          <button type="button" className={outlined} onClick={() => onAdd('FULL_TIME')}>
            <Plus aria-hidden weight="bold" className="size-4" /> Add Employee
          </button>
          <button type="button" className={outlined} onClick={() => onAdd('CONTRACTOR')}>
            <Plus aria-hidden weight="bold" className="size-4" /> Add Contractor
          </button>
        </div>
      </div>
      <div className="relative">
        <Table
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(w) => w.id}
          caption="Employees and contractors"
          dense
          noun="workers"
          pageSize={10}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Employees are not available' : 'No employees'}
          emptyText={
            list.isError
              ? 'We could not load the employees. Try again in a moment.'
              : 'Add an employee or contractor to get started.'
          }
          rowActions={(w) => (
            <button
              type="button"
              aria-label={`Edit ${w.displayName}`}
              onClick={() => setEditing(w)}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-divider bg-surface text-heading hover:bg-canvas"
            >
              <PencilSimple aria-hidden weight="fill" className="size-4" />
            </button>
          )}
          server={{
            page: list.data?.page ?? 1,
            total: list.data?.total ?? 0,
            hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
            hasPrevious: (list.data?.page ?? 1) > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(Math.max(1, page - 1)),
            onPage: (n: number) => setPage(n),
            onSort: () => undefined,
          }}
        />
      </div>
      {editing ? (
        <WorkerDialog
          payrollClientId={id}
          worker={editing}
          onClose={() => setEditing(undefined)}
          onDone={(text) => {
            setEditing(undefined);
            notice(text, 'success');
          }}
        />
      ) : null}
    </section>
  );
}

/** Payroll Runs: upcoming, in-progress and past runs. Completed runs are never rewritten. */
export function RunsTab({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const list = useApiQuery([...PAYROLL_KEY, 'client-runs', id, page], () =>
    api.payroll.clientRuns(id, { page, pageSize: 10 }),
  );
  const columns: Column<PayrollRunRow>[] = [
    {
      id: 'period',
      label: 'Pay Period',
      cell: (r) => (
        <Link href={`/payroll/runs/${r.id}`} className="font-medium text-link hover:underline">
          {periodText(r.periodStart, r.periodEnd)}
        </Link>
      ),
    },
    { id: 'pay', label: 'Pay Date', cell: (r) => dayText(r.payDate) },
    { id: 'freq', label: 'Frequency', cell: (r) => FREQUENCY_LABEL[r.frequency] },
    { id: 'emp', label: 'Employees', cell: (r) => r.employeeCount ?? '—' },
    { id: 'gross', label: 'Gross', cell: (r) => money(r.grossCents) },
    { id: 'cost', label: 'Total Cost', cell: (r) => money(r.totalCostCents) },
    { id: 'status', label: 'Status', cell: (r) => <RunStatusPill status={r.status} /> },
    { id: 'prov', label: 'Provider Status', cell: (r) => r.providerStatus ?? '—' },
  ];
  return (
    <section className={card} aria-label="Payroll Runs" data-testid="tab-runs">
      <div className="relative">
        <Table
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          caption="Payroll runs"
          dense
          noun="runs"
          pageSize={10}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Runs are not available' : 'No payroll runs'}
          emptyText={
            list.isError
              ? 'We could not load the runs. Try again in a moment.'
              : 'Runs appear once a provider is connected and a frequency is set.'
          }
          rowActions={(r) => (
            <Link
              href={`/payroll/runs/${r.id}`}
              aria-label={`${r.status === 'COMPLETED' ? 'View' : 'Continue'} ${periodText(r.periodStart, r.periodEnd)}`}
              className={subtle}
            >
              {r.status === 'COMPLETED' ? 'View' : 'Continue'}
            </Link>
          )}
          server={{
            page: list.data?.page ?? 1,
            total: list.data?.total ?? 0,
            hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
            hasPrevious: (list.data?.page ?? 1) > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(Math.max(1, page - 1)),
            onPage: (n: number) => setPage(n),
            onSort: () => undefined,
          }}
        />
      </div>
    </section>
  );
}

const FILING_TONE = {
  UPCOMING: 'info',
  IN_PROGRESS: 'info',
  FILED: 'success',
  PAID: 'success',
  FAILED: 'danger',
  NEEDS_ATTENTION: 'danger',
  UNKNOWN: 'neutral',
} as const;

/** Tax Filings: federal, state and local filing and payment records from the provider. Never implies Firmivra filed. */
export function FilingsTab({ id }: { id: string }) {
  const list = useApiQuery([...PAYROLL_KEY, 'filings', id], () => api.payroll.filings(id));
  const columns: Column<PayrollFiling>[] = [
    {
      id: 'form',
      label: 'Form',
      cell: (f) => <span className="font-semibold text-heading">{f.form}</span>,
    },
    { id: 'jur', label: 'Jurisdiction', cell: (f) => f.jurisdiction },
    { id: 'period', label: 'Period', cell: (f) => periodText(f.periodStart, f.periodEnd) },
    { id: 'due', label: 'Due', cell: (f) => (f.dueOn ? dayText(f.dueOn) : '—') },
    {
      id: 'status',
      label: 'Status',
      cell: (f) => (
        <Badge tone={FILING_TONE[f.status]}>
          {f.status.charAt(0) + f.status.slice(1).toLowerCase().replace('_', ' ')}
        </Badge>
      ),
    },
    {
      id: 'pay',
      label: 'Payment',
      cell: (f) => f.paymentStatus.charAt(0) + f.paymentStatus.slice(1).toLowerCase(),
    },
    { id: 'conf', label: 'Confirmation', cell: (f) => f.confirmationRef ?? '—' },
    {
      id: 'src',
      label: 'Source',
      cell: (f) =>
        f.source
          ? `${f.source === 'provider' ? 'Provider' : 'Import'}${f.sourceSyncedAt ? `, ${dayText(f.sourceSyncedAt.slice(0, 10))}` : ''}`
          : '—',
    },
  ];
  const c = list.data?.counts;
  return (
    <section className={card} aria-label="Tax Filings" data-testid="tab-filings">
      <p className="mb-3 flex flex-wrap gap-2 text-sm">
        <Badge tone="info">{c?.upcoming ?? 0} upcoming</Badge>
        <Badge tone="success">{c?.filed ?? 0} filed</Badge>
        <Badge tone="danger">{c?.needsAttention ?? 0} need attention</Badge>
      </p>
      <div className="relative">
        <Table
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(f) => f.id}
          caption="Payroll tax filings"
          dense
          noun="filings"
          pageSize={50}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Filings are not available' : 'No filings'}
          emptyText={
            list.isError
              ? 'We could not load the filings. Try again in a moment.'
              : 'Filing records appear when the provider shares them.'
          }
        />
      </div>
      <p className="mt-2 text-xs text-muted">
        These are records from the provider or an import. Firmivra does not file payroll taxes.
      </p>
    </section>
  );
}

const KIND_LABEL: Record<PayrollReport['kind'], string> = {
  REGISTER: 'Payroll Register',
  EARNINGS: 'Earnings',
  DEDUCTIONS: 'Deductions',
  EMPLOYER_TAX: 'Employer Tax',
  TAX_FILING: 'Tax Filing',
  JOURNAL: 'Payroll Journal',
  LABOR: 'Labor',
  W2_W3: 'W-2 / W-3',
  FORM_1099: '1099',
  OTHER: 'Other',
};
const YEAR_STEPS = {
  WORKER_REVIEW: 'Worker review',
  MISSING_INFORMATION: 'Missing information',
  W2_W3: 'W-2 and W-3',
  FORM_1099: '1099 forms',
  RECONCILIATION: 'Reconciliation',
  CLIENT_DELIVERY: 'Client delivery',
} as const;

/** Reports: the report library and the year-end checklist. */
export function ReportsTab({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const list = useApiQuery([...PAYROLL_KEY, 'reports', id, page], () =>
    api.payroll.reports(id, { page, pageSize: 10 }),
  );
  const columns: Column<PayrollReport>[] = [
    {
      id: 'kind',
      label: 'Report',
      cell: (r) => <span className="font-semibold text-heading">{KIND_LABEL[r.kind]}</span>,
    },
    { id: 'period', label: 'Period', cell: (r) => periodText(r.periodStart, r.periodEnd) },
    { id: 'ver', label: 'Version', cell: (r) => `v${r.version}` },
    { id: 'src', label: 'Source', cell: (r) => (r.source === 'provider' ? 'Provider' : 'Import') },
    { id: 'pulled', label: 'Pulled', cell: (r) => stamp(r.pulledAt) },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="tab-reports">
      <section className={card} aria-label="Reports">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-heading">Payroll Reports</h2>
          <button type="button" className={outlined} onClick={() => setAdding(true)}>
            <Plus aria-hidden weight="bold" className="size-4" /> Add Report
          </button>
        </div>
        <div className="relative">
          <Table
            rows={list.data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            caption="Payroll reports"
            dense
            noun="reports"
            pageSize={10}
            loading={list.isPending}
            emptyTitle={list.isError ? 'Reports are not available' : 'No reports'}
            emptyText={
              list.isError
                ? 'We could not load the reports. Try again in a moment.'
                : 'Reports pulled from the provider or added from a document appear here.'
            }
            server={{
              page: list.data?.page ?? 1,
              total: list.data?.total ?? 0,
              hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
              hasPrevious: (list.data?.page ?? 1) > 1,
              onNext: () => setPage(page + 1),
              onPrevious: () => setPage(Math.max(1, page - 1)),
              onPage: (n: number) => setPage(n),
              onSort: () => undefined,
            }}
          />
        </div>
      </section>
      <YearEnd id={id} />
      {adding ? <AddReportDialog id={id} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function YearEnd({ id }: { id: string }) {
  const year = new Date().getFullYear();
  const ye = useApiQuery([...PAYROLL_KEY, 'year-end', id, year], () =>
    api.payroll.yearEnd(id, { taxYear: year }),
  );
  const save = useApiMutation(
    (v: { step: keyof typeof YEAR_STEPS; state: 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' }) =>
      api.payroll.saveYearEnd(id, year, { items: [v] }),
    { invalidate: [...PAYROLL_KEY, 'year-end'] },
  );
  const d = ye.data;
  return (
    <section className={card} aria-label="Year-End" data-testid="year-end">
      <h2 className="mb-1 font-display text-lg font-bold text-heading">Year-End {year}</h2>
      {d ? (
        <p className="mb-3 text-sm text-muted">
          Status: {d.status.charAt(0) + d.status.slice(1).toLowerCase().replace('_', ' ')}
        </p>
      ) : null}
      {!d ? (
        <p className={quiet}>
          {empty(ye.isPending, ye.isError, '', 'Year-end is not available right now.')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {d.items.map((i) => (
            <li
              key={i.step}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-divider py-2 text-sm first:border-t-0"
            >
              <span className="text-heading">{YEAR_STEPS[i.step]}</span>
              <select
                aria-label={`${YEAR_STEPS[i.step]} status`}
                value={i.state}
                onChange={(e) => save.mutate({ step: i.step, state: e.target.value as 'DONE' })}
                className="min-h-9 rounded-control border border-border bg-surface px-2 text-sm"
              >
                <option value="NOT_STARTED">Not started</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="DONE">Done</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddReportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useApiQuery([...PAYROLL_KEY, 'client', id], () => api.payroll.getClient(id));
  const docs = useApiQuery([...PAYROLL_KEY, 'documents', ws.data?.client.id ?? ''], async () =>
    ws.data ? api.documents.list(ws.data.client.id) : { items: [] },
  );
  const [kind, setKind] = useState<PayrollReport['kind']>('REGISTER');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [doc, setDoc] = useState('');
  const send = useApiMutation(
    () => api.payroll.addReport(id, { kind, periodStart: from, periodEnd: to, documentId: doc }),
    { invalidate: [...PAYROLL_KEY] },
  );
  return (
    <Modal
      open
      title="Add Report"
      subtitle="Attach a document the client already has as a payroll report."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!from || !to || !doc || send.isPending}
            onClick={() => send.mutate(undefined, { onSuccess: onClose })}
          >
            Add Report
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Report"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          options={(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((v) => ({
            value: v,
            label: KIND_LABEL[v],
          }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Period start"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            label="Period end"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Select
          label="Document"
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
          options={[
            {
              value: '',
              label: (docs.data?.items ?? []).length ? 'Select a document' : 'No documents to add',
            },
            ...(docs.data?.items ?? []).map((d) => ({ value: d.id, label: d.fileName })),
          ]}
        />
        {send.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, PAYROLL_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Documents: the client's payroll documents, from the shared Documents module. */
export function DocumentsTab({ clientId }: { clientId: string | undefined }) {
  const docs = useApiQuery([...PAYROLL_KEY, 'documents', clientId ?? ''], async () =>
    clientId ? api.documents.list(clientId) : { items: [] },
  );
  const rows = docs.data?.items ?? [];
  return (
    <section className={card} aria-label="Documents" data-testid="tab-documents">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-heading">Payroll Documents</h2>
        <div className="flex gap-2">
          <Link href="/modules/document-requests" className={outlined}>
            Request Documents
          </Link>
          {clientId ? (
            <Link href={`/clients/${clientId}/documents`} className={outlined}>
              Upload Document
            </Link>
          ) : null}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className={quiet}>
          {empty(
            docs.isPending,
            docs.isError,
            'No documents yet.',
            'Documents are not available right now.',
          )}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2 border-t border-divider py-2 text-sm first:border-t-0"
            >
              <span className="min-w-0 truncate text-heading">{d.fileName}</span>
              <span className="shrink-0 text-xs text-muted">
                {dayText(d.createdAt.slice(0, 10))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Tasks: the shared Tasks module, filtered to this client. */
export function TasksTab({ clientId }: { clientId: string | undefined }) {
  const tasks = useApiQuery([...PAYROLL_KEY, 'tasks-tab', clientId ?? ''], async () =>
    clientId
      ? api.taskWork.overview({ view: 'all', status: 'OPEN', clientId, pageSize: 20 })
      : { items: [] },
  );
  const rows = tasks.data?.items ?? [];
  return (
    <section className={card} aria-label="Tasks" data-testid="tab-tasks">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-heading">Payroll Tasks</h2>
        <Link href="/tasks/new" className={outlined}>
          <Plus aria-hidden weight="bold" className="size-4" /> Add Task
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className={quiet}>
          {empty(
            tasks.isPending,
            tasks.isError,
            'No open tasks for this client.',
            'Tasks are not available right now.',
          )}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 border-t border-divider py-2 text-sm first:border-t-0"
            >
              <Link
                href={`/tasks/${t.id}`}
                className="min-w-0 truncate font-medium text-link hover:underline"
              >
                {t.title}
              </Link>
              <span className="shrink-0 text-xs text-muted">
                {t.dueOn ? dayText(t.dueOn) : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const KIND_OPTIONS = [
  { value: 'OTHER', label: 'Note' },
  { value: 'PAYROLL_REVIEW', label: 'Payroll review' },
  { value: 'CLIENT_CALL', label: 'Client call' },
  { value: 'PROVIDER_ISSUE', label: 'Provider issue' },
  { value: 'NOTICE_FOLLOW_UP', label: 'Notice follow-up' },
  { value: 'DOCUMENT_FOLLOW_UP', label: 'Document follow-up' },
];

/** Notes: internal notes and logged activity. Never shown to the client. */
export function NotesTab({ id, notice }: { id: string; notice: Notice }) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('OTHER');
  const [text, setText] = useState('');
  const acts = useApiQuery([...PAYROLL_KEY, 'activities', id, 'page', page], () =>
    api.payroll.activities(id, { page, pageSize: 10 }),
  );
  const send = useApiMutation(
    () => api.payroll.logActivity(id, { kind: kind as 'OTHER', summary: text.trim() }),
    { invalidate: [...PAYROLL_KEY] },
  );
  const rows = acts.data?.items ?? [];
  return (
    <section className={card} aria-label="Notes" data-testid="tab-notes">
      <form
        className="mb-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          send.mutate(undefined, {
            onSuccess: () => {
              setText('');
              notice('Note added.', 'success');
            },
            onError: (err) => notice(errorMessage(err, PAYROLL_ERRORS), 'error'),
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <Select
            label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            options={KIND_OPTIONS}
          />
          <Textarea
            label="Internal note (never shown to the client)"
            value={text}
            rows={2}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={!text.trim() || send.isPending}>
          Add Note
        </Button>
      </form>
      {rows.length === 0 ? (
        <p className={quiet}>
          {empty(
            acts.isPending,
            acts.isError,
            'No notes or activity yet.',
            'Notes are not available right now.',
          )}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((a) => (
            <li key={a.id} className="border-t border-divider py-2 text-sm first:border-t-0">
              <p className="text-xs text-muted">
                {stamp(a.occurredAt)}
                {a.loggedBy ? ` · ${a.loggedBy.name}` : ''} ·{' '}
                {a.kind.charAt(0) + a.kind.slice(1).toLowerCase().replace(/_/g, ' ')}
              </p>
              <p className="text-heading">{a.summary}</p>
            </li>
          ))}
        </ul>
      )}
      {(acts.data?.total ?? 0) > page * 10 ? (
        <button type="button" className={`${subtle} mt-3`} onClick={() => setPage(page + 1)}>
          Show more
        </button>
      ) : null}
    </section>
  );
}

/** Communications: opens the shared Messages module. */
export function CommunicationsTab() {
  return (
    <section className={card} aria-label="Communications" data-testid="tab-communications">
      <h2 className="mb-2 font-display text-lg font-bold text-heading">Communications</h2>
      <p className="mb-3 text-sm text-text">
        Messages with this client are kept in Messages, with their full history.
      </p>
      <Link href="/messages" className={outlined}>
        <ChatCircleDots aria-hidden weight="fill" className="size-4" /> Open Messages
      </Link>
    </section>
  );
}

/** Settings: the schedule, provider, staff and plan of this client's payroll service, and its change history. */
export function SettingsTab({ w, notice }: { w: PayrollClientWorkspace; notice: Notice }) {
  const team = useApiQuery([...PAYROLL_KEY, 'members'], () => api.team.list());
  const changes = useApiQuery([...PAYROLL_KEY, 'changes', w.id], () =>
    api.payroll.changes(w.id, { pageSize: 10 }),
  );
  const [f, setF] = useState({
    frequency: w.frequency ?? '',
    provider: w.provider?.key ?? '',
    assignee: w.assignedTo?.userId ?? '',
    industry: w.industry ?? '',
    next: '',
    plan: w.plan ?? '',
  });
  const members = (team.data ?? []).filter((m) => m.status === 'ACTIVE');
  const save = useApiMutation(
    async () => {
      await api.payroll.updateClient(w.id, {
        ...(f.frequency ? { frequency: f.frequency as 'MONTHLY' } : {}),
        providerKey: f.provider || null,
        assignedUserId: f.assignee || null,
        industry: f.industry.trim() || null,
        ...(f.next ? { nextPayrollOn: f.next } : {}),
      });
      if ((w.plan ?? '') !== f.plan.trim())
        await api.payroll.setPlan(w.id, { plan: f.plan.trim() || null });
    },
    { invalidate: [...PAYROLL_KEY] },
  );
  const resume = useApiMutation(() => api.payroll.resume(w.id), { invalidate: [...PAYROLL_KEY] });
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2" data-testid="tab-settings">
      <section className={card} aria-label="Client payroll settings">
        <h2 className="mb-3 font-display text-lg font-bold text-heading">Payroll Settings</h2>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
          <Select
            label="Payroll frequency"
            value={f.frequency}
            onChange={(e) => setF({ ...f, frequency: e.target.value })}
            options={[{ value: '', label: 'Not set' }, ...FREQUENCY_OPTIONS]}
          />
          <Select
            label="Payroll provider"
            value={f.provider}
            onChange={(e) => setF({ ...f, provider: e.target.value })}
            options={[{ value: '', label: 'Not connected' }, ...PROVIDER_OPTIONS]}
          />
          <Select
            label="Assigned staff"
            value={f.assignee}
            onChange={(e) => setF({ ...f, assignee: e.target.value })}
            options={[
              { value: '', label: 'Unassigned' },
              ...(w.assignedTo && !members.some((m) => m.user.id === w.assignedTo?.userId)
                ? [{ value: w.assignedTo.userId, label: w.assignedTo.name }]
                : []),
              ...members.map((m) => ({ value: m.user.id, label: m.user.name })),
            ]}
          />
          <Input
            label="Industry"
            value={f.industry}
            maxLength={100}
            onChange={(e) => setF({ ...f, industry: e.target.value })}
          />
          <Input
            label="Plan or service"
            value={f.plan}
            maxLength={100}
            onChange={(e) => setF({ ...f, plan: e.target.value })}
          />
          <Input
            label="Next payroll date (override)"
            type="date"
            value={f.next}
            onChange={(e) => setF({ ...f, next: e.target.value })}
          />
          <div className="sm:col-span-2">
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate(undefined, {
                  onSuccess: () => notice('Settings saved.', 'success'),
                  onError: (e) => notice(errorMessage(e, PAYROLL_ERRORS), 'error'),
                })
              }
            >
              Save Settings
            </Button>
            <p className="mt-2 text-xs text-muted">
              Changing the frequency here updates Firmivra’s record. It does not change the
              provider’s own schedule.
            </p>
          </div>
        </form>
        {w.status === 'ON_HOLD' ? (
          <div className="mt-4 flex items-center gap-3 rounded-lg bg-warning-soft p-3 text-sm text-warning">
            This payroll service is on hold.
            <button
              type="button"
              className={subtle}
              onClick={() =>
                resume.mutate(undefined, {
                  onSuccess: () => notice('Payroll service resumed.', 'success'),
                })
              }
            >
              Resume
            </button>
          </div>
        ) : null}
      </section>
      <section className={card} aria-label="Change history" data-testid="change-history">
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-heading">
          Change History
        </h2>
        {(changes.data?.items ?? []).length === 0 ? (
          <p className={quiet}>
            {empty(
              changes.isPending,
              changes.isError,
              'No changes yet.',
              'Change history is not available right now.',
            )}
          </p>
        ) : (
          <ul className="flex flex-col">
            {(changes.data?.items ?? []).map((c) => (
              <li key={c.id} className="border-t border-divider py-2 text-sm first:border-t-0">
                <p className="text-xs text-muted">
                  {stamp(c.changedAt)}
                  {c.changedBy ? ` · ${c.changedBy.name}` : ''}
                </p>
                <p className="text-heading">
                  {c.field}: {c.oldValue ?? '—'} → {c.newValue ?? '—'}
                </p>
                {c.reason ? <p className="text-xs text-text">Reason: {c.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
