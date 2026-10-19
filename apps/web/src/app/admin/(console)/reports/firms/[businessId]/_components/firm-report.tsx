'use client';

import type { AdminFirmReport } from '@firmivra/types';
import { ActionMenu, Badge, Button, Card, IconTile, Skeleton } from '@firmivra/ui';
import {
  ArrowSquareOut,
  Buildings,
  CreditCard,
  CurrencyDollar,
  DownloadSimple,
  FileText,
  Headset,
  MapPin,
  Phone,
  ShieldCheck,
  User,
  Users,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { BarList, MonthBars, MonthLine, PeriodSelect } from '../../../_components/charts';
import { STATUS_LABELS, STATUS_TONES } from '../../../_components/firms-report';
import { ActivityTable, Kpi } from '../../../_components/overview';
import {
  count,
  dateText,
  loadError,
  Loaded,
  moneyWhole,
  Panel,
  QuietLine,
  ReportsHeader,
  RP,
  saveFile,
  useRange,
} from '../../../_components/reports-common';

export type FirmTab =
  'overview' | 'users' | 'subscriptions' | 'feature-usage' | 'activity' | 'support';

const TABS: { id: FirmTab | 'billing' | 'documents'; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'feature-usage', label: 'Feature Usage' },
  { id: 'activity', label: 'Activity' },
  { id: 'support', label: 'Support' },
  { id: 'billing', label: 'Billing' },
  { id: 'documents', label: 'Documents' },
];

const TICKET_STATUS = {
  OPEN: { label: 'Open', tone: 'info' },
  IN_PROGRESS: { label: 'In Progress', tone: 'purple' },
  WAITING_ON_CUSTOMER: { label: 'Waiting on Customer', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
} as const;
const PRIORITY_TONES: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  CRITICAL: 'danger',
  URGENT: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  NORMAL: 'info',
  LOW: 'neutral',
};
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll('_', ' ');

type Query = ReturnType<typeof useApiQuery<AdminFirmReport>>;

/**
 * Firm Report Detail (docx §3; firm-report-detail-dashboard.jpg). One firm's report for the
 * period: the header, the firm card, and eight tabs. Six are pages of this report; Billing opens
 * the console's Billing module, and Documents stays shut: a firm's documents are its own data,
 * which the admin scope does not read. The per-firm users, documents, leads and feature usage
 * come from the daily usage rollup (Not available until it has run for the firm).
 */
export function FirmReport({ businessId, tab }: { businessId: string; tab: FirmTab }) {
  const { range, keep } = useRange();
  const router = useRouter();
  const q = useApiQuery([...RP, 'firm', businessId, range], () =>
    api.adminReports.firm(businessId, range ?? {}),
  );
  const firm = q.data?.firm;
  const exporter = useApiMutation(async () =>
    api.adminReports.export({
      type: 'FIRMS',
      fields: [
        'firm.name',
        'firm.plan',
        'firm.status',
        'firm.joined',
        'firm.contact_name',
        'firm.contact_email',
        'firm.contact_phone',
        'firm.total_users',
        'firm.monthly_revenue',
        'firm.next_billing_date',
        'firm.last_login',
        'firm.active_documents',
        'firm.open_tickets',
      ],
      filters: { search: firm?.name ?? '' },
      dateRange: range ?? { preset: 'LAST_30_DAYS' },
      sort: [],
      format: 'CSV',
      title: `Firm report: ${firm?.name ?? ''}`,
    }),
  );
  const base = `/reports/firms/${businessId}`;
  const go = (href: string) => router.push(keep(href));

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ReportsHeader
        back
        title="Firm Report Detail"
        subtitle={
          firm
            ? `Detailed insights and activity for ${firm.name}.`
            : 'Detailed insights and activity for this firm.'
        }
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!firm || exporter.isPending}
              onClick={() => exporter.mutate(undefined, { onSuccess: saveFile })}
            >
              <span className="inline-flex items-center gap-2 text-text">
                <DownloadSimple aria-hidden weight="bold" className="size-4" />
                {exporter.isPending ? 'Exporting…' : 'Export Report'}
              </span>
            </Button>
            <Link
              href={`/firms/${businessId}`}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-divider bg-surface px-4 text-sm font-medium text-text hover:bg-canvas"
            >
              <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
              View Firm
            </Link>
            <ActionMenu
              label="Firm actions"
              align="right"
              trigger={<span className="text-action">Actions</span>}
              sections={[
                {
                  items: [
                    {
                      label: 'Open firm profile',
                      icon: Buildings,
                      onSelect: () => router.push(`/firms/${businessId}`),
                    },
                    {
                      label: 'Subscriptions',
                      icon: CurrencyDollar,
                      onSelect: () => router.push('/subscriptions'),
                    },
                    { label: 'Billing', icon: CreditCard, onSelect: () => router.push('/billing') },
                    {
                      label: 'Support tickets',
                      icon: Headset,
                      onSelect: () => router.push('/support'),
                    },
                    {
                      label: 'Audit & Security',
                      icon: ShieldCheck,
                      onSelect: () => router.push('/audit-security'),
                    },
                  ],
                },
              ]}
            />
          </>
        }
      />
      {exporter.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(exporter.error)}
        </p>
      ) : null}

      <FirmCard query={q} />

      <nav aria-label="Firm report" className="flex gap-8 overflow-x-auto border-b border-divider">
        {TABS.map((t) => {
          const href = t.id === 'overview' ? base : `${base}/${t.id}`;
          const active = t.id === tab;
          const shape =
            '-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-2 text-base font-medium';
          const cls = `${shape} ${active ? 'border-action text-action' : 'border-transparent text-text hover:text-heading'}`;
          if (t.id === 'documents')
            return (
              <span
                key={t.id}
                aria-disabled
                className={`${shape} cursor-not-allowed border-transparent text-muted`}
                title="A firm's documents are its own data: the console does not read them"
              >
                {t.label}
              </span>
            );
          if (t.id === 'billing')
            return (
              <Link key={t.id} href="/billing" className={cls}>
                {t.label}
              </Link>
            );
          return (
            <Link
              key={t.id}
              href={keep(href)}
              aria-current={active ? 'page' : undefined}
              className={cls}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {tab === 'overview' ? <OverviewTab query={q} go={go} base={base} /> : null}
      {tab === 'users' ? <UsersTab query={q} /> : null}
      {tab === 'subscriptions' ? <SubscriptionsTab query={q} /> : null}
      {tab === 'feature-usage' ? <FeatureTab query={q} /> : null}
      {tab === 'activity' ? (
        <Panel title="Firm Activity" testId="firm-activity">
          <Loaded query={q}>{(d) => <FirmActivity d={d} />}</Loaded>
        </Panel>
      ) : null}
      {tab === 'support' ? <SupportTab query={q} /> : null}
    </div>
  );
}

function Fact({
  icon: I,
  label,
  children,
}: {
  icon: typeof User;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 gap-3">
      <I aria-hidden weight="regular" className="mt-0.5 size-5 shrink-0 text-action" />
      <div className="min-w-0 text-sm">
        <p className="text-muted">{label}</p>
        <div className="text-text">{children}</div>
      </div>
    </div>
  );
}

function FirmCard({ query }: { query: Query }) {
  const f = query.data?.firm;
  return (
    <Card className="p-5!" data-testid="firm-card">
      {f ? (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <IconTile icon={Buildings} tone="blue" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-bold text-heading">{f.name}</h2>
                <Badge tone={STATUS_TONES[f.status]}>{STATUS_LABELS[f.status]}</Badge>
              </div>
              <p className="mt-1 flex flex-wrap gap-x-3 text-base text-muted">
                <span>{f.businessType ?? 'Business type not on record'}</span>
                <span aria-hidden>|</span>
                <span>{f.planName ? `${f.planName} Plan` : 'No plan'}</span>
                <span aria-hidden>|</span>
                <span>Since {dateText(f.since)}</span>
              </p>
            </div>
          </div>
          <div className="grid gap-4 border-divider sm:grid-cols-3 lg:border-l lg:pl-5">
            <Fact icon={User} label="Primary Contact">
              {f.contactName ?? 'Not on record'}
              {f.contactEmail ? (
                <span className="block text-xs text-muted">{f.contactEmail}</span>
              ) : null}
            </Fact>
            <Fact icon={Phone} label="Phone">
              {f.contactPhone ?? 'Not on record'}
            </Fact>
            <Fact icon={MapPin} label="Location">
              {f.location ?? 'Not on record'}
            </Fact>
          </div>
        </div>
      ) : query.isError ? (
        <QuietLine>{loadError(query.error)}</QuietLine>
      ) : (
        <div className="flex items-center gap-4" role="status" aria-label="Loading">
          <Skeleton className="size-14" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        </div>
      )}
    </Card>
  );
}

function Kpis({ query, only }: { query: Query; only?: (keyof AdminFirmReport['kpis'])[] }) {
  const k = query.data?.kpis;
  const loading = query.isPending;
  const all = [
    {
      key: 'totalUsers',
      el: (
        <Kpi
          key="u"
          kpi={k?.totalUsers}
          label="Total Users"
          icon={UsersThree}
          tone="blue"
          show={count}
          loading={loading}
        />
      ),
    },
    {
      key: 'revenueCents',
      el: (
        <Kpi
          key="r"
          kpi={k?.revenueCents}
          label="Monthly Revenue"
          icon={CurrencyDollar}
          tone="green"
          show={moneyWhole}
          loading={loading}
        />
      ),
    },
    {
      key: 'activeDocuments',
      el: (
        <Kpi
          key="d"
          kpi={k?.activeDocuments}
          label="Active Documents"
          icon={FileText}
          tone="blue"
          show={count}
          loading={loading}
        />
      ),
    },
    {
      key: 'leads',
      el: (
        <Kpi
          key="l"
          kpi={k?.leads}
          label="Leads"
          icon={Users}
          tone="blue"
          show={count}
          loading={loading}
        />
      ),
    },
    {
      key: 'supportTickets',
      el: (
        <Kpi
          key="s"
          kpi={k?.supportTickets}
          label="Support Tickets"
          icon={Headset}
          tone="blue"
          show={count}
          upIsGood={false}
          loading={loading}
        />
      ),
    },
  ] as const;
  const shown = all.filter((x) => !only || only.includes(x.key));
  return (
    <section
      aria-label="Firm summary"
      className={`grid gap-4 sm:grid-cols-2 ${shown.length >= 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}
    >
      {shown.map((x) => x.el)}
    </section>
  );
}

const ROLLUP_EMPTY = 'Appears once the daily usage rollup has run for this firm.';

function UserGrowth({ query }: { query: Query }) {
  const [months, setMonths] = useState<3 | 6>(6);
  return (
    <Panel
      title="User Growth"
      testId="user-growth"
      action={<PeriodSelect label="User Growth period" value={months} onChange={setMonths} />}
    >
      <Loaded query={query}>
        {(d) => (
          <MonthLine
            data={d.userGrowth.slice(-months)}
            label="Users by month"
            emptyText={d.hasActivityData ? 'No users in these months.' : ROLLUP_EMPTY}
          />
        )}
      </Loaded>
    </Panel>
  );
}

function DocumentActivity({ query }: { query: Query }) {
  const [months, setMonths] = useState<3 | 6>(6);
  return (
    <Panel
      title="Document Activity"
      testId="document-activity"
      action={<PeriodSelect label="Document Activity period" value={months} onChange={setMonths} />}
    >
      <Loaded query={query}>
        {(d) => (
          <MonthBars
            tone="purple"
            data={d.documentActivity
              .slice(-months)
              .map((m) => ({ month: m.month, value: m.created }))}
            label="Documents created by month"
            emptyText={d.hasActivityData ? 'No documents in these months.' : ROLLUP_EMPTY}
          />
        )}
      </Loaded>
    </Panel>
  );
}

function FeatureUsage({ query }: { query: Query }) {
  return (
    <Panel title="Feature Usage" testId="firm-feature-usage">
      <Loaded query={query}>
        {(d) => (
          <BarList
            label="This firm's use of each feature"
            emptyText={ROLLUP_EMPTY}
            rows={d.featureUsage.map((f) => ({
              key: f.feature,
              label: f.label,
              percent: d.hasActivityData ? f.percent : null,
            }))}
          />
        )}
      </Loaded>
    </Panel>
  );
}

function FirmActivity({ d }: { d: AdminFirmReport }) {
  return (
    <ActivityTable
      rows={d.recentActivity}
      third={{ label: 'User', value: (a) => a.detail ?? '—' }}
    />
  );
}

function Tickets({ d }: { d: AdminFirmReport }) {
  if (!d.openTickets.length) return <QuietLine>No open support tickets.</QuietLine>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-table-head text-text">
          <tr>
            {['#', 'Subject', 'Priority', 'Status', 'Created'].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {d.openTickets.map((t) => (
            <tr key={t.id}>
              <td className="px-3 py-2.5 text-text">#{t.number}</td>
              <td className="px-3 py-2.5">
                <Link href={`/support/tickets/${t.id}`} className="text-text hover:text-action">
                  {t.subject}
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <Badge tone={PRIORITY_TONES[t.priority.toUpperCase()] ?? 'neutral'}>
                  {title(t.priority)}
                </Badge>
              </td>
              <td className="px-3 py-2.5">
                <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
              </td>
              <td className="px-3 py-2.5 text-text">{dateText(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverviewTab({
  query,
  go,
  base,
}: {
  query: Query;
  go: (href: string) => void;
  base: string;
}) {
  const viewAll = (href: string) => (
    <button type="button" onClick={() => go(href)} className="text-sm font-medium text-action">
      View All
    </button>
  );
  return (
    <>
      <Kpis query={query} />
      <div className="grid min-w-0 gap-5 xl:grid-cols-3">
        <UserGrowth query={query} />
        <DocumentActivity query={query} />
        <FeatureUsage query={query} />
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Panel
          title="Recent Activity"
          testId="firm-recent-activity"
          action={viewAll(`${base}/activity`)}
        >
          <Loaded query={query}>
            {(d) => <FirmActivity d={{ ...d, recentActivity: d.recentActivity.slice(0, 5) }} />}
          </Loaded>
        </Panel>
        <Panel
          title="Open Support Tickets"
          testId="firm-open-tickets"
          action={viewAll(`${base}/support`)}
        >
          <Loaded query={query}>{(d) => <Tickets d={d} />}</Loaded>
        </Panel>
      </div>
    </>
  );
}

function UsersTab({ query }: { query: Query }) {
  return (
    <>
      <Kpis query={query} only={['totalUsers', 'leads']} />
      <UserGrowth query={query} />
    </>
  );
}

function SubscriptionsTab({ query }: { query: Query }) {
  return (
    <>
      <Kpis query={query} only={['revenueCents']} />
      <Panel
        title="Subscription"
        testId="firm-subscription"
        action={
          <Link href="/subscriptions" className="text-sm font-medium text-action">
            Open Subscriptions
          </Link>
        }
      >
        <Loaded query={query}>
          {(d) => (
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">Plan</dt>
                <dd className="font-semibold text-heading">{d.firm.planName ?? 'No plan'}</dd>
              </div>
              <div>
                <dt className="text-muted">Firm status</dt>
                <dd className="font-semibold text-heading">{STATUS_LABELS[d.firm.status]}</dd>
              </div>
              <div>
                <dt className="text-muted">Customer since</dt>
                <dd className="font-semibold text-heading">{dateText(d.firm.since)}</dd>
              </div>
            </dl>
          )}
        </Loaded>
      </Panel>
    </>
  );
}

function FeatureTab({ query }: { query: Query }) {
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-2">
      <FeatureUsage query={query} />
      <DocumentActivity query={query} />
    </div>
  );
}

function SupportTab({ query }: { query: Query }) {
  return (
    <>
      <Kpis query={query} only={['supportTickets']} />
      <Panel
        title="Open Support Tickets"
        testId="firm-support"
        action={
          <Link href="/support" className="text-sm font-medium text-action">
            Open Support
          </Link>
        }
      >
        <Loaded query={query}>{(d) => <Tickets d={d} />}</Loaded>
      </Panel>
    </>
  );
}
