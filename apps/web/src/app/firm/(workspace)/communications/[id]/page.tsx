import type { Metadata } from 'next';
import { ResultsScreen } from '../_components/results-screen';

export const metadata: Metadata = { title: 'Communication Details' };

export default async function CommunicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResultsScreen id={id} />;
}
