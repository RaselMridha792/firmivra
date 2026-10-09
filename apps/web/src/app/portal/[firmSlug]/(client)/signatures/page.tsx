import type { Metadata } from 'next';
import { SignatureCenter } from './_components/signature-center';

export const metadata: Metadata = { title: 'Signatures' };

export default function SignaturesPage() {
  return <SignatureCenter />;
}
