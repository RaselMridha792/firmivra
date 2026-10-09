import type { Metadata } from 'next';
import { SignerPreview } from './_components/signer-preview';

export const metadata: Metadata = { title: 'Sign documents' };

export default function SignDocumentsPage() {
  return <SignerPreview />;
}
