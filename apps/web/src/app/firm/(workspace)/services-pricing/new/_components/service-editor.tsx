'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateCatalogServiceRequest, type CatalogService } from '@firmivra/types';
import { Button, Input, Modal, RichTextEditor, Select, Textarea, Toggle } from '@firmivra/ui';
import { Gear, Plus, Trash, ArrowUp, ArrowDown } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  useFieldArray,
  useForm,
  useWatch,
  type FieldPath,
  type FieldPathValue,
} from 'react-hook-form';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { CatalogHeader, ClientPreview, IconPicker, money, Panel, TextList } from './service-parts';

type Values = CreateCatalogServiceRequest;
const defaults: Values = {
  name: '',
  categoryId: '',
  shortDescription: '',
  pricingType: 'FIXED',
  basePriceCents: 0,
  billingFrequency: 'ONE_TIME',
  icon: 'user',
  activate: false,
  taxable: false,
  requireClientApproval: false,
  fullDescription: '',
  included: [],
  notIncluded: [],
  lineItems: [],
  lineItemsMode: 'INCLUDED',
  addOns: [],
  internalNotes: '',
};
const priceOptions = [
  { value: 'FIXED', label: 'Fixed Price' },
  { value: 'STARTING_AT', label: 'Starting At' },
  { value: 'HOURLY', label: 'Hourly' },
  { value: 'CUSTOM_QUOTE', label: 'Custom Quote' },
  { value: 'RECURRING', label: 'Recurring' },
];
const frequencies = [
  { value: 'ONE_TIME', label: 'One-Time' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Biweekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'SEMIANNUAL', label: 'Semiannual' },
  { value: 'ANNUAL', label: 'Annual' },
];

export function ServiceEditor({
  initial,
  onSaved,
}: {
  initial?: CatalogService;
  onSaved?: (values: Values) => Promise<CatalogService>;
}) {
  const router = useRouter();
  const categories = useApiQuery(['services-pricing', 'categories'], () =>
    api.servicesPricing.categories(),
  );
  const form = useForm<Values, unknown, ReturnType<typeof CreateCatalogServiceRequest.parse>>({
    resolver: zodResolver(CreateCatalogServiceRequest),
    defaultValues: defaults,
  });
  const {
    register,
    control,
    setValue,
    reset,
    handleSubmit,
    formState: { errors, isDirty },
  } = form;
  const value = useWatch({ control }) as Values;
  const lines = useFieldArray({ control, name: 'lineItems' });
  const addons = useFieldArray({ control, name: 'addOns' });
  const [cancel, setCancel] = useState(false);
  const [removeLine, setRemoveLine] = useState<number | null>(null);
  const [active, setActive] = useState(initial?.status === 'ACTIVE');
  useEffect(() => {
    if (initial)
      reset({
        ...defaults,
        name: initial.name,
        categoryId: initial.category?.id ?? '',
        shortDescription: initial.shortDescription ?? '',
        pricingType: initial.price.type,
        basePriceCents: initial.basePriceCents,
        billingFrequency: initial.billingFrequency,
        icon: initial.icon,
        taxable: initial.taxable,
        requireClientApproval: initial.requireClientApproval,
        fullDescription: initial.fullDescription ?? '',
        included: initial.included,
        notIncluded: initial.notIncluded,
        lineItems: initial.lineItems,
        lineItemsMode: initial.lineItemsMode,
        addOns: initial.addOns,
        internalNotes: initial.internalNotes ?? '',
      });
  }, [initial, reset]);
  const save = useApiMutation(
    (body: Values) => (onSaved ? onSaved(body) : api.servicesPricing.createService(body)),
    { invalidate: ['services-pricing'] },
  );
  const submit = (activate: boolean) => {
    setValue('activate', activate);
    void handleSubmit((body) =>
      save.mutate(body, {
        onSuccess: () => {
          reset(body);
          router.push('/services-pricing');
        },
      }),
    )();
  };
  const put = <K extends FieldPath<Values>>(key: K, next: FieldPathValue<Values, K>) =>
    setValue(key, next, { shouldDirty: true, shouldValidate: true });
  const categoryOptions = [
    { value: '', label: 'Select category' },
    ...(categories.data ?? [])
      .filter((c) => c.status === 'ACTIVE' || c.id === initial?.category?.id)
      .map((c) => ({ value: c.id, label: c.name })),
  ];
  const currency = money(value.basePriceCents);
  const previewPrice =
    value.pricingType === 'CUSTOM_QUOTE'
      ? 'Quote required'
      : value.pricingType === 'HOURLY'
        ? `${currency}/hour`
        : value.pricingType === 'STARTING_AT'
          ? `Starting at ${currency}`
          : value.pricingType === 'RECURRING'
            ? `${currency} / ${frequencies.find((f) => f.value === value.billingFrequency)?.label.toLowerCase() ?? 'billing period'}`
            : currency;
  return (
    <div className="min-w-0 space-y-4" data-testid="service-editor">
      <CatalogHeader
        edit={!!initial}
        onBack={() => (isDirty ? setCancel(true) : router.push('/services-pricing'))}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(active);
        }}
        className="grid min-w-0 grid-cols-1 items-start gap-3 xl:grid-cols-3"
        data-testid="service-form"
      >
        <div className="min-w-0 space-y-3 xl:col-span-2">
          <Panel title="Basic Information" marker={1}>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="min-w-0 space-y-3 md:col-span-2">
                <Input
                  label="Service Name *"
                  {...register('name')}
                  error={errors.name?.message}
                  data-testid="service-name"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label="Service Category *"
                    options={categoryOptions}
                    {...register('categoryId')}
                    error={errors.categoryId?.message}
                    data-testid="service-category"
                  />
                  <div>
                    <Textarea
                      label="Short Description *"
                      rows={3}
                      maxLength={300}
                      {...register('shortDescription')}
                      error={errors.shortDescription?.message}
                    />
                    <p className="text-right text-xs text-muted">
                      {value.shortDescription?.length ?? 0}/300
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-text">Status</p>
                  <div className="flex items-center gap-2">
                    <Toggle label="Active service" checked={active} onChange={setActive} />
                    <span className="text-sm">{active ? 'Active' : 'Draft'}</span>
                  </div>
                </div>
                <IconPicker value={value.icon} onChange={(next) => put('icon', next)} />
              </div>
            </div>
            {!categories.data?.length || categories.isError ? (
              <PageState
                query={categories}
                empty="No categories available. A category is needed before saving."
              >
                {() => null}
              </PageState>
            ) : null}
          </Panel>
          <Panel title="Pricing & Billing" marker={2}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Pricing Type *" options={priceOptions} {...register('pricingType')} />
              {value.pricingType !== 'CUSTOM_QUOTE' ? (
                <Input
                  label="Base Price *"
                  type="number"
                  min={0}
                  step="0.01"
                  value={(value.basePriceCents ?? 0) / 100}
                  onChange={(e) =>
                    put(
                      'basePriceCents',
                      e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                    )
                  }
                  error={errors.basePriceCents?.message}
                  data-testid="service-price"
                />
              ) : (
                <p className="self-center text-sm text-muted">Quote required before billing.</p>
              )}
              <Select
                label="Billing Frequency"
                options={
                  value.pricingType === 'RECURRING'
                    ? frequencies.filter((f) => f.value !== 'ONE_TIME')
                    : frequencies
                }
                disabled={value.pricingType !== 'RECURRING'}
                value={value.billingFrequency ?? 'ONE_TIME'}
                onChange={(e) =>
                  put('billingFrequency', e.target.value as Values['billingFrequency'])
                }
                error={errors.billingFrequency?.message}
              />
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Toggle
                  label="Taxable Service"
                  checked={!!value.taxable}
                  onChange={(next) => put('taxable', next)}
                />
                Taxable Service
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Toggle
                  label="Require Client Approval"
                  checked={!!value.requireClientApproval}
                  onChange={(next) => put('requireClientApproval', next)}
                />
                Require Client Approval
              </label>
            </div>
          </Panel>
          <Panel title="Service Details" marker={3}>
            <div className="grid gap-4 lg:grid-cols-5">
              <div className="min-w-0 lg:col-span-3">
                <RichTextEditor
                  label="Full Description (Client-Facing)"
                  value={value.fullDescription ?? ''}
                  onChange={(next) => put('fullDescription', next)}
                  maxLength={1000}
                />
                {errors.fullDescription ? (
                  <p className="text-sm text-danger">{errors.fullDescription.message}</p>
                ) : null}
              </div>
              <div className="min-w-0 space-y-4 lg:col-span-2">
                <TextList
                  label="What's Included"
                  items={value.included ?? []}
                  onChange={(next) => put('included', next)}
                />
                <TextList
                  label="Not Included"
                  items={value.notIncluded ?? []}
                  onChange={(next) => put('notIncluded', next)}
                />
              </div>
            </div>
          </Panel>
          <Panel title="Service Line Items (Optional)" marker={4}>
            <Select
              label="Line item pricing"
              value={value.lineItemsMode ?? 'INCLUDED'}
              options={[
                { value: 'INCLUDED', label: 'Included within base price' },
                { value: 'ADDITIVE', label: 'Add line item charges' },
              ]}
              onChange={(e) => put('lineItemsMode', e.target.value as Values['lineItemsMode'])}
            />
            {lines.fields.length ? (
              lines.fields.map((line, i) => (
                <div
                  key={line.id}
                  className="grid min-w-0 gap-2 border-b border-divider pb-3 sm:grid-cols-2 lg:grid-cols-4"
                  data-testid="service-line"
                >
                  <Input
                    label={`Item Name ${i + 1} *`}
                    {...register(`lineItems.${i}.name`)}
                    error={errors.lineItems?.[i]?.name?.message}
                  />
                  <Input
                    label={`Description ${i + 1}`}
                    {...register(`lineItems.${i}.description`)}
                  />
                  <Input
                    label={`Quantity ${i + 1}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    {...register(`lineItems.${i}.quantity`, { valueAsNumber: true })}
                    error={errors.lineItems?.[i]?.quantity?.message}
                  />
                  <Input
                    label={`Price ${i + 1}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={(value.lineItems?.[i]?.rateCents ?? 0) / 100}
                    onChange={(e) =>
                      put(
                        `lineItems`,
                        (value.lineItems ?? []).map((x, index) =>
                          index === i
                            ? { ...x, rateCents: Math.round(Number(e.target.value) * 100) }
                            : x,
                        ),
                      )
                    }
                    error={errors.lineItems?.[i]?.rateCents?.message}
                  />
                  <div className="flex flex-wrap gap-1 sm:col-span-2 lg:col-span-4">
                    <Button
                      variant="ghost"
                      disabled={i === 0}
                      onClick={() => lines.move(i, i - 1)}
                      aria-label={`Move line ${i + 1} up`}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={i === lines.fields.length - 1}
                      onClick={() => lines.move(i, i + 1)}
                      aria-label={`Move line ${i + 1} down`}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setRemoveLine(i)}
                      aria-label={`Remove line ${i + 1}`}
                    >
                      <Trash className="size-4" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No line items added.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                variant="outline"
                disabled={lines.fields.length >= 50}
                onClick={() =>
                  lines.append({ name: '', description: '', quantity: 1, rateCents: 0 })
                }
              >
                <Plus className="size-4" />
                Add Line Item
              </Button>
              <p className="text-sm">
                Total Price:{' '}
                <strong>
                  {value.lineItemsMode === 'ADDITIVE' ? 'Calculated on save' : currency}
                </strong>
              </p>
            </div>
          </Panel>
        </div>
        <aside className="min-w-0 space-y-3">
          <ClientPreview
            name={value.name}
            description={value.shortDescription}
            icon={value.icon}
            price={previewPrice}
            included={(value.included ?? []).filter(Boolean)}
            addons={(value.addOns ?? []).filter(
              (a) => a.status !== 'INACTIVE' && a.clientSelectable,
            )}
            fullDescription={value.fullDescription}
          />
          <Panel
            title="Optional Add-Ons"
            marker={<Plus className="size-4" />}
            action={
              <Button
                variant="outline"
                disabled={addons.fields.length >= 30}
                onClick={() =>
                  addons.append({
                    name: '',
                    description: '',
                    priceCents: 0,
                    status: 'ACTIVE',
                    clientSelectable: true,
                  })
                }
              >
                + Add Add-On
              </Button>
            }
          >
            {addons.fields.length ? (
              addons.fields.map((addon, i) => (
                <div
                  key={addon.id}
                  className="space-y-2 border-b border-divider pb-3"
                  data-testid="service-addon"
                >
                  <Input
                    label={`Add-On Name ${i + 1}`}
                    {...register(`addOns.${i}.name`)}
                    error={errors.addOns?.[i]?.name?.message}
                  />
                  <Input
                    label={`Add-On Description ${i + 1}`}
                    {...register(`addOns.${i}.description`)}
                  />
                  <Input
                    label={`Add-On Price ${i + 1}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={(value.addOns?.[i]?.priceCents ?? 0) / 100}
                    onChange={(e) =>
                      put(
                        'addOns',
                        (value.addOns ?? []).map((x, index) =>
                          index === i
                            ? { ...x, priceCents: Math.round(Number(e.target.value) * 100) }
                            : x,
                        ),
                      )
                    }
                    error={errors.addOns?.[i]?.priceCents?.message}
                  />
                  <Select
                    label={`Add-On Status ${i + 1}`}
                    options={[
                      { value: 'ACTIVE', label: 'Active' },
                      { value: 'INACTIVE', label: 'Inactive' },
                    ]}
                    {...register(`addOns.${i}.status`)}
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <Toggle
                      label={`Client selectable add-on ${i + 1}`}
                      checked={!!value.addOns?.[i]?.clientSelectable}
                      onChange={(next) =>
                        put(
                          'addOns',
                          (value.addOns ?? []).map((x, index) =>
                            index === i ? { ...x, clientSelectable: next } : x,
                          ),
                        )
                      }
                    />
                    Client selectable
                  </label>
                  <Button variant="ghost" onClick={() => addons.remove(i)}>
                    Remove add-on {i + 1}
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No optional add-ons added.</p>
            )}
          </Panel>
          <Panel title="Internal Settings" marker={<Gear weight="fill" className="size-4" />}>
            <Textarea
              label="Internal Notes (Not Visible to Clients)"
              rows={4}
              maxLength={500}
              {...register('internalNotes')}
              error={errors.internalNotes?.message}
              data-testid="internal-notes"
            />
            <p className="text-right text-xs text-muted">{value.internalNotes?.length ?? 0}/500</p>
          </Panel>
          {save.error ? (
            <p role="alert" data-testid="save-error" className="text-sm text-danger">
              {errorMessage(save.error)}
            </p>
          ) : null}
          {Object.keys(errors).length ? (
            <p role="alert" className="text-sm text-danger">
              Check the highlighted fields before saving.
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => (isDirty ? setCancel(true) : router.push('/services-pricing'))}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={save.isPending}
              onClick={() => submit(false)}
              data-testid="save-draft"
            >
              Save as Draft
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() => submit(true)}
              data-testid="save-activate"
            >
              {save.isPending ? 'Saving…' : 'Save & Activate'}
            </Button>
          </div>
        </aside>
      </form>
      <Modal
        open={cancel}
        title="Unsaved changes"
        onClose={() => setCancel(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancel(false)}>
              Keep Editing
            </Button>
            <Button variant="secondary" onClick={() => router.push('/services-pricing')}>
              Discard
            </Button>
            <Button
              disabled={save.isPending}
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
        <p>Your changes have not been saved.</p>
      </Modal>
      <Modal
        open={removeLine !== null}
        title="Remove line item?"
        onClose={() => setRemoveLine(null)}
        footer={
          <Button
            onClick={() => {
              if (removeLine !== null) lines.remove(removeLine);
              setRemoveLine(null);
            }}
          >
            Remove line item
          </Button>
        }
      >
        <p>This removes the line from this service. Historical transactions stay unchanged.</p>
      </Modal>
    </div>
  );
}
