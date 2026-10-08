'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { PortalFooter } from '../../app/portal/[firmSlug]/(public)/_components/portal-footer';
import { usePortal } from '../../app/portal/[firmSlug]/layout';

/**
 * The signer pages' frame: the firm's logo and name and the portal footer (Terms, Privacy), with
 * no account and no portal menu. Phones first.
 */
export function SigningFrame({ children }: { children: ReactNode }) {
  const { branding, business } = usePortal();
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-border bg-folder-surface px-6 py-4">
        <p
          data-testid="signing-firm"
          className="flex items-center gap-3 text-xl font-bold text-firm-primary"
        >
          {branding.logoUrl && (
            <Image unoptimized src={branding.logoUrl} alt="" width={160} height={64} />
          )}
          {business.name}
        </p>
      </header>
      <main className="flex-1 p-4">{children}</main>
      <PortalFooter />
    </div>
  );
}
