'use client';

import type { PayrollOverview } from '@firmivra/types';
import { Badge, DonutChart, type DonutSegment, type ChartTone } from '@firmivra/ui';
import {
  ArrowRight,
  CalendarCheck,
  ChartBar,
  ChartPieSlice,
  FileText,
  Plugs,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CLIENT_STATUS_LABEL,
  FREQUENCY_LABEL,
  STATUS_TONE,
  card,
  dayText,
  linkBtn,
  moneyShort,
  quiet,
  CardHead,
} from './payroll-shared';

const DOT: Record<string, string> = {
  green: 'bg-chart-green',
  blue: 'bg-chart-blue',
  yellow: 'bg-chart-yellow',
  grey: 'bg-chart-grey',
  red: 'bg-chart-red',
  purple: 'bg-purple',
  navy: 'bg-heading',
};
/** The ring's legend under it: colour, name, count and share. */
function Legend({
  rows,
}: {
  rows: { label: string; tone: string; count: string; percent: number }[];
}) {
  return (
    <ul className="mt-3 flex flex-col gap-1 text-sm" aria-label="Legend">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${DOT[r.tone]}`} />
          <span className="min-w-0 flex-1 truncate text-heading">{r.label}</span>
          <span className="font-semibold text-heading">{r.count}</span>
          <span className="w-10 text-right text-xs text-muted">{r.percent}%</span>
        </li>
      ))}
    </ul>
  );
}
const compact = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(cents / 100);

interface Props {
  data: PayrollOverview | undefined;
  loading: boolean;
  failed: boolean;
}
const note = (p: Props, empty: string, error: string) =>
  p.failed ? error : p.loading ? 'Loading…' : empty;

/** Payroll Status: the ring of payroll clients by workflow status. */
export function StatusCard(p: Props) {
  const items = p.data?.statusBreakdown.items ?? [];
  const segments: DonutSegment[] = items.map((i) => ({
    label: CLIENT_STATUS_LABEL[i.status],
    value: i.count,
    tone: STATUS_TONE[i.status],
  }));
  return (
    <section className={card} data-testid="card-status" aria-label="Payroll Status">
      <CardHead icon={ChartPieSlice} title="Payroll Status" />
      {p.failed || p.loading ? (
        <p className={quiet}>{note(p, '', 'Payroll status is not available right now.')}</p>
      ) : (
        <>
          <DonutChart
            segments={segments}
            centerValue={p.data?.statusBreakdown.total ?? 0}
            centerLabel="Clients"
            legend={false}
            size="sm"
            emptyText="No payroll clients yet."
            label="Payroll clients by status"
          />
          <Legend
            rows={items.map((i) => ({
              label: CLIENT_STATUS_LABEL[i.status],
              tone: STATUS_TONE[i.status],
              count: String(i.count),
              percent: p.data?.statusBreakdown.total
                ? Math.round((i.count / p.data.statusBreakdown.total) * 100)
                : 0,
            }))}
          />
        </>
      )}
    </section>
  );
}

/** Payroll Volume: gross payroll and taxes and deductions by month, from the provider's confirmed runs. */
export function VolumeCard(p: Props) {
  const rows = p.data?.volume ?? [];
  const max = Math.max(1, ...rows.flatMap((r) => [r.grossCents, r.taxesAndDeductionsCents]));
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  return (
    <section className={card} data-testid="card-volume" aria-label="Payroll Volume">
      <CardHead icon={ChartBar} title="Payroll Volume" />
      {rows.length === 0 ? (
        <p className={quiet}>
          {note(p, 'No confirmed payroll runs yet.', 'Payroll volume is not available right now.')}
        </p>
      ) : (
        <>
          <ul className="mb-2 flex gap-4 text-xs text-text" aria-label="Legend">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-heading" />
              Gross Payroll
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-chart-yellow" />
              Taxes &amp; Deductions
            </li>
          </ul>
          <div
            className="flex gap-2"
            role="img"
            aria-label="Gross payroll and taxes and deductions by month"
          >
            <div
              className="flex h-36 flex-col justify-between text-right text-[0.625rem] text-muted"
              aria-hidden
            >
              {ticks.map((t) => (
                <span key={t}>{moneyShort(Math.round(max * t))}</span>
              ))}
            </div>
            <div className="flex h-36 min-w-0 flex-1 items-end gap-1 border-b border-l border-divider px-1">
              {rows.map((r) => (
                <div
                  key={r.month}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                >
                  <div className="flex h-full w-full items-end justify-center gap-px">
                    <span
                      className="w-1/2 max-w-3 rounded-t-sm bg-heading"
                      style={{ height: `${(r.grossCents / max) * 100}%` }}
                    />
                    <span
                      className="w-1/2 max-w-3 rounded-t-sm bg-chart-yellow"
                      style={{ height: `${(r.taxesAndDeductionsCents / max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex gap-1 pl-12 text-[0.625rem] text-muted" aria-hidden>
            {rows.map((r) => (
              <span key={r.month} className="min-w-0 flex-1 text-center">
                {new Date(`${r.month}-01T12:00:00Z`).toLocaleDateString('en-US', {
                  timeZone: 'UTC',
                  month: 'short',
                })}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const PROVIDER_TONES: ChartTone[] = ['blue', 'green', 'yellow', 'purple', 'red', 'grey'];

/** Payroll by Provider: the share of confirmed gross payroll by provider. */
export function ByProviderCard(p: Props) {
  const items = p.data?.byProvider.items ?? [];
  const segments: DonutSegment[] = items.map((i, n) => ({
    label: i.label,
    value: i.grossCents,
    tone: PROVIDER_TONES[n % PROVIDER_TONES.length]!,
  }));
  return (
    <section className={card} data-testid="card-provider-chart" aria-label="Payroll by Provider">
      <CardHead icon={ChartPieSlice} title="Payroll by Provider" />
      {p.failed || p.loading ? (
        <p className={quiet}>{note(p, '', 'Payroll by provider is not available right now.')}</p>
      ) : (
        <>
          <DonutChart
            segments={segments}
            centerValue={compact(p.data?.byProvider.totalCents ?? 0)}
            centerLabel="Total Payroll"
            legend={false}
            size="sm"
            emptyText="No confirmed payroll yet."
            label="Payroll by provider"
          />
          <Legend
            rows={items.map((i, n) => ({
              label: i.label,
              tone: PROVIDER_TONES[n % PROVIDER_TONES.length]!,
              count: compact(i.grossCents),
              percent: i.sharePercent,
            }))}
          />
        </>
      )}
    </section>
  );
}

/** Connected Payroll Providers: each provider, its clients and its connection. */
export function ProvidersCard({
  data,
  loading,
  failed,
  onConnect,
}: Props & { onConnect: () => void }) {
  const rows = data?.providers ?? [];
  return (
    <section className={card} data-testid="card-providers" aria-label="Connected Payroll Providers">
      <CardHead
        icon={Plugs}
        title="Connected Payroll Providers"
        aside={
          <Link href="/modules/integrations" className={linkBtn}>
            Manage Integrations
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className={quiet}>
          {note(
            { data, loading, failed },
            'No providers are set up yet.',
            'Providers are not available right now.',
          )}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li
              key={r.key ?? 'none'}
              className="flex items-center justify-between gap-2 border-t border-divider py-2 first:border-t-0"
            >
              <span className="min-w-0 truncate text-sm font-semibold text-heading">{r.label}</span>
              <span className="shrink-0 text-xs text-muted">
                {r.clientCount} {r.clientCount === 1 ? 'Client' : 'Clients'}
              </span>
              {r.connected ? (
                <Badge tone="success">Connected</Badge>
              ) : (
                <button
                  type="button"
                  onClick={onConnect}
                  className="rounded-pill bg-info-soft px-3 py-1 text-xs font-semibold text-action"
                >
                  Connect
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Upcoming Payroll Runs: the next pay dates. */
export function UpcomingCard({ data, loading, failed, onAll }: Props & { onAll: () => void }) {
  const router = useRouter();
  const rows = data?.upcomingRuns ?? [];
  return (
    <section className={card} data-testid="card-upcoming" aria-label="Upcoming Payroll Runs">
      <CardHead
        icon={CalendarCheck}
        title="Upcoming Payroll Runs"
        aside={
          <button type="button" onClick={onAll} className={linkBtn}>
            View All <ArrowRight aria-hidden weight="bold" className="size-3" />
          </button>
        }
      />
      {rows.length === 0 ? (
        <p className={quiet}>
          {note(
            { data, loading, failed },
            'No payroll runs are coming up.',
            'Upcoming runs are not available right now.',
          )}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.payrollClientId} className="border-t border-divider first:border-t-0">
              <button
                type="button"
                onClick={() => router.push(`/payroll/clients/${r.payrollClientId}`)}
                className="flex w-full items-center gap-3 py-2 text-left"
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-divider text-action"
                >
                  <CalendarCheck weight="fill" className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-heading">
                    {r.clientName}
                  </span>
                  <span className="text-xs text-muted">{dayText(r.nextPayrollOn)}</span>
                </span>
                {r.frequency ? <Badge tone="info">{FREQUENCY_LABEL[r.frequency]}</Badge> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Helpful Resources: nothing is invented; the firm's own guides are linked when they exist. */
export function ResourcesCard() {
  return (
    <section className={card} data-testid="card-resources" aria-label="Helpful Resources">
      <CardHead icon={FileText} title="Helpful Resources" />
      <p className={quiet}>No payroll guides are linked yet.</p>
    </section>
  );
}
