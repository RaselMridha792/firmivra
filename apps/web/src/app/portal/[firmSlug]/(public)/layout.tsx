'use client';

import { PageSection } from '@firmivra/ui';
import { ArrowRight, ChevronDown, Menu, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { usePortal } from '../layout';
import lvpLogo from '../(client)/_components/lvp-logo.png';
import { ButtonLink } from './_components/button-link';
import { PortalFooter } from './_components/portal-footer';

/**
 * Public portal pages (landing, sign-in, sign-up, Begin Online): the firm's header and footer,
 * no sidebar. The firm's name and the Terms and Privacy links come from R3's public firm info.
 * Nahid builds it from docs/mockups/client-portal/Client portal landing page.png (N01).
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  const { branding, business } = usePortal();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'services' | 'resources' | null>(null);
  const isLvp = business.slug === 'lvp';
  // The two buttons are for the landing page only: sign-in, sign-up, password reset and Begin
  // Online keep the visitor on the task they opened.
  const landing = pathname === `/${business.slug}`;
  const serviceLinks = [
    { label: 'Tax Preparation', href: `/${business.slug}/begin/annual-tax` },
    { label: 'Business Bookkeeping', href: `/${business.slug}/begin/bookkeeping` },
    { label: 'Payroll Services', href: `/${business.slug}/begin/payroll` },
    { label: 'Business Development', href: `/${business.slug}/begin/business-development` },
    { label: 'Quarterly Taxes', href: `/${business.slug}/begin/quarterly-tax` },
    { label: 'Tax Planning', href: `/${business.slug}/begin/tax-planning` },
  ];
  const resourceLinks = [
    { label: 'Tax Calculators', href: `/${business.slug}/calculators` },
    { label: 'Tax Return Calculator', href: `/${business.slug}/calculators/tax-return` },
    { label: 'Tax Bracket Calculator', href: `/${business.slug}/calculators/tax-bracket` },
    {
      label: 'Quarterly Tax Calculator',
      href: `/${business.slug}/calculators/quarterly-estimate`,
    },
  ];
  const closeMenu = () => {
    setMenuOpen(false);
    setOpenDropdown(null);
  };
  useEffect(() => {
    if (!openDropdown) return;

    const closeDropdownOnScreenClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-dropdown-trigger]')) {
        return;
      }
      setOpenDropdown(null);
    };

    document.addEventListener('click', closeDropdownOnScreenClick);
    return () => document.removeEventListener('click', closeDropdownOnScreenClick);
  }, [openDropdown]);
  const navLinkClass = (active = false) =>
    [
      'flex min-h-10 items-center px-2 text-sm font-semibold transition-colors lg:border-b-2',
      active
        ? 'text-firm-accent lg:border-firm-accent'
        : 'text-firm-text hover:text-firm-accent lg:border-transparent',
    ].join(' ');
  const dropdown = (
    name: 'services' | 'resources',
    label: string,
    items: { label: string; href: string }[],
    active: boolean,
  ) => (
    <li className="relative" key={name}>
      <button
        type="button"
        data-dropdown-trigger=""
        aria-expanded={openDropdown === name}
        aria-controls={openDropdown === name ? `lvp-${name}-menu` : undefined}
        className={`${navLinkClass(active)} gap-1`}
        onClick={() => setOpenDropdown(openDropdown === name ? null : name)}
      >
        {label}
        <ChevronDown aria-hidden className="size-4" />
      </button>
      {openDropdown === name ? (
        <div
          id={`lvp-${name}-menu`}
          className="mt-1 flex flex-col rounded-control border border-border bg-surface p-2 lg:absolute lg:top-full lg:left-0 lg:z-20 lg:mt-0 lg:min-w-56"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeMenu}
              className="flex min-h-10 items-center px-3 py-2 text-sm text-firm-text hover:bg-folder-surface hover:text-firm-accent"
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </li>
  );
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <PageSection
        as="header"
        className={`border-b border-border ${isLvp ? 'sticky top-0 z-50 bg-surface py-2' : 'bg-folder-surface py-3'}`}
      >
        <div
          className={`flex flex-wrap items-center justify-between ${isLvp ? 'gap-x-5 gap-y-2' : 'gap-4'}`}
        >
          <Link
            href={`/${business.slug}`}
            className={
              isLvp
                ? 'order-1 flex shrink-0 items-center text-xl font-bold text-firm-text'
                : 'flex items-center text-xl font-bold text-firm-text'
            }
          >
            {isLvp ? (
              <Image
                src={lvpLogo}
                alt={business.name}
                width={176}
                height={56}
                sizes="144px"
                className="h-12 w-auto object-contain"
              />
            ) : branding.logoUrl ? (
              <Image
                unoptimized
                src={branding.logoUrl}
                alt={business.name}
                width={176}
                height={56}
              />
            ) : (
              business.name
            )}
          </Link>
          {isLvp ? (
            <>
              <button
                type="button"
                aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-controls="lvp-primary-navigation"
                aria-expanded={menuOpen}
                className="order-2 inline-flex size-10 items-center justify-center rounded-control border border-border text-firm-text lg:hidden"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                {menuOpen ? (
                  <X aria-hidden className="size-5" />
                ) : (
                  <Menu aria-hidden className="size-5" />
                )}
              </button>
              <nav
                id="lvp-primary-navigation"
                aria-label="Primary"
                className={[
                  menuOpen
                    ? 'fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-border bg-surface px-4 py-4'
                    : 'hidden',
                  'order-3 w-full lg:static lg:order-2 lg:block lg:w-auto lg:flex-1 lg:overflow-visible lg:border-t-0 lg:bg-transparent lg:p-0',
                ].join(' ')}
              >
                <ul className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-end lg:gap-4">
                  <li>
                    <Link
                      href={`/${business.slug}`}
                      onClick={closeMenu}
                      aria-current={landing ? 'page' : undefined}
                      className={navLinkClass(landing)}
                    >
                      Home
                    </Link>
                  </li>
                  {dropdown('services', 'Services', serviceLinks, openDropdown === 'services')}
                  {dropdown(
                    'resources',
                    'Resources',
                    resourceLinks,
                    pathname.includes('/calculators'),
                  )}
                  <li>
                    <Link
                      href={`/${business.slug}/begin`}
                      onClick={closeMenu}
                      aria-current={
                        pathname.startsWith(`/${business.slug}/begin`) ? 'page' : undefined
                      }
                      className={navLinkClass(pathname.startsWith(`/${business.slug}/begin`))}
                    >
                      Begin Online
                    </Link>
                  </li>
                  <li className="mt-3 lg:mt-0">
                    <Link
                      href={`/${business.slug}/appointments`}
                      onClick={closeMenu}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-semibold text-on-action transition-colors hover:bg-action-hover"
                    >
                      Schedule an Appointment
                      <ArrowRight aria-hidden className="size-4" />
                    </Link>
                  </li>
                </ul>
              </nav>
            </>
          ) : landing ? (
            <nav aria-label="Get started" className="flex flex-wrap gap-3">
              <ButtonLink href={`/${business.slug}/begin`} className="w-auto!">
                Begin Online
              </ButtonLink>
              <ButtonLink
                variant="outline"
                href={`/${business.slug}/appointments`}
                className="w-auto!"
              >
                Clients: Book an Appointment
              </ButtonLink>
            </nav>
          ) : null}
        </div>
      </PageSection>
      <main className="flex-1">{children}</main>
      <PortalFooter width="public" />
    </div>
  );
}
