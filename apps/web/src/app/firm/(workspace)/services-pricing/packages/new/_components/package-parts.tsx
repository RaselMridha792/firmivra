'use client';

import { CheckCircle, Cube, Eye, PlusCircle, Trash } from '@phosphor-icons/react';
import type {
  CatalogServiceRow,
  CreateServicePackageRequest,
  ServiceCategory,
} from '@firmivra/types';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  IconButton,
  Input,
  Modal,
  Pagination,
  Select,
  Toggle,
} from '@firmivra/ui';
import { useDeferredValue, useState, type ReactNode } from 'react';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { PageState } from '../../../../../../../components/page-state';
import { CATALOG_ICONS, IconTile, money, tone } from '../../../_components/catalog-shared';

export function Panel({
  title,
  marker,
  action,
  children,
}: {
  title: string;
  marker: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-divider bg-surface"
      data-testid={`package-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 bg-table-head px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-action text-sm font-bold text-on-action">
            {marker}
          </span>
          <h2 className="text-sm font-bold text-heading">{title}</h2>
        </div>
        {action}
      </header>
      <div className="min-w-0 space-y-3 p-3">{children}</div>
    </section>
  );
}
export function PackageIcon({
  value,
  onChange,
}: {
  value?: string | null;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // The catalog's approved icon keys; a cube when there is none.
  const meta = value ? CATALOG_ICONS[value] : undefined;
  const Glyph = meta?.glyph ?? Cube;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Package Icon</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-16 items-center justify-center rounded-lg bg-info-soft text-action">
          <Glyph aria-hidden weight="fill" className="size-9" />
        </span>
        <div className="flex flex-col items-center">
          <Button variant="outline" onClick={() => setOpen(true)}>
            Change Icon
          </Button>
          <Button variant="ghost" className="underline" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      </div>
      <Modal open={open} title="Choose package icon" onClose={() => setOpen(false)}>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(CATALOG_ICONS).map(([key, choice]) => (
            <Button
              key={key}
              variant="secondary"
              aria-label={`Choose ${choice.label} icon`}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
            >
              <choice.glyph aria-hidden weight="fill" className="size-6" />
            </Button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

export function ServicePicker({
  open,
  onClose,
  selected,
  categories,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  selected: string[];
  categories: ServiceCategory[];
  onAdd: (row: CatalogServiceRow) => void;
}) {
  const [searchText, setSearchText] = useState('');
  const search = useDeferredValue(searchText);
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const query = useApiQuery(['services-pricing', 'picker', { search, categoryId, page }], () =>
    api.servicesPricing.services({
      status: 'active',
      search,
      categoryId: categoryId || undefined,
      page,
      pageSize: 8,
    }),
  );
  return (
    <Modal
      open={open}
      title="Add services"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Search active services"
            maxLength={100}
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setPage(1);
            }}
          />
          <Select
            label="Filter category"
            value={categoryId}
            options={[
              { value: '', label: 'All Categories' },
              ...categories
                .filter((c) => c.status === 'ACTIVE')
                .map((c) => ({ value: c.id, label: c.name })),
            ]}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <PageState
          query={query}
          isEmpty={(data) => !data.items.length}
          empty="No matching active services."
        >
          {(data) => (
            <div className="space-y-2">
              {data.items.map((row) => (
                <Card
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <p className="break-words font-semibold">{row.name}</p>
                    <p className="text-xs text-muted">
                      {row.category?.name} ·{' '}
                      {row.price.type === 'CUSTOM_QUOTE'
                        ? 'Quote required'
                        : money(row.price.amountCents)}
                    </p>
                    {row.price.type !== 'FIXED' && row.price.type !== 'RECURRING' ? (
                      <p className="text-xs text-warning">
                        Variable price: savings may be an estimate.
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    disabled={selected.includes(row.id) || selected.length >= 30}
                    onClick={() => onAdd(row)}
                    aria-label={`Add ${row.name}`}
                  >
                    {selected.includes(row.id) ? 'Already Added' : 'Add'}
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </PageState>
        <Pagination
          page={page}
          pageCount={Math.max(1, Math.ceil((query.data?.total ?? 0) / 8))}
          onPage={setPage}
        />
      </div>
    </Modal>
  );
}

export function PackagePreview({
  value,
  selected,
}: {
  value: CreateServicePackageRequest;
  selected: CatalogServiceRow[];
}) {
  const [full, setFull] = useState(false);
  const meta = value.icon ? CATALOG_ICONS[value.icon] : undefined;
  const Glyph = meta?.glyph ?? Cube;
  const content = (expanded: boolean) => (
    <Card
      className="min-w-0 space-y-4 p-4"
      data-testid={expanded ? 'package-full-preview' : 'package-client-preview'}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-info-soft text-action">
          <Glyph weight="fill" className="size-9" />
        </span>
        <div className="min-w-0">
          <h3 className="break-words font-display text-xl font-bold text-heading">
            {value.name || 'Package Preview'}
          </h3>
          <p className="text-xl font-bold text-action">{money(value.packagePriceCents)}</p>
          <p className="mt-1 break-words text-sm text-muted">
            {value.shortDescription || 'No package description yet.'}
          </p>
        </div>
      </div>
      <div>
        <h4 className="font-semibold text-heading">What&apos;s Included:</h4>
        {selected.length ? (
          <ul className="mt-2 space-y-2">
            {selected.map((row) => (
              <li key={row.id} className="flex gap-2 text-sm">
                <CheckCircle weight="fill" className="size-5 shrink-0 text-action" />
                <span className="break-words">{row.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No services selected.</p>
        )}
      </div>
      <div className="border-t border-divider pt-3">
        <h4 className="font-semibold text-heading">Optional Add-Ons:</h4>
        {value.addOns?.some((a) => a.offered) ? (
          <ul className="mt-2 space-y-2">
            {value.addOns
              .filter((a) => a.offered)
              .map((a, i) => (
                <li key={`${a.name}-${i}`} className="flex gap-2 text-sm">
                  <PlusCircle weight="fill" className="size-5 shrink-0 text-action" />
                  <span className="break-words">
                    {a.name} (+{money(a.priceCents)})
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No optional add-ons selected.</p>
        )}
      </div>
      <Button disabled className="w-full" title="Client checkout is not part of this staff preview">
        Get Started
      </Button>
    </Card>
  );
  return (
    <>
      <Panel
        title="Package Preview (Client View)"
        marker={<Eye weight="fill" className="size-4" />}
        action={
          <Button className="text-xs" variant="outline" onClick={() => setFull(true)}>
            <Eye aria-hidden weight="fill" className="size-4" />
            View Full Page
          </Button>
        }
      >
        {content(false)}
      </Panel>
      <Modal open={full} title="Package Preview (Client View)" onClose={() => setFull(false)}>
        {full ? content(true) : null}
      </Modal>
    </>
  );
}

export function SelectedServices({
  rows,
  onRemove,
  onToggle,
  onToggleAll,
}: {
  rows: { row: CatalogServiceRow; included: boolean }[];
  onRemove: (id: string) => void;
  onToggle: (id: string, included: boolean) => void;
  onToggleAll: (included: boolean) => void;
}) {
  const allIncluded = rows.length > 0 && rows.every((r) => r.included);
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-12 items-center gap-2 border-b border-divider pb-2 text-xs font-semibold text-heading lg:grid">
        <span className="col-span-5 flex items-center gap-1">
          <Checkbox
            label=""
            aria-label="Include every service"
            checked={allIncluded}
            disabled={!rows.length}
            onChange={(e) => onToggleAll(e.target.checked)}
          />
          Service Name
        </span>
        <span className="col-span-2">Category</span>
        <span className="col-span-2">Individual Price</span>
        <span className="col-span-2">Included in Package</span>
        <span className="text-right">Actions</span>
      </div>
      {rows.length ? (
        rows.map(({ row, included }) => (
          <div
            key={row.id}
            className="grid min-w-0 gap-2 border-b border-divider pb-2 lg:grid-cols-12 lg:items-center"
            data-testid="selected-package-service"
          >
            <div className="flex min-w-0 items-center gap-1 lg:col-span-5">
              <Checkbox
                label=""
                aria-label={`Include ${row.name}`}
                checked={included}
                onChange={(e) => onToggle(row.id, e.target.checked)}
              />
              <IconTile icon={row.icon} />
              <span className="ml-2 min-w-0 break-words text-sm text-heading">{row.name}</span>
            </div>
            <span className="lg:col-span-2">
              <Badge tone={tone(row.category?.tone)}>{row.category?.name ?? 'Uncategorized'}</Badge>
            </span>
            <span className="text-sm lg:col-span-2">
              {row.price.type === 'CUSTOM_QUOTE' ? 'Quote required' : money(row.price.amountCents)}
            </span>
            <span className="flex items-center gap-2 text-sm lg:col-span-2">
              <Toggle
                label={`Included in package: ${row.name}`}
                checked={included}
                onChange={(next) => onToggle(row.id, next)}
              />
              {included ? 'Yes' : 'No'}
            </span>
            <IconButton
              icon={Trash}
              tone="danger"
              label={`Remove ${row.name}`}
              className="justify-self-start lg:justify-self-end"
              onClick={() => onRemove(row.id)}
            />
          </div>
        ))
      ) : (
        <p className="py-4 text-sm text-muted">
          No services added. Choose Add Service to build this package.
        </p>
      )}
    </div>
  );
}
