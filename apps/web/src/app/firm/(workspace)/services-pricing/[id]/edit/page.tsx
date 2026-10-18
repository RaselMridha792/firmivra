import type { Metadata } from 'next';
import { EditServiceScreen } from './_components/edit-service-screen';

export const metadata: Metadata = { title: 'Edit service' };

export default async function ServicesPricingIdEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditServiceScreen serviceId={id} />;
}
