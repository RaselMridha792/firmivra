'use client';

import {
  LEAD_STATUS_LABELS,
  type LeadAgeBucket,
  type LeadFunnelStage,
  type LeadPipelineStatus,
  type LeadReport,
  type LeadReportLeadsQuery,
  type LeadReportQuery,
  type LeadSource,
} from '@firmivra/types';
import { Checkbox, Drawer, Input, KpiCard, Select, Table } from '@firmivra/ui';
import { ArrowLeft, ChartBar, Clock, Funnel, Handshake, Users } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { LEAD_PIPELINE_KEY, SOURCE_LABELS, SOURCES } from '../../../leads/_components/lead-shared';

const STAGE_LABELS: Record<LeadFunnelStage, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  IN_FOLLOW_UP: 'In Follow-Up',
  APPOINTMENT_SCHEDULED: 'Appointment Scheduled',
  QUALIFIED: 'Qualified',
  CONVERTED: 'Converted',
};
const BUCKET_LABELS: Record<LeadAgeBucket, string> = {
  D0_7: '0–7 days',
  D8_14: '8–14 days',
  D15_30: '15–30 days',
  D31_60: '31–60 days',
  D61_PLUS: '61 days or more',
};
const FILTERS = ['from', 'to', 'source', 'serviceId', 'assignedUserId', 'campaignId'] as const;

type Drill = { metric: LeadReportLeadsQuery['metric']; key: string; title: string };

const card =
  'flex min-w-0 flex-col gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm';
const numberButton =
  'min-h-9 rounded-control px-2 text-sm font-semibold text-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus';
const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : '—';
const dayText = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** One bar: its length is the share of `whole`; the count beside it opens the leads behind it. */
function BarRow({
  label,
  value,
  whole,
  onOpen,
  note,
}: {
  label: string;
  value: number;
  whole: number;
  onOpen: () => void;
  note?: string;
}) {
  const width = whole ? Math.max(value ? 2 : 0, Math.round((value / whole) * 100)) : 0;
  return (
    <li className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3">
      <span className="text-sm text-text">{label}</span>
      <span aria-hidden className="h-3 rounded-full bg-canvas">
        <span className="block h-3 rounded-full bg-action" style={{ width: `${width}%` }} />
      </span>
      <span className="flex items-center gap-2 justify-self-end">
        <button
          type="button"
          className={numberButton}
          onClick={onOpen}
          aria-label={`${value} leads: ${label}${note ? `, ${note}` : ''}. Show them`}
        >
          {value.toLocaleString('en-US')}
        </button>
        {note ? <span className="w-28 text-xs text-muted">{note}</span> : null}
      </span>
    </li>
  );
}

/** The report for these filters (mounted only for a valid range). */
function ReportData({
  query,
  children,
}: {
  query: LeadReportQuery;
  children: (report: LeadReport) => ReactNode;
}) {
  const report = useApiQuery([...LEAD_PIPELINE_KEY, 'funnel-report', query], () =>
    api.leadPipeline.funnelReport(query),
  );
  return <PageState query={report}>{children}</PageState>;
}

/** The leads behind one number (mounted while its panel is open). */
function DrillLeads({ query, drill }: { query: LeadReportQuery; drill: Drill }) {
  const leads = useApiQuery(
    [...LEAD_PIPELINE_KEY, 'funnel-report-leads', query, drill.metric, drill.key],
    () => api.leadPipeline.funnelReportLeads({ ...query, metric: drill.metric, key: drill.key }),
  );
  return (
    <>
      {leads.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(leads.error)}
        </p>
      ) : null}
      <div data-testid="report-leads" className="flex flex-col gap-3">
        {leads.data && leads.data.total > leads.data.items.length ? (
          <p className="text-sm text-muted">
            Showing {leads.data.items.length} of {leads.data.total}.
          </p>
        ) : null}
        <Table
          rows={leads.data?.items ?? []}
          rowKey={(l) => l.id}
          caption={drill.title}
          loading={leads.isPending}
          dense
          emptyTitle="No leads"
          emptyText="No lead is behind this number."
          columns={[
            {
              id: 'name',
              label: 'Lead',
              cell: (l) => (
                <Link href={`/leads/${l.id}`} className="font-medium text-link hover:underline">
                  {l.name}
                </Link>
              ),
            },
            {
              id: 'status',
              label: 'Status',
              cell: (l) => LEAD_STATUS_LABELS[l.status as LeadPipelineStatus] ?? l.status,
            },
            {
              id: 'source',
              label: 'Source',
              cell: (l) => SOURCE_LABELS[l.source as LeadSource] ?? l.source,
            },
            { id: 'owner', label: 'Assigned to', cell: (l) => l.owner ?? 'Unassigned' },
            {
              id: 'stage',
              label: 'Days in stage',
              cell: (l) => (l.daysInStage === null ? '—' : l.daysInStage),
            },
            {
              id: 'idle',
              label: 'Days since activity',
              cell: (l) => (l.daysIdle === null ? 'None yet' : l.daysIdle),
            },
          ]}
        />
      </div>
    </>
  );
}

/**
 * Reports > Leads (Leads R2 18): the funnel (how many leads reached each stage, where they are now,
 * how many closed without converting, the conversion rate) and aging (open leads by time in their
 * stage and since their last meaningful activity), for leads that came in between two firm days,
 * with the Leads list's filters. Every number opens the leads behind it. Linked from the Leads
 * summary cards and the Reports overview's Leads card; the same firm and role reach as the list.
 */
export function LeadsReport() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { role } = useFirm();
  const manager = role !== undefined && role !== 'STAFF';
  // The filters as first opened (a link from Leads sets them); then this state, which the address
  // follows, so quick changes in a row all count.
  const [filters, setFilters] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [...FILTERS, 'archived'].flatMap((k) => {
        const v = params.get(k);
        return v ? [[k, v]] : [];
      }),
    ),
  );
  const query = {
    ...Object.fromEntries(FILTERS.flatMap((k) => (filters[k] ? [[k, filters[k]]] : []))),
    ...(filters['archived'] === 'include' ? { archived: 'include' as const } : {}),
  } as LeadReportQuery;
  const reversed = !!query.from && !!query.to && query.from > query.to;
  const [drill, setDrill] = useState<Drill | null>(null);
  const options = useApiQuery([...LEAD_PIPELINE_KEY, 'options'], () => api.leadPipeline.options());
  const set = (patch: Record<string, string>) =>
    setFilters((current) =>
      Object.fromEntries(Object.entries({ ...current, ...patch }).filter(([, v]) => v)),
    );
  useEffect(() => {
    const text = new URLSearchParams(filters).toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }, [filters, pathname, router]);
  const open = (metric: Drill['metric'], key: string, title: string) =>
    setDrill({ metric, key, title });

  const body = (r: LeadReport) => {
    const converted = r.funnel.find((f) => f.stage === 'CONVERTED')?.reached ?? 0;
    return (
      <>
        <p className="-mt-2 text-sm text-muted" data-testid="report-range">
          Leads that came in from {dayText(r.from)} to {dayText(r.to)} (your firm&apos;s days). Ages
          count to {dayText(r.today)}.
        </p>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Totals">
          <li>
            <KpiCard icon={Users} tone="blue" value={r.total} label="Leads counted" />
          </li>
          <li>
            <KpiCard icon={Handshake} tone="green" value={converted} label="Converted to clients" />
          </li>
          <li>
            <KpiCard
              icon={ChartBar}
              tone="purple"
              value={r.conversionRate === null ? '—' : `${Math.round(r.conversionRate * 100)}%`}
              label="Conversion rate"
            />
          </li>
          <li>
            <KpiCard icon={Clock} tone="amber" value={r.aging.open} label="Open leads" />
          </li>
        </ul>

        <section className={card} aria-label="Funnel" data-testid="report-funnel">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-heading">
            <Funnel aria-hidden weight="fill" className="size-5 text-action" /> Funnel
          </h2>
          {r.total === 0 ? (
            <p className="text-sm text-muted">No leads came in on these days.</p>
          ) : null}
          <ul className="flex flex-col gap-2" aria-label="Reached each stage">
            {r.funnel.map((f) => (
              <BarRow
                key={f.stage}
                label={STAGE_LABELS[f.stage]}
                value={f.reached}
                whole={r.total}
                note={`${percent(f.reached, r.total)} reached`}
                onOpen={() => open('REACHED', f.stage, `Reached ${STAGE_LABELS[f.stage]}`)}
              />
            ))}
          </ul>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-heading">Where they are now</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {r.funnel.map((f) => (
                  <li key={f.stage} className="flex items-center justify-between gap-2">
                    <span className="text-text">{STAGE_LABELS[f.stage]}</span>
                    <button
                      type="button"
                      className={numberButton}
                      aria-label={`${f.current} leads in ${STAGE_LABELS[f.stage]} now. Show them`}
                      onClick={() => open('CURRENT', f.stage, `In ${STAGE_LABELS[f.stage]} now`)}
                    >
                      {f.current}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-heading">Closed without converting</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {(
                  [
                    ['NOT_QUALIFIED', 'Not Qualified', r.closed.notQualified],
                    ['LOST', 'No Response', r.closed.lost],
                  ] as const
                ).map(([key, label, value]) => (
                  <li key={key} className="flex items-center justify-between gap-2">
                    <span className="text-text">{label}</span>
                    <button
                      type="button"
                      className={numberButton}
                      aria-label={`${value} leads closed as ${label}. Show them`}
                      onClick={() => open('CLOSED', key, label)}
                    >
                      {value}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={card} aria-label="Aging" data-testid="report-aging">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-heading">
            <Clock aria-hidden weight="fill" className="size-5 text-action" /> Aging of open leads
          </h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-heading">Time in current stage</h3>
              <ul className="flex flex-col gap-2" aria-label="Time in current stage">
                {r.aging.inStage.map((b) => (
                  <BarRow
                    key={b.bucket}
                    label={BUCKET_LABELS[b.bucket]}
                    value={b.count}
                    whole={r.aging.open}
                    onOpen={() =>
                      open('IN_STAGE', b.bucket, `In their stage ${BUCKET_LABELS[b.bucket]}`)
                    }
                  />
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-heading">Time since last activity</h3>
              <ul className="flex flex-col gap-2" aria-label="Time since last activity">
                {r.aging.idle.map((b) => (
                  <BarRow
                    key={b.bucket}
                    label={BUCKET_LABELS[b.bucket]}
                    value={b.count}
                    whole={r.aging.open}
                    onOpen={() =>
                      open('IDLE', b.bucket, `No activity for ${BUCKET_LABELS[b.bucket]}`)
                    }
                  />
                ))}
                <BarRow
                  label="No activity yet"
                  value={r.aging.noActivity}
                  whole={r.aging.open}
                  onOpen={() => open('IDLE', 'NONE', 'No activity yet')}
                />
              </ul>
            </div>
          </div>
          <Table
            rows={r.aging.byStage}
            rowKey={(s) => s.stage}
            caption="Open leads by stage"
            dense
            columns={[
              { id: 'stage', label: 'Stage', cell: (s) => STAGE_LABELS[s.stage] },
              {
                id: 'open',
                label: 'Open leads',
                cell: (s) => (
                  <button
                    type="button"
                    className={numberButton}
                    aria-label={`${s.open} open leads in ${STAGE_LABELS[s.stage]}. Show them`}
                    onClick={() => open('OPEN_STAGE', s.stage, `Open in ${STAGE_LABELS[s.stage]}`)}
                  >
                    {s.open}
                  </button>
                ),
              },
              {
                id: 'average',
                label: 'Average days in stage',
                cell: (s) => (s.averageDays === null ? '—' : s.averageDays),
              },
            ]}
          />
        </section>
      </>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="leads-report">
      <Link
        href="/reports"
        className="flex w-fit items-center gap-2 text-sm font-medium text-link hover:underline"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Reports
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
            Leads Funnel &amp; Aging
          </h1>
          <p className="mt-1 text-sm text-muted">
            How your leads move through the stages, and how long open leads wait.
          </p>
        </div>
        <Link
          href="/leads"
          className="inline-flex min-h-11 items-center rounded-control border border-border bg-surface px-4 text-sm font-medium text-heading hover:bg-canvas"
        >
          Open Leads
        </Link>
      </header>

      <section aria-label="Report filters" className={`${card} gap-3`}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Input
            type="date"
            label="From"
            value={query.from ?? ''}
            onChange={(e) => set({ from: e.target.value })}
          />
          <Input
            type="date"
            label="To"
            value={query.to ?? ''}
            onChange={(e) => set({ to: e.target.value })}
            error={reversed ? 'End date must be on or after the start date' : undefined}
          />
          <Select
            label="Source"
            value={query.source ?? ''}
            onChange={(e) => set({ source: e.target.value })}
            options={[
              { value: '', label: 'All sources' },
              ...SOURCES.map((s) => ({ value: s.value, label: s.label })),
            ]}
          />
          <Select
            label="Service"
            value={query.serviceId ?? ''}
            onChange={(e) => set({ serviceId: e.target.value })}
            options={[
              { value: '', label: 'All services' },
              ...(options.data?.services ?? []).map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          {manager ? (
            <Select
              label="Assigned to"
              value={query.assignedUserId ?? ''}
              onChange={(e) => set({ assignedUserId: e.target.value })}
              options={[
                { value: '', label: 'Everyone' },
                ...(options.data?.staff ?? []).map((m) => ({ value: m.userId, label: m.name })),
              ]}
            />
          ) : null}
          <Select
            label="Campaign"
            value={query.campaignId ?? ''}
            onChange={(e) => set({ campaignId: e.target.value })}
            options={[
              { value: '', label: 'All campaigns' },
              ...(options.data?.campaigns ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <Checkbox
          label="Include archived leads"
          checked={query.archived === 'include'}
          onChange={(e) => set({ archived: e.target.checked ? 'include' : '' })}
        />
        <p className="text-xs text-muted">
          Without dates: the last 90 days.{' '}
          {manager ? null : 'You see the leads assigned to you, as on the Leads list.'}
        </p>
      </section>

      {reversed ? null : <ReportData query={query}>{body}</ReportData>}

      <section className={card} aria-label="How these are counted" data-testid="report-definitions">
        <h2 className="font-display text-lg font-bold text-heading">How these are counted</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text">
          <li>
            Leads counted: leads that came in on the chosen days (never a draft or a lead merged
            into another), with the filters above. Archived leads only when included.
          </li>
          <li>
            Stages, in order: New (New Lead or In Review), Contacted, In Follow-Up, Appointment
            Scheduled, Qualified, Converted. A lead reached a stage when it is there or further now,
            or its history shows it there (a lead lost after Qualified still reached Qualified).
          </li>
          <li>Conversion rate: leads converted to clients over the leads counted.</li>
          <li>
            Open leads: New to Qualified and not archived. Time in current stage counts from the
            lead&apos;s latest move into that stage (or from when it came in).
          </li>
          <li>
            Time since last activity: since the latest message, call, meeting, note, completed
            follow-up, appointment, status change, form or document. Creating, tagging or assigning
            a lead is not activity.
          </li>
        </ul>
      </section>

      {drill ? (
        <Drawer
          open
          size="wide"
          title={drill.title}
          subtitle="The leads behind this number, the longest waiting first."
          onClose={() => setDrill(null)}
        >
          <DrillLeads query={query} drill={drill} />
        </Drawer>
      ) : null}
    </div>
  );
}
