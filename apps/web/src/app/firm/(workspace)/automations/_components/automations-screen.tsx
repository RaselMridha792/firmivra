'use client';

import type { AutomationRuleRow, AutomationRulesQuery } from '@firmivra/types';
import { type Column, KpiCard, Select, Table, Toast, Toggle } from '@firmivra/ui';
import {
  ArrowLeft,
  CheckCircle,
  ClipboardText,
  Clock,
  Copy,
  DownloadSimple,
  EnvelopeSimple,
  FileText,
  Gear,
  Lightbulb,
  ListChecks,
  MagnifyingGlass,
  Play,
  Plus,
  Lightning,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { BackToWorkflow } from '../../settings/workflow/_components/back-to-workflow';
import { DuplicateDialog, ImportDialog, RuleMenu, SettingsDialog } from './automation-dialogs';
import {
  AUTOMATIONS_KEY,
  AUTOMATION_ERRORS,
  MODULE_ICON,
  card,
  dayText,
  hoursText,
  linkBtn,
  outlined,
  quiet,
  stamp,
} from './automations-shared';
import { useRouter } from 'next/navigation';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'rules', label: 'Manage Rules' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const STEPS = [
  ['Set Triggers', 'Choose what event starts the automation.'],
  ['Define Actions', 'Select what happens (tasks, emails, updates, etc.).'],
  ['Set Conditions', 'Choose which clients or deadlines it applies to.'],
  ['Activate', 'Turn it on and let Firmivra handle the rest.'],
] as const;

/**
 * /automations: the command center: KPIs, categories, the rules table, templates and quick actions.
 * Opened from Settings > Workflow & Automations (`fromWorkflow`), the way back sits by the breadcrumb.
 */
export function AutomationsScreen({ fromWorkflow = false }: { fromWorkflow?: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('overview');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<'settings' | 'import' | 'duplicate'>();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const term = useDeferredValue(search.trim());
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const size = tab === 'rules' ? 25 : 8;
  const query: AutomationRulesQuery = {
    ...(term ? { search: term } : {}),
    ...(status ? { status: status as 'ACTIVE' } : {}),
    ...(category ? { category: category as 'CLIENTS' } : {}),
    sort: 'updated',
    page,
    pageSize: size,
  };
  const overview = useApiQuery([...AUTOMATIONS_KEY, 'overview'], () => api.automations.overview());
  const catalog = useApiQuery([...AUTOMATIONS_KEY, 'catalog'], () => api.automations.catalog());
  const all = useApiQuery([...AUTOMATIONS_KEY, 'rules', 'counts'], () =>
    api.automations.rules({ pageSize: 100 }),
  );
  const rules = useApiQuery([...AUTOMATIONS_KEY, 'rules', query], () =>
    api.automations.rules(query),
  );
  const templates = useApiQuery([...AUTOMATIONS_KEY, 'templates', 'popular'], () =>
    api.automations.templates({ pageSize: 6 }),
  );
  const options = { invalidate: [...AUTOMATIONS_KEY] };
  const toggle = useApiMutation(
    (r: AutomationRuleRow) =>
      r.status === 'ACTIVE' ? api.automations.pause(r.id) : api.automations.activate(r.id),
    options,
  );
  const use = useApiMutation((id: string) => api.automations.useTemplate(id), options);
  const starters = useApiMutation(() => api.automations.installStarters(), options);
  const o = overview.data;
  const counts = new Map<string, number>();
  for (const r of all.data?.items ?? []) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const modules = (catalog.data?.modules ?? []).filter((m) => counts.has(m.module));
  const canManage = o?.canManage ?? true;

  const kpi = (
    id: string,
    icon: typeof Play,
    tone: 'green' | 'red' | 'blue' | 'purple',
    label: string,
    value: string | number | undefined,
    delta?: number | null,
  ) => (
    <li key={id} data-testid={`kpi-${id}`}>
      <KpiCard
        icon={icon}
        tone={tone}
        value={value ?? '–'}
        label={label}
        loading={overview.isPending}
        {...(delta !== null && delta !== undefined
          ? {
              trend: {
                text: `${Math.abs(delta)}%`,
                direction:
                  delta > 0 ? ('up' as const) : delta < 0 ? ('down' as const) : ('flat' as const),
                good: delta >= 0,
              },
              note: 'vs last month',
            }
          : {})}
      />
    </li>
  );
  const health = o?.health;
  const columns: Column<AutomationRuleRow>[] = [
    {
      id: 'name',
      label: 'Rule Name',
      cell: (r) => {
        const Glyph = MODULE_ICON[r.category];
        return (
          <span className="flex min-w-44 items-center gap-2">
            <Glyph aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
            <Link
              href={`/automations/${r.id}/edit`}
              data-testid="rule-link"
              className="font-medium text-heading hover:underline"
            >
              {r.name}
            </Link>
          </span>
        );
      },
    },
    {
      id: 'trigger',
      label: 'Trigger',
      cell: (r) => <span className="block min-w-32">{r.triggerSummary}</span>,
    },
    {
      id: 'actions',
      label: 'Action(s)',
      cell: (r) => <span className="block min-w-32">{r.actionsSummary}</span>,
    },
    {
      id: 'applies',
      label: 'Applies To',
      className: 'hidden 2xl:table-cell',
      cell: (r) => r.appliesTo,
    },
    {
      id: 'status',
      label: 'Status',
      cell: (r) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          {r.status === 'ACTIVE' || r.status === 'PAUSED' || r.status === 'DRAFT' ? (
            <Toggle
              label={`${r.name} is ${r.status === 'ACTIVE' ? 'on' : 'off'}`}
              checked={r.status === 'ACTIVE'}
              disabled={!canManage || toggle.isPending}
              onChange={() =>
                toggle.mutate(r, {
                  onError: (e) => notice(errorMessage(e, AUTOMATION_ERRORS), 'error'),
                })
              }
            />
          ) : null}
          <span className={r.status === 'ACTIVE' ? 'font-medium text-success' : 'text-muted'}>
            {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
          </span>
          {r.needsAttention ? (
            <span className="text-xs font-semibold text-danger">Needs attention</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'last',
      label: 'Last Run',
      cell: (r) => (
        <span className="whitespace-nowrap">{r.lastRunAt ? stamp(r.lastRunAt) : '—'}</span>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="automations-page">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          <Link href="/" aria-label="Home" className="text-link">
            <ArrowLeft aria-hidden weight="bold" className="size-4" />
          </Link>
          <Link href="/" className="text-link">
            Home
          </Link>
          <span aria-hidden className="text-muted">
            ›
          </span>
          <span className="font-semibold text-heading">Automation</span>
        </nav>
        {fromWorkflow ? <BackToWorkflow /> : null}
      </div>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
            <Gear aria-hidden weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-bold text-heading">Automation</h1>
            <p className="text-base text-muted">
              Automate your compliance workflow and never miss a deadline.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/automations/logs" className={outlined}>
            <ClipboardText aria-hidden weight="fill" className="size-4" /> Automation Logs
          </Link>
          <Link href="/automations/templates" className={outlined}>
            <FileText aria-hidden weight="fill" className="size-4" /> Templates
          </Link>
          {canManage ? (
            <Link
              href="/automations/new"
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-5 text-sm font-medium text-on-action hover:bg-action-hover"
              data-testid="create-rule"
            >
              <Plus aria-hidden weight="bold" className="size-4" /> Create Automation Rule
            </Link>
          ) : null}
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <nav
        aria-label="Automation views"
        role="tablist"
        className="relative flex overflow-x-auto border-b border-divider"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setPage(1);
            }}
            className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <ul
        data-testid="automation-kpis"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5"
      >
        {kpi(
          'rules',
          Play,
          'green',
          'Active Rules',
          o?.activeRules.value,
          o?.activeRules.deltaPercent,
        )}
        {kpi(
          'tasks',
          ListChecks,
          'red',
          'Tasks Created (This Month)',
          o?.tasksCreated.value,
          o?.tasksCreated.deltaPercent,
        )}
        {kpi(
          'notify',
          EnvelopeSimple,
          'blue',
          'Client Notifications Sent',
          o?.clientNotifications.value,
          o?.clientNotifications.deltaPercent,
        )}
        {kpi(
          'saved',
          Clock,
          'purple',
          'Time Saved (Estimate)',
          o ? hoursText(o.timeSavedMinutes.value) : undefined,
          o?.timeSavedMinutes.deltaPercent,
        )}
        <li data-testid="kpi-health">
          <KpiCard
            icon={CheckCircle}
            tone={
              health?.status === 'FAILING'
                ? 'red'
                : health?.status === 'ATTENTION'
                  ? 'amber'
                  : 'green'
            }
            value={
              health
                ? health.status === 'HEALTHY'
                  ? 'All Systems Operational'
                  : health.status === 'ATTENTION'
                    ? 'Needs Attention'
                    : 'Failing'
                : '–'
            }
            label="Automations Running"
            loading={overview.isPending}
            {...(health && health.status !== 'HEALTHY'
              ? {
                  note: `${health.failedRuns24h} failed in 24 hours · ${health.rulesNeedingAttention} rule(s) need attention`,
                }
              : {})}
          />
        </li>
      </ul>

      <div className="grid items-start gap-4 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <aside aria-label="Automation Categories" className={card} data-testid="categories">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">
              Automation Categories
            </h2>
            <ul className="flex flex-col gap-1">
              {[
                { module: '', label: 'All Automations', n: all.data?.items.length ?? 0 },
                ...modules.map((m) => ({
                  module: m.module as string,
                  label: m.label,
                  n: counts.get(m.module) ?? 0,
                })),
              ].map((m) => {
                const Glyph: Icon = m.module
                  ? MODULE_ICON[m.module as keyof typeof MODULE_ICON]
                  : FileText;
                return (
                  <li key={m.module || 'all'}>
                    <button
                      type="button"
                      aria-pressed={category === m.module}
                      onClick={() => {
                        setCategory(m.module);
                        setPage(1);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${category === m.module ? 'bg-info-soft font-semibold text-heading' : 'text-text hover:bg-canvas'}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Glyph aria-hidden weight="fill" className="size-4 shrink-0 text-action" />
                        <span className="truncate">{m.label}</span>
                      </span>
                      <span className="rounded-pill bg-canvas px-2 py-0.5 text-xs font-semibold text-heading">
                        {m.n}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
          <aside
            className="flex items-start gap-3 rounded-xl bg-success-soft p-4"
            aria-label="Automation Tip"
            data-testid="tip"
          >
            <Lightbulb aria-hidden weight="fill" className="size-6 shrink-0 text-success" />
            <div>
              <h2 className="text-sm font-bold text-heading">Automation Tip</h2>
              <p className="text-sm text-text">
                Use templates to quickly set up common deadline workflows for new clients.
              </p>
            </div>
          </aside>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section className={card} aria-label="Automation Rules">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-3 font-display text-lg font-bold text-heading">
                <span
                  aria-hidden
                  className="flex size-9 items-center justify-center rounded-lg bg-info-soft text-action"
                >
                  <Gear weight="fill" className="size-5" />
                </span>
                Automation Rules
              </h2>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex h-10 w-56 items-center gap-2 rounded-lg border border-divider bg-canvas px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
                  <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
                  <span className="sr-only">Search rules</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search rules..."
                    className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
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
                      { value: '', label: 'Status: All' },
                      { value: 'ACTIVE', label: 'Active' },
                      { value: 'PAUSED', label: 'Paused' },
                      { value: 'DRAFT', label: 'Draft' },
                      { value: 'ARCHIVED', label: 'Archived' },
                    ]}
                  />
                </div>
                <div className="w-44">
                  <Select
                    label="Category"
                    hideLabel
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setPage(1);
                    }}
                    options={[
                      { value: '', label: 'Category: All' },
                      ...(catalog.data?.modules ?? []).map((m) => ({
                        value: m.module,
                        label: m.label,
                      })),
                    ]}
                  />
                </div>
              </div>
            </header>
            <div className="relative" data-testid="rules-table">
              <Table
                rows={rules.data?.items ?? []}
                columns={columns}
                rowKey={(r) => r.id}
                caption="Automation rules"
                dense
                noun="rules"
                pageSize={size}
                loading={rules.isPending}
                emptyTitle={rules.isError ? 'Rules are not available' : 'No automation rules'}
                emptyText={
                  rules.isError
                    ? 'We could not load the rules. Try again in a moment.'
                    : 'Create a rule, or start from a template.'
                }
                emptyAction={
                  canManage ? (
                    <Link
                      href="/automations/new"
                      className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-medium text-on-action"
                    >
                      Create Automation Rule
                    </Link>
                  ) : undefined
                }
                rowActions={(r) => <RuleMenu row={r} onNotice={notice} canManage={canManage} />}
                server={{
                  page: rules.data?.page ?? 1,
                  total: rules.data?.total ?? 0,
                  hasNext: (rules.data?.page ?? 1) * size < (rules.data?.total ?? 0),
                  hasPrevious: (rules.data?.page ?? 1) > 1,
                  onNext: () => setPage(page + 1),
                  onPrevious: () => setPage(Math.max(1, page - 1)),
                  onPage: (n: number) => setPage(n),
                  onSort: () => undefined,
                }}
              />
            </div>
          </section>

          {tab === 'overview' ? (
            <div className="grid items-start gap-4 lg:grid-cols-3">
              <section className={card} aria-label="How It Works" data-testid="how">
                <h2 className="mb-3 flex items-center gap-3 font-display text-lg font-bold text-heading">
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-lg bg-info-soft text-action"
                  >
                    <Gear weight="fill" className="size-5" />
                  </span>
                  How It Works
                </h2>
                <ol className="flex flex-col gap-3">
                  {STEPS.map(([title, text], i) => (
                    <li key={title} className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-sm font-bold text-on-action"
                      >
                        {i + 1}
                      </span>
                      <span>
                        <span className="block text-sm font-bold text-heading">{title}</span>
                        <span className="block text-sm text-text">{text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
              <section
                className={card}
                aria-label="Popular Automation Templates"
                data-testid="popular"
              >
                <h2 className="mb-3 flex items-center gap-3 font-display text-lg font-bold text-heading">
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-lg bg-info-soft text-action"
                  >
                    <FileText weight="fill" className="size-5" />
                  </span>
                  Popular Automation Templates
                </h2>
                {(templates.data?.items ?? []).length === 0 ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className={`${quiet} w-full`}>
                      {templates.isPending
                        ? 'Loading…'
                        : templates.isError
                          ? 'Templates are not available right now.'
                          : 'No templates yet.'}
                    </p>
                    {canManage && !templates.isPending && !templates.isError ? (
                      <button
                        type="button"
                        className={outlined}
                        disabled={starters.isPending}
                        onClick={() =>
                          starters.mutate(undefined, {
                            onSuccess: () => notice('Starter templates installed.', 'success'),
                            onError: (e) => notice(errorMessage(e, AUTOMATION_ERRORS), 'error'),
                          })
                        }
                      >
                        Install starter templates
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <ul className="flex flex-col">
                    {(templates.data?.items ?? []).map((t) => {
                      const Glyph = MODULE_ICON[t.category];
                      return (
                        <li
                          key={t.id}
                          className="flex items-center justify-between gap-2 border-t border-divider py-2 first:border-t-0"
                        >
                          <span className="flex min-w-0 items-center gap-2 text-sm text-heading">
                            <Glyph
                              aria-hidden
                              weight="fill"
                              className="size-4 shrink-0 text-action"
                            />
                            <span className="truncate">{t.name}</span>
                          </span>
                          <button
                            type="button"
                            disabled={
                              !canManage || use.isPending || t.integrationsMissing.length > 0
                            }
                            aria-label={`Use template ${t.name}`}
                            onClick={() =>
                              use.mutate(t.id, {
                                onSuccess: (r) => router.push(`/automations/${r.id}/edit`),
                                onError: (e) => notice(errorMessage(e, AUTOMATION_ERRORS), 'error'),
                              })
                            }
                            className="shrink-0 rounded-control border border-action px-3 py-1 text-xs font-medium text-action hover:bg-accent-soft disabled:opacity-50"
                          >
                            Use Template
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <section className={card} aria-label="Quick Actions" data-testid="quick">
                <h2 className="mb-3 flex items-center gap-3 font-display text-lg font-bold text-heading">
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-lg bg-info-soft text-action"
                  >
                    <Lightning weight="fill" className="size-5" />
                  </span>
                  Quick Actions
                </h2>
                <div className="flex flex-col gap-2">
                  {canManage ? (
                    <>
                      <Link href="/automations/new" className={outlined}>
                        <Plus aria-hidden weight="bold" className="size-4" /> Create New Automation
                        Rule
                      </Link>
                      <button
                        type="button"
                        className={outlined}
                        onClick={() => setDialog('import')}
                      >
                        <DownloadSimple aria-hidden weight="bold" className="size-4" /> Import
                        Automation Templates
                      </button>
                      <button
                        type="button"
                        className={outlined}
                        onClick={() => setDialog('duplicate')}
                      >
                        <Copy aria-hidden weight="fill" className="size-4" /> Duplicate Existing
                        Rule
                      </button>
                    </>
                  ) : null}
                  <Link href="/automations/logs" className={outlined}>
                    <ClipboardText aria-hidden weight="fill" className="size-4" /> View Automation
                    Logs
                  </Link>
                  {canManage ? (
                    <button
                      type="button"
                      className={outlined}
                      onClick={() => setDialog('settings')}
                    >
                      <Gear aria-hidden weight="fill" className="size-4" /> Automation Settings
                    </button>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>
      <section className={card} aria-label="Recent activity" data-testid="recent-activity">
        <header className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-heading">Recent Activity</h2>
          <Link href="/automations/logs" className={linkBtn}>
            View all logs
          </Link>
        </header>
        {(o?.recent ?? []).length === 0 ? (
          <p className={quiet}>
            {overview.isPending
              ? 'Loading…'
              : overview.isError
                ? 'Recent activity is not available right now.'
                : 'No automation has run yet.'}
          </p>
        ) : (
          <ul>
            {(o?.recent ?? []).slice(0, 5).map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-divider py-2 text-sm first:border-t-0"
              >
                <span className="text-muted">{dayText(r.createdAt)}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-heading">
                  {r.rule.name}
                </span>
                <span className="text-text">{r.client?.name ?? '—'}</span>
                <span className={r.status === 'FAILED' ? 'font-semibold text-danger' : 'text-text'}>
                  {r.status.charAt(0) + r.status.slice(1).toLowerCase().replace('_', ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialog === 'settings' ? (
        <SettingsDialog
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            notice('Settings saved.', 'success');
          }}
        />
      ) : null}
      {dialog === 'import' ? (
        <ImportDialog
          onClose={() => setDialog(undefined)}
          onDone={(name) => {
            setDialog(undefined);
            notice(`${name} imported.`, 'success');
          }}
        />
      ) : null}
      {dialog === 'duplicate' ? <DuplicateDialog onClose={() => setDialog(undefined)} /> : null}
    </div>
  );
}
