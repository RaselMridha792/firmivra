'use client';

import type {
  PlanningClientRow,
  PlanningStrategy,
  TaxOpportunityRow,
  TaxPlanRow,
} from '@firmivra/types';
import {
  ActionMenu,
  Avatar,
  Button,
  Checkbox,
  Input,
  Modal,
  Select,
  Table,
  Textarea,
  Toast,
  type Column,
} from '@firmivra/ui';
import { DotsThreeVertical, MagnifyingGlass, PaperPlaneTilt, Plus } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { Disclaimer, TpShell } from './tp-shell';
import {
  CATEGORY_LABEL,
  OPP_STATUS,
  OppPill,
  PLAN_STATUS,
  PRIORITY_LABEL,
  PlanPill,
  PriorityPill,
  TP_ERRORS,
  TP_KEY,
  card,
  dayText,
  gold,
  money,
  outlined,
  primary,
  quiet,
  subtle,
} from './tp-shared';

function useAct(set: (m: { text: string; tone: 'success' | 'error' }) => void) {
  const qc = useQueryClient();
  return async <T,>(work: () => Promise<T>, done: string): Promise<T | undefined> => {
    try {
      const r = await work();
      await qc.invalidateQueries({ queryKey: [...TP_KEY] });
      set({ text: done, tone: 'success' });
      return r;
    } catch (e) {
      set({ text: errorMessage(e, TP_ERRORS), tone: 'error' });
      return undefined;
    }
  };
}
const searchBox = (value: string, set: (v: string) => void, label: string) => (
  <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus sm:w-64 sm:flex-none">
    <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
    <span className="sr-only">{label}</span>
    <input
      type="search"
      value={value}
      onChange={(e) => set(e.target.value)}
      placeholder={`${label}...`}
      className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
    />
  </label>
);
const server = (
  d: { page: number; total: number } | undefined,
  size: number,
  page: number,
  setPage: (n: number) => void,
) => ({
  page: d?.page ?? 1,
  total: d?.total ?? 0,
  hasNext: (d?.page ?? 1) * size < (d?.total ?? 0),
  hasPrevious: (d?.page ?? 1) > 1,
  onNext: () => setPage(page + 1),
  onPrevious: () => setPage(Math.max(1, page - 1)),
  onPage: (n: number) => setPage(n),
  onSort: () => undefined,
});

/** /tax-planning/clients: every client with their current plan. */
export function PlanningClients() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [hasPlan, setHasPlan] = useState('');
  const [page, setPage] = useState(1);
  const term = useDeferredValue(search.trim());
  const q = useApiQuery([...TP_KEY, 'clients', term, status, hasPlan, page], () =>
    api.taxPlanning.clients({
      ...(term ? { search: term } : {}),
      ...(status ? { status: status as never } : {}),
      ...(hasPlan ? { hasPlan: hasPlan === 'yes' } : {}),
      page,
      pageSize: 10,
    }),
  );
  const cols: Column<PlanningClientRow>[] = [
    {
      id: 'name',
      label: 'Client Name',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <Avatar name={r.client.name} size="md" />
          <span className="font-semibold text-heading">{r.client.name}</span>
        </span>
      ),
    },
    { id: 'type', label: 'Client Type', cell: (r) => r.entityLabel ?? '—' },
    {
      id: 'plan',
      label: 'Plan',
      cell: (r) =>
        r.planId ? (
          <Link
            href={`/tax-planning/plans/${r.planId}/edit`}
            className="font-medium text-link hover:underline"
          >
            {r.planName}
          </Link>
        ) : (
          '—'
        ),
    },
    { id: 'status', label: 'Status', cell: (r) => <PlanPill status={r.status} /> },
    { id: 'opp', label: 'Open Opportunities', cell: (r) => r.openOpportunities },
    {
      id: 'sav',
      label: 'Potential Savings',
      cell: (r) =>
        r.potentialSavingsCents === null ? '—' : `${money(r.potentialSavingsCents)} (est.)`,
    },
    { id: 'by', label: 'Assigned To', cell: (r) => r.assignedTo?.name ?? '—' },
  ];
  return (
    <TpShell>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Planning clients"
        data-testid="tp-clients"
      >
        <div className="flex flex-wrap items-center gap-3">
          {searchBox(
            search,
            (v) => {
              setSearch(v);
              setPage(1);
            },
            'Search clients',
          )}
          <div className="w-44">
            <Select
              label="Plan status"
              hideLabel
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Statuses' },
                ...Object.entries(PLAN_STATUS).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          <div className="w-44">
            <Select
              label="Has a plan"
              hideLabel
              value={hasPlan}
              onChange={(e) => {
                setHasPlan(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Clients' },
                { value: 'yes', label: 'With a plan' },
                { value: 'no', label: 'Without a plan' },
              ]}
            />
          </div>
          <Link href="/tax-planning/plans/new" className={`${gold} ml-auto`}>
            <Plus aria-hidden weight="bold" className="size-4" /> Create Planning Plan
          </Link>
        </div>
        <div className="relative">
          <Table
            rows={q.data?.items ?? []}
            columns={cols}
            rowKey={(r) => r.client.id}
            caption="Planning clients"
            dense
            noun="clients"
            pageSize={10}
            loading={q.isPending}
            emptyTitle={q.isError ? 'Clients are not available' : 'No clients match'}
            emptyText={
              q.isError
                ? 'We could not load the clients. Try again in a moment.'
                : 'Try another search or filter.'
            }
            rowActions={(r) => (
              <ActionMenu
                label={`Actions for ${r.client.name}`}
                trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
                align="right"
                sections={[
                  {
                    items: [
                      r.planId
                        ? {
                            label: 'Open Plan',
                            onSelect: () => router.push(`/tax-planning/plans/${r.planId}/edit`),
                          }
                        : {
                            label: 'Create Plan',
                            onSelect: () =>
                              router.push(`/tax-planning/plans/new?clientId=${r.client.id}`),
                          },
                      {
                        label: 'Opportunities',
                        onSelect: () =>
                          router.push(`/tax-planning/opportunities?clientId=${r.client.id}`),
                      },
                    ],
                  },
                ]}
              />
            )}
            server={server(q.data, 10, page, setPage)}
          />
        </div>
      </section>
    </TpShell>
  );
}

/** /tax-planning/opportunities: the queue found by screening, to review before anything is recommended. */
export function OpportunityQueue() {
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' }>();
  const act = useAct((m) => setMsg(m));
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [group, setGroup] = useState<'open' | 'closed' | ''>('open');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const term = useDeferredValue(search.trim());
  const q = useApiQuery([...TP_KEY, 'opps', term, status, category, priority, group, page], () =>
    api.taxPlanning.opportunities({
      ...(term ? { search: term } : {}),
      ...(status ? { status: status as never } : {}),
      ...(category ? { category: category as never } : {}),
      ...(priority ? { priority: priority as never } : {}),
      ...(group ? { group } : {}),
      page,
      pageSize: 10,
    }),
  );
  const cols: Column<TaxOpportunityRow>[] = [
    {
      id: 'name',
      label: 'Opportunity',
      cell: (r) => (
        <Link
          href={`/tax-planning/opportunities/${r.id}`}
          data-testid="opp-link"
          className="font-semibold text-link hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    { id: 'client', label: 'Client', cell: (r) => r.client.name },
    { id: 'cat', label: 'Category', cell: (r) => CATEGORY_LABEL[r.category] },
    { id: 'pri', label: 'Priority', cell: (r) => <PriorityPill priority={r.priority} /> },
    { id: 'status', label: 'Status', cell: (r) => <OppPill status={r.status} /> },
    {
      id: 'sav',
      label: 'Est. Savings',
      cell: (r) =>
        r.estimatedSavingsCents === null ? (
          <span title="Not enough data">N/A</span>
        ) : (
          money(r.estimatedSavingsCents)
        ),
    },
    { id: 'by', label: 'Assigned To', cell: (r) => r.assignedTo?.name ?? '—' },
  ];
  return (
    <TpShell
      actions={
        <button
          type="button"
          className={outlined}
          onClick={() => void act(() => api.taxPlanning.runScreening({}), 'Screening finished.')}
        >
          Run Screening
        </button>
      }
    >
      {msg ? (
        <Toast message={msg.text} tone={msg.tone} onDismiss={() => setMsg(undefined)} />
      ) : null}
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Planning opportunities"
        data-testid="tp-opps"
      >
        <div className="flex flex-wrap items-center gap-3">
          {searchBox(
            search,
            (v) => {
              setSearch(v);
              setPage(1);
            },
            'Search opportunities',
          )}
          <div className="w-40">
            <Select
              label="Group"
              hideLabel
              value={group}
              onChange={(e) => {
                setGroup(e.target.value as never);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All' },
                { value: 'open', label: 'Open' },
                { value: 'closed', label: 'Closed' },
              ]}
            />
          </div>
          <div className="w-48">
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
                ...Object.entries(OPP_STATUS).map(([value, label]) => ({ value, label })),
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
                { value: '', label: 'All Categories' },
                ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          <div className="w-40">
            <Select
              label="Priority"
              hideLabel
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Priorities' },
                ...Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          <button type="button" className={`${primary} ml-auto`} onClick={() => setCreating(true)}>
            <Plus aria-hidden weight="bold" className="size-4" /> Add Opportunity
          </button>
        </div>
        <div className="relative">
          <Table
            rows={q.data?.items ?? []}
            columns={cols}
            rowKey={(r) => r.id}
            caption="Planning opportunities"
            dense
            noun="opportunities"
            pageSize={10}
            loading={q.isPending}
            emptyTitle={q.isError ? 'Opportunities are not available' : 'No opportunities'}
            emptyText={
              q.isError
                ? 'We could not load the opportunities. Try again in a moment.'
                : 'Run screening, or add one by hand.'
            }
            server={server(q.data, 10, page, setPage)}
          />
        </div>
        <Disclaimer text="Estimates are based on the information provided and current tax law. Actual results may vary." />
      </section>
      {creating ? (
        <AddOpportunity
          onClose={() => setCreating(false)}
          onDone={(t) => {
            setCreating(false);
            setMsg({ text: t, tone: 'success' });
            void act(async () => undefined, t);
          }}
          onError={(t) => setMsg({ text: t, tone: 'error' })}
        />
      ) : null}
    </TpShell>
  );
}

function AddOpportunity({
  onClose,
  onDone,
  onError,
}: {
  onClose: () => void;
  onDone: (t: string) => void;
  onError: (t: string) => void;
}) {
  const clients = useApiQuery([...TP_KEY, 'pick-clients'], () =>
    api.taxPlanning.clients({ pageSize: 100 }),
  );
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('DEDUCTIONS');
  const [savings, setSavings] = useState('');
  return (
    <Modal
      open
      title="Add Opportunity"
      subtitle="A staff-found opportunity. Nothing is recommended until it is reviewed."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!clientId || !name.trim()}
            onClick={async () => {
              try {
                await api.taxPlanning.createOpportunity({
                  clientId,
                  name: name.trim(),
                  category: category as never,
                  taxYear: new Date().getFullYear(),
                  ...(savings ? { estimatedSavingsCents: Math.round(Number(savings) * 100) } : {}),
                });
                onDone('Opportunity added.');
              } catch (e) {
                onError(errorMessage(e, TP_ERRORS));
                onClose();
              }
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-opp">
        <Select
          label="Client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          options={[
            { value: '', label: 'Choose a client…' },
            ...(clients.data?.items ?? []).map((c) => ({
              value: c.client.id,
              label: c.client.name,
            })),
          ]}
        />
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <Input
          label="Estimated savings ($, optional)"
          value={savings}
          onChange={(e) => setSavings(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/** /tax-planning/strategies: the firm's strategy library. */
export function StrategyLibrary() {
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' }>();
  const act = useAct((m) => setMsg(m));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PlanningStrategy | 'new'>();
  const term = useDeferredValue(search.trim());
  const q = useApiQuery([...TP_KEY, 'library', term, category, archived, page], () =>
    api.taxPlanning.strategies({
      ...(term ? { search: term } : {}),
      ...(category ? { category: category as never } : {}),
      ...(archived ? { includeArchived: true } : {}),
      page,
      pageSize: 10,
    }),
  );
  const cols: Column<PlanningStrategy>[] = [
    {
      id: 'name',
      label: 'Strategy',
      cell: (r) => (
        <span>
          <span className="block font-semibold text-heading">{r.name}</span>
          <span className="block max-w-md truncate text-xs text-muted">{r.description}</span>
        </span>
      ),
    },
    { id: 'cat', label: 'Category', cell: (r) => CATEGORY_LABEL[r.category] },
    {
      id: 'pri',
      label: 'Default Priority',
      cell: (r) => <PriorityPill priority={r.defaultPriority} />,
    },
    { id: 'plans', label: 'In Plans', cell: (r) => r.planCount },
    { id: 'opps', label: 'Open Opportunities', cell: (r) => r.openOpportunityCount },
    {
      id: 'active',
      label: 'Status',
      cell: (r) => (r.archived ? 'Archived' : r.active ? 'Active' : 'Inactive'),
    },
  ];
  return (
    <TpShell>
      {msg ? (
        <Toast message={msg.text} tone={msg.tone} onDismiss={() => setMsg(undefined)} />
      ) : null}
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Strategies and recommendations"
        data-testid="tp-library"
      >
        <div className="flex flex-wrap items-center gap-3">
          {searchBox(
            search,
            (v) => {
              setSearch(v);
              setPage(1);
            },
            'Search strategies',
          )}
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
                { value: '', label: 'All Categories' },
                ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          <Checkbox
            label="Show archived"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <button type="button" className={`${primary} ml-auto`} onClick={() => setEditing('new')}>
            <Plus aria-hidden weight="bold" className="size-4" /> New Strategy
          </button>
        </div>
        <div className="relative">
          <Table
            rows={q.data?.items ?? []}
            columns={cols}
            rowKey={(r) => r.id}
            caption="Strategy library"
            dense
            noun="strategies"
            pageSize={10}
            loading={q.isPending}
            emptyTitle={q.isError ? 'Strategies are not available' : 'No strategies'}
            emptyText={
              q.isError
                ? 'We could not load the library. Try again in a moment.'
                : 'Add the strategies you recommend.'
            }
            rowActions={(r) => (
              <ActionMenu
                label={`Actions for ${r.name}`}
                trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
                align="right"
                sections={[
                  {
                    items: [
                      { label: 'Edit', onSelect: () => setEditing(r) },
                      r.archived
                        ? {
                            label: 'Restore',
                            onSelect: () =>
                              void act(
                                () => api.taxPlanning.restoreLibraryStrategy(r.id),
                                'Restored.',
                              ),
                          }
                        : {
                            label: 'Archive',
                            danger: true,
                            onSelect: () =>
                              void act(
                                () => api.taxPlanning.archiveLibraryStrategy(r.id),
                                'Archived.',
                              ),
                          },
                    ],
                  },
                ]}
              />
            )}
            server={server(q.data, 10, page, setPage)}
          />
        </div>
      </section>
      {editing ? (
        <StrategyDialog
          strategy={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={(t) => {
            setEditing(undefined);
            void act(async () => undefined, t);
          }}
          onError={(t) => setMsg({ text: t, tone: 'error' })}
        />
      ) : null}
    </TpShell>
  );
}

function StrategyDialog({
  strategy,
  onClose,
  onSaved,
  onError,
}: {
  strategy?: PlanningStrategy;
  onClose: () => void;
  onSaved: (t: string) => void;
  onError: (t: string) => void;
}) {
  const [name, setName] = useState(strategy?.name ?? '');
  const [category, setCategory] = useState(strategy?.category ?? 'DEDUCTIONS');
  const [description, setDescription] = useState(strategy?.description ?? '');
  const [priority, setPriority] = useState(strategy?.defaultPriority ?? 'MEDIUM');
  const [eligibility, setEligibility] = useState((strategy?.eligibility ?? []).join('\n'));
  const [active, setActive] = useState(strategy?.active ?? true);
  const lines = (s: string) =>
    s
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  return (
    <Modal
      open
      title={strategy ? 'Edit Strategy' : 'New Strategy'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={async () => {
              try {
                const body = {
                  name: name.trim(),
                  category: category as never,
                  description: description.trim() || null,
                  defaultPriority: priority as never,
                  eligibility: lines(eligibility),
                };
                if (strategy)
                  await api.taxPlanning.updateLibraryStrategy(strategy.id, { ...body, active });
                else await api.taxPlanning.createStrategy(body);
                onSaved(strategy ? 'Strategy saved.' : 'Strategy added.');
              } catch (e) {
                onError(errorMessage(e, TP_ERRORS));
                onClose();
              }
            }}
          >
            Save Strategy
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="strategy-dialog">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as never)}
            options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <Select
            label="Default priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as never)}
            options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <Textarea
          label="Description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Textarea
          label="Eligibility (one per line)"
          rows={4}
          value={eligibility}
          onChange={(e) => setEligibility(e.target.value)}
        />
        {strategy ? (
          <Checkbox
            label="Active (offered in new plans)"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
        ) : null}
      </div>
    </Modal>
  );
}

/** /tax-planning/calendar: tax deadlines and planning milestones. */
export function PlanningCalendar() {
  const [from] = useState(() => new Date().toISOString().slice(0, 10));
  const [to] = useState(() => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10));
  const q = useApiQuery([...TP_KEY, 'calendar', from, to], () =>
    api.taxPlanning.calendar({ from, to }),
  );
  const groups = new Map<string, NonNullable<typeof q.data>>();
  for (const d of q.data ?? [])
    groups.set(d.date.slice(0, 7), [...(groups.get(d.date.slice(0, 7)) ?? []), d]);
  return (
    <TpShell>
      <section className={card} aria-label="Tax calendar" data-testid="tp-calendar">
        <h2 className="mb-3 font-display text-xl font-bold text-heading">Tax Calendar</h2>
        {q.isError ? (
          <p role="alert" className={quiet}>
            The calendar is not available right now.
          </p>
        ) : null}
        {q.data && q.data.length === 0 ? (
          <p className={quiet}>
            There are no deadlines or planning milestones in the next twelve months.
          </p>
        ) : null}
        {[...groups].map(([month, items]) => (
          <div key={month} className="mb-4">
            <h3 className="mb-1 text-sm font-semibold text-muted">
              {new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric',
              })}
            </h3>
            <ul>
              {items.map((d) => (
                <li
                  key={d.id}
                  className="grid grid-cols-[6.5rem_1fr] gap-3 border-t border-divider py-2 text-sm first:border-t-0 sm:grid-cols-[6.5rem_1fr_1fr_auto]"
                >
                  <span className="text-muted">{dayText(d.date)}</span>
                  <span className="font-medium text-heading">{d.title}</span>
                  <span className="text-muted">{d.description ?? d.scope}</span>
                  <span
                    className={`w-fit rounded-pill px-2 py-0.5 text-xs font-medium ${d.kind === 'TAX_DEADLINE' ? 'bg-danger-soft text-danger' : 'bg-info-soft text-info'}`}
                  >
                    {d.kind === 'TAX_DEADLINE' ? 'Tax deadline' : 'Planning milestone'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </TpShell>
  );
}

/** /tax-planning/resources: guides and checklists, and sending one to a client. */
export function PlanningResources() {
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState<string>();
  const term = useDeferredValue(search.trim());
  const q = useApiQuery([...TP_KEY, 'resources', term], () =>
    api.taxPlanning.resources({ ...(term ? { search: term } : {}) }),
  );
  const clients = useApiQuery([...TP_KEY, 'pick-clients'], () =>
    api.taxPlanning.clients({ pageSize: 100 }),
  );
  const [clientId, setClientId] = useState('');
  const [channel, setChannel] = useState<'PORTAL_MESSAGE' | 'EMAIL'>('PORTAL_MESSAGE');
  const [note, setNote] = useState('');
  return (
    <TpShell>
      {msg ? (
        <Toast message={msg.text} tone={msg.tone} onDismiss={() => setMsg(undefined)} />
      ) : null}
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Planning resources"
        data-testid="tp-resources"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto font-display text-xl font-bold text-heading">
            Planning Resources
          </h2>
          {searchBox(search, setSearch, 'Search resources')}
        </div>
        {q.data && q.data.length === 0 ? <p className={quiet}>No resources match.</p> : null}
        <ul>
          {(q.data ?? []).map((r) => (
            <li
              key={r.key}
              className="flex flex-wrap items-center gap-3 border-t border-divider py-2 first:border-t-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-heading">{r.title}</span>
                <span className="block text-xs text-muted">
                  {r.category} · {r.kind.toLowerCase()}
                  {r.clientFacing ? '' : ' · staff only'}
                </span>
              </span>
              {r.url ? (
                <a href={r.url} className="text-sm font-medium text-link">
                  Open
                </a>
              ) : null}
              <button
                type="button"
                disabled={!r.clientFacing}
                className={`${subtle} min-h-9`}
                onClick={() => setSending(r.key)}
              >
                <PaperPlaneTilt aria-hidden weight="bold" className="size-4" /> Send to Client
              </button>
            </li>
          ))}
        </ul>
      </section>
      {sending ? (
        <Modal
          open
          title="Send Client Resource"
          subtitle={q.data?.find((r) => r.key === sending)?.title}
          onClose={() => setSending(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSending(undefined)}>
                Cancel
              </Button>
              <Button
                disabled={!clientId}
                onClick={async () => {
                  try {
                    await api.taxPlanning.sendResource(sending, {
                      clientId,
                      channel,
                      ...(note.trim() ? { message: note.trim() } : {}),
                    });
                    setMsg({ text: 'Resource sent.', tone: 'success' });
                  } catch (e) {
                    setMsg({ text: errorMessage(e, TP_ERRORS), tone: 'error' });
                  }
                  setSending(undefined);
                }}
              >
                Send
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3" data-testid="send-resource">
            <Select
              label="Client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              options={[
                { value: '', label: 'Choose a client…' },
                ...(clients.data?.items ?? []).map((c) => ({
                  value: c.client.id,
                  label: c.client.name,
                })),
              ]}
            />
            <Select
              label="Send by"
              value={channel}
              onChange={(e) => setChannel(e.target.value as never)}
              options={[
                { value: 'PORTAL_MESSAGE', label: 'Portal message' },
                { value: 'EMAIL', label: 'Email' },
              ]}
            />
            <Textarea
              label="Message (optional)"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </Modal>
      ) : null}
    </TpShell>
  );
}

/** /tax-planning/reports: projected savings by plan, with the disclaimer. */
export function PlanningReports() {
  const [page, setPage] = useState(1);
  const q = useApiQuery([...TP_KEY, 'plans-report', page], () =>
    api.taxPlanning.plans({ page, pageSize: 10 }),
  );
  const cols: Column<TaxPlanRow>[] = [
    { id: 'client', label: 'Client', cell: (r) => r.client.name },
    {
      id: 'plan',
      label: 'Plan',
      cell: (r) => (
        <Link
          href={`/tax-planning/plans/${r.id}/edit`}
          className="font-medium text-link hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    { id: 'year', label: 'Year', cell: (r) => r.planYear },
    { id: 'status', label: 'Status', cell: (r) => <PlanPill status={r.status} /> },
    { id: 'strat', label: 'Strategies', cell: (r) => r.strategyCount },
    {
      id: 'sav',
      label: 'Projected Savings',
      cell: (r) =>
        r.projectedSavingsCents === null ? 'N/A' : `${money(r.projectedSavingsCents)} (est.)`,
    },
  ];
  const total = (q.data?.items ?? []).reduce((n, r) => n + (r.projectedSavingsCents ?? 0), 0);
  return (
    <TpShell>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Savings report"
        data-testid="tp-reports"
      >
        <h2 className="font-display text-xl font-bold text-heading">Projected Savings by Plan</h2>
        <div className="relative">
          <Table
            rows={q.data?.items ?? []}
            columns={cols}
            rowKey={(r) => r.id}
            caption="Plans"
            dense
            noun="plans"
            pageSize={10}
            loading={q.isPending}
            emptyTitle={q.isError ? 'Plans are not available' : 'No plans yet'}
            emptyText={
              q.isError
                ? 'We could not load the plans. Try again in a moment.'
                : 'Create a planning plan to see projected savings.'
            }
            server={server(q.data, 10, page, setPage)}
          />
        </div>
        {q.data && q.data.items.length > 0 ? (
          <p className="text-sm font-semibold text-heading">
            On this page: {money(total)} (estimated)
          </p>
        ) : null}
        <Disclaimer text="Estimates are based on the information provided and current tax law. Actual results may vary." />
      </section>
    </TpShell>
  );
}
