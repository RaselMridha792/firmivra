'use client';

import { PageSection } from '@firmivra/ui';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePortal } from '../layout';
import { ButtonLink } from './_components/button-link';
import { PortalFooter } from './_components/portal-footer';

/**
 * Public portal pages (landing, sign-in, sign-up, Begin Online): the firm's header and footer,
 * no sidebar. The firm's name and the Terms and Privacy links come from R3's public firm info.
 * Nahid builds it from docs/mockups/client-portal/Client portal landing page.png (N01).
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  const { branding, business } = usePortal();
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <PageSection as="header" className="border-b border-border bg-folder-surface py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href={`/${business.slug}`}
            className="flex items-center text-xl font-bold text-firm-primary"
          >
            {branding.logoUrl ? (
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
          <nav aria-label="Get started" className="flex flex-wrap gap-3">
            <ButtonLink href={`/${business.slug}/begin`} className="w-auto!">
              Begin Online
            </ButtonLink>
            <ButtonLink
              variant="outline"
              href={`/${business.slug}/appointments`}
              className="w-auto!"
            >
              Book an Appointment
            </ButtonLink>
          </nav>
        </div>
      </PageSection>
      <main className="flex-1">{children}</main>
      <PortalFooter width="public" />
    </div>
  );
}
