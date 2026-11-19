import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EditServiceScreen } from './_components/edit-service-screen';

export const metadata: Metadata = { title: 'Edit service' };

export default async function ServicesPricingIdEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // R6: the editor reads its `?from=` (the list Save and Cancel go back to).
  return (
    <Suspense>
      <EditServiceScreen serviceId={id} />
    </Suspense>
  );
}
