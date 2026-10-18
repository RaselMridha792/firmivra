'use client';

import {
  Button,
  Card,
  FilterBar,
  SearchField,
  Select,
  Table,
  Toast,
  type Column,
} from '@firmivra/ui';
import { FileText, Plus } from '@phosphor-icons/react';
import Link from 'next/link';
import { useDeferredValue, useEffect, useState } from 'react';
import { useApiQuery } from '../../../../../../lib/query';
import {
  adminIntegrations,
  CATEGORIES,
  CATEGORY_LABELS,
  ENVIRONMENT_LABELS,
  ENVIRONMENTS,
  INTEGRATION_STATUSES,
  STATUS_LABELS,
  type PlatformIntegration,
  type PlatformQuery,
} from '../../../../../../mocks/admin-integrations';
import { EnvironmentBadge, ServiceLogo } from '../../_components/integration-badges';
import { loadError, QuietLine } from '../../_components/integration-states';
import {
  IntegrationsHeader,
  IntegrationsNav,
  LinkButton,
  platformHref,
  setupHref,
} from '../../_components/integrations-shell';
import { PlatformActions, type Notice } from '../../_components/platform-actions';
import { CategoryTag, LastSyncCell, StatusCell, UpdatedCell } from './platform-cells';

/**
 * Platform Integrations (docx §3, no frame: the dashboard's look): every Firmivra service
 * connection with search, category, status and environment filters (AND, kept in the address,
 * docx §2), a sortable paged table and each row's actions (Manage or Continue, and the menu with
 * View Logs, Test Connection, Disable, Enable and Remove). The wizard comes back here with
 * `?saved=<id>&outcome=draft|activated` and the page says what happened.
 */

const PAGE_SIZE = 10;
type SortId = NonNullable<PlatformQuery['sort']>;
const SORTS: readonly SortId[] = ['order', 'name', 'category', 'status', 'lastSync'];
const OUTCOMES = ['draft', 'activated'] as const;
type Outcome = (typeof OUTCOMES)[number];

interface Filters {
  search: string;
  category: string;
  status: string;
  environment: string;
  sort: SortId;
  descending: boolean;
  page: number;
}
const DEFAULTS: Filters = {
  search: '',
  category: '',
  status: '',
  environment: '',
  sort: 'order',
  descending: false,
  page: 1,
};

const oneOf = <T extends string>(list: readonly T[], value: string | null): T | undefined =>
  list.find((item) => item === value);

/** The page's query string, as the server passes it (`?status=ERROR&q=…`). */
export type AddressQuery = Record<string, string | string[] | undefined>;

function reader(address: AddressQuery) {
  return (key: string) => {
    const value = address[key];
    return ((Array.isArray(value) ? value[0] : value) ?? '').slice(0, 100);
  };
}

/** The filters live in the address, so a filtered list can be reopened or shared (docx §2). */
function readFilters(address: AddressQuery): Filters {
  const get = reader(address);
  const page = Number(get('page'));
  const sort = oneOf(SORTS, get('sort')) ?? DEFAULTS.sort;
  return {
    search: get('q'),
    category: oneOf(CATEGORIES, get('category')) ?? '',
    status: oneOf(INTEGRATION_STATUSES, get('status')) ?? '',
    environment: oneOf(ENVIRONMENTS, get('environment')) ?? '',
    sort,
    descending: sort !== 'order' && get('desc') === '1',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}
function addressOf(filters: Filters): string {
  const params = new URLSearchParams();
  const put = (key: string, value: string, fallback = '') => {
    if (value !== fallback) params.set(key, value);
  };
  put('q', filters.search);
  put('category', filters.category);
  put('status', filters.status);
  put('environment', filters.environment);
  put('sort', filters.sort, DEFAULTS.sort);
  put('desc', filters.descending ? '1' : '');
  put('page', String(filters.page), '1');
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

/** The wizard's return: which integration it saved, and whether it was activated. */
function readSaved(address: AddressQuery): { id: string; outcome: Outcome } | null {
  const get = reader(address);
  const id = get('saved');
  const outcome = oneOf(OUTCOMES, get('outcome'));
  return /^[\w-]{1,64}$/.test(id) && outcome ? { id, outcome } : null;
}

const option = (value: string, label: string) => ({ value, label });

export function PlatformList({ address }: { address: AddressQuery }) {
  const [filters, setFilters] = useState(() => readFilters(address));
  const [saved, setSaved] = useState(() => readSaved(address));
  const [notice, setNotice] = useState<Notice | null>(null);
  // Typing in the search box stays quick; the list follows a moment later.
  const shown = useDeferredValue(filters);

  // The address follows the filters (and drops the wizard's one-time `saved`).
  useEffect(() => {
    const next = addressOf(filters);
    if (next !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, '', next);
  }, [filters]);

  const update = (patch: Partial<Filters>) =>
    setFilters((current) => ({ ...current, page: 1, ...patch }));
  const clearFilters = () => setFilters(DEFAULTS);
  const filtered = !!(filters.search || filters.category || filters.status || filters.environment);

  const query: PlatformQuery = {
    search: shown.search || undefined,
    category: oneOf(CATEGORIES, shown.category),
    status: oneOf(INTEGRATION_STATUSES, shown.status),
    environment: oneOf(ENVIRONMENTS, shown.environment),
    sort: shown.sort,
    descending: shown.descending,
    page: shown.page,
    pageSize: PAGE_SIZE,
  };
  const list = useApiQuery(['admin-integrations', 'platform', 'list', query], () =>
    adminIntegrations.listPlatform(query),
  );
  const access = useApiQuery(['admin-integrations', 'access'], () => adminIntegrations.access());
  const savedItem = useApiQuery(['admin-integrations', 'platform', saved?.id ?? 'none'], () =>
    saved ? adminIntegrations.getPlatform(saved.id) : Promise.resolve(null),
  );

  const savedName = savedItem.data?.name;
  const savedNotice: Notice | null =
    saved && savedName
      ? {
          tone: 'success',
          text:
            saved.outcome === 'activated'
              ? `${savedName} is active. Firmivra can now use it, and the activation was added to the audit log.`
              : `${savedName} was saved as a draft. Continue its setup from this list at any time.`,
        }
      : null;
  const shownNotice = notice ?? savedNotice;

  const columns: Column<PlatformIntegration>[] = [
    {
      id: 'name',
      label: 'Integration',
      sortable: true,
      className: 'min-w-52',
      cell: (item) => (
        <span className="flex items-center gap-3">
          <ServiceLogo category={item.category} size="sm" />
          <span className="min-w-0">
            <Link
              href={item.status === 'DRAFT' ? setupHref(item) : platformHref(item.id)}
              className="block font-semibold text-heading hover:text-action hover:underline"
            >
              {item.name}
            </Link>
            <span className="block text-xs text-muted">{item.description}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'category',
      label: 'Category',
      sortable: true,
      cell: (item) => <CategoryTag category={item.category} />,
    },
    {
      id: 'status',
      label: 'Status / Health',
      sortable: true,
      cell: (item) => <StatusCell integration={item} />,
    },
    {
      id: 'environment',
      label: 'Environment',
      className: 'whitespace-nowrap',
      cell: (item) => <EnvironmentBadge environment={item.environment} />,
    },
    {
      id: 'lastSync',
      label: 'Last Sync / Uptime',
      sortable: true,
      cell: (item) => <LastSyncCell integration={item} />,
    },
    {
      id: 'updated',
      label: 'Updated',
      cell: (item) => <UpdatedCell integration={item} />,
    },
  ];

  const page = list.data;
  const pageCount = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
  const addButton = (
    <LinkButton href="/integrations/platform/new" variant="primary">
      <Plus aria-hidden weight="bold" className="size-5" />
      Add Platform Integration
    </LinkButton>
  );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <IntegrationsHeader
        title="Platform Integrations"
        subtitle="The third-party services that power Firmivra itself: payments, messaging, email, storage, AI and data."
        crumbs={[
          { label: 'Integrations', href: '/integrations' },
          { label: 'Platform Integrations' },
        ]}
        actions={
          <>
            <LinkButton href="/integrations/logs">
              <FileText aria-hidden weight="fill" className="size-5" />
              View Integration Logs
            </LinkButton>
            {addButton}
          </>
        }
      />

      {shownNotice ? (
        <Toast
          message={shownNotice.text}
          tone={shownNotice.tone}
          onDismiss={() => {
            setNotice(null);
            setSaved(null);
          }}
        />
      ) : null}

      <IntegrationsNav current="platform" />

      <div data-testid="platform-filters">
        <FilterBar onReset={filtered ? clearFilters : undefined} resetLabel="Clear Filters">
          <SearchField
            label="Search integrations"
            placeholder="Search by name, provider or reference..."
            maxLength={100}
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
          />
          <div className="w-full sm:w-52">
            <Select
              label="Category"
              hideLabel
              value={filters.category}
              onChange={(event) => update({ category: event.target.value })}
              options={[
                option('', 'All Categories'),
                ...CATEGORIES.map((value) => option(value, CATEGORY_LABELS[value])),
              ]}
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              label="Status"
              hideLabel
              value={filters.status}
              onChange={(event) => update({ status: event.target.value })}
              options={[
                option('', 'All Statuses'),
                ...INTEGRATION_STATUSES.map((value) => option(value, STATUS_LABELS[value])),
              ]}
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              label="Environment"
              hideLabel
              value={filters.environment}
              onChange={(event) => update({ environment: event.target.value })}
              options={[
                option('', 'All Environments'),
                ...ENVIRONMENTS.map((value) => option(value, ENVIRONMENT_LABELS[value])),
              ]}
            />
          </div>
        </FilterBar>
      </div>

      <Card data-testid="platform-list" className="min-w-0 overflow-hidden p-0! contain-paint">
        {list.isError ? (
          <div className="px-5 py-2">
            <QuietLine>{loadError(list.error)}</QuietLine>
          </div>
        ) : page && !page.items.length ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            {filtered ? (
              <>
                <p className="font-semibold text-heading">No integrations match these filters.</p>
                <p className="max-w-xl text-sm text-muted">
                  Change the search or the filters, or clear them to see every platform integration.
                </p>
                <Button variant="secondary" onClick={clearFilters}>
                  Clear Filters
                </Button>
              </>
            ) : (
              <>
                <p className="font-semibold text-heading">No platform integrations yet.</p>
                <p className="max-w-xl text-sm text-muted">
                  Platform integrations are the services Firmivra itself runs on, such as payments,
                  SMS, email and storage. Add the first one to start; it stays a draft until its
                  connection is tested and activated.
                </p>
                {addButton}
              </>
            )}
          </div>
        ) : (
          <div className="p-3">
            <Table
              caption="Platform integrations"
              rows={page?.items ?? []}
              loading={list.isPending}
              columns={columns}
              rowKey={(item) => item.id}
              noun="integrations"
              pageSize={PAGE_SIZE}
              server={{
                page: page?.page ?? 1,
                total: page?.total,
                hasNext: page ? page.page < pageCount : false,
                hasPrevious: (page?.page ?? 1) > 1,
                onNext: () => update({ page: (page?.page ?? 1) + 1 }),
                onPrevious: () => update({ page: Math.max(1, (page?.page ?? 2) - 1) }),
                onPage: (next) => update({ page: next }),
                sort:
                  filters.sort === 'order'
                    ? undefined
                    : { id: filters.sort, descending: filters.descending },
                onSort: (sort) =>
                  update({ sort: oneOf(SORTS, sort.id) ?? 'order', descending: sort.descending }),
              }}
              rowActions={(item) => (
                <PlatformActions
                  integration={item}
                  canLifecycle={access.data?.canLifecycle ?? false}
                  onNotice={(next) => {
                    setSaved(null);
                    setNotice(next);
                  }}
                />
              )}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
