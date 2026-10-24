import type { PortalContact } from '@firmivra/types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first, as offices list their week. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** "09:00" as "9:00 AM". */
export function clockLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/**
 * An office's week as lines: consecutive days with the same hours share one line
 * ("Monday - Friday", "9:00 AM - 6:00 PM"), and a day without hours is "Closed".
 * Empty when the office has no hours at all, so nothing is invented.
 */
export function officeHoursLines(hours: PortalContact['hours']): { days: string; hours: string }[] {
  if (hours.length === 0) return [];
  const lines: { first: number; last: number; hours: string }[] = [];
  for (const weekday of WEEK) {
    const day = hours.filter((h) => h.weekday === weekday);
    const label =
      day.length === 0
        ? 'Closed'
        : day.map((h) => `${clockLabel(h.opensAt)} - ${clockLabel(h.closesAt)}`).join(', ');
    const previous = lines.at(-1);
    if (previous?.hours === label) previous.last = weekday;
    else lines.push({ first: weekday, last: weekday, hours: label });
  }
  return lines.map((l) => ({
    days: l.first === l.last ? `${DAYS[l.first]}` : `${DAYS[l.first]} - ${DAYS[l.last]}`,
    hours: l.hours,
  }));
}

/** A US number as (770) 555-0123 (Locations keeps +17705550123); any other as it is. */
export function phoneLabel(phone: string): string {
  const us = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : phone;
}

/** A phone number as a `tel:` link: its digits, with + kept. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
