'use client';

import { PageContainer, PageSection } from '@firmivra/ui';
import { ArrowRight, Menu, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import lvpLogo from '../../app/portal/[firmSlug]/(client)/_components/lvp-logo.png';
import { PortalFooter } from '../../app/portal/[firmSlug]/(public)/_components/portal-footer';
import { usePortal } from '../../app/portal/[firmSlug]/layout';

/**
 * The signer pages' frame: one public navigation header, the signing content and one portal footer.
 */
export function SigningFrame({ children }: { children: ReactNode }) {
  const { branding, business } = usePortal();
  const [menuOpen, setMenuOpen] = useState(false);
  const navLink =
    'flex min-h-10 items-center px-2 text-sm font-semibold text-firm-primary transition-colors hover:text-firm-accent';
  const navClassName = [
    menuOpen
      ? 'fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-border bg-surface px-4 py-4'
      : 'hidden',
    'order-3 w-full lg:static lg:order-2 lg:block lg:w-auto lg:flex-1 lg:overflow-visible lg:border-t-0 lg:bg-transparent lg:p-0',
  ].join(' ');

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <PageSection as="header" className="sticky top-0 z-50 border-b border-border bg-surface py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <Link
            href={`/${business.slug}`}
            className="order-1 flex shrink-0 items-center text-xl font-bold text-firm-primary"
          >
            {business.slug === 'lvp' ? (
              <Image
                src={lvpLogo}
                alt=""
                width={176}
                height={56}
                sizes="144px"
                className="h-12 w-auto object-contain"
              />
            ) : branding.logoUrl ? (
              <Image unoptimized src={branding.logoUrl} alt="" width={176} height={56} />
            ) : (
              business.name
            )}
            <span data-testid="signing-firm" className="sr-only">
              {business.name}
            </span>
          </Link>
          <button
            type="button"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-controls="signing-primary-navigation"
            aria-expanded={menuOpen}
            className="order-2 inline-flex size-10 items-center justify-center rounded-control border border-border text-firm-primary lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <X aria-hidden className="size-5" />
            ) : (
              <Menu aria-hidden className="size-5" />
            )}
          </button>
          <nav id="signing-primary-navigation" aria-label="Primary" className={navClassName}>
            <ul className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-end lg:gap-4">
              <li>
                <Link
                  href={`/${business.slug}`}
                  onClick={() => setMenuOpen(false)}
                  className={navLink}
                >
                  Home
                </Link>
              </li>
              <li>
                <Link
                  href={`/${business.slug}/begin`}
                  onClick={() => setMenuOpen(false)}
                  className={navLink}
                >
                  Services
                </Link>
              </li>
              <li>
                <Link
                  href={`/${business.slug}/calculators`}
                  onClick={() => setMenuOpen(false)}
                  className={navLink}
                >
                  Resources
                </Link>
              </li>
              <li>
                <Link
                  href={`/${business.slug}/begin`}
                  onClick={() => setMenuOpen(false)}
                  className={navLink}
                >
                  Begin Online
                </Link>
              </li>
              <li className="mt-3 lg:mt-0">
                <Link
                  href={`/${business.slug}/appointments`}
                  onClick={() => setMenuOpen(false)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-semibold text-on-action transition-colors hover:bg-action-hover"
                >
                  Schedule an Appointment
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </PageSection>
      <PageContainer as="main" className="flex-1 py-4">
        {children}
      </PageContainer>
      <PortalFooter width="public" />
    </div>
  );
}
