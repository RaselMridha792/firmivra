import type { Metadata } from 'next';
import { DetailFrame } from './_components/detail-frame';
import { OverviewTab } from './_components/tab-overview';

export const metadata: Metadata = { title: 'Intake form details' };

export default function IntakeFormsIdPage() {
  return (
    <DetailFrame tab="overview">
      <OverviewTab />
    </DetailFrame>
  );
}
