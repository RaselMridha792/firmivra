'use client';

import type { PayrollClientWorkspace, PayrollRunRow } from '@firmivra/types';
import { Badge, type Column, Table, Toast } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartBar,
  CurrencyDollar,
  FileText,
  Folder,
  ListChecks,
  Plus,
  Receipt,
  Users,
  UserPlus,
  Wallet,
  DotsThreeVertical,
  Plugs,
  ArrowsClockwise,
  Play,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { ClientActionMenu } from './client-actions';
import {
  CardHead,
  ClientStatusPill,
  FREQUENCY_LABEL,
  PAYROLL_ERRORS,
  PAYROLL_KEY,
  RunStatusPill,
  WORKER_STATUS_LABEL,
  WORKER_TYPE_LABEL,
  card,
  dayText,
  initials,
  linkBtn,
  money,
  outlined,
  periodText,
  quiet,
  stamp,
  subtle,
} from './payroll-shared';
import { WorkerDialog } from './worker-dialog';
import {
  DocumentsTab,
  EmployeesTab,
  FilingsTab,
  NotesTab,
  ReportsTab,
  RunsTab,
  SettingsTab,
  TasksTab,
  CommunicationsTab,
} from './workspace-tabs';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'employees', label: 'Employees' },
  { id: 'runs', label: 'Payroll Runs' },
  { id: 'filings', label: 'Tax Filings' },
  { id: 'reports', label: 'Reports' },
  { id: 'documents', label: 'Documents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'notes', label: 'Notes' },
  { id: 'communications', label: 'Communications' },
  { id: 'settings', label: 'Settings' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** /payroll/clients/[id]: one payroll client's workspace, in ten tabs. */
export function ClientWorkspaceScreen({ id, tab }: { id: string; tab: string | undefined }) {
  const router = useRouter();
  const ws = useApiQuery([...PAYROLL_KEY, 'client', id], () => api.payroll.getClient(id));
  const all = useApiQuery([...PAYROLL_KEY, 'order'], () => api.payroll.clients({ pageSize: 100 }));
  const [current, setCurrent] = useState<TabId>(
    (TABS.find((t) => t.id === tab)?.id ?? 'overview') as TabId,
  );
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [adding, setAdding] = useState<'FULL_TIME' | 'CONTRACTOR'>();
  const w = ws.data;
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const ids = (all.data?.items ?? []).map((c) => c.id);
  const at = ids.indexOf(id);
  const step = (d: number) => {
    const next = ids[at + d];
    if (next) router.push(`/payroll/clients/${next}`);
  };
  const create = useApiMutation(
    (v: { run: PayrollRunRow }) =>
      api.payroll.createRun(id, {
        periodStart: v.run.periodStart,
        periodEnd: v.run.periodEnd,
        payDate: v.run.payDate,
        frequency: v.run.frequency,
        includeContractors: true,
        start: true,
      }),
    { invalidate: [...PAYROLL_KEY] },
  );
  const runPayroll = () => {
    if (!w) return;
    if (w.currentRun) return router.push(`/payroll/runs/${w.currentRun.id}`);
    const next = w.upcomingRuns.find((r) => r.status === 'NOT_STARTED');
    if (!next) return notice('There is no run to start for this client.', 'error');
    create.mutate(
      { run: next },
      {
        onSuccess: (r) => router.push(`/payroll/runs/${r.id}`),
        onError: (e) => notice(errorMessage(e, PAYROLL_ERRORS), 'error'),
      },
    );
  };
  const why = !w
    ? ''
    : !w.provider
      ? 'Connect a payroll provider to run payroll.'
      : w.status === 'ON_HOLD'
        ? 'The payroll service is on hold.'
        : '';

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="payroll-client">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/payroll" aria-label="Back to Payroll" className="text-link">
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
        <span className="font-semibold text-heading">{w?.client.displayName ?? 'Client'}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-success text-2xl font-bold text-on-action"
          >
            {w ? initials(w.client.displayName) : ''}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1
                className="font-display text-3xl font-bold text-heading"
                data-testid="client-title"
              >
                {w?.client.displayName ?? 'Payroll client'}
              </h1>
              {w ? <ClientStatusPill status={w.status} /> : null}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text">
              {w ? (
                <>
                  {w.industry ? <span>{w.industry}</span> : null}
                  <span>{w.employeeCount ?? '—'} Employees</span>
                  <span>
                    {w.frequency ? `${FREQUENCY_LABEL[w.frequency]} Payroll` : 'Frequency not set'}
                  </span>
                  {w.serviceSince ? <span>Client Since: {dayText(w.serviceSince)}</span> : null}
                </>
              ) : (
                <span className="text-muted">
                  {ws.isError ? 'This payroll client is not available right now.' : 'Loading…'}
                </span>
              )}
            </p>
          </div>
        </div>
        {w ? (
          <div className="flex flex-wrap items-center gap-3">
            <ClientActionMenu
              client={{
                id: w.id,
                client: w.client,
                provider: w.provider,
                status: w.status,
                frequency: w.frequency,
                assignedTo: w.assignedTo,
              }}
              label="Client Actions"
              onNotice={notice}
              trigger={
                <span className="inline-flex items-center gap-2 text-sm font-medium text-action">
                  Client Actions <CaretDown aria-hidden weight="bold" className="size-3" />
                </span>
              }
            />
            <div className="flex">
              <button
                type="button"
                aria-label="Previous client"
                disabled={at <= 0}
                onClick={() => step(-1)}
                className="flex size-10 items-center justify-center rounded-l-lg border border-action text-action disabled:opacity-40"
              >
                <CaretLeft aria-hidden weight="bold" className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Next client"
                disabled={at < 0 || at >= ids.length - 1}
                onClick={() => step(1)}
                className="flex size-10 items-center justify-center rounded-r-lg border border-l-0 border-action text-action disabled:opacity-40"
              >
                <CaretRight aria-hidden weight="bold" className="size-4" />
              </button>
            </div>
            <div className="text-sm" data-testid="next-payroll">
              <p className="text-text">Next Payroll Date</p>
              <p className="flex items-center gap-2 font-display text-xl font-bold text-heading">
                <CalendarCheck aria-hidden weight="fill" className="size-5 text-action" />
                {w.nextPayrollOn ? dayText(w.nextPayrollOn) : '—'}
              </p>
              {w.nextPayrollSource ? (
                <p className="text-xs text-muted">
                  From the {w.nextPayrollSource === 'provider' ? 'provider' : 'schedule'}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              data-testid="run-payroll"
              disabled={Boolean(why) || create.isPending}
              title={why || undefined}
              onClick={runPayroll}
              className="inline-flex min-h-12 items-center gap-2 rounded-control bg-action px-6 text-base font-medium text-on-action hover:bg-action-hover disabled:opacity-50"
            >
              <Play aria-hidden weight="fill" className="size-5" />{' '}
              {w.currentRun ? 'Continue Payroll' : 'Run Payroll'}
            </button>
          </div>
        ) : null}
      </header>
      {why ? <p className="text-right text-xs text-muted">{why}</p> : null}
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <nav
        aria-label="Payroll client tabs"
        role="tablist"
        className="flex overflow-x-auto border-b border-divider"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={current === t.id}
            onClick={() => setCurrent(t.id)}
            className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${current === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {current === 'overview' ? (
        <Overview
          w={w}
          failed={ws.isError}
          pending={ws.isPending}
          onTab={setCurrent}
          onAdd={setAdding}
          notice={notice}
        />
      ) : null}
      {current === 'employees' ? <EmployeesTab id={id} onAdd={setAdding} notice={notice} /> : null}
      {current === 'runs' ? <RunsTab id={id} /> : null}
      {current === 'filings' ? <FilingsTab id={id} /> : null}
      {current === 'reports' ? <ReportsTab id={id} /> : null}
      {current === 'documents' ? <DocumentsTab clientId={w?.client.id} /> : null}
      {current === 'tasks' ? <TasksTab clientId={w?.client.id} /> : null}
      {current === 'notes' ? <NotesTab id={id} notice={notice} /> : null}
      {current === 'communications' ? <CommunicationsTab /> : null}
      {current === 'settings' && w ? <SettingsTab w={w} notice={notice} /> : null}
      {adding ? (
        <WorkerDialog
          payrollClientId={id}
          defaultType={adding}
          onClose={() => setAdding(undefined)}
          onDone={(text) => {
            setAdding(undefined);
            notice(text, 'success');
          }}
        />
      ) : null}
    </div>
  );
}

function Stat({
  icon: Glyph,
  title,
  tone = 'info',
  children,
  testId,
}: {
  icon: typeof Users;
  title: string;
  tone?: 'info' | 'success';
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className={`${card} flex flex-col gap-1`} data-testid={testId}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-heading">
        <span
          aria-hidden
          className={`flex size-8 items-center justify-center rounded-full ${tone === 'success' ? 'bg-success-soft text-success' : 'bg-info-soft text-action'}`}
        >
          <Glyph weight="fill" className="size-4" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const trend = (p: number | null | undefined, label = 'vs. last payroll') =>
  p === null || p === undefined ? (
    <p className="text-xs text-muted">No earlier run to compare</p>
  ) : (
    <p className="text-xs text-muted">
      <span
        className={`mr-1 rounded-md px-1.5 py-0.5 font-semibold ${p >= 0 ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
      >
        {p >= 0 ? '↑' : '↓'} {Math.abs(p)}%
      </span>
      {label}
    </p>
  );

function Overview({
  w,
  failed,
  pending,
  onTab,
  onAdd,
  notice,
}: {
  w: PayrollClientWorkspace | undefined;
  failed: boolean;
  pending: boolean;
  onTab: (t: TabId) => void;
  onAdd: (t: 'FULL_TIME' | 'CONTRACTOR') => void;
  notice: (text: string, tone: 'success' | 'error') => void;
}) {
  const router = useRouter();
  const sync = useApiMutation(() => api.payroll.sync(w?.id as string), {
    invalidate: [...PAYROLL_KEY],
  });
  const note = pending ? 'Loading…' : failed ? 'This is not available right now.' : '';
  const f = w?.latestRun?.figures;
  const ch = w?.latestRun?.changeVsPrevious;
  const runCols: Column<PayrollRunRow>[] = [
    {
      id: 'period',
      label: 'Pay Period',
      cell: (r) => (
        <Link href={`/payroll/runs/${r.id}`} className="text-link hover:underline">
          {periodText(r.periodStart, r.periodEnd)}
        </Link>
      ),
    },
    { id: 'pay', label: 'Pay Date', cell: (r) => dayText(r.payDate) },
    { id: 'freq', label: 'Frequency', cell: (r) => FREQUENCY_LABEL[r.frequency] },
    { id: 'status', label: 'Status', cell: (r) => <RunStatusPill status={r.status} /> },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="client-overview">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Stat icon={FileText} title="Payroll Provider" testId="stat-provider">
          {w ? (
            <>
              <p className="flex items-center gap-2 font-display text-xl font-bold text-heading">
                {w.provider?.label ?? 'Not connected'}
                {w.provider ? (
                  <Badge tone="success">Connected</Badge>
                ) : (
                  <Badge tone="neutral">Not Connected</Badge>
                )}
              </p>
              <p className="text-xs text-muted">
                {w.lastSyncedAt ? `Last Sync: ${stamp(w.lastSyncedAt)}` : 'Not synced yet'}
                {w.syncStatus === 'STALE' ? ' (stale)' : ''}
              </p>
              {w.provider ? (
                <button
                  type="button"
                  disabled={sync.isPending}
                  onClick={() =>
                    sync.mutate(undefined, {
                      onSuccess: () => notice('Sync queued.', 'success'),
                      onError: (e) => notice(errorMessage(e, PAYROLL_ERRORS), 'error'),
                    })
                  }
                  className={`${outlined} mt-1 w-fit`}
                >
                  <ArrowsClockwise aria-hidden weight="bold" className="size-4" /> Sync Now
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onTab('settings')}
                  className={`${outlined} mt-1 w-fit`}
                >
                  <Plugs aria-hidden weight="fill" className="size-4" /> Connect Provider
                </button>
              )}
            </>
          ) : (
            <p className={quiet}>{note}</p>
          )}
        </Stat>
        <Stat icon={CalendarCheck} title="Current Period" testId="stat-period">
          {w ? (
            <>
              <p className="text-sm font-semibold text-heading">
                {w.currentRun
                  ? periodText(w.currentRun.periodStart, w.currentRun.periodEnd)
                  : w.upcomingRuns[0]
                    ? periodText(w.upcomingRuns[0].periodStart, w.upcomingRuns[0].periodEnd)
                    : 'No period yet'}
              </p>
              <p className="flex items-center gap-2 text-sm text-text">
                Status:{' '}
                {w.currentRun ? (
                  <RunStatusPill status={w.currentRun.status} />
                ) : (
                  <RunStatusPill status="NOT_STARTED" />
                )}
              </p>
              <p className="text-sm text-text">
                Pay Date:{' '}
                {(w.currentRun ?? w.upcomingRuns[0])
                  ? dayText((w.currentRun ?? w.upcomingRuns[0])!.payDate)
                  : '—'}
              </p>
            </>
          ) : (
            <p className={quiet}>{note}</p>
          )}
        </Stat>
        <Stat icon={Users} title="Total Employees" testId="stat-employees">
          {w ? (
            <>
              <p className="font-display text-3xl font-bold text-heading">
                {w.employeeCount ?? '—'}
              </p>
              <p className="text-xs text-text">
                {w.workers.fullTime} Full-Time · {w.workers.partTime} Part-Time ·{' '}
                {w.workers.contractors} Contractors
              </p>
            </>
          ) : (
            <p className={quiet}>{note}</p>
          )}
        </Stat>
        <Stat icon={CurrencyDollar} title="Gross Payroll" testId="stat-gross">
          {w ? (
            <>
              <p className="font-display text-3xl font-bold text-heading">
                {money(f?.grossCents, 0)}
              </p>
              {f ? (
                trend(ch?.grossPercent)
              ) : (
                <p className="text-xs text-muted">No confirmed run yet</p>
              )}
            </>
          ) : (
            <p className={quiet}>{note}</p>
          )}
        </Stat>
        <Stat icon={Receipt} title="Total Taxes (EE + ER)" testId="stat-taxes">
          {w ? (
            <>
              <p className="font-display text-3xl font-bold text-heading">
                {f && f.employeeTaxesCents !== null && f.employerTaxesCents !== null
                  ? money(f.employeeTaxesCents + f.employerTaxesCents, 0)
                  : '—'}
              </p>
              {f ? (
                trend(ch?.taxesPercent)
              ) : (
                <p className="text-xs text-muted">No confirmed run yet</p>
              )}
            </>
          ) : (
            <p className={quiet}>{note}</p>
          )}
        </Stat>
        <Stat icon={Wallet} title="Net Payroll" testId="stat-net">
          {w ? (
            <>
              <p className="font-display text-3xl font-bold text-heading">
                {money(f?.netCents, 0)}
              </p>
              {f ? (
                trend(ch?.netPercent)
              ) : (
                <p className="text-xs text-muted">No confirmed run yet</p>
              )}
            </>
          ) : (
            <p className={quiet}>{note}</p>
          )}
        </Stat>
      </div>

      <div
        className="flex flex-wrap gap-3"
        role="group"
        aria-label="Quick actions"
        data-testid="quick-actions"
      >
        <button type="button" className={outlined} onClick={() => onAdd('FULL_TIME')}>
          <UserPlus aria-hidden weight="fill" className="size-4" /> Add Employee
        </button>
        <button type="button" className={outlined} onClick={() => onAdd('CONTRACTOR')}>
          <Users aria-hidden weight="fill" className="size-4" /> Add Contractor
        </button>
        <Link href="/modules/document-requests" className={outlined}>
          <FileText aria-hidden weight="fill" className="size-4" /> Request Documents
        </Link>
        <Link href="/tasks/new" className={outlined}>
          <Plus aria-hidden weight="bold" className="size-4" /> Create Task
        </Link>
        <button type="button" className={outlined} onClick={() => onTab('reports')}>
          <ChartBar aria-hidden weight="fill" className="size-4" /> View Reports
        </button>
        <button type="button" className={outlined} onClick={() => onTab('filings')}>
          <Receipt aria-hidden weight="fill" className="size-4" /> View Tax Filings
        </button>
        {w ? (
          <ClientActionMenu
            client={{
              id: w.id,
              client: w.client,
              provider: w.provider,
              status: w.status,
              frequency: w.frequency,
              assignedTo: w.assignedTo,
            }}
            label="More Actions"
            onNotice={notice}
            trigger={
              <span className="inline-flex items-center gap-2 text-sm font-medium text-action">
                <DotsThreeVertical aria-hidden weight="bold" className="size-4" /> More Actions{' '}
                <CaretDown aria-hidden weight="bold" className="size-3" />
              </span>
            }
          />
        ) : null}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <section className={card} data-testid="panel-upcoming" aria-label="Upcoming Payroll Runs">
          <CardHead
            icon={CalendarCheck}
            title="Upcoming Payroll Runs"
            aside={
              <button type="button" className={linkBtn} onClick={() => onTab('runs')}>
                View All <ArrowRight aria-hidden weight="bold" className="size-3" />
              </button>
            }
          />
          <div className="relative">
            <Table
              rows={w?.upcomingRuns ?? []}
              columns={runCols}
              rowKey={(r) => r.id}
              caption="Upcoming payroll runs"
              dense
              noun="runs"
              pageSize={4}
              loading={pending}
              emptyTitle={failed ? 'Runs are not available' : 'No upcoming runs'}
              emptyText={
                failed
                  ? 'We could not load the runs. Try again in a moment.'
                  : 'Set a frequency and connect a provider to see the schedule.'
              }
              rowActions={(r) => (
                <button
                  type="button"
                  aria-label={`Open ${periodText(r.periodStart, r.periodEnd)}`}
                  onClick={() => router.push(`/payroll/runs/${r.id}`)}
                  className={subtle}
                >
                  Open
                </button>
              )}
            />
          </div>
          {w?.upcomingRuns.length ? (
            <p className="mt-2 text-xs text-muted">
              Schedule source:{' '}
              {w.nextPayrollSource === 'provider' ? 'the provider' : 'the firm’s schedule'}.
            </p>
          ) : null}
        </section>
        <section className={card} data-testid="panel-latest" aria-label="Latest Payroll Run">
          <CardHead
            icon={FileText}
            title="Latest Payroll Run"
            aside={
              w?.latestRun ? (
                <Link href={`/payroll/runs/${w.latestRun.run.id}`} className={linkBtn}>
                  View Details
                </Link>
              ) : null
            }
          />
          {w?.latestRun && f ? (
            <>
              <p className="mb-2 flex items-center gap-2 text-sm text-text">
                {periodText(w.latestRun.run.periodStart, w.latestRun.run.periodEnd)}{' '}
                <RunStatusPill status={w.latestRun.run.status} />
              </p>
              <dl className="text-sm">
                {(
                  [
                    ['Gross Payroll', money(f.grossCents)],
                    ['Employee Taxes', money(f.employeeTaxesCents)],
                    ['Employer Taxes', money(f.employerTaxesCents)],
                    ['Deductions', money(f.deductionsCents)],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between border-t border-divider py-1.5 first:border-t-0"
                  >
                    <dt className="text-text">{k}</dt>
                    <dd className="text-heading">{v}</dd>
                  </div>
                ))}
                <div className="mt-1 flex justify-between rounded-md bg-success-soft px-2 py-1.5 font-semibold text-heading">
                  <dt>Net Payroll</dt>
                  <dd>{money(f.netCents)}</dd>
                </div>
              </dl>
              <button type="button" onClick={() => onTab('reports')} className={`${outlined} mt-3`}>
                View Report
              </button>
            </>
          ) : (
            <p className={quiet}>
              {pending
                ? 'Loading…'
                : failed
                  ? 'The latest run is not available right now.'
                  : 'No confirmed payroll run yet.'}
            </p>
          )}
        </section>
        <OverviewTasks clientId={w?.client.id} onAll={() => onTab('tasks')} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <section
          className={`${card} lg:col-span-1`}
          data-testid="panel-workers"
          aria-label="Employees & Recent Changes"
        >
          <CardHead
            icon={Users}
            title="Employees & Recent Changes"
            aside={
              <button type="button" className={linkBtn} onClick={() => onTab('employees')}>
                View All <ArrowRight aria-hidden weight="bold" className="size-3" />
              </button>
            }
          />
          {w && w.recentWorkers.length > 0 ? (
            <ul className="flex flex-col">
              {w.recentWorkers.map((x) => (
                <li
                  key={x.id}
                  className="flex items-center justify-between gap-2 border-t border-divider py-2 text-sm first:border-t-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-heading">
                      {x.displayName}
                    </span>
                    <span className="text-xs text-muted">
                      {WORKER_TYPE_LABEL[x.workerType]} · {x.lastChangeNote ?? 'No changes'}
                    </span>
                  </span>
                  <Badge
                    tone={
                      x.status === 'ACTIVE'
                        ? 'success'
                        : x.status === 'ON_LEAVE'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {WORKER_STATUS_LABEL[x.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>
              {pending
                ? 'Loading…'
                : failed
                  ? 'Employees are not available right now.'
                  : 'No employees are on file yet.'}
            </p>
          )}
          <button type="button" className={`${outlined} mt-3`} onClick={() => onAdd('FULL_TIME')}>
            <Plus aria-hidden weight="bold" className="size-4" /> Add Employee
          </button>
        </section>
        <OverviewDocuments clientId={w?.client.id} onAll={() => onTab('documents')} />
        <OverviewNotes id={w?.id} onAll={() => onTab('notes')} />
      </div>
    </div>
  );
}

function OverviewTasks({ clientId, onAll }: { clientId: string | undefined; onAll: () => void }) {
  const tasks = useApiQuery([...PAYROLL_KEY, 'tasks', clientId ?? ''], async () =>
    clientId
      ? api.taskWork.overview({ view: 'all', status: 'OPEN', clientId, pageSize: 5 })
      : { items: [] },
  );
  const rows = tasks.data?.items ?? [];
  return (
    <section className={card} data-testid="panel-tasks" aria-label="Payroll Tasks">
      <CardHead
        icon={ListChecks}
        title="Payroll Tasks"
        aside={
          <button type="button" className={linkBtn} onClick={onAll}>
            View All <ArrowRight aria-hidden weight="bold" className="size-3" />
          </button>
        }
      />
      {rows.length === 0 ? (
        <p className={quiet}>
          {tasks.isError
            ? 'Tasks are not available right now.'
            : tasks.isPending
              ? 'Loading…'
              : 'No open tasks for this client.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 border-t border-divider py-2 text-sm first:border-t-0"
            >
              <Link href={`/tasks/${t.id}`} className="min-w-0 truncate text-link hover:underline">
                {t.title}
              </Link>
              <span className="shrink-0 text-xs text-muted">
                {t.dueOn ? dayText(t.dueOn) : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/tasks/new" className={`${outlined} mt-3`}>
        <Plus aria-hidden weight="bold" className="size-4" /> Add Task
      </Link>
    </section>
  );
}

function OverviewDocuments({
  clientId,
  onAll,
}: {
  clientId: string | undefined;
  onAll: () => void;
}) {
  const docs = useApiQuery([...PAYROLL_KEY, 'documents', clientId ?? ''], async () =>
    clientId ? api.documents.list(clientId) : { items: [] },
  );
  const rows = (docs.data?.items ?? []).slice(0, 5);
  return (
    <section className={card} data-testid="panel-documents" aria-label="Documents">
      <CardHead
        icon={Folder}
        title="Documents"
        aside={
          <button type="button" className={linkBtn} onClick={onAll}>
            View All <ArrowRight aria-hidden weight="bold" className="size-3" />
          </button>
        }
      />
      {rows.length === 0 ? (
        <p className={quiet}>
          {docs.isError
            ? 'Documents are not available right now.'
            : docs.isPending
              ? 'Loading…'
              : 'No documents yet.'}
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
      {clientId ? (
        <Link href={`/clients/${clientId}/documents`} className={`${outlined} mt-3`}>
          Upload Document
        </Link>
      ) : null}
    </section>
  );
}

function OverviewNotes({ id, onAll }: { id: string | undefined; onAll: () => void }) {
  const acts = useApiQuery([...PAYROLL_KEY, 'activities', id ?? ''], async () =>
    id ? api.payroll.activities(id, { pageSize: 3 }) : { items: [] },
  );
  const rows = acts.data?.items ?? [];
  return (
    <section className={card} data-testid="panel-notes" aria-label="Notes & Communications">
      <CardHead
        icon={FileText}
        title="Notes & Communications"
        aside={
          <button type="button" className={linkBtn} onClick={onAll}>
            View All <ArrowRight aria-hidden weight="bold" className="size-3" />
          </button>
        }
      />
      {rows.length === 0 ? (
        <p className={quiet}>
          {acts.isError
            ? 'Notes are not available right now.'
            : acts.isPending
              ? 'Loading…'
              : 'No notes yet.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((a) => (
            <li key={a.id} className="border-t border-divider py-2 text-sm first:border-t-0">
              <p className="text-xs text-muted">
                {dayText(a.occurredAt.slice(0, 10))}
                {a.loggedBy ? ` · ${a.loggedBy.name}` : ''}
              </p>
              <p className="text-heading">{a.summary}</p>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={`${outlined} mt-3`} onClick={onAll}>
        <Plus aria-hidden weight="bold" className="size-4" /> Add Note
      </button>
    </section>
  );
}
