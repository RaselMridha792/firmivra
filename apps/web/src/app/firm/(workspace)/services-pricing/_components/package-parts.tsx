'use client';

import { CheckCircle, Eye, PlusCircle, Warning } from '@phosphor-icons/react';
import type { PackagePricing } from '@firmivra/types';
import { Badge, Button, Checkbox, Modal } from '@firmivra/ui';
import { useState, type ReactNode } from 'react';
import { IconTile, money } from './catalog-shared';

export interface PreviewData {
  name: string;
  icon: string | null;
  priceCents: number | null;
  description: string;
  /** The included services; a Custom Quote one is marked "Quote required". */
  included: { name: string; quoteRequired: boolean }[];
  addOns: { name: string; priceCents: number; description?: string | null }[];
  /** "Allow Client to Add Optional Add-Ons": the full page lets the client tick them. */
  allowClientAddOns?: boolean;
}

/** The package as a client sees it: name, price, what is included and the optional add-ons. Never the internal notes. */
export function PackagePreview({ data }: { data: PreviewData }) {
  return (
    <div
      className="rounded-xl border border-divider bg-surface p-4"
      data-testid="package-client-preview"
    >
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
          {data.included.map((s) => (
            <li key={s.name} className="flex items-center gap-2 text-sm text-heading">
              <CheckCircle aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
              {s.name}
              {s.quoteRequired ? (
                <span className="text-xs text-muted">(Quote required)</span>
              ) : null}
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

/**
 * The full client page (Octavia's S8), from what is on the form now: the package, each included
 * service (a Custom Quote one says so), and the offered add-ons. When clients may add add-ons they
 * tick them here and the total follows. Never the internal notes; nothing is booked or bought.
 */
function FullPage({ data }: { data: PreviewData }) {
  const [picked, setPicked] = useState<string[]>([]);
  const extra = data.addOns
    .filter((a) => picked.includes(a.name))
    .reduce((sum, a) => sum + a.priceCents, 0);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="package-full-preview">
      <div className="flex items-start gap-3">
        <IconTile icon={data.icon} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="wrap-break-word font-display text-2xl font-bold text-heading">
            {data.name || 'Package name'}
          </h3>
          <p className="text-2xl font-bold text-action">
            {data.priceCents === null ? 'Price not set' : money(data.priceCents)}
          </p>
          <p className="wrap-break-word text-sm text-text">
            {data.description || 'No description yet.'}
          </p>
        </div>
      </div>
      <section>
        <h4 className="text-base font-bold text-heading">What&apos;s Included:</h4>
        {data.included.length === 0 ? (
          <p className="text-sm text-muted">No services are included yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {data.included.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center gap-2 text-sm text-heading">
                <CheckCircle aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
                <span className="wrap-break-word">{s.name}</span>
                {s.quoteRequired ? <Badge tone="warning">Quote required</Badge> : null}
              </li>
            ))}
          </ul>
        )}
        {data.included.some((s) => s.quoteRequired) ? (
          <p className="mt-2 text-xs text-muted">
            A service marked Quote required is priced after the firm reviews your needs.
          </p>
        ) : null}
      </section>
      <section className="border-t border-divider pt-4">
        <h4 className="text-base font-bold text-heading">Optional Add-Ons:</h4>
        {data.addOns.length === 0 ? (
          <p className="text-sm text-muted">No optional add-ons.</p>
        ) : data.allowClientAddOns ? (
          <ul className="mt-2 flex flex-col gap-3">
            {data.addOns.map((a) => (
              <li key={a.name} className="flex min-w-0 flex-col gap-1">
                <Checkbox
                  label={`${a.name} (+${money(a.priceCents)})`}
                  checked={picked.includes(a.name)}
                  onChange={(e) =>
                    setPicked((now) =>
                      e.target.checked ? [...now, a.name] : now.filter((n) => n !== a.name),
                    )
                  }
                />
                {a.description ? <p className="pl-7 text-xs text-muted">{a.description}</p> : null}
              </li>
            ))}
          </ul>
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
      </section>
      {data.allowClientAddOns && data.addOns.length > 0 && data.priceCents !== null ? (
        <p className="text-base text-text" data-testid="full-preview-total">
          Total with the add-ons ticked: <strong>{money(data.priceCents + extra)}</strong>
        </p>
      ) : null}
      {/* Drawn as clients see it; checkout is not part of this staff preview. */}
      <span className="flex min-h-11 items-center justify-center rounded-control bg-action text-base font-medium text-on-action">
        Get Started
      </span>
    </div>
  );
}

/** View Full Page, for a preview panel's header: opens the full client page in a dialog. */
export function ViewFullPage({ data }: { data: PreviewData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        className="shrink-0 text-xs whitespace-nowrap"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <Eye aria-hidden weight="fill" className="size-4" />
        View Full Page
      </Button>
      <Modal open={open} title="Package Preview (Client View)" onClose={() => setOpen(false)}>
        {open ? <FullPage data={data} /> : null}
      </Modal>
    </>
  );
}

/** "Total of Selected Services": none when a service needs a quote, never $0 (Octavia's S9). */
export const selectedTotal = (pricing: PackagePricing | null | undefined) =>
  pricing?.quoteRequired ? 'Unavailable: quote required' : money(pricing?.totalSelectedCents);

/** The warning beside the pricing when an included service needs a quote (S9). */
export function QuoteRequiredNote() {
  return (
    <p
      role="status"
      className="mt-3 flex items-center gap-2 rounded-lg bg-warning-soft p-3 text-sm text-text"
      data-testid="quote-required-note"
    >
      <Warning aria-hidden weight="fill" className="size-5 shrink-0 text-gold" />A service in this
      package needs a quote, so there is no total to compare and no savings to show. Clients see the
      package price.
    </p>
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
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
