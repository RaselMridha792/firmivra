'use client';

import { Button, Modal } from '@firmivra/ui';
import type { LegalKind } from '@firmivra/types';
import Link from 'next/link';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { portalAuth } from '../../../../../lib/auth';
import { useApiQuery } from '../../../../../lib/query';
import { usePortal } from '../../layout';

const YEAR = new Date().getFullYear();

/** The portal footer: the firm's Terms and Privacy, and "Contact Us" for signed-in clients. */
export function PortalFooter({ contact = false }: { contact?: boolean }) {
  const { business, legal } = usePortal();
  const [kind, setKind] = useState<LegalKind | null>(null);
  const title = kind === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
  return (
    <footer className="flex flex-wrap items-center gap-4 border-t border-border bg-firm-primary px-6 py-4 text-sm text-on-action [&>button]:text-on-action [&>button:hover]:text-firm-primary">
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
