'use client';

import type { Promotion, SavePromotionRequest } from '@firmivra/types';
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
  const valid = name.trim() && number > 0;
  const submit = (activate: boolean) =>
    save.mutate(activate, {
      onSuccess: () =>
        onDone(
          activate
            ? 'Promotion saved and activated.'
            : promotion
              ? 'Promotion saved.'
              : 'Draft saved.',
        ),
    });
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
          <Button
            variant="secondary"
            disabled={!valid || save.isPending}
            onClick={() => submit(false)}
          >
            {promotion ? 'Save' : 'Save as Draft'}
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => submit(true)}>
            Save &amp; Activate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Promotion name"
          value={name}
          maxLength={120}
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
          <Input
            label={type === 'PERCENTAGE' ? 'Percent off' : 'Dollars off'}
            type="number"
            min={0}
            step="0.01"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
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
          <fieldset className="max-h-40 overflow-y-auto rounded-lg border border-divider p-3">
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Starts on (optional)"
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
          <Input
            label="Ends on (optional)"
            type="date"
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Client eligibility"
            value={eligibility}
            onChange={(event) => setEligibility(event.target.value as typeof eligibility)}
            options={Object.entries(ELIGIBILITY).map(([v, label]) => ({ value: v, label }))}
          />
          <Input
            label="Promo code (optional)"
            value={code}
            maxLength={30}
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
