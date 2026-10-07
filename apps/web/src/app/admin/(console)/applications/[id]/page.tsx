import type { Metadata } from 'next';
import { FirmApplicationId } from '@firmivra/types';
import { notFound } from 'next/navigation';
import { ApplicationDetail } from '../_components/application-detail';

export const metadata: Metadata = { title: 'Firm application' };

export default async function Application({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!FirmApplicationId.safeParse(id).success) notFound();
  return <ApplicationDetail id={id} />;
}
