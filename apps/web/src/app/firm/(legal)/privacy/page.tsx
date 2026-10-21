import type { Metadata } from 'next';
import { LegalDocument } from '../_components/legal-document';
import { PRIVACY_POLICY } from '../_components/privacy-policy';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPolicyPage() {
  return <LegalDocument doc={PRIVACY_POLICY} page="privacy" />;
}
