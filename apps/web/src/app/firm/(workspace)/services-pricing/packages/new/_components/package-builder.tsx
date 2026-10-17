'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreateServicePackageRequest,
  type CatalogServiceRow,
  type PackagePricingRequest,
} from '@firmivra/types';
import { Button, Input, Modal, Select, Textarea, Toggle } from '@firmivra/ui';
import { ArrowLeft, Cube, FileText, Gear, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useMemo, useState } from 'react';
import {
  useFieldArray,
  useForm,
  useWatch,
  type FieldPath,
  type FieldPathValue,
} from 'react-hook-form';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import {
  money,
  PackageIcon,
  PackagePreview,
  Panel,
  SelectedServices,
  ServicePicker,
} from './package-parts';

type Values = CreateServicePackageRequest;
type AddOn = NonNullable<Values['addOns']>[number];
const blankAddon: AddOn = { name: '', description: '', priceCents: 0, offered: true };
export function PackageBuilder() {
  const router = useRouter();
  const categories = useApiQuery(['services-pricing', 'categories'], () =>
    api.servicesPricing.categories(),
  );
  const form = useForm<Values, unknown, ReturnType<typeof CreateServicePackageRequest.parse>>({
    resolver: zodResolver(CreateServicePackageRequest),
    defaultValues: {
      name: '',
      categoryId: '',
      shortDescription: '',
      icon: 'briefcase',
      services: [],
      packagePriceCents: 0,
      discountType: 'NONE',
      discountValue: null,
      addOns: [],
      visibleToClients: true,
      allowClientAddOns: true,
      displayOnWebsite: true,
      internalNotes: '',
      activate: false,
    },
  });
  const {
    register,
    control,
    setValue,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = form;
  const value = useWatch({ control }) as Values;
  const addonFields = useFieldArray({ control, name: 'addOns' });
  const [knownServices, setKnownServices] = useState<Record<string, CatalogServiceRow>>({});
  const [picker, setPicker] = useState(false);
  const [active, setActive] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [addon, setAddon] = useState<{ index: number | null; value: AddOn } | null>(null);
  const [addonError, setAddonError] = useState('');
  const put = <K extends FieldPath<Values>>(key: K, next: FieldPathValue<Values, K>) =>
    setValue(key, next, { shouldDirty: true, shouldValidate: true });
  const pricingInput = useMemo<PackagePricingRequest>(
    () => ({
      services: (value.services ?? []).map((s) => ({
        serviceId: s.serviceId,
        included: s.included ?? true,
      })),
      packagePriceCents: value.packagePriceCents ?? null,
      discountType: value.discountType ?? 'NONE',
      discountValue: value.discountValue ?? null,
    }),
    [value.services, value.packagePriceCents, value.discountType, value.discountValue],
  );
  const deferredPricing = useDeferredValue(pricingInput);
  const pricing = useApiQuery(['services-pricing', 'package-pricing', deferredPricing], () =>
    api.servicesPricing.packagePricing(deferredPricing),
  );
  const totals = pricing.isError ? undefined : pricing.data;
  const rows = (value.services ?? []).flatMap((item) => {
    const row = knownServices[item.serviceId];
    return row ? [{ row, included: item.included ?? true }] : [];
  });
  const save = useApiMutation((body: Values) => api.servicesPricing.createPackage(body), {
    invalidate: ['services-pricing'],
  });
  const submit = (activate: boolean) => {
    setValue('activate', activate);
    void handleSubmit((body) =>
      save.mutate(body, {
        onSuccess: () => {
          reset(body);
          router.push('/services-pricing/packages');
        },
      }),
    )();
  };
  const back = () => (isDirty ? setCancel(true) : router.push('/services-pricing/packages'));
  const saveAddon = () => {
    if (!addon) return;
    const validation = CreateServicePackageRequest.shape.addOns.safeParse([addon.value]);
    if (!validation.success) {
      setAddonError(validation.error.issues.map((i) => i.message).join('. '));
      return;
    }
    if (addon.index === null) addonFields.append(addon.value);
    else addonFields.update(addon.index, addon.value);
    setAddon(null);
  };
  return (
    <div className="min-w-0 space-y-4" data-testid="package-builder-page">
      <header className="space-y-4">
        <nav aria-label="Breadcrumb" className="text-sm text-action">
          <Link href="/services-pricing">Services &amp; Pricing</Link>
          <span className="mx-2 text-muted">›</span>
          <Link href="/services-pricing/packages">Package Builder</Link>
          <span className="mx-2 text-muted">›</span>
          <span className="text-heading">Create Package</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-action text-on-action">
              <Cube weight="fill" className="size-9" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
                Create Package
              </h1>
              <p className="mt-1 text-muted">
                Combine services, set a package price, and offer optional add-ons.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={back}>
            <ArrowLeft className="size-4" />
            Back to Packages
          </Button>
        </div>
      </header>
      <form
        className="grid min-w-0 items-start gap-3 xl:grid-cols-3"
        data-testid="package-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(active);
        }}
      >
        <div className="min-w-0 space-y-3 xl:col-span-2">
          <Panel title="Package Information" marker={1}>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="min-w-0 space-y-3 md:col-span-2">
                <Input
                  label="Package Name *"
                  {...register('name')}
                  error={errors.name?.message}
                  data-testid="package-name"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label="Package Category *"
                    {...register('categoryId')}
                    options={[
                      { value: '', label: 'Select category' },
                      ...(categories.data ?? [])
                        .filter((c) => c.status === 'ACTIVE')
                        .map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    error={errors.categoryId?.message}
                    data-testid="package-category"
                  />
                  <div>
                    <Textarea
                      label="Short Description *"
                      maxLength={200}
                      rows={3}
                      {...register('shortDescription')}
                      error={errors.shortDescription?.message}
                    />
                    <p className="text-right text-xs text-muted">
                      {value.shortDescription?.length ?? 0}/200
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium">Status</p>
                <div className="flex items-center gap-2">
                  <Toggle label="Active package" checked={active} onChange={setActive} />
                  <span className="text-sm">{active ? 'Active' : 'Draft'}</span>
                </div>
                <PackageIcon value={value.icon} onChange={(next) => put('icon', next)} />
              </div>
            </div>
            {categories.isError || categories.isPending ? (
              <PageState query={categories}>{() => null}</PageState>
            ) : null}
          </Panel>
          <Panel
            title="Select Services to Include"
            marker={2}
            action={
              <Button variant="outline" onClick={() => setPicker(true)}>
                <Plus className="size-4" />
                Add Service
              </Button>
            }
          >
            <SelectedServices
              rows={rows}
              onRemove={(id) =>
                put(
                  'services',
                  (value.services ?? []).filter((s) => s.serviceId !== id),
                )
              }
              onToggle={(id, included) =>
                put(
                  'services',
                  (value.services ?? []).map((s) => (s.serviceId === id ? { ...s, included } : s)),
                )
              }
            />
          </Panel>
          <Panel title="Package Pricing" marker={3}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-sm font-medium">Total of Selected Services</p>
                <p
                  className="mt-2 rounded-control bg-disabled px-3 py-2 text-xl font-bold text-heading"
                  data-testid="package-total"
                >
                  {money(totals?.totalSelectedCents)}
                </p>
                <p className="mt-1 text-xs text-muted">Based on current individual prices.</p>
              </div>
              <Input
                label="Package Price *"
                type="number"
                min={0}
                step="0.01"
                value={value.packagePriceCents == null ? '' : value.packagePriceCents / 100}
                onChange={(e) =>
                  put(
                    'packagePriceCents',
                    e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                  )
                }
                error={errors.packagePriceCents?.message}
                data-testid="package-price"
              />
              <div className="space-y-2">
                <Select
                  label="Discount (Optional)"
                  value={value.discountType ?? 'NONE'}
                  options={[
                    { value: 'NONE', label: 'None' },
                    { value: 'PERCENTAGE', label: 'Percentage' },
                    { value: 'FIXED', label: 'Fixed Amount' },
                  ]}
                  onChange={(e) => {
                    put('discountType', e.target.value as Values['discountType']);
                    put('discountValue', e.target.value === 'NONE' ? null : 0);
                  }}
                />
                {value.discountType !== 'NONE' ? (
                  <Input
                    label={
                      value.discountType === 'PERCENTAGE'
                        ? 'Discount percentage'
                        : 'Discount amount'
                    }
                    type="number"
                    min={0}
                    max={value.discountType === 'PERCENTAGE' ? 100 : undefined}
                    step="0.01"
                    value={(value.discountValue ?? 0) / 100}
                    onChange={(e) => put('discountValue', Math.round(Number(e.target.value) * 100))}
                  />
                ) : null}
              </div>
            </div>
            <p
              className="rounded-control bg-success-soft px-3 py-2 text-center text-sm text-success"
              data-testid="package-savings"
            >
              Client Savings: {money(totals?.savingsCents)}
              {totals?.savingsPercent != null ? ` (${totals.savingsPercent}%)` : ''}
            </p>
            {totals?.variablePrice ? (
              <p role="status" className="text-sm text-warning">
                Variable-price services are included. Savings are an estimate, not guaranteed.
              </p>
            ) : null}
            <PageState query={pricing}>{() => null}</PageState>
          </Panel>
          <Panel
            title="Optional Add-Ons (Client Can Choose)"
            marker={4}
            action={
              <Button
                variant="outline"
                disabled={addonFields.fields.length >= 30}
                onClick={() => {
                  setAddonError('');
                  setAddon({ index: null, value: { ...blankAddon } });
                }}
              >
                + Add Add-On
              </Button>
            }
          >
            <div className="hidden grid-cols-12 gap-2 border-b border-divider pb-2 text-xs font-semibold text-heading md:grid">
              <span className="col-span-4">Add-On Name</span>
              <span className="col-span-4">Description</span>
              <span className="col-span-2">Price</span>
              <span className="col-span-2">Actions</span>
            </div>
            {addonFields.fields.length ? (
              addonFields.fields.map((field, i) => {
                const item = value.addOns?.[i];
                return (
                  <div
                    key={field.id}
                    className="grid min-w-0 gap-2 border-b border-divider pb-2 text-sm md:grid-cols-12 md:items-center"
                    data-testid="package-addon-row"
                  >
                    <div className="flex min-w-0 items-center gap-2 md:col-span-4">
                      <Toggle
                        label={`Offer ${item?.name ?? 'add-on'}`}
                        checked={!!item?.offered}
                        onChange={(next) => put(`addOns.${i}.offered`, next)}
                      />
                      <span className="break-words">{item?.name}</span>
                    </div>
                    <p className="break-words text-muted md:col-span-4">{item?.description}</p>
                    <span className="md:col-span-2">{money(item?.priceCents)}</span>
                    <div className="flex gap-1 md:col-span-2">
                      <Button
                        variant="ghost"
                        className="px-2"
                        aria-label={`Edit add-on ${i + 1}`}
                        onClick={() => {
                          setAddonError('');
                          if (item) setAddon({ index: i, value: item });
                        }}
                      >
                        <PencilSimple weight="fill" className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2 text-danger"
                        aria-label={`Remove add-on ${i + 1}`}
                        onClick={() => addonFields.remove(i)}
                      >
                        <Trash weight="fill" className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="py-3 text-sm text-muted">No optional add-ons added.</p>
            )}
          </Panel>
        </div>
        <aside className="min-w-0 space-y-3">
          <PackagePreview
            value={{
              ...value,
              packagePriceCents: totals?.packagePriceCents ?? value.packagePriceCents,
            }}
            selected={rows.filter((s) => s.included).map((s) => s.row)}
          />
          <Panel
            title="Internal Notes (Not Visible to Clients)"
            marker={<FileText weight="fill" className="size-4" />}
          >
            <Textarea
              label="Internal Notes"
              rows={4}
              maxLength={500}
              {...register('internalNotes')}
              error={errors.internalNotes?.message}
              data-testid="package-internal-notes"
            />
            <p className="text-right text-xs text-muted">{value.internalNotes?.length ?? 0}/500</p>
          </Panel>
          <Panel title="Package Settings" marker={<Gear weight="fill" className="size-4" />}>
            {[
              { key: 'visibleToClients', label: 'Visible to Clients' },
              { key: 'allowClientAddOns', label: 'Allow Client to Add Optional Add-Ons' },
              { key: 'displayOnWebsite', label: 'Display on Website/Portal' },
            ].map((setting) => (
              <div key={setting.key} className="flex items-center justify-between gap-3 text-sm">
                <span>{setting.label}</span>
                <Toggle
                  label={setting.label}
                  checked={
                    !!value[
                      setting.key as 'visibleToClients' | 'allowClientAddOns' | 'displayOnWebsite'
                    ]
                  }
                  onChange={(next) =>
                    put(
                      setting.key as 'visibleToClients' | 'allowClientAddOns' | 'displayOnWebsite',
                      next,
                    )
                  }
                />
              </div>
            ))}
          </Panel>
          {save.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(save.error)}
            </p>
          ) : null}
          {Object.keys(errors).length ? (
            <p role="alert" className="text-sm text-danger">
              Check the highlighted fields before saving.
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={back}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={save.isPending}
              onClick={() => submit(false)}
              data-testid="package-save-draft"
            >
              Save as Draft
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() => submit(true)}
              data-testid="package-save-activate"
            >
              {save.isPending ? 'Saving…' : 'Save & Activate'}
            </Button>
          </div>
        </aside>
      </form>
      <ServicePicker
        open={picker}
        onClose={() => setPicker(false)}
        selected={(value.services ?? []).map((s) => s.serviceId)}
        categories={categories.data ?? []}
        onAdd={(row) => {
          if (value.services?.some((s) => s.serviceId === row.id)) return;
          setKnownServices((current) => ({ ...current, [row.id]: row }));
          put('services', [...(value.services ?? []), { serviceId: row.id, included: true }]);
        }}
      />
      <Modal
        open={cancel}
        title="Unsaved package changes"
        onClose={() => setCancel(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancel(false)}>
              Keep Editing
            </Button>
            <Button variant="secondary" onClick={() => router.push('/services-pricing/packages')}>
              Discard
            </Button>
            <Button
              onClick={() => {
                setCancel(false);
                submit(false);
              }}
            >
              Save Draft
            </Button>
          </>
        }
      >
        <p>Save this package as a draft or discard your changes.</p>
      </Modal>
      <Modal
        open={addon !== null}
        title={addon?.index == null ? 'Add package add-on' : 'Edit package add-on'}
        onClose={() => setAddon(null)}
        footer={<Button onClick={saveAddon}>Save Add-On</Button>}
      >
        {addon ? (
          <div className="space-y-3">
            <Input
              label="Add-On Name *"
              maxLength={120}
              value={addon.value.name}
              onChange={(e) =>
                setAddon({ ...addon, value: { ...addon.value, name: e.target.value } })
              }
            />
            <Textarea
              label="Add-On Description"
              value={addon.value.description ?? ''}
              maxLength={300}
              onChange={(e) =>
                setAddon({ ...addon, value: { ...addon.value, description: e.target.value } })
              }
            />
            <Input
              label="Add-On Price"
              type="number"
              min={0}
              step="0.01"
              value={addon.value.priceCents / 100}
              onChange={(e) =>
                setAddon({
                  ...addon,
                  value: { ...addon.value, priceCents: Math.round(Number(e.target.value) * 100) },
                })
              }
            />
            {addonError ? (
              <p role="alert" className="text-sm text-danger">
                {addonError}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
