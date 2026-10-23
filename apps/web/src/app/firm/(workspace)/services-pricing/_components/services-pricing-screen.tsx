'use client';

import {
  Archive,
  ArrowCounterClockwise,
  BookOpen,
  Briefcase,
  Buildings,
  CalendarBlank,
  ChartBar,
  CheckCircle,
  Clock,
  Copy,
  Cube,
  DotsThreeVertical,
  Eye,
  FileText,
  FolderOpen,
  MagnifyingGlass,
  Money,
  PencilSimple,
  Plus,
  Shield,
  Tag,
  Trash,
  User,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import type { CatalogServiceRow, CatalogServicesQuery } from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
  Modal,
  Pagination,
  Select,
  Table,
  Toast,
  type Column,
  type TableSort,
} from '@firmivra/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { CATALOG_ERRORS, rowActivationGap, STATUS_LABEL, STATUS_TONE } from './catalog-shared';

const CATALOG_KEY = ['services-pricing'] as const;
const PAGE_SIZE = 8;
type SortKey = NonNullable<CatalogServicesQuery['sort']>;
type ServiceAction = 'activate' | 'deactivate' | 'archive';

/**
 * Which services the list shows (Octavia's review S2, S4): drafts and archived services were
 * reachable nowhere. Inactive Services keeps its own tab.
 */
type ServiceView = 'active' | 'draft' | 'archived' | 'all';
const VIEWS: { id: ServiceView; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'draft', label: 'Drafts' },
  { id: 'archived', label: 'Archived' },
  { id: 'all', label: 'All' },
];
const EMPTY: Record<ServiceView, { title: string; text: string }> = {
  active: {
    title: 'No active services yet',
    text: 'Add your first service to start building your catalog.',
  },
  draft: {
    title: 'No drafts',
    text: 'Save as Draft keeps an unfinished service here until it is ready to activate.',
  },
  archived: { title: 'Nothing archived', text: 'Archived services stay here and can be restored.' },
  all: { title: 'No services yet', text: 'Add your first service to start building your catalog.' },
};
const isView = (value: string | null): value is ServiceView => VIEWS.some((v) => v.id === value);

const serviceIcons: Record<string, { glyph: Icon; tone: string }> = {
  user: { glyph: User, tone: 'bg-danger-soft text-danger' },
  briefcase: { glyph: Briefcase, tone: 'bg-warning-soft text-gold' },
  calendar: { glyph: CalendarBlank, tone: 'bg-danger-soft text-danger' },
  'chart-bar': { glyph: ChartBar, tone: 'bg-warning-soft text-gold' },
  'users-three': { glyph: UsersThree, tone: 'bg-danger-soft text-danger' },
  money: { glyph: Money, tone: 'bg-warning-soft text-gold' },
  book: { glyph: BookOpen, tone: 'bg-danger-soft text-danger' },
  'file-text': { glyph: FileText, tone: 'bg-navigation text-on-action' },
  shield: { glyph: Shield, tone: 'bg-info-soft text-info' },
  buildings: { glyph: Buildings, tone: 'bg-purple-soft text-purple' },
  pencil: { glyph: PencilSimple, tone: 'bg-info-soft text-info' },
};

const metricCards = [
  { key: 'total', label: 'Total Services', icon: Cube, tone: 'bg-info-soft text-info' },
  {
    key: 'active',
    label: 'Active Services',
    icon: CheckCircle,
    tone: 'bg-success-soft text-success',
  },
  { key: 'inactive', label: 'Inactive Services', icon: Clock, tone: 'bg-info-soft text-info' },
  { key: 'categories', label: 'Categories', icon: FolderOpen, tone: 'bg-warning-soft text-gold' },
  {
    key: 'activePromotions',
    label: 'Active Promotions',
    icon: Tag,
    tone: 'bg-info-soft text-info',
  },
] as const;

const tabs = [
  { id: 'active', label: 'Active Services' },
  { id: 'inactive', label: 'Inactive Services' },
  { id: 'categories', label: 'Service Categories' },
  { id: 'packages', label: 'Package Builder' },
  { id: 'promotions', label: 'Discounts & Promotions' },
];

function ServicesTabs({ onChange }: { onChange: (id: string) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Services & Pricing sections"
      className="flex min-w-0 overflow-x-auto border-b border-divider"
    >
      {tabs.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === 'active'}
          tabIndex={item.id === 'active' ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            const keys: Record<string, number> = {
              ArrowRight: (index + 1) % tabs.length,
              ArrowLeft: (index - 1 + tabs.length) % tabs.length,
              Home: 0,
              End: tabs.length - 1,
            };
            const nextIndex = keys[event.key];
            if (nextIndex === undefined) return;
            event.preventDefault();
            const next = tabs[nextIndex];
            if (next) {
              onChange(next.id);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [nextIndex]?.focus();
            }
          }}
          className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm ${item.id === 'active' ? 'border-action bg-table-head font-semibold text-heading' : 'border-transparent font-medium text-action hover:bg-table-head'}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

const categoryTones = ['info', 'purple', 'success', 'warning', 'danger', 'neutral'] as const;

function categoryTone(tone: string | null | undefined) {
  return categoryTones.find((candidate) => candidate === tone) ?? 'neutral';
}

function ServiceMark({ icon }: { icon: string | null }) {
  const design = (icon && serviceIcons[icon]) || { glyph: Tag, tone: 'bg-info-soft text-info' };
  const Glyph = design.glyph;

  return (
    <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${design.tone}`}>
      <Glyph aria-hidden weight="fill" className="size-6" />
    </span>
  );
}

function money(cents: number | null) {
  if (cents === null) return 'Quote required';
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function priceLabel(row: CatalogServiceRow) {
  const amount = money(row.price.amountCents);
  switch (row.price.type) {
    case 'STARTING_AT':
      return `${amount}+`;
    case 'HOURLY':
      return `${amount}/hour`;
    case 'RECURRING': {
      const cadence = {
        ONE_TIME: 'one time',
        WEEKLY: 'week',
        BIWEEKLY: '2 weeks',
        MONTHLY: 'month',
        QUARTERLY: 'quarter',
        SEMIANNUAL: '6 months',
        ANNUAL: 'year',
      }[row.price.frequency ?? 'MONTHLY'];
      return `${amount} / ${cadence}`;
    }
    case 'CUSTOM_QUOTE':
      return 'Quote required';
    default:
      return amount;
  }
}

function updatedDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function ServiceMetrics({
  summary,
}: {
  summary:
    | {
        total: number;
        active: number;
        inactive: number;
        categories: number;
        activePromotions: number;
      }
    | undefined;
}) {
  return (
    <section
      aria-label="Service summary"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
    >
      {metricCards.map(({ key, label, icon: Glyph, tone }) => (
        <div
          key={key}
          className="flex min-h-20 items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-card"
        >
          <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${tone}`}>
            <Glyph aria-hidden weight="fill" className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-2xl leading-none font-bold text-heading">
              {summary ? summary[key] : <span aria-label="Not available">—</span>}
            </p>
            <p className="mt-1 text-sm text-muted">{label}</p>
          </div>
        </div>
      ))}
    </section>
  );
}

function ServiceUsageDialog({
  service,
  onClose,
}: {
  service: CatalogServiceRow;
  onClose: () => void;
}) {
  const usage = useApiQuery([...CATALOG_KEY, 'usage', service.id], () =>
    api.servicesPricing.usage(service.id),
  );

  return (
    <Modal
      open
      title={`${service.name} usage`}
      subtitle="Where this service is currently referenced."
      onClose={onClose}
    >
      <PageState query={usage}>
        {(data) => (
          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold text-heading">Packages</h3>
              {data.packages.length ? (
                <ul className="mt-2 space-y-2">
                  {data.packages.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-4">
                      <span>{item.name}</span>
                      <Badge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {item.status.toLowerCase()}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted">Not included in a package.</p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-canvas p-3 sm:grid-cols-4">
              <div>
                <dt className="text-muted">Active engagements</dt>
                <dd className="font-semibold">{data.activeEngagements}</dd>
              </div>
              <div>
                <dt className="text-muted">Open invoices</dt>
                <dd className="font-semibold">{data.openInvoices}</dd>
              </div>
              <div>
                <dt className="text-muted">Appointment types</dt>
                <dd className="font-semibold">{data.appointmentTypes}</dd>
              </div>
              <div>
                <dt className="text-muted">Automations</dt>
                <dd className="font-semibold">{data.automations}</dd>
              </div>
            </dl>
          </div>
        )}
      </PageState>
    </Modal>
  );
}

export function ServicesPricingScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const asked = params.get('view');
  const [view, setView] = useState<ServiceView>(() => (isView(asked) ? asked : 'active'));
  /** A service that cannot be activated yet, and what it still needs. */
  const [blocked, setBlocked] = useState<{ row: CatalogServiceRow; need: string } | null>(null);
  const [searchText, setSearchText] = useState('');
  const search = useDeferredValue(searchText.trim());
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState<TableSort>({ id: 'updated', descending: true });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [usageTarget, setUsageTarget] = useState<CatalogServiceRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogServiceRow | null>(null);
  const [notice, setNotice] = useState('');

  const summary = useApiQuery([...CATALOG_KEY, 'summary'], () => api.servicesPricing.summary());
  const categories = useApiQuery([...CATALOG_KEY, 'categories'], () =>
    api.servicesPricing.categories(),
  );
  const query: CatalogServicesQuery = {
    status: view,
    search: search || undefined,
    categoryId: categoryId || undefined,
    sort: sort.id as SortKey,
    direction: sort.descending ? 'desc' : 'asc',
    page,
    pageSize: PAGE_SIZE,
  };
  const services = useApiQuery([...CATALOG_KEY, 'services', query], () =>
    api.servicesPricing.services(query),
  );

  const serviceAction = useApiMutation(
    ({ id, action }: { id: string; action: ServiceAction }) => {
      if (action === 'activate') return api.servicesPricing.activateService(id);
      if (action === 'deactivate') return api.servicesPricing.deactivateService(id);
      return api.servicesPricing.archiveService(id);
    },
    { invalidate: CATALOG_KEY },
  );
  const duplicate = useApiMutation((id: string) => api.servicesPricing.duplicateService(id), {
    invalidate: CATALOG_KEY,
  });
  const remove = useApiMutation((id: string) => api.servicesPricing.deleteService(id), {
    invalidate: CATALOG_KEY,
  });

  const columns: Column<CatalogServiceRow>[] = [
    {
      id: 'name',
      label: 'Service Name',
      sortable: true,
      className: 'min-w-80',
      cell: (row) => (
        <div className="flex min-w-72 items-center gap-4">
          <ServiceMark icon={row.icon} />
          <div className="min-w-0">
            <Link
              href={`/services-pricing/${row.id}`}
              className="block truncate text-sm font-semibold text-heading hover:text-action"
            >
              {row.name}
            </Link>
            <p className="mt-0.5 truncate text-xs text-muted">{row.shortDescription}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'category',
      label: 'Category',
      sortable: true,
      className: 'min-w-36',
      cell: (row) =>
        row.category ? (
          <Badge tone={categoryTone(row.category.tone)}>{row.category.name}</Badge>
        ) : (
          <span className="text-muted">Uncategorized</span>
        ),
    },
    {
      id: 'price',
      label: 'Pricing',
      sortable: true,
      className: 'min-w-32 whitespace-nowrap text-sm font-semibold text-heading',
      cell: (row) => priceLabel(row),
    },
    {
      id: 'status',
      label: 'Status',
      sortable: true,
      className: 'min-w-28',
      cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>,
    },
    {
      id: 'updated',
      label: 'Last Updated',
      sortable: true,
      className: 'min-w-40',
      cell: (row) => (
        <div className="whitespace-nowrap">
          <time className="text-sm" dateTime={row.updatedAt}>
            {updatedDate(row.updatedAt)}
          </time>
          <p className="mt-0.5 text-xs text-muted">by {row.updatedBy || 'Team Member'}</p>
        </div>
      ),
    },
  ];

  function changePage(next: number) {
    setPage(next);
    setSelected([]);
  }

  function handleServiceAction(row: CatalogServiceRow, action: ServiceAction) {
    setNotice('');
    setBlocked(null);
    // S3: say what is missing instead of sending a request the API refuses.
    const gap = action === 'activate' ? rowActivationGap(row) : null;
    if (gap) {
      setBlocked({ row, need: gap.message });
      return;
    }
    serviceAction.mutate(
      { id: row.id, action },
      {
        onSuccess: () =>
          setNotice(
            action === 'archive'
              ? `${row.name} archived. It stays under Archived.`
              : row.status === 'ARCHIVED'
                ? `${row.name} restored to Inactive Services.`
                : action === 'activate'
                  ? `${row.name} activated.`
                  : `${row.name} deactivated.`,
          ),
      },
    );
  }

  function rowActions(row: CatalogServiceRow) {
    const menuItems = [
      {
        label: 'View / Preview',
        icon: Eye,
        onSelect: () => router.push(`/services-pricing/${row.id}`),
      },
      {
        label: 'Edit',
        icon: PencilSimple,
        onSelect: () => router.push(`/services-pricing/${row.id}/edit`),
      },
      {
        label: 'Duplicate',
        icon: Copy,
        onSelect: () =>
          duplicate.mutate(row.id, {
            onSuccess: (copy) => router.push(`/services-pricing/${copy.id}/edit`),
          }),
      },
      {
        label: 'Manage Add-Ons',
        icon: Plus,
        onSelect: () => router.push(`/services-pricing/${row.id}/edit`),
      },
      { label: 'View Usage', icon: Cube, onSelect: () => setUsageTarget(row) },
      ...(row.status === 'ACTIVE'
        ? [
            {
              label: 'Deactivate',
              icon: Clock,
              onSelect: () => handleServiceAction(row, 'deactivate'),
            },
          ]
        : row.status === 'ARCHIVED'
          ? [
              {
                label: 'Restore',
                icon: ArrowCounterClockwise,
                onSelect: () => handleServiceAction(row, 'deactivate'),
              },
            ]
          : [
              {
                label: 'Activate',
                icon: CheckCircle,
                onSelect: () => handleServiceAction(row, 'activate'),
              },
            ]),
      ...(row.status === 'ARCHIVED'
        ? []
        : [
            {
              label: 'Archive',
              icon: Archive,
              onSelect: () => handleServiceAction(row, 'archive'),
              danger: true,
            },
          ]),
      { label: 'Delete', icon: Trash, onSelect: () => setDeleteTarget(row), danger: true },
    ];

    return (
      <div className="flex items-center justify-end gap-3">
        {row.status === 'ARCHIVED' ? (
          <button
            type="button"
            className="inline-flex min-h-10 min-w-24 items-center justify-center gap-2 rounded-lg bg-info-soft px-4 text-sm font-semibold text-action hover:bg-info-soft"
            onClick={() => handleServiceAction(row, 'deactivate')}
          >
            <ArrowCounterClockwise aria-hidden weight="bold" className="size-4" />
            Restore
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex min-h-10 min-w-24 items-center justify-center gap-2 rounded-lg bg-info-soft px-4 text-sm font-semibold text-action hover:bg-info-soft"
            onClick={() => router.push(`/services-pricing/${row.id}/edit`)}
          >
            <PencilSimple aria-hidden weight="fill" className="size-4" />
            {row.status === 'DRAFT' ? 'Resume' : 'Edit'}
          </button>
        )}
        <button
          type="button"
          aria-label={`Duplicate ${row.name}`}
          title={`Duplicate ${row.name}`}
          className="inline-flex size-10 items-center justify-center rounded-lg border border-divider bg-surface text-heading hover:bg-canvas"
          onClick={() =>
            duplicate.mutate(row.id, {
              onSuccess: (copy) => router.push(`/services-pricing/${copy.id}/edit`),
            })
          }
        >
          <Copy aria-hidden weight="bold" className="size-5" />
        </button>
        <ActionMenu
          label={`Actions for ${row.name}`}
          trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
          className="[&>button>svg:last-child]:hidden [&>button]:size-8 [&>button]:justify-center [&>button]:px-0"
          sections={[{ items: menuItems }]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="services-pricing-page">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
              <Tag aria-hidden weight="fill" className="size-9" />
            </span>
            <div className="min-w-0">
              <h1 data-testid="page-title" className="font-display text-4xl font-bold text-heading">
                Services &amp; Pricing
              </h1>
              <p className="text-base text-muted">
                Manage your services, pricing, and what&apos;s included.
              </p>
            </div>
          </div>
          <Button className="px-6 text-base" onClick={() => router.push('/services-pricing/new')}>
            <Plus aria-hidden weight="bold" className="size-5" />
            Add New Service
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 border-b border-divider pb-3 xl:flex-row xl:items-center">
          <div className="min-w-0 flex-1">
            <ServicesTabs
              onChange={(id) =>
                router.push(id === 'active' ? '/services-pricing' : `/services-pricing/${id}`)
              }
            />
          </div>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row xl:flex-none">
            <label className="relative min-w-0 sm:w-56">
              <span className="sr-only">Search services</span>
              <MagnifyingGlass
                aria-hidden
                weight="bold"
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              />
              <input
                aria-label="Search services"
                placeholder="Search services..."
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                  setPage(1);
                }}
                className="min-h-10 w-full rounded-control border border-border bg-surface py-2 pr-3 pl-10 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-focus"
              />
            </label>
            <Select
              label="All Categories"
              hideLabel
              aria-label="Filter by category"
              value={categoryId}
              disabled={categories.isPending || categories.data === undefined}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Categories' },
                ...(categories.data ?? [])
                  .filter((category) => category.status === 'ACTIVE')
                  .map((category) => ({ value: category.id, label: category.name })),
              ]}
              className="min-h-10 text-sm sm:w-48"
            />
          </div>
        </div>

        {serviceAction.isError || duplicate.isError || remove.isError ? (
          <div
            role="alert"
            className="rounded-card border border-danger bg-danger-soft p-3 text-sm text-danger"
          >
            {errorMessage(serviceAction.error ?? duplicate.error ?? remove.error, CATALOG_ERRORS)}
          </div>
        ) : null}
        {notice ? <Toast message={notice} onDismiss={() => setNotice('')} /> : null}
        {blocked ? (
          <div
            role="alert"
            data-testid="activation-blocked"
            className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-warning bg-warning-soft p-3 text-sm text-heading"
          >
            <span>
              {blocked.row.name} can&apos;t be activated yet: {blocked.need.toLowerCase()} first.
            </span>
            <Link
              href={`/services-pricing/${blocked.row.id}/edit`}
              className="font-semibold text-link hover:underline"
            >
              Edit {blocked.row.name}
            </Link>
          </div>
        ) : null}

        <>
          <ServiceMetrics summary={summary.data} />

          <div
            role="group"
            aria-label="Show services"
            data-testid="service-views"
            className="flex flex-wrap gap-2"
          >
            {VIEWS.map((item) => {
              const count =
                item.id === 'active'
                  ? summary.data?.active
                  : item.id === 'draft'
                    ? summary.data?.draft
                    : undefined;
              const on = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setView(item.id);
                    setPage(1);
                    setSelected([]);
                    setBlocked(null);
                  }}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-pill border px-3 text-sm font-medium ${on ? 'border-action bg-info-soft text-action' : 'border-border bg-surface text-text hover:bg-canvas'}`}
                >
                  {item.label}
                  {count === undefined ? null : (
                    <span className={`tabular-nums ${on ? 'text-action' : 'text-muted'}`}>
                      ({count})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-card border border-border bg-surface">
            <PageState query={services} isEmpty={() => false}>
              {(data) => (
                <Table
                  rows={data.items}
                  columns={columns}
                  rowKey={(row) => row.id}
                  caption={`${VIEWS.find((v) => v.id === view)?.label ?? 'Active'} services`}
                  dense
                  loading={services.isFetching && !services.isPending}
                  tableClassName="min-w-max [&_thead_th]:text-sm"
                  emptyTitle={search || categoryId ? 'No matching services' : EMPTY[view].title}
                  emptyText={
                    search || categoryId
                      ? 'Try a different search or category filter.'
                      : EMPTY[view].text
                  }
                  emptyAction={
                    !search && !categoryId && (view === 'active' || view === 'all') ? (
                      <Button onClick={() => router.push('/services-pricing/new')}>
                        <Plus aria-hidden weight="bold" className="size-4" />
                        Add New Service
                      </Button>
                    ) : undefined
                  }
                  server={{
                    page: data.page,
                    hasNext: data.page * data.pageSize < data.total,
                    hasPrevious: data.page > 1,
                    total: data.total,
                    sort,
                    onPage: changePage,
                    onNext: () => changePage(page + 1),
                    onPrevious: () => changePage(Math.max(1, page - 1)),
                    onSort: (next) => {
                      setSort(next);
                      setPage(1);
                    },
                  }}
                  showPagination={false}
                  selection={{
                    selected,
                    onChange: setSelected,
                  }}
                  rowActions={rowActions}
                  noun="services"
                />
              )}
            </PageState>
            {services.data && services.data.total > 0 ? (
              <div className="border-t border-divider p-4">
                <Pagination
                  page={services.data.page}
                  pageCount={Math.max(1, Math.ceil(services.data.total / services.data.pageSize))}
                  onPage={changePage}
                  summary={`Showing ${services.data.total === 0 ? 0 : (services.data.page - 1) * services.data.pageSize + 1}–${Math.min(services.data.page * services.data.pageSize, services.data.total)} of ${services.data.total} services`}
                />
              </div>
            ) : null}
          </div>
        </>
      </div>

      {usageTarget ? (
        <ServiceUsageDialog service={usageTarget} onClose={() => setUsageTarget(null)} />
      ) : null}

      <Modal
        open={deleteTarget !== null}
        title="Delete service?"
        subtitle="A service can only be deleted if it has never been used."
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-danger text-on-action hover:bg-danger"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                remove.mutate(deleteTarget.id, {
                  onSuccess: () => {
                    setDeleteTarget(null);
                    setNotice('Service deleted.');
                  },
                });
              }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete Service'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          Delete <span className="font-semibold">{deleteTarget?.name}</span>? This action cannot be
          undone.
        </p>
      </Modal>
    </div>
  );
}
