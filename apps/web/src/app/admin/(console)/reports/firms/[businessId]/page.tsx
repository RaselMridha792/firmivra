import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FirmReport } from './_components/firm-report';

export const metadata: Metadata = { title: 'Firm report' };

export default async function Page({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  return (
    <Suspense>
      <FirmReport businessId={businessId} tab="overview" />
    </Suspense>
  );
}
