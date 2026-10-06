import type { LucideIcon } from 'lucide-react';

/** One sidebar item. Without `href` and with `soon`, it shows a "Soon" badge and opens nothing. */
export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Public path on this site, for example '/applications'. */
  href?: string;
  /** Count badge, for example pending applications. */
  badge?: number;
  soon?: boolean;
}

/** Sidebar groups, drawn with a divider between them. */
export type NavSections = readonly (readonly NavItem[])[];

/**
 * The browser shows public paths (/applications); behind the proxy's rewrite Next.js may report
 * the internal one (/admin/applications). Both count as the same page.
 */
export function publicPath(pathname: string): string {
  return pathname.replace(/^\/(admin|firm|portal)(?=\/|$)/, '') || '/';
}

export function isActive(pathname: string, href: string): boolean {
  const path = publicPath(pathname);
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

/** "Octavia Holder" -> "OH". Words that don't start with a letter, like "(fake)", are skipped. */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => /^\p{L}/u.test(p));
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}
