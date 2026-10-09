'use client';

import { PageSection } from '@firmivra/ui';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePortal } from '../layout';
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
      <PageSection as="header" className="border-b border-border bg-folder-surface py-4">
        <Link
          href={`/${business.slug}`}
          className="flex items-center gap-3 text-xl font-bold text-firm-primary"
        >
          {branding.logoUrl && (
            <Image unoptimized src={branding.logoUrl} alt="" width={160} height={64} />
          )}
          {business.name}
        </Link>
      </PageSection>
      <main className="flex-1">{children}</main>
      <PortalFooter width="public" />
    </div>
  );
}
