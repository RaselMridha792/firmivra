import type { AppointmentDisplayStatus } from '@firmivra/types';
import { addDays, toInstant } from '../../_components/time';

const SCHEDULED = new Set<AppointmentDisplayStatus>(['PENDING', 'CONFIRMED', 'RESCHEDULED']);

/** Half-open range for the firm's local calendar day, including its final minute. */
export const todayAgendaRange = (date: string, timeZone: string) => ({
  from: toInstant(date, '00:00', timeZone),
  to: toInstant(addDays(date, 1), '00:00', timeZone),
});

/** The Dashboard KPI counts scheduled appointments only; its destination must show that same set. */
export const todayAgendaItems = <T extends { status: AppointmentDisplayStatus }>(
  items: readonly T[],
  fromDashboard: boolean,
): T[] => (fromDashboard ? items.filter((item) => SCHEDULED.has(item.status)) : [...items]);
