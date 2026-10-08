'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, type ReactNode } from 'react';
import { usePortal } from '../layout';
import { Button, Modal } from '@firmivra/ui';
import type { LegalKind } from '@firmivra/types';
import { PageState } from '../../../../components/page-state';
import { portalAuth } from '../../../../lib/auth';
import { useApiQuery } from '../../../../lib/query';

/**
 * Public portal pages (landing, sign-in, sign-up, Begin Online): the firm's header and footer,
 * no sidebar. The firm's name and the Terms and Privacy links come from R3's public firm info.
 * Nahid builds it from docs/mockups/client-portal/Client portal landing page.png (N01).
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  const { branding, business } = usePortal();
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-border bg-folder-surface px-6 py-4">
        <Link
          href={`/${business.slug}`}
          className="flex items-center gap-3 text-xl font-bold text-firm-primary"
        >
          {branding.logoUrl && (
            <Image unoptimized src={branding.logoUrl} alt="" width={160} height={64} />
          )}
          {business.name}
        </Link>
      </header>
      <main className="flex-1">{children}</main>
      <PortalFooter />
    </div>
  );
}

export function PortalFooter() {
  const { business, legal } = usePortal();
  const [kind, setKind] = useState<LegalKind | null>(null);
  const title = kind === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
  return (
    <footer className="flex flex-wrap items-center gap-4 border-t border-border bg-firm-primary px-6 py-4 text-sm text-on-action [&>button]:text-on-action [&>button:hover]:text-firm-primary">
      <span data-testid="firm-name">{business.name}</span>
      {(['terms', 'privacy'] as const)
        .filter((item) => legal[item])
        .map((item) => (
          <Button key={item} variant="ghost" onClick={() => setKind(item)}>
            {item === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
          </Button>
        ))}
      <span className="ml-auto">Powered by Firmivra</span>
      <Modal open={kind !== null} title={title} onClose={() => setKind(null)}>
        {kind && <LegalText slug={business.slug} kind={kind} />}
      </Modal>
    </footer>
  );
}
function LegalText({ slug, kind }: { slug: string; kind: LegalKind }) {
  const query = useApiQuery(['portal-legal', slug, kind], () => portalAuth(slug).legal(kind));
  return (
    <PageState
      query={query}
      empty="No policy has been published."
      isEmpty={(doc) => !doc.body.trim()}
    >
      {(doc) => (
        <div className="whitespace-pre-wrap text-sm">{`Version ${doc.version}\n\n${doc.body}`}</div>
      )}
    </PageState>
  );
}
