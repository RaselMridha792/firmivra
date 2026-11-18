import type { IntegrationRequestRow } from '@firmivra/types';

// I-UA03 (Integrations Review Two): a firm's integration request has a reference it can quote, a
// date and a status, here and on the Requests list (I-UA02).

export const REQUEST_STATUS_LABELS: Record<IntegrationRequestRow['status'], string> = {
  NEW: 'New',
  REVIEWING: 'In review',
  PLANNED: 'Planned',
  IN_DEVELOPMENT: 'In development',
  AVAILABLE: 'Available',
  DECLINED: 'Declined',
};

/** The reference a firm quotes for a request: "IR-" and the first eight characters of its id. */
export function requestReference(id: string): string {
  return `IR-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

/** "Nov 18, 2026": the day a request was sent or last changed. */
export function requestDay(value: string): string {
  return day.format(new Date(value));
}
