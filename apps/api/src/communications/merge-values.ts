/** The person a campaign's merge fields are filled for: a client or a lead. */
export interface MergePerson {
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * The values a person gives to a campaign's merge fields, keyed by lower-cased field name: the
 * firm's custom fields (their fallbacks), the business name and the person's own fields. Shared by
 * every send and by the portal's announcements (C25), so each fills the same way.
 */
export function mergeValues(
  p: MergePerson | null,
  firmName: string,
  custom: readonly { label: string; fallback: string | null }[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of custom) if (f.fallback) m.set(f.label.toLowerCase(), f.fallback);
  m.set('business name', firmName);
  if (p) {
    const [first = '', ...rest] = p.name.split(' ');
    m.set('client first name', first);
    m.set('client last name', rest.join(' '));
    m.set('client full name', p.name);
    if (p.email) m.set('email address', p.email);
    if (p.phone) m.set('phone number', p.phone);
  }
  return m;
}
