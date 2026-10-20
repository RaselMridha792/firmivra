import {
  ENVIRONMENTS,
  LOG_OUTCOMES,
  LOG_SEVERITIES,
  LOG_SOURCES,
  type IntegrationEnvironment,
  type LogOutcome,
  type LogExportQuery,
  type LogQuery,
  type LogSeverity,
  type LogSource,
} from '../../_components/integrations-contract';

/**
 * The Integration Logs filters (docx §9: search, integration, source, severity, event type,
 * environment, outcome, request or correlation id, firm, date range; they combine with AND). They
 * live in the address, so a deep link opens the log already filtered (docx §13:
 * `?integration=<id>` from a platform integration) and `?log=<id>` opens one record.
 */

export interface LogFilters {
  search: string;
  integration: string;
  source: LogSource | '';
  severity: LogSeverity | '';
  eventType: string;
  environment: IntegrationEnvironment | '';
  outcome: LogOutcome | '';
  requestId: string;
  firm: string;
  /** `YYYY-MM-DD` on the viewer's calendar, or empty for no bound. */
  from: string;
  to: string;
  /** Newest first unless the Time column was flipped. */
  descending: boolean;
  page: number;
}

export const EMPTY_FILTERS: LogFilters = {
  search: '',
  integration: '',
  source: '',
  severity: '',
  eventType: '',
  environment: '',
  outcome: '',
  requestId: '',
  firm: '',
  from: '',
  to: '',
  descending: true,
  page: 1,
};

export const PAGE_SIZE = 20;

/** The page's query string, as the server passes it. */
export type AddressQuery = Record<string, string | string[] | undefined>;

const oneOf = <T extends string>(list: readonly T[], value: string): T | '' =>
  list.find((item) => item === value) ?? '';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** One value of the address, trimmed to the search limit. */
export function addressValue(address: AddressQuery, key: string): string {
  const value = address[key];
  return ((Array.isArray(value) ? value[0] : value) ?? '').slice(0, 100);
}

export function readFilters(address: AddressQuery): LogFilters {
  const get = (key: string) => addressValue(address, key);
  const page = Number(get('page'));
  return {
    search: get('q'),
    integration: get('integration'),
    source: oneOf(LOG_SOURCES, get('source')),
    severity: oneOf(LOG_SEVERITIES, get('severity')),
    eventType: get('event'),
    environment: oneOf(ENVIRONMENTS, get('environment')),
    outcome: oneOf(LOG_OUTCOMES, get('outcome')),
    requestId: get('request'),
    firm: get('firm'),
    from: DAY.test(get('from')) ? get('from') : '',
    to: DAY.test(get('to')) ? get('to') : '',
    descending: get('order') !== 'asc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** The address for these filters and the open record, without the defaults. */
export function addressOf(filters: LogFilters, logId: string | null): string {
  const params = new URLSearchParams();
  const put = (key: string, value: string) => {
    if (value) params.set(key, value);
  };
  put('q', filters.search);
  put('integration', filters.integration);
  put('source', filters.source);
  put('severity', filters.severity);
  put('event', filters.eventType);
  put('environment', filters.environment);
  put('outcome', filters.outcome);
  put('request', filters.requestId);
  put('firm', filters.firm);
  put('from', filters.from);
  put('to', filters.to);
  if (!filters.descending) params.set('order', 'asc');
  if (filters.page > 1) params.set('page', String(filters.page));
  put('log', logId ?? '');
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

/** Any filter on (paging and order are not filters). */
export const isFiltered = (filters: LogFilters) =>
  (
    [
      'search',
      'integration',
      'source',
      'severity',
      'eventType',
      'environment',
      'outcome',
      'requestId',
      'firm',
      'from',
      'to',
    ] as const
  ).some((key) => filters[key] !== '');

/** Whole days on the viewer's calendar, as ISO moments. */
const startOf = (day: string) => (day ? new Date(`${day}T00:00:00`).toISOString() : undefined);
const endOf = (day: string) => (day ? new Date(`${day}T23:59:59.999`).toISOString() : undefined);

const fieldsOf = (filters: LogFilters) => ({
  search: filters.search.trim() || undefined,
  integrationId: filters.integration || undefined,
  source: filters.source || undefined,
  severity: filters.severity || undefined,
  eventType: filters.eventType || undefined,
  environment: filters.environment || undefined,
  outcome: filters.outcome || undefined,
  requestId: filters.requestId.trim() || undefined,
  firmId: filters.firm || undefined,
  from: startOf(filters.from),
  to: endOf(filters.to),
});

/** The list call's query for these filters (its flags are text in the address). */
export function queryOf(filters: LogFilters): LogQuery {
  return {
    ...fieldsOf(filters),
    descending: filters.descending ? 'true' : 'false',
    page: filters.page,
    pageSize: PAGE_SIZE,
  };
}

/** The export's filters: the list's without the paging. */
export function exportQueryOf(filters: LogFilters): LogExportQuery {
  return { ...fieldsOf(filters), descending: filters.descending };
}
