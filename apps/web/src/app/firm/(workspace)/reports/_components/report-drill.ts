import type { ReportFilterCondition, ReportRowLink } from '@firmivra/types';
import type { FilterDraft } from './filter-rules';
import { pack, unpack } from './report-drafts';

// RP-F17 (Octavia's Reports review, Oct 28): a report's rows open their records in the same tab,
// and Back returns to the report as it was (search, filters, sort, page, columns). The rows are
// only those the viewer may see (the API's reach), and each record's page checks its own access.

/** Where a record opens; a payment opens through its invoice (it has no page of its own). */
export function recordHref(link: ReportRowLink): string | null {
  switch (link.kind) {
    case 'CLIENT':
      return `/clients/${link.id}`;
    case 'INVOICE':
      return `/invoices/${link.id}`;
    case 'RETURN':
      return `/tax-returns/${link.id}`;
    case 'LEAD':
      return `/leads/${link.id}`;
    case 'TASK':
      return `/tasks/${link.id}`;
    case 'CAMPAIGN':
      return `/communications/${link.id}`;
    case 'SERVICE':
      return `/services-pricing/${link.id}`;
    default:
      return null;
  }
}

export const KIND_WORD: Record<ReportRowLink['kind'], string> = {
  CLIENT: 'client',
  INVOICE: 'invoice',
  PAYMENT: 'payment',
  RETURN: 'tax return',
  LEAD: 'lead',
  TASK: 'task',
  CAMPAIGN: 'campaign',
  SERVICE: 'service',
};

/** The row's own record: the first link that has a page. */
export const ownRecord = (links: ReportRowLink[]) => links.find((l) => recordHref(l)) ?? null;

/** What a cell opens: the row's record from its first column, the client from a client column. */
export function cellLink(
  columnKey: string,
  first: boolean,
  links: ReportRowLink[],
): ReportRowLink | null {
  if (first) return ownRecord(links);
  if (/^client(Name)?$/.test(columnKey)) return links.find((l) => l.kind === 'CLIENT') ?? null;
  return null;
}

/** The report as the viewer left it. */
export interface ReportView {
  search: string;
  page: number;
  sort?: { id: string; descending: boolean } | undefined;
  hidden: string[];
  /** More Filters: the rows as typed and the conditions they make (the API checks them again). */
  extra: { rows: FilterDraft[]; conditions: ReportFilterCondition[] };
}

export const packView = (view: ReportView): string | null => pack(view);

const listOf = (x: unknown): unknown[] => (Array.isArray(x) ? (x as unknown[]) : []);

/** A view from the address, each part checked; null when there is none or it is not one. */
export function viewFrom(text: string | null): ReportView | null {
  const v = unpack(text);
  if (!v || typeof v !== 'object') return null;
  const d = v as Partial<Record<keyof ReportView, unknown>>;
  const extra =
    d.extra && typeof d.extra === 'object'
      ? (d.extra as { rows?: unknown[]; conditions?: unknown[] })
      : undefined;
  const sort =
    d.sort && typeof d.sort === 'object'
      ? (d.sort as { id?: unknown; descending?: unknown })
      : undefined;
  return {
    search: typeof d.search === 'string' ? d.search.slice(0, 100) : '',
    page: typeof d.page === 'number' && Number.isInteger(d.page) && d.page > 0 ? d.page : 1,
    ...(sort && typeof sort.id === 'string'
      ? { sort: { id: sort.id.slice(0, 80), descending: sort.descending === true } }
      : {}),
    hidden: Array.isArray(d.hidden)
      ? d.hidden.filter((x): x is string => typeof x === 'string').slice(0, 60)
      : [],
    extra: {
      rows: listOf(extra?.rows)
        .filter((c): c is FilterDraft => !!c && typeof c === 'object' && 'field' in c)
        .slice(0, 20),
      conditions: listOf(extra?.conditions)
        .filter((c): c is ReportFilterCondition => !!c && typeof c === 'object' && 'field' in c)
        .slice(0, 20),
    },
  };
}
