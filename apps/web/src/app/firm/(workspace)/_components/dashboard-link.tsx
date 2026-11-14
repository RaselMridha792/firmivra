'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ComponentProps, createContext, use } from 'react';
import { rememberScroll, withOrigin } from '../../../../lib/origin';

/** The dashboard's address with its periods (dashboard-place.ts), for its links' way back. */
export const DashboardAddressContext = createContext('/');

/** Opens `href` from the dashboard with the way back (a row menu's View Details, Open Client…). */
export function useDashboardNavigate(): (href: string) => void {
  const address = use(DashboardAddressContext);
  const router = useRouter();
  return (href) => {
    rememberScroll(address, window.scrollY);
    router.push(withOrigin(href, address));
  };
}

/**
 * A link out of the dashboard that keeps the way back (Dashboard Review 2: K2, V9, R2 NEW6).
 * A card's list (`back=dashboard`) shows Back to Dashboard; any other page gets `from=` the
 * dashboard's address and the origin bar's Back to Dashboard. Either way the dashboard comes
 * back with the same periods, scrolled to where it was.
 */
export function DashboardLink({
  href,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const address = use(DashboardAddressContext);
  const card = new URLSearchParams(href.split('?')[1] ?? '').get('back') === 'dashboard';
  return (
    <Link
      href={card ? href : withOrigin(href, address)}
      onClick={(event) => {
        onClick?.(event);
        rememberScroll(address, window.scrollY);
      }}
      {...props}
    />
  );
}
