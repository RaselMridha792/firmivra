'use client';

import {
  Button,
  DateRangePicker,
  FilterChip,
  SearchField,
  Select,
  Toggle,
  type DateRange,
} from '@firmivra/ui';
import { CalendarBlank, CalendarCheck, ListBullets, SquaresFour } from '@phosphor-icons/react';
import {
  LEAD_SOURCES,
  type LeadSource,
  type OpportunityScope,
  type PipelineStage,
  type PlanId,
  type SalesMeta,
  type SalesView,
} from '../../_components/sales-api';

export interface PipelineFilters {
  search: string;
  stageId: string;
  ownerId: string;
  plan: PlanId | '';
  source: LeadSource | '';
  tagId: string;
  /** null: the default range, this month. Empty strings: all dates. */
  range: DateRange | null;
  overdueOnly: boolean;
  unassignedOnly: boolean;
  attentionOnly: boolean;
  scope: OpportunityScope | '';
}

export const NO_FILTERS: PipelineFilters = {
  search: '',
  stageId: '',
  ownerId: '',
  plan: '',
  source: '',
  tagId: '',
  range: null,
  overdueOnly: false,
  unassignedOnly: false,
  attentionOnly: false,
  scope: '',
};

const pad = (n: number) => String(n).padStart(2, '0');
/** This month, from today's local date (`YYYY-MM-DD`). */
export function monthOf(today: string): DateRange {
  const [year, month] = today.split('-').map(Number);
  if (!year || !month) return { from: '', to: '' };
  const last = new Date(year, month, 0).getDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

const short = (value: string, withYear: boolean) => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(new Date(year, month - 1, day));
};
export function rangeText(range: DateRange) {
  if (!range.from && !range.to) return 'All dates';
  if (range.from && range.to)
    return range.from.slice(0, 4) === range.to.slice(0, 4)
      ? `${short(range.from, false)} – ${short(range.to, true)}`
      : `${short(range.from, true)} – ${short(range.to, true)}`;
  return range.from ? `From ${short(range.from, true)}` : `Until ${short(range.to, true)}`;
}

const SCOPE_LABELS: Record<OpportunityScope, string> = {
  IN_PROGRESS: 'In progress',
  PIPELINE: 'Active pipeline (counted in value)',
  CONVERTED: 'Converted',
  CLIENTS: 'Active clients',
  OPEN: 'Open records',
};

/** The compact date control: the range as text, a calendar to change it, and "All dates". */
function DateRangeFilter({
  value,
  onChange,
  defaultRange,
}: {
  value: DateRange;
  onChange: (range: DateRange | null) => void;
  defaultRange: DateRange;
}) {
  const close = (target: HTMLElement) => target.closest('details')?.removeAttribute('open');
  return (
    <details className="relative w-full sm:w-auto">
      <summary
        aria-label={`Date range: ${rangeText(value)}`}
        className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-sm text-text hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus"
      >
        <CalendarBlank aria-hidden weight="fill" className="size-4 shrink-0 text-heading" />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap">{rangeText(value)}</span>
        <CalendarCheck aria-hidden weight="fill" className="size-4 shrink-0 text-heading" />
      </summary>
      <div className="absolute top-full right-0 z-30 mt-2 w-80 max-w-screen rounded-xl border border-divider bg-surface p-4 shadow-lg">
        <DateRangePicker
          label="Records open in"
          value={value}
          onChange={(range) => onChange(range)}
        />
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            onClick={(event) => {
              onChange({ from: '', to: '' });
              close(event.currentTarget);
            }}
          >
            All dates
          </Button>
          <Button
            variant="ghost"
            onClick={(event) => {
              onChange(defaultRange.from ? null : { from: '', to: '' });
              close(event.currentTarget);
            }}
          >
            This month
          </Button>
          <Button variant="secondary" onClick={(event) => close(event.currentTarget)}>
            Done
          </Button>
        </div>
      </div>
    </details>
  );
}

/**
 * Search and filters (docx §9): live, so there is no Apply; the same filters drive the cards,
 * the list and the counts above each column.
 */
export function PipelineFilterBar({
  filters,
  onChange,
  meta,
  stages,
  range,
  defaultRange,
  pipelines,
  pipelineId,
  onPipeline,
}: {
  filters: PipelineFilters;
  onChange: (next: PipelineFilters) => void;
  meta: SalesMeta | undefined;
  stages: PipelineStage[];
  range: DateRange;
  defaultRange: DateRange;
  pipelines: { id: string; name: string }[];
  pipelineId: string;
  onPipeline: (id: string) => void;
}) {
  const set = <K extends keyof PipelineFilters>(key: K, value: PipelineFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const field = 'w-full sm:w-30 [&_select]:h-10 [&_select]:py-0 [&_select]:pr-8 [&_select]:text-sm';
  return (
    <div data-testid="pipeline-filters" className="flex flex-wrap items-end gap-2">
      {pipelines.length > 1 ? (
        <div className={field}>
          <Select
            label="Pipeline"
            hideLabel
            value={pipelineId}
            onChange={(event) => onPipeline(event.target.value)}
            options={pipelines.map((item) => ({ value: item.id, label: item.name }))}
          />
        </div>
      ) : null}
      <SearchField
        label="Search opportunities"
        placeholder="Search opportunities..."
        minWidth="14rem"
        maxLength={100}
        value={filters.search}
        onChange={(event) => set('search', event.target.value)}
      />
      <div className={field}>
        <Select
          label="Stage"
          hideLabel
          value={filters.stageId}
          onChange={(event) => set('stageId', event.target.value)}
          options={[
            { value: '', label: 'All Stages' },
            ...stages.map((stage) => ({ value: stage.id, label: stage.name })),
          ]}
        />
      </div>
      <div className={field}>
        <Select
          label="Agent"
          hideLabel
          value={filters.ownerId}
          onChange={(event) => set('ownerId', event.target.value)}
          options={[
            { value: '', label: 'All Agents' },
            ...(meta?.reps ?? []).map((rep) => ({ value: rep.id, label: rep.name })),
          ]}
        />
      </div>
      <div className={field}>
        <Select
          label="Plan"
          hideLabel
          value={filters.plan}
          onChange={(event) =>
            set('plan', meta?.plans.find((plan) => plan.id === event.target.value)?.id ?? '')
          }
          options={[
            { value: '', label: 'All Plans' },
            ...(meta?.plans ?? []).map((plan) => ({ value: plan.id, label: plan.name })),
          ]}
        />
      </div>
      <div className={field}>
        <Select
          label="Source"
          hideLabel
          value={filters.source}
          onChange={(event) =>
            set('source', LEAD_SOURCES.find((item) => item.id === event.target.value)?.id ?? '')
          }
          options={[
            { value: '', label: 'All Sources' },
            ...LEAD_SOURCES.map((source) => ({ value: source.id, label: source.label })),
          ]}
        />
      </div>
      <div className={field}>
        <Select
          label="Tag"
          hideLabel
          value={filters.tagId}
          onChange={(event) => set('tagId', event.target.value)}
          options={[
            { value: '', label: 'All Tags' },
            ...(meta?.tags ?? []).map((tag) => ({ value: tag.id, label: tag.name })),
          ]}
        />
      </div>
      <div className="w-full sm:w-52">
        <DateRangeFilter
          value={range}
          defaultRange={defaultRange}
          onChange={(next) => set('range', next)}
        />
      </div>
    </div>
  );
}

/** Show Overdue Only, Show Unassigned, the Card / List switch and Clear Filters. */
export function PipelineToggles({
  filters,
  onChange,
  view,
  onView,
  onClear,
}: {
  filters: PipelineFilters;
  onChange: (next: PipelineFilters) => void;
  view: SalesView;
  onView: (view: SalesView) => void;
  onClear: () => void;
}) {
  const viewButton = (active: boolean) =>
    `inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${active ? 'bg-info-soft text-action' : 'text-text hover:bg-canvas'}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <label className="flex cursor-pointer items-center gap-3 text-sm text-text">
            <Toggle
              label="Show Overdue Only"
              checked={filters.overdueOnly}
              onChange={(checked) => onChange({ ...filters, overdueOnly: checked })}
            />
            Show Overdue Only
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-text">
            <Toggle
              label="Show Unassigned"
              checked={filters.unassignedOnly}
              onChange={(checked) => onChange({ ...filters, unassignedOnly: checked })}
            />
            Show Unassigned
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="View"
            className="inline-flex rounded-lg border border-divider bg-surface p-0.5"
          >
            <button
              type="button"
              aria-pressed={view === 'CARD'}
              onClick={() => onView('CARD')}
              className={viewButton(view === 'CARD')}
            >
              <SquaresFour aria-hidden weight="fill" className="size-4.5" />
              Card View
            </button>
            <button
              type="button"
              aria-pressed={view === 'LIST'}
              onClick={() => onView('LIST')}
              className={viewButton(view === 'LIST')}
            >
              <ListBullets aria-hidden weight="bold" className="size-4.5" />
              List View
            </button>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="h-10 rounded-lg bg-table-head px-4 text-sm font-medium text-heading hover:bg-folder-surface"
          >
            Clear Filters
          </button>
        </div>
      </div>
      {filters.scope || filters.attentionOnly ? (
        <div aria-label="Applied filters" role="group" className="flex flex-wrap gap-2">
          {filters.scope ? (
            <FilterChip
              label={`Showing: ${SCOPE_LABELS[filters.scope]}`}
              onRemove={() => onChange({ ...filters, scope: '' })}
            />
          ) : null}
          {filters.attentionOnly ? (
            <FilterChip
              label="Showing: Needs attention"
              onRemove={() => onChange({ ...filters, attentionOnly: false })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
