import type { Metadata } from 'next';
import { ServicePreview } from './_components/service-preview';

export const metadata: Metadata = { title: 'Service' };

export default async function ServicesPricingIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ServicePreview serviceId={id} />;
}
