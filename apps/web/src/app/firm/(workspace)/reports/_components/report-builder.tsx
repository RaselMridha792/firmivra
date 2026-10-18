'use client';

import type { ReportDefinitionView } from '@firmivra/types';
import { Checkbox, KpiCard, Select, Table, Toast, Toggle, type Column } from '@firmivra/ui';
import { ArrowDown, ArrowUp, CalendarBlank, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { SaveReportDialog, ScheduleReportDialog } from './report-dialogs';
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
  subtle,
} from './reports-shared';

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

interface Cond {
  field: string;
  op: string;
  value: string;
}

/** /reports/builder: Create Custom Report: type and data, columns, filters, grouping and a live preview. */
export function ReportBuilder() {
  const router = useRouter();
  const sources = useApiQuery([...RP_KEY, 'sources'], () => api.reports.sources());
  const [category, setCategory] = useState('FINANCIAL');
  const [sourceKey, setSourceKey] = useState('');
  const [name, setName] = useState('Custom Report');
  const [columns, setColumns] = useState<string[]>([]);
  const [fieldSearch, setFieldSearch] = useState('');
  const [preset, setPreset] = useState('this_year');
  const [conds, setConds] = useState<Cond[]>([]);
  const [groupBy, setGroupBy] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [desc, setDesc] = useState(true);
  const [totals, setTotals] = useState(false);
  const [pct, setPct] = useState(false);
  const [compare, setCompare] = useState(false);
  const [dialog, setDialog] = useState<'save' | 'schedule'>();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [tick, setTick] = useState(0);
  const all = sources.data ?? [];
  const inCategory = all.filter((s) => s.category === category);
  const src = all.find((s) => s.key === (sourceKey || inCategory[0]?.key));
  const cols = columns.length ? columns : (src?.defaultColumns ?? []);
  const fields = src?.fields ?? [];
  const definition: ReportDefinitionView | undefined = src
    ? {
        category: src.category,
        dataSource: src.key,
        columns: cols,
        filters: {
          logic: 'AND',
          conditions: conds
            .filter((c) => c.field && c.value !== '')
            .map((c) => ({ field: c.field, op: c.op as never, value: c.value })),
          groups: [],
        },
        groupBy: groupBy || null,
        sortBy: sortBy || null,
        sortDescending: desc,
        showTotals: totals,
        showPercentage: pct,
        compareTo: compare ? 'PREVIOUS_PERIOD' : 'NONE',
        date: { rule: 'ROLLING', preset: preset as never },
        chartType: 'AUTO',
        showDataLabels: false,
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
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const move = (key: string, by: number) => {
    const i = cols.indexOf(key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j]!, next[i]!];
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
                setCategory(e.target.value);
                setSourceKey('');
                setColumns([]);
                setGroupBy('');
                setSortBy('');
                setConds([]);
              }}
              options={Object.entries(CATEGORY_META)
                .filter(([k]) => all.some((s) => s.category === k))
                .map(([value, m]) => ({ value, label: m.label.replace(/ Reports$/, '') }))}
            />
            <Select
              label="Data Source"
              value={src?.key ?? ''}
              onChange={(e) => {
                setSourceKey(e.target.value);
                setColumns([]);
                setGroupBy('');
                setSortBy('');
                setConds([]);
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
            {section(2, 'Choose Metrics & Columns')}
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
                      className="flex items-center gap-1 rounded-lg border border-divider px-2 py-1 text-sm"
                    >
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
            {section(3, 'Set Filters')}
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Date Range"
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
              />
            </div>
            {conds.map((c, i) => {
              const f = fields.find((x) => x.key === c.field);
              return (
                <div
                  key={`${c.field}-${i}`}
                  className="grid items-end gap-2 sm:grid-cols-[1fr_7rem_1fr_auto]"
                >
                  <Select
                    label="Field"
                    value={c.field}
                    onChange={(e) =>
                      setConds(
                        conds.map((x, j) =>
                          j === i ? { field: e.target.value, op: 'IS', value: '' } : x,
                        ),
                      )
                    }
                    options={fields
                      .filter((x) => x.filterable)
                      .map((x) => ({ value: x.key, label: x.label }))}
                  />
                  <Select
                    label="Is"
                    value={c.op}
                    onChange={(e) =>
                      setConds(conds.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))
                    }
                    options={
                      f && (f.type === 'MONEY' || f.type === 'NUMBER')
                        ? [
                            { value: 'GREATER_THAN', label: 'above' },
                            { value: 'LESS_THAN', label: 'below' },
                          ]
                        : [
                            { value: 'IS', label: 'is' },
                            { value: 'IS_NOT', label: 'is not' },
                            { value: 'CONTAINS', label: 'contains' },
                          ]
                    }
                  />
                  {f && f.options.length ? (
                    <Select
                      label="Value"
                      value={c.value}
                      onChange={(e) =>
                        setConds(
                          conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                        )
                      }
                      options={[{ value: '', label: 'Choose…' }, ...f.options]}
                    />
                  ) : (
                    <label className="flex flex-col gap-1 text-sm font-medium text-heading">
                      Value
                      <input
                        value={c.value}
                        onChange={(e) =>
                          setConds(
                            conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                          )
                        }
                        className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm font-normal text-text"
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove filter ${i + 1}`}
                    onClick={() => setConds(conds.filter((_, j) => j !== i))}
                    className="min-h-10 px-2 text-sm font-medium text-danger"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className={`${outlined} min-h-9 w-fit`}
              disabled={!fields.some((f) => f.filterable)}
              onClick={() => {
                const f = fields.find((x) => x.filterable);
                if (f) setConds([...conds, { field: f.key, op: 'IS', value: '' }]);
              }}
            >
              <Plus aria-hidden weight="bold" className="size-4" /> Add Filter
            </button>
          </section>

          <section
            className={`${card} flex flex-col gap-3`}
            aria-label="Group, sort and display options"
            data-testid="step-4"
          >
            {section(4, 'Group, Sort & Display Options')}
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
            {preview.isError ? (
              <p role="alert" className={quiet}>
                The preview is not available. Check the fields and filters.
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
            ) : (
              <p className={quiet}>
                {preview.isPending ? 'Loading…' : 'There is no data for this selection.'}
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
                  emptyTitle="No results"
                  emptyText="Change the fields or filters to see data."
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
                setTick(tick + 1);
                notice('Report run.', 'success');
                void (
                  definition &&
                  api.reports.run({
                    target: { kind: 'DEFINITION', definition: definition as never },
                  })
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

      {dialog === 'save' && definition ? (
        <SaveReportDialog
          definition={definition}
          defaultName={name}
          onClose={() => setDialog(undefined)}
          onSaved={(id) => router.push(`/reports/${id}`)}
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
    </div>
  );
}
