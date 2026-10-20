import { USAGE_SCOPES, type UsageScope } from '../../_components/integrations-contract';

/**
 * What Usage & Analytics shows (docx §10): a scope (Firmivra's platform integrations, the
 * customer catalog's adoption, or Firmivra's API keys), one subject or all of them, and a range
 * of whole UTC days (the rollup's days), the last 30 by default. It lives in the address, so
 * `?integration=<id>` from a platform integration opens its usage (docx §13).
 */

export const PRESETS = ['7', '30', '90'] as const;
export type Preset = (typeof PRESETS)[number] | 'custom';
export const PRESET_LABELS: Record<Preset, string> = {
  '7': 'Last 7 days',
  '30': 'Last 30 days',
  '90': 'Last 90 days',
  custom: 'Custom range',
};

export interface UsageView {
  scope: UsageScope;
  /** A subject key, or empty for the whole scope. */
  subject: string;
  preset: Preset;
  /** `YYYY-MM-DD` (UTC days), inclusive. */
  from: string;
  to: string;
}

/** The page's query string, as the server passes it. */
export type AddressQuery = Record<string, string | string[] | undefined>;

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The UTC day `offset` days from `day`. */
export const shiftDay = (day: string, offset: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
/** Today as a UTC day. */
export const utcToday = () => new Date().toISOString().slice(0, 10);
/** Days in an inclusive range. */
export const daysIn = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/** The last `days` days, today included. */
export const presetRange = (preset: (typeof PRESETS)[number], today: string) => ({
  from: shiftDay(today, 1 - Number(preset)),
  to: today,
});

/** Why a custom range cannot be shown, or null when it can. */
export function rangeProblem(from: string, to: string): string | null {
  if (!DAY.test(from) || !DAY.test(to)) return 'Choose both a start and an end date.';
  if (from > to) return 'The start date must be on or before the end date.';
  if (daysIn(from, to) > 367) return 'Choose a range of a year or less.';
  return null;
}

const get = (address: AddressQuery, key: string) => {
  const value = address[key];
  return ((Array.isArray(value) ? value[0] : value) ?? '').slice(0, 100);
};

export function readView(address: AddressQuery, today: string): UsageView {
  const integration = get(address, 'integration');
  const scope = integration
    ? 'PLATFORM_INTEGRATION'
    : (USAGE_SCOPES.find((item) => item === get(address, 'scope')) ?? 'PLATFORM_INTEGRATION');
  const subject = integration || get(address, 'subject');
  const from = get(address, 'from');
  const to = get(address, 'to');
  if (from && to && !rangeProblem(from, to)) return { scope, subject, preset: 'custom', from, to };
  const preset = PRESETS.find((item) => item === get(address, 'range')) ?? '30';
  return { scope, subject, preset, ...presetRange(preset, today) };
}

/** The address for this view, without the defaults. */
export function addressOf(view: UsageView): string {
  const params = new URLSearchParams();
  if (view.scope !== 'PLATFORM_INTEGRATION') params.set('scope', view.scope);
  if (view.subject) params.set('subject', view.subject);
  if (view.preset === 'custom') {
    params.set('from', view.from);
    params.set('to', view.to);
  } else if (view.preset !== '30') params.set('range', view.preset);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}
