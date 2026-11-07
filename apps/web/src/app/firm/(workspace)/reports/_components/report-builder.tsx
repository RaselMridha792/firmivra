'use client';

import { ApiRequestError, type ReportDefinitionView } from '@firmivra/types';
import {
  Button,
  Checkbox,
  KpiCard,
  Modal,
  Select,
  Table,
  Toast,
  Toggle,
  type Column,
} from '@firmivra/ui';
import {
  ArrowDown,
  ArrowUp,
  CalendarBlank,
  DotsSixVertical,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { withOrigin } from '../../../../../lib/origin';
import { useApiQuery } from '../../../../../lib/query';
import { UnsavedDialog, useUnsavedGuard } from '../../tasks/_components/unsaved-guard';
import { type FilterDraft, conditionsOf } from './filter-rules';
import { type BuilderDraft, draftFrom, pack } from './report-drafts';
import { CustomRangeDialog } from './report-date-controls';
import { SaveReportDialog, ScheduleReportDialog } from './report-dialogs';
import { FilterRows } from './report-filters';
import {
  BarChart,
  CATEGORY_META,
  CategoryTile,
  PRESETS,
  RP_KEY,
  card,
  formatCell,
  kpiMoney,
  kpiTrend,
  outlined,
  primary,
  quiet,
  rangeText,
  RP_ERRORS,
  subtle,
} from './reports-shared';
import { ReportHelp } from './report-help';
import { ChartSelect } from './chart-select';

const section = (n: number, title: string) => (
  <h2 className="mb-3 flex items-center gap-3 font-display text-lg font-bold text-heading">
    <span
      aria-hidden
      className="flex size-7 items-center justify-center rounded-full bg-action text-sm text-on-action"
    >
      {n}
    </span>
    {title}
  </h2>
);

/** /reports/builder: Create Custom Report: type and data, columns, filters, grouping and a live preview. */
export function ReportBuilder() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // RP-F14 (Octavia, Oct 28): Back from the report Run Report opened brings the builder back as it
  // was: its work is in the address (`?d=`), read once when the builder opens.
  const [opened] = useState(() => draftFrom(params.get('d')));
  const sources = useApiQuery([...RP_KEY, 'sources'], () => api.reports.sources());
  const [category, setCategory] = useState(opened.category);
  const [sourceKey, setSourceKey] = useState(opened.sourceKey);
  const [name, setName] = useState(opened.name);
  const [columns, setColumns] = useState<string[]>(opened.columns);
  const [fieldSearch, setFieldSearch] = useState('');
  const [preset, setPreset] = useState(opened.preset);
  // RP-F16: a Custom Range as on a report's page, kept as a fixed range when saved.
  const [fixed, setFixed] = useState<{ from: string; to: string } | undefined>(opened.fixed);
  const [picking, setPicking] = useState(false);
  const [conds, setConds] = useState<FilterDraft[]>(opened.conds);
  // RP-F09: a column dragged to a new place (the arrows do the same by keyboard).
  const [dragged, setDragged] = useState<string>();
  const [groupBy, setGroupBy] = useState(opened.groupBy);
  const [sortBy, setSortBy] = useState(opened.sortBy);
  const [desc, setDesc] = useState(opened.desc);
  const [totals, setTotals] = useState(opened.totals);
  const [pct, setPct] = useState(opened.pct);
  const [compare, setCompare] = useState(opened.compare);
  // RP-F18 (Octavia, Oct 28): how the report shows, saved with it.
  const [chart, setChart] = useState(opened.chart);
  // RP-F15: a change of data source that would reset fields and filters asks first.
  const [switching, setSwitching] = useState<{ category: string; sourceKey: string }>();
  const draft: BuilderDraft = {
    name,
    category,
    sourceKey,
    columns,
    preset,
    fixed,
    conds,
    groupBy,
    sortBy,
    desc,
    totals,
    pct,
    compare,
    chart,
  };
  // RP-F05: unsaved work asks Save, Discard or Keep Editing before a link or a close loses it.
  const guard = useUnsavedGuard(draft);
  const resetsSomething = columns.length > 0 || conds.length > 0 || !!groupBy || !!sortBy;
  const switchTo = (next: { category: string; sourceKey: string }) => {
    setCategory(next.category);
    setSourceKey(next.sourceKey);
    setColumns([]);
    setGroupBy('');
    setSortBy('');
    setConds([]);
    setSwitching(undefined);
  };
  const [dialog, setDialog] = useState<'save' | 'schedule'>();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [tick, setTick] = useState(0);
  const all = sources.data ?? [];
  const inCategory = all.filter((s) => s.category === category);
  const src = all.find((s) => s.key === (sourceKey || inCategory[0]?.key));
  const cols = columns.length ? columns : (src?.defaultColumns ?? []);
  const fields = src?.fields ?? [];
  const filterFields = fields.filter((f) => f.filterable);
  // RP-F02, F10: only the filters that fit go to the preview; the others say why, in place.
  const filtered = conditionsOf(filterFields, conds);
  const unfit = filtered.problems.filter(Boolean).length;
  const definition: ReportDefinitionView | undefined = src
    ? {
        category: src.category,
        dataSource: src.key,
        columns: cols,
        filters: {
          logic: 'AND',
          conditions: filtered.conditions as ReportDefinitionView['filters']['conditions'],
          groups: [],
        },
        groupBy: groupBy || null,
        sortBy: sortBy || null,
        sortDescending: desc,
        showTotals: totals,
        showPercentage: pct,
        compareTo: compare ? 'PREVIOUS_PERIOD' : 'NONE',
        date: fixed ? { rule: 'FIXED', ...fixed } : { rule: 'ROLLING', preset: preset as never },
        chartType: chart as ReportDefinitionView['chartType'],
        showDataLabels: false,
        showLegend: true,
        includeTaxRevenue: false,
      }
    : undefined;
  const preview = useApiQuery([...RP_KEY, 'preview', JSON.stringify(definition), tick], () =>
    definition
      ? api.reports.run({
          target: { kind: 'DEFINITION', definition: definition as never },
          preview: true,
        })
      : Promise.resolve(null),
  );
  const r = preview.data;
  // RP-F10: a preview that could not run says why; it is never shown as "no data".
  const previewError = preview.isError
    ? ((preview.error instanceof ApiRequestError
        ? preview.error.details?.[0]?.message
        : undefined) ?? errorMessage(preview.error, RP_ERRORS))
    : undefined;
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const move = (key: string, by: number) => {
    const i = cols.indexOf(key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setColumns(next);
  };
  const dropOn = (key: string) => {
    if (!dragged || dragged === key) return;
    const next = cols.filter((c) => c !== dragged);
    next.splice(next.indexOf(key), 0, dragged);
    setColumns(next);
  };
  const tableCols: Column<{ cells: Record<string, string | number | boolean | null> }>[] = (
    r?.table.columns ?? []
  ).map((c) => ({
    id: c.key,
    label: c.label,
    cell: (row) =>
      formatCell(
        row.cells[c.key],
        c.key === '_pct' ? 'PERCENT' : c.key === '_count' ? 'NUMBER' : c.type,
      ),
  }));

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="report-builder">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-link">
        <Link href="/reports">Reports</Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Custom Report Builder</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <CategoryTile category={category} />
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading">Create Custom Report</h1>
            <p className="text-base text-muted">
              Choose your data, set filters, select what to display, and generate a custom report.
            </p>
          </div>
        </div>
        <Link href="/reports" className={outlined}>
          ← Back to Reports
        </Link>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {sources.isError ? (
        <p role="alert" className={quiet}>
          The report builder is not available right now. We could not load the data sources.
        </p>
      ) : null}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <section
            className={`${card} grid gap-3 sm:grid-cols-3`}
            aria-label="Select report type and data"
            data-testid="step-1"
          >
            <div className="sm:col-span-3">{section(1, 'Select Report Type & Data')}</div>
            <Select
              label="Report Category"
              value={category}
              onChange={(e) => {
                const next = { category: e.target.value, sourceKey: '' };
                if (resetsSomething) setSwitching(next);
                else switchTo(next);
              }}
              options={Object.entries(CATEGORY_META)
                .filter(([k]) => all.some((s) => s.category === k))
                .map(([value, m]) => ({ value, label: m.label.replace(/ Reports$/, '') }))}
            />
            <Select
              label="Data Source"
              value={src?.key ?? ''}
              onChange={(e) => {
                const next = { category, sourceKey: e.target.value };
                if (resetsSomething) setSwitching(next);
                else switchTo(next);
              }}
              options={
                inCategory.length
                  ? inCategory.map((s) => ({ value: s.key, label: s.label }))
                  : [{ value: '', label: 'No data source' }]
              }
            />
            <label className="flex flex-col gap-1 text-sm font-medium text-heading">
              Report Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm font-normal text-text"
              />
            </label>
          </section>

          <section className={card} aria-label="Choose metrics and columns" data-testid="step-2">
            <div className="flex items-start justify-between gap-2">
              {section(2, 'Choose Metrics & Columns')}
              <ReportHelp area="fields" />
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div>
                <h3 className="mb-1 text-sm font-semibold text-heading">Available Fields</h3>
                <label className="mb-2 flex h-10 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
                  <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
                  <span className="sr-only">Search fields</span>
                  <input
                    type="search"
                    value={fieldSearch}
                    onChange={(e) => setFieldSearch(e.target.value)}
                    placeholder="Search fields..."
                    className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
                  />
                </label>
                <ul className="max-h-60 overflow-auto">
                  {fields
                    .filter((f) => f.label.toLowerCase().includes(fieldSearch.toLowerCase()))
                    .map((f) => (
                      <li key={f.key} className="flex items-center justify-between gap-2 py-1">
                        <Checkbox
                          label={f.label}
                          checked={cols.includes(f.key)}
                          disabled={f.locked && cols.includes(f.key)}
                          onChange={(e) =>
                            setColumns(
                              e.target.checked ? [...cols, f.key] : cols.filter((c) => c !== f.key),
                            )
                          }
                        />
                      </li>
                    ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold text-heading">Selected Columns</h3>
                {cols.length === 0 ? <p className={quiet}>Choose at least one field.</p> : null}
                <ul
                  className="flex max-h-72 flex-col gap-1 overflow-auto"
                  data-testid="selected-columns"
                >
                  {cols.map((k) => (
                    <li
                      key={k}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', k);
                        setDragged(k);
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        dropOn(k);
                        setDragged(undefined);
                      }}
                      onDragEnd={() => setDragged(undefined)}
                      className={`flex cursor-grab items-center gap-1 rounded-lg border px-2 py-1 text-sm ${dragged === k ? 'border-action bg-accent-soft' : 'border-divider'}`}
                    >
                      <DotsSixVertical
                        aria-hidden
                        weight="bold"
                        className="size-4 shrink-0 text-muted"
                      />
                      <span className="min-w-0 flex-1 truncate text-heading">
                        {fields.find((f) => f.key === k)?.label ?? k}
                      </span>
                      <button
                        type="button"
                        aria-label={`Move ${k} up`}
                        onClick={() => move(k, -1)}
                        className="flex size-7 items-center justify-center rounded text-muted hover:bg-canvas"
                      >
                        <ArrowUp aria-hidden weight="bold" className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${k} down`}
                        onClick={() => move(k, 1)}
                        className="flex size-7 items-center justify-center rounded text-muted hover:bg-canvas"
                      >
                        <ArrowDown aria-hidden weight="bold" className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${k}`}
                        disabled={cols.length === 1}
                        onClick={() => setColumns(cols.filter((c) => c !== k))}
                        className="flex size-7 items-center justify-center rounded text-muted hover:bg-canvas disabled:opacity-40"
                      >
                        <X aria-hidden weight="bold" className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section
            className={`${card} flex flex-col gap-3`}
            aria-label="Set filters"
            data-testid="step-3"
          >
            <div className="flex items-start justify-between gap-2">
              {section(3, 'Set Filters')}
              <ReportHelp area="filters" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Date Range"
                value={fixed ? 'custom' : preset}
                onChange={(e) => {
                  if (e.target.value === 'custom') setPicking(true);
                  else {
                    setFixed(undefined);
                    setPreset(e.target.value);
                  }
                }}
                options={[
                  ...PRESETS.map((p) => ({ value: p.value, label: p.label })),
                  { value: 'custom', label: fixed ? rangeText(fixed) : 'Custom Range…' },
                ]}
              />
            </div>
            <FilterRows fields={filterFields} rows={conds} onChange={setConds} />
            {unfit ? (
              <p className="text-sm text-warning" role="status">
                {unfit === 1 ? 'One filter is' : `${unfit} filters are`} not in the preview until
                fixed.
              </p>
            ) : null}
          </section>

          <section
            className={`${card} flex flex-col gap-3`}
            aria-label="Group, sort and display options"
            data-testid="step-4"
          >
            <div className="flex items-start justify-between gap-2">
              {section(4, 'Group, Sort & Display Options')}
              <ReportHelp area="fields" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label="Group By"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                options={[
                  { value: '', label: 'No grouping' },
                  ...fields
                    .filter((f) => f.groupable)
                    .map((f) => ({ value: f.key, label: f.label })),
                ]}
              />
              <Select
                label="Sort By"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                options={[
                  { value: '', label: 'Default' },
                  ...fields
                    .filter((f) => f.sortable && cols.includes(f.key))
                    .map((f) => ({ value: f.key, label: f.label })),
                ]}
              />
              <Select
                label="Sort Order"
                value={desc ? 'desc' : 'asc'}
                onChange={(e) => setDesc(e.target.value === 'desc')}
                options={[
                  { value: 'desc', label: 'Descending' },
                  { value: 'asc', label: 'Ascending' },
                ]}
              />
            </div>
            <div className="max-w-xs">
              <ChartSelect
                label="Display"
                value={chart}
                facts={{
                  periods: preview.data?.chart?.labels.length ?? 0,
                  kpis: preview.data?.kpis.length ?? 0,
                }}
                onChange={setChart}
                testId="builder-display"
              />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-heading">
              <label className="flex items-center gap-2">
                <Toggle label="Show totals" checked={totals} onChange={setTotals} /> Show Totals
              </label>
              <label className="flex items-center gap-2">
                <Toggle
                  label="Show percentage"
                  checked={pct}
                  disabled={!groupBy}
                  onChange={setPct}
                />{' '}
                Show Percentage
              </label>
              <label className="flex items-center gap-2">
                <Toggle
                  label="Include comparison period"
                  checked={compare}
                  disabled={!src?.supportsComparison}
                  onChange={setCompare}
                />{' '}
                Include Comparison Period
              </label>
            </div>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section className={card} aria-label="Report preview" data-testid="preview">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-heading">Report Preview</h2>
                <p className="text-xs text-muted">
                  This is a preview based on your selected fields and filters.
                </p>
              </div>
              <button
                type="button"
                className={`${outlined} min-h-9`}
                onClick={() => setTick(tick + 1)}
              >
                Refresh Preview
              </button>
            </div>
            {previewError ? (
              <p role="alert" className="rounded-lg bg-danger-soft p-4 text-sm text-danger">
                The preview could not run: {previewError}
              </p>
            ) : null}
            <ul className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="preview-kpis">
              {(r?.kpis ?? []).map((k) => (
                <li key={k.key}>
                  <KpiCard
                    icon={CalendarBlank}
                    tone="blue"
                    value={kpiMoney(k)}
                    label={k.label}
                    {...(kpiTrend(k) ? { trend: kpiTrend(k)! } : {})}
                  />
                </li>
              ))}
            </ul>
            {r?.chart ? (
              <BarChart chart={r.chart} />
            ) : previewError ? null : (
              <p className={quiet}>
                {preview.isPending ? 'Loading…' : 'No rows match these fields and filters.'}
              </p>
            )}
            <div className="mt-4">
              <h3 className="mb-2 font-display text-base font-bold text-heading">
                Report Data (Preview)
              </h3>
              <div className="relative">
                <Table
                  rows={r?.table.rows ?? []}
                  columns={tableCols}
                  rowKey={(row) => JSON.stringify(row.cells)}
                  caption="Report preview"
                  dense
                  noun="results"
                  pageSize={10}
                  showPagination={false}
                  loading={preview.isPending}
                  emptyTitle={previewError ? 'Preview not available' : 'No results'}
                  emptyText={
                    previewError
                      ? 'Fix the filter named above to see data.'
                      : 'Change the fields or filters to see data.'
                  }
                />
              </div>
              {r ? (
                <p className="mt-1 text-xs text-muted">
                  Showing the first {r.table.rows.length} of {r.table.total} results.
                </p>
              ) : null}
            </div>
          </section>
          <div
            className="flex flex-wrap justify-end gap-2"
            role="group"
            aria-label="Report actions"
          >
            <button
              type="button"
              className={outlined}
              disabled={!definition}
              onClick={() => {
                // RP-F14: the full report of this unsaved definition, with every control; the
                // builder's address keeps its work so Back finds it as it was.
                const d = definition && pack(definition);
                const here = pack(draft);
                if (!d || !here) {
                  notice(
                    'This report is too large to open from the builder. Save it first.',
                    'error',
                  );
                  return;
                }
                const builder = `${pathname}?d=${here}`;
                router.replace(builder, { scroll: false });
                guard.allow();
                router.push(
                  withOrigin(
                    `/reports/custom?d=${d}&name=${encodeURIComponent(name.slice(0, 120))}`,
                    builder,
                  ),
                );
              }}
            >
              Run Report
            </button>
            <button
              type="button"
              className={subtle}
              disabled={!definition}
              onClick={() => setDialog('save')}
            >
              Save Report
            </button>
            <button
              type="button"
              className={primary}
              disabled={!definition}
              onClick={() => setDialog('schedule')}
            >
              <CalendarBlank aria-hidden weight="bold" className="size-4" /> Save &amp; Schedule
            </button>
          </div>
        </div>
      </div>

      {picking ? (
        <CustomRangeDialog
          initial={fixed}
          onClose={() => setPicking(false)}
          onApply={(range) => {
            setFixed(range);
            setPicking(false);
          }}
        />
      ) : null}
      {dialog === 'save' && definition ? (
        <SaveReportDialog
          definition={definition}
          defaultName={name}
          onClose={() => setDialog(undefined)}
          onSaved={(id) => {
            guard.allow();
            router.push(`/reports/${id}`);
          }}
        />
      ) : null}
      {dialog === 'schedule' && definition ? (
        <ScheduleReportDialog
          target={{ kind: 'NEW', definition, name }}
          defaultName={`${name} schedule`}
          onClose={() => setDialog(undefined)}
          onNotice={(t, tone) => {
            notice(t, tone);
          }}
        />
      ) : null}
      {switching ? (
        <Modal
          open
          title="Change the data source?"
          subtitle="The fields and filters of this report belong to its data source."
          onClose={() => setSwitching(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSwitching(undefined)}>
                Cancel
              </Button>
              <Button onClick={() => switchTo(switching)}>Change and Reset</Button>
            </>
          }
        >
          <p className="text-sm text-text">These will be reset:</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-text" data-testid="switch-resets">
            {columns.length ? <li>{columns.length} chosen columns</li> : null}
            {conds.length ? <li>{conds.length} filters</li> : null}
            {groupBy ? <li>the grouping</li> : null}
            {sortBy ? <li>the sort</li> : null}
          </ul>
        </Modal>
      ) : null}
      <UnsavedDialog guard={guard} onSave={() => setDialog('save')} saving={false} />
    </div>
  );
}
