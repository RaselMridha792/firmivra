'use client';

import type { CatalogServiceRow, CatalogServicesQuery, CatalogSummary } from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  Input,
  KpiCard,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Table,
  type Column,
  type TableSort,
} from '@firmivra/ui';
import {
  Lightbulb,
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
  User,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { useFirm } from '../../../../../../components/firm-context';

function ServiceGlyph({ name }: { name: string | null }) {
  const Glyph =
    name === 'pencil'
      ? PencilSimple
      : name === 'lightbulb'
        ? Lightbulb
        : name === 'user'
          ? User
          : Tag;
  return <Glyph weight="fill" className="size-6" />;
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
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button
        variant="outline"
        className="min-h-8 px-2 py-1 text-xs"
        onClick={() => router.push(`/services-pricing/${row.id}/edit`)}
      >
        <PencilSimple weight="fill" className="size-3" />
        Edit
      </Button>
      {manage ? (
        <Button
          variant="secondary"
          className="min-h-8 px-2 py-1"
          aria-label={`Duplicate ${row.name}`}
          disabled={duplicate.isPending}
          onClick={() =>
            duplicate.mutate(row.id, {
              onSuccess: (copy) => router.push(`/services-pricing/${copy.id}/edit`),
            })
          }
        >
          <Copy weight="fill" className="size-4" />
        </Button>
      ) : null}
      <ActionMenu
        label={`Actions for ${row.name}`}
        trigger={<DotsThreeVertical weight="fill" className="size-4" />}
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
        <div className="flex min-w-0 items-start gap-2">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
            <ServiceGlyph name={row.icon} />
          </span>
          <div className="min-w-0">
            <Link
              className="break-words font-semibold text-heading"
              href={`/services-pricing/${row.id}`}
            >
              {row.name}
            </Link>
            <p className="mt-1 break-words text-xs text-muted">{row.shortDescription}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'category',
      label: 'Category',
      sortable: true,
      cell: (row) => <Badge tone="info">{row.category?.name ?? 'Uncategorized'}</Badge>,
    },
    {
      id: 'price',
      label: 'Pricing',
      sortable: true,
      cell: (row) => <span className="break-words">{formatPrice(row)}</span>,
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
        <div>
          {new Date(row.updatedAt).toLocaleDateString('en-US')}
          <p className="text-xs text-muted">{row.updatedBy ? `by ${row.updatedBy}` : ''}</p>
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
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-5 text-sm text-on-action"
            >
              <Plus weight="fill" className="size-4" />
              Add New Service
            </Link>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-3 border-b border-divider pb-3 2xl:flex-row">
        <nav aria-label="Services & Pricing sections" className="flex min-w-0 flex-wrap gap-1">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={tab.label === 'Inactive Services' ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm ${tab.label === 'Inactive Services' ? 'border-action bg-table-head font-semibold text-heading' : 'border-transparent text-action'}`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
          <Input
            label="Search services"
            hideLabel
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
          <Select
            label="Category"
            hideLabel
            value={categoryId}
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
      <div
        className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5"
        data-testid="catalog-metrics"
      >
        {metrics.map((metric) => (
          <KpiCard
            key={metric.key}
            icon={metric.icon}
            value={summary.isError ? '—' : (summary.data?.[metric.key] ?? '—')}
            label={metric.label}
            loading={summary.isPending}
          />
        ))}
      </div>
      {summary.isError ? <PageState query={summary}>{() => null}</PageState> : null}
      {categories.isError ? <PageState query={categories}>{() => null}</PageState> : null}
      <Card className="min-w-0 space-y-3 p-3" data-testid="inactive-list-frame">
        <h2 className="sr-only">Inactive Services</h2>
        <PageState query={list} isEmpty={() => false}>
          {() => null}
        </PageState>
        <div className="hidden xl:block">
          <Table
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            caption="Inactive services"
            dense
            tableClassName="table-fixed"
            selection={{ selected, onChange: setSelected }}
            rowActions={rowActions}
            loading={list.isPending}
            showPagination={false}
            emptyTitle={search || categoryId ? 'No matching services' : 'No inactive services yet'}
            emptyText="Inactive services remain available for editing and reactivation."
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
        <div className="space-y-3 xl:hidden">
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
                <Badge tone="info">{row.category?.name ?? 'Uncategorized'}</Badge>
                <Badge tone="neutral">Inactive</Badge>
              </div>
              <p className="text-sm">{formatPrice(row)}</p>
              <p className="text-xs text-muted">
                Updated {new Date(row.updatedAt).toLocaleDateString('en-US')}
              </p>
              {rowActions(row)}
            </Card>
          ))}
          {!rows.length && !list.isPending ? (
            <p className="p-4 text-sm text-muted">
              {search || categoryId ? 'No matching services' : 'No inactive services yet'}
            </p>
          ) : null}
        </div>
        <Pagination
          page={page}
          pageCount={Math.max(1, Math.ceil((list.data?.total ?? 0) / 8))}
          onPage={setPage}
          summary={
            list.data
              ? `Showing ${rows.length ? (page - 1) * 8 + 1 : 0}–${Math.min(page * 8, list.data.total)} of ${list.data.total} services`
              : 'Service list unavailable'
          }
        />
      </Card>
      {duplicate.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(duplicate.error)}
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
              disabled={change.isPending}
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
            {errorMessage(change.error)}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
