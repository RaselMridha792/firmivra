'use client';

import type {
  PlanningClientRow,
  PlanningDeadline,
  PlanningResource,
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
import {
  ArrowRight,
  DotsThreeVertical,
  MagnifyingGlass,
  PaperPlaneTilt,
  Plus,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import {
  OpportunityFields,
  type OpportunityDraft,
  emptyDraft,
  fieldsOf,
} from './opportunity-fields';
import { Disclaimer, TpShell } from './tp-shell';
import {
  CATEGORY_LABEL,
  ENTITY_PRESETS,
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
  linkBtn,
  money,
  outlined,
  primary,
  quiet,
  scheduleHref,
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

/** The Clients tab's own filters (C22), kept in the address so a KPI (C01) can open them. */
const KPI_FILTERS: Record<string, string> = {
  active: 'Active planning clients',
  upcoming: 'Upcoming planning appointment (30 days)',
  strategy: 'Strategies in progress',
};

/** /tax-planning/clients: every client with their current plan. */
export function PlanningClients() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const year = new Date().getFullYear();
  const search = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const hasPlan = params.get('plan') ?? '';
  const planYear = params.get('year') ?? '';
  const staff = params.get('staff') ?? '';
  const entity = params.get('entity') ?? '';
  const active = params.get('active') === '1';
  const upcoming = params.get('upcoming') === '1';
  const strategy = params.get('strategy') === 'IN_PROGRESS' ? 'IN_PROGRESS' : '';
  const sort = params.get('sort') === 'nextAppointment' ? 'nextAppointment' : 'name';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [text, setText] = useState(search);
  const term = useDeferredValue(text.trim());
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [assigning, setAssigning] = useState<PlanningClientRow>();
  const [closing, setClosing] = useState<{ row: PlanningClientRow; kind: 'close' | 'archive' }>();
  const act = useAct(setMsg);
  const here = `${pathname}${params.toString() ? `?${params.toString()}` : ''}`;
  /** Changes the address in place; any change but the page goes back to page 1. */
  const set = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(over)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in over)) next.delete('page');
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`, {
      scroll: false,
    });
  };
  const overview = useApiQuery([...TP_KEY, 'overview'], () => api.taxPlanning.overview());
  const team = useApiQuery([...TP_KEY, 'team'], () => api.team.list());
  const q = useApiQuery(
    [
      ...TP_KEY,
      'clients',
      term,
      status,
      hasPlan,
      planYear,
      staff,
      entity,
      active,
      upcoming,
      strategy,
      sort,
      page,
    ],
    () =>
      api.taxPlanning.clients({
        ...(term ? { search: term } : {}),
        ...(status ? { status: status as never } : {}),
        ...(hasPlan ? { hasPlan: hasPlan === 'yes' } : {}),
        ...(planYear ? { planYear: Number(planYear) } : {}),
        ...(staff ? { assignedUserId: staff } : {}),
        ...(entity ? { entityType: entity } : {}),
        ...(active ? { active: true } : {}),
        ...(upcoming ? { upcomingAppointment: true } : {}),
        ...(strategy ? { strategyStatus: strategy } : {}),
        sort,
        page,
        pageSize: 10,
      }),
  );
  const kpi = active ? 'active' : upcoming ? 'upcoming' : strategy ? 'strategy' : '';
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
    { id: 'year', label: 'Year', cell: (r) => r.planYear ?? '—' },
    { id: 'status', label: 'Status', cell: (r) => <PlanPill status={r.status} /> },
    {
      id: 'next',
      label: 'Next Appointment',
      cell: (r) => (r.nextAppointmentAt ? dayText(r.nextAppointmentAt.slice(0, 10)) : '—'),
    },
    { id: 'opp', label: 'Open Opportunities', cell: (r) => r.openOpportunities },
    {
      id: 'sav',
      label: 'Potential Savings',
      cell: (r) =>
        r.potentialSavingsCents === null ? '—' : `${money(r.potentialSavingsCents)} (est.)`,
    },
    { id: 'by', label: 'Assigned To', cell: (r) => r.assignedTo?.name ?? '—' },
  ];
  const open = (r: PlanningClientRow) => !!r.planId && r.status !== 'CLOSED';
  const duplicate = async (r: PlanningClientRow) => {
    const copy = await act(
      () => api.taxPlanning.duplicatePlan(r.planId as string, {}),
      'Plan duplicated: the copy is a Draft you can edit.',
    );
    if (copy) router.push(`/tax-planning/plans/${copy.id}/edit`);
  };
  return (
    <TpShell>
      {msg ? (
        <Toast tone={msg.tone} message={msg.text} onDismiss={() => setMsg(undefined)} />
      ) : null}
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Planning clients"
        data-testid="tp-clients"
      >
        <div className="flex flex-wrap items-end gap-3">
          {searchBox(
            text,
            (v) => {
              setText(v);
              set({ q: v.trim() || null });
            },
            'Search clients or plans',
          )}
          <div className="w-40">
            <Select
              label="Plan status"
              hideLabel
              value={status}
              onChange={(e) => set({ status: e.target.value })}
              options={[
                { value: '', label: 'All Statuses' },
                ...Object.entries(PLAN_STATUS).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          <div className="w-40">
            <Select
              label="Has a plan"
              hideLabel
              value={hasPlan}
              onChange={(e) => set({ plan: e.target.value })}
              options={[
                { value: '', label: 'All Clients' },
                { value: 'yes', label: 'With a plan' },
                { value: 'no', label: 'Without a plan' },
              ]}
            />
          </div>
          <div className="w-32">
            <Select
              label="Planning year"
              hideLabel
              value={planYear}
              onChange={(e) => set({ year: e.target.value })}
              options={[
                { value: '', label: 'All Years' },
                ...[year + 1, year, year - 1, year - 2].map((y) => ({
                  value: String(y),
                  label: String(y),
                })),
              ]}
            />
          </div>
          <div className="w-44">
            <Select
              label="Assigned staff"
              hideLabel
              value={staff}
              onChange={(e) => set({ staff: e.target.value })}
              options={[
                { value: '', label: 'All Staff' },
                ...(team.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name })),
              ]}
            />
          </div>
          <div className="w-40">
            <Select
              label="Entity type"
              hideLabel
              value={entity}
              onChange={(e) => set({ entity: e.target.value })}
              options={[
                { value: '', label: 'All Entities' },
                ...ENTITY_PRESETS.map((v) => ({ value: v, label: v })),
              ]}
            />
          </div>
          <Link href="/tax-planning/plans/new" className={`${gold} ml-auto`}>
            <Plus aria-hidden weight="bold" className="size-4" /> Create Planning Plan
          </Link>
        </div>
        {kpi ? (
          <p
            className="flex flex-wrap items-center gap-2 text-sm text-muted"
            data-testid="kpi-filter"
          >
            Showing: <span className="font-semibold text-heading">{KPI_FILTERS[kpi]}</span>
            <button
              type="button"
              className="text-link underline"
              onClick={() => set({ active: null, upcoming: null, strategy: null, sort: null })}
            >
              Show all clients
            </button>
          </p>
        ) : null}
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
                      ...(r.planId
                        ? [
                            {
                              label: 'View Plan',
                              onSelect: () =>
                                router.push(`/tax-planning/plans/${r.planId}/edit/review`),
                            },
                          ]
                        : []),
                      ...(open(r)
                        ? [
                            {
                              label: 'Edit Plan',
                              onSelect: () => router.push(`/tax-planning/plans/${r.planId}/edit`),
                            },
                          ]
                        : []),
                      // Review 2 approved addition: an editable copy (a Draft), the original kept.
                      ...(r.planId
                        ? [{ label: 'Duplicate Plan', onSelect: () => void duplicate(r) }]
                        : []),
                      {
                        label: 'Create Plan',
                        onSelect: () =>
                          router.push(`/tax-planning/plans/new?clientId=${r.client.id}`),
                      },
                    ],
                  },
                  {
                    items: [
                      {
                        label: 'Schedule',
                        onSelect: () =>
                          router.push(
                            scheduleHref(overview.data?.planningServiceId, here, r.client.id),
                          ),
                      },
                      {
                        label: 'Send Resource',
                        onSelect: () =>
                          router.push(`/tax-planning/resources?clientId=${r.client.id}`),
                      },
                      {
                        label: 'Opportunities',
                        onSelect: () =>
                          router.push(`/tax-planning/opportunities?clientId=${r.client.id}`),
                      },
                      ...(open(r)
                        ? [{ label: 'Assign Staff', onSelect: () => setAssigning(r) }]
                        : []),
                    ],
                  },
                  ...(r.planId
                    ? [
                        {
                          items: [
                            ...(open(r)
                              ? [
                                  {
                                    label: 'Close Plan',
                                    onSelect: () => setClosing({ row: r, kind: 'close' as const }),
                                  },
                                ]
                              : []),
                            {
                              label: 'Archive Plan',
                              onSelect: () => setClosing({ row: r, kind: 'archive' as const }),
                            },
                          ],
                        },
                      ]
                    : []),
                ]}
              />
            )}
            server={server(q.data, 10, page, (n) => set({ page: n > 1 ? String(n) : null }))}
          />
        </div>
      </section>
      {assigning?.planId ? (
        <AssignStaff
          row={assigning}
          team={(team.data ?? []).map((m) => ({ id: m.user.id, name: m.user.name }))}
          onClose={() => setAssigning(undefined)}
          onSave={async (userId) => {
            const planId = assigning.planId as string;
            const done = await act(async () => {
              const p = await api.taxPlanning.plan(planId);
              return api.taxPlanning.updatePlan(planId, { assignedUserId: userId, etag: p.etag });
            }, 'Staff assigned.');
            if (done) setAssigning(undefined);
          }}
        />
      ) : null}
      {closing?.row.planId ? (
        <Modal
          open
          title={closing.kind === 'close' ? 'Close this plan?' : 'Archive this plan?'}
          onClose={() => setClosing(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setClosing(undefined)}>
                Keep it
              </Button>
              <Button
                onClick={async () => {
                  const planId = closing.row.planId as string;
                  const done =
                    closing.kind === 'close'
                      ? await act(async () => {
                          const p = await api.taxPlanning.plan(planId);
                          return api.taxPlanning.setStatus(planId, {
                            status: 'CLOSED',
                            etag: p.etag,
                          });
                        }, 'Plan closed.')
                      : await act(() => api.taxPlanning.archivePlan(planId), 'Plan archived.');
                  if (done) setClosing(undefined);
                }}
              >
                {closing.kind === 'close' ? 'Close Plan' : 'Archive Plan'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            {closing.kind === 'close'
              ? `${closing.row.planName ?? 'The plan'} for ${closing.row.client.name} is closed: it can no longer be changed.`
              : `${closing.row.planName ?? 'The plan'} for ${closing.row.client.name} leaves the lists. It is kept, and Restore brings it back.`}
          </p>
        </Modal>
      ) : null}
    </TpShell>
  );
}

/** C03 (Review 2): Assign Staff from the Clients menu: who works on the client's current plan. */
function AssignStaff({
  row,
  team,
  onClose,
  onSave,
}: {
  row: PlanningClientRow;
  team: { id: string; name: string }[];
  onClose: () => void;
  onSave: (userId: string | null) => Promise<void>;
}) {
  const [userId, setUserId] = useState(row.assignedTo?.userId ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title="Assign Staff"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onSave(userId || null);
              setBusy(false);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        {row.planName} for {row.client.name}
      </p>
      <Select
        label="Assigned staff"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        options={[
          { value: '', label: 'Not assigned' },
          ...team.map((m) => ({ value: m.id, label: m.name })),
        ]}
      />
    </Modal>
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
  // C03 (Review 2): the Clients menu's Opportunities opens the queue on that client.
  const clientId = useSearchParams().get('clientId') ?? '';
  const term = useDeferredValue(search.trim());
  const q = useApiQuery(
    [...TP_KEY, 'opps', term, status, category, priority, group, clientId, page],
    () =>
      api.taxPlanning.opportunities({
        ...(clientId ? { clientId } : {}),
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
                // C11 (Review 2): a group and a status of the other group would list nothing.
                setStatus('');
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
                // C11 (Review 2): a status picks its own group (Closed is found under Closed).
                if (e.target.value) setGroup('');
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
  // C10 (Review 2): the reasoning is entered with the opportunity, not left blank.
  const [draft, setDraft] = useState<OpportunityDraft>(emptyDraft);
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
                  ...fieldsOf(draft, true),
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
        <OpportunityFields draft={draft} onChange={setDraft} showData />
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
  const [viewing, setViewing] = useState<PlanningStrategy>();
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
                      { label: 'View Details', onSelect: () => setViewing(r) },
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
      {viewing ? (
        <StrategyView
          strategy={viewing}
          onClose={() => setViewing(undefined)}
          onEdit={() => {
            setViewing(undefined);
            setEditing(viewing);
          }}
        />
      ) : null}
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
  // C13 (Review 2): the structured fields a strategy carries into plans and opportunities.
  const [inputs, setInputs] = useState<string[]>(strategy?.requiredInputs ?? []);
  const [documents, setDocuments] = useState((strategy?.requiredDocuments ?? []).join('\n'));
  const [checklist, setChecklist] = useState((strategy?.implementationChecklist ?? []).join('\n'));
  const catalog = useApiQuery([...TP_KEY, 'input-catalog'], () => api.taxPlanning.inputCatalog());
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
                  requiredInputs: inputs,
                  requiredDocuments: lines(documents),
                  implementationChecklist: lines(checklist),
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
        <fieldset className="flex flex-col gap-1" data-testid="required-inputs">
          <legend className="mb-1 text-sm font-medium text-heading">Required Inputs</legend>
          <p className="text-xs text-muted">
            The client figures the estimate and the screening read for this strategy.
          </p>
          <div className="grid max-h-40 gap-x-4 overflow-auto sm:grid-cols-2">
            {(catalog.data ?? []).map((c) => (
              <Checkbox
                key={c.key}
                label={c.label}
                checked={inputs.includes(c.key)}
                onChange={(e) =>
                  setInputs(
                    e.target.checked ? [...inputs, c.key] : inputs.filter((k) => k !== c.key),
                  )
                }
              />
            ))}
          </div>
        </fieldset>
        <Textarea
          label="Required Documents (one per line)"
          rows={3}
          value={documents}
          onChange={(e) => setDocuments(e.target.value)}
        />
        <Textarea
          label="Implementation Checklist (one step per line)"
          rows={4}
          value={checklist}
          onChange={(e) => setChecklist(e.target.value)}
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

/**
 * C23 (Review 2): a library strategy, read-only: its description, eligibility, required inputs,
 * documents and implementation checklist. Edit stays a separate, authorized step.
 */
function StrategyView({
  strategy: s,
  onClose,
  onEdit,
}: {
  strategy: PlanningStrategy;
  onClose: () => void;
  onEdit: () => void;
}) {
  const catalog = useApiQuery([...TP_KEY, 'input-catalog'], () => api.taxPlanning.inputCatalog());
  const label = (key: string) => catalog.data?.find((c) => c.key === key)?.label ?? key;
  const list = (items: string[], empty: string) =>
    items.length ? (
      <ul className="list-disc pl-5">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    ) : (
      <p className="text-muted">{empty}</p>
    );
  return (
    <Modal
      open
      title={s.name}
      subtitle={`${CATEGORY_LABEL[s.category] ?? s.category} · ${s.archived ? 'Archived' : s.active ? 'Active' : 'Inactive'}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {s.archived ? null : <Button onClick={onEdit}>Edit</Button>}
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm" data-testid="strategy-view">
        <p className="text-text">{s.description ?? 'No description.'}</p>
        <p className="text-muted">
          Default priority {PRIORITY_LABEL[s.defaultPriority] ?? s.defaultPriority} · In{' '}
          {s.planCount} plan(s) · {s.openOpportunityCount} open opportunities
        </p>
        <div>
          <h3 className="mb-1 font-semibold text-heading">Eligibility</h3>
          {list(s.eligibility, 'No eligibility criteria.')}
        </div>
        <div>
          <h3 className="mb-1 font-semibold text-heading">Required Inputs</h3>
          {list(s.requiredInputs.map(label), 'No required inputs.')}
        </div>
        <div>
          <h3 className="mb-1 font-semibold text-heading">Required Documents</h3>
          {list(s.requiredDocuments, 'No required documents.')}
        </div>
        <div>
          <h3 className="mb-1 font-semibold text-heading">Implementation Checklist</h3>
          {list(s.implementationChecklist, 'No implementation steps.')}
        </div>
      </div>
    </Modal>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthTitle = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const shiftMonth = (month: string, by: number) => {
  const d = new Date(`${month}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};
const kindPill = (kind: PlanningDeadline['kind']) => (
  <span
    className={`w-fit rounded-pill px-2 py-0.5 text-xs font-medium ${kind === 'TAX_DEADLINE' ? 'bg-danger-soft text-danger' : 'bg-info-soft text-info'}`}
  >
    {kind === 'TAX_DEADLINE' ? 'Tax deadline' : 'Planning milestone'}
  </span>
);

/**
 * /tax-planning/calendar: tax deadlines and planning milestones for twelve months, as a list or a
 * month calendar (C16), each opening its details and the clients it affects (C04). The view, the
 * month and the open item live in the address.
 */
export function PlanningCalendar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [from] = useState(() => new Date().toISOString().slice(0, 10));
  const [to] = useState(() => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10));
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list';
  const first = from.slice(0, 7);
  const last = to.slice(0, 7);
  const asked = params.get('month') ?? '';
  const month = /^\d{4}-\d{2}$/.test(asked) && asked >= first && asked <= last ? asked : first;
  const openId = params.get('item');
  const q = useApiQuery([...TP_KEY, 'calendar', from, to], () =>
    api.taxPlanning.calendar({ from, to }),
  );
  const set = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(over)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`, {
      scroll: false,
    });
  };
  const here = `${pathname}${params.toString() ? `?${params.toString()}` : ''}`;
  const opened = openId ? q.data?.find((d) => d.id === openId) : undefined;
  const groups = new Map<string, NonNullable<typeof q.data>>();
  for (const d of q.data ?? [])
    groups.set(d.date.slice(0, 7), [...(groups.get(d.date.slice(0, 7)) ?? []), d]);
  const itemButton = (d: PlanningDeadline, compact: boolean) => (
    <button
      type="button"
      onClick={() => set({ item: d.id })}
      data-testid="calendar-item"
      className={
        compact
          ? `block w-full truncate rounded px-1 text-left text-xs font-medium ${d.kind === 'TAX_DEADLINE' ? 'bg-danger-soft text-danger' : 'bg-info-soft text-info'}`
          : 'font-medium text-link hover:underline'
      }
    >
      {d.title}
    </button>
  );

  // The month grid: the weeks that hold the month's days, Sunday first.
  const start = new Date(`${month}-01T12:00:00Z`);
  const lead = start.getUTCDay();
  const daysIn = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <TpShell>
      <section className={card} aria-label="Tax calendar" data-testid="tp-calendar">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="mr-auto font-display text-xl font-bold text-heading">Tax Calendar</h2>
          <div
            role="group"
            aria-label="Calendar view"
            className="inline-flex rounded-control border border-divider p-0.5"
          >
            {(['calendar', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                data-testid={`view-${v}`}
                onClick={() => set({ view: v === 'list' ? null : v })}
                className={`min-h-9 rounded-control px-3 text-sm font-medium ${view === v ? 'bg-action text-on-action' : 'text-text hover:bg-canvas'}`}
              >
                {v === 'calendar' ? 'Calendar' : 'List'}
              </button>
            ))}
          </div>
        </div>
        {q.isError ? (
          <p role="alert" className={quiet}>
            The calendar is not available right now.
          </p>
        ) : null}
        {view === 'list' && q.data && q.data.length === 0 ? (
          <p className={quiet}>
            There are no deadlines or planning milestones in the next twelve months.
          </p>
        ) : null}
        {view === 'list'
          ? [...groups].map(([m, items]) => (
              <div key={m} className="mb-4">
                <h3 className="mb-1 text-sm font-semibold text-muted">{monthTitle(m)}</h3>
                <ul>
                  {items.map((d) => (
                    <li
                      key={d.id}
                      className="grid grid-cols-[6.5rem_1fr] gap-3 border-t border-divider py-2 text-sm first:border-t-0 sm:grid-cols-[6.5rem_1fr_1fr_auto]"
                    >
                      <span className="text-muted">{dayText(d.date)}</span>
                      <span>{itemButton(d, false)}</span>
                      <span className="text-muted">{d.description ?? d.scope}</span>
                      {kindPill(d.kind)}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          : null}
        {view === 'calendar' ? (
          <div data-testid="month-grid">
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                className={subtle}
                disabled={month <= first}
                onClick={() => set({ month: shiftMonth(month, -1) })}
              >
                Previous
              </button>
              <h3 className="font-display text-lg font-bold text-heading" aria-live="polite">
                {monthTitle(month)}
              </h3>
              <button
                type="button"
                className={subtle}
                disabled={month >= last}
                onClick={() => set({ month: shiftMonth(month, 1) })}
              >
                Next
              </button>
            </div>
            <div className="overflow-x-auto">
              <div className="grid min-w-[42rem] grid-cols-7 border-l border-t border-divider text-sm">
                {WEEKDAYS.map((w) => (
                  <div
                    key={w}
                    className="border-b border-r border-divider bg-canvas px-2 py-1 text-xs font-semibold text-muted"
                  >
                    {w}
                  </div>
                ))}
                {cells.map((day, i) => {
                  const items = day ? (q.data ?? []).filter((d) => d.date === day) : [];
                  return (
                    <div
                      key={day ?? `pad-${i}`}
                      className={`min-h-24 border-b border-r border-divider p-1 ${day ? '' : 'bg-canvas'}`}
                    >
                      {day ? (
                        <>
                          <span className="block text-xs text-muted">{Number(day.slice(8))}</span>
                          <ul className="flex flex-col gap-0.5">
                            {items.map((d) => (
                              <li key={d.id}>{itemButton(d, true)}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </section>
      {openId && q.data ? (
        <Modal
          open
          title={opened?.title ?? 'Not found'}
          subtitle={opened ? dayText(opened.date) : undefined}
          onClose={() => set({ item: null })}
          footer={
            <Button variant="secondary" onClick={() => set({ item: null })}>
              Close
            </Button>
          }
        >
          {opened ? (
            <div className="flex flex-col gap-3 text-sm" data-testid="deadline-details">
              {kindPill(opened.kind)}
              {opened.description ? <p className="text-text">{opened.description}</p> : null}
              {opened.scope ? <p className="text-muted">{opened.scope}</p> : null}
              <h3 className="font-semibold text-heading">
                {opened.kind === 'TAX_DEADLINE' ? 'Affected clients' : 'Client'} (
                {opened.clientCount})
              </h3>
              {opened.clients.length === 0 ? (
                <p className={quiet}>No client is linked to this date.</p>
              ) : (
                <ul data-testid="affected-clients">
                  {opened.clients.map((c) => (
                    <li
                      key={`${c.client.id}-${c.deadlineId ?? c.planId}`}
                      className="flex items-center justify-between gap-2 border-t border-divider py-1.5 first:border-t-0"
                    >
                      <span className="flex items-center gap-2">
                        <Avatar name={c.client.name} size="sm" />
                        {c.client.name}
                      </span>
                      <Link
                        href={
                          c.deadlineId
                            ? `/compliance/${c.deadlineId}?from=${encodeURIComponent(here)}`
                            : `/tax-planning/plans/${c.planId}/edit`
                        }
                        className="font-medium text-link"
                      >
                        {c.deadlineId ? 'Open deadline' : 'Open plan'}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {opened.clientCount > opened.clients.length ? (
                <p className="text-muted">
                  And {opened.clientCount - opened.clients.length} more. See them in Compliance
                  &amp; Deadlines.
                </p>
              ) : null}
            </div>
          ) : (
            <p className={quiet}>That date is no longer on the calendar.</p>
          )}
        </Modal>
      ) : null}
    </TpShell>
  );
}

/** /tax-planning/resources: guides and checklists, and sending one to a client. */
export function PlanningResources() {
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState<string>();
  const [viewing, setViewing] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const term = useDeferredValue(search.trim());
  const q = useApiQuery([...TP_KEY, 'resources', term], () =>
    api.taxPlanning.resources({ ...(term ? { search: term } : {}) }),
  );
  const clients = useApiQuery([...TP_KEY, 'pick-clients'], () =>
    api.taxPlanning.clients({ pageSize: 100 }),
  );
  // C03 (Review 2): Send Resource from the Clients menu opens here with that client chosen.
  const presetClient = useSearchParams().get('clientId') ?? '';
  const [clientId, setClientId] = useState(presetClient);
  const [channel, setChannel] = useState<'PORTAL_MESSAGE' | 'EMAIL'>('PORTAL_MESSAGE');
  const [note, setNote] = useState('');
  const presetName = clients.data?.items.find((c) => c.client.id === presetClient)?.client.name;
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
        {presetName ? (
          <p className="text-sm text-muted" data-testid="resource-for">
            Choose a resource to send to{' '}
            <span className="font-semibold text-heading">{presetName}</span>.
          </p>
        ) : null}
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
              <button
                type="button"
                className="text-sm font-medium text-link"
                data-testid="view-resource"
                onClick={() => setViewing(r.key)}
              >
                View
              </button>
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
      {viewing ? (
        <ResourceView
          resource={q.data?.find((r) => r.key === viewing)}
          onClose={() => setViewing(undefined)}
          onSend={() => {
            setSending(viewing);
            setViewing(undefined);
          }}
          onEdit={() => {
            setEditing(viewing);
            setViewing(undefined);
          }}
        />
      ) : null}
      {editing ? (
        <ResourceEdit
          resource={q.data?.find((r) => r.key === editing)}
          onClose={() => setEditing(undefined)}
          onSaved={(t) => {
            setEditing(undefined);
            setMsg({ text: t, tone: 'success' });
          }}
          onError={(t) => setMsg({ text: t, tone: 'error' })}
        />
      ) : null}
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
                  setClientId(presetClient);
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

/**
 * C17 (Review 2): a resource, read-only: what it is, who it is for and what it says. A staff-only
 * one is never sent to a client. Editing the firm's own copy needs the resources table (TP-D).
 */
function ResourceView({
  resource: r,
  onClose,
  onSend,
  onEdit,
}: {
  resource: PlanningResource | undefined;
  onClose: () => void;
  onSend: () => void;
  onEdit: () => void;
}) {
  return (
    <Modal
      open
      title={r?.title ?? 'Resource'}
      subtitle={r ? `${r.category} · ${r.kind.toLowerCase()}` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {r ? (
            <Button variant="secondary" onClick={onEdit}>
              Edit
            </Button>
          ) : null}
          {r?.clientFacing ? <Button onClick={onSend}>Send to Client</Button> : null}
        </>
      }
    >
      {r ? (
        <div className="flex flex-col gap-3 text-sm" data-testid="resource-view">
          <span
            className={`w-fit rounded-pill px-2 py-0.5 text-xs font-medium ${r.clientFacing ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}
          >
            {r.clientFacing ? 'Client-facing' : 'Staff only: never sent to a client'}
          </span>
          <p className="text-text">{r.summary ?? 'No summary.'}</p>
          {r.edited ? (
            <p className="text-xs text-muted">Edited by your firm; the built-in version is kept.</p>
          ) : null}
          {r.url ? (
            <a href={r.url} className="w-fit font-medium text-link">
              Open the full resource
            </a>
          ) : null}
        </div>
      ) : (
        <p className={quiet}>This resource is no longer listed.</p>
      )}
    </Modal>
  );
}

/**
 * C17 (Review 2): Edit a resource in the firm's own words: its title, category, kind, what a
 * client is sent with it, and whether it may go to a client at all (Manage Strategies; the API
 * refuses anyone else). The built-in resource is kept.
 */
function ResourceEdit({
  resource: r,
  onClose,
  onSaved,
  onError,
}: {
  resource: PlanningResource | undefined;
  onClose: () => void;
  onSaved: (t: string) => void;
  onError: (t: string) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(r?.title ?? '');
  const [category, setCategory] = useState(r?.category ?? '');
  const [kind, setKind] = useState<PlanningResource['kind']>(r?.kind ?? 'GUIDE');
  const [summary, setSummary] = useState(r?.summary ?? '');
  const [clientFacing, setClientFacing] = useState(r?.clientFacing ?? false);
  const [busy, setBusy] = useState(false);
  if (!r) return null;
  return (
    <Modal
      open
      title="Edit Resource"
      subtitle={r.title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !title.trim() || !category.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.taxPlanning.updateResource(r.key, {
                  title: title.trim(),
                  category: category.trim(),
                  kind,
                  summary: summary.trim() || null,
                  clientFacing,
                });
                await qc.invalidateQueries({ queryKey: [...TP_KEY] });
                onSaved('Resource saved.');
              } catch (e) {
                onError(errorMessage(e, TP_ERRORS));
              }
              setBusy(false);
            }}
          >
            Save Resource
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="resource-edit">
        <Input
          label="Title *"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input
          label="Category *"
          value={category}
          maxLength={100}
          onChange={(e) => setCategory(e.target.value)}
        />
        <Select
          label="Kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as PlanningResource['kind'])}
          options={['GUIDE', 'CHECKLIST', 'PDF', 'VIDEO', 'ARTICLE'].map((v) => ({
            value: v,
            label: v.charAt(0) + v.slice(1).toLowerCase(),
          }))}
        />
        <Textarea
          label="Summary (sent to the client with it)"
          rows={4}
          maxLength={1000}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <Checkbox
          label="Client-facing: may be sent to a client"
          checked={clientFacing}
          onChange={(e) => setClientFacing(e.target.checked)}
        />
      </div>
    </Modal>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl font-bold text-heading">Projected Savings by Plan</h2>
          {/*
            C18 (Review 2): the firm's own reports stay in Reports. This opens them on the Tax
            category, with Back to Tax Planning, and Reports' own filters reach every service area.
          */}
          <Link
            href={`/reports/library?category=TAX&from=${encodeURIComponent('/tax-planning/reports')}`}
            className={linkBtn}
            data-testid="open-in-reports"
          >
            Open Tax reports in Reports <ArrowRight aria-hidden weight="bold" className="size-3" />
          </Link>
        </div>
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
