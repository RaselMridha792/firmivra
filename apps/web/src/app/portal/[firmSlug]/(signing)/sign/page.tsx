import type { Metadata } from 'next';
import { SignerPage } from './_components/signer-page';

export const metadata: Metadata = { title: 'Sign documents' };

export default function SignDocumentsPage() {
  return <SignerPage />;
}
