'use client';

import type { TaskOverviewQuery, TaskRow } from '@firmivra/types';
import { Button, KpiCard, Select } from '@firmivra/ui';
import {
  ArrowLeft,
  CaretDown,
  CheckCircle,
  CheckSquare,
  Clock,
  Lightning,
  ListChecks,
  MagnifyingGlass,
  Plus,
  Repeat,
  FileText,
  Tag,
  Warning,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { useClients, useMembers, useTypes } from './task-data';
import { PriorityPill, StatusPill, TASKS_KEY, dueText } from './task-shared';
import type { TaskView } from './task-views';
import { RecurringTab, TemplatesTab } from './tasks-other-tabs';
import {
  MySummary,
  QuickActions,
  TaskCalendar,
  TemplatesCard,
  UpcomingDeadlines,
} from './tasks-rail';
import { TaskTable } from './task-table';
import { BackToWorkflow } from '../../settings/workflow/_components/back-to-workflow';

type Tab = TaskView;
const TABS: { id: Tab; label: string }[] = [
  { id: 'mine', label: 'My Tasks' },
  { id: 'all', label: 'All Tasks' },
  { id: 'client', label: 'By Client' },
  { id: 'project', label: 'By Project' },
  { id: 'recurring', label: 'Recurring Tasks' },
  { id: 'templates', label: 'Task Templates' },
  { id: 'completed', label: 'Completed Tasks' },
];
type KpiFilter = 'pending' | 'progress' | 'overdue' | 'completed' | undefined;

/**
 * The Add Task button with its menu: Add Task, Add Recurring Task, Use a Template, and for Owner
 * and Admin Manage Task Types (Octavia's C1: the setup path for the Task Type field).
 */
function AddMenu({ onTemplates, manages }: { onTemplates: () => void; manages: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) =>
      rootRef.current && !rootRef.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const item =
    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-text hover:bg-canvas';
  return (
    <div ref={rootRef} className="relative">
      <div className="inline-flex overflow-hidden rounded-control bg-action text-on-action">
        <Link
          href="/tasks/new"
          className="inline-flex min-h-11 items-center gap-2 px-5 text-base font-medium hover:bg-action-hover"
        >
          <Plus aria-hidden weight="bold" className="size-5" /> Add Task
        </Link>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More ways to add a task"
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-11 items-center border-l border-on-action/30 px-3 hover:bg-action-hover"
        >
          <CaretDown aria-hidden weight="bold" className="size-4" />
        </button>
      </div>
      {open ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-30 mt-1 w-60 rounded-xl border border-divider bg-surface p-2 shadow-lg"
        >
          <Link role="menuitem" href="/tasks/new" className={item}>
            <Plus aria-hidden weight="bold" className="size-4" /> Add Task
          </Link>
          <Link role="menuitem" href="/tasks/recurring/new" className={item}>
            <Repeat aria-hidden weight="bold" className="size-4" /> Add Recurring Task
          </Link>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onTemplates();
            }}
          >
            <FileText aria-hidden weight="fill" className="size-4" /> Use a Template
          </button>
          {manages ? (
            <Link role="menuitem" href="/tasks/types" className={item}>
              <Tag aria-hidden weight="fill" className="size-4" /> Manage Task Types
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * /tasks: the overview. KPI cards, seven views, the table, and the right-hand summary widgets.
 * Opened from Settings > Workflow & Automations (`fromWorkflow`), the way back sits by the breadcrumb.
 */
export function TasksScreen({
  fromWorkflow = false,
  view = 'mine',
  savedTemplate,
}: {
  fromWorkflow?: boolean;
  view?: TaskView;
  savedTemplate?: string;
}) {
  const { role } = useFirm();
  const manages = role === 'OWNER' || role === 'ADMIN';
  const [tab, setTab] = useState<Tab>(view);
  const [kpi, setKpi] = useState<KpiFilter>();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState({
    progress: '',
    priority: '',
    typeId: '',
    clientId: '',
    assignedUserId: '',
  });
  const [applied, setApplied] = useState(draft);
  const [date, setDate] = useState<string>();
  const [sort, setSort] = useState<Pick<TaskOverviewQuery, 'sort' | 'direction'>>({
    sort: 'due',
    direction: 'asc',
  });
  const [page, setPage] = useState(1);
  const term = useDeferredValue(search.trim());
  const { types } = useTypes();
  const { clients } = useClients();
  const { members } = useMembers();
  const summary = useApiQuery([...TASKS_KEY, 'summary'], () => api.taskWork.summary());
  const s = summary.data;

  const query: TaskOverviewQuery = {
    view: tab === 'mine' ? 'mine' : tab === 'completed' ? 'completed' : 'all',
    ...(tab === 'mine' || tab === 'all' ? { status: 'OPEN' as const } : {}),
    ...(term ? { search: term } : {}),
    ...(applied.progress ? { progress: applied.progress as TaskOverviewQuery['progress'] } : {}),
    ...(applied.priority ? { priority: applied.priority as TaskOverviewQuery['priority'] } : {}),
    ...(applied.typeId ? { typeId: applied.typeId } : {}),
    ...(applied.clientId ? { clientId: applied.clientId } : {}),
    ...(applied.assignedUserId ? { assignedUserId: applied.assignedUserId } : {}),
    ...(kpi === 'pending' ? { progress: 'PENDING' as const } : {}),
    ...(kpi === 'progress' ? { progress: 'IN_PROGRESS' as const } : {}),
    ...(kpi === 'overdue' ? { overdue: true } : {}),
    ...(kpi === 'completed' ? { view: 'completed' as const } : {}),
    ...(date ? { dueFrom: date, dueTo: date } : {}),
    ...sort,
    page,
    pageSize: 10,
  };
  const onQuery = (change: Partial<TaskOverviewQuery>) => {
    if (change.sort) setSort({ sort: change.sort, direction: change.direction ?? 'asc' });
    if (change.page) setPage(Number(change.page));
    else setPage(1);
  };
  const choose = (id: Tab) => {
    setTab(id);
    setPage(1);
    setKpi(undefined);
  };
  const card = (
    id: Exclude<KpiFilter, undefined> | 'all',
    icon: typeof CheckSquare,
    tone: 'green' | 'amber' | 'blue' | 'red',
    label: string,
    value: number | undefined,
  ) => (
    <li key={id}>
      <button
        type="button"
        aria-pressed={kpi === id}
        data-testid={`kpi-${id}`}
        onClick={() => {
          setKpi(id === 'all' ? undefined : kpi === id ? undefined : id);
          if (tab !== 'all' && tab !== 'completed') setTab('all');
          setPage(1);
        }}
        className={`block w-full rounded-xl text-left ${kpi === id ? 'ring-2 ring-action' : ''}`}
      >
        <KpiCard
          icon={icon}
          tone={tone}
          value={value ?? '–'}
          label={label}
          loading={summary.isPending}
        />
      </button>
    </li>
  );
  const field = (
    label: string,
    key: keyof typeof draft,
    options: { value: string; label: string }[],
  ) => (
    <Select
      label={label}
      hideLabel
      value={draft[key]}
      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      options={options}
    />
  );
  const showTable = tab === 'mine' || tab === 'all' || tab === 'completed';

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="tasks-page">
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
          <span className="font-semibold text-heading">Tasks</span>
        </nav>
        {fromWorkflow ? <BackToWorkflow /> : null}
      </div>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
            <CheckSquare aria-hidden weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-bold text-heading">Tasks</h1>
            <p className="text-base text-muted">
              Stay organized. Get things done. Deliver exceptional service.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => choose('templates')}
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft"
          >
            <FileText aria-hidden weight="fill" className="size-4" /> Task Templates
          </button>
          <Link
            href="/automations?category=TASKS&from=tasks"
            data-testid="tasks-automations"
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft"
          >
            <Lightning aria-hidden weight="fill" className="size-4" /> Automations
          </Link>
          <AddMenu onTemplates={() => choose('templates')} manages={manages} />
        </div>
      </header>

      <ul data-testid="tasks-kpis" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {card('all', ListChecks, 'green', 'Total Tasks', s?.total)}
        {card('pending', Clock, 'amber', 'Pending', s?.pending)}
        {card('progress', ArrowsClockwise, 'blue', 'In Progress', s?.inProgress)}
        {card('overdue', Warning, 'red', 'Overdue', s?.overdue)}
        {card('completed', CheckCircle, 'green', 'Completed (This Month)', s?.completedThisMonth)}
      </ul>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <nav
            aria-label="Task views"
            role="tablist"
            className="flex overflow-x-auto border-b border-divider"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => choose(t.id)}
                className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === 'recurring' ? <RecurringTab /> : null}
          {tab === 'templates' ? <TemplatesTab saved={savedTemplate} /> : null}
          {showTable || tab === 'client' || tab === 'project' ? (
            <>
              <form
                aria-label="Task filters"
                className="flex flex-wrap items-center gap-3 rounded-xl bg-surface p-3 shadow-md"
                onSubmit={(e) => {
                  e.preventDefault();
                  setApplied(draft);
                  setPage(1);
                }}
              >
                <label className="flex h-10 min-w-48 flex-1 items-center gap-2 rounded-lg border border-divider bg-canvas px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
                  <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
                  <span className="sr-only">Search tasks</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search tasks..."
                    className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
                  />
                </label>
                <div className="w-36">
                  {field('Status', 'progress', [
                    { value: '', label: 'All Statuses' },
                    { value: 'NOT_STARTED', label: 'Not Started' },
                    { value: 'PENDING', label: 'Pending' },
                    { value: 'IN_PROGRESS', label: 'In Progress' },
                    { value: 'WAITING', label: 'Waiting' },
                    { value: 'BLOCKED', label: 'Blocked' },
                  ])}
                </div>
                <div className="w-36">
                  {field('Priority', 'priority', [
                    { value: '', label: 'All Priorities' },
                    { value: 'HIGH', label: 'High' },
                    { value: 'MEDIUM', label: 'Medium' },
                    { value: 'LOW', label: 'Low' },
                  ])}
                </div>
                <div className="w-40">
                  {field('Task type', 'typeId', [
                    { value: '', label: 'All Task Types' },
                    ...types.map((t) => ({ value: t.id, label: t.name })),
                  ])}
                </div>
                <div className="w-40">
                  {field('Client', 'clientId', [
                    { value: '', label: 'All Clients' },
                    ...clients.map((c) => ({ value: c.id, label: c.displayName })),
                  ])}
                </div>
                <div className="w-44">
                  {field('Team member', 'assignedUserId', [
                    { value: '', label: 'All Team Members' },
                    ...members.map((m) => ({ value: m.userId, label: m.name })),
                  ])}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const blank = {
                      progress: '',
                      priority: '',
                      typeId: '',
                      clientId: '',
                      assignedUserId: '',
                    };
                    setDraft(blank);
                    setApplied(blank);
                    setSearch('');
                    setKpi(undefined);
                    setDate(undefined);
                    setPage(1);
                  }}
                >
                  Reset
                </Button>
                <Button type="submit">Apply</Button>
              </form>
              {date ? (
                <p className="text-sm text-text">
                  Due on {date}.{' '}
                  <button
                    type="button"
                    className="text-link underline"
                    onClick={() => setDate(undefined)}
                  >
                    Show all dates
                  </button>
                </p>
              ) : null}
            </>
          ) : null}
          {showTable ? (
            <section className="min-w-0 rounded-xl bg-surface p-3 shadow-md" aria-label="Tasks">
              <TaskTable
                query={query}
                onQuery={onQuery}
                caption={TABS.find((t) => t.id === tab)?.label ?? 'Tasks'}
                emptyText={
                  tab === 'mine'
                    ? 'No tasks are assigned to you.'
                    : tab === 'completed'
                      ? 'No completed tasks yet.'
                      : 'Add a task to get started.'
                }
              />
            </section>
          ) : null}
          {tab === 'client' || tab === 'project' ? (
            <Grouped by={tab} query={{ ...query, view: 'all', pageSize: 100 }} />
          ) : null}
        </div>
        <aside aria-label="Summary" className="flex min-w-0 flex-col gap-4">
          <MySummary onAll={() => choose('mine')} />
          <UpcomingDeadlines onAll={() => choose('all')} />
        </aside>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TemplatesCard onAll={() => choose('templates')} />
        <QuickActions
          onTemplates={() => choose('templates')}
          onBulk={() => {
            choose('all');
            document.getElementById('tasks-bulk-hint')?.focus();
          }}
        />
        <TaskCalendar selected={date} onDate={setDate} onAll={() => choose('all')} />
      </div>
      <p id="tasks-bulk-hint" tabIndex={-1} className="sr-only">
        Tick tasks in the table to see the bulk actions.
      </p>
    </div>
  );
}

/** By Client and By Project: the same tasks, grouped under the client or the project they belong to. */
function Grouped({ by, query }: { by: 'client' | 'project'; query: TaskOverviewQuery }) {
  const list = useApiQuery([...TASKS_KEY, 'grouped', query], () => api.taskWork.overview(query));
  const groups = new Map<string, TaskRow[]>();
  for (const t of list.data?.items ?? []) {
    const key = by === 'client' ? t.client.displayName : (t.engagement?.title ?? 'No project');
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  if (groups.size === 0)
    return (
      <p className="rounded-xl bg-surface p-8 text-center text-sm text-muted shadow-md">
        {list.isPending
          ? 'Loading…'
          : list.isError
            ? 'Tasks are not available right now.'
            : 'No tasks to group yet.'}
      </p>
    );
  return (
    <div className="flex flex-col gap-3" data-testid="grouped">
      {[...groups].map(([name, rows]) => (
        <section key={name} className="min-w-0 rounded-xl bg-surface p-4 shadow-md">
          <h3 className="mb-2 flex items-baseline justify-between text-base font-bold text-heading">
            {name}
            <span className="text-sm font-normal text-muted">{rows.length} task(s)</span>
          </h3>
          <ul className="divide-y divide-divider">
            {rows.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <Link
                  href={`/tasks/${t.id}`}
                  className="min-w-0 flex-1 truncate font-medium text-heading hover:underline"
                >
                  {t.title}
                </Link>
                <span className={t.overdue ? 'text-danger' : 'text-text'}>{dueText(t)}</span>
                <PriorityPill priority={t.priority} />
                <StatusPill task={t} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
