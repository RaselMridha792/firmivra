'use client';

import type { ReportCatalogItem, ReportInsight } from '@firmivra/types';
import { DonutChart, KpiCard, Select, Toast, Toggle } from '@firmivra/ui';
import {
  ArrowRight,
  CalendarBlank,
  CaretRight,
  ChartBar,
  FileText,
  Lightbulb,
  UsersThree,
  CurrencyDollar,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import {
  CategoryTile,
  COMPARE,
  PRESETS,
  RP_ERRORS,
  RP_KEY,
  ringOf,
  card,
  dateTimeText,
  kpiMoney,
  kpiTrend,
  linkBtn,
  primary,
  quiet,
  rangeText,
} from './reports-shared';

const hrefOf = (i: ReportInsight) =>
  i.target.kind === 'REPORT' ? `/reports/${i.target.reportKey}` : `/${i.target.module}`;

/** /reports: the dashboard: range, KPI cards, report categories, quick reports, recent, scheduled and insights. */
export function ReportsDashboard() {
  const qc = useQueryClient();
  const [preset, setPreset] = useState('this_year');
  const [compare, setCompare] = useState('SAME_PERIOD_LAST_YEAR');
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const q = useApiQuery([...RP_KEY, 'dashboard', preset, compare], () =>
    api.reports.dashboard({ preset: preset as never, compareTo: compare as never }),
  );
  const d = q.data;
  const toggle = async (id: string, active: boolean) => {
    try {
      await (active ? api.reports.pauseSchedule(id) : api.reports.resumeSchedule(id));
      await qc.invalidateQueries({ queryKey: [...RP_KEY] });
    } catch (e) {
      setMessage({ text: errorMessage(e, RP_ERRORS), tone: 'error' });
    }
  };
  const kpiIcons = [UsersThree, UsersThree, CurrencyDollar, FileText];
  const compareLabel = d?.comparisonRange
    ? `vs. ${d.comparisonRange.label.toLowerCase()}`
    : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="reports-page">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <ChartBar weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">Reports</h1>
            <p className="text-base text-muted">
              Gain insights, track performance, and make informed decisions.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Select
              label="Date range"
              hideLabel
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
            />
          </div>
          <div className="w-52">
            <Select
              label="Compare to"
              hideLabel
              value={compare}
              onChange={(e) => setCompare(e.target.value)}
              options={COMPARE.map((p) => ({ value: p.value, label: p.label }))}
            />
          </div>
        </div>
      </header>
      {d ? (
        <p className="-mt-3 flex items-center gap-2 text-sm text-muted" data-testid="range">
          <CalendarBlank aria-hidden weight="fill" className="size-4 text-action" />{' '}
          {rangeText(d.range)}
          {d.stale ? ' · The numbers may be a little behind.' : ''}
        </p>
      ) : null}
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {q.isError ? (
        <p role="alert" className={quiet} data-testid="reports-error">
          Reports are not available right now. We could not load them. Try again in a moment.
        </p>
      ) : null}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            data-testid="reports-kpis"
          >
            {(d?.kpis ?? [null, null, null, null]).map((k, i) => (
              <li key={k?.key ?? i}>
                <KpiCard
                  icon={kpiIcons[i] ?? ChartBar}
                  tone="blue"
                  value={k ? kpiMoney(k) : '—'}
                  label={k?.label ?? 'Loading'}
                  loading={q.isPending}
                  {...(k && kpiTrend(k)
                    ? { trend: kpiTrend(k)!, ...(compareLabel ? { note: compareLabel } : {}) }
                    : {})}
                />
              </li>
            ))}
          </ul>
          <ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3"
            data-testid="category-cards"
          >
            {(d?.categories ?? []).map((c) => (
              <li key={c.category}>
                <section className={`${card} flex h-full flex-col gap-2`} aria-label={c.label}>
                  <div className="flex items-start gap-3">
                    <CategoryTile category={c.category} />
                    <div className="min-w-0">
                      <h2 className="font-display text-lg font-bold text-heading">{c.label}</h2>
                      {c.headline ? (
                        <p className="text-sm text-muted">
                          {c.headline.label}:{' '}
                          <span className="font-semibold text-heading">{kpiMoney(c.headline)}</span>
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {c.chart && c.allowed ? (
                    <DonutChart
                      size="sm"
                      legend
                      segments={ringOf(c.chart).segments}
                      centerValue={ringOf(c.chart).center}
                    />
                  ) : (
                    <p className={quiet}>
                      {c.allowed
                        ? 'No data in this range.'
                        : 'You do not have access to this report.'}
                    </p>
                  )}
                  {c.allowed ? (
                    <Link
                      href={`/reports/${c.reportKey}`}
                      className="mt-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-control bg-info-soft px-4 text-sm font-medium text-action hover:bg-accent-soft"
                    >
                      View Report <ArrowRight aria-hidden weight="bold" className="size-4" />
                    </Link>
                  ) : null}
                </section>
              </li>
            ))}
          </ul>
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Report tools">
          <section className={card} aria-label="Generate a custom report" data-testid="custom-card">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info"
              >
                <FileText weight="fill" className="size-6" />
              </span>
              <div>
                <h2 className="font-display text-lg font-bold text-heading">
                  Generate a Custom Report
                </h2>
                <p className="text-xs text-muted">
                  Choose your data, date range, and filters to create a custom report.
                </p>
              </div>
            </div>
            <Link
              href="/reports/builder"
              aria-disabled={d ? !d.canCreate : false}
              className={`${primary} mt-3 w-full ${d && !d.canCreate ? 'pointer-events-none opacity-50' : ''}`}
            >
              Create Custom Report <ArrowRight aria-hidden weight="bold" className="size-4" />
            </Link>
          </section>
          <section className={card} aria-label="Quick reports" data-testid="quick-reports">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Quick Reports</h2>
            <ul>
              {(d?.quickReports ?? []).map((r: ReportCatalogItem) => (
                <li key={r.key}>
                  <Link
                    href={`/reports/${r.key}`}
                    className="flex items-center gap-3 border-t border-divider py-2 text-sm font-medium text-heading first:border-t-0 hover:text-action"
                  >
                    <CategoryTile category={r.category} size="sm" />
                    {r.name}
                    <CaretRight aria-hidden weight="bold" className="ml-auto size-3 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
            {d && d.quickReports.length === 0 ? (
              <p className={quiet}>No quick reports yet.</p>
            ) : null}
          </section>
        </aside>
      </div>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-3">
        <section className={card} aria-label="Recent reports" data-testid="recent">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-heading">Recent Reports</h2>
            <Link href="/reports/library?tab=recent" className={linkBtn}>
              View All
            </Link>
          </div>
          {d && d.recent.length === 0 ? <p className={quiet}>No reports opened yet.</p> : null}
          <ul>
            {(d?.recent ?? []).map((r) => (
              <li
                key={r.runId}
                className="flex items-center gap-3 border-t border-divider py-2 first:border-t-0"
              >
                <CategoryTile category={r.category} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-heading">{r.name}</span>
                  <span className="block text-xs text-muted">
                    Generated on {dateTimeText(r.at)}
                  </span>
                </span>
                <Link
                  href={
                    r.savedReportId
                      ? `/reports/${r.savedReportId}`
                      : `/reports/${r.systemKey ?? ''}`
                  }
                  className="rounded-control bg-info-soft px-3 py-1 text-xs font-medium text-action"
                >
                  View
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className={card} aria-label="Scheduled reports" data-testid="scheduled">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-heading">Scheduled Reports</h2>
            <Link href="/reports/library?tab=scheduled" className={linkBtn}>
              View All
            </Link>
          </div>
          {d && d.scheduled.length === 0 ? (
            <p className={quiet}>No reports are scheduled.</p>
          ) : null}
          <ul>
            {(d?.scheduled ?? []).map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 border-t border-divider py-2 first:border-t-0"
              >
                <CategoryTile category={s.category} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-heading">{s.name}</span>
                  <span className="block text-xs text-muted">{s.description}</span>
                </span>
                <span className="flex items-center gap-2 text-xs font-medium text-success">
                  <Toggle
                    label={`${s.name} ${s.active ? 'on' : 'off'}`}
                    checked={s.active}
                    onChange={() => void toggle(s.id, s.active)}
                  />
                  {s.active ? 'On' : 'Off'}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className={card} aria-label="Insights and opportunities" data-testid="insights">
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-heading">
            <Lightbulb aria-hidden weight="fill" className="size-5 text-action" /> Insights &amp;
            Opportunities
          </h2>
          {d && d.insights.length === 0 ? (
            <p className={quiet}>There are no insights for this range yet.</p>
          ) : null}
          <ul>
            {(d?.insights ?? []).map((i) => (
              <li key={i.key}>
                <Link
                  href={hrefOf(i)}
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
      </div>
    </div>
  );
}
