import { choiceOf } from './chart-display';
import type { FilterDraft } from './filter-rules';

// RP-F14, F05 (Octavia's Reports review, Oct 28): the builder's work travels in the address, so
// Run Report opens the full report of the unsaved definition and Back finds the builder as it was.
// Both are JSON in base64url (letters, digits, "-" and "_"), never more than the address holds.

/** Everything the builder shows, so it can be put back exactly. */
export interface BuilderDraft {
  name: string;
  category: string;
  sourceKey: string;
  columns: string[];
  preset: string;
  fixed?: { from: string; to: string } | undefined;
  conds: FilterDraft[];
  groupBy: string;
  sortBy: string;
  desc: boolean;
  totals: boolean;
  pct: boolean;
  compare: boolean;
  /** RP-F18: how the report shows (Automatic, a chart, Table Only, KPI Only). */
  chart: string;
}

export const NEW_DRAFT: BuilderDraft = {
  name: 'Custom Report',
  category: 'FINANCIAL',
  sourceKey: '',
  columns: [],
  preset: 'this_year',
  conds: [],
  groupBy: '',
  sortBy: '',
  desc: true,
  totals: false,
  pct: false,
  compare: false,
  chart: 'AUTO',
};

/** The most an address carries here; a larger draft is not put in it. */
const MAX = 6_000;

/** `value` as base64url JSON, or null when it would not fit an address. */
export function pack(value: unknown): string | null {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const out = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return out.length <= MAX ? out : null;
}

/** What `pack` made, or null when the text is not one. */
export function unpack(text: string | null): unknown {
  if (!text || text.length > MAX || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** A builder draft from the address: each field checked, the new draft's where one is wrong. */
export function draftFrom(text: string | null): BuilderDraft {
  const v = unpack(text);
  if (!v || typeof v !== 'object') return NEW_DRAFT;
  const d = v as Partial<Record<keyof BuilderDraft, unknown>>;
  const str = (x: unknown, fallback: string) =>
    typeof x === 'string' ? x.slice(0, 200) : fallback;
  const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
  const day = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
  const fixed =
    d.fixed && typeof d.fixed === 'object'
      ? (d.fixed as { from?: unknown; to?: unknown })
      : undefined;
  return {
    name: str(d.name, NEW_DRAFT.name),
    category: str(d.category, NEW_DRAFT.category),
    sourceKey: str(d.sourceKey, ''),
    columns: Array.isArray(d.columns)
      ? d.columns.filter((c): c is string => typeof c === 'string').slice(0, 50)
      : [],
    preset: str(d.preset, NEW_DRAFT.preset),
    ...(fixed && day(fixed.from) && day(fixed.to)
      ? { fixed: { from: fixed.from as string, to: fixed.to as string } }
      : {}),
    conds: Array.isArray(d.conds)
      ? d.conds
          .filter((c): c is FilterDraft => !!c && typeof c === 'object' && 'field' in c)
          .slice(0, 20)
          .map((c) => ({
            field: str(c.field, ''),
            op: str(c.op, ''),
            value: str(c.value, ''),
            to: str(c.to, ''),
            values: Array.isArray(c.values)
              ? c.values.filter((x): x is string => typeof x === 'string')
              : [],
          }))
      : [],
    groupBy: str(d.groupBy, ''),
    sortBy: str(d.sortBy, ''),
    desc: bool(d.desc, true),
    totals: bool(d.totals, false),
    pct: bool(d.pct, false),
    compare: bool(d.compare, false),
    chart: choiceOf(typeof d.chart === 'string' ? d.chart : null),
  };
}
