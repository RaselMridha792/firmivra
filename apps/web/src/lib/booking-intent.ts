/**
 * Review 2 (Appointments row 3): the appointment type a visitor chose from a firm's booking link
 * (`/{slug}/book/{typeId}`), kept in this browser while they sign in, sign up or wait for the
 * firm's approval, so their next sign-in to that firm's portal opens booking on it. Only the
 * type's id is kept (nothing personal), per firm, for 30 days. Storage that is blocked or full
 * keeps nothing, and the pages still work: the sign-in link carries the id too (`?book=`).
 * S12: a package page's Book adds the package's id (`?package=`), kept and carried with the type,
 * so the booking names the package for the firm.
 */
const KEY_PREFIX = 'firmivra:booking:';
const KEEP_MS = 30 * 24 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const bookingKey = (slug: string) => `${KEY_PREFIX}${slug.toLowerCase()}`;

/** The id when it can be a type's, else null (a link's `?book=` is the visitor's to change). */
export const typeIdOf = (value: string | null | undefined): string | null =>
  value && UUID.test(value) ? value : null;

/** Keeps the chosen type (and the package it was booked from, S12) for the firm's next sign-in. */
export function keepBooking(
  slug: string,
  typeId: string,
  now = Date.now(),
  packageId?: string | null,
): void {
  if (!typeIdOf(typeId)) return;
  const pkg = typeIdOf(packageId);
  try {
    localStorage.setItem(
      bookingKey(slug),
      JSON.stringify({ typeId, at: now, ...(pkg ? { packageId: pkg } : {}) }),
    );
  } catch {
    // Blocked storage keeps nothing; the sign-in link still carries the type.
  }
}

/** The type kept for this firm, or null (none, past 30 days, or unreadable). */
export function pendingBooking(slug: string, now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(bookingKey(slug));
    if (!raw) return null;
    const kept = JSON.parse(raw) as { typeId?: unknown; at?: unknown };
    const typeId = typeof kept.typeId === 'string' ? typeIdOf(kept.typeId) : null;
    const fresh = typeof kept.at === 'number' && now - kept.at < KEEP_MS;
    if (typeId && fresh) return typeId;
    localStorage.removeItem(bookingKey(slug));
  } catch {
    // Unreadable storage keeps nothing.
  }
  return null;
}

/** S12: the package the kept type was booked from (its page's Book), or null. */
export function pendingPackage(slug: string, typeId: string, now = Date.now()): string | null {
  if (pendingBooking(slug, now) !== typeId) return null;
  try {
    const kept = JSON.parse(localStorage.getItem(bookingKey(slug)) ?? '{}') as {
      packageId?: unknown;
    };
    return typeof kept.packageId === 'string' ? typeIdOf(kept.packageId) : null;
  } catch {
    return null;
  }
}

/** Forgets the kept type once booking has opened on it. */
export function clearBooking(slug: string): void {
  try {
    localStorage.removeItem(bookingKey(slug));
  } catch {
    // Nothing to forget.
  }
}

/** The portal page that opens booking on a type, naming the package it was booked from (S12). */
export function bookingPath(slug: string, typeId: string, packageId?: string | null): string {
  const pkg = typeIdOf(packageId);
  return `/${slug}/appointments?book=${encodeURIComponent(typeId)}${pkg ? `&package=${pkg}` : ''}`;
}

/**
 * Intake Forms Review Two INTAKE-ACCESS-01: the portal page a signed-out client opened (an intake
 * email's link, a portal notice), carried on the sign-in link as `?next=` so signing in lands back
 * on it. Only a page inside this firm's portal counts: never another site or firm, and never the
 * sign-in pages themselves. Null for anything else.
 */
export function returnPathOf(slug: string, value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return null;
  let url: URL;
  try {
    url = new URL(value, 'https://portal.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://portal.invalid') return null;
  const base = `/${slug.toLowerCase()}/`;
  if (!url.pathname.toLowerCase().startsWith(base)) return null;
  const page = url.pathname.slice(base.length).toLowerCase();
  if (/^(sign-in|sign-up|forgot-password|reset-password)(\/|$)/.test(page)) return null;
  return `${url.pathname}${url.search}`;
}

/** The sign-in page, with `?next=` back to the portal page the client was on when there is one. */
export function signInWithReturn(signInPath: string, slug: string, here: string): string {
  const next = returnPathOf(slug, here);
  return next ? `${signInPath}?next=${encodeURIComponent(next)}` : signInPath;
}

/**
 * Where a client goes after signing in: booking on the type from the link (the sign-in page's
 * `?book=`, with its `?package=`), else the page they opened before signing in (`?next=`,
 * INTAKE-ACCESS-01: an intake email's form), else booking on the kept type, else home. The portal
 * shell still sends a client the firm has not approved yet to the waiting page, and the kept type
 * waits with them.
 */
export function afterSignIn(
  slug: string,
  fromLink?: string | null,
  next?: string | null,
  packageFromLink?: string | null,
): string {
  const linked = typeIdOf(fromLink);
  if (linked) return bookingPath(slug, linked, packageFromLink);
  const back = returnPathOf(slug, next);
  if (back) return back;
  const kept = pendingBooking(slug);
  return kept ? bookingPath(slug, kept, pendingPackage(slug, kept)) : `/${slug}/home`;
}
