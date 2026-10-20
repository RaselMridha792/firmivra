'use client';

import type { ReportResult } from '@firmivra/types';
import {
  ActionMenu,
  Button,
  DonutChart,
  KpiCard,
  Modal,
  Select,
  Table,
  Toast,
  Toggle,
  type Column,
} from '@firmivra/ui';
import {
  Bookmark,
  CalendarBlank,
  CaretRight,
  DownloadSimple,
  Lightbulb,
  MagnifyingGlass,
  Printer,
  Funnel,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { SaveReportDialog, ScheduleReportDialog } from './report-dialogs';
import {
  BarChart,
  CATEGORY_META,
  CategoryTile,
  COMPARE,
  PRESETS,
  RP_ERRORS,
  RP_KEY,
  ringOf,
  card,
  formatCell,
  kpiMoney,
  kpiTrend,
  outlined,
  quiet,
  rangeText,
  subtle,
} from './reports-shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUICK = ['last_7_days', 'last_30_days', 'this_month', 'this_year', 'last_year'] as const;
const CHARTS = [
  { value: 'AUTO', label: 'Automatic' },
  { value: 'BAR', label: 'Column Chart' },
  { value: 'LINE', label: 'Line Chart' },
  { value: 'AREA', label: 'Area Chart' },
];

/** /reports/[reportId]: one report (a quick report by key, or a saved one by id) with its controls. */
export function ReportDetail({ reportId }: { reportId: string }) {
  const router = useRouter();
  const target = UUID.test(reportId)
    ? ({ kind: 'SAVED', id: reportId } as const)
    : ({ kind: 'SYSTEM', key: reportId } as const);
  const [preset, setPreset] = useState<string>();
  const [fixed, setFixed] = useState<{ from: string; to: string }>();
  const [compare, setCompare] = useState<string>('SAME_PERIOD_LAST_YEAR');
  const [clientType, setClientType] = useState('ALL');
  const [service, setService] = useState('');
  const [chartType, setChartType] = useState('AUTO');
  const [labels, setLabels] = useState(false);
  const [tax, setTax] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ id: string; descending: boolean }>();
  const [hidden, setHidden] = useState<string[]>([]);
  const [extra, setExtra] = useState<{ field: string; op: string; value: string }[]>([]);
  const [dialog, setDialog] = useState<'save' | 'schedule' | 'filters' | 'custom'>();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const term = useDeferredValue(search.trim());
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const date = fixed
    ? ({ rule: 'FIXED', ...fixed } as const)
    : preset
      ? ({ rule: 'ROLLING', preset } as const)
      : undefined;
  const req = {
    target,
    ...(date ? { date: date as never } : {}),
    ...(compare ? { compareTo: compare as never } : {}),
    ...(clientType !== 'ALL' ? { quick: { clientType: clientType as never } } : {}),
    ...(service
      ? {
          quick: {
            ...(clientType !== 'ALL' ? { clientType: clientType as never } : {}),
            serviceCategoryId: service,
          },
        }
      : {}),
    ...(extra.length
      ? {
          extraFilters: {
            conditions: extra.map((c) => ({ field: c.field, op: c.op as never, value: c.value })),
          },
        }
      : {}),
    ...(term ? { search: term } : {}),
    ...(sort ? { sort: { field: sort.id, descending: sort.descending } } : {}),
    chartType: chartType as never,
    showDataLabels: labels,
    includeTaxRevenue: tax,
    page,
    pageSize: 10,
  };
  const q = useApiQuery([...RP_KEY, 'run', JSON.stringify(req)], () => api.reports.run(req));
  const services = useApiQuery([...RP_KEY, 'services'], () =>
    api.reports.lookups({ kind: 'SERVICE_CATEGORY' }),
  );
  const sources = useApiQuery([...RP_KEY, 'sources'], () => api.reports.sources());
  const r: ReportResult | undefined = q.data;
  const meta = r ? (CATEGORY_META[r.category] ?? CATEGORY_META['FINANCIAL']!) : undefined;

  if (q.isError)
    return (
      <div className="flex flex-col gap-3" data-testid="report-error">
        <Link href="/reports" className="text-sm font-medium text-link">
          ← Back to Reports
        </Link>
        <p role="alert" className={quiet}>
          This report is not available. It may have been removed, you may not have access to it, or
          we could not load it.
        </p>
      </div>
    );

  const exportAs = async (format: 'CSV' | 'XLSX' | 'PDF') => {
    try {
      const { page: _p, pageSize: _s, ...rest } = req;
      void [_p, _s];
      const v = await api.reports.exportReport({
        run: { ...rest, target } as never,
        format,
        hiddenColumns: hidden,
      });
      notice(`Export ready: ${v.fileName ?? 'report'} (${v.rowCount ?? 0} rows).`, 'success');
    } catch (e) {
      notice(errorMessage(e, RP_ERRORS), 'error');
    }
  };
  const columns: Column<{ cells: Record<string, string | number | boolean | null> }>[] = (
    r?.table.columns ?? []
  )
    .filter((c) => c.locked || !hidden.includes(c.key))
    .map((c, i) => ({
      id: c.key,
      label: c.label,
      sortable: c.sortable,
      cell: (row) => (
        <span className={i === 0 ? 'font-medium text-heading' : ''}>
          {c.key === '_count' || c.key === '_pct'
            ? formatCell(row.cells[c.key], c.key === '_pct' ? 'PERCENT' : 'NUMBER')
            : formatCell(row.cells[c.key], c.type)}
        </span>
      ),
    }));
  const totals = r?.table.totals;
  const src = r ? sources.data?.find((s) => s.key === r.definition.dataSource) : undefined;
  const title = r ? `${r.title}` : 'Report';
  const compareValue =
    compare ??
    (r?.comparisonRange
      ? r.definition.compareTo !== 'NONE'
        ? r.definition.compareTo
        : 'NONE'
      : 'NONE');
  const presetValue = fixed
    ? 'custom'
    : (preset ?? (r?.definition.date.rule === 'ROLLING' ? r.definition.date.preset : 'this_year'));

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="report-detail">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-link">
        <Link href="/reports">Reports</Link>
        {meta ? (
          <>
            <span aria-hidden className="text-muted">
              ›
            </span>
            <span>{meta.label}</span>
          </>
        ) : null}
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">{title}</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {r ? <CategoryTile category={r.category} size="md" /> : null}
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold break-words text-heading">
              {r ? `${meta?.label.replace(/s$/, '')} – ${title}` : 'Report'}
            </h1>
            {r?.notices.map((n) => (
              <p key={n} className="text-sm text-warning">
                {n}
              </p>
            ))}
          </div>
        </div>
        <Link href="/reports" className={outlined}>
          ← Back to Reports
        </Link>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <section
            className={`${card} grid grid-cols-2 items-end gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]`}
            aria-label="Report filters"
            data-testid="report-filters"
          >
            <Select
              label="Date Range"
              value={presetValue}
              onChange={(e) => {
                if (e.target.value === 'custom') setDialog('custom');
                else {
                  setFixed(undefined);
                  setPreset(e.target.value);
                  setPage(1);
                }
              }}
              options={[
                ...PRESETS.map((p) => ({ value: p.value, label: p.label })),
                { value: 'custom', label: fixed ? rangeText(fixed) : 'Custom Range…' },
              ]}
            />
            <Select
              label="Compare To"
              value={compareValue}
              onChange={(e) => {
                setCompare(e.target.value);
                setPage(1);
              }}
              options={COMPARE.map((p) => ({ value: p.value, label: p.label }))}
            />
            <Select
              label="Client Type"
              value={clientType}
              onChange={(e) => {
                setClientType(e.target.value);
                setPage(1);
              }}
              options={[
                { value: 'ALL', label: 'All Clients' },
                { value: 'NEW', label: 'New Clients' },
                { value: 'ACTIVE', label: 'Active Clients' },
                { value: 'INACTIVE', label: 'Inactive Clients' },
              ]}
            />
            <Select
              label="Service Type"
              value={service}
              onChange={(e) => {
                setService(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Services' },
                ...(services.data ?? []).map((s) => ({ value: s.id, label: s.label })),
              ]}
            />
            <button
              type="button"
              className={`${outlined} min-h-10`}
              onClick={() => setDialog('filters')}
            >
              <Funnel aria-hidden weight="fill" className="size-4" /> More Filters
              {extra.length ? ` (${extra.length})` : ''}
            </button>
          </section>
          {r && r.chips.length + extra.length > 0 ? (
            <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
              {r.chips.map((c) => (
                <li
                  key={`${c.field}${c.value}`}
                  className="rounded-pill bg-info-soft px-3 py-1 text-xs text-info"
                >
                  {c.label} {c.value}
                </li>
              ))}
              {extra.length ? (
                <li>
                  <button
                    type="button"
                    className="text-sm font-medium text-link"
                    onClick={() => setExtra([])}
                  >
                    Clear All
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}

          <ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            data-testid="report-kpis"
          >
            {r?.kpis.length === 0 ? <li className={quiet}>No totals for this report.</li> : null}
            {(r?.kpis ?? [null, null, null]).map((k, i) => (
              <li key={k?.key ?? i}>
                <KpiCard
                  icon={meta?.icon ?? CalendarBlank}
                  tone="blue"
                  value={k ? kpiMoney(k) : '—'}
                  label={k?.label ?? 'Loading'}
                  loading={q.isPending}
                  {...(k && kpiTrend(k)
                    ? {
                        trend: kpiTrend(k)!,
                        note: r?.comparisonRange
                          ? `vs. ${r.comparisonRange.label.toLowerCase()}`
                          : '',
                      }
                    : {})}
                />
              </li>
            ))}
          </ul>

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section className={card} aria-label="Chart" data-testid="report-chart">
              <h2 className="mb-3 font-display text-lg font-bold text-heading">
                {title} Over Time
              </h2>
              {r?.chart ? (
                <BarChart chart={r.chart} dataLabels={labels} />
              ) : (
                <p className={quiet}>
                  {q.isPending ? 'Loading…' : 'There is no data in this range.'}
                </p>
              )}
            </section>
            <section className={card} aria-label="Breakdown" data-testid="report-breakdown">
              <h2 className="mb-3 font-display text-lg font-bold text-heading">
                By {src?.fields.find((f) => f.key === r?.definition.groupBy)?.label ?? 'Group'}
              </h2>
              {r?.breakdown ? (
                <DonutChart
                  size="md"
                  legend
                  showPercent
                  segments={ringOf(r.breakdown).segments}
                  centerValue={ringOf(r.breakdown).center}
                />
              ) : (
                <p className={quiet}>
                  {q.isPending ? 'Loading…' : 'There is no data in this range.'}
                </p>
              )}
            </section>
          </div>

          <section
            className={`${card} flex flex-col gap-3`}
            aria-label="Report table"
            data-testid="report-table"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-auto font-display text-lg font-bold text-heading">{title}</h2>
              <label className="flex h-10 w-52 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
                <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
                <span className="sr-only">Search results</span>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search results..."
                  className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
                />
              </label>
              <ActionMenu
                label="Columns"
                trigger={<span className="px-1 text-sm font-medium">Columns</span>}
                align="right"
                sections={[
                  {
                    items: (r?.table.columns ?? [])
                      .filter((c) => !c.locked)
                      .map((c) => ({
                        label: `${hidden.includes(c.key) ? 'Show' : 'Hide'} ${c.label}`,
                        onSelect: () =>
                          setHidden(
                            hidden.includes(c.key)
                              ? hidden.filter((x) => x !== c.key)
                              : [...hidden, c.key],
                          ),
                      })),
                  },
                ]}
              />
              <button type="button" className={subtle} onClick={() => void exportAs('CSV')}>
                <DownloadSimple aria-hidden weight="bold" className="size-4" /> Export
              </button>
            </div>
            <div className="relative">
              <Table
                rows={r?.table.rows ?? []}
                columns={columns}
                rowKey={(row) => JSON.stringify(row.cells)}
                caption={title}
                dense
                noun="results"
                pageSize={10}
                loading={q.isPending}
                emptyTitle="No results"
                emptyText="There is no data in this range. Try another range or filter."
                server={{
                  page: r?.table.page ?? 1,
                  total: r?.table.total ?? 0,
                  hasNext: (r?.table.page ?? 1) * 10 < (r?.table.total ?? 0),
                  hasPrevious: (r?.table.page ?? 1) > 1,
                  onNext: () => setPage(page + 1),
                  onPrevious: () => setPage(Math.max(1, page - 1)),
                  onPage: (n: number) => setPage(n),
                  ...(sort ? { sort } : {}),
                  onSort: (s) => setSort(s),
                }}
              />
            </div>
            {totals && r ? (
              <p
                className="flex flex-wrap gap-x-6 gap-y-1 border-t border-divider pt-2 text-sm font-semibold text-heading"
                data-testid="totals"
              >
                <span>Total</span>
                {r.table.columns
                  .filter((c) => totals[c.key] !== undefined && !hidden.includes(c.key))
                  .map((c) => (
                    <span key={c.key}>
                      {c.label}: {formatCell(totals[c.key], c.key === '_count' ? 'NUMBER' : c.type)}
                    </span>
                  ))}
              </p>
            ) : null}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Report tools">
          <section className={card} aria-label="Report actions" data-testid="report-actions">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Report Actions</h2>
            <div className="grid grid-cols-2 gap-2">
              <ActionMenu
                label="Export"
                trigger={
                  <span className="inline-flex items-center gap-2 px-1 text-sm font-semibold">
                    <DownloadSimple aria-hidden weight="bold" className="size-4" /> Export
                  </span>
                }
                sections={[
                  {
                    items: [
                      { label: 'CSV', onSelect: () => void exportAs('CSV') },
                      { label: 'Excel (XLSX)', onSelect: () => void exportAs('XLSX') },
                      { label: 'PDF', onSelect: () => void exportAs('PDF') },
                    ],
                  },
                ]}
              />
              <button type="button" className={subtle} onClick={() => window.print()}>
                <Printer aria-hidden weight="bold" className="size-4" /> Print
              </button>
              <button
                type="button"
                className={subtle}
                disabled={!r}
                onClick={() => setDialog('save')}
              >
                <Bookmark aria-hidden weight="bold" className="size-4" /> Save Report
              </button>
              <button
                type="button"
                className={subtle}
                disabled={!r}
                onClick={() => setDialog('schedule')}
              >
                <CalendarBlank aria-hidden weight="bold" className="size-4" /> Schedule Report
              </button>
            </div>
          </section>
          <section className={card} aria-label="Quick date range" data-testid="quick-range">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Quick Date Range</h2>
            <div className="grid grid-cols-3 gap-2">
              {QUICK.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={!fixed && presetValue === p}
                  onClick={() => {
                    setFixed(undefined);
                    setPreset(p);
                    setPage(1);
                  }}
                  className={`min-h-9 rounded-control border px-2 text-xs font-medium ${!fixed && presetValue === p ? 'border-action bg-action text-on-action' : 'border-border text-heading hover:bg-canvas'}`}
                >
                  {PRESETS.find((x) => x.value === p)!.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={!!fixed}
                onClick={() => setDialog('custom')}
                className={`min-h-9 rounded-control border px-2 text-xs font-medium ${fixed ? 'border-action bg-action text-on-action' : 'border-border text-heading hover:bg-canvas'}`}
              >
                Custom Range
              </button>
            </div>
            {r ? <p className="mt-2 text-xs text-muted">{rangeText(r.range)}</p> : null}
          </section>
          <section
            className={`${card} flex flex-col gap-3`}
            aria-label="Report settings"
            data-testid="report-settings"
          >
            <h2 className="font-display text-lg font-bold text-heading">Report Settings</h2>
            <Select
              label="Chart Type"
              value={chartType}
              onChange={(e) => setChartType(e.target.value)}
              options={CHARTS}
            />
            <label className="flex items-center justify-between gap-3 text-sm text-heading">
              Show Comparison Period
              <Toggle
                label="Show comparison period"
                checked={compareValue !== 'NONE'}
                onChange={(on) => {
                  setCompare(on ? 'PREVIOUS_PERIOD' : 'NONE');
                  setPage(1);
                }}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-heading">
              Show Data Labels
              <Toggle label="Show data labels" checked={labels} onChange={setLabels} />
            </label>
            {src?.supportsTaxToggle ? (
              <label className="flex items-center justify-between gap-3 text-sm text-heading">
                Include Tax in Revenue
                <Toggle label="Include tax in revenue" checked={tax} onChange={setTax} />
              </label>
            ) : null}
          </section>
          <section className={card} aria-label="Insights" data-testid="report-insights">
            <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-heading">
              <Lightbulb aria-hidden weight="fill" className="size-5 text-action" /> Insights
            </h2>
            {r && r.insights.length === 0 ? (
              <p className={quiet}>No insights for this range.</p>
            ) : null}
            <ul>
              {(r?.insights ?? []).map((i) => (
                <li key={i.key}>
                  <Link
                    href={
                      i.target.kind === 'REPORT'
                        ? `/reports/${i.target.reportKey}`
                        : `/${i.target.module}`
                    }
                    className="flex items-start gap-3 border-t border-divider py-2 text-sm text-heading first:border-t-0 hover:text-action"
                  >
                    <span className="min-w-0 flex-1">{i.message}</span>
                    <CaretRight
                      aria-hidden
                      weight="bold"
                      className="mt-1 size-3 shrink-0 text-muted"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {dialog === 'save' && r ? (
        <SaveReportDialog
          definition={r.definition}
          defaultName={r.title}
          onClose={() => setDialog(undefined)}
          onSaved={(id) => {
            setDialog(undefined);
            router.push(`/reports/${id}`);
          }}
        />
      ) : null}
      {dialog === 'schedule' && r ? (
        <ScheduleReportDialog
          target={target}
          defaultName={`${r.title} schedule`}
          onClose={() => setDialog(undefined)}
          onNotice={notice}
        />
      ) : null}
      {dialog === 'custom' ? (
        <CustomRange
          onClose={() => setDialog(undefined)}
          onApply={(f) => {
            setFixed(f);
            setPage(1);
            setDialog(undefined);
          }}
        />
      ) : null}
      {dialog === 'filters' ? (
        <MoreFilters
          fields={(src?.fields ?? []).filter((f) => f.filterable)}
          value={extra}
          onClose={() => setDialog(undefined)}
          onApply={(v) => {
            setExtra(v);
            setPage(1);
            setDialog(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function CustomRange({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (f: { from: string; to: string }) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <Modal
      open
      title="Custom Range"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!from || !to || from > to} onClick={() => onApply({ from, to })}>
            Apply
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2" data-testid="custom-range">
        <label className="flex flex-col gap-1 text-sm font-medium text-heading">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm font-normal text-text"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-heading">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm font-normal text-text"
          />
        </label>
      </div>
    </Modal>
  );
}

function MoreFilters({
  fields,
  value,
  onClose,
  onApply,
}: {
  fields: {
    key: string;
    label: string;
    type: string;
    options: { value: string; label: string }[];
  }[];
  value: { field: string; op: string; value: string }[];
  onClose: () => void;
  onApply: (v: { field: string; op: string; value: string }[]) => void;
}) {
  const [rows, setRows] = useState(value);
  return (
    <Modal
      open
      title="More Filters"
      subtitle="Added to the report's own filters."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(rows.filter((r) => r.field))}>Apply</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="more-filters">
        {rows.length === 0 ? <p className={quiet}>No extra filters.</p> : null}
        {rows.map((r, i) => {
          const f = fields.find((x) => x.key === r.field);
          return (
            <div
              key={`${r.field}-${i}`}
              className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_1fr_auto]"
            >
              <Select
                label="Field"
                value={r.field}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) =>
                      j === i ? { field: e.target.value, op: 'IS', value: '' } : x,
                    ),
                  )
                }
                options={fields.map((x) => ({ value: x.key, label: x.label }))}
              />
              <Select
                label="Is"
                value={r.op}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))
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
                  value={r.value}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                  options={[{ value: '', label: 'Choose…' }, ...f.options]}
                />
              ) : (
                <label className="flex flex-col gap-1 text-sm font-medium text-heading">
                  Value
                  <input
                    value={r.value}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                    }
                    className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm font-normal text-text"
                  />
                </label>
              )}
              <button
                type="button"
                aria-label={`Remove filter ${i + 1}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="min-h-10 px-2 text-sm font-medium text-danger"
              >
                Remove
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="w-fit text-sm font-medium text-link"
          disabled={!fields[0]}
          onClick={() =>
            fields[0] && setRows([...rows, { field: fields[0].key, op: 'IS', value: '' }])
          }
        >
          + Add Filter
        </button>
      </div>
    </Modal>
  );
}
