import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MOCK_MODULES } from '../../../../../../lib/mock';
import { SignerSamples } from './signer-samples';

export const metadata: Metadata = { title: 'Signing samples' };

/** The signer's building blocks on synthetic documents, for mock mode and its tests only. */
export default function SigningSamplesPage() {
  if (MOCK_MODULES.length === 0) notFound();
  return <SignerSamples />;
}
