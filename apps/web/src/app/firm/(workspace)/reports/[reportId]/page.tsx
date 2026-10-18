import type { Metadata } from 'next';
import { ReportDetail } from '../_components/report-detail';

export const metadata: Metadata = { title: 'Report' };

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return <ReportDetail reportId={reportId} />;
}
