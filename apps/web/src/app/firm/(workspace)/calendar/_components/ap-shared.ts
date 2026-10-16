import type {
  AgendaEntry,
  AgendaItem,
  AppointmentDisplayStatus,
  CountWithPrevious,
  MeetingMethod,
} from '@firmivra/types';
import type { KpiTrend } from '@firmivra/ui';
import { addDays, localParts, toInstant } from './time';

/** One cache root for the Appointments workspace (api.scheduling): a change refetches every view. */
export const AP = ['appointments-ws'];
export const AP_OPTIONS = [...AP, 'options'];
export const AP_SUMMARY = [...AP, 'summary'];
export const AP_AGENDA = [...AP, 'agenda'];
export const AP_RECORD = [...AP, 'record'];
export const AP_DAY = [...AP, 'day'];
export const AP_RULES = [...AP, 'rules'];
export const AP_TYPE = [...AP, 'type'];

/** The firm's zone until the API says otherwise (the API unreachable still shows today). */
export const FALLBACK_ZONE = 'America/New_York';

export const STATUS_LABELS: Record<AppointmentDisplayStatus, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  RESCHEDULED: 'Rescheduled',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-Show',
  CANCELED: 'Canceled',
};

export const STATUS_TONES: Record<
  AppointmentDisplayStatus,
  'success' | 'warning' | 'danger' | 'info' | 'purple' | 'neutral'
> = {
  DRAFT: 'neutral',
  PENDING: 'warning',
  CONFIRMED: 'success',
  RESCHEDULED: 'purple',
  COMPLETED: 'info',
  NO_SHOW: 'danger',
  CANCELED: 'neutral',
};

export const METHOD_LABELS: Record<MeetingMethod, string> = {
  IN_PERSON: 'In Person',
  PHONE: 'Phone',
  VIDEO: 'Zoom / Video',
  OTHER: 'Other',
};

/** The Location column's short word: Zoom, In-Person, Phone. */
export const METHOD_SHORT: Record<MeetingMethod, string> = {
  IN_PERSON: 'In-Person',
  PHONE: 'Phone',
  VIDEO: 'Zoom',
  OTHER: 'Other',
};

export const isFull = (entry: AgendaEntry): entry is AgendaItem => !entry.restricted;

export const entryName = (item: AgendaItem) =>
  item.internal ? item.type?.name || 'Team Meeting' : item.contact.name;

/** "Sep 22, 2026" from an instant, in the firm's zone. */
export const dateLabel = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** "10:00 AM". */
export const clock = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });

/** The instants of a firm-local date's whole day. */
export const dayRange = (date: string, timeZone: string, days = 1) => ({
  from: toInstant(date, '00:00', timeZone),
  to: toInstant(addDays(date, days), '00:00', timeZone),
});

export const dateOf = (iso: string, timeZone: string) => localParts(iso, timeZone).date;

/** "↑ 20% vs last month": the change against the same period a month earlier. */
export function trendOf(
  count: CountWithPrevious | undefined,
  goodWhenUp: boolean,
): KpiTrend | undefined {
  if (!count || count.previous === null || count.previous === 0) return undefined;
  const change = Math.round(((count.value - count.previous) / count.previous) * 100);
  if (change === 0) return { text: 'No change', direction: 'flat' };
  const up = change > 0;
  return { text: `${Math.abs(change)}%`, direction: up ? 'up' : 'down', good: up === goodWhenUp };
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/** "R. Davis" from "Rosa Davis". */
export const shortName = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length < 2 ? name : `${parts[0]?.[0]}. ${parts.slice(1).join(' ')}`;
};

/** The grid components take Dates; calendar days here are YYYY-MM-DD strings (see time.ts). */
export const toDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1);
};
export const fromDate = (date: Date) =>
  `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The first of the month, a number of months away. */
export const addMonths = (date: string, months: number) => {
  const d = toDate(date);
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return fromDate(d);
};
