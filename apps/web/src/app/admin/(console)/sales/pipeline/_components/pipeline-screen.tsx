'use client';

import { PageHeader, Toast, type DateRange } from '@firmivra/ui';
import {
  CaretDown,
  Clock,
  CurrencyDollar,
  FlowArrow,
  Flask,
  Percent,
  Plus,
  UserPlus,
  Users,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import {
  adminSales,
  matchesQuery,
  type OpportunityQuery,
  type PipelineStage,
  type SalesOpportunity,
  type SalesView,
} from '../../../../../../mocks/admin-sales';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { AddLeadPanel, usePipelines } from '../../_components/add-lead-panel';
import { ActivityDrawer, AppointmentsDrawer } from '../../_components/feed-drawers';
import { MoveStageDialog } from '../../_components/move-stage-dialog';
import {
  Crumbs,
  FrameError,
  money,
  SALES_KEY,
  SalesKpi,
  useSalesMeta,
} from '../../_components/sales-ui';
import { needsEntryData } from '../../_components/stage-entry-fields';
import { BoardSkeleton, PipelineBoard } from './pipeline-board';
import {
  monthOf,
  NO_FILTERS,
  PipelineFilterBar,
  PipelineToggles,
  type PipelineFilters,
} from './pipeline-filters';
import { PipelineList } from './pipeline-list';
import {
  PipelineAnalyticsPanel,
  RecentActivityPanel,
  UpcomingAppointmentsPanel,
} from './pipeline-panels';

/** "Add Lead / Opportunity" with its menu: Add Lead, Add Opportunity, Build Pipeline. */
function AddMenu({
  onAdd,
  canBuild,
}: {
  onAdd: (mode: 'LEAD' | 'OPPORTUNITY') => void;
  canBuild: boolean;
}) {
  const close = (target: HTMLElement) => target.closest('details')?.removeAttribute('open');
  const item =
    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-text hover:bg-canvas focus-visible:bg-canvas';
  return (
    <div className="flex">
      <button
        type="button"
        onClick={() => onAdd('LEAD')}
        className="inline-flex min-h-11 items-center gap-2 rounded-l-lg bg-action px-4 text-base font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <Plus aria-hidden weight="bold" className="size-5" />
        Add Lead / Opportunity
      </button>
      <details className="relative">
        <summary
          aria-label="More ways to add"
          className="flex min-h-11 cursor-pointer list-none items-center rounded-r-lg border-l border-on-action/40 bg-action px-3 text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <CaretDown aria-hidden weight="bold" className="size-4" />
        </summary>
        <div className="absolute top-full right-0 z-30 mt-1 w-56 rounded-xl border border-divider bg-surface p-1.5 shadow-lg">
          <button
            type="button"
            className={item}
            onClick={(event) => {
              close(event.currentTarget);
              onAdd('LEAD');
            }}
          >
            <UserPlus aria-hidden weight="fill" className="size-4 text-action" />
            Add Lead
          </button>
          <button
            type="button"
            className={item}
            onClick={(event) => {
              close(event.currentTarget);
              onAdd('OPPORTUNITY');
            }}
          >
            <Plus aria-hidden weight="bold" className="size-4 text-action" />
            Add Opportunity
          </button>
          {canBuild ? (
            <Link href="/sales/pipeline/builder" className={item}>
              <FlowArrow aria-hidden weight="fill" className="size-4 text-action" />
              Build Pipeline
            </Link>
          ) : null}
        </div>
      </details>
    </div>
  );
}

/** The query the filters stand for (empty values left out). */
function queryOf(filters: PipelineFilters, range: DateRange): OpportunityQuery {
  return {
    search: filters.search.trim() || undefined,
    stageId: filters.stageId || undefined,
    ownerId: filters.ownerId || undefined,
    plan: filters.plan || undefined,
    source: filters.source || undefined,
    tagId: filters.tagId || undefined,
    from: range.from || undefined,
    to: range.to || undefined,
    overdueOnly: filters.overdueOnly || undefined,
    unassignedOnly: filters.unassignedOnly || undefined,
    attentionOnly: filters.attentionOnly || undefined,
    scope: filters.scope || undefined,
  };
}

/**
 * Sales Pipeline (docx §4–§12): KPI row, filters, the card and list views of one dataset, and
 * Recent Activity, Upcoming Appointments and Pipeline Analytics underneath.
 */
export function PipelineScreen() {
  const meta = useSalesMeta();
  const pipelines = usePipelines();
  const [pipelineChoice, setPipelineChoice] = useState<string | null>(null);
  const [filters, setFilters] = useState<PipelineFilters>(NO_FILTERS);
  const [viewChoice, setViewChoice] = useState<SalesView | null>(null);
  const [adding, setAdding] = useState<{ mode: 'LEAD' | 'OPPORTUNITY'; stageId?: string } | null>(
    null,
  );
  const [moving, setMoving] = useState<{ opp: SalesOpportunity; stage: PipelineStage } | null>(
    null,
  );
  const [drawer, setDrawer] = useState<'activity' | 'appointments' | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const pipeline =
    pipelines.data?.find((item) => item.id === pipelineChoice) ??
    pipelines.data?.find((item) => item.isDefault);
  // The chosen pipeline, or none for the default: query keys stay put while the list loads.
  const pipelineId = pipelineChoice ?? undefined;
  const stages = (pipeline?.stages ?? []).filter(
    (stage) => stage.active || (pipeline?.recordCounts[stage.id] ?? 0) > 0,
  );
  const defaultRange = meta.data ? monthOf(meta.data.today) : { from: '', to: '' };
  const range = filters.range ?? defaultRange;
  const query = queryOf(filters, range);
  // Every record of the pipeline once; the filters run here, so each change applies at once.
  const records = useApiQuery([...SALES_KEY, 'opportunities', { pipelineId }], () =>
    adminSales.opportunities({ pipelineId }),
  );
  const shown = records.data?.filter((record) => matchesQuery(record, query));
  const kpis = useApiQuery([...SALES_KEY, 'pipeline-kpis', pipelineId ?? 'default'], () =>
    adminSales.pipelineKpis(pipelineId),
  );
  const preference = useApiQuery([...SALES_KEY, 'view'], () => adminSales.viewPreference());
  const saveView = useApiMutation((value: SalesView) => adminSales.setViewPreference(value));
  const move = useApiMutation(
    (body: { id: string; stageId: string }) => adminSales.moveStage(body),
    { invalidate: SALES_KEY },
  );
  const view: SalesView = viewChoice ?? preference.data ?? 'CARD';
  const canManage = meta.data?.permissions.managePipelines ?? false;

  function changeView(next: SalesView) {
    setViewChoice(next);
    saveView.mutate(next);
  }

  function requestMove(opp: SalesOpportunity, stage: PipelineStage) {
    if (
      needsEntryData(stage, {
        hasAppointment: Boolean(opp.nextAppointment),
        hasTransaction: Boolean(opp.transaction),
      })
    ) {
      setMoving({ opp, stage });
      return;
    }
    move.mutate(
      { id: opp.id, stageId: stage.id },
      {
        onSuccess: (moved) =>
          setToast({ message: `Moved ${moved.firmName} to ${moved.stageName}.`, tone: 'success' }),
        onError: (error) => setToast({ message: errorMessage(error), tone: 'error' }),
      },
    );
  }

  /** A KPI shows its records across all dates (the KPIs count the whole pipeline). */
  function showScope(patch: Partial<PipelineFilters>) {
    setFilters({
      ...NO_FILTERS,
      search: filters.search,
      range: { from: '', to: '' },
      ...patch,
    });
  }

  const kpiState = kpis.isPending ? 'loading' : kpis.isError && !kpis.data ? 'error' : 'ready';
  const data = kpis.data;
  const visibleStages = filters.stageId
    ? stages.filter((stage) => stage.id === filters.stageId)
    : stages.filter((stage) => stage.active);

  return (
    <div data-testid="sales-pipeline" className="flex min-w-0 flex-col gap-4">
      <PageHeader
        above={
          <Crumbs
            items={[
              { label: 'Dashboard', href: '/' },
              { label: 'Sales', href: '/sales' },
              { label: 'Pipeline' },
            ]}
          />
        }
        title="Sales Pipeline"
        subtitle="Move leads from first contact to closed, track progress, and grow your business."
        actions={<AddMenu onAdd={(mode) => setAdding({ mode })} canBuild={canManage} />}
      />

      <section
        aria-label="Pipeline numbers"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1440px]:grid-cols-6"
      >
        <SalesKpi
          testId="kpi-total"
          icon={Users}
          tone="blue"
          label="Total Opportunities"
          state={kpiState}
          value={String(data?.totalOpportunities.value ?? 0)}
          trend={data?.totalOpportunities.trend}
          note="vs. previous 30 days"
          pressed={!filters.scope && !filters.attentionOnly && filters.range?.from === ''}
          onClick={() => showScope({})}
        />
        <SalesKpi
          testId="kpi-in-progress"
          icon={Flask}
          tone="purple"
          label="In Progress"
          state={kpiState}
          value={String(data?.inProgress.value ?? 0)}
          trend={data?.inProgress.trend}
          pressed={filters.scope === 'IN_PROGRESS'}
          onClick={() => showScope({ scope: 'IN_PROGRESS' })}
        />
        <SalesKpi
          testId="kpi-value"
          icon={CurrencyDollar}
          tone="green"
          label="Pipeline Value"
          state={kpiState}
          value={money(data?.pipelineValueCents.value ?? 0)}
          trend={data?.pipelineValueCents.trend}
          pressed={filters.scope === 'PIPELINE'}
          onClick={() => showScope({ scope: 'PIPELINE' })}
        />
        <SalesKpi
          testId="kpi-conversion"
          icon={Percent}
          tone="orange"
          label="Conversion Rate"
          state={kpiState}
          value={`${data?.conversionRate.value ?? 0}%`}
          trend={data?.conversionRate.trend}
          pressed={filters.scope === 'CONVERTED'}
          onClick={() => showScope({ scope: 'CONVERTED' })}
        />
        <SalesKpi
          testId="kpi-clients"
          icon={Users}
          tone="blue"
          label="Active Clients"
          state={kpiState}
          value={String(data?.activeClients ?? 0)}
          note="Converted, not yet under contract"
          pressed={filters.scope === 'CLIENTS'}
          onClick={() => showScope({ scope: 'CLIENTS' })}
        />
        <SalesKpi
          testId="kpi-attention"
          icon={Clock}
          tone="orange"
          label="Needs Attention"
          alert
          state={kpiState}
          value={String(data?.needsAttention ?? 0)}
          note="Overdue or no activity"
          pressed={filters.attentionOnly}
          onClick={() => showScope({ attentionOnly: true })}
        />
      </section>

      <div className="flex flex-col gap-3">
        <PipelineFilterBar
          filters={filters}
          onChange={setFilters}
          meta={meta.data}
          stages={stages}
          range={range}
          defaultRange={defaultRange}
          pipelines={pipelines.data ?? []}
          pipelineId={pipeline?.id ?? ''}
          onPipeline={(id) => {
            setPipelineChoice(id);
            setFilters({ ...filters, stageId: '' });
          }}
        />
        <PipelineToggles
          filters={filters}
          onChange={setFilters}
          view={view}
          onView={changeView}
          onClear={() => setFilters(NO_FILTERS)}
        />
      </div>

      {toast ? (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      ) : null}

      <section
        aria-label={view === 'CARD' ? 'Card view' : 'List view'}
        data-testid="pipeline-workspace"
      >
        {pipelines.isPending || records.isPending ? (
          <BoardSkeleton />
        ) : (pipelines.isError && !pipelines.data) || (records.isError && !records.data) ? (
          <div className="rounded-xl bg-surface p-4 shadow-md">
            <FrameError
              onRetry={() => {
                void pipelines.refetch();
                void records.refetch();
              }}
            />
          </div>
        ) : view === 'CARD' ? (
          <PipelineBoard
            stages={visibleStages}
            records={shown ?? []}
            canMove={Boolean(meta.data)}
            onMove={requestMove}
            onAdd={(stage) => setAdding({ mode: 'LEAD', stageId: stage.id })}
          />
        ) : (
          <div className="rounded-xl bg-surface p-4 shadow-md">
            <PipelineList
              records={shown ?? []}
              stages={stages.filter((stage) => stage.active)}
              meta={meta.data}
              pipelineEmpty={!records.data?.length}
              onDone={(message) => setToast({ message, tone: 'success' })}
            />
          </div>
        )}
        {records.data && !records.data.length && view === 'CARD' ? (
          <p data-testid="pipeline-empty" className="mt-2 text-sm text-muted">
            This pipeline has no records yet. Use Add Lead to start it.
          </p>
        ) : shown && !shown.length && view === 'CARD' ? (
          <p data-testid="pipeline-no-results" className="mt-2 text-sm text-muted">
            No records match these filters.{' '}
            <button
              type="button"
              onClick={() => setFilters(NO_FILTERS)}
              className="font-medium text-action hover:underline"
            >
              Clear Filters
            </button>
          </p>
        ) : null}
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
        <RecentActivityPanel pipelineId={pipelineId} onViewAll={() => setDrawer('activity')} />
        <UpcomingAppointmentsPanel
          pipelineId={pipelineId}
          onViewAll={() => setDrawer('appointments')}
        />
        <PipelineAnalyticsPanel
          pipelineId={pipelineId}
          range={range}
          onStage={(stageId) => setFilters({ ...filters, stageId })}
        />
      </div>

      {adding ? (
        <AddLeadPanel
          mode={adding.mode}
          pipelineId={pipelineId}
          stageId={adding.stageId}
          onClose={() => setAdding(null)}
          onCreated={(created) => {
            setAdding(null);
            setToast({
              message: `${created.firmName} was added to ${created.stageName}.`,
              tone: 'success',
            });
          }}
        />
      ) : null}
      {moving ? (
        <MoveStageDialog
          opportunity={moving.opp}
          stage={moving.stage}
          reps={meta.data?.reps ?? []}
          onClose={() => setMoving(null)}
          onMoved={(moved) =>
            setToast({ message: `Moved ${moved.firmName} to ${moved.stageName}.`, tone: 'success' })
          }
        />
      ) : null}
      {drawer === 'activity' ? (
        <ActivityDrawer kinds="all" pipelineId={pipelineId} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer === 'appointments' ? (
        <AppointmentsDrawer
          title="Upcoming Appointments"
          pipelineId={pipelineId}
          onClose={() => setDrawer(null)}
        />
      ) : null}
    </div>
  );
}
