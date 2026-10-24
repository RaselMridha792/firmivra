'use client';

import type {
  CatalogServiceRow,
  DiscountType,
  PackageService,
  ServicePackage,
  UpdateServicePackageRequest,
} from '@firmivra/types';
import { Badge, Button, Checkbox, Modal, Select, Textarea, Toast, Toggle } from '@firmivra/ui';
import { ArrowLeft, Plus, Trash, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  CATALOG_ERRORS,
  CATALOG_ICONS,
  CATALOG_KEY,
  IconTile,
  PRICING_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  money,
  tone,
} from './catalog-shared';
import {
  PackagePreview,
  Panel,
  QuoteRequiredNote,
  selectedTotal,
  ViewFullPage,
  type PreviewData,
} from './package-parts';

const field =
  'min-h-10 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500';
const toCents = (dollars: string) => {
  const n = Number(dollars);
  return dollars.trim() === '' || Number.isNaN(n) || n < 0 ? null : Math.round(n * 100);
};
const dollars = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '' : String(cents / 100);

interface AddOnRow {
  key: string;
  id?: string;
  name: string;
  description: string;
  price: string;
  offered: boolean;
}

/** /services-pricing/packages/[id]/edit: the Package Builder in Edit mode. */
export function PackageEditScreen({ id }: { id: string }) {
  const query = useApiQuery([...CATALOG_KEY, 'package', id], () => api.servicesPricing.package(id));
  return query.data ? (
    <Builder key={query.data.version} pkg={query.data} id={id} />
  ) : (
    <Builder
      key="blank"
      pkg={undefined}
      id={id}
      loadNote={
        query.isPending ? 'Loading the package…' : errorMessage(query.error, CATALOG_ERRORS)
      }
    />
  );
}

function Builder({
  pkg,
  id,
  loadNote,
}: {
  pkg: ServicePackage | undefined;
  id: string;
  loadNote?: string;
}) {
  const router = useRouter();
  const categories = useApiQuery([...CATALOG_KEY, 'categories'], () =>
    api.servicesPricing.categories(),
  );
  const [name, setName] = useState(pkg?.name ?? '');
  const [categoryId, setCategoryId] = useState(pkg?.category?.id ?? '');
  const [description, setDescription] = useState(pkg?.shortDescription ?? '');
  const [icon, setIcon] = useState(pkg?.icon ?? '');
  const [services, setServices] = useState<PackageService[]>(pkg?.services ?? []);
  const [price, setPrice] = useState(dollars(pkg?.packagePriceCents));
  const [discountType, setDiscountType] = useState<DiscountType>(
    pkg?.pricing.discountType ?? 'NONE',
  );
  const [discountValue, setDiscountValue] = useState(
    pkg?.pricing.discountValue == null ? '' : String(pkg.pricing.discountValue / 100),
  );
  const [addOns, setAddOns] = useState<AddOnRow[]>(
    (pkg?.addOns ?? []).map((a) => ({
      key: a.id,
      id: a.id,
      name: a.name,
      description: a.description ?? '',
      price: dollars(a.priceCents),
      offered: a.offered,
    })),
  );
  const [visible, setVisible] = useState(pkg?.visibleToClients ?? true);
  const [allowAddOns, setAllowAddOns] = useState(pkg?.allowClientAddOns ?? true);
  const [website, setWebsite] = useState(pkg?.displayOnWebsite ?? false);
  const [notes, setNotes] = useState(pkg?.internalNotes ?? '');
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [nextKey, setNextKey] = useState(0);

  const priceCents = toCents(price);
  const discountCents =
    discountType === 'NONE'
      ? null
      : discountType === 'PERCENTAGE'
        ? Math.round(Number(discountValue || 0) * 100)
        : toCents(discountValue);
  const pricing = useApiQuery(
    [
      ...CATALOG_KEY,
      'pricing',
      services.map((s) => `${s.serviceId}:${s.included}`).join(','),
      priceCents,
      discountType,
      discountCents,
    ],
    async () =>
      services.length === 0
        ? null
        : api.servicesPricing.packagePricing({
            services: services.map((s) => ({ serviceId: s.serviceId, included: s.included })),
            packagePriceCents: priceCents,
            discountType,
            discountValue: discountCents,
          }),
  );
  const panel = pricing.data;
  const included = services.filter((s) => s.included);
  const preview: PreviewData = {
    name,
    icon: icon || null,
    // The price the API works out (a discount alone sets it), else the one typed.
    priceCents: panel?.packagePriceCents ?? priceCents,
    description,
    included: included.map((s) => ({
      name: s.name,
      quoteRequired: s.pricingType === 'CUSTOM_QUOTE',
    })),
    addOns: addOns
      .filter((a) => a.offered && a.name.trim())
      .map((a) => ({
        name: a.name.trim(),
        priceCents: toCents(a.price) ?? 0,
        description: a.description.trim() || null,
      })),
    allowClientAddOns: allowAddOns,
  };

  const body = (): UpdateServicePackageRequest => ({
    version: pkg?.version ?? '',
    name: name.trim(),
    categoryId,
    shortDescription: description.trim(),
    icon: icon || null,
    services: services.map((s) => ({ serviceId: s.serviceId, included: s.included })),
    packagePriceCents: priceCents,
    discountType,
    discountValue: discountType === 'NONE' ? null : discountCents,
    addOns: addOns
      .filter((a) => a.name.trim())
      .map((a) => ({
        ...(a.id ? { id: a.id } : {}),
        name: a.name.trim(),
        description: a.description,
        priceCents: toCents(a.price) ?? 0,
        offered: a.offered,
      })),
    visibleToClients: visible,
    allowClientAddOns: allowAddOns,
    displayOnWebsite: website,
    internalNotes: notes,
  });
  const options = { invalidate: [...CATALOG_KEY] };
  const save = useApiMutation(async (activate: boolean) => {
    const saved = await api.servicesPricing.updatePackage(id, body());
    return activate ? api.servicesPricing.activatePackage(saved.id) : saved;
  }, options);
  const ready = !!pkg && name.trim() !== '' && categoryId !== '';
  const submit = (activate: boolean) =>
    save.mutate(activate, {
      onSuccess: () => router.push(`/services-pricing/packages/${id}`),
      onError: (e) => setMessage({ text: errorMessage(e, CATALOG_ERRORS), tone: 'error' }),
    });

  const setService = (serviceId: string, change: Partial<PackageService>) =>
    setServices((list) => list.map((s) => (s.serviceId === serviceId ? { ...s, ...change } : s)));
  const setAddOn = (key: string, change: Partial<AddOnRow>) =>
    setAddOns((list) => list.map((a) => (a.key === key ? { ...a, ...change } : a)));
  const allIncluded = services.length > 0 && services.every((s) => s.included);

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="package-builder">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/services-pricing" className="text-link">
          Services &amp; Pricing
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <Link href="/services-pricing/packages" className="text-link">
          Package Builder
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Edit Package</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <IconTile icon={icon || null} size="lg" />
          <div>
            <h1 className="font-display text-3xl font-bold text-heading">Edit Package</h1>
            <p className="text-base text-muted">
              Combine services, set a package price, and offer optional add-ons.
            </p>
          </div>
        </div>
        <Link
          href="/services-pricing/packages"
          className="inline-flex min-h-10 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Packages
        </Link>
      </header>
      {loadNote ? (
        <p role="status" className="rounded-xl bg-surface px-4 py-3 text-sm text-muted shadow-md">
          {loadNote}
        </p>
      ) : null}
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="Package Information"
            step={1}
            testId="builder-info"
            aside={
              pkg ? <Badge tone={STATUS_TONE[pkg.status]}>{STATUS_LABEL[pkg.status]}</Badge> : null
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-text">
                <span>
                  Package Name <span className="text-danger">*</span>
                </span>
                <input
                  className={field}
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <Select
                label="Package Category *"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                options={[
                  {
                    value: '',
                    label: categories.isError ? 'Categories are not available' : 'Select category',
                  },
                  ...(categories.data ?? [])
                    .filter((c) => c.status === 'ACTIVE' || c.id === categoryId)
                    .map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <div className="md:col-span-2">
                <Textarea
                  label="Short Description *"
                  rows={2}
                  maxLength={200}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <p className="text-right text-xs text-muted">{description.length}/200</p>
              </div>
              <Select
                label="Package Icon"
                value={icon}
                onChange={(event) => setIcon(event.target.value)}
                options={[
                  { value: '', label: 'No icon' },
                  ...Object.entries(CATALOG_ICONS).map(([value, m]) => ({
                    value,
                    label: m.label,
                  })),
                ]}
              />
            </div>
          </Panel>

          <Panel
            title="Select Services to Include"
            step={2}
            testId="builder-services"
            aside={
              <Button variant="secondary" onClick={() => setPicking(true)}>
                <Plus aria-hidden weight="bold" className="size-4" /> Add Service
              </Button>
            }
          >
            {services.length === 0 ? (
              <p className="rounded-lg bg-canvas p-6 text-center text-sm text-muted">
                {pkg ? 'No services yet. Add the first one.' : (loadNote ?? 'No services yet.')}
              </p>
            ) : (
              <div className="relative overflow-x-auto rounded-lg border border-divider">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Services in the package</caption>
                  <thead className="bg-table-head text-heading">
                    <tr>
                      <th className="px-3 py-2">
                        <Checkbox
                          label="Include every service"
                          checked={allIncluded}
                          onChange={(event) =>
                            setServices((list) =>
                              list.map((s) => ({ ...s, included: event.target.checked })),
                            )
                          }
                          className="min-h-0 [&>span]:sr-only"
                        />
                      </th>
                      <th className="px-3 py-2 font-semibold">Service Name</th>
                      <th className="px-3 py-2 font-semibold">Category</th>
                      <th className="px-3 py-2 font-semibold">Individual Price</th>
                      <th className="px-3 py-2 font-semibold">Included in Package</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody data-testid="builder-service-rows">
                    {services.map((s) => (
                      <tr key={s.serviceId} className="border-t border-divider">
                        <td className="px-3 py-2">
                          <Checkbox
                            label={`Include ${s.name}`}
                            checked={s.included}
                            onChange={(event) =>
                              setService(s.serviceId, { included: event.target.checked })
                            }
                            className="min-h-0 [&>span]:sr-only"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <IconTile icon={s.icon} />
                            <span className="text-heading" data-testid="builder-service-name">
                              {s.name}
                            </span>
                            {s.inactive ? (
                              <Badge tone="warning" icon={Warning}>
                                Inactive
                              </Badge>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {s.category ? (
                            <Badge tone={tone(s.category.tone)}>{s.category.name}</Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2 text-heading">
                          {s.individualPriceCents === null
                            ? 'Quote required'
                            : money(s.individualPriceCents)}
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2 text-heading">
                            <Toggle
                              label={`${s.name} included in the package`}
                              checked={s.included}
                              onChange={(included) => setService(s.serviceId, { included })}
                            />
                            {s.included ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            aria-label={`Remove ${s.name} from the package`}
                            title="Remove from the package (the service is kept)"
                            onClick={() =>
                              setServices((list) => list.filter((x) => x.serviceId !== s.serviceId))
                            }
                            className="inline-flex size-9 items-center justify-center rounded-lg border border-divider text-danger hover:bg-canvas"
                          >
                            <Trash aria-hidden weight="fill" className="size-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Package Pricing" step={3} testId="builder-pricing">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-sm font-medium text-text">Total of Selected Services</p>
                <p
                  className="mt-1 rounded-control bg-disabled px-3 py-2 text-xl font-bold text-heading"
                  data-testid="builder-total"
                >
                  {services.length === 0 ? money(0) : selectedTotal(panel)}
                </p>
                <p className="mt-1 text-xs text-muted">Based on current individual prices.</p>
              </div>
              <label className="flex flex-col gap-1 text-sm font-medium text-text">
                <span>
                  Package Price <span className="text-danger">*</span>
                </span>
                <span className="flex items-center rounded-control border border-border bg-surface">
                  <span className="px-3 text-muted">$</span>
                  <input
                    aria-label="Package price"
                    className="min-h-10 w-full bg-transparent pr-3 text-base text-heading outline-none"
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </span>
              </label>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-text">Discount (Optional)</p>
                <div className="grid grid-cols-[1fr_1fr] gap-2">
                  <Select
                    label="Discount type"
                    hideLabel
                    value={discountType}
                    onChange={(event) => setDiscountType(event.target.value as DiscountType)}
                    options={[
                      { value: 'NONE', label: 'None' },
                      { value: 'PERCENTAGE', label: 'Percentage' },
                      { value: 'FIXED', label: 'Fixed Amount' },
                    ]}
                  />
                  <input
                    aria-label="Discount value"
                    className={field}
                    inputMode="decimal"
                    disabled={discountType === 'NONE'}
                    value={discountValue}
                    onChange={(event) => setDiscountValue(event.target.value)}
                  />
                </div>
                <p
                  className="rounded-control bg-success-soft px-3 py-2 text-center text-sm font-semibold text-success"
                  data-testid="builder-savings"
                >
                  Client Savings:{' '}
                  {panel && panel.savingsCents !== null
                    ? `${money(panel.savingsCents)}${panel.savingsPercent === null ? '' : ` (${panel.savingsPercent}%)`}`
                    : '—'}
                </p>
              </div>
            </div>
            {panel?.quoteRequired ? (
              <QuoteRequiredNote />
            ) : panel?.variablePrice ? (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-warning-soft p-3 text-sm text-text">
                <Warning aria-hidden weight="fill" className="size-5 shrink-0 text-gold" />A
                Starting At, Hourly or Custom Quote service is included, so the savings are an
                estimate.
              </p>
            ) : null}
            {pricing.isError ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {errorMessage(pricing.error, CATALOG_ERRORS)}
              </p>
            ) : null}
          </Panel>

          <Panel
            title="Optional Add-Ons (Client Can Choose)"
            step={4}
            testId="builder-addons"
            aside={
              <Button
                variant="secondary"
                onClick={() => {
                  setNextKey(nextKey + 1);
                  setAddOns([
                    ...addOns,
                    { key: `new-${nextKey}`, name: '', description: '', price: '', offered: true },
                  ]);
                }}
              >
                <Plus aria-hidden weight="bold" className="size-4" /> Add Add-On
              </Button>
            }
          >
            {addOns.length === 0 ? (
              <p className="rounded-lg bg-canvas p-6 text-center text-sm text-muted">
                No add-ons yet. Add one to offer an optional extra.
              </p>
            ) : (
              <div className="relative overflow-x-auto rounded-lg border border-divider">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Optional add-ons</caption>
                  <thead className="bg-table-head text-heading">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Offered</th>
                      <th className="px-3 py-2 font-semibold">Add-On Name *</th>
                      <th className="px-3 py-2 font-semibold">Description</th>
                      <th className="px-3 py-2 font-semibold">Price</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody data-testid="builder-addon-rows">
                    {addOns.map((a, i) => (
                      <tr key={a.key} className="border-t border-divider">
                        <td className="px-3 py-2">
                          <Checkbox
                            label={`Offer add-on ${i + 1}`}
                            checked={a.offered}
                            onChange={(event) => setAddOn(a.key, { offered: event.target.checked })}
                            className="min-h-0 [&>span]:sr-only"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            aria-label={`Add-on ${i + 1} name`}
                            className={field}
                            value={a.name}
                            maxLength={120}
                            onChange={(event) => setAddOn(a.key, { name: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            aria-label={`Add-on ${i + 1} description`}
                            className={field}
                            value={a.description}
                            maxLength={300}
                            onChange={(event) =>
                              setAddOn(a.key, { description: event.target.value })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            aria-label={`Add-on ${i + 1} price`}
                            className={`${field} w-28!`}
                            inputMode="decimal"
                            value={a.price}
                            onChange={(event) => setAddOn(a.key, { price: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            aria-label={`Delete add-on ${i + 1}`}
                            onClick={() => setAddOns(addOns.filter((x) => x.key !== a.key))}
                            className="inline-flex size-9 items-center justify-center rounded-lg border border-divider text-danger hover:bg-canvas"
                          >
                            <Trash aria-hidden weight="fill" className="size-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Preview and settings">
          <Panel
            title="Package Preview (Client View)"
            testId="builder-preview"
            aside={<ViewFullPage data={preview} />}
          >
            <PackagePreview data={preview} />
          </Panel>
          <Panel title="Internal Notes (Not Visible to Clients)" testId="builder-notes">
            <Textarea
              label="Internal notes"
              rows={3}
              maxLength={500}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
            <p className="text-right text-xs text-muted">{notes.length}/500</p>
          </Panel>
          <Panel title="Package Settings" testId="builder-settings">
            <ul className="flex flex-col gap-3 text-sm text-heading">
              {(
                [
                  ['Visible to Clients', visible, setVisible],
                  ['Allow Client to Add Optional Add-Ons', allowAddOns, setAllowAddOns],
                  ['Display on Website/Portal', website, setWebsite],
                ] as const
              ).map(([label, on, set]) => (
                <li key={label} className="flex items-center justify-between gap-3">
                  {label}
                  <span className="flex items-center gap-2">
                    <Toggle label={label} checked={on} onChange={set} />
                    {on ? 'Yes' : 'No'}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button variant="secondary" onClick={() => router.push(`/services-pricing/packages/${id}`)}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          disabled={!ready || save.isPending}
          onClick={() => submit(false)}
          data-testid="package-save"
        >
          Save Changes
        </Button>
        <Button
          disabled={!ready || save.isPending}
          onClick={() => submit(true)}
          data-testid="package-save-activate"
        >
          Save &amp; Activate
        </Button>
      </div>
      {picking ? (
        <ServicePicker
          taken={services.map((s) => s.serviceId)}
          onClose={() => setPicking(false)}
          onPick={(rows) => {
            setServices((list) => [
              ...list,
              ...rows.map((r): PackageService => ({
                serviceId: r.id,
                name: r.name,
                icon: r.icon,
                category: r.category,
                individualPriceCents: r.price.amountCents,
                pricingType: r.price.type,
                included: true,
                inactive: r.status !== 'ACTIVE',
              })),
            ]);
            setPicking(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** Add Service: active services not yet in the package, searchable by name and category. */
function ServicePicker({
  taken,
  onClose,
  onPick,
}: {
  taken: string[];
  onClose: () => void;
  onPick: (rows: CatalogServiceRow[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [chosen, setChosen] = useState<CatalogServiceRow[]>([]);
  const term = useDeferredValue(search.trim());
  const categories = useApiQuery([...CATALOG_KEY, 'categories'], () =>
    api.servicesPricing.categories(),
  );
  const services = useApiQuery([...CATALOG_KEY, 'picker', term, categoryId], () =>
    api.servicesPricing.services({
      status: 'active',
      pageSize: 50,
      ...(term ? { search: term } : {}),
      ...(categoryId ? { categoryId } : {}),
    }),
  );
  const rows = services.data?.items ?? [];
  const variable = chosen.some((r) => r.price.type !== 'FIXED' && r.price.type !== 'RECURRING');
  return (
    <Modal
      open
      title="Add Service"
      subtitle="Only active services can be added. Each service appears once."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={chosen.length === 0} onClick={() => onPick(chosen)}>
            Done{chosen.length ? ` (${chosen.length})` : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-text">
            Search services
            <input
              className={field}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name…"
            />
          </label>
          <Select
            label="Category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            options={[
              { value: '', label: 'All Categories' },
              ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <ul className="max-h-72 divide-y divide-divider overflow-y-auto rounded-lg border border-divider">
          {rows.length === 0 ? (
            <li className="p-4 text-center text-sm text-muted">
              {services.isPending
                ? 'Loading…'
                : services.isError
                  ? 'Services are not available right now.'
                  : 'No active service matches.'}
            </li>
          ) : (
            rows.map((r) => {
              const already = taken.includes(r.id);
              return (
                <li key={r.id} className="flex items-center gap-3 p-3">
                  <Checkbox
                    label={r.name}
                    disabled={already}
                    checked={already || chosen.some((c) => c.id === r.id)}
                    onChange={(event) =>
                      setChosen(
                        event.target.checked ? [...chosen, r] : chosen.filter((c) => c.id !== r.id),
                      )
                    }
                    className="min-h-0 flex-1"
                  />
                  <span className="text-xs text-muted">
                    {already ? 'Already added' : PRICING_LABEL[r.price.type]}
                  </span>
                  <span className="text-sm text-heading">
                    {r.price.amountCents === null ? 'Quote' : money(r.price.amountCents)}
                  </span>
                </li>
              );
            })
          )}
        </ul>
        {variable ? (
          <p className="flex items-center gap-2 rounded-lg bg-warning-soft p-3 text-sm text-text">
            <Warning aria-hidden weight="fill" className="size-5 shrink-0 text-gold" />A Starting
            At, Hourly or Custom Quote service means the savings cannot be guaranteed.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
