'use client';

import { Button, PageContainer, type PageWidth } from '@firmivra/ui';
import type { LegalKind } from '@firmivra/types';
import Link from 'next/link';
import { useState } from 'react';
import { usePortal } from '../../layout';
import { LegalDialog } from './legal-dialog';
import { taglineWords } from './tagline';

const YEAR = new Date().getFullYear();
const ROW = 'flex flex-wrap items-center gap-4 py-4';

/**
 * The portal footer: the firm's Terms and Privacy, and "Contact Us" for signed-in clients. With a
 * width (the public pages) its content lines up with PageContainer; without one it spans the column.
 */
export function PortalFooter({ contact = false, width }: { contact?: boolean; width?: PageWidth }) {
  const { business, branding, legal } = usePortal();
  const [kind, setKind] = useState<LegalKind | null>(null);
  const motto = taglineWords(branding.tagline);
  const links = [
    ...(['privacy', 'terms'] as const)
      .filter((item) => legal[item])
      .map((item) => (
        <Button key={item} variant="ghost" onClick={() => setKind(item)}>
          {item === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
        </Button>
      )),
    ...(contact
      ? [
          <Link key="contact" href={`/${business.slug}/messages`}>
            Contact Us
          </Link>,
        ]
      : []),
  ];
  const items = (
    <>
      <span>
        © {YEAR} <span data-testid="firm-name">{business.name}</span>. All rights reserved.
      </span>
      <span className="flex flex-wrap items-center gap-2 md:ml-auto [&_button]:text-on-action [&_button:hover]:text-firm-primary">
        {links.map((link, index) => (
          <span key={link.key} className="flex items-center gap-2">
            {index > 0 ? <span aria-hidden>|</span> : null}
            {link}
          </span>
        ))}
      </span>
      {/* Signed-in pages show the firm's motto (the mockup's script line) in place of our name. */}
      {contact && motto.length > 0 ? (
        <span className="font-display text-lg text-firm-accent italic">{motto.join(' / ')}</span>
      ) : (
        <span>Powered by Firmivra</span>
      )}
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
