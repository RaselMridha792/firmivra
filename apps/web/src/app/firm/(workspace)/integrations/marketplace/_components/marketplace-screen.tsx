'use client';

import {
  ApiRequestError,
  IntegrationCategory,
  IntegrationSort,
  type IntegrationCard,
} from '@firmivra/types';
import {
  Button,
  Card,
  IconButton,
  Modal,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
} from '@firmivra/ui';
import {
  ArrowRight,
  CaretRight,
  Code,
  GridFour,
  Info,
  Laptop,
  List,
  Plus,
  PuzzlePiece,
  CloudArrowUp,
  PlugsConnected,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { MarketplaceCard, MarketplaceAction } from './marketplace-card';
import { categories, categoryOptions, categoryLabel } from './marketplace-shared';
import { RequestIntegrationModal } from './request-integration-modal';

export function MarketplaceScreen() {
  const { firm } = useFirm();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'popular' | 'name' | 'category'>('popular');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [requestOpen, setRequestOpen] = useState(false);
  const [details, setDetails] = useState<IntegrationCard | null>(null);
  const allHeadingRef = useRef<HTMLHeadingElement>(null);
  const catalog = useApiQuery(['integrations-marketplace', search, category, sort], () =>
    api.integrations.marketplace({
      search,
      sort,
      ...(category ? { category: IntegrationCategory.parse(category) } : {}),
    }),
  );
  const permission = useApiQuery(['integrations-marketplace', 'capabilities'], () =>
    api.integrations.overview(),
  );
  const canManage = permission.isSuccess && permission.data.canManage;
  const data = catalog.isError || catalog.isPending ? undefined : catalog.data;
  const emptyText = catalog.isPending
    ? 'Loading integrations...'
    : catalog.isError
      ? 'Integrations will appear when the connection is restored.'
      : search || category
        ? 'No integrations match your filters.'
        : 'No integrations available yet.';

  return (
    <div data-testid="marketplace-screen" className="flex min-w-0 flex-col gap-4">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-sm"
      >
        <Link href="/integrations" className="text-link hover:underline">
          Integrations
        </Link>
        <CaretRight aria-hidden className="size-4 text-muted" />
        <span aria-current="page" className="font-medium text-heading">
          Add Integration
        </span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="[&_h1]:font-sans">
          <PageHeader
            title="Add Integration"
            subtitle={`Connect another tool to ${firm.name} and streamline your workflow.`}
            icon={PuzzlePiece}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
          <SearchField
            label="Search integrations"
            placeholder="Search integrations..."
            maxLength={100}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            label="Integration category"
            hideLabel
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            options={[{ value: '', label: 'All Categories' }, ...categoryOptions]}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-4 lg:flex-row">
        <aside
          aria-label="Marketplace navigation"
          className="flex w-full shrink-0 flex-col gap-4 lg:w-52 xl:w-56"
        >
          <Card
            data-testid="marketplace-categories"
            title="Categories"
            className="w-full !rounded-lg !p-3 [&>h2]:text-base [&>h2]:font-semibold"
          >
            <nav aria-label="Integration categories" className="flex flex-col gap-1">
              <Button
                variant="ghost"
                aria-pressed={!category}
                className={`!min-h-8 w-full !justify-start !px-2 !py-1 text-xs ${!category ? '!bg-info-soft !text-action' : '!text-text'}`}
                onClick={() => setCategory('')}
              >
                <GridFour weight="fill" className="size-4 shrink-0" />
                All Integrations
              </Button>
              {categories.map(({ value, label, icon: Glyph }) => (
                <Button
                  key={value}
                  variant="ghost"
                  aria-pressed={category === value}
                  className={`!min-h-8 w-full !justify-start !px-2 !py-1 text-left text-xs ${category === value ? '!bg-info-soft !text-action' : '!text-text'}`}
                  onClick={() => setCategory(value)}
                >
                  <Glyph weight="fill" className="size-4 shrink-0" />
                  {label}
                </Button>
              ))}
            </nav>
          </Card>
          <Card data-testid="marketplace-request" className="w-full !rounded-lg !bg-info-soft !p-4">
            <div className="mb-3 flex items-center gap-2">
              <Info weight="fill" className="size-8 shrink-0 text-action" />
              <h2 className="text-sm font-bold text-heading">
                Don&apos;t see the integration you need?
              </h2>
            </div>
            <p className="mb-4 text-sm text-muted">
              Request a new integration and we&apos;ll let you know when it&apos;s available.
            </p>
            <Button
              variant="outline"
              className="w-full text-xs"
              disabled={!canManage}
              onClick={() => setRequestOpen(true)}
            >
              Request Integration
            </Button>
            {permission.isSuccess && !canManage ? (
              <p className="mt-2 text-xs text-muted">
                Ask your administrator to request an integration.
              </p>
            ) : null}
          </Card>
        </aside>
        <div className="flex min-w-0 w-full flex-1 flex-col gap-4">
          <section
            data-testid="marketplace-banner"
            aria-label="Connect your tools"
            className="flex flex-col items-start justify-between gap-4 overflow-hidden rounded-lg bg-navigation sm:flex-row sm:items-center p-5 text-on-action"
          >
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-bold">Connect. Automate. Grow.</h2>
              <p className="mt-2 max-w-xl text-sm">
                Integrate the tools you already use to save time,
                <br className="hidden xl:block" /> reduce manual work, and keep your business
                running smoothly.
              </p>
            </div>
            <div aria-hidden className="flex items-center gap-3 text-on-action">
              <CloudArrowUp weight="fill" className="size-8" />
              <Laptop weight="fill" className="size-20" />
              <PlugsConnected weight="fill" className="size-8" />
            </div>
          </section>
          {catalog.isError || permission.isError ? (
            <div
              data-testid="marketplace-unavailable"
              role="status"
              className="rounded-control border border-border bg-subtle px-4 py-3 text-sm text-muted"
            >
              {[catalog.error, permission.error].some(
                (error) => error instanceof ApiRequestError && error.code === 'FORBIDDEN',
              )
                ? "You do not have access to the marketplace. Ask your firm's owner if you need it."
                : 'The marketplace is temporarily unavailable. Existing page sections remain visible; permission-sensitive actions are disabled.'}{' '}
              <Button
                variant="ghost"
                className="!min-h-0 !p-0 align-baseline text-sm underline"
                onClick={() => {
                  void catalog.refetch();
                  void permission.refetch();
                }}
              >
                Try again
              </Button>
              <span className="sr-only">
                {' '}
                {catalog.isError ? errorMessage(catalog.error) : errorMessage(permission.error)}
              </span>
            </div>
          ) : null}
          <section data-testid="marketplace-featured" aria-labelledby="featured-integrations">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id="featured-integrations" className="text-base font-bold text-heading">
                Featured Integrations
              </h2>
              <Button
                variant="ghost"
                className="min-h-8 !px-1 !py-0 text-xs"
                onClick={() => {
                  allHeadingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  allHeadingRef.current?.focus({ preventScroll: true });
                }}
              >
                View All
                <ArrowRight weight="fill" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {data?.featured.map((item) => (
                <MarketplaceCard
                  key={item.provider.provider}
                  item={item}
                  featured
                  canManage={canManage}
                  onDetails={setDetails}
                />
              ))}
            </div>
            {!data?.featured.length ? (
              <Card className="!rounded-lg !p-4">
                <p className="text-sm text-muted">
                  {catalog.isPending
                    ? 'Loading featured integrations...'
                    : catalog.isError
                      ? 'Featured integrations will appear when the connection is restored.'
                      : 'No featured integrations for this selection.'}
                </p>
              </Card>
            ) : null}
          </section>
          <section data-testid="marketplace-catalog" aria-labelledby="all-integrations">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <h2
                ref={allHeadingRef}
                tabIndex={-1}
                id="all-integrations"
                className="text-base font-bold text-heading focus-visible:outline-2 focus-visible:outline-focus"
              >
                All Integrations ({data?.total ?? 0})
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  label="Sort integrations"
                  hideLabel
                  value={sort}
                  onChange={(event) => setSort(IntegrationSort.parse(event.target.value))}
                  options={[
                    { value: 'popular', label: 'Sort by: Most Popular' },
                    { value: 'name', label: 'Sort by: Alphabetical' },
                    { value: 'category', label: 'Sort by: Category' },
                  ]}
                />
                <IconButton
                  icon={GridFour}
                  label="Grid view"
                  tone={view === 'grid' ? 'action' : 'neutral'}
                  aria-pressed={view === 'grid'}
                  onClick={() => setView('grid')}
                />
                <IconButton
                  icon={List}
                  label="List view"
                  tone={view === 'list' ? 'action' : 'neutral'}
                  aria-pressed={view === 'list'}
                  onClick={() => setView('list')}
                />
              </div>
            </div>
            <div className={`grid gap-3 ${view === 'grid' ? 'sm:grid-cols-2 xl:grid-cols-5' : ''}`}>
              {data?.items.map((item) => (
                <MarketplaceCard
                  key={item.provider.provider}
                  item={item}
                  canManage={canManage}
                  list={view === 'list'}
                  onDetails={setDetails}
                />
              ))}
              <Card
                data-testid="custom-integration"
                className="flex flex-col gap-2 !rounded-lg !border-dashed !border-action !bg-subtle !p-3"
              >
                <div className="flex items-start gap-2">
                  <Plus weight="fill" className="size-10 shrink-0 text-action" />
                  <div>
                    <h3 className="text-xs font-bold text-heading">Custom Integration</h3>
                    <p className="text-xs text-muted">Custom Integrations</p>
                  </div>
                </div>
                <p className="text-xs text-muted">
                  Request a custom integration for a tool not listed.
                </p>
                <Button
                  variant="outline"
                  className="mt-auto min-h-9 w-full !px-2 !py-1 text-xs"
                  disabled={!canManage}
                  onClick={() => setRequestOpen(true)}
                >
                  Request Integration
                </Button>
                {canManage ? (
                  <Link
                    className="text-xs font-medium text-link underline"
                    href="/integrations/custom_api/connect"
                  >
                    <Code weight="fill" className="mr-1 inline size-4" />
                    API &amp; Webhooks setup
                  </Link>
                ) : null}
              </Card>
            </div>
            {catalog.isPending ? (
              <div aria-hidden className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[0, 1, 2, 3, 4].map((key) => (
                  <Skeleton key={key} className="h-28 w-full rounded-lg" />
                ))}
              </div>
            ) : null}
            {!data?.items.length ? (
              <p
                data-testid="marketplace-empty"
                role="status"
                className="mt-3 rounded-lg border border-border bg-surface p-4 text-sm text-muted"
              >
                {emptyText}
              </p>
            ) : null}
          </section>
        </div>
      </div>
      <RequestIntegrationModal open={requestOpen} onClose={() => setRequestOpen(false)} />
      <Modal
        open={details !== null}
        onClose={() => setDetails(null)}
        title={details?.provider.name ?? 'Integration details'}
      >
        {details ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-heading">
              {categoryLabel(details.provider.category)}
            </p>
            <p className="text-sm text-muted">{details.provider.summary}</p>
            <MarketplaceAction item={details} canManage={canManage} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
