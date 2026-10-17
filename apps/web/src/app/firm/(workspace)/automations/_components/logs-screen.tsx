'use client';

import type { AutomationRunRow, AutomationRunsQuery } from '@firmivra/types';
import { Button, type Column, KpiCard, Modal, Select, Table, Textarea, Toast } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowsClockwise,
  CheckCircle,
  Clock,
  DownloadSimple,
  Gear,
  MagnifyingGlass,
  Play,
  PencilSimple,
  Warning,
  XCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { SettingsDialog } from './automation-dialogs';
import {
  AUTOMATIONS_KEY,
  AUTOMATION_ERRORS,
  RunStatusPill,
  card,
  dayText,
  outlined,
  quiet,
  seconds,
  stamp,
  subtle,
} from './automations-shared';

const RANGES = [
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
  { value: '', label: 'All Time' },
];
const fromDays = (days: string) =>
  days ? new Date(Date.now() - Number(days) * 86_400_000).toISOString().slice(0, 10) : undefined;

/** /automations/logs: every run, filters, the run's details with its action log, and the rule behind it. */
export function LogsScreen({ ruleId }: { ruleId: string | undefined }) {
  const [range, setRange] = useState('30');
  const [rule, setRule] = useState(ruleId ?? '');
  const [tab, setTab] = useState<NonNullable<AutomationRunsQuery['tab']>>('all');
  const [module, setModule] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string>();
  const [dialog, setDialog] = useState<'settings' | 'rerun'>();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const term = useDeferredValue(search.trim());
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const from = fromDays(range);
  const filter = {
    ...(from ? { from } : {}),
    ...(rule ? { ruleId: rule } : {}),
    ...(module ? { module: module as 'CLIENTS' } : {}),
    ...(term ? { search: term } : {}),
  };
  const query: AutomationRunsQuery = { ...filter, tab, page, pageSize: 10 };
  const list = useApiQuery([...AUTOMATIONS_KEY, 'runs', query], () => api.automations.runs(query));
  const summary = useApiQuery([...AUTOMATIONS_KEY, 'runs-summary', filter], () =>
    api.automations.runsSummary(filter),
  );
  const rules = useApiQuery([...AUTOMATIONS_KEY, 'rules', 'pick'], () =>
    api.automations.rules({ pageSize: 100, includeArchived: true }),
  );
  const catalog = useApiQuery([...AUTOMATIONS_KEY, 'catalog'], () => api.automations.catalog());
  const rows = list.data?.items ?? [];
  const activeId = picked ?? rows[0]?.id;
  const exportLogs = useApiMutation(
    () => api.automations.exportLogs({ filter: { ...filter, tab } }),
    {},
  );
  const s = summary.data;
  const pct = (n: number | undefined) =>
    s && s.total > 0 && n !== undefined ? `${Math.round((n / s.total) * 100)}%` : undefined;

  const kpi = (
    id: string,
    icon: typeof Play,
    tone: 'blue' | 'green' | 'red' | 'amber',
    label: string,
    value: number | undefined,
    share?: string,
  ) => (
    <li key={id} data-testid={`kpi-${id}`}>
      <KpiCard
        icon={icon}
        tone={tone}
        value={value === undefined ? '–' : value.toLocaleString('en-US')}
        label={label}
        loading={summary.isPending}
        {...(share ? { note: share } : {})}
      />
    </li>
  );
  const columns: Column<AutomationRunRow>[] = [
    {
      id: 'when',
      label: 'Date/Time',
      cell: (r) => <span className="block min-w-24">{stamp(r.createdAt)}</span>,
    },
    {
      id: 'rule',
      label: 'Rule Name',
      cell: (r) => (
        <span className="block min-w-36 font-medium text-heading">
          {r.rule.name}
          {r.dryRun ? ' (test)' : ''}
        </span>
      ),
    },
    { id: 'trigger', label: 'Trigger', className: 'hidden 2xl:table-cell', cell: (r) => r.trigger },
    { id: 'client', label: 'Client/Record', cell: (r) => r.client?.name ?? '—' },
    {
      id: 'actions',
      label: 'Actions Performed',
      cell: (r) =>
        `${r.actionsSucceeded} of ${r.actionCount} done${r.actionsFailed ? `, ${r.actionsFailed} failed` : ''}`,
    },
    { id: 'status', label: 'Status', cell: (r) => <RunStatusPill status={r.status} /> },
    { id: 'duration', label: 'Duration', cell: (r) => seconds(r.durationMs) },
    {
      id: 'details',
      label: 'Details',
      cell: (r) => (
        <button
          type="button"
          aria-label={`View ${r.rule.name} ${stamp(r.createdAt)}`}
          onClick={() => setPicked(r.id)}
          className="font-medium text-link hover:underline"
        >
          View
        </button>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="logs-page">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/automations" aria-label="Back to Automation" className="text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/automations" className="text-link">
          Automation
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Automation Logs</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
            <Gear aria-hidden weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              Automation Logs &amp; Rule Activity
            </h1>
            <p className="text-base text-muted">
              Track, monitor, and troubleshoot all automation activity.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={outlined} onClick={() => setDialog('settings')}>
            <Gear aria-hidden weight="fill" className="size-4" /> View Automation Settings
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-5 text-sm font-medium text-on-action hover:bg-action-hover disabled:opacity-50"
            disabled={exportLogs.isPending}
            data-testid="export-logs"
            onClick={() =>
              exportLogs.mutate(undefined, {
                onSuccess: (x) =>
                  notice(`${x.fileName}: ${x.rowCount} row(s) exported.`, 'success'),
                onError: (e) => notice(errorMessage(e, AUTOMATION_ERRORS), 'error'),
              })
            }
          >
            <DownloadSimple aria-hidden weight="bold" className="size-4" /> Export Logs
          </button>
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <ul data-testid="log-kpis" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpi('total', Play, 'blue', 'Total Runs', s?.total)}
        {kpi('success', CheckCircle, 'green', 'Successful', s?.success, pct(s?.success))}
        {kpi('failed', XCircle, 'red', 'Failed', s?.failed, pct(s?.failed))}
        {kpi('skipped', Warning, 'amber', 'Skipped', s?.skipped, pct(s?.skipped))}
        {kpi('pending', Clock, 'blue', 'Pending', s?.pending, pct(s?.pending))}
      </ul>

      <section className={card} aria-label="Run history">
        <form
          aria-label="Log filters"
          className="mb-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="w-40">
            <Select
              label="Date range"
              hideLabel
              value={range}
              onChange={(e) => {
                setRange(e.target.value);
                setPage(1);
              }}
              options={RANGES}
            />
          </div>
          <div className="w-52">
            <Select
              label="Rule"
              hideLabel
              value={rule}
              onChange={(e) => {
                setRule(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Rules' },
                ...(rules.data?.items ?? []).map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          </div>
          <div className="w-40">
            <Select
              label="Status"
              hideLabel
              value={tab}
              onChange={(e) => {
                setTab(e.target.value as typeof tab);
                setPage(1);
              }}
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'success', label: 'Success' },
                { value: 'failed', label: 'Failed' },
                { value: 'skipped', label: 'Skipped' },
                { value: 'pending', label: 'Pending' },
              ]}
            />
          </div>
          <div className="w-44">
            <Select
              label="Module"
              hideLabel
              value={module}
              onChange={(e) => {
                setModule(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Modules' },
                ...(catalog.data?.modules ?? []).map((m) => ({ value: m.module, label: m.label })),
              ]}
            />
          </div>
          <label className="flex h-10 min-w-48 flex-1 items-center gap-2 rounded-lg border border-divider bg-canvas px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
            <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
            <span className="sr-only">Search logs</span>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search logs..."
              className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
            />
          </label>
          <button
            type="button"
            className={subtle}
            onClick={() => {
              setRange('30');
              setRule('');
              setTab('all');
              setModule('');
              setSearch('');
              setPage(1);
            }}
          >
            Reset Filters
          </button>
        </form>
        <div className="relative" data-testid="logs-table">
          <Table
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            caption="Automation runs"
            dense
            noun="results"
            pageSize={10}
            loading={list.isPending}
            emptyTitle={list.isError ? 'Logs are not available' : 'No runs'}
            emptyText={
              list.isError
                ? 'We could not load the logs. Try again in a moment.'
                : 'Runs appear here when a rule fires or is tested.'
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

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <LogDetails id={activeId} onRerun={() => setDialog('rerun')} failed={list.isError} />
        <RuleInformation id={rows.find((r) => r.id === activeId)?.rule.id} />
      </div>
      {dialog === 'settings' ? (
        <SettingsDialog
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            notice('Settings saved.', 'success');
          }}
        />
      ) : null}
      {dialog === 'rerun' && activeId ? (
        <RerunDialog
          id={activeId}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            notice('Run repeated.', 'success');
          }}
        />
      ) : null}
    </div>
  );
}

function LogDetails({
  id,
  onRerun,
  failed,
}: {
  id: string | undefined;
  onRerun: () => void;
  failed: boolean;
}) {
  const [tab, setTab] = useState<'log' | 'config' | 'related'>('log');
  const q = useApiQuery([...AUTOMATIONS_KEY, 'run', id ?? 'none'], async () =>
    id ? api.automations.runDetail(id) : undefined,
  );
  const d = q.data;
  return (
    <section className={card} aria-label="Log Details" data-testid="log-details">
      <h2 className="mb-3 font-display text-lg font-bold text-heading">Log Details</h2>
      {!d ? (
        <p className={quiet}>
          {failed || q.isError
            ? 'Log details are not available right now.'
            : q.isPending && id
              ? 'Loading…'
              : 'Choose a run to see its details.'}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="flex flex-wrap items-center gap-2 text-base font-bold text-heading">
                {d.rule.name} <RunStatusPill status={d.status} />
              </p>
              <p className="text-sm text-muted">{stamp(d.createdAt)}</p>
            </div>
            {d.canRerun ? (
              <button type="button" className={outlined} onClick={onRerun} data-testid="rerun">
                <ArrowsClockwise aria-hidden weight="bold" className="size-4" /> Re-run
              </button>
            ) : null}
          </div>
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-text">Rule Name:</dt>
            <dd className="text-heading">{d.rule.name}</dd>
            <dt className="text-text">Trigger:</dt>
            <dd className="text-heading">{d.trigger}</dd>
            <dt className="text-text">Client/Record:</dt>
            <dd className="text-heading">{d.client?.name ?? '—'}</dd>
            <dt className="text-text">Actions Attempted:</dt>
            <dd className="text-heading">{d.actions.map((a) => a.label).join(', ') || '—'}</dd>
            <dt className="text-text">Duration:</dt>
            <dd className="text-heading">{seconds(d.durationMs)}</dd>
          </dl>
          {d.error ? (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger"
              data-testid="run-error"
            >
              Error: {d.error.message}
              {d.error.remediation ? ` Reason: ${d.error.remediation}` : ''}
            </p>
          ) : null}
          {d.rerun.count > 0 ? (
            <p className="mt-2 text-xs text-muted">
              Re-run {d.rerun.count} time(s){d.rerun.lastBy ? ` by ${d.rerun.lastBy.name}` : ''}:{' '}
              {d.rerun.lastReason}
            </p>
          ) : null}
          <div
            role="tablist"
            aria-label="Log sections"
            className="relative mt-3 flex border-b border-divider"
          >
            {(
              [
                ['log', 'Action Log'],
                ['config', 'Rule Configuration'],
                ['related', 'Related Records'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`-mb-px min-h-10 border-b-2 px-3 text-sm ${tab === k ? 'border-action font-semibold text-action' : 'border-transparent text-heading'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'log' ? (
            <div className="relative mt-2 overflow-x-auto rounded-lg border border-divider">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Action log</caption>
                <thead className="bg-table-head text-heading">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Details</th>
                  </tr>
                </thead>
                <tbody data-testid="action-log">
                  {d.actions.map((a) => (
                    <tr key={a.actionKey} className="border-t border-divider">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {a.startedAt ? new Date(a.startedAt).toLocaleTimeString('en-US') : '—'}
                      </td>
                      <td className="px-3 py-2">{a.label}</td>
                      <td className="px-3 py-2">
                        <RunStatusPill
                          status={
                            a.status === 'FAILED'
                              ? 'FAILED'
                              : a.status === 'SKIPPED'
                                ? 'SKIPPED'
                                : a.status === 'PENDING'
                                  ? 'PENDING'
                                  : a.status === 'RUNNING'
                                    ? 'RUNNING'
                                    : 'SUCCESS'
                          }
                        />
                      </td>
                      <td className="px-3 py-2">{a.detail ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {tab === 'config' ? (
            <div className="mt-2 text-sm" data-testid="run-config">
              <p className="text-text">
                The rule as it was when this ran (version {d.ruleVersion})
                {d.ruleChanged ? '; it has changed since' : ''}.
              </p>
              <ol className="mt-2 list-decimal pl-5 text-heading">
                {d.ruleSnapshot.actions.map((a) => (
                  <li key={a.id}>
                    {a.type.replace(/_/g, ' ').toLowerCase()}
                    {a.delayMinutes ? `, after ${a.delayMinutes} minutes` : ''}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {tab === 'related' ? (
            <ul className="mt-2 text-sm">
              {d.related.length === 0 ? (
                <li className="text-muted">No related records.</li>
              ) : (
                d.related.map((r) => (
                  <li
                    key={r.id}
                    className="border-t border-divider py-1.5 first:border-t-0 text-link"
                  >
                    {r.label}
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

function RuleInformation({ id }: { id: string | undefined }) {
  const q = useApiQuery([...AUTOMATIONS_KEY, 'rule', id ?? 'none'], async () =>
    id ? api.automations.rule(id) : undefined,
  );
  const r = q.data;
  return (
    <section className={card} aria-label="Rule Information" data-testid="rule-info">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-heading">Rule Information</h2>
        {r ? (
          <Link href={`/automations/${r.id}/edit`} className={outlined}>
            <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit Rule
          </Link>
        ) : null}
      </header>
      {!r ? (
        <p className={quiet}>
          {q.isError
            ? 'The rule is not available right now.'
            : q.isPending && id
              ? 'Loading…'
              : 'Choose a run to see its rule.'}
        </p>
      ) : (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-text">Rule Name:</dt>
          <dd className="text-heading">{r.name}</dd>
          <dt className="text-text">Trigger:</dt>
          <dd className="text-heading">{r.triggerSummary}</dd>
          <dt className="text-text">Applies To:</dt>
          <dd className="text-heading">{r.appliesTo}</dd>
          <dt className="text-text">Actions:</dt>
          <dd className="text-heading">{r.actionsSummary}</dd>
          <dt className="text-text">Status:</dt>
          <dd className="text-heading">{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</dd>
          <dt className="text-text">Created By:</dt>
          <dd className="text-heading">{r.owner?.name ?? '—'}</dd>
          <dt className="text-text">Date Created:</dt>
          <dd className="text-heading">{dayText(r.createdAt)}</dd>
          <dt className="text-text">Last Modified:</dt>
          <dd className="text-heading">{dayText(r.updatedAt)}</dd>
        </dl>
      )}
    </section>
  );
}

function RerunDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const send = useApiMutation(
    () => api.automations.rerun(id, { reason: reason.trim(), confirmRuleChanged: true }),
    { invalidate: [...AUTOMATIONS_KEY] },
  );
  return (
    <Modal
      open
      title="Re-run"
      subtitle="Only the failed actions run again; finished ones are not repeated."
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
            Re-run
          </Button>
        </>
      }
    >
      <Textarea
        label="Why are you re-running it?"
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
      />
      {send.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(send.error, AUTOMATION_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}
