'use client';

import { ApiRequestError, type Promotion, type SavePromotionRequest } from '@firmivra/types';
import { Badge, Button, Checkbox, Input, Modal, Select, Toast } from '@firmivra/ui';
import { PencilSimple, Plus, Prohibit, Tag } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { CatalogFrame } from './catalog-frame';
import { CATALOG_ERRORS, CATALOG_KEY, Quiet, money } from './catalog-shared';

const PROMOS = [...CATALOG_KEY, 'promotions'];
const STATUS = {
  DRAFT: { label: 'Draft', tone: 'warning' },
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  ACTIVE: { label: 'Active', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
} as const;
const APPLIES = {
  ALL: 'All eligible services',
  CATEGORIES: 'Selected categories',
  SERVICES: 'Selected services',
  PACKAGES: 'Selected packages',
} as const;
const ELIGIBILITY = {
  ALL_CLIENTS: 'All clients',
  NEW_CLIENTS: 'New clients',
  EXISTING_CLIENTS: 'Existing clients',
} as const;

const valueText = (p: Promotion) =>
  p.discountType === 'PERCENTAGE' ? `${p.value / 100}% off` : `${money(p.value)} off`;
const range = (p: Promotion) =>
  p.startsOn || p.endsOn ? `${p.startsOn ?? 'Any time'} to ${p.endsOn ?? 'no end'}` : 'No dates';

/** /services-pricing/promotions: date-limited or code-based discounts and what they apply to. */
export function PromotionsScreen() {
  const list = useApiQuery(PROMOS, () => api.servicesPricing.promotions());
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const rows = list.data ?? [];
  const end = useApiMutation((id: string) => api.servicesPricing.endPromotion(id), {
    invalidate: [...CATALOG_KEY],
  });
  const state = list.isPending
    ? 'Loading…'
    : list.isError
      ? 'Promotions are not available right now.'
      : 'No promotions yet. Create one to offer a discount for a period or with a code.';
  return (
    <CatalogFrame tab="promotions">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <section
        aria-label="Discounts and promotions"
        className="min-w-0 rounded-xl bg-surface p-4 shadow-md"
        data-testid="promotions-card"
      >
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-11 items-center justify-center rounded-full bg-info-soft text-info"
            >
              <Tag weight="fill" className="size-6" />
            </span>
            <div>
              <h2 className="font-display text-xl font-bold text-heading">
                Discounts &amp; Promotions
              </h2>
              <p className="text-sm text-muted">
                Changes apply to future use only. Completed invoices keep their price.
              </p>
            </div>
          </div>
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden weight="bold" className="size-4" /> Create Promotion
          </Button>
        </header>
        {rows.length === 0 ? (
          <Quiet>{state}</Quiet>
        ) : (
          <div className="relative overflow-x-auto rounded-lg border border-divider">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Promotions</caption>
              <thead className="bg-table-head text-heading">
                <tr>
                  <th className="px-4 py-3 font-semibold">Promotion</th>
                  <th className="px-4 py-3 font-semibold">Discount</th>
                  <th className="px-4 py-3 font-semibold">Applies To</th>
                  <th className="px-4 py-3 font-semibold">Valid</th>
                  <th className="px-4 py-3 font-semibold">Code</th>
                  <th className="px-4 py-3 font-semibold">Stacking</th>
                  <th className="px-4 py-3 font-semibold">Used</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody data-testid="promotion-rows">
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-divider">
                    <td className="px-4 py-3">
                      <span data-testid="promotion-name" className="font-semibold text-heading">
                        {p.name}
                      </span>
                      <span className="block text-xs text-muted">{ELIGIBILITY[p.eligibility]}</span>
                    </td>
                    <td className="px-4 py-3 text-heading">{valueText(p)}</td>
                    <td className="px-4 py-3 text-text">{APPLIES[p.appliesTo]}</td>
                    <td className="px-4 py-3 text-text">{range(p)}</td>
                    <td className="px-4 py-3 text-text">{p.promoCode ?? '—'}</td>
                    <td className="px-4 py-3 text-text">
                      {p.stackable ? 'Allowed' : 'Not allowed'}
                    </td>
                    <td className="px-4 py-3 text-heading">{p.usageCount}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-info-soft px-3 text-sm font-semibold text-action"
                        >
                          <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
                          <span className="sr-only"> {p.name}</span>
                        </button>
                        <button
                          type="button"
                          disabled={p.status === 'EXPIRED' || p.status === 'INACTIVE'}
                          onClick={() =>
                            end.mutate(p.id, {
                              onSuccess: () =>
                                setMessage({ text: `${p.name} ended.`, tone: 'success' }),
                              onError: (e) =>
                                setMessage({
                                  text: errorMessage(e, CATALOG_ERRORS),
                                  tone: 'error',
                                }),
                            })
                          }
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-divider px-3 text-sm font-medium text-heading hover:bg-canvas disabled:opacity-40"
                        >
                          <Prohibit aria-hidden weight="fill" className="size-4" /> End
                          <span className="sr-only"> {p.name}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing ? (
        <PromotionDialog
          promotion={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setEditing(null);
            setMessage({ text, tone: 'success' });
          }}
        />
      ) : null}
    </CatalogFrame>
  );
}

type PromoField = 'name' | 'value' | 'targets' | 'startsOn' | 'endsOn' | 'code';
const TARGET_NOUN: Record<Promotion['appliesTo'], string> = {
  ALL: 'service',
  CATEGORIES: 'category',
  SERVICES: 'service',
  PACKAGES: 'package',
};
const FIELD_ORDER: PromoField[] = ['name', 'value', 'targets', 'startsOn', 'endsOn', 'code'];
const FIELD_LABEL: Record<PromoField, string> = {
  name: 'Promotion name',
  value: 'Discount',
  targets: 'Applies to',
  startsOn: 'Starts on',
  endsOn: 'Ends on',
  code: 'Promo code',
};
const API_FIELD: Record<string, PromoField> = {
  name: 'name',
  value: 'value',
  targetIds: 'targets',
  startsOn: 'startsOn',
  endsOn: 'endsOn',
  promoCode: 'code',
};

function PromotionDialog({
  promotion,
  onClose,
  onDone,
}: {
  promotion: Promotion | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [name, setName] = useState(promotion?.name ?? '');
  const [type, setType] = useState<'PERCENTAGE' | 'FIXED'>(promotion?.discountType ?? 'PERCENTAGE');
  const [value, setValue] = useState(promotion ? String(promotion.value / 100) : '');
  const [appliesTo, setAppliesTo] = useState<Promotion['appliesTo']>(promotion?.appliesTo ?? 'ALL');
  const [targets, setTargets] = useState<string[]>(promotion?.targetIds ?? []);
  const [startsOn, setStartsOn] = useState(promotion?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(promotion?.endsOn ?? '');
  const [eligibility, setEligibility] = useState<Promotion['eligibility']>(
    promotion?.eligibility ?? 'ALL_CLIENTS',
  );
  const [code, setCode] = useState(promotion?.promoCode ?? '');
  const [stackable, setStackable] = useState(promotion?.stackable ?? false);
  const [issues, setIssues] = useState<Partial<Record<PromoField, string>>>({});
  const categories = useApiQuery([...PROMOS, 'targets', 'categories'], () =>
    api.servicesPricing.categories(),
  );
  const services = useApiQuery([...PROMOS, 'targets', 'services'], () =>
    api.servicesPricing.services({ status: 'active', pageSize: 100 }),
  );
  const packages = useApiQuery([...PROMOS, 'targets', 'packages'], () =>
    api.servicesPricing.packages(),
  );
  const choices =
    appliesTo === 'CATEGORIES'
      ? (categories.data ?? []).map((c) => ({ id: c.id, label: c.name }))
      : appliesTo === 'SERVICES'
        ? (services.data?.items ?? []).map((s) => ({ id: s.id, label: s.name }))
        : appliesTo === 'PACKAGES'
          ? (packages.data ?? []).map((p) => ({ id: p.id, label: p.name }))
          : [];
  const number = Number(value);
  const body = (activate: boolean): SavePromotionRequest => ({
    name: name.trim(),
    discountType: type,
    value: Math.round(number * 100),
    appliesTo,
    targetIds: appliesTo === 'ALL' ? [] : targets,
    startsOn: startsOn || null,
    endsOn: endsOn || null,
    eligibility,
    promoCode: code.trim().toUpperCase(),
    stackable,
    activate,
  });
  const save = useApiMutation(
    (activate: boolean) =>
      promotion
        ? api.servicesPricing.updatePromotion(promotion.id, body(activate))
        : api.servicesPricing.createPromotion(body(activate)),
    { invalidate: [...CATALOG_KEY] },
  );
  /** Every wrong field with its rule (the API checks the same rules again). */
  function check(): Partial<Record<PromoField, string>> {
    const found: Partial<Record<PromoField, string>> = {};
    if (!name.trim()) found.name = 'Enter a name.';
    if (value.trim() === '' || !Number.isFinite(number)) found.value = 'Enter the discount.';
    else if (number <= 0)
      found.value = 'Use a value above 0. Negative or zero discounts are not allowed.';
    else if (type === 'PERCENTAGE' && number > 100)
      found.value = 'A percentage discount is 1 to 100%.';
    else if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
      found.value = 'Use at most two decimal places.';
    if (appliesTo !== 'ALL' && targets.length === 0)
      found.targets = `Choose at least one ${TARGET_NOUN[appliesTo]}.`;
    if (startsOn && endsOn && startsOn > endsOn)
      found.endsOn = 'The end date must be on or after the start date.';
    const promo = code.trim();
    if (promo && !/^[A-Z0-9-]{3,30}$/.test(promo))
      found.code = 'Use 3 to 30 capital letters, digits or hyphens.';
    return found;
  }
  function show(found: Partial<Record<PromoField, string>>) {
    setIssues(found);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) document.getElementById(`promo-${first}`)?.focus();
  }
  const submit = (activate: boolean) => {
    const found = check();
    if (Object.keys(found).length) {
      show(found);
      return;
    }
    setIssues({});
    save.mutate(activate, {
      onSuccess: () =>
        onDone(
          activate
            ? 'Promotion saved and activated.'
            : promotion
              ? 'Promotion saved.'
              : 'Draft saved.',
        ),
      // The API's own field details, if it still refuses something.
      onError: (error) => {
        if (!(error instanceof ApiRequestError) || !error.details?.length) return;
        const found: Partial<Record<PromoField, string>> = {};
        for (const detail of error.details) {
          const field = API_FIELD[detail.path.split('.')[0] ?? ''];
          if (field) found[field] = detail.message;
        }
        if (Object.keys(found).length) show(found);
      },
    });
  };
  const wrong = FIELD_ORDER.filter((field) => issues[field]);
  return (
    <Modal
      open
      title={promotion ? 'Edit Promotion' : 'Create Promotion'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={save.isPending} onClick={() => submit(false)}>
            {promotion ? 'Save' : 'Save as Draft'}
          </Button>
          <Button disabled={save.isPending} onClick={() => submit(true)}>
            Save &amp; Activate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {wrong.length ? (
          <div
            role="alert"
            data-testid="promotion-errors"
            className="rounded-control bg-danger-soft p-3 text-sm text-heading"
          >
            Fix {wrong.length === 1 ? 'this field' : `these ${wrong.length} fields`} before saving:{' '}
            {wrong.map((field) => FIELD_LABEL[field]).join(', ')}.
          </div>
        ) : null}
        <Input
          id="promo-name"
          label="Promotion name"
          value={name}
          maxLength={120}
          error={issues.name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Discount type"
            value={type}
            onChange={(event) => setType(event.target.value as typeof type)}
            options={[
              { value: 'PERCENTAGE', label: 'Percentage' },
              { value: 'FIXED', label: 'Fixed amount' },
            ]}
          />
          <div className="flex flex-col gap-1">
            <Input
              id="promo-value"
              label={type === 'PERCENTAGE' ? 'Percent off' : 'Dollars off'}
              type="number"
              min={0}
              max={type === 'PERCENTAGE' ? 100 : undefined}
              step="0.01"
              value={value}
              error={issues.value}
              aria-describedby="promo-value-rule"
              onChange={(event) => setValue(event.target.value)}
            />
            <p id="promo-value-rule" className="text-xs text-muted">
              {type === 'PERCENTAGE'
                ? '1 to 100%. Negative values are not allowed.'
                : 'Above $0. Negative values are not allowed.'}
            </p>
          </div>
        </div>
        <Select
          label="Applies to"
          value={appliesTo}
          onChange={(event) => {
            setAppliesTo(event.target.value as typeof appliesTo);
            setTargets([]);
          }}
          options={Object.entries(APPLIES).map(([v, label]) => ({ value: v, label }))}
        />
        {appliesTo !== 'ALL' ? (
          <fieldset
            id="promo-targets"
            tabIndex={-1}
            aria-describedby={issues.targets ? 'promo-targets-error' : undefined}
            className={`max-h-40 overflow-y-auto rounded-lg border p-3 ${issues.targets ? 'border-danger' : 'border-divider'}`}
          >
            <legend className="px-1 text-sm font-medium text-text">
              Choose what it applies to
            </legend>
            {choices.length === 0 ? (
              <p className="text-sm text-muted">Nothing to choose from yet.</p>
            ) : (
              choices.map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.label}
                  checked={targets.includes(c.id)}
                  onChange={(event) =>
                    setTargets(
                      event.target.checked ? [...targets, c.id] : targets.filter((t) => t !== c.id),
                    )
                  }
                />
              ))
            )}
          </fieldset>
        ) : null}
        {issues.targets ? (
          <p id="promo-targets-error" className="-mt-2 text-sm font-medium text-danger">
            {issues.targets}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            id="promo-startsOn"
            label="Starts on (optional)"
            type="date"
            value={startsOn}
            error={issues.startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
          <Input
            id="promo-endsOn"
            label="Ends on (optional)"
            type="date"
            value={endsOn}
            min={startsOn || undefined}
            error={issues.endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
          />
        </div>
        <p className="-mt-2 text-xs text-muted">The end date is on or after the start date.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Client eligibility"
            value={eligibility}
            onChange={(event) => setEligibility(event.target.value as typeof eligibility)}
            options={Object.entries(ELIGIBILITY).map(([v, label]) => ({ value: v, label }))}
          />
          <Input
            id="promo-code"
            label="Promo code (optional)"
            value={code}
            maxLength={30}
            error={issues.code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </div>
        <Checkbox
          label="Allow stacking with other promotions"
          checked={stackable}
          onChange={(event) => setStackable(event.target.checked)}
        />
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, CATALOG_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
