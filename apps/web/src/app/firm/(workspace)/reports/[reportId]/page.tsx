import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportDetail } from '../_components/report-detail';

export const metadata: Metadata = { title: 'Report' };

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  // The detail reads `?from=` (RP-F03): the way back to the library's tab and page.
  return (
    <Suspense fallback={null}>
      <ReportDetail reportId={reportId} />
    </Suspense>
  );
}
