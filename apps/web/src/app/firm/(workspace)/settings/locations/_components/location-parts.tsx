'use client';

import {
  LOCATION_DUPLICATE_MESSAGE,
  type LocationHoursInterval,
  type LocationRow,
} from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import { Star } from '@phosphor-icons/react';

// Settings > Locations (Octavia's settings review, Oct 20; guide
// docs/specs/settings-review-2026-10-20/locations--*.md; R1's contract
// packages/types/src/settings/locations.ts). Shared words and formats for the list, the profile,
// the forms and the dialogs.

export const LOCATIONS = ['locations'] as const;

/** The API's error codes in the guide's words (the duplicate message is the API's own). */
export const LOCATION_ERRORS: Record<string, string> = {
  DUPLICATE_LOCATION: LOCATION_DUPLICATE_MESSAGE,
  LOCATION_LIMIT: "Your plan's locations are all in use. Manage your plan in Billing to add one.",
  SAVE_CONFLICT: 'Someone else saved this location meanwhile. Reload it to see their changes.',
  LOCATION_IS_PRIMARY: 'This is the primary location. Set another location as primary first.',
  PENDING_ACTION_EXISTS: 'A change is already scheduled here. Edit or cancel it first.',
  ACTION_FINISHED: 'This scheduled change has already run or been cancelled.',
  MANAGER_NOT_ELIGIBLE: 'Choose an active member of your firm.',
  FORBIDDEN: 'Only a Super Administrator can do this.',
};

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
/** Monday first, as the designs list the week. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** "+15551234567" as "(555) 123-4567"; other countries as stored. */
export function phoneText(e164: string | null | undefined): string {
  if (!e164) return '';
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164;
}

/** "09:00" as "9:00 AM". */
export function time12(value: string): string {
  const [h = 0, m = 0] = value.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** The street line, or Online / Remote for a virtual location. */
export function streetText(r: Pick<LocationRow, 'kind' | 'addressLine1' | 'addressLine2'>) {
  if (r.kind === 'VIRTUAL') return 'Online / Remote';
  return [r.addressLine1, r.addressLine2].filter(Boolean).join(', ');
}

/** "Auburn, GA 30011", or N/A. */
export function cityText(r: Pick<LocationRow, 'city' | 'state' | 'postalCode'>) {
  const tail = [r.state, r.postalCode].filter(Boolean).join(' ');
  return [r.city, tail].filter(Boolean).join(', ') || 'N/A';
}

/** The whole address on one line. */
export function addressText(r: LocationRow) {
  if (r.kind === 'VIRTUAL') return 'Online / Remote';
  return [streetText(r), cityText(r)].filter(Boolean).join(', ');
}

/** One day's blocks: "9:00 AM – 12:00 PM, 1:00 PM – 5:00 PM", or Closed. */
export function dayText(hours: LocationHoursInterval[], weekday: number) {
  const blocks = hours
    .filter((h) => h.weekday === weekday)
    .sort((a, b) => a.opensAt.localeCompare(b.opensAt));
  return blocks.length
    ? blocks.map((h) => `${time12(h.opensAt)} – ${time12(h.closesAt)}`).join(', ')
    : 'Closed';
}

/**
 * The week in one line: days with the same blocks together, runs of days as ranges ("Mon – Fri,
 * 9:00 AM – 5:00 PM"; "Mon – Tue, Thu – Fri 9:00 AM – 5:00 PM; Wed 9:00 AM – 12:00 PM, ...").
 */
export function hoursSummary(hours: LocationHoursInterval[]) {
  if (!hours.length) return 'No hours set';
  const short = (d: number) => WEEKDAYS[d]!.slice(0, 3);
  const groups = new Map<string, number[]>();
  for (const d of WEEK_ORDER) {
    if (!hours.some((h) => h.weekday === d)) continue;
    const text = dayText(hours, d);
    groups.set(text, [...(groups.get(text) ?? []), d]);
  }
  const ranges = (days: number[]) => {
    const out: string[] = [];
    let first = days[0]!;
    let last = first;
    const at = (d: number) => WEEK_ORDER.indexOf(d as (typeof WEEK_ORDER)[number]);
    for (const d of days.slice(1)) {
      if (at(d) === at(last) + 1) last = d;
      else {
        out.push(first === last ? short(first) : `${short(first)} – ${short(last)}`);
        first = last = d;
      }
    }
    out.push(first === last ? short(first) : `${short(first)} – ${short(last)}`);
    return out.join(', ');
  };
  return [...groups.entries()].map(([text, days]) => `${ranges(days)}, ${text}`).join('; ');
}

export function StatusBadge({ status }: { status: LocationRow['status'] }) {
  return (
    <Badge tone={status === 'ACTIVE' ? 'success' : 'neutral'}>
      <span
        aria-hidden
        className={`mr-1.5 inline-block size-2 rounded-full ${status === 'ACTIVE' ? 'bg-success' : 'bg-heading'}`}
      />
      {status === 'ACTIVE' ? 'Active' : 'Inactive'}
    </Badge>
  );
}

export function PrimaryBadge() {
  return (
    <Badge tone="warning">
      <Star aria-hidden weight="fill" className="mr-1 size-3.5 text-gold" />
      Primary
    </Badge>
  );
}

/** "Oct 16, 2026" and "10:24 AM". */
export const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const clockOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
