'use client';

import {
  ApiRequestError,
  type ReportDefinitionView,
  type ReportFilterCondition,
  type ReportResult,
} from '@firmivra/types';
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
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { ORIGIN_PARAM, safeOrigin } from '../../../../../lib/origin';
import { useApiQuery } from '../../../../../lib/query';
import { type FilterDraft, type FilterField, conditionsOf } from './filter-rules';
import { CustomRangeDialog } from './report-date-controls';
import { datesFrom } from './report-dates';
import { SaveReportDialog, ScheduleReportDialog } from './report-dialogs';
import { FilterRows } from './report-filters';
import {
  BarChart,
  CATEGORY_META,
  CategoryTile,
  COMPARE,
  EXPORT_ERRORS,
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
/** More Filters as typed and as sent (only rows that fit are ever applied). */
interface Extra {
  rows: FilterDraft[];
  conditions: ReportFilterCondition[];
}
const NO_EXTRA: Extra = { rows: [], conditions: [] };
/** A run's result, or why it could not run with the last result of this report kept (RP-F02). */
interface Run {
  result: ReportResult | undefined;
  error: unknown;
}
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
  const params = useSearchParams();
  const target = UUID.test(reportId)
    ? ({ kind: 'SAVED', id: reportId } as const)
    : ({ kind: 'SYSTEM', key: reportId } as const);
  // RP-F01 (Octavia, Oct 28): opened from the overview, the report starts on its range and
  // comparison (they come in the address), not on its own defaults.
  const linked = datesFrom(params);
  const [preset, setPreset] = useState<string | undefined>(
    linked?.rule === 'ROLLING' ? linked.preset : undefined,
  );
  const [fixed, setFixed] = useState<{ from: string; to: string } | undefined>(
    linked?.rule === 'FIXED' ? { from: linked.from, to: linked.to } : undefined,
  );
  // RP-F06 (Octavia, Oct 28): a control left alone is the report's own setting, so a saved report
  // reopens as it was saved (comparison, chart, labels, tax, range); a quick report still opens
  // compared with the same period last year.
  const [compare, setCompare] = useState<string | undefined>(
    linked?.compare ?? (target.kind === 'SYSTEM' ? 'SAME_PERIOD_LAST_YEAR' : undefined),
  );
  const [clientType, setClientType] = useState('ALL');
  const [service, setService] = useState('');
  const [chartType, setChartType] = useState<string>();
  // IP-F22 (Octavia's D2): the breakdown's Group By, this run only.
  const [groupBy, setGroupBy] = useState('');
  const [labels, setLabels] = useState<boolean>();
  const [tax, setTax] = useState<boolean>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ id: string; descending: boolean }>();
  const [hidden, setHidden] = useState<string[]>([]);
  const [extra, setExtra] = useState<Extra>(NO_EXTRA);
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
    ...(extra.conditions.length ? { extraFilters: { conditions: extra.conditions } } : {}),
    ...(term ? { search: term } : {}),
    ...(sort ? { sort: { field: sort.id, descending: sort.descending } } : {}),
    ...(groupBy ? { breakdownBy: groupBy } : {}),
    ...(chartType ? { chartType: chartType as never } : {}),
    ...(labels === undefined ? {} : { showDataLabels: labels }),
    ...(tax === undefined ? {} : { includeTaxRevenue: tax }),
    page,
    pageSize: 10,
  };
  const client = useQueryClient();
  const q = useQuery({
    queryKey: [...RP_KEY, 'run', JSON.stringify(req)],
    queryFn: async (): Promise<Run> => {
      try {
        return { result: await api.reports.run(req), error: null };
      } catch (error) {
        // RP-F02 (Octavia, Oct 28): settings the report cannot run with keep its last results
        // on screen with the reason, and every control stays to change them.
        const mine = `{"target":${JSON.stringify(target)}`;
        const last = client
          .getQueryCache()
          .findAll({ queryKey: [...RP_KEY, 'run'] })
          .filter((x) => {
            const run = x.state.data as Run | undefined;
            return (
              String(x.queryKey[RP_KEY.length + 1]).startsWith(mine) && !!run?.result && !run.error
            );
          })
          .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0];
        return { result: (last?.state.data as Run | undefined)?.result, error };
      }
    },
    placeholderData: keepPreviousData,
  });
  const services = useApiQuery([...RP_KEY, 'services'], () =>
    api.reports.lookups({ kind: 'SERVICE_CATEGORY' }),
  );
  const sources = useApiQuery([...RP_KEY, 'sources'], () => api.reports.sources());
  // RP-F13: a saved report's owner (or an Owner or Admin) may save changes on it.
  const savedOne = useApiQuery([...RP_KEY, 'saved-one', reportId], () =>
    target.kind === 'SAVED' ? api.reports.savedReport(reportId) : Promise.resolve(null),
  );
  const r: ReportResult | undefined = q.data?.result;
  const runError = q.data?.error ?? null;
  const reason = runError
    ? ((runError instanceof ApiRequestError ? runError.details?.[0]?.message : undefined) ??
      errorMessage(runError, RP_ERRORS))
    : '';
  const meta = r ? (CATEGORY_META[r.category] ?? CATEGORY_META['FINANCIAL']!) : undefined;

  if ((q.isError || runError) && !r)
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
      let v = await api.reports.exportReport({
        run: { ...rest, target } as never,
        format,
        hiddenColumns: hidden,
      });
      // IP-F23: the file is usually made at once; otherwise wait for it, then download it.
      for (let i = 0; !v.ready && v.status !== 'FAILED' && i < 10; i += 1) {
        await new Promise((done) => setTimeout(done, 1000));
        v = await api.reports.runStatus(v.runId);
      }
      if (!v.ready) {
        notice('The export could not be made. Try again in a moment.', 'error');
        return;
      }
      const link = await api.reports.download(v.runId);
      notice(`Export ready: ${v.fileName ?? 'report'} (${v.rowCount ?? 0} rows).`, 'success');
      // The link is an attachment: the browser saves the file and the page stays.
      const save = document.createElement('a');
      save.href = link.url;
      save.download = v.fileName ?? '';
      save.rel = 'noopener';
      save.click();
    } catch (e) {
      // A refusal says what to change (the API's own words); an export error never blames the
      // fields, as the screen has none to highlight here.
      const detail = e instanceof ApiRequestError ? e.details?.[0]?.message : undefined;
      notice(detail ?? errorMessage(e, { ...RP_ERRORS, ...EXPORT_ERRORS }), 'error');
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
  // Octavia's D2: a Financial report's breakdown groups by Service, Client or Payment Method.
  const groupOptions =
    r?.category === 'FINANCIAL'
      ? (src?.fields ?? []).filter(
          (f) => ['service', 'client', 'method'].includes(f.key) && f.groupable,
        )
      : [];
  const shownGroup =
    groupOptions.find((f) => f.label === r?.breakdown?.series[0]?.label)?.key ??
    groupOptions[0]?.key ??
    '';
  const title = r ? `${r.title}` : 'Report';
  const compareValue =
    compare ??
    (r?.comparisonRange
      ? r.definition.compareTo !== 'NONE'
        ? r.definition.compareTo
        : 'NONE'
      : 'NONE');
  // A saved fixed range shows as Custom Range with its dates (RP-F06), never as This Year.
  const ownDate = r?.definition.date;
  const shownFixed = fixed ?? (!preset && ownDate?.rule === 'FIXED' ? ownDate : undefined);
  const presetValue = shownFixed
    ? 'custom'
    : (preset ?? (ownDate?.rule === 'ROLLING' ? ownDate.preset : 'this_year'));
  const shownChart = chartType ?? r?.definition.chartType ?? 'AUTO';
  const shownLabels = labels ?? r?.definition.showDataLabels ?? false;
  const shownTax = tax ?? r?.definition.includeTaxRevenue ?? false;
  // RP-F03: opened from the library, the page's Back (SH1's bar above it, "Back to Report
  // Library") and its Saved Reports crumb return to that tab, page, search and filters.
  const from = safeOrigin(params.get(ORIGIN_PARAM));
  // RP-F13: Save Changes keeps the report's id; Save As makes a new one.
  const canSaveChanges = !!savedOne.data?.canEdit && !savedOne.data.archived;
  const saveChanges = async () => {
    const definition = screenDefinition();
    if (!definition || !savedOne.data) return;
    try {
      await api.reports.updateSaved(savedOne.data.id, {
        definition: definition as never,
        etag: savedOne.data.etag,
      });
      await client.invalidateQueries({ queryKey: [...RP_KEY] });
      notice('Changes saved.', 'success');
    } catch (e) {
      const detail = e instanceof ApiRequestError ? e.details?.[0]?.message : undefined;
      notice(detail ?? errorMessage(e, RP_ERRORS), 'error');
    }
  };
  /**
   * What the screen shows, as a definition (RP-F06): the range, comparison, chart, labels and tax
   * in effect, the table's sort, the columns not hidden and the More Filters too.
   */
  function screenDefinition(): ReportDefinitionView | undefined {
    if (!r) return undefined;
    const d = r.definition;
    const locked = new Set((src?.fields ?? []).filter((f) => f.locked).map((f) => f.key));
    const columns = d.columns.filter((c) => locked.has(c) || !hidden.includes(c));
    const sortable = sort && src?.fields.some((f) => f.key === sort.id && f.sortable);
    const added = extra.conditions as ReportDefinitionView['filters']['conditions'];
    const filters: ReportDefinitionView['filters'] = !added.length
      ? d.filters
      : d.filters.logic === 'AND' || d.filters.conditions.length === 0
        ? { ...d.filters, logic: 'AND', conditions: [...d.filters.conditions, ...added] }
        : // An OR report keeps its own conditions together, and the added ones apply to all.
          {
            logic: 'AND',
            conditions: added,
            groups: [{ logic: 'OR', conditions: d.filters.conditions }, ...d.filters.groups],
          };
    // The controls themselves, not the last result: a change still loading is saved too.
    return {
      ...d,
      columns: columns.length ? columns : d.columns,
      filters,
      ...(sortable ? { sortBy: sort.id, sortDescending: sort.descending } : {}),
      ...(fixed
        ? { date: { rule: 'FIXED' as const, ...fixed } }
        : preset
          ? { date: { rule: 'ROLLING' as const, preset: preset as never } }
          : {}),
      ...(compare && src?.supportsComparison ? { compareTo: compare as never } : {}),
      chartType: shownChart as never,
      showDataLabels: shownLabels,
      includeTaxRevenue: shownTax,
    };
  }

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="report-detail">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-link">
        <Link href="/reports">Reports</Link>
        {/* IP-F24: a saved report sits in Saved Reports, and that list is one step back. */}
        {target.kind === 'SAVED' ? (
          <>
            <span aria-hidden className="text-muted">
              ›
            </span>
            <Link href={from?.startsWith('/reports/library') ? from : '/reports/library?tab=saved'}>
              Saved Reports
            </Link>
          </>
        ) : null}
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
        {/* RP-F01: back to the overview as it was (its range and comparison), when it opened this. */}
        <Link href={from && /^\/reports(\?|$)/.test(from) ? from : '/reports'} className={outlined}>
          ← Back to Reports
        </Link>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {runError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-danger-soft p-3 text-sm text-danger"
          data-testid="run-error"
        >
          <span>
            The report could not run with these settings: {reason} It still shows the last results.
          </span>
          <span className="flex gap-4">
            <button
              type="button"
              className="font-medium text-link"
              onClick={() => setDialog('filters')}
            >
              Edit Filters
            </button>
            <button
              type="button"
              className="font-medium text-link"
              onClick={() => {
                setExtra(NO_EXTRA);
                setSearch('');
                setPage(1);
              }}
            >
              Clear All
            </button>
          </span>
        </div>
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
                { value: 'custom', label: shownFixed ? rangeText(shownFixed) : 'Custom Range…' },
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
              {extra.rows.length ? ` (${extra.rows.length})` : ''}
            </button>
          </section>
          {r && r.chips.length + extra.rows.length > 0 ? (
            <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
              {r.chips.map((c) => (
                <li
                  key={`${c.field}${c.value}`}
                  className="rounded-pill bg-info-soft px-3 py-1 text-xs text-info"
                >
                  {c.label} {c.value}
                </li>
              ))}
              {extra.rows.length ? (
                <li>
                  <button
                    type="button"
                    className="text-sm font-medium text-link"
                    onClick={() => {
                      setExtra(NO_EXTRA);
                      setPage(1);
                    }}
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
              {groupOptions.length > 0 ? (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-bold text-heading">Group By</h2>
                  <Select
                    label="Group by"
                    hideLabel
                    value={groupBy || shownGroup}
                    onChange={(e) => setGroupBy(e.target.value)}
                    options={groupOptions.map((f) => ({ value: f.key, label: f.label }))}
                  />
                </div>
              ) : (
                <h2 className="mb-3 font-display text-lg font-bold text-heading">
                  By {src?.fields.find((f) => f.key === r?.definition.groupBy)?.label ?? 'Group'}
                </h2>
              )}
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
              {canSaveChanges ? (
                <button
                  type="button"
                  className={subtle}
                  disabled={!r}
                  onClick={() => void saveChanges()}
                >
                  <Bookmark aria-hidden weight="bold" className="size-4" /> Save Changes
                </button>
              ) : null}
              <button
                type="button"
                className={subtle}
                disabled={!r}
                onClick={() => setDialog('save')}
              >
                <Bookmark aria-hidden weight="bold" className="size-4" />{' '}
                {target.kind === 'SAVED' ? 'Save As' : 'Save Report'}
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
                aria-pressed={!!shownFixed}
                onClick={() => setDialog('custom')}
                className={`min-h-9 rounded-control border px-2 text-xs font-medium ${shownFixed ? 'border-action bg-action text-on-action' : 'border-border text-heading hover:bg-canvas'}`}
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
              value={shownChart}
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
              <Toggle label="Show data labels" checked={shownLabels} onChange={setLabels} />
            </label>
            {src?.supportsTaxToggle ? (
              <label className="flex items-center justify-between gap-3 text-sm text-heading">
                Include Tax in Revenue
                <Toggle label="Include tax in revenue" checked={shownTax} onChange={setTax} />
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
          definition={screenDefinition() ?? r.definition}
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
        <CustomRangeDialog
          initial={shownFixed}
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
          value={extra.rows}
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

function MoreFilters({
  fields,
  value,
  onClose,
  onApply,
}: {
  fields: readonly FilterField[];
  value: FilterDraft[];
  onClose: () => void;
  onApply: (v: Extra) => void;
}) {
  const [rows, setRows] = useState(value);
  const [showAll, setShowAll] = useState(false);
  // RP-F02: Apply sends only filters that fit; otherwise each says what to fix and the first takes
  // the focus, and the report stays as it was.
  const apply = () => {
    const { conditions, problems } = conditionsOf(fields, rows);
    if (problems.some(Boolean)) {
      setShowAll(true);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('[data-testid="more-filters"] [aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    onApply({ rows, conditions });
  };
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
          <Button onClick={apply}>Apply</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="more-filters">
        {rows.length === 0 ? <p className={quiet}>No extra filters.</p> : null}
        <FilterRows fields={fields} rows={rows} onChange={setRows} showAll={showAll} />
      </div>
    </Modal>
  );
}
