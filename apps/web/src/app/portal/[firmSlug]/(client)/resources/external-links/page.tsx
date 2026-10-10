import type { Metadata } from 'next';
import { ExternalLinksScreen } from './_components/external-links-screen';

export const metadata: Metadata = { title: 'External Links' };

export default function ExternalLinksPage() {
  return <ExternalLinksScreen />;
}
