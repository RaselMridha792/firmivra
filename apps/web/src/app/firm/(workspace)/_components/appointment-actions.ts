import { roleCan } from '@firmivra/types';

export type RowAction =
  'view' | 'edit' | 'reschedule' | 'remind' | 'complete' | 'cancel' | 'client' | 'lead';

/**
 * Octavia's A3: what an Upcoming Appointments row offers, by the member's role grid: View Details
 * always; Edit, Reschedule, Send Reminder, Mark Complete and Cancel only to a role that may edit
 * appointments; Open Client to one that may view clients, or for a lead's own appointment, Open
 * Lead to one that may view leads. Each page still checks its own permission.
 */
export function rowActions(
  can: (
    module: Parameters<typeof roleCan>[1],
    capability: Parameters<typeof roleCan>[2],
  ) => boolean,
  a: { client: unknown; lead: unknown },
): RowAction[] {
  const changing: RowAction[] = can('APPOINTMENTS', 'EDIT')
    ? ['edit', 'reschedule', 'remind', 'complete', 'cancel']
    : [];
  const record: RowAction[] =
    a.client && can('CLIENTS', 'VIEW')
      ? ['client']
      : !a.client && a.lead && can('LEADS', 'VIEW')
        ? ['lead']
        : [];
  return ['view', ...changing, ...record];
}
