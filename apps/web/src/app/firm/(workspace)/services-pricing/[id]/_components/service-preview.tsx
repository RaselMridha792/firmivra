'use client';

import {
  ArrowLeft,
  CheckCircle,
  Eye,
  PlusCircle,
  Tag,
  User,
  Briefcase,
  BookOpen,
  ChartBar,
  PencilSimple,
  type Icon,
} from '@phosphor-icons/react';
import type { CatalogService } from '@firmivra/types';
import { Badge, Button, Card, Modal, PageHeader } from '@firmivra/ui';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';

const icons: Record<string, Icon> = {
  user: User,
  briefcase: Briefcase,
  book: BookOpen,
  'chart-bar': ChartBar,
  tag: Tag,
};
function price(service?: CatalogService) {
  if (!service) return 'No price available.';
  if (service.price.type === 'CUSTOM_QUOTE') return 'Quote required';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    (service.price.amountCents ?? 0) / 100,
  );
  if (service.price.type === 'STARTING_AT') return `Starting at ${amount}`;
  if (service.price.type === 'HOURLY') return `${amount}/hour`;
  if (service.price.type === 'RECURRING')
    return `${amount} / ${(service.price.frequency ?? 'MONTHLY').toLowerCase().replaceAll('_', ' ')}`;
  return amount;
}
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-divider bg-surface"
      data-testid={`preview-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`}
    >
      <h2 className="flex items-center gap-2 bg-table-head px-4 py-3 text-sm font-bold text-heading">
        <Eye weight="fill" className="size-5 text-action" />
        {title}
      </h2>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}
function PublicService({
  service,
  expanded = false,
}: {
  service?: CatalogService;
  expanded?: boolean;
}) {
  const Glyph = icons[service?.icon ?? ''] ?? Tag;
  return (
    <Card
      className="min-w-0 space-y-5"
      data-testid={expanded ? 'service-full-preview' : 'service-client-preview'}
    >
      <div className="flex items-start gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
          <Glyph weight="fill" className="size-9" />
        </span>
        <div className="min-w-0">
          <h2 className="break-words font-display text-2xl font-bold text-heading">
            {service?.name ?? 'Service Preview'}
          </h2>
          <p className="mt-1 text-xl font-bold text-action">{price(service)}</p>
          <p className="mt-2 break-words text-sm text-muted">
            {service?.shortDescription ?? 'No description available.'}
          </p>
        </div>
      </div>
      {expanded ? (
        <div>
          <h3 className="font-semibold text-heading">Service Details</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
            {service?.fullDescription?.replace(/<[^>]*>/g, ' ') || 'No service details available.'}
          </p>
        </div>
      ) : null}
      <div>
        <h3 className="font-semibold text-heading">What&apos;s Included:</h3>
        <ul className="mt-3 space-y-2">
          {service?.included.map((text) => (
            <li key={text} className="flex gap-2 text-sm">
              <CheckCircle weight="fill" className="size-5 shrink-0 text-action" />
              <span className="break-words">{text}</span>
            </li>
          ))}
        </ul>
        {!service?.included.length ? (
          <p className="mt-2 text-sm text-muted">No included items listed.</p>
        ) : null}
      </div>
      {expanded ? (
        <div>
          <h3 className="font-semibold text-heading">Not Included</h3>
          <ul className="mt-2 list-inside list-disc space-y-2 text-sm">
            {service?.notIncluded.map((text) => (
              <li key={text} className="break-words">
                {text}
              </li>
            ))}
          </ul>
          {!service?.notIncluded.length ? (
            <p className="text-sm text-muted">No exclusions listed.</p>
          ) : null}
        </div>
      ) : null}
      <div className="border-t border-divider pt-3">
        <h3 className="font-semibold text-heading">Optional Add-Ons:</h3>
        <ul className="mt-3 space-y-2">
          {service?.addOns
            .filter((a) => a.status === 'ACTIVE' && a.clientSelectable)
            .map((a) => (
              <li key={a.id} className="flex gap-2 text-sm">
                <PlusCircle weight="fill" className="size-5 shrink-0 text-action" />
                <span className="break-words">
                  {a.name} (+
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                    a.priceCents / 100,
                  )}
                  )
                </span>
              </li>
            ))}
        </ul>
        {!service?.addOns.some((a) => a.status === 'ACTIVE' && a.clientSelectable) ? (
          <p className="mt-2 text-sm text-muted">No optional add-ons available.</p>
        ) : null}
      </div>
      <Button className="w-full" disabled title="Booking is unavailable in the staff preview">
        Book This Service
      </Button>
    </Card>
  );
}

export function ServicePreview({ serviceId }: { serviceId: string }) {
  const query = useApiQuery(['services-pricing', 'service', serviceId], () =>
    api.servicesPricing.service(serviceId),
  );
  const service = query.isError ? undefined : query.data;
  const [full, setFull] = useState(false);
  return (
    <div className="min-w-0 space-y-5" data-testid="service-preview-page">
      <PageHeader
        title="Service Preview"
        subtitle="See how this service appears to clients."
        icon={Eye}
        above={
          <nav aria-label="Breadcrumb" className="text-sm text-action">
            <Link href="/services-pricing">Services &amp; Pricing</Link>
            <span className="mx-2 text-muted">›</span>
            <span className="text-heading">Service Preview</span>
          </nav>
        }
        actions={
          <>
            <Link
              href="/services-pricing"
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm text-action"
            >
              <ArrowLeft className="size-4" />
              Back to Services
            </Link>
            <Link
              href={`/services-pricing/${serviceId}/edit`}
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-4 text-sm text-on-action"
            >
              <PencilSimple weight="fill" className="size-4" />
              Edit Service
            </Link>
          </>
        }
      />
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Frame title="Service Preview (Client View)">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge tone={service?.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {service?.status ?? 'Unavailable'}
              </Badge>
              <Button variant="outline" onClick={() => setFull(true)}>
                <Eye weight="fill" className="size-4" />
                View Full Page
              </Button>
            </div>
            <PageState query={query}>{() => null}</PageState>
            <PublicService service={service} />
          </Frame>
        </div>
        <aside className="min-w-0 space-y-4">
          <Frame title="Service Details">
            <p className="whitespace-pre-wrap break-words text-sm text-muted">
              {service?.fullDescription?.replace(/<[^>]*>/g, ' ') ||
                'No service details available.'}
            </p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt className="text-muted">Category</dt>
              <dd className="break-words">{service?.category?.name ?? 'Not available'}</dd>
              <dt className="text-muted">Pricing</dt>
              <dd className="break-words">{price(service)}</dd>
            </dl>
          </Frame>
          <Frame title="Not Included">
            {service?.notIncluded.length ? (
              <ul className="list-inside list-disc space-y-2 text-sm">
                {service.notIncluded.map((text) => (
                  <li key={text} className="break-words">
                    {text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No exclusions listed.</p>
            )}
          </Frame>
        </aside>
      </div>
      <Modal open={full} title="Service Preview (Client View)" onClose={() => setFull(false)}>
        {full ? <PublicService service={service} expanded /> : null}
      </Modal>
    </div>
  );
}
