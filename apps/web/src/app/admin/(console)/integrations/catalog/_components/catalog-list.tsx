'use client';

import {
  ActionMenu,
  Button,
  Card,
  SearchField,
  Select,
  Table,
  Tabs,
  Toast,
  Toggle,
  type ActionMenuItem,
  type Column,
} from '@firmivra/ui';
import {
  ArrowSquareOut,
  ArrowUp,
  CheckCircle,
  Clock,
  DotsThreeVertical,
  Eye,
  Plugs,
  Plus,
  ProhibitInset,
  SquaresFour,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useState } from 'react';
import { useApiQuery } from '../../../../../../lib/query';
import {
  adminIntegrations,
  CATALOG_STATUSES,
  CATEGORIES,
  CATEGORY_LABELS,
  type CatalogItem,
  type CatalogStatus,
  type IntegrationCategory,
} from '../../_components/integrations-contract';
import { ServiceLogo } from '../../_components/integration-badges';
import { formatNumber, formatPercent } from '../../_components/integration-format';
import { loadError, QuietLine, Unavailable } from '../../_components/integration-states';
import { IntegrationsHeader, LinkButton, platformHref } from '../../_components/integrations-shell';
import type { Notice } from '../../_components/platform-actions';
import { AddCatalogDrawer } from './add-catalog-drawer';
import { CatalogKpi, CatalogStatusWord, PlanPills } from './catalog-parts';
import { CatalogPreviewDialog } from './catalog-preview';
import { useCatalogStatus } from './catalog-status';

/**
 * Customer Integration Catalog (customer-integration-catalog-dashboard.jpg; docx §6): the
 * catalog's counts (they filter the list), the status tabs, search, category and plan filters,
 * the entries with their plan access, status switch and firms using them, and Add to Catalog.
 * Catalog availability is separate from platform health. The filters live in the address.
 */

const PAGE_SIZE = 10;
type StatusTab = CatalogStatus | 'ALL';
const TAB_LABELS: Record<StatusTab, string> = {
  ALL: 'All Integrations',
  ENABLED: 'Enabled',
  DISABLED: 'Disabled',
  COMING_SOON: 'Coming Soon',
};

interface Filters {
  status: CatalogStatus | '';
  search: string;
  category: IntegrationCategory | '';
  plan: string;
  page: number;
}
/** The page's query string, as the server passes it (`?status=ENABLED&plan=…`). */
export type AddressQuery = Record<string, string | string[] | undefined>;

const oneOf = <T extends string>(list: readonly T[], value: string | null): T | '' =>
  list.find((item) => item === value) ?? '';

function readFilters(address: AddressQuery): Filters {
  const get = (key: string) => {
    const value = address[key];
    return (Array.isArray(value) ? value[0] : value) ?? null;
  };
  const page = Number(get('page'));
  return {
    status: oneOf(CATALOG_STATUSES, get('status')),
    search: (get('q') ?? '').slice(0, 100),
    category: oneOf(CATEGORIES, get('category')),
    plan: (get('plan') ?? '').slice(0, 64),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}
function addressOf(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('q', filters.search);
  if (filters.category) params.set('category', filters.category);
  if (filters.plan) params.set('plan', filters.plan);
  if (filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

export function CatalogList({ address }: { address: AddressQuery }) {
  const router = useRouter();
  const [filters, setFilters] = useState(() => readFilters(address));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [adding, setAdding] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const search = useDeferredValue(filters.search.trim());
  const status = useCatalogStatus(setNotice);

  useEffect(() => {
    const next = addressOf(filters);
    if (next !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, '', next);
  }, [filters]);

  const summary = useApiQuery(['admin-integrations', 'summary'], () => adminIntegrations.summary());
  const plans = useApiQuery(['admin-integrations', 'plans'], () => adminIntegrations.plans());
  const access = useApiQuery(['admin-integrations', 'access'], () => adminIntegrations.access());
  const list = useApiQuery(
    [
      'admin-integrations',
      'catalog',
      'list',
      filters.status,
      search,
      filters.category,
      filters.plan,
      filters.page,
    ],
    () =>
      adminIntegrations.listCatalog({
        status: filters.status || undefined,
        search: search || undefined,
        category: filters.category || undefined,
        plan: filters.plan || undefined,
        page: filters.page,
        pageSize: PAGE_SIZE,
      }),
  );

  const update = (patch: Partial<Filters>) =>
    setFilters((current) => ({ ...current, page: 1, ...patch }));
  const filtered = !!(filters.status || filters.search || filters.category || filters.plan);
  const clear = () => setFilters({ status: '', search: '', category: '', plan: '', page: 1 });
  const canManage = !!access.data?.canManageConfiguration;

  const counts = summary.data?.catalog;
  const kpiLoading = summary.isPending;
  const share = (value: number) =>
    counts ? formatPercent(counts.total ? (value / counts.total) * 100 : 0, 0) : <Unavailable />;
  const pickStatus = (next: CatalogStatus) =>
    update({ status: filters.status === next ? '' : next });

  const columns: Column<CatalogItem>[] = [
    {
      id: 'name',
      label: 'Name',
      cell: (item) => (
        <span className="flex items-center gap-3">
          <ServiceLogo category={item.category} size="sm" />
          <Link
            href={`/integrations/catalog/${encodeURIComponent(item.id)}`}
            className="font-semibold whitespace-nowrap text-heading hover:text-action hover:underline"
          >
            {item.name}
          </Link>
        </span>
      ),
    },
    { id: 'category', label: 'Category', cell: (item) => CATEGORY_LABELS[item.category] },
    {
      id: 'description',
      label: 'Description',
      className: 'min-w-40',
      cell: (item) => item.shortDescription,
    },
    { id: 'plans', label: 'Plan Access', cell: (item) => <PlanPills item={item} /> },
    {
      id: 'status',
      label: 'Status',
      cell: (item) => (
        <span className="flex flex-wrap items-center gap-2">
          <Toggle
            label={`${item.name} available to firms`}
            checked={item.status !== 'DISABLED'}
            disabled={!canManage || status.savingId === item.id}
            onChange={(on) => status.request(item, on ? 'ENABLED' : 'DISABLED')}
          />
          <CatalogStatusWord status={item.status} />
        </span>
      ),
    },
    {
      id: 'customers',
      label: 'Customers Using',
      cell: (item) => (
        <span data-testid="customers-using" className="pl-2">
          {formatNumber(item.stats.firmsUsing)}
        </span>
      ),
    },
  ];

  function menuFor(item: CatalogItem): ActionMenuItem[] {
    const changes: ActionMenuItem[] = canManage
      ? [
          ...(item.status !== 'ENABLED'
            ? [
                {
                  label: 'Enable',
                  icon: CheckCircle,
                  onSelect: () => status.request(item, 'ENABLED'),
                },
              ]
            : []),
          ...(item.status !== 'COMING_SOON'
            ? [
                {
                  label: 'Mark Coming Soon',
                  icon: Clock,
                  onSelect: () => status.request(item, 'COMING_SOON'),
                },
              ]
            : []),
          ...(item.status !== 'DISABLED'
            ? [
                {
                  label: 'Disable',
                  icon: ProhibitInset,
                  onSelect: () => status.request(item, 'DISABLED'),
                },
              ]
            : []),
        ]
      : [];
    const linked = item.platformIntegration;
    return [
      {
        label: 'Manage',
        icon: ArrowSquareOut,
        onSelect: () => router.push(`/integrations/catalog/${encodeURIComponent(item.id)}`),
      },
      { label: 'Preview in Catalog', icon: Eye, onSelect: () => setPreviewId(item.id) },
      ...(linked
        ? [
            {
              label: 'Open Platform Integration',
              icon: Plugs,
              onSelect: () => router.push(platformHref(linked.id)),
            },
          ]
        : []),
      ...changes,
    ];
  }

  const page = list.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <IntegrationsHeader
        title="Customer Integration Catalog"
        subtitle="Manage which integrations are available to customer firms and configure access by plan."
        crumbs={[
          { label: 'Integrations', href: '/integrations' },
          { label: 'Customer Integration Catalog' },
        ]}
        actions={
          <Button onClick={() => setAdding(true)} disabled={!canManage}>
            <Plus aria-hidden weight="bold" className="size-5" />
            Add to Catalog
          </Button>
        }
      />

      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <section aria-label="Catalog summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CatalogKpi
          testId="catalog-kpi-total"
          icon={SquaresFour}
          tone="blue"
          label="Total Catalog Integrations"
          value={counts ? formatNumber(counts.total) : <Unavailable />}
          note={
            counts ? (
              counts.addedThisMonth ? (
                <span className="inline-flex items-center gap-1">
                  <ArrowUp aria-hidden weight="bold" className="size-4" />
                  {formatNumber(counts.addedThisMonth)} this month
                </span>
              ) : (
                'None added this month'
              )
            ) : (
              <Unavailable />
            )
          }
          good={!!counts?.addedThisMonth}
          loading={kpiLoading}
          pressed={!filters.status}
          disabled={!counts}
          onClick={() => update({ status: '' })}
        />
        <CatalogKpi
          testId="catalog-kpi-enabled"
          icon={CheckCircle}
          tone="green"
          label="Enabled"
          value={counts ? formatNumber(counts.enabled) : <Unavailable />}
          note={share(counts?.enabled ?? 0)}
          good
          loading={kpiLoading}
          pressed={filters.status === 'ENABLED'}
          disabled={!counts}
          onClick={() => pickStatus('ENABLED')}
        />
        <CatalogKpi
          testId="catalog-kpi-disabled"
          icon={Clock}
          tone="amber"
          label="Disabled"
          value={counts ? formatNumber(counts.disabled) : <Unavailable />}
          note={share(counts?.disabled ?? 0)}
          loading={kpiLoading}
          pressed={filters.status === 'DISABLED'}
          disabled={!counts}
          onClick={() => pickStatus('DISABLED')}
        />
        <CatalogKpi
          testId="catalog-kpi-coming-soon"
          icon={Clock}
          tone="grey"
          label="Coming Soon"
          value={counts ? formatNumber(counts.comingSoon) : <Unavailable />}
          note={share(counts?.comingSoon ?? 0)}
          loading={kpiLoading}
          pressed={filters.status === 'COMING_SOON'}
          disabled={!counts}
          onClick={() => pickStatus('COMING_SOON')}
        />
      </section>

      <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <Tabs
            label="Catalog status"
            variant="underline"
            value={filters.status || 'ALL'}
            onChange={(id) => update({ status: id === 'ALL' ? '' : oneOf(CATALOG_STATUSES, id) })}
            items={(['ALL', ...CATALOG_STATUSES] as const).map((id) => ({
              id,
              label: TAB_LABELS[id],
            }))}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchField
            label="Search integrations"
            placeholder="Search integrations..."
            minWidth="12rem"
            maxLength={100}
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
          />
          <div className="w-full sm:w-44">
            <Select
              label="Category"
              hideLabel
              value={filters.category}
              options={[
                { value: '', label: 'All Categories' },
                ...CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
              ]}
              onChange={(event) => update({ category: oneOf(CATEGORIES, event.target.value) })}
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              label="Plan"
              hideLabel
              value={filters.plan}
              disabled={!plans.data}
              options={[
                { value: '', label: 'All Plans' },
                ...(plans.data ?? []).map((plan) => ({ value: plan.id, label: plan.name })),
              ]}
              onChange={(event) => update({ plan: event.target.value })}
            />
          </div>
        </div>
      </div>

      <Card data-testid="catalog-list" className="flex min-w-0 flex-col overflow-hidden p-0!">
        {list.isError ? (
          <div className="px-5 py-2">
            <QuietLine>{loadError(list.error)}</QuietLine>
          </div>
        ) : page && !page.items.length ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            {filtered ? (
              <>
                <p className="font-semibold text-heading">No integrations match these filters.</p>
                <Button variant="secondary" onClick={clear}>
                  Clear filters
                </Button>
              </>
            ) : (
              <>
                <p className="font-semibold text-heading">No catalog integrations yet.</p>
                <p className="max-w-xl text-sm text-muted">
                  The catalog is what customer firms can discover and connect in their own accounts.
                  Add the first entry: it starts Disabled until you enable it, and your platform
                  integrations are not affected.
                </p>
                <Button onClick={() => setAdding(true)} disabled={!canManage}>
                  <Plus aria-hidden weight="bold" className="size-5" />
                  Add to Catalog
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="px-2 pt-2 pb-4">
            <Table
              caption="Customer integration catalog"
              rows={page?.items ?? []}
              loading={list.isPending}
              columns={columns}
              rowKey={(item) => item.id}
              noun="integrations"
              pageSize={PAGE_SIZE}
              server={{
                page: page?.page ?? filters.page,
                total: page?.total ?? 0,
                hasNext: !!page && page.page * PAGE_SIZE < page.total,
                hasPrevious: !!page && page.page > 1,
                onNext: () => setFilters((current) => ({ ...current, page: current.page + 1 })),
                onPrevious: () =>
                  setFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) })),
                onPage: (next) => setFilters((current) => ({ ...current, page: next })),
                onSort: () => undefined,
              }}
              rowActions={(item) => (
                <>
                  <LinkButton
                    href={`/integrations/catalog/${encodeURIComponent(item.id)}`}
                    size="sm"
                  >
                    Manage
                    <span className="sr-only"> {item.name}</span>
                  </LinkButton>
                  <ActionMenu
                    label={`More actions for ${item.name}`}
                    trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
                    sections={[{ items: menuFor(item) }]}
                  />
                </>
              )}
            />
          </div>
        )}
      </Card>

      {status.dialog}
      {adding ? <AddCatalogDrawer onClose={() => setAdding(false)} /> : null}
      {previewId ? (
        <CatalogPreviewDialog catalogId={previewId} onClose={() => setPreviewId(null)} />
      ) : null}
    </div>
  );
}
