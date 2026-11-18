import { isActive } from '../../../../../components/app-shell/types';

/** How a menu line looks on the current page: lit (the page's own line), softly lit, or plain. */
export type MenuState = 'active' | 'related' | undefined;

/**
 * "My Client Portal" tab pages that have no menu line of their own (docs/mockups/client-portal):
 * Business Documents & Resources, Tax Returns and the business resource pages under /resources.
 * Home stays lit on them, as their way back.
 */
const HOME_PAGES = ['business', 'taxes', 'resources'];

/** Pages that belong to another line: a document request's packet is part of My Documents. */
const PART_OF: Record<string, string> = { requests: 'documents' };

/**
 * The menu line lit on each portal page (Octavia's Client Portal review, Nov 18): the line of the
 * page itself, and on its sub-pages too (My Documents on /documents/123, Intake Forms on
 * /intake/xyz, Tax Plans on /tax-plans/id), so exactly one line is lit. Home is lit on Home and on
 * the tab pages above. The notification center has no menu line and lights none. Desktop and
 * the mobile drawer use this one rule.
 */
export function menuState(pathname: string, slug: string, href: string): MenuState {
  const page = (name: string) => `/${slug}/${name}`;
  if (href === page('home'))
    return [page('home'), ...HOME_PAGES.map(page)].some((p) => isActive(pathname, p))
      ? 'active'
      : undefined;
  if (isActive(pathname, href)) return 'active';
  const lit = Object.entries(PART_OF).some(
    ([part, owner]) => href === page(owner) && isActive(pathname, page(part)),
  );
  return lit ? 'active' : undefined;
}
