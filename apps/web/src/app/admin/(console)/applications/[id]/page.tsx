import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ApplicationDetail } from '../_components/application-detail';
import { findApplication } from '../_components/application-data';

export const metadata: Metadata = { title: 'Firm application' };

export default async function Application({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const application = findApplication(id);
  if (!application) notFound();
  return <ApplicationDetail application={application} />;
}
