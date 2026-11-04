'use client';

import { createContext, useContext } from 'react';
import { withOrigin } from '../../../../../lib/origin';

// IN-F02 (Octavia's Oct 28 review): a link out of the Integrations overview or the Marketplace
// carries `?from=` with the exact list it left (search, category, tab, sort, view), so Cancel and
// Back return there as it was (the exact-origin Back of SH1, lib/origin.ts).

const Origin = createContext<string | null>(null);

export const IntegrationsOrigin = Origin.Provider;

/** `href` with `?from=` the list the member is on, when there is one. */
export function useFromHere(): (href: string) => string {
  const origin = useContext(Origin);
  return (href) => (origin ? withOrigin(href, origin) : href);
}
