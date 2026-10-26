// Exact-origin Back (Octavia's SH1, Oct 25 review): a link out of a service workspace carries
// `?from=` with the exact path and query it left (list, client, tab, filters, search, period), and
// the page it opens shows Back to that place (components/origin-bar.tsx), where the scroll position
// comes back too. Only a path on this site is ever followed: never another host or scheme.

export const ORIGIN_PARAM = 'from';
const SCROLL_KEY = 'fv-origin-scroll';
const MAX_LENGTH = 2000;

/** The place a Back should return to, or null when `value` is not a path on this site. */
export function safeOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > MAX_LENGTH) return null;
  const control = [...value].some((c) => c.charCodeAt(0) < 32);
  if (value.startsWith('//') || value.startsWith('/\\') || control) {
    return null;
  }
  try {
    const url = new URL(value, 'https://firmivra.invalid');
    if (url.origin !== 'https://firmivra.invalid') return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** `href` with `from=` set to `origin` (the current page by default). */
export function withOrigin(href: string, origin: string): string {
  const safe = safeOrigin(origin);
  if (!safe) return href;
  const [path = '', hash] = href.split('#');
  const [base = '', query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set(ORIGIN_PARAM, safe);
  return `${base}?${params.toString()}${hash === undefined ? '' : `#${hash}`}`;
}

const LABELS: Record<string, string> = {
  payroll: 'Payroll',
  bookkeeping: 'Bookkeeping',
  'tax-returns': 'Tax Returns',
  'business-advisory': 'Business Advisory',
  'tax-planning': 'Tax Planning',
  clients: 'Client',
  documents: 'Documents',
  tasks: 'Tasks',
  messages: 'Messages',
  calendar: 'Appointments',
  integrations: 'Integrations',
};

/** "Payroll", "Bookkeeping"…: the place the origin path belongs to. */
export function originLabel(origin: string): string {
  const first = origin.split(/[/?#]/)[1] ?? '';
  return LABELS[first] ?? 'Previous Page';
}

/** Remembers where the page was scrolled when the member left it through an origin link. */
export function rememberScroll(origin: string, y: number): void {
  write({ origin, y, returning: false });
}

/** The member chose Back to `origin`: its remembered scroll position is used once it opens. */
export function markReturn(origin: string): void {
  const saved = read();
  if (saved?.origin === origin) write({ ...saved, returning: true });
}

/** The scroll position to restore on `origin`, once, only when Back opened it. */
export function takeScroll(origin: string): number | null {
  const saved = read();
  if (!saved?.returning || saved.origin !== origin) return null;
  try {
    sessionStorage.removeItem(SCROLL_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
  return saved.y;
}

type Saved = { origin: string; y: number; returning: boolean };
function read(): Saved | null {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    return saved && typeof saved.origin === 'string' && typeof saved.y === 'number'
      ? { origin: saved.origin, y: saved.y, returning: saved.returning === true }
      : null;
  } catch {
    return null;
  }
}
function write(saved: Saved): void {
  try {
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(saved));
  } catch {
    // Storage blocked: Back still returns to the place, at its top.
  }
}
