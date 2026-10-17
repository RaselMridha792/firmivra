'use client';

import type { ServicePackageRow } from '@firmivra/types';
import { Badge, Toast } from '@firmivra/ui';
import { Archive, Copy, Eye, PencilSimple, Plus, Power, Package } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { CatalogFrame } from './catalog-frame';
import {
  CATALOG_ERRORS,
  CATALOG_KEY,
  IconTile,
  Quiet,
  STATUS_LABEL,
  STATUS_TONE,
  dayText,
  money,
  tone,
} from './catalog-shared';

const PACKAGES = [...CATALOG_KEY, 'packages'];
const small =
  'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-divider px-3 text-sm font-medium text-heading hover:bg-canvas';

/** /services-pricing/packages: the firm's packages, what each costs and saves, and their actions. */
export function PackagesScreen() {
  const router = useRouter();
  const list = useApiQuery(PACKAGES, () => api.servicesPricing.packages());
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const rows = (list.data ?? []).filter((p) => p.status !== 'ARCHIVED');
  const options = { invalidate: [...CATALOG_KEY] };
  const done = (text: string) => () => setMessage({ text, tone: 'success' });
  const fail = (error: unknown) =>
    setMessage({ text: errorMessage(error, CATALOG_ERRORS), tone: 'error' });
  const activate = useApiMutation((id: string) => api.servicesPricing.activatePackage(id), options);
  const deactivate = useApiMutation(
    (id: string) => api.servicesPricing.deactivatePackage(id),
    options,
  );
  const duplicate = useApiMutation(
    (id: string) => api.servicesPricing.duplicatePackage(id),
    options,
  );
  const archive = useApiMutation((id: string) => api.servicesPricing.archivePackage(id), options);
  const state = list.isPending
    ? 'Loading…'
    : list.isError
      ? 'Packages are not available right now.'
      : 'No packages yet. Combine services into a package to sell them together.';

  const actions = (p: ServicePackageRow) => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link
        href={`/services-pricing/packages/${p.id}/edit`}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-info-soft px-3 text-sm font-semibold text-action"
      >
        <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
        <span className="sr-only"> {p.name}</span>
      </Link>
      <Link href={`/services-pricing/packages/${p.id}`} className={small}>
        <Eye aria-hidden weight="fill" className="size-4" /> View
        <span className="sr-only"> {p.name}</span>
      </Link>
      <button
        type="button"
        className={small}
        onClick={() =>
          duplicate.mutate(p.id, {
            onSuccess: (copy) => router.push(`/services-pricing/packages/${copy.id}/edit`),
            onError: fail,
          })
        }
      >
        <Copy aria-hidden weight="fill" className="size-4" /> Duplicate
        <span className="sr-only"> {p.name}</span>
      </button>
      {p.status === 'ACTIVE' ? (
        <button
          type="button"
          className={small}
          onClick={() =>
            deactivate.mutate(p.id, { onSuccess: done(`${p.name} deactivated.`), onError: fail })
          }
        >
          <Power aria-hidden weight="fill" className="size-4" /> Deactivate
          <span className="sr-only"> {p.name}</span>
        </button>
      ) : (
        <button
          type="button"
          className={small}
          onClick={() =>
            activate.mutate(p.id, { onSuccess: done(`${p.name} activated.`), onError: fail })
          }
        >
          <Power aria-hidden weight="fill" className="size-4" /> Activate
          <span className="sr-only"> {p.name}</span>
        </button>
      )}
      <button
        type="button"
        className={`${small} text-danger`}
        onClick={() =>
          archive.mutate(p.id, { onSuccess: done(`${p.name} archived.`), onError: fail })
        }
      >
        <Archive aria-hidden weight="fill" className="size-4" /> Archive
        <span className="sr-only"> {p.name}</span>
      </button>
    </div>
  );

  return (
    <CatalogFrame tab="packages">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <section
        aria-label="Packages"
        className="min-w-0 rounded-xl bg-surface p-4 shadow-md"
        data-testid="packages-card"
      >
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-11 items-center justify-center rounded-full bg-info-soft text-info"
            >
              <Package weight="fill" className="size-6" />
            </span>
            <div>
              <h2 className="font-display text-xl font-bold text-heading">Packages</h2>
              <p className="text-sm text-muted">
                Sellable bundles of services. Removing a service from a package never deletes the
                service.
              </p>
            </div>
          </div>
          <Link
            href="/services-pricing/packages/new"
            className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover"
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Create Package
          </Link>
        </header>
        {rows.length === 0 ? (
          <Quiet>{state}</Quiet>
        ) : (
          <div className="relative overflow-x-auto rounded-lg border border-divider">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Packages</caption>
              <thead className="bg-table-head text-heading">
                <tr>
                  <th className="px-4 py-3 font-semibold">Package</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Services</th>
                  <th className="px-4 py-3 font-semibold">Package Price</th>
                  <th className="px-4 py-3 font-semibold">Client Savings</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Last Updated</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody data-testid="package-rows">
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-divider">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-3">
                        <IconTile icon={p.icon} />
                        <span className="flex min-w-0 flex-col">
                          <Link
                            href={`/services-pricing/packages/${p.id}`}
                            data-testid="package-name"
                            className="font-semibold text-heading hover:underline"
                          >
                            {p.name}
                          </Link>
                          <span className="text-xs text-muted">{p.shortDescription ?? ''}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {p.category ? (
                        <Badge tone={tone(p.category.tone)}>{p.category.name}</Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-heading">{p.serviceCount}</td>
                    <td className="px-4 py-3 font-semibold text-heading">
                      {money(p.packagePriceCents)}
                    </td>
                    <td className="px-4 py-3 text-heading">
                      {p.savingsCents === null ? '—' : money(p.savingsCents)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-text">{dayText(p.updatedAt)}</td>
                    <td className="px-4 py-3">{actions(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </CatalogFrame>
  );
}
