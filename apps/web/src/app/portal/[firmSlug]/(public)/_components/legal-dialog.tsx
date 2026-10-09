'use client';

import type { LegalKind } from '@firmivra/types';
import { Modal } from '@firmivra/ui';
import { PageState } from '../../../../../components/page-state';
import { portalAuth } from '../../../../../lib/auth';
import { useApiQuery } from '../../../../../lib/query';

const TITLES: Record<LegalKind, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
};

/**
 * The firm's current Terms of Service or Privacy Policy, read before agreeing. The text is
 * Markdown; it shows as plain text until the shared Markdown component is in packages/ui.
 */
export function LegalDialog({
  slug,
  kind,
  onClose,
}: {
  slug: string;
  kind: LegalKind | null;
  onClose: () => void;
}) {
  return (
    <Modal open={kind !== null} title={kind ? TITLES[kind] : ''} onClose={onClose}>
      {kind ? <LegalText slug={slug} kind={kind} /> : null}
    </Modal>
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
        <div data-testid="legal-text" className="max-w-modal text-sm whitespace-pre-wrap text-text">
          {`Version ${doc.version}\n\n${doc.body}`}
        </div>
      )}
    </PageState>
  );
}
