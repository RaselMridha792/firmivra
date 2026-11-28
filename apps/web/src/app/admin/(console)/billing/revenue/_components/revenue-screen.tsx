'use client';

import {
  BILLING_REVENUE_MAX_DAYS,
  BILLING_REVENUE_TYPE_LABELS,
  billingMonthOf,
  billingRevenuePrevious,
  type BillingRevenuePeriod,
  BillingRevenueType,
} from '@firmivra/types';
import { Button, FormField, Toggle } from '@firmivra/ui';
import { ArrowCounterClockwise, ChartLineUp, Repeat, Receipt } from '@phosphor-icons/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef } from 'react';
import { useApiQuery } from '../../../../../../lib/query';
import { adminBilling } from '../../_components/billing-api';
import { DateControl, SelectControl, inputClass } from '../../_components/billing-fields';
import { formatDate, formatMoney } from '../../_components/billing-format';
import { BillingKpiCard, quietErrorText } from '../../_components/billing-parts';
import { BillingHeader, BillingTabs } from '../../_components/billing-shell';

/** Today in the billing zone (America/New_York): the API counts billing days there. */
const billingToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const monthName = (dayText: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${dayText}T00:00:00Z`),
  );

/** "November 2026" for a whole month, else "11/01/2026 – 11/10/2026". */
function periodLabel(from: string, to: string): string {
  const month = billingMonthOf(from);
  return month.from === from && month.to === to
    ? monthName(from)
    : `${formatDate(from)} – ${formatDate(to)}`;
}

/** What the address asks for, or this month, both types, no compare (the Dashboard's link). */
function readQuery(params: URLSearchParams) {
  const thisMonth = billingMonthOf(billingToday());
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const valid = DAY.test(from) && DAY.test(to);
  const type = BillingRevenueType.safeParse(params.get('type'));
  return {
    from: valid ? from : thisMonth.from,
    to: valid ? to : thisMonth.to,
    type: type.success ? type.data : ('ALL' as const),
    compare: params.get('compare') === 'true',
  };
}

function rangeProblem(from: string, to: string): string {
  if (from > to) return 'Choose a start on or before the end.';
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 >= BILLING_REVENUE_MAX_DAYS)
    return `Choose at most ${BILLING_REVENUE_MAX_DAYS} days.`;
  return '';
}

/**
 * SA-BIL-A1: Billing > Revenue. Collected payments (gross) by payment date, with the type
 * (one-time, recurring or both) and the period in the address, so the Dashboard's Monthly
 * Revenue opens this month and Back or a reload keep the view. "Compare" sets the previous
 * period beside the current one; it never replaces it. Refunds are their own line.
 */
export function RevenueScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fieldId = useId();
  const query = readQuery(new URLSearchParams(params.toString()));
  // The latest choice, ahead of the address: two quick changes (From, then To) both stay.
  const address = params.toString();
  const latestRef = useRef(query);
  useEffect(() => {
    latestRef.current = readQuery(new URLSearchParams(address));
  }, [address]);
  const problem = rangeProblem(query.from, query.to);
  const revenue = useApiQuery(
    ['admin-billing', 'revenue', query.from, query.to, query.type, query.compare],
    () => (problem ? Promise.resolve(null) : adminBilling.revenue(query)),
  );

  const go = (patch: Partial<typeof query>) => {
    const next = { ...latestRef.current, ...patch };
    latestRef.current = next;
    const search = new URLSearchParams({
      from: next.from,
      to: next.to,
      type: next.type,
      ...(next.compare ? { compare: 'true' } : {}),
    });
    router.replace(`${pathname}?${search.toString()}`, { scroll: false });
  };
  const month = (dayText: string) => go(billingMonthOf(dayText));
  const today = billingToday();
  const thisMonth = billingMonthOf(today);
  const previousMonthStart = billingRevenuePrevious(thisMonth.from, thisMonth.to).from;
  const wholeMonth =
    billingMonthOf(query.from).from === query.from && billingMonthOf(query.from).to === query.to;
  const before = billingRevenuePrevious(query.from, query.to);
  const data = revenue.data ?? null;
  const loading = revenue.isLoading;
  const failed = revenue.isError;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingHeader
        title="Revenue"
        subtitle="Collected payments (gross) by payment date, in Eastern time. Refunds are shown on their own line."
      />
      <BillingTabs active="revenue" compact />

      <section
        aria-label="Revenue filters"
        data-testid="revenue-filters"
        className="grid gap-4 rounded-xl bg-surface p-4 shadow-sm md:grid-cols-2 xl:grid-cols-4"
      >
        <FormField label="Type" htmlFor={`${fieldId}-type`}>
          <SelectControl
            id={`${fieldId}-type`}
            value={query.type}
            options={BillingRevenueType.options.map((value) => ({
              value,
              label: BILLING_REVENUE_TYPE_LABELS[value],
            }))}
            onChange={(event) => go({ type: BillingRevenueType.parse(event.target.value) })}
          />
        </FormField>
        <FormField label="Month" htmlFor={`${fieldId}-month`}>
          <input
            id={`${fieldId}-month`}
            type="month"
            value={wholeMonth ? query.from.slice(0, 7) : ''}
            max={today.slice(0, 7)}
            onChange={(event) => {
              if (/^\d{4}-\d{2}$/.test(event.target.value)) month(`${event.target.value}-01`);
            }}
            className={inputClass()}
          />
        </FormField>
        <FormField label="From" htmlFor={`${fieldId}-from`} error={problem || undefined}>
          <DateControl
            id={`${fieldId}-from`}
            value={query.from}
            invalid={Boolean(problem)}
            onChange={(event) => DAY.test(event.target.value) && go({ from: event.target.value })}
          />
        </FormField>
        <FormField label="To" htmlFor={`${fieldId}-to`}>
          <DateControl
            id={`${fieldId}-to`}
            value={query.to}
            invalid={Boolean(problem)}
            onChange={(event) => DAY.test(event.target.value) && go({ to: event.target.value })}
          />
        </FormField>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2 xl:col-span-4">
          <Button variant="secondary" onClick={() => month(today)}>
            This month
          </Button>
          <Button variant="secondary" onClick={() => month(previousMonthStart)}>
            Last month
          </Button>
          <label className="ml-auto flex items-center gap-3 text-sm font-medium text-heading">
            <Toggle
              checked={query.compare}
              label={wholeMonth ? 'Compare to last month' : 'Compare to the previous period'}
              onChange={(compare) => go({ compare })}
            />
            <span aria-hidden>
              {wholeMonth ? 'Compare to last month' : 'Compare to the previous period'}
            </span>
          </label>
        </div>
      </section>

      {failed ? (
        <p role="alert" className="text-sm text-muted" data-testid="revenue-error">
          {quietErrorText(revenue.error)}
        </p>
      ) : null}

      <div className={`grid min-w-0 gap-6 ${query.compare ? 'lg:grid-cols-2' : ''}`}>
        <RevenuePanel
          testId="revenue-current"
          title={periodLabel(query.from, query.to)}
          period={data?.current ?? null}
          loading={loading}
          failed={failed || Boolean(problem)}
          wide={!query.compare}
        />
        {query.compare ? (
          <RevenuePanel
            testId="revenue-previous"
            title={`Compared with ${periodLabel(before.from, before.to)}`}
            period={data?.previous ?? null}
            loading={loading}
            failed={failed || Boolean(problem)}
            wide={false}
          />
        ) : null}
      </div>
    </div>
  );
}

function RevenuePanel({
  title,
  period,
  loading,
  failed,
  wide,
  testId,
}: {
  title: string;
  period: BillingRevenuePeriod | null;
  loading: boolean;
  failed: boolean;
  wide: boolean;
  testId: string;
}) {
  const kpi = { loading, failed };
  const payments = period?.payments ?? 0;
  const refunds = period?.refunds ?? 0;
  return (
    <section aria-label={title} data-testid={testId} className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lg font-semibold text-heading">{title}</h2>
      <div className={`grid gap-4 sm:grid-cols-2 ${wide ? 'xl:grid-cols-4' : ''}`}>
        <BillingKpiCard
          testId={`${testId}-collected`}
          icon={ChartLineUp}
          tone="green"
          label="Collected (gross)"
          value={formatMoney(period?.collectedCents ?? 0)}
          note={`${payments} ${payments === 1 ? 'payment' : 'payments'}`}
          {...kpi}
        />
        <BillingKpiCard
          testId={`${testId}-one-time`}
          icon={Receipt}
          tone="blue"
          label="One-time"
          value={formatMoney(period?.oneTimeCents ?? 0)}
          {...kpi}
        />
        <BillingKpiCard
          testId={`${testId}-recurring`}
          icon={Repeat}
          tone="purple"
          label="Recurring"
          value={formatMoney(period?.recurringCents ?? 0)}
          {...kpi}
        />
        <BillingKpiCard
          testId={`${testId}-refunds`}
          icon={ArrowCounterClockwise}
          tone="grey"
          label="Refunds (not deducted)"
          value={formatMoney(period?.refundedCents ?? 0)}
          note={`${refunds} ${refunds === 1 ? 'refund' : 'refunds'}`}
          {...kpi}
        />
      </div>
    </section>
  );
}
