'use client';

import { PageHeader, Toast } from '@firmivra/ui';
import {
  CalendarDots,
  ChartLineUp,
  CurrencyDollar,
  DownloadSimple,
  FileText,
  Flask,
  Play,
  Plus,
  Trophy,
  Users,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { AddLeadPanel } from './add-lead-panel';
import {
  CenterPipelineCard,
  LeadSourcesCard,
  QuickActionsCard,
  RecentSalesActivityCard,
  RevenueByPlanCard,
  UpcomingFollowUpsCard,
  type QuickAction,
} from './center-widgets';
import { ActivityDrawer, AppointmentsDrawer } from './feed-drawers';
import { ComparePackagesModal, PlanDetailsModal, PlansPricing } from './plans-pricing';
import { SalesActionDialog, type SalesAction } from './sales-action-dialog';
import {
  adminSales,
  errorMessage,
  PERIOD_LABELS,
  type CenterKpis,
  type PlanId,
  type SalesPeriod,
  type SalesPlan,
} from './sales-api';
import { CompactSelect, Crumbs, money, SALES_KEY, SalesKpi, type SalesTileTone } from './sales-ui';

const PERIODS: SalesPeriod[] = ['LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_YEAR'];
const COMPARED: Record<SalesPeriod, string> = {
  LAST_7_DAYS: 'vs. previous 7 days',
  LAST_30_DAYS: 'vs. previous 30 days',
  LAST_90_DAYS: 'vs. previous 90 days',
  THIS_MONTH: 'vs. previous month',
  THIS_QUARTER: 'vs. previous quarter',
  THIS_YEAR: 'vs. previous year',
};

const KPIS: {
  key: keyof CenterKpis;
  label: string;
  icon: Icon;
  tone: SalesTileTone;
  money?: boolean;
  downIsGood?: boolean;
}[] = [
  { key: 'totalLeads', label: 'Total Leads', icon: Users, tone: 'blue' },
  { key: 'demosScheduled', label: 'Demos Scheduled', icon: CalendarDots, tone: 'blue' },
  { key: 'activeTrials', label: 'Active Trials', icon: Flask, tone: 'purple' },
  { key: 'wonDeals', label: 'Won Deals', icon: Trophy, tone: 'green' },
  { key: 'lostDeals', label: 'Lost Deals', icon: XCircle, tone: 'red', downIsGood: true },
  {
    key: 'projectedMrrCents',
    label: 'Projected MRR',
    icon: CurrencyDollar,
    tone: 'green',
    money: true,
  },
];

/** One of the six coloured buttons under the title. */
function ActionTile({
  icon: Glyph,
  tone,
  iconClass = '',
  onClick,
  href,
  children,
}: {
  icon: Icon;
  tone: string;
  iconClass?: string;
  onClick?: () => void;
  href?: string;
  children: ReactNode;
}) {
  // At 1440 px each button is as wide as its words, on one line, as in the design.
  const className = `flex min-h-12 items-center justify-center gap-3 rounded-lg px-3 py-2 text-center text-base leading-tight font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-[1440px]:min-h-10 min-[1440px]:flex-auto min-[1440px]:gap-2 min-[1440px]:text-sm min-[1440px]:whitespace-nowrap ${tone}`;
  const content = (
    <>
      <Glyph
        aria-hidden
        weight="fill"
        className={`size-6 shrink-0 min-[1440px]:size-5 ${iconClass}`}
      />
      <span>{children}</span>
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

/** Sales Center (docx §2, §3, §18–§21): sales performance, plans, activity and lead sources. */
export function SalesCenter() {
  const [period, setPeriod] = useState<SalesPeriod>('LAST_30_DAYS');
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<{ kind: SalesAction; plan?: PlanId } | null>(null);
  const [drawer, setDrawer] = useState<'activity' | 'follow-ups' | null>(null);
  const [details, setDetails] = useState<SalesPlan | null>(null);
  const [compare, setCompare] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const kpis = useApiQuery([...SALES_KEY, 'center-kpis', period], () =>
    adminSales.centerKpis(period),
  );
  const exportReport = useApiMutation((chosen: SalesPeriod) => adminSales.exportReport(chosen));

  function download() {
    exportReport.mutate(period, {
      onSuccess: (csv) => {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `firmivra-sales-report-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        setToast({ message: 'The sales report was downloaded.', tone: 'success' });
      },
      onError: (error) => setToast({ message: errorMessage(error), tone: 'error' }),
    });
  }

  function quick(next: QuickAction) {
    if (next === 'ADD') setAdding(true);
    else if (next === 'EXPORT') download();
    else setAction({ kind: next });
  }

  const state = kpis.isPending ? 'loading' : kpis.isError && !kpis.data ? 'error' : 'ready';

  return (
    <div data-testid="sales-center" className="flex min-w-0 flex-col gap-4">
      <PageHeader
        above={
          <Crumbs
            items={[
              { label: 'Dashboard', href: '/' },
              { label: 'Sales', href: '/sales' },
              { label: 'Sales Center' },
            ]}
          />
        }
        title="Sales Center"
        subtitle="Turn opportunities into lasting Firmivra customers."
        actions={
          <CompactSelect
            withIcon
            label="Period"
            value={period}
            options={PERIODS.map((value) => ({ value, label: PERIOD_LABELS[value] }))}
            onChange={setPeriod}
            className="w-52"
          />
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1440px]:flex min-[1440px]:gap-2">
        <ActionTile
          icon={Plus}
          tone="bg-action text-on-action hover:bg-action-hover"
          onClick={() => setAdding(true)}
        >
          Add New Lead
        </ActionTile>
        <ActionTile
          icon={Play}
          tone="bg-success-soft text-success hover:brightness-95"
          onClick={() => setAction({ kind: 'TRIAL' })}
        >
          Start 14-Day Trial
        </ActionTile>
        <ActionTile
          icon={CalendarDots}
          tone="bg-purple-soft text-purple hover:brightness-95"
          onClick={() => setAction({ kind: 'DEMO' })}
        >
          Schedule a Demo
        </ActionTile>
        <ActionTile
          icon={FileText}
          tone="bg-danger-soft text-danger hover:brightness-95"
          onClick={() => setAction({ kind: 'PROPOSAL' })}
        >
          Create Offer / Proposal
        </ActionTile>
        <ActionTile
          icon={ChartLineUp}
          tone="bg-info-soft text-action hover:brightness-95"
          href="/sales/pipeline"
        >
          View Full Pipeline
        </ActionTile>
        <ActionTile
          icon={DownloadSimple}
          iconClass="text-success"
          tone="border border-divider bg-surface text-heading shadow-sm hover:bg-canvas"
          onClick={download}
        >
          {exportReport.isPending ? 'Preparing…' : 'Export Sales Report'}
        </ActionTile>
      </div>

      {toast ? (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      ) : null}

      <section
        aria-label="Sales numbers"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1440px]:flex min-[1440px]:gap-2"
      >
        {KPIS.map((kpi) => {
          const metric = kpis.data?.[kpi.key];
          return (
            <SalesKpi
              key={kpi.key}
              fit
              testId={`center-kpi-${kpi.key}`}
              icon={kpi.icon}
              tone={kpi.tone}
              label={kpi.label}
              state={state}
              value={
                metric
                  ? kpi.money
                    ? money(metric.value)
                    : metric.value.toLocaleString('en-US')
                  : '0'
              }
              trend={metric?.trend}
              downIsGood={kpi.downIsGood}
              note={COMPARED[period]}
            />
          );
        })}
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-8">
        <div className="min-w-0 xl:col-span-3">
          <CenterPipelineCard period={period} />
        </div>
        <div className="min-w-0 xl:col-span-3">
          <RevenueByPlanCard />
        </div>
        <div className="min-w-0 xl:col-span-2">
          <QuickActionsCard onAction={quick} />
        </div>
      </div>

      <PlansPricing
        onTrial={(plan) => setAction({ kind: 'TRIAL', plan })}
        onContactSales={(plan) => setAction({ kind: 'PROPOSAL', plan })}
        onDetails={setDetails}
        onCompare={() => setCompare(true)}
      />

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-8">
        <div className="min-w-0 xl:col-span-3">
          <RecentSalesActivityCard onViewAll={() => setDrawer('activity')} />
        </div>
        <div className="min-w-0 xl:col-span-3">
          <UpcomingFollowUpsCard onViewAll={() => setDrawer('follow-ups')} />
        </div>
        <div className="min-w-0 xl:col-span-2">
          <LeadSourcesCard period={period} />
        </div>
      </div>

      {adding ? (
        <AddLeadPanel
          mode="LEAD"
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            setAdding(false);
            setToast({
              message: `${created.firmName} was added to ${created.stageName}.`,
              tone: 'success',
            });
          }}
        />
      ) : null}
      {action ? (
        <SalesActionDialog
          key={`${action.kind}-${action.plan ?? ''}`}
          action={action.kind}
          plan={action.plan}
          onClose={() => setAction(null)}
          onDone={(message) => {
            setAction(null);
            setToast({ message, tone: 'success' });
          }}
        />
      ) : null}
      {details ? (
        <PlanDetailsModal
          plan={details}
          onClose={() => setDetails(null)}
          onTrial={(plan) => {
            setDetails(null);
            setAction({ kind: 'TRIAL', plan });
          }}
          onContactSales={(plan) => {
            setDetails(null);
            setAction({ kind: 'PROPOSAL', plan });
          }}
        />
      ) : null}
      {compare ? <ComparePackagesModal onClose={() => setCompare(false)} /> : null}
      {drawer === 'activity' ? (
        <ActivityDrawer kinds="sales" onClose={() => setDrawer(null)} />
      ) : null}
      {drawer === 'follow-ups' ? (
        <AppointmentsDrawer title="Upcoming Follow-ups" onClose={() => setDrawer(null)} />
      ) : null}
    </div>
  );
}
