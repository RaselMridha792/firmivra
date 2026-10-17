import { CheckCircle, PlusCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { IconTile, money } from './catalog-shared';

export interface PreviewData {
  name: string;
  icon: string | null;
  priceCents: number | null;
  description: string;
  included: string[];
  addOns: { name: string; priceCents: number }[];
}

/** The package as a client sees it: name, price, what is included and the optional add-ons. Never the internal notes. */
export function PackagePreview({ data }: { data: PreviewData }) {
  return (
    <div className="rounded-xl border border-divider bg-surface p-4" data-testid="package-preview">
      <div className="flex items-start gap-3">
        <IconTile icon={data.icon} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-display text-xl font-bold text-heading">
            {data.name || 'Package name'}
          </p>
          <p className="text-2xl font-bold text-action">
            {data.priceCents === null ? 'Price not set' : money(data.priceCents)}
          </p>
          <p className="text-sm text-muted">{data.description || 'No description yet.'}</p>
        </div>
      </div>
      <h3 className="mt-4 text-base font-bold text-heading">What&apos;s Included:</h3>
      {data.included.length === 0 ? (
        <p className="text-sm text-muted">No services are included yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {data.included.map((name) => (
            <li key={name} className="flex items-center gap-2 text-sm text-heading">
              <CheckCircle aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
              {name}
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-4 border-t border-divider pt-4 text-base font-bold text-heading">
        Optional Add-Ons:
      </h3>
      {data.addOns.length === 0 ? (
        <p className="text-sm text-muted">No optional add-ons.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {data.addOns.map((a) => (
            <li key={a.name} className="flex items-center gap-2 text-sm text-heading">
              <PlusCircle aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
              {a.name} (+{money(a.priceCents)})
            </li>
          ))}
        </ul>
      )}
      <span className="mt-4 flex min-h-11 items-center justify-center rounded-control bg-action text-base font-medium text-on-action">
        Get Started
      </span>
    </div>
  );
}

/** A numbered or iconed card of the builder and the detail page. */
export function Panel({
  title,
  step,
  aside,
  children,
  testId,
}: {
  title: string;
  step?: number;
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="min-w-0 rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {step ? (
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-sm font-bold text-on-action"
            >
              {step}
            </span>
          ) : null}
          <h2 className="text-lg font-bold text-heading">{title}</h2>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
