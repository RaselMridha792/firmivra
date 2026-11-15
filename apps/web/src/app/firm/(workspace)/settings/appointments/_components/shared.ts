'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

/** The settings page's one read: rooms, equipment and the offices they belong to. */
export const RESOURCES = ['appointmentResources'] as const;

/** The scheduling form's options (live rooms and items), cached under the Appointments key. */
const SCHEDULING = ['scheduling'] as const;

/** This page's own API codes (lib/errors.ts has the general ones). */
export const RESOURCE_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: 'That name is already in use. Choose another.',
  NOT_FOUND: 'This is no longer available. Reload the page.',
  FORBIDDEN: 'Only owners and admins can change appointment settings.',
};

/** "2 upcoming appointments": a room's or item's live bookings from now on. */
export const upcomingLabel = (n: number) =>
  n === 0 ? 'No upcoming appointments' : `${n} upcoming appointment${n === 1 ? '' : 's'}`;

/**
 * A change of a room or item: the page refetches its list, and Schedule Appointment its options,
 * so what was added or archived here is what the form offers next.
 */
export function useResourceChange<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: RESOURCES });
      await client.invalidateQueries({ queryKey: SCHEDULING });
    },
  });
}
