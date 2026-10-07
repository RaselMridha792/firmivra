import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'External Links' };

export default function ExternalLinksPage() {
  return (
    <PagePlaceholder
      title="External Links"
      ticket="N09"
      owner="Nahid"
      mockup="client-portal/External links .png"
    />
  );
}
