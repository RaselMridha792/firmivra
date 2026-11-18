'use client';

import type { ServicePackage } from '@firmivra/types';
import { Select } from '@firmivra/ui';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

/**
 * S12 (decided Nov 19): a package's Booking type, one of the firm's active appointment types. The
 * package's public page has Book for it while clients can book it online; with none, the page
 * keeps its sign-in and contact path. A saved type that was archived since stays listed.
 */
export function BookingTypeSelect({
  value,
  onChange,
  saved,
}: {
  value: string;
  onChange: (typeId: string) => void;
  saved?: ServicePackage['bookingType'];
}) {
  const types = useApiQuery(['appointment-types', 'active'], () => api.appointmentTypes.list());
  const list = types.data ?? [];
  const chosen = list.find((t) => t.id === value);
  const archived = saved && saved.id === value && !chosen ? saved : null;
  const hint = !value
    ? 'The package page asks clients to sign in and contact you.'
    : (chosen && !chosen.clientBookable) || archived
      ? 'Clients cannot book this type online, so the package page asks them to sign in and contact you.'
      : 'The package page’s Book opens this appointment’s booking.';
  return (
    <Select
      label="Booking Type"
      hint={types.isError ? 'Appointment types are not available right now.' : hint}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={[
        { value: '', label: 'None' },
        ...(archived ? [{ value: archived.id, label: `${archived.name} (archived)` }] : []),
        ...list.map((t) => ({
          value: t.id,
          label: t.clientBookable ? t.name : `${t.name} (not booked online)`,
        })),
      ]}
      data-testid="package-booking-type"
    />
  );
}
