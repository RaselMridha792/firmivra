import type {
  BulkClientsResponse,
  ClientStatus,
  ClientsKpi,
  ListClientsQuery,
} from '@firmivra/types';
import type { KpiTrend } from '@firmivra/ui';
import { CLIENTS, dateText } from './client-parts';

/** The list's queries; a change to any client refetches them (they start with CLIENTS). */
export const clientsListKey = (query: ListClientsQuery) => [...CLIENTS, 'list', query] as const;
export const CLIENTS_SUMMARY = [...CLIENTS, 'summary'] as const;

/** Rows per page: the design shows 8. */
export const PAGE_SIZES = [8, 25, 50, 100];

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'neutral';

/** The firm's stages in the design's words ("New Client", "Pending Docs") and pill colours. */
export const STAGES: Record<ClientStatus, { label: string; tone: BadgeTone }> = {
  NEW: { label: 'New Client', tone: 'info' },
  PENDING_DOCUMENTS: { label: 'Pending Docs', tone: 'warning' },
  IN_PROGRESS: { label: 'In Progress', tone: 'purple' },
  ACTIVE: { label: 'Active', tone: 'success' },
  ON_HOLD: { label: 'On Hold', tone: 'danger' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
};
export const STAGE_ORDER = Object.keys(STAGES) as ClientStatus[];

export type Records = NonNullable<ListClientsQuery['status']>;

/** What the filter row, the tabs and More Filters set; the list query is built from it. */
export interface ClientFilters {
  /** As typed; the query waits until typing pauses. */
  search: string;
  serviceId: string;
  clientStatus: ClientStatus | '';
  assignedUserId: string;
  /** Last activity, calendar days YYYY-MM-DD or ''. */
  from: string;
  to: string;
  /** Current (not archived) clients, archived ones, or both. */
  records: Records;
}

export const NO_FILTERS: ClientFilters = {
  search: '',
  serviceId: '',
  clientStatus: '',
  assignedUserId: '',
  from: '',
  to: '',
  records: 'active',
};

/** The tab that shows the same clients as these filters, or '' when none does. */
export function tabFor(filters: ClientFilters): string {
  if (filters.serviceId) return filters.clientStatus ? '' : `service:${filters.serviceId}`;
  const byStage: Partial<Record<ClientStatus | '', string>> = {
    '': 'all',
    ACTIVE: 'active',
    NEW: 'new',
    INACTIVE: 'inactive',
  };
  return byStage[filters.clientStatus] ?? '';
}

/** The filters a tab sets: a stage or a service, never both. */
export function filtersForTab(id: string): Pick<ClientFilters, 'serviceId' | 'clientStatus'> {
  if (id.startsWith('service:')) return { serviceId: id.slice(8), clientStatus: '' };
  const stage = ({ active: 'ACTIVE', new: 'NEW', inactive: 'INACTIVE' } as const)[
    id as 'active' | 'new' | 'inactive'
  ];
  return { serviceId: '', clientStatus: stage ?? '' };
}

/**
 * Month-on-month change for a KPI card, only from the numbers the API gives: none when there is
 * no history (`previous` null) or nothing to compare with (0), as the dashboard's cards do.
 */
export function monthTrend(kpi: ClientsKpi): KpiTrend | undefined {
  if (!kpi.previous) return undefined;
  if (kpi.value === kpi.previous) return { text: 'No change', direction: 'flat' };
  const change = ((kpi.value - kpi.previous) / kpi.previous) * 100;
  const shown = Math.round(Math.abs(change));
  return {
    text: shown ? `${shown}%` : '<1%',
    direction: change > 0 ? 'up' : 'down',
    good: change > 0,
  };
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
/** Cents as $1,290.00. */
export const money = (cents: number) => usd.format(cents / 100);

export const timeText = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeStyle: 'short' });

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "Today" and the time, "Yesterday", or the date, as the Last Activity column shows them. */
export function activityText(iso: string, now = new Date()): { day: string; time?: string } {
  const at = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(at, now)) return { day: 'Today', time: timeText(iso) };
  if (sameDay(at, yesterday)) return { day: 'Yesterday' };
  return { day: dateText(iso) };
}

/** "Kim Allen" as "K. Allen", as the Assigned To column shows people. */
export function shortName(name: string) {
  const words = name.trim().split(/\s+/);
  const first = words[0];
  const last = words.at(-1);
  return words.length > 1 && first && last ? `${first.charAt(0)}. ${last}` : name;
}

const SKIP_REASONS: Record<string, string> = {
  CLIENT_ARCHIVED: 'archived; restore it first',
};

/** "2 clients updated. 1 skipped: Pat Archived (archived; restore it first)." */
export function bulkSummary(
  result: BulkClientsResponse,
  verb: string,
  names: ReadonlyMap<string, string>,
) {
  const noun = (n: number) => (n === 1 ? 'client' : 'clients');
  const done = `${result.updated} ${noun(result.updated)} ${verb}.`;
  if (!result.skipped.length) return done;
  const skipped = result.skipped
    .map(
      (s) =>
        `${names.get(s.clientId) ?? 'A client'} (${SKIP_REASONS[s.code] ?? s.code.toLowerCase()})`,
    )
    .join(', ');
  return `${done} ${result.skipped.length} skipped: ${skipped}.`;
}
