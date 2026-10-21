import type { Metadata } from 'next';
import { LegalDocument } from '../_components/legal-document';
import { TERMS_OF_SERVICE } from '../_components/terms-of-service';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function TermsOfServicePage() {
  return <LegalDocument doc={TERMS_OF_SERVICE} page="terms" />;
}
