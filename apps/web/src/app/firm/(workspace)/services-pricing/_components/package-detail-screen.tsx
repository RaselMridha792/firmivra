'use client';

import type { ServicePackage } from '@firmivra/types';
import { Badge, Toast } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  ArrowLeft,
  Copy,
  PencilSimple,
  Power,
  Warning,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  CATALOG_ERRORS,
  CATALOG_KEY,
  IconTile,
  Quiet,
  STATUS_LABEL,
  STATUS_TONE,
  money,
  percent,
  tone,
} from './catalog-shared';
import { PackagePreview, Panel } from './package-parts';

const yes = (v: boolean) => (v ? 'Yes' : 'No');

/** /services-pricing/packages/[id]: one package, read-only: its services, pricing, add-ons and client view. */
export function PackageDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const query = useApiQuery([...CATALOG_KEY, 'package', id], () => api.servicesPricing.package(id));
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const p: ServicePackage | undefined = query.data;
  const options = { invalidate: [...CATALOG_KEY] };
  const activate = useApiMutation(() => api.servicesPricing.activatePackage(id), options);
  const deactivate = useApiMutation(() => api.servicesPricing.deactivatePackage(id), options);
  const duplicate = useApiMutation(() => api.servicesPricing.duplicatePackage(id), options);
  const fail = (e: unknown) => setMessage({ text: errorMessage(e, CATALOG_ERRORS), tone: 'error' });
  const note = query.isPending ? 'Loading…' : 'This package is not available right now.';
  const included = (p?.services ?? []).filter((s) => s.included);
  const btn =
    'inline-flex min-h-10 items-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas disabled:opacity-50';

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="package-detail">
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
        <span className="font-semibold text-heading">{p?.name ?? 'Package'}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <IconTile icon={p?.icon} size="lg" />
          <div className="min-w-0">
            <h1
              className="font-display text-3xl font-bold text-heading"
              data-testid="package-title"
            >
              {p?.name ?? 'Package details'}
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-base text-muted">
              {p ? (
                <>
                  <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  {p.category ? (
                    <Badge tone={tone(p.category.tone)}>{p.category.name}</Badge>
                  ) : null}
                  {p.shortDescription ?? ''}
                </>
              ) : (
                note
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/services-pricing/packages"
            className="inline-flex min-h-10 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft"
          >
            <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Packages
          </Link>
          {p ? (
            <>
              <Link
                href={`/services-pricing/packages/${id}/edit`}
                className="inline-flex min-h-10 items-center gap-2 rounded-control bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover"
              >
                <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
              </Link>
              <button
                type="button"
                className={btn}
                onClick={() =>
                  duplicate.mutate(undefined, {
                    onSuccess: (copy) => router.push(`/services-pricing/packages/${copy.id}/edit`),
                    onError: fail,
                  })
                }
              >
                <Copy aria-hidden weight="fill" className="size-4" /> Duplicate
              </button>
              <button
                type="button"
                className={btn}
                onClick={() =>
                  (p.status === 'ACTIVE' ? deactivate : activate).mutate(undefined, {
                    onSuccess: () =>
                      setMessage({
                        text: p.status === 'ACTIVE' ? 'Package deactivated.' : 'Package activated.',
                        tone: 'success',
                      }),
                    onError: fail,
                  })
                }
              >
                <Power aria-hidden weight="fill" className="size-4" />
                {p.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </button>
              {p.status === 'ARCHIVED' ? (
                // Octavia's review S4: an archived package comes back as Inactive, history kept.
                <button
                  type="button"
                  className={btn}
                  onClick={() =>
                    deactivate.mutate(undefined, {
                      onSuccess: () =>
                        setMessage({
                          text: 'Package restored to Inactive. Activate it when it is ready to sell.',
                          tone: 'success',
                        }),
                      onError: fail,
                    })
                  }
                >
                  <ArrowCounterClockwise aria-hidden weight="bold" className="size-4" />
                  Restore
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Services in this Package" step={1} testId="detail-services">
            {!p || p.services.length === 0 ? (
              <Quiet>{p ? 'No services in this package yet.' : note}</Quiet>
            ) : (
              <div className="relative overflow-x-auto rounded-lg border border-divider">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Services in this package</caption>
                  <thead className="bg-table-head text-heading">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Service Name</th>
                      <th className="px-3 py-2 font-semibold">Category</th>
                      <th className="px-3 py-2 font-semibold">Individual Price</th>
                      <th className="px-3 py-2 font-semibold">Included in Package</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.services.map((s) => (
                      <tr key={s.serviceId} className="border-t border-divider">
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <IconTile icon={s.icon} />
                            <span className="text-heading">{s.name}</span>
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
                        <td className="px-3 py-2 text-heading">{yes(s.included)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title="Package Pricing" step={2} testId="detail-pricing">
            {p ? (
              <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-text">Total of Selected Services</dt>
                <dd className="text-heading">{money(p.pricing.totalSelectedCents)}</dd>
                <dt className="text-text">Package Price</dt>
                <dd className="font-semibold text-heading">{money(p.pricing.packagePriceCents)}</dd>
                <dt className="text-text">Discount</dt>
                <dd className="text-heading">
                  {p.pricing.discountType === 'NONE' || p.pricing.discountValue === null
                    ? 'None'
                    : p.pricing.discountType === 'PERCENTAGE'
                      ? percent(p.pricing.discountValue)
                      : money(p.pricing.discountValue)}
                </dd>
                <dt className="text-text">Client Savings</dt>
                <dd className="text-heading">
                  {p.pricing.savingsCents === null
                    ? 'Cannot be guaranteed'
                    : `${money(p.pricing.savingsCents)}${p.pricing.savingsPercent === null ? '' : ` (${p.pricing.savingsPercent}%)`}`}
                </dd>
              </dl>
            ) : (
              <Quiet>{note}</Quiet>
            )}
            {p?.pricing.variablePrice ? (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-warning-soft p-3 text-sm text-text">
                <Warning aria-hidden weight="fill" className="size-5 shrink-0 text-gold" />A
                Starting At, Hourly or Custom Quote service is included, so the savings are an
                estimate.
              </p>
            ) : null}
          </Panel>
          <Panel title="Optional Add-Ons (Client Can Choose)" step={3} testId="detail-addons">
            {!p || p.addOns.length === 0 ? (
              <Quiet>{p ? 'No add-ons for this package.' : note}</Quiet>
            ) : (
              <ul className="divide-y divide-divider">
                {p.addOns.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold text-heading">{a.name}</span>
                      <span className="text-xs text-muted">{a.description ?? ''}</span>
                    </span>
                    <span className="flex items-center gap-3 text-sm text-heading">
                      {money(a.priceCents)}
                      <Badge tone={a.offered ? 'success' : 'neutral'}>
                        {a.offered ? 'Offered' : 'Not offered'}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Preview and settings">
          <Panel title="Package Preview (Client View)" testId="detail-preview">
            <PackagePreview
              data={{
                name: p?.name ?? '',
                icon: p?.icon ?? null,
                priceCents: p?.packagePriceCents ?? null,
                description: p?.shortDescription ?? '',
                included: included.map((s) => s.name),
                addOns: (p?.addOns ?? [])
                  .filter((a) => a.offered)
                  .map((a) => ({ name: a.name, priceCents: a.priceCents })),
              }}
            />
          </Panel>
          <Panel title="Internal Notes (Not Visible to Clients)" testId="detail-notes">
            <p className="whitespace-pre-line text-sm text-text">
              {p?.internalNotes || <span className="text-muted">No internal notes.</span>}
            </p>
          </Panel>
          <Panel title="Package Settings" testId="detail-settings">
            {p ? (
              <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
                <dt className="text-text">Visible to Clients</dt>
                <dd className="text-heading">{yes(p.visibleToClients)}</dd>
                <dt className="text-text">Allow Client to Add Optional Add-Ons</dt>
                <dd className="text-heading">{yes(p.allowClientAddOns)}</dd>
                <dt className="text-text">Display on Website/Portal</dt>
                <dd className="text-heading">{yes(p.displayOnWebsite)}</dd>
              </dl>
            ) : (
              <Quiet>{note}</Quiet>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
