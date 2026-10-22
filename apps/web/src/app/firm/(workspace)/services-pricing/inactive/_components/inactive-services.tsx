'use client';

import type { CatalogServiceRow, CatalogServicesQuery, CatalogSummary } from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  IconButton,
  KpiCard,
  Modal,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Table,
  type Column,
  type TableSort,
} from '@firmivra/ui';
import {
  Archive,
  CheckCircle,
  Clock,
  Copy,
  Cube,
  DotsThreeVertical,
  Eye,
  FolderOpen,
  PencilSimple,
  Plus,
  Tag,
  Trash,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { useFirm } from '../../../../../../components/firm-context';
import {
  CATALOG_ERRORS,
  CATALOG_ICONS,
  dayText,
  rowActivationGap,
} from '../../_components/catalog-shared';

/** The service's icon tile: its approved icon in its tone, or a cube when it has none. */
function ServiceMark({ icon }: { icon: string | null }) {
  const meta = icon ? CATALOG_ICONS[icon] : undefined;
  const Glyph = meta?.glyph ?? Cube;
  return (
    <span
      aria-hidden
      className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${meta?.tone ?? 'bg-info-soft text-info'}`}
    >
      <Glyph weight="fill" className="size-6" />
    </span>
  );
}
const tabs = [
  { label: 'Active Services', href: '/services-pricing' },
  { label: 'Inactive Services', href: '/services-pricing/inactive' },
  { label: 'Service Categories', href: '/services-pricing/categories' },
  { label: 'Package Builder', href: '/services-pricing/packages' },
  { label: 'Discounts & Promotions', href: '/services-pricing/promotions' },
];
const metrics = [
  { key: 'total', label: 'Total Services', icon: Cube },
  { key: 'active', label: 'Active Services', icon: CheckCircle },
  { key: 'inactive', label: 'Inactive Services', icon: Clock },
  { key: 'categories', label: 'Categories', icon: FolderOpen },
  { key: 'activePromotions', label: 'Active Promotions', icon: Tag },
] satisfies { key: keyof CatalogSummary; label: string; icon: typeof Tag }[];
const formatPrice = (row: CatalogServiceRow) => {
  if (row.price.amountCents === null) return 'Quote required';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    row.price.amountCents / 100,
  );
  return row.price.type === 'HOURLY'
    ? `${amount}/hour`
    : row.price.type === 'STARTING_AT'
      ? `${amount}+`
      : row.price.type === 'RECURRING'
        ? `${amount} / ${(row.price.frequency ?? 'MONTHLY').toLowerCase().replaceAll('_', ' ')}`
        : amount;
};
function Usage({ serviceId }: { serviceId: string }) {
  const usage = useApiQuery(['services-pricing', 'usage', serviceId], () =>
    api.servicesPricing.usage(serviceId),
  );
  return (
    <PageState query={usage}>
      {(data) => (
        <div className="space-y-3">
          <h3 className="font-semibold">Service usage</h3>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>Active engagements</dt>
            <dd>{data.activeEngagements}</dd>
            <dt>Open invoices</dt>
            <dd>{data.openInvoices}</dd>
            <dt>Appointment types</dt>
            <dd>{data.appointmentTypes}</dd>
            <dt>Automations</dt>
            <dd>{data.automations}</dd>
          </dl>
          <h4 className="font-semibold">Packages</h4>
          {data.packages.length ? (
            <ul>
              {data.packages.map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No packages use this service.</p>
          )}
        </div>
      )}
    </PageState>
  );
}

export function InactiveServices() {
  const router = useRouter();
  const { role } = useFirm();
  const manage = role === 'OWNER' || role === 'ADMIN';
  const [searchText, setSearchText] = useState('');
  const search = useDeferredValue(searchText);
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<TableSort>({ id: 'name', descending: false });
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<{
    row: CatalogServiceRow;
    type: 'activate' | 'archive' | 'delete' | 'usage';
  } | null>(null);
  const gap = action?.type === 'activate' ? rowActivationGap(action.row) : null;
  const summary = useApiQuery(['services-pricing', 'summary'], () => api.servicesPricing.summary());
  const categories = useApiQuery(['services-pricing', 'categories'], () =>
    api.servicesPricing.categories(),
  );
  const query: CatalogServicesQuery = {
    status: 'inactive',
    search,
    categoryId: categoryId || undefined,
    page,
    pageSize: 8,
    sort: sort.id as CatalogServicesQuery['sort'],
    direction: sort.descending ? 'desc' : 'asc',
  };
  const list = useApiQuery(['services-pricing', 'inactive', query], () =>
    api.servicesPricing.services(query),
  );
  const rows = list.isError ? [] : (list.data?.items ?? []);
  const emptyTitle = list.isError
    ? 'Services couldn’t load'
    : search || categoryId
      ? 'No matching services'
      : 'No inactive services yet';
  const retry = list.isError ? (
    <Button
      variant="secondary"
      onClick={() => {
        void summary.refetch();
        void categories.refetch();
        void list.refetch();
      }}
    >
      Try again
    </Button>
  ) : undefined;
  const change = useApiMutation(
    async ({ row, type }: { row: CatalogServiceRow; type: 'activate' | 'archive' | 'delete' }) => {
      if (type === 'activate') return api.servicesPricing.activateService(row.id);
      if (type === 'archive') return api.servicesPricing.archiveService(row.id);
      return api.servicesPricing.deleteService(row.id);
    },
    { invalidate: ['services-pricing'] },
  );
  const duplicate = useApiMutation((id: string) => api.servicesPricing.duplicateService(id), {
    invalidate: ['services-pricing'],
  });
  const rowActions = (row: CatalogServiceRow) => (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="ghost"
        className="min-w-24 bg-info-soft"
        onClick={() => router.push(`/services-pricing/${row.id}/edit`)}
      >
        <PencilSimple aria-hidden weight="fill" className="size-4" />
        Edit
      </Button>
      {manage ? (
        <IconButton
          icon={Copy}
          label={`Duplicate ${row.name}`}
          disabled={duplicate.isPending}
          onClick={() =>
            duplicate.mutate(row.id, {
              onSuccess: (copy) => router.push(`/services-pricing/${copy.id}/edit`),
            })
          }
        />
      ) : null}
      <ActionMenu
        label={`Actions for ${row.name}`}
        trigger={<DotsThreeVertical aria-hidden weight="fill" className="size-4" />}
        className="[&>button]:size-8 [&>button]:min-h-8 [&>button]:justify-center [&>button]:px-0 [&>button>svg:last-child]:hidden"
        sections={[
          {
            items: [
              {
                label: 'View / Preview',
                icon: Eye,
                onSelect: () => router.push(`/services-pricing/${row.id}`),
              },
              { label: 'View Usage', icon: Eye, onSelect: () => setAction({ row, type: 'usage' }) },
              ...(manage
                ? [
                    {
                      label: 'Activate',
                      icon: CheckCircle,
                      onSelect: () => {
                        change.reset();
                        setAction({ row, type: 'activate' });
                      },
                    },
                    {
                      label: 'Manage Add-Ons',
                      icon: Plus,
                      onSelect: () => router.push(`/services-pricing/${row.id}/edit`),
                    },
                    {
                      label: 'Archive',
                      icon: Archive,
                      onSelect: () => {
                        change.reset();
                        setAction({ row, type: 'archive' });
                      },
                    },
                    {
                      label: 'Delete',
                      icon: Trash,
                      danger: true,
                      onSelect: () => {
                        change.reset();
                        setAction({ row, type: 'delete' });
                      },
                    },
                  ]
                : []),
            ],
          },
        ]}
      />
    </div>
  );
  const columns: Column<CatalogServiceRow>[] = [
    {
      id: 'name',
      label: 'Service Name',
      sortable: true,
      className: 'w-1/4',
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <ServiceMark icon={row.icon} />
          <div className="min-w-0">
            <Link
              className="break-words text-sm font-semibold text-heading hover:text-action"
              href={`/services-pricing/${row.id}`}
            >
              {row.name}
            </Link>
            <p className="mt-0.5 break-words text-xs text-muted">{row.shortDescription}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'category',
      label: 'Category',
      sortable: true,
      cell: (row) => (
        <Badge
          tone={
            row.category?.tone === 'purple'
              ? 'purple'
              : row.category?.tone === 'success'
                ? 'success'
                : row.category?.tone === 'warning'
                  ? 'warning'
                  : 'info'
          }
        >
          {row.category?.name ?? 'Uncategorized'}
        </Badge>
      ),
    },
    {
      id: 'price',
      label: 'Pricing',
      sortable: true,
      cell: (row) => (
        <span className="whitespace-nowrap text-sm font-semibold text-heading">
          {formatPrice(row)}
        </span>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      sortable: true,
      cell: (row) => (
        <Badge tone="neutral">{row.status === 'INACTIVE' ? 'Inactive' : row.status}</Badge>
      ),
    },
    {
      id: 'updated',
      label: 'Last Updated',
      sortable: true,
      cell: (row) => (
        <div className="whitespace-nowrap">
          <time className="text-sm" dateTime={row.updatedAt}>
            {dayText(row.updatedAt)}
          </time>
          <p className="mt-0.5 text-xs text-muted">{row.updatedBy ? `by ${row.updatedBy}` : ''}</p>
        </div>
      ),
    },
  ];
  return (
    <div className="min-w-0 space-y-5" data-testid="inactive-services-page">
      <PageHeader
        title="Services & Pricing"
        subtitle="Manage your services, pricing, and what’s included."
        icon={Tag}
        actions={
          manage ? (
            <Link
              href="/services-pricing/new"
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-6 text-base font-medium text-on-action hover:bg-action-hover"
            >
              <Plus aria-hidden weight="bold" className="size-5" />
              Add New Service
            </Link>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-3 border-b border-divider pb-3 xl:flex-row xl:items-center">
        <nav aria-label="Services & Pricing sections" className="flex min-w-0 flex-wrap gap-1">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={tab.label === 'Inactive Services' ? 'page' : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm ${tab.label === 'Inactive Services' ? 'border-action bg-table-head font-semibold text-heading' : 'border-transparent font-medium text-action hover:bg-table-head'}`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row xl:ml-auto">
          <SearchField
            label="Search services"
            placeholder="Search services..."
            maxLength={100}
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setPage(1);
              setSelected([]);
            }}
            data-testid="inactive-search"
          />
          <div className="min-w-0 sm:w-48">
            <Select
              label="Category"
              hideLabel
              value={categoryId}
              disabled={categories.data === undefined}
              className="min-h-10 text-sm"
              options={[
                { value: '', label: 'All Categories' },
                ...(categories.data ?? [])
                  .filter((c) => c.status === 'ACTIVE')
                  .map((c) => ({ value: c.id, label: c.name })),
              ]}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
                setSelected([]);
              }}
              data-testid="inactive-category"
            />
          </div>
        </div>
      </div>
      <div
        className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5 [&>div>span]:rounded-lg"
        data-testid="catalog-metrics"
      >
        {metrics.map((metric) => (
          <KpiCard
            key={metric.key}
            icon={metric.icon}
            tone={
              metric.key === 'active' ? 'green' : metric.key === 'categories' ? 'amber' : 'blue'
            }
            value={summary.isError ? '—' : (summary.data?.[metric.key] ?? '—')}
            label={metric.label}
            loading={summary.isPending}
          />
        ))}
      </div>
      <section
        className="min-w-0 overflow-hidden rounded-card border border-border bg-surface shadow-card"
        data-testid="inactive-list-frame"
      >
        <h2 className="sr-only">Inactive Services</h2>
        <div className={`hidden xl:block ${rows.length || list.isPending ? '' : 'p-4'}`}>
          <Table
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            caption="Inactive services"
            dense
            tableClassName="table-fixed [&_thead_th]:text-sm [&_thead_th]:font-semibold [&_th:last-child]:w-56 [&_td:last-child]:w-56"
            selection={{ selected, onChange: setSelected }}
            rowActions={rowActions}
            loading={list.isPending}
            showPagination={false}
            emptyTitle={emptyTitle}
            emptyText={
              list.isError
                ? errorMessage(list.error)
                : 'Inactive services remain available for editing and reactivation.'
            }
            emptyAction={retry}
            server={{
              page,
              hasNext: page * 8 < (list.data?.total ?? 0),
              hasPrevious: page > 1,
              onNext: () => setPage(page + 1),
              onPrevious: () => setPage(page - 1),
              sort,
              onSort: (next) => {
                setSort(next);
                setPage(1);
              },
            }}
          />
        </div>
        <div className="space-y-3 p-4 xl:hidden">
          {rows.map((row) => (
            <Card
              key={row.id}
              className="min-w-0 space-y-3 p-3"
              data-testid="inactive-service-card"
            >
              <Link
                href={`/services-pricing/${row.id}`}
                className="break-words font-semibold text-heading"
              >
                {row.name}
              </Link>
              <p className="break-words text-sm text-muted">{row.shortDescription}</p>
              <div className="flex flex-wrap gap-2">
                <Badge
                  tone={
                    row.category?.tone === 'purple'
                      ? 'purple'
                      : row.category?.tone === 'success'
                        ? 'success'
                        : row.category?.tone === 'warning'
                          ? 'warning'
                          : 'info'
                  }
                >
                  {row.category?.name ?? 'Uncategorized'}
                </Badge>
                <Badge tone="neutral">Inactive</Badge>
              </div>
              <p className="text-sm">{formatPrice(row)}</p>
              <p className="text-xs text-muted">Updated {dayText(row.updatedAt)}</p>
              {rowActions(row)}
            </Card>
          ))}
          {!rows.length && !list.isPending ? (
            <div className="flex flex-col items-start gap-3 p-4 text-sm text-muted">
              <p>{emptyTitle}</p>
              {retry}
            </div>
          ) : null}
        </div>
        <div className="p-4">
          <Pagination
            page={page}
            pageCount={Math.max(1, Math.ceil((list.data?.total ?? 0) / 8))}
            onPage={setPage}
            summary={
              list.data
                ? list.data.total && rows.length
                  ? `Showing ${(page - 1) * 8 + 1}–${Math.min(page * 8, list.data.total)} of ${list.data.total} services`
                  : 'No services to show'
                : list.isError
                  ? 'Service list unavailable'
                  : 'Loading services…'
            }
          />
        </div>
      </section>
      {duplicate.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(duplicate.error, CATALOG_ERRORS)}
        </p>
      ) : null}
      <Modal
        open={action !== null}
        title={
          action
            ? `${action.type === 'usage' ? 'Usage' : action.type === 'activate' ? 'Activate' : action.type === 'archive' ? 'Archive' : 'Delete'}: ${action.row.name}`
            : 'Service action'
        }
        onClose={() => setAction(null)}
        footer={
          action && action.type !== 'usage' ? (
            <Button
              disabled={change.isPending || (action.type === 'activate' && gap !== null)}
              onClick={() => {
                if (action.type !== 'usage')
                  change.mutate(
                    { row: action.row, type: action.type },
                    { onSuccess: () => setAction(null) },
                  );
              }}
            >
              Confirm {action.type}
            </Button>
          ) : undefined
        }
      >
        {action ? (
          <>
            {gap ? (
              // S3: say what is missing; the API would refuse the activation anyway.
              <p
                role="alert"
                data-testid="activation-blocked"
                className="mb-4 rounded-control bg-warning-soft p-3 text-sm text-heading"
              >
                {action.row.name} can&apos;t be activated yet: {gap.message.toLowerCase()} first.{' '}
                <Link
                  href={`/services-pricing/${action.row.id}/edit`}
                  className="font-semibold text-link hover:underline"
                >
                  Edit {action.row.name}
                </Link>
              </p>
            ) : null}
            <Usage serviceId={action.row.id} />
            {action.type !== 'usage' ? (
              <p className="mt-4 text-sm text-muted">
                Existing invoices and historical records are preserved. The API checks whether this
                action is permitted.
              </p>
            ) : null}
          </>
        ) : null}
        {change.error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {errorMessage(change.error, CATALOG_ERRORS)}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
