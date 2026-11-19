'use client';

import type { CatalogStatus } from '@firmivra/types';
import { ChecklistCard } from '@firmivra/ui';
import { ListChecks } from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

export interface PackageReadinessInput {
  name: string;
  categoryId: string;
  description: string;
  services: { included: boolean; inactive?: boolean }[];
  /** A package price is known: typed, or worked out from the discount. */
  priced: boolean;
  /** The discount's own error, if any. */
  discountError: string | null;
  /** The saved status; null for a package not saved yet. */
  status: CatalogStatus | null;
  visibleToClients: boolean;
  displayOnWebsite: boolean;
  /** The chosen Booking type's id, or ''. */
  bookingTypeId: string;
  /** The package page, where the public link is (a saved package). */
  packageId?: string | undefined;
}

/** Everything Save & Activate needs (the API's own checks), in the order the form asks for it. */
export const activationReady = (p: PackageReadinessInput) =>
  !!p.name.trim() &&
  !!p.categoryId &&
  !!p.description.trim() &&
  p.services.length > 0 &&
  !p.services.some((s) => s.inactive) &&
  p.priced &&
  !p.discountError;

/** Draft, Active, hidden or live: what clients can see now (R8). */
function stateText(p: PackageReadinessInput): string {
  if (p.status === null || p.status === 'DRAFT')
    return 'Draft: only your team sees it. Save & Activate once the first three are done.';
  if (p.status === 'ARCHIVED') return 'Archived: not offered. Restore it to offer it again.';
  if (p.status === 'INACTIVE')
    return 'Inactive: not offered to clients. Activate it to offer it again.';
  if (!p.visibleToClients || !p.displayOnWebsite)
    return 'Active, but hidden: clients see it once both "Visible to Clients" and "Display on Website/Portal" are on.';
  return 'Live: clients can open its page from your client portal and its public link.';
}

/**
 * Services & Pricing Review Two R8 and R11: before publishing, what the package still needs to
 * be activated and to be seen by clients, with where to set each thing up, and what Draft, Active
 * and Live mean. The API checks the same things on Save & Activate.
 */
export function PackageReadiness({ input }: { input: PackageReadinessInput }) {
  const p = input;
  // The same list (and cache) as the Booking Type select: is the chosen type booked online?
  const types = useApiQuery(['appointment-types', 'active'], () => api.appointmentTypes.list());
  const bookable = !!types.data?.find((t) => t.id === p.bookingTypeId)?.clientBookable;
  const items = [
    {
      id: 'details',
      label: 'Name, category and short description',
      done: !!p.name.trim() && !!p.categoryId && !!p.description.trim(),
    },
    {
      id: 'services',
      label: 'At least one service, every one of them active',
      done: p.services.length > 0 && !p.services.some((s) => s.inactive),
    },
    {
      id: 'price',
      label: 'A package price (typed, or worked out from the discount)',
      done: p.priced && !p.discountError,
    },
    { id: 'visible', label: 'Visible to Clients', done: p.visibleToClients },
    { id: 'website', label: 'Display on Website/Portal', done: p.displayOnWebsite },
    {
      id: 'booking',
      label: (
        <>
          Optional: a Booking type clients can book online, so Book opens it (
          <Link href="/calendar/types" className="text-link">
            Appointment Types
          </Link>
          )
        </>
      ),
      done: bookable,
    },
  ];
  return (
    <div className="space-y-2" data-testid="package-readiness">
      <ChecklistCard title="Ready to Publish?" icon={ListChecks} iconTone="blue" items={items} />
      <p className="rounded-lg bg-canvas p-3 text-sm text-text" data-testid="package-state">
        {stateText(p)}
      </p>
      <p className="text-xs text-muted">
        Clients reach a live package from your client portal (set up in{' '}
        <Link href="/settings/portal" className="text-link">
          Settings &gt; Client Portal
        </Link>
        ) and from its public link
        {p.packageId ? (
          <>
            {' '}
            on the{' '}
            <Link href={`/services-pricing/packages/${p.packageId}`} className="text-link">
              package page
            </Link>
          </>
        ) : null}
        .
      </p>
    </div>
  );
}
