import type { Metadata } from 'next';
import { LegalSettings } from './_components/legal-settings';

export const metadata: Metadata = { title: 'Terms & Privacy' };

export default function TermsPrivacyPage() {
  return <LegalSettings />;
}
