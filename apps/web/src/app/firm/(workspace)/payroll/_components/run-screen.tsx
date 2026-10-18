'use client';

import type { PayrollIssue, PayrollLinesQuery, PayrollRun, PayrollRunLine } from '@firmivra/types';
import {
  Badge,
  Button,
  Checkbox,
  type Column,
  Input,
  Modal,
  Select,
  Stepper,
  Table,
  Textarea,
  Toast,
} from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CheckCircle,
  ChartBar,
  FileText,
  FloppyDisk,
  Info,
  MagnifyingGlass,
  NotePencil,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Receipt,
  Warning,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  CardHead,
  FREQUENCY_LABEL,
  FREQUENCY_OPTIONS,
  LINE_STATUS_LABEL,
  PAYROLL_ERRORS,
  PAYROLL_KEY,
  RunStatusPill,
  WORKER_TYPE_LABEL,
  card,
  dayText,
  daysUntil,
  dollars,
  initials,
  money,
  outlined,
  periodText,
  quiet,
  stamp,
  subtle,
  toCents,
} from './payroll-shared';
import { WorkerDialog } from './worker-dialog';

const STEPS = [
  { id: '1', label: 'Payroll Period' },
  { id: '2', label: 'Employees & Hours' },
  { id: '3', label: 'Earnings & Deductions' },
  { id: '4', label: 'Taxes & Employer Costs' },
  { id: '5', label: 'Review & Approve' },
];
const LINE_TABS = [
  { id: 'ALL', label: 'All Employees' },
  { id: 'FULL_TIME', label: 'Full-Time' },
  { id: 'PART_TIME', label: 'Part-Time' },
  { id: 'ON_LEAVE', label: 'On Leave' },
  { id: 'CONTRACTORS', label: 'Contractors' },
] as const;
const SEVERITY = { ERROR: 'danger', WARNING: 'warning', INFO: 'neutral' } as const;

/** /payroll/runs/[id]: Run Payroll: period, employees and hours, the summary, exceptions, review and approval. */
export function RunScreen({ id }: { id: string }) {
  const runQ = useApiQuery([...PAYROLL_KEY, 'run', id], () => api.payroll.getRun(id));
  const run = runQ.data;
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const [dialog, setDialog] = useState<'submit' | 'reopen' | 'taxes' | 'add' | undefined>();
  const options = { invalidate: [...PAYROLL_KEY] };
  const fail = (e: unknown) => notice(errorMessage(e, PAYROLL_ERRORS), 'error');
  const ok = (text: string) => () => notice(text, 'success');
  const draft = useApiMutation(() => api.payroll.saveDraft(id), options);
  const ready = useApiMutation(() => api.payroll.markReady(id), options);
  const approve = useApiMutation(() => api.payroll.approve(id), options);
  const complete = useApiMutation(() => api.payroll.complete(id), options);
  const patch = useApiMutation(
    (body: Parameters<typeof api.payroll.updateRun>[1]) => api.payroll.updateRun(id, body),
    options,
  );
  const check = useApiMutation(() => api.payroll.checkRun(id), options);
  const a = run?.actions;
  const note = runQ.isPending ? 'Loading…' : 'This payroll run is not available right now.';

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="payroll-run">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={run ? `/payroll/clients/${run.payrollClientId}` : '/payroll'}
          aria-label="Back to the client"
          className="text-link"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/payroll" className="text-link">
          Payroll
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <Link href="/payroll" className="text-link">
          Clients
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        {run ? (
          <Link href={`/payroll/clients/${run.payrollClientId}`} className="text-link">
            {run.client.displayName}
          </Link>
        ) : (
          <span>Client</span>
        )}
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Run Payroll</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-success text-2xl font-bold text-on-action"
          >
            {run ? initials(run.client.displayName) : ''}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-bold text-heading" data-testid="run-title">
                {run?.client.displayName ?? 'Payroll run'}
              </h1>
              {run ? <RunStatusPill status={run.status} /> : null}
            </div>
            <p className="mt-1 text-sm text-text">
              {run ? (
                <>
                  Payroll Provider:{' '}
                  {run.provider ? `${run.provider.label} (Connected)` : 'Not connected'}
                  {run.figures.employeeCount !== null
                    ? ` · ${run.figures.employeeCount} Employees`
                    : ''}
                </>
              ) : (
                <span className="text-muted">{note}</span>
              )}
            </p>
          </div>
        </div>
        {run ? (
          <div className="flex flex-wrap items-stretch gap-3">
            <div className="rounded-xl bg-surface px-4 py-2 shadow-md" data-testid="run-period">
              <p className="text-xs text-text">Current Payroll Period</p>
              <p className="flex items-center gap-2 font-semibold text-heading">
                <CalendarCheck aria-hidden weight="fill" className="size-4 text-action" />
                {periodText(run.periodStart, run.periodEnd)}
              </p>
              <p className="text-xs text-muted">{FREQUENCY_LABEL[run.frequency]}</p>
            </div>
            <div className="rounded-xl bg-surface px-4 py-2 shadow-md" data-testid="run-paydate">
              <p className="text-xs text-text">Pay Date</p>
              <p className="font-semibold text-heading">{dayText(run.payDate)}</p>
              <p
                className={`text-xs ${daysUntil(run.payDate) < 0 ? 'text-danger' : 'text-success'}`}
              >
                {daysUntil(run.payDate) < 0
                  ? `${-daysUntil(run.payDate)} days past`
                  : daysUntil(run.payDate) === 0
                    ? 'Today'
                    : `In ${daysUntil(run.payDate)} days`}
              </p>
            </div>
            <Link href={`/payroll/clients/${run.payrollClientId}`} className={outlined}>
              View Client
            </Link>
          </div>
        ) : null}
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {run?.reopenReason ? (
        <p role="status" className="rounded-lg bg-info-soft p-3 text-sm text-info">
          Reopened: {run.reopenReason}
        </p>
      ) : null}

      <section className={card} aria-label="Run steps">
        <Stepper
          steps={STEPS}
          current={String(Math.min(5, Math.max(1, run?.step ?? 1)))}
          label="Payroll run steps"
          variant="wizard"
        />
      </section>

      {!run ? (
        <p className={`${card} ${quiet}`}>{note}</p>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <PeriodDetails
              run={run}
              onChange={(body) => patch.mutate(body, { onSuccess: ok('Saved.'), onError: fail })}
            />
            <Employees run={run} onAdd={() => setDialog('add')} notice={notice} />
            <div className="grid gap-4 lg:grid-cols-2">
              <RecentRuns run={run} />
              <RunNotes clientId={run.payrollClientId} notice={notice} />
            </div>
          </div>
          <aside className="flex min-w-0 flex-col gap-4" aria-label="Summary">
            <Summary run={run} onTaxes={() => setDialog('taxes')} />
            <Exceptions
              run={run}
              onCheck={() =>
                check.mutate(undefined, { onSuccess: ok('Checks run.'), onError: fail })
              }
              notice={notice}
            />
            <section className={card} aria-label="Next Steps" data-testid="next-steps">
              <CardHead icon={CheckCircle} title="Next Steps" />
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className={outlined}
                  disabled={!a?.canEdit || run.status === 'NOT_STARTED' || draft.isPending}
                  onClick={() =>
                    draft.mutate(undefined, { onSuccess: ok('Draft saved.'), onError: fail })
                  }
                >
                  <FloppyDisk aria-hidden weight="fill" className="size-4" /> Save Draft
                </button>
                <Link
                  href={`/payroll/clients/${run.payrollClientId}?tab=reports`}
                  className={outlined}
                >
                  <ChartBar aria-hidden weight="fill" className="size-4" /> Preview Payroll Reports
                </Link>
                <button
                  type="button"
                  className={outlined}
                  disabled={!a?.canMarkReady || ready.isPending}
                  onClick={() =>
                    ready.mutate(undefined, {
                      onSuccess: ok('Marked ready for review.'),
                      // A blocked review still found issues: show them.
                      onError: (e) => {
                        fail(e);
                        check.mutate();
                      },
                    })
                  }
                >
                  <CheckCircle aria-hidden weight="bold" className="size-4" /> Mark Ready for Review
                </button>
                {run.status === 'APPROVED' ? (
                  <button
                    type="button"
                    data-testid="submit-provider"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-success px-4 text-sm font-medium text-on-action hover:opacity-90"
                    onClick={() => setDialog('submit')}
                  >
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-4" /> Submit to
                    Provider
                  </button>
                ) : run.status === 'SUBMITTED' || run.status === 'PROCESSING' ? (
                  <button
                    type="button"
                    data-testid="complete-run"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-success px-4 text-sm font-medium text-on-action hover:opacity-90"
                    disabled={complete.isPending}
                    onClick={() =>
                      complete.mutate(undefined, {
                        onSuccess: ok('Payroll completed.'),
                        onError: fail,
                      })
                    }
                  >
                    <CheckCircle aria-hidden weight="fill" className="size-4" /> Mark Completed
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="approve-run"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-success px-4 text-sm font-medium text-on-action hover:opacity-90 disabled:opacity-50"
                    disabled={!a?.canApprove || approve.isPending}
                    onClick={() =>
                      approve.mutate(undefined, {
                        onSuccess: ok('Payroll approved. Submit it to the provider next.'),
                        onError: fail,
                      })
                    }
                  >
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-4" /> Approve Payroll
                  </button>
                )}
              </div>
              {run.providerConfirmation ? (
                <p className="mt-3 text-xs text-text" data-testid="provider-confirmation">
                  Provider confirmation {run.providerConfirmation}
                  {run.submittedAt ? `, submitted ${stamp(run.submittedAt)}` : ''}.
                </p>
              ) : null}
              {a?.canReopen ? (
                <button
                  type="button"
                  className={`${subtle} mt-3`}
                  onClick={() => setDialog('reopen')}
                >
                  Reopen
                </button>
              ) : null}
              {!a?.canApprove && run.status === 'READY_FOR_REVIEW' ? (
                <p className="mt-2 text-xs text-muted">Only an Admin or Owner can approve.</p>
              ) : null}
              {run.status === 'NOT_STARTED' ? (
                <p className="mt-2 text-xs text-muted">
                  Change a value below to start preparing this run.
                </p>
              ) : null}
            </section>
          </aside>
        </div>
      )}
      {run && dialog === 'submit' ? (
        <SubmitDialog
          id={id}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            notice('Submitted to the provider.', 'success');
          }}
        />
      ) : null}
      {run && dialog === 'reopen' ? (
        <ReopenDialog
          id={id}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            notice('Run reopened.', 'success');
          }}
        />
      ) : null}
      {run && dialog === 'taxes' ? (
        <TaxesDialog
          run={run}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            notice('Taxes saved.', 'success');
          }}
        />
      ) : null}
      {run && dialog === 'add' ? (
        <WorkerDialog
          payrollClientId={run.payrollClientId}
          onClose={() => setDialog(undefined)}
          onDone={async (text, saved) => {
            try {
              await api.payroll.saveRunLines(id, {
                lines: [
                  { workerId: saved.id, hours: 0, regularPayCents: 0, status: 'PENDING_CHANGE' },
                ],
              });
              notice(`${text} Review the new line before approval.`, 'success');
            } catch (e) {
              fail(e);
            }
            setDialog(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function PeriodDetails({
  run,
  onChange,
}: {
  run: PayrollRun;
  onChange: (body: {
    payDate?: string;
    frequency?: 'WEEKLY';
    includeContractors?: boolean;
  }) => void;
}) {
  const edit = run.actions.canEdit;
  return (
    <section className={card} aria-label="Payroll Period Details" data-testid="period-details">
      <CardHead
        icon={FileText}
        title="Payroll Period Details"
        aside={
          <Link href="/payroll" className="text-sm font-medium text-link">
            Payroll Settings
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Input label="Pay Period Start" type="date" value={run.periodStart} readOnly />
        <Input label="Pay Period End" type="date" value={run.periodEnd} readOnly />
        <Input
          label="Pay Date"
          type="date"
          value={run.payDate}
          disabled={!edit}
          onChange={(e) => e.target.value && onChange({ payDate: e.target.value })}
        />
        <Select
          label="Frequency"
          value={run.frequency}
          disabled={!edit}
          onChange={(e) => onChange({ frequency: e.target.value as 'WEEKLY' })}
          options={FREQUENCY_OPTIONS}
        />
        <Input label="Payroll Provider" value={run.provider?.label ?? 'Not connected'} readOnly />
      </div>
      <div className="mt-3">
        <Checkbox
          label="Include contractors in this run"
          checked={run.includeContractors}
          disabled={!edit}
          onChange={(e) => onChange({ includeContractors: e.target.checked })}
        />
      </div>
    </section>
  );
}

function Employees({
  run,
  onAdd,
  notice,
}: {
  run: PayrollRun;
  onAdd: () => void;
  notice: (t: string, tone: 'success' | 'error') => void;
}) {
  const [tab, setTab] = useState<NonNullable<PayrollLinesQuery['tab']>>('ALL');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<PayrollRunLine>();
  const list = useApiQuery([...PAYROLL_KEY, 'lines', run.id, tab, search, status, page], () =>
    api.payroll.runLines(run.id, {
      tab,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(status ? { status: status as 'READY' } : {}),
      page,
      pageSize: 10,
    }),
  );
  const rows = list.data?.items ?? [];
  const edit = run.actions.canEdit;
  const tone = {
    READY: 'success',
    WARNING: 'warning',
    ERROR: 'danger',
    PENDING_CHANGE: 'info',
    EXCLUDED: 'neutral',
  } as const;
  const columns: Column<PayrollRunLine>[] = [
    {
      id: 'name',
      label: 'Employee Name',
      cell: (l) => <span className="font-semibold text-link">{l.worker.displayName}</span>,
    },
    {
      id: 'type',
      label: 'Type',
      cell: (l) => (
        <span className="whitespace-nowrap">{WORKER_TYPE_LABEL[l.worker.workerType]}</span>
      ),
    },
    {
      id: 'rate',
      label: 'Pay Rate',
      cell: (l) =>
        l.worker.rateCents === null
          ? '—'
          : `${money(l.worker.rateCents)}${l.worker.payType === 'HOURLY' ? '/hr' : '/yr'}`,
    },
    { id: 'hours', label: 'Hours', cell: (l) => l.hours.toFixed(2) },
    { id: 'reg', label: 'Regular Pay', cell: (l) => money(l.regularPayCents) },
    { id: 'ot', label: 'Overtime', cell: (l) => money(l.overtimePayCents) },
    { id: 'other', label: 'Other Earnings', cell: (l) => money(l.otherEarningsCents) },
    { id: 'ded', label: 'Deductions', cell: (l) => `-${money(l.deductionsCents)}` },
    {
      id: 'total',
      label: 'Total Pay',
      cell: (l) => <span className="font-semibold">{money(l.totalPayCents)}</span>,
    },
    {
      id: 'status',
      label: 'Status',
      cell: (l) => <Badge tone={tone[l.status]}>{LINE_STATUS_LABEL[l.status]}</Badge>,
    },
  ];
  const lc = run.lineCounts;
  return (
    <section className={card} aria-label="Employees & Hours" data-testid="run-employees">
      <CardHead icon={FileText} title="Employees & Hours" />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav
          role="tablist"
          aria-label="Employee views"
          className="flex overflow-x-auto border-b border-divider"
        >
          {LINE_TABS.map((t) => (
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
              className="w-36 bg-transparent text-sm text-text outline-none"
            />
          </label>
          <div className="w-36">
            <Select
              label="Status"
              hideLabel
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Statuses' },
                ...Object.entries(LINE_STATUS_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
        </div>
      </div>
      <div className="relative">
        <Table
          rows={rows}
          columns={columns}
          rowKey={(l) => l.id}
          caption="Employees and hours"
          dense
          noun="employees"
          pageSize={10}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Employees are not available' : 'No employees in this run'}
          emptyText={
            list.isError
              ? 'We could not load the employees. Try again in a moment.'
              : 'Add an employee to this run.'
          }
          selection={{ selected, onChange: setSelected }}
          rowActions={(l) => (
            <button
              type="button"
              disabled={!edit}
              aria-label={`Edit ${l.worker.displayName}`}
              onClick={() => setEditing(l)}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-divider bg-surface text-heading hover:bg-canvas disabled:opacity-40"
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
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={outlined} disabled={!edit} onClick={onAdd}>
          <Plus aria-hidden weight="bold" className="size-4" /> Add Employee
        </button>
        <button
          type="button"
          className={outlined}
          disabled={!edit || selected.length !== 1}
          onClick={() => setEditing(rows.find((l) => l.id === selected[0]))}
        >
          <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit Selected
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3" data-testid="line-counts">
        <div className="rounded-xl bg-success-soft p-3">
          <p className="font-display text-2xl font-bold text-heading">{lc.error}</p>
          <p className="text-sm text-heading">Employees with Errors</p>
          <p className="text-xs text-text">
            {lc.error ? 'Resolve before review.' : 'All employees are valid.'}
          </p>
        </div>
        <div className="rounded-xl bg-warning-soft p-3">
          <p className="font-display text-2xl font-bold text-heading">{lc.warning}</p>
          <p className="text-sm text-heading">Warnings</p>
          <p className="text-xs text-text">Review before submitting.</p>
        </div>
        <div className="rounded-xl bg-info-soft p-3">
          <p className="font-display text-2xl font-bold text-heading">{lc.pendingChange}</p>
          <p className="text-sm text-heading">Pending Changes</p>
          <p className="text-xs text-text">New hires pending approval.</p>
        </div>
      </div>
      {editing ? (
        <LineDialog
          run={run}
          line={editing}
          onClose={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            setSelected([]);
            notice('Line saved.', 'success');
          }}
        />
      ) : null}
    </section>
  );
}

function LineDialog({
  run,
  line,
  onClose,
  onDone,
}: {
  run: PayrollRun;
  line: PayrollRunLine;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    hours: String(line.hours),
    regular: dollars(line.regularPayCents),
    overtime: dollars(line.overtimePayCents),
    other: dollars(line.otherEarningsCents),
    deductions: dollars(line.deductionsCents),
    status: line.status,
    note: line.note ?? '',
  });
  const send = useApiMutation(
    () =>
      api.payroll.saveRunLines(run.id, {
        lines: [
          {
            workerId: line.worker.id,
            hours: Number(f.hours || 0),
            regularPayCents: toCents(f.regular),
            overtimePayCents: toCents(f.overtime),
            otherEarningsCents: toCents(f.other),
            deductionsCents: toCents(f.deductions),
            status: f.status,
            note: f.note.trim() || null,
          },
        ],
      }),
    { invalidate: [...PAYROLL_KEY] },
  );
  return (
    <Modal
      open
      title={`Edit ${line.worker.displayName}`}
      subtitle="Hours, earnings and deductions for this run."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={send.isPending}
            onClick={() => send.mutate(undefined, { onSuccess: onDone })}
          >
            Save Line
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2" data-testid="line-form">
        <Input
          label="Hours"
          type="number"
          min={0}
          max={999.99}
          step="0.01"
          value={f.hours}
          onChange={(e) => setF({ ...f, hours: e.target.value })}
        />
        <Input
          label="Regular pay ($)"
          type="number"
          min={0}
          step="0.01"
          value={f.regular}
          onChange={(e) => setF({ ...f, regular: e.target.value })}
        />
        <Input
          label="Overtime ($)"
          type="number"
          min={0}
          step="0.01"
          value={f.overtime}
          onChange={(e) => setF({ ...f, overtime: e.target.value })}
        />
        <Input
          label="Other earnings ($)"
          type="number"
          min={0}
          step="0.01"
          value={f.other}
          onChange={(e) => setF({ ...f, other: e.target.value })}
        />
        <Input
          label="Deductions ($)"
          type="number"
          min={0}
          step="0.01"
          value={f.deductions}
          onChange={(e) => setF({ ...f, deductions: e.target.value })}
        />
        <Select
          label="Status"
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}
          options={Object.entries(LINE_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <div className="sm:col-span-2">
          <Input
            label="Note (optional)"
            value={f.note}
            maxLength={300}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </div>
        {send.isError ? (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {errorMessage(send.error, PAYROLL_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function SumRow({
  k,
  v,
  bold,
  tone,
}: {
  k: string;
  v: string;
  bold?: boolean;
  tone?: 'green' | 'blue';
}) {
  return (
    <div
      className={`flex justify-between py-1 text-sm ${tone === 'green' ? 'rounded-md bg-success-soft px-2 font-semibold' : tone === 'blue' ? 'rounded-md bg-info-soft px-2 text-base font-bold' : ''} ${bold ? 'font-semibold' : ''}`}
    >
      <dt className="text-heading">{k}</dt>
      <dd className="text-heading">{v}</dd>
    </div>
  );
}

function Summary({ run, onTaxes }: { run: PayrollRun; onTaxes: () => void }) {
  const f = run.figures;
  return (
    <section className={card} aria-label="Payroll Summary" data-testid="run-summary">
      <CardHead icon={FileText} title="Payroll Summary (Preview)" />
      {f.grossCents === null ? (
        <p className={quiet}>No figures yet. They appear once employees are in the run.</p>
      ) : (
        <dl>
          <SumRow k="Total Employees" v={String(f.employeeCount ?? '—')} />
          <SumRow k="Regular Pay" v={money(f.regularPayCents)} />
          <SumRow k="Overtime Pay" v={money(f.overtimePayCents)} />
          <SumRow k="Other Earnings" v={money(f.otherEarningsCents)} />
          <div className="my-1 border-t border-divider" />
          <SumRow k="Gross Payroll" v={money(f.grossCents)} bold />
          <SumRow k="Employee Taxes" v={`-${money(f.employeeTaxesCents)}`} />
          <SumRow k="Employee Deductions" v={`-${money(f.deductionsCents)}`} />
          <SumRow k="Net Payroll (Direct Deposit)" v={money(f.netCents)} tone="green" />
          <div className="my-1 border-t border-divider" />
          <SumRow k="Employer Taxes" v={money(f.employerTaxesCents)} />
          <SumRow k="Employer Benefits" v={money(f.employerBenefitsCents)} />
          <SumRow k="Total Employer Costs" v={money(f.employerCostsCents)} bold />
          <SumRow k="Total Payroll Cost" v={money(f.totalCostCents)} tone="blue" />
        </dl>
      )}
      {run.actions.canEdit && f.grossCents !== null ? (
        <button type="button" className={`${outlined} mt-3`} onClick={onTaxes}>
          <Receipt aria-hidden weight="fill" className="size-4" /> Edit Taxes &amp; Employer Costs
        </button>
      ) : null}
      <p className="mt-2 text-xs text-muted">
        {f.confirmed
          ? 'Confirmed by the provider.'
          : 'A preview from the lines above. Taxes are as entered or the provider’s, not calculated by Firmivra.'}
      </p>
    </section>
  );
}

function TaxesDialog({
  run,
  onClose,
  onDone,
}: {
  run: PayrollRun;
  onClose: () => void;
  onDone: () => void;
}) {
  const f = run.figures;
  const [v, setV] = useState({
    ee: dollars(f.employeeTaxesCents ?? 0),
    er: dollars(f.employerTaxesCents ?? 0),
    ben: dollars(f.employerBenefitsCents ?? 0),
  });
  const send = useApiMutation(
    () =>
      api.payroll.updateRun(run.id, {
        employeeTaxesCents: toCents(v.ee),
        employerTaxesCents: toCents(v.er),
        employerBenefitsCents: toCents(v.ben),
        step: 4,
      }),
    { invalidate: [...PAYROLL_KEY] },
  );
  return (
    <Modal
      open
      title="Taxes & Employer Costs"
      subtitle="Enter the amounts the provider reports. Firmivra does not calculate payroll taxes."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={send.isPending}
            onClick={() => send.mutate(undefined, { onSuccess: onDone })}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="taxes-form">
        <Input
          label="Employee taxes ($)"
          type="number"
          min={0}
          step="0.01"
          value={v.ee}
          onChange={(e) => setV({ ...v, ee: e.target.value })}
        />
        <Input
          label="Employer taxes ($)"
          type="number"
          min={0}
          step="0.01"
          value={v.er}
          onChange={(e) => setV({ ...v, er: e.target.value })}
        />
        <Input
          label="Employer benefits ($)"
          type="number"
          min={0}
          step="0.01"
          value={v.ben}
          onChange={(e) => setV({ ...v, ben: e.target.value })}
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

function Exceptions({
  run,
  onCheck,
  notice,
}: {
  run: PayrollRun;
  onCheck: () => void;
  notice: (t: string, tone: 'success' | 'error') => void;
}) {
  const issues = useApiQuery([...PAYROLL_KEY, 'issues', run.id, run.updatedAt], () =>
    api.payroll.runIssues(run.id),
  );
  const resolve = useApiMutation(
    (v: { id: string; resolved: boolean }) =>
      api.payroll.resolveIssue(run.id, v.id, { resolved: v.resolved }),
    { invalidate: [...PAYROLL_KEY] },
  );
  const rows: PayrollIssue[] = issues.data?.items ?? [];
  const icon = { ERROR: WarningCircle, WARNING: Warning, INFO: Info } as const;
  return (
    <section className={card} aria-label="Exceptions & Alerts" data-testid="run-issues">
      <CardHead
        icon={Warning}
        title="Exceptions & Alerts"
        aside={
          <button type="button" onClick={onCheck} className="text-sm font-medium text-link">
            Run checks
          </button>
        }
      />
      {rows.length === 0 ? (
        <p className={quiet}>
          {issues.isPending
            ? 'Loading…'
            : issues.isError
              ? 'Exceptions are not available right now.'
              : 'No exceptions. Run checks to look again.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((i) => {
            const Glyph = icon[i.severity];
            return (
              <li
                key={i.id}
                className="flex items-start gap-2 border-t border-divider py-2 text-sm first:border-t-0"
              >
                <Glyph
                  aria-hidden
                  weight="fill"
                  className={`mt-0.5 size-4 shrink-0 ${i.severity === 'ERROR' ? 'text-danger' : i.severity === 'WARNING' ? 'text-warning' : 'text-muted'}`}
                />
                <span
                  className={`min-w-0 flex-1 ${i.resolvedAt ? 'text-muted line-through' : 'text-heading'}`}
                >
                  {i.message}
                </span>
                {run.actions.canEdit ? (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-medium text-link"
                    onClick={() =>
                      resolve.mutate(
                        { id: i.id, resolved: !i.resolvedAt },
                        { onError: (e) => notice(errorMessage(e, PAYROLL_ERRORS), 'error') },
                      )
                    }
                  >
                    {i.resolvedAt ? 'Reopen' : 'Resolve'}
                    <span className="sr-only"> {i.message}</span>
                  </button>
                ) : (
                  <Badge tone={SEVERITY[i.severity]}>{i.severity.toLowerCase()}</Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RecentRuns({ run }: { run: PayrollRun }) {
  return (
    <section className={card} aria-label="Recent Payroll Runs" data-testid="run-recent">
      <CardHead
        icon={CalendarCheck}
        title="Recent Payroll Runs"
        aside={
          <Link
            href={`/payroll/clients/${run.payrollClientId}?tab=runs`}
            className="inline-flex items-center gap-1 text-sm font-medium text-link"
          >
            View All <ArrowRight aria-hidden weight="bold" className="size-3" />
          </Link>
        }
      />
      {run.recentRuns.length === 0 ? (
        <p className={quiet}>No completed runs yet.</p>
      ) : (
        <ul className="flex flex-col">
          {run.recentRuns.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 border-t border-divider py-2 text-sm first:border-t-0"
            >
              <Link
                href={`/payroll/runs/${r.id}`}
                className="min-w-0 truncate text-link hover:underline"
              >
                {periodText(r.periodStart, r.periodEnd)}
              </Link>
              <span className="shrink-0 text-xs text-muted">{money(r.totalCostCents)}</span>
              <RunStatusPill status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RunNotes({
  clientId,
  notice,
}: {
  clientId: string;
  notice: (t: string, tone: 'success' | 'error') => void;
}) {
  const acts = useApiQuery([...PAYROLL_KEY, 'activities', clientId, 'run'], () =>
    api.payroll.activities(clientId, { pageSize: 3 }),
  );
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const send = useApiMutation(
    () => api.payroll.logActivity(clientId, { kind: 'OTHER', summary: text.trim() }),
    { invalidate: [...PAYROLL_KEY] },
  );
  const rows = acts.data?.items ?? [];
  return (
    <section className={card} aria-label="Payroll Notes" data-testid="run-notes">
      <CardHead icon={NotePencil} title="Payroll Notes" />
      {rows.length === 0 ? (
        <p className={quiet}>
          {acts.isPending
            ? 'Loading…'
            : acts.isError
              ? 'Notes are not available right now.'
              : 'No notes yet.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((n) => (
            <li key={n.id} className="border-t border-divider py-2 text-sm first:border-t-0">
              <p className="text-xs text-muted">
                {dayText(n.occurredAt.slice(0, 10))}
                {n.loggedBy ? ` · ${n.loggedBy.name}` : ''}
              </p>
              <p className="text-heading">{n.summary}</p>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            send.mutate(undefined, {
              onSuccess: () => {
                setText('');
                setOpen(false);
                notice('Note added.', 'success');
              },
              onError: (err) => notice(errorMessage(err, PAYROLL_ERRORS), 'error'),
            });
          }}
        >
          <Textarea
            label="Internal note"
            value={text}
            rows={2}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={!text.trim() || send.isPending}>
              Save Note
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <button type="button" className={`${outlined} mt-3`} onClick={() => setOpen(true)}>
          <Plus aria-hidden weight="bold" className="size-4" /> Add Note
        </button>
      )}
    </section>
  );
}

function SubmitDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [conf, setConf] = useState('');
  const send = useApiMutation(() => api.payroll.submit(id, { providerConfirmation: conf.trim() }), {
    invalidate: [...PAYROLL_KEY],
  });
  return (
    <Modal
      open
      title="Submit to Provider"
      subtitle="Submit the payroll in the provider, then enter the confirmation it gives you."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!conf.trim() || send.isPending}
            onClick={() => send.mutate(undefined, { onSuccess: onDone })}
          >
            Record Submission
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="submit-form">
        <Input
          label="Provider confirmation"
          value={conf}
          maxLength={100}
          onChange={(e) => setConf(e.target.value)}
        />
        <p className="text-xs text-muted">
          Firmivra records the approval and the provider’s confirmation. The payroll itself is
          processed by the provider.
        </p>
        {send.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, PAYROLL_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function ReopenDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const send = useApiMutation(() => api.payroll.reopen(id, { reason: reason.trim() }), {
    invalidate: [...PAYROLL_KEY],
  });
  return (
    <Modal
      open
      title="Reopen Run"
      subtitle="The reason is kept in the audit trail."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim() || send.isPending}
            onClick={() => send.mutate(undefined, { onSuccess: onDone })}
          >
            Reopen
          </Button>
        </>
      }
    >
      <Textarea
        label="Why is it being reopened?"
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
      />
      {send.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(send.error, PAYROLL_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}
