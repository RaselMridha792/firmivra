/**
 * Review 2 (Appointments row 3): the appointment type a visitor chose from a firm's booking link
 * (`/{slug}/book/{typeId}`), kept in this browser while they sign in, sign up or wait for the
 * firm's approval, so their next sign-in to that firm's portal opens booking on it. Only the
 * type's id is kept (nothing personal), per firm, for 30 days. Storage that is blocked or full
 * keeps nothing, and the pages still work: the sign-in link carries the id too (`?book=`).
 */
const KEY_PREFIX = 'firmivra:booking:';
const KEEP_MS = 30 * 24 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const bookingKey = (slug: string) => `${KEY_PREFIX}${slug.toLowerCase()}`;

/** The id when it can be a type's, else null (a link's `?book=` is the visitor's to change). */
export const typeIdOf = (value: string | null | undefined): string | null =>
  value && UUID.test(value) ? value : null;

/** Keeps the chosen type for the firm's next sign-in. */
export function keepBooking(slug: string, typeId: string, now = Date.now()): void {
  if (!typeIdOf(typeId)) return;
  try {
    localStorage.setItem(bookingKey(slug), JSON.stringify({ typeId, at: now }));
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

/** Forgets the kept type once booking has opened on it. */
export function clearBooking(slug: string): void {
  try {
    localStorage.removeItem(bookingKey(slug));
  } catch {
    // Nothing to forget.
  }
}

/** The portal page that opens booking on a type. */
export const bookingPath = (slug: string, typeId: string) =>
  `/${slug}/appointments?book=${encodeURIComponent(typeId)}`;

/**
 * Where a client goes after signing in: booking on the type from the link (the sign-in page's
 * `?book=`, else the kept one), or home. The portal shell still sends a client the firm has not
 * approved yet to the waiting page, and the kept type waits with them.
 */
export function afterSignIn(slug: string, fromLink?: string | null): string {
  const typeId = typeIdOf(fromLink) ?? pendingBooking(slug);
  return typeId ? bookingPath(slug, typeId) : `/${slug}/home`;
}
