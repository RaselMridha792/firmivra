// A list's view (period, tab, filters, search, sort, page) kept in the page's address (SH1), so a
// link out of the list carries it in `?from=` and Back opens the list exactly as it was. The
// server page reads the query and hands it to the screen; the screen writes changes back
// without navigating. Values are plain text; a default is left out of the address.

export type ListQuery = Record<string, string>;
type Params = Record<string, string | string[] | undefined>;

/** The list's view from the page's query: each default's key, as text, or the default. */
export function readListQuery<T extends ListQuery>(params: Params, defaults: T): T {
  const out: ListQuery = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const value = params[key];
    if (typeof value === 'string' && value.length <= 200) out[key] = value;
  }
  return out as T;
}

/** `query` with the list's view set and its defaults left out; other parameters are kept. */
export function mergeListQuery(query: string, view: ListQuery, defaults: ListQuery): string {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(view)) {
    if (value === defaults[key] || value === '') params.delete(key);
    else params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Writes the list's view into the address without navigating (history.replaceState). */
export function writeListQuery(view: ListQuery, defaults: ListQuery): void {
  const next = mergeListQuery(window.location.search, view, defaults);
  if (next === window.location.search) return;
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${next}${window.location.hash}`,
  );
}

/** A whole number from the query, at least 1, or the fallback. */
export const pageOf = (value: string, fallback = 1) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : fallback;
};
