'use client';

import { Button, PageContainer, type PageWidth } from '@firmivra/ui';
import type { LegalKind } from '@firmivra/types';
import Link from 'next/link';
import { useState } from 'react';
import { usePortal } from '../../layout';
import { LegalDialog } from './legal-dialog';

const YEAR = new Date().getFullYear();
const ROW =
  'flex flex-wrap items-center gap-4 py-4 [&>button]:text-on-action [&>button:hover]:text-firm-primary';

/**
 * The portal footer: the firm's Terms and Privacy, and "Contact Us" for signed-in clients. With a
 * width (the public pages) its content lines up with PageContainer; without one it spans the column.
 */
export function PortalFooter({ contact = false, width }: { contact?: boolean; width?: PageWidth }) {
  const { business, legal } = usePortal();
  const [kind, setKind] = useState<LegalKind | null>(null);
  const items = (
    <>
      <span>
        © {YEAR} <span data-testid="firm-name">{business.name}</span>. All rights reserved.
      </span>
      {(['terms', 'privacy'] as const)
        .filter((item) => legal[item])
        .map((item) => (
          <Button key={item} variant="ghost" onClick={() => setKind(item)}>
            {item === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
          </Button>
        ))}
      {contact && <Link href={`/${business.slug}/messages`}>Contact Us</Link>}
      <span className="ml-auto">Powered by Firmivra</span>
    </>
  );
  return (
    <footer className="border-t border-border bg-firm-primary text-sm text-on-action">
      {width ? (
        <PageContainer width={width} className={ROW}>
          {items}
        </PageContainer>
      ) : (
        <div className={`px-4 md:px-6 ${ROW}`}>{items}</div>
      )}
      <LegalDialog slug={business.slug} kind={kind} onClose={() => setKind(null)} />
    </footer>
  );
}
