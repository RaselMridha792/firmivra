import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ServicePreview } from './_components/service-preview';

export const metadata: Metadata = { title: 'Service' };

export default async function ServicesPricingIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // R6: the preview reads its `?from=` (the list to go back to).
  return (
    <Suspense>
      <ServicePreview serviceId={id} />
    </Suspense>
  );
}
