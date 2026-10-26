'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ComponentProps, useCallback } from 'react';
import { rememberScroll, withOrigin } from '../lib/origin';

const here = () => `${window.location.pathname}${window.location.search}`;

/**
 * Opens `href` with this exact page as its origin (SH1): the page it opens shows Back to here, and
 * Back comes to the same tab, filters, search, period and scroll position.
 */
export function useOriginNavigate() {
  const router = useRouter();
  return useCallback(
    (href: string) => {
      const origin = here();
      rememberScroll(origin, window.scrollY);
      router.push(withOrigin(href, origin));
    },
    [router],
  );
}

/**
 * A link out of a workspace that keeps the way back (SH1). A plain click takes the whole current
 * address; a new tab gets this page's path.
 */
export function OriginLink({
  href,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const pathname = usePathname();
  const navigate = useOriginNavigate();
  return (
    <Link
      href={withOrigin(href, pathname)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
      }}
      {...props}
    />
  );
}
