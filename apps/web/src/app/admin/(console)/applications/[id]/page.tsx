import type { Metadata } from 'next';
import { ApplicationDetail } from '../_components/application-detail';

export const metadata: Metadata = { title: 'Firm application' };

export default async function Application({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApplicationDetail id={id} />;
}
